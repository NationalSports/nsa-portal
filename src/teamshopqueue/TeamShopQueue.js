import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStaffSession } from '../lib/useStaffSession';
import { fetchTicketArts, openTicket } from './ticket';

// Team Shop — Fast Turn Queue. A staff-only lazy chunk, routed at
// /teamshop-queue by src/index.js. This is the fast-turn production board for
// Team Shop orders ONLY (webstore_orders.order_source='teamshop', see 00195 /
// 00196) — a small, separate view from the main warehouse jobs board in
// App.js, which this chunk does not touch or import.
//
// Data model (client-side join, no server view exists for this):
//   webstore_orders  (order_source='teamshop', status in paid|batched)
//     -> so_id -> sales_orders (one row)
//     -> so_id -> so_jobs (0..n rows) — the production jobs this board manages
//
// Auth: this is the STAFF portal, not the Team Shop consumer storefront. It
// uses the main `supabase` client (src/lib/supabase.js) — the same client
// App.js / LoginGate use — NOT supabaseCoach (that's the coach-facing Team
// Shop client, isolated on purpose). RLS gates reads to is_team_member()
// staff (00173+ lockdown); a signed-out visitor sees a plain gate, no login
// form (staff sign in through the normal portal at '/').
//
// Stage moves go through the advance_job_stage RPC (00192) exclusively — this
// chunk never writes prod_status directly. If the migration hasn't been
// applied yet to whatever DB this build points at, the RPC call fails with a
// Postgres "function does not exist" error; we detect that and disable the
// stage buttons with an explanatory note rather than silently failing.

const REFRESH_MS = 60000;

const COLUMNS = [
  { key: 'hold', label: 'Hold' },
  { key: 'staging', label: 'Staging' },
  { key: 'in_process', label: 'In Process' },
  { key: 'completed', label: 'Completed' },
];

// Mirrors advance_job_stage's own normalization (00192: legacy 'ready' -> 'hold').
const normProdStatus = (s) => {
  const v = s || 'hold';
  return v === 'ready' ? 'hold' : v;
};

const fmtMoney = (n) => {
  const v = Number(n) || 0;
  return '$' + v.toFixed(2);
};

const fmtAge = (createdAt) => {
  if (!createdAt) return '';
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
};

// Postgres "undefined function" (42883) or PostgREST's "could not find the
// function in the schema cache" — both mean advance_job_stage isn't deployed
// to this DB yet.
const isFunctionMissing = (error) => {
  if (!error) return false;
  const code = error.code || '';
  const msg = (error.message || '') + ' ' + (error.details || '') + ' ' + (error.hint || '');
  return code === '42883' || /could not find the function|schema cache/i.test(msg);
};

const isStaleState = (error) => !!error && /NSA_STALE_STATE/.test(error.message || '');

// Postgres "relation does not exist" (42P01) or "column does not exist"
// (42703) — both surface as PostgREST schema-cache misses too, for
// migrations (00198 rates, 00200 teamshop_po_allowed) that may not be
// applied yet to whatever DB this build points at.
const isMissingRelation = (error) => {
  if (!error) return false;
  const code = error.code || '';
  const msg = (error.message || '') + ' ' + (error.details || '') + ' ' + (error.hint || '');
  return code === '42P01' || code === '42703' || /does not exist|could not find|schema cache/i.test(msg);
};

const DECO_TYPES = ['embroidery', 'dtf', 'vinyl', 'silicone_patch', 'screen_print'];
const familyForType = (type) => (
  type === 'embroidery' ? 'embroidery'
    : type === 'screen_print' ? 'screen_print'
    : 'heat' // dtf | vinyl | silicone_patch
);

const TEAMSHOP_STORE_SLUG = 'nationalteamshop';

// Session tracker for the main staff client — extracted to
// src/lib/useStaffSession.js so the floor scan station chunk shares it.

// Fetches the queue data set: teamshop orders (paid/batched), their linked
// sales_orders + so_jobs, and a per-order item count.
async function fetchQueue() {
  const { data: orders, error: ordersErr } = await supabase
    .from('webstore_orders')
    .select('*')
    .eq('order_source', 'teamshop')
    .in('status', ['paid', 'batched'])
    .order('created_at', { ascending: false });
  if (ordersErr) throw ordersErr;

  const orderIds = (orders || []).map((o) => o.id).filter(Boolean);
  const soIds = [...new Set((orders || []).map((o) => o.so_id).filter(Boolean))];

  const [soRes, jobsRes, itemsRes] = await Promise.all([
    soIds.length
      ? supabase.from('sales_orders').select('*').in('id', soIds)
      : Promise.resolve({ data: [], error: null }),
    soIds.length
      ? supabase.from('so_jobs').select('*').in('so_id', soIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? supabase.from('webstore_order_items').select('order_id').in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (soRes.error) throw soRes.error;
  if (jobsRes.error) throw jobsRes.error;
  if (itemsRes.error) throw itemsRes.error;

  const itemCounts = {};
  (itemsRes.data || []).forEach((i) => { itemCounts[i.order_id] = (itemCounts[i.order_id] || 0) + 1; });

  return {
    orders: orders || [],
    salesOrders: soRes.data || [],
    jobs: jobsRes.data || [],
    itemCounts,
  };
}

function JobCard({ job, order, onAction, onTicket, actionsDisabled, actionBusy }) {
  const status = normProdStatus(job.prod_status);
  const buyer = order ? (order.buyer_name || order.buyer_email || '') : '';
  const busy = actionBusy === job.id;

  const actionFor = {
    hold: { event: 'release', label: 'Release →' },
    staging: { event: 'start_run', label: 'Start →' },
    in_process: { event: 'decorated', label: 'Done →' },
    completed: job.packed_at ? null : { event: 'packed', label: 'Packed' },
  }[status];

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{job.so_id} / {job.id}</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>{job.created_at || ''}</span>
      </div>
      <div style={{ fontWeight: 600, marginTop: 4 }}>{job.art_name || 'Unassigned Art'}</div>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
        {job.deco_type || '—'}{job.positions ? ' · ' + job.positions : ''} · {job.total_units || 0} units
      </div>
      {buyer && <div style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>{buyer}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {job.digitizing_needed && (
          <span style={{ background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
            Needs digitizing
          </span>
        )}
        <span style={{ background: '#f1f5f9', color: '#334155', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4 }}>
          art: {job.art_status || 'needs_art'}
        </span>
        {job.packed_at && (
          <span style={{ background: '#dcfce7', color: '#166534', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4 }}>
            packed
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {actionFor && (
          <button
            type="button"
            disabled={actionsDisabled || busy}
            onClick={() => onAction(job, actionFor.event, status)}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 700,
              background: actionsDisabled ? '#e2e8f0' : '#1d4ed8', color: actionsDisabled ? '#94a3b8' : '#fff',
              border: 'none', borderRadius: 6, cursor: actionsDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Working…' : actionFor.label}
          </button>
        )}
        <button
          type="button"
          aria-label={'ticket-' + job.id}
          onClick={() => onTicket(job)}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700,
            background: '#fff', color: '#334155', border: '1px solid #cbd5e1',
            borderRadius: 6, cursor: 'pointer',
          }}
        >
          Ticket
        </button>
      </div>
    </div>
  );
}

function TeamShopQueueBoard({ email }) {
  const [data, setData] = useState({ orders: [], salesOrders: [], jobs: [], itemCounts: {} });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [digitizingOnly, setDigitizingOnly] = useState(false);
  const [rpcMissing, setRpcMissing] = useState(false);
  const [actionBusy, setActionBusy] = useState(null);
  const toastTimer = useRef(null);

  const refetch = useCallback(() => {
    setErr(null);
    return fetchQueue()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setErr(e.message || String(e)); setLoading(false); });
  }, []);

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, REFRESH_MS);
    return () => clearInterval(id);
  }, [refetch]);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const soById = useMemo(() => {
    const m = {};
    data.salesOrders.forEach((s) => { m[s.id] = s; });
    return m;
  }, [data.salesOrders]);

  const orderBySoId = useMemo(() => {
    const m = {};
    data.orders.forEach((o) => { if (o.so_id) m[o.so_id] = o; });
    return m;
  }, [data.orders]);

  const awaitingConversion = useMemo(
    () => data.orders.filter((o) => o.status === 'paid' && !o.so_id),
    [data.orders]
  );

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.jobs.filter((j) => {
      if (digitizingOnly && !j.digitizing_needed) return false;
      if (!q) return true;
      const order = orderBySoId[j.so_id];
      const hay = [j.so_id, j.id, j.art_name, order && order.buyer_name, order && order.buyer_email]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [data.jobs, search, digitizingOnly, orderBySoId]);

  const jobsByColumn = useMemo(() => {
    const m = { hold: [], staging: [], in_process: [], completed: [] };
    filteredJobs.forEach((j) => {
      const s = normProdStatus(j.prod_status);
      (m[s] || (m[s] = [])).push(j);
    });
    return m;
  }, [filteredJobs]);

  // "Ticket" — print-ready job ticket with a scannable Code 128 barcode (see
  // ./ticket.js). Art rows are fetched on demand: the board itself never needs
  // so_art_files, so we don't widen fetchQueue for a per-click action.
  const handleTicket = useCallback((job) => {
    fetchTicketArts(job.so_id)
      .then((arts) => {
        const opened = openTicket(job, orderBySoId[job.so_id], arts);
        if (!opened) showToast('Ticket window blocked — allow pop-ups for this site');
      })
      .catch((e) => showToast('Ticket failed: ' + (e.message || String(e))));
  }, [orderBySoId]); // showToast only touches stable setters/refs — any render's instance works

  const handleAction = useCallback((job, event, expected) => {
    setActionBusy(job.id);
    // Optimistic update.
    const optimisticStatus = event === 'release' ? 'staging'
      : event === 'start_run' ? 'in_process'
      : event === 'decorated' ? 'completed'
      : expected; // 'packed' doesn't move prod_status
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id === job.id && j.so_id === job.so_id)
        ? { ...j, prod_status: optimisticStatus, ...(event === 'packed' ? { packed_at: new Date().toISOString() } : {}) }
        : j),
    }));

    supabase.rpc('advance_job_stage', {
      p_so_id: job.so_id,
      p_job_id: job.id,
      p_event: event,
      p_actor: email || '',
      p_expected: expected,
    }).then(({ error }) => {
      setActionBusy(null);
      if (error) {
        if (isFunctionMissing(error)) {
          setRpcMissing(true);
          showToast('State machine migration not applied yet');
        } else if (isStaleState(error)) {
          showToast('Job moved by someone else — refreshed');
        } else {
          showToast('Move failed: ' + (error.message || 'unknown error'));
        }
        refetch();
        return;
      }
      refetch();
    }).catch((e) => {
      setActionBusy(null);
      showToast('Move failed: ' + (e.message || String(e)));
      refetch();
    });
  }, [email, refetch]);

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#f8fafc', minHeight: '100vh', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>Team Shop — Fast Turn Queue</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {loading && <span style={{ fontSize: 12, color: '#64748b' }}>Loading…</span>}
          <button type="button" onClick={refetch} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            Refresh
          </button>
        </div>
      </div>

      {rpcMissing && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          State machine migration not applied yet — stage buttons are disabled.
        </div>
      )}
      {err && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          Failed to load: {err}
        </div>
      )}
      {toast && (
        <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search SO id / buyer / art name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, minWidth: 240 }}
        />
        <label style={{ fontSize: 13, color: '#334155', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={digitizingOnly} onChange={(e) => setDigitizingOnly(e.target.checked)} />
          Needs digitizing only
        </label>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Awaiting conversion {awaitingConversion.length > 0 && `(${awaitingConversion.length})`}
        </h2>
        {awaitingConversion.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8' }}>None — every paid order has been converted.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {awaitingConversion.map((o) => (
              <div key={o.id} style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{o.id}</span>
                <span style={{ fontSize: 13, color: '#334155' }}>{o.buyer_name || o.buyer_email || '—'}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtMoney(o.total)}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>{fmtAge(o.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Jobs</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {COLUMNS.map((col) => (
          <div key={col.key}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
              {col.label} ({jobsByColumn[col.key].length})
            </div>
            {jobsByColumn[col.key].length === 0 && (
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>No jobs</div>
            )}
            {jobsByColumn[col.key].map((job) => (
              <JobCard
                key={job.so_id + '/' + job.id}
                job={job}
                order={orderBySoId[job.so_id]}
                onAction={handleAction}
                onTicket={handleTicket}
                actionsDisabled={rpcMissing}
                actionBusy={actionBusy}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Settings — Team Shop money knobs a rep/manager can edit without an
// engineering ticket: the deco rate card (00198), per-customer School-PO
// eligibility (00200), and the flat shipping fee (webstores.flat_shipping,
// read by teamshop-checkout.js's shipFee(), same helper webstore-checkout.js
// uses). Each sub-section degrades independently if its migration hasn't
// landed on this DB yet — a missing table/column never blanks the page.

const NEW_RATE_ROW = { type: 'embroidery', option_key: 'standard', label: '', price: '', min_qty: 1 };

function RateCardSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [edits, setEdits] = useState({}); // id -> partial field overrides
  const [savingId, setSavingId] = useState(null);
  const [newRow, setNewRow] = useState(NEW_RATE_ROW);
  const [addBusy, setAddBusy] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setErr(null);
    return supabase
      .from('teamshop_deco_rates')
      .select('*')
      .order('family', { ascending: true })
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          if (isMissingRelation(error)) { setMissing(true); return; }
          setErr(error.message || String(error));
          return;
        }
        setMissing(false);
        setRows(data || []);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const fieldFor = (row, key) => {
    const e = edits[row.id];
    return e && Object.prototype.hasOwnProperty.call(e, key) ? e[key] : row[key];
  };

  const setField = (row, key, value) => {
    setEdits((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] || {}), [key]: value } }));
  };

  const isDirty = (row) => !!edits[row.id] && Object.keys(edits[row.id]).length > 0;

  const saveRow = (row, patchOverride) => {
    const patch = patchOverride || edits[row.id];
    if (!patch) return;
    const priceVal = Object.prototype.hasOwnProperty.call(patch, 'price') ? patch.price : row.price;
    const costRaw = Object.prototype.hasOwnProperty.call(patch, 'cost') ? patch.cost : row.cost;
    const minQtyVal = Object.prototype.hasOwnProperty.call(patch, 'min_qty') ? patch.min_qty : row.min_qty;
    const update = {
      label: Object.prototype.hasOwnProperty.call(patch, 'label') ? patch.label : row.label,
      price: Number(priceVal) || 0,
      cost: costRaw === '' || costRaw === null || costRaw === undefined ? null : Number(costRaw),
      min_qty: Math.max(1, parseInt(minQtyVal, 10) || 1),
      active: Object.prototype.hasOwnProperty.call(patch, 'active') ? patch.active : row.active,
    };
    setSavingId(row.id);
    // Optimistic update.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...update } : r)));
    supabase.from('teamshop_deco_rates').update(update).eq('id', row.id).then(({ error }) => {
      setSavingId(null);
      if (error) {
        showToast('Rate save failed: ' + (error.message || 'unknown error'));
        load();
        return;
      }
      setEdits((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
    });
  };

  const toggleActive = (row) => {
    // Active is a simple flip — save immediately. The merged patch is built
    // here and passed explicitly: waiting on setEdits and re-reading state
    // from this render's closure would see the pre-flip value (and skip the
    // save entirely when the row had no other pending edit).
    const patch = { ...(edits[row.id] || {}), active: !fieldFor(row, 'active') };
    setEdits((prev) => ({ ...prev, [row.id]: patch }));
    saveRow(row, patch);
  };

  const addOption = () => {
    const type = newRow.type;
    const family = familyForType(type);
    const price = Number(newRow.price) || 0;
    const min_qty = Math.max(1, parseInt(newRow.min_qty, 10) || 1);
    const insertRow = {
      family, type,
      option_key: (newRow.option_key || 'standard').trim() || 'standard',
      label: (newRow.label || '').trim(),
      price, min_qty,
      sort_order: rows.length,
      active: true,
    };
    if (!insertRow.label) { showToast('Add option: label is required'); return; }
    setAddBusy(true);
    supabase.from('teamshop_deco_rates').insert(insertRow).then(({ error }) => {
      setAddBusy(false);
      if (error) {
        showToast('Add option failed: ' + (error.message || 'unknown error'));
        return;
      }
      setNewRow(NEW_RATE_ROW);
      load();
    });
  };

  if (loading) return <div style={{ fontSize: 13, color: '#64748b' }}>Loading rate card…</div>;

  if (missing) {
    return (
      <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
        Rate card migration (00198) not applied yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Rate changes take effect on the next quote — carts re-quote automatically at checkout.
      </div>
      {err && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          Failed to load rates: {err}
        </div>
      )}
      {toast && (
        <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {toast}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={{ padding: '4px 8px' }}>Family</th>
              <th style={{ padding: '4px 8px' }}>Type / Option</th>
              <th style={{ padding: '4px 8px' }}>Label</th>
              <th style={{ padding: '4px 8px' }}>Price</th>
              <th style={{ padding: '4px 8px' }}>Cost</th>
              <th style={{ padding: '4px 8px' }}>Min qty</th>
              <th style={{ padding: '4px 8px' }}>Active</th>
              <th style={{ padding: '4px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const costVal = fieldFor(row, 'cost');
              const costEmpty = costVal === null || costVal === undefined || costVal === '';
              return (
                <tr key={row.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '4px 8px' }}>{row.family}</td>
                  <td style={{ padding: '4px 8px', color: '#64748b' }}>{row.type} / {row.option_key}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="text"
                      aria-label={'label-' + row.id}
                      value={fieldFor(row, 'label') || ''}
                      onChange={(e) => setField(row, 'label', e.target.value)}
                      style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 160 }}
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={'price-' + row.id}
                      value={fieldFor(row, 'price')}
                      onChange={(e) => setField(row, 'price', e.target.value)}
                      style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 80 }}
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={'cost-' + row.id}
                      value={costEmpty ? '' : costVal}
                      onChange={(e) => setField(row, 'cost', e.target.value)}
                      style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 80 }}
                    />
                    {costEmpty && <div style={{ fontSize: 10, color: '#94a3b8' }}>cost unset — GP will read 0</div>}
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      aria-label={'minqty-' + row.id}
                      value={fieldFor(row, 'min_qty')}
                      onChange={(e) => setField(row, 'min_qty', e.target.value)}
                      style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 60 }}
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      aria-label={'active-' + row.id}
                      checked={!!fieldFor(row, 'active')}
                      onChange={() => toggleActive(row)}
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <button
                      type="button"
                      aria-label={'save-rate-' + row.id}
                      disabled={!isDirty(row) || savingId === row.id}
                      onClick={() => saveRow(row)}
                      style={{
                        padding: '4px 10px', fontSize: 12, fontWeight: 700, borderRadius: 4, border: 'none',
                        background: isDirty(row) ? '#1d4ed8' : '#e2e8f0', color: isDirty(row) ? '#fff' : '#94a3b8',
                        cursor: isDirty(row) ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {savingId === row.id ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8, textTransform: 'uppercase' }}>Add option</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            aria-label="new-rate-type"
            value={newRow.type}
            onChange={(e) => setNewRow((r) => ({ ...r, type: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4 }}
          >
            {DECO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>family: {familyForType(newRow.type)}</span>
          <input
            type="text"
            aria-label="new-rate-option-key"
            placeholder="option_key (default: standard)"
            value={newRow.option_key}
            onChange={(e) => setNewRow((r) => ({ ...r, option_key: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 160 }}
          />
          <input
            type="text"
            aria-label="new-rate-label"
            placeholder="Label"
            value={newRow.label}
            onChange={(e) => setNewRow((r) => ({ ...r, label: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 160 }}
          />
          <input
            type="number"
            aria-label="new-rate-price"
            min="0"
            step="0.01"
            placeholder="Price"
            value={newRow.price}
            onChange={(e) => setNewRow((r) => ({ ...r, price: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 80 }}
          />
          <input
            type="number"
            aria-label="new-rate-minqty"
            min="1"
            step="1"
            placeholder="Min qty"
            value={newRow.min_qty}
            onChange={(e) => setNewRow((r) => ({ ...r, min_qty: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 70 }}
          />
          <button
            type="button"
            aria-label="add-rate-option-submit"
            disabled={addBusy}
            onClick={addOption}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {addBusy ? 'Adding…' : 'Add option'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PoEligibilitySection() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [toast, setToast] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // Proactive probe so the section hides itself before the migration if
  // teamshop_po_allowed doesn't exist yet, rather than waiting for a search.
  useEffect(() => {
    supabase.from('customers').select('id,name,teamshop_po_allowed').limit(1).then(({ error }) => {
      if (error && isMissingRelation(error)) setHidden(true);
    });
  }, []);

  const runSearch = useCallback((term) => {
    setLoading(true);
    supabase
      .from('customers')
      .select('id,name,teamshop_po_allowed')
      .ilike('name', '%' + term + '%')
      .limit(20)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          if (isMissingRelation(error)) { setHidden(true); return; }
          showToast('Search failed: ' + (error.message || 'unknown error'));
          return;
        }
        setResults(data || []);
      });
  }, []);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    runSearch(q.trim());
  }, [q, runSearch]);

  const toggle = (row) => {
    const next = !row.teamshop_po_allowed;
    setSavingId(row.id);
    setResults((prev) => prev.map((r) => (r.id === row.id ? { ...r, teamshop_po_allowed: next } : r)));
    supabase.from('customers').update({ teamshop_po_allowed: next }).eq('id', row.id).then(({ error }) => {
      setSavingId(null);
      if (error) {
        showToast('Update failed: ' + (error.message || 'unknown error'));
        setResults((prev) => prev.map((r) => (r.id === row.id ? { ...r, teamshop_po_allowed: !next } : r)));
      }
    });
  };

  if (hidden) {
    return (
      <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
        School-PO eligibility migration (00200) not applied yet — this section is hidden.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Programs allowed to check out with a School PO.
      </div>
      {toast && (
        <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {toast}
        </div>
      )}
      <input
        type="text"
        placeholder="Search customer / program name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, minWidth: 260, marginBottom: 10 }}
      />
      {loading && <div style={{ fontSize: 12, color: '#94a3b8' }}>Searching…</div>}
      {!loading && q.trim() && results.length === 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8' }}>No matches.</div>
      )}
      {results.map((row) => (
        <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: 13 }}>{row.name}</span>
          <label style={{ fontSize: 12, color: '#334155', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              aria-label={'po-allowed-' + row.id}
              checked={!!row.teamshop_po_allowed}
              disabled={savingId === row.id}
              onChange={() => toggle(row)}
            />
            PO allowed
          </label>
        </div>
      ))}
    </div>
  );
}

function ShippingSection() {
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    supabase
      .from('webstores')
      .select('id,flat_shipping')
      .eq('slug', TEAMSHOP_STORE_SLUG)
      .maybeSingle()
      .then(({ data, error }) => {
        setLoading(false);
        if (error || !data) { setHidden(true); return; }
        setStore(data);
        setValue(String(data.flat_shipping != null ? data.flat_shipping : 0));
      });
  }, []);

  const save = () => {
    if (!store) return;
    const flat_shipping = Number(value) || 0;
    setSaving(true);
    supabase.from('webstores').update({ flat_shipping }).eq('id', store.id).then(({ error }) => {
      setSaving(false);
      if (error) {
        showToast('Save failed: ' + (error.message || 'unknown error'));
        return;
      }
      setStore((s) => ({ ...s, flat_shipping }));
      showToast('Shipping fee saved');
    });
  };

  if (loading) return <div style={{ fontSize: 13, color: '#64748b' }}>Loading shipping…</div>;

  if (hidden) {
    return (
      <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
        Team Shop store row (nationalteamshop, 00195) not found — shipping fee is hidden.
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {toast}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <label style={{ fontSize: 13, color: '#334155' }}>Flat shipping fee ($)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          aria-label="flat-shipping"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, width: 100 }}
        />
        <button
          type="button"
          disabled={saving}
          onClick={save}
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>(applies to new quotes immediately)</span>
      </div>
    </div>
  );
}

function TeamShopSettings() {
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#f8fafc', minHeight: '100vh', padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 16px' }}>Team Shop — Settings</h1>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>Deco rate card</h2>
        <RateCardSection />
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>School PO eligibility</h2>
        <PoEligibilitySection />
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>Shipping</h2>
        <ShippingSection />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PO review — pending School-PO orders (place_order_po in teamshop-checkout:
// order_source='teamshop', status='unpaid', po_number set). All reads/writes
// go through netlify/functions/teamshop-po-review.js with the staff JWT — the
// PDF lives in the PRIVATE po-docs bucket and only that function (service
// role) can mint the short-lived signed URL. Approve flips the order to
// 'po_verified' and converts it through create_teamshop_sales_order (00199's
// open-invoice branch); Reject records a reason, cancels the order, and
// emails the coach. Degrades gracefully pre-00201: the function reports
// enabled:false and this section shows a banner, never a blank page.
function PoReviewSection() {
  const [state, setState] = useState({ loading: true, enabled: true, orders: [], error: null });
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null); // order id with the reason form open
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const callFn = useCallback(async (payload) => {
    const { data } = await supabase.auth.getSession();
    const token = data && data.session && data.session.access_token;
    const res = await fetch('/.netlify/functions/teamshop-po-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json };
  }, []);

  const load = useCallback(() => {
    callFn({ action: 'list' })
      .then((r) => {
        if (r.error) { setState({ loading: false, enabled: true, orders: [], error: r.error }); return; }
        setState({ loading: false, enabled: r.enabled !== false, orders: r.orders || [], error: null });
      })
      .catch((e) => setState({ loading: false, enabled: true, orders: [], error: e.message || String(e) }));
  }, [callFn]);

  useEffect(() => { load(); }, [load]);

  const approve = (order) => {
    setBusyId(order.id);
    callFn({ action: 'approve', order_id: order.id }).then((r) => {
      setBusyId(null);
      if (r.error) { showToast('Approve failed: ' + r.error); load(); return; }
      showToast('PO approved — production order ' + (r.so_id || 'created'));
      load();
    });
  };

  const confirmReject = (order) => {
    const why = reason.trim();
    if (!why) { showToast('A rejection reason is required'); return; }
    setBusyId(order.id);
    callFn({ action: 'reject', order_id: order.id, reason: why }).then((r) => {
      setBusyId(null);
      if (r.error) { showToast('Reject failed: ' + r.error); load(); return; }
      showToast(r.emailed ? 'PO rejected — coach emailed' : 'PO rejected — reason recorded (email not sent)');
      setRejecting(null); setReason('');
      load();
    });
  };

  if (state.loading) return <div style={{ fontSize: 13, color: '#64748b', padding: 20 }}>Loading PO queue…</div>;

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#f8fafc', minHeight: '100vh', padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 16px' }}>Team Shop — PO review</h1>
      {!state.enabled && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
          School-PO checkout migration (00201) not applied yet — nothing to review.
        </div>
      )}
      {state.error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          Failed to load: {state.error}
        </div>
      )}
      {toast && (
        <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          {toast}
        </div>
      )}
      {state.enabled && !state.error && state.orders.length === 0 && (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>No purchase orders awaiting review.</div>
      )}
      {state.orders.map((o) => (
        <div key={o.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>#{o.order_number || String(o.id).slice(0, 8)}</span>
            <span style={{ fontSize: 13, color: '#334155' }}>{o.customer_name || '—'}</span>
            <span style={{ fontSize: 13, color: '#334155' }}>{o.coach_name || '—'}</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtMoney(o.total)}</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>{fmtAge(o.created_at)}</span>
          </div>
          <div style={{ fontSize: 13, color: '#0f172a', marginTop: 6 }}>
            PO #<b>{o.po_number}</b>
            {o.pdf_url ? (
              <a href={o.pdf_url} target="_blank" rel="noreferrer" style={{ marginLeft: 12, color: '#1d4ed8', fontWeight: 700 }}>View PDF</a>
            ) : (
              <span style={{ marginLeft: 12, color: '#94a3b8' }}>PDF unavailable</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              aria-label={'approve-po-' + o.id}
              disabled={busyId === o.id}
              onClick={() => approve(o)}
              style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#15803d', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              {busyId === o.id ? 'Working…' : 'Approve'}
            </button>
            {rejecting === o.id ? (
              <>
                <input
                  type="text"
                  aria-label={'reject-reason-' + o.id}
                  placeholder="Reason (sent to the coach)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 6, minWidth: 240 }}
                />
                <button
                  type="button"
                  aria-label={'confirm-reject-po-' + o.id}
                  disabled={busyId === o.id || !reason.trim()}
                  onClick={() => confirmReject(o)}
                  style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  Confirm reject
                </button>
                <button type="button" onClick={() => { setRejecting(null); setReason(''); }} style={{ padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={'reject-po-' + o.id}
                disabled={busyId === o.id}
                onClick={() => { setRejecting(o.id); setReason(''); }}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#fff', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer' }}
              >
                Reject
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Auto POs — DRAFT supplier purchase orders the auto-PO engine (00202 +
// netlify/functions/teamshop-auto-po.js) generated from converted Team Shop
// orders. Auto-SUBMIT is off: nothing is sent to a supplier from here — staff
// key/send the order themselves and click "Mark submitted" (records who/when
// via the service role; 00193 gives clients no write path). All money shown
// is server-stored integer cents (00193) — this section only formats it.
// Degrades gracefully pre-00193/00202: the function reports enabled:false and
// this section shows a banner, never a blank page.
const fmtCents = (c) => '$' + ((Number(c) || 0) / 100).toFixed(2);

function AutoPoSection() {
  const [state, setState] = useState({ loading: true, enabled: true, pos: [], unmapped: [], error: null });
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const callFn = useCallback(async (payload) => {
    const { data } = await supabase.auth.getSession();
    const token = data && data.session && data.session.access_token;
    const res = await fetch('/.netlify/functions/teamshop-auto-po', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json };
  }, []);

  const load = useCallback(() => {
    callFn({ action: 'list' })
      .then((r) => {
        if (r.error) { setState({ loading: false, enabled: true, pos: [], unmapped: [], error: r.error }); return; }
        setState({ loading: false, enabled: r.enabled !== false, pos: r.pos || [], unmapped: r.unmapped || [], error: null });
      })
      .catch((e) => setState({ loading: false, enabled: true, pos: [], unmapped: [], error: e.message || String(e) }));
  }, [callFn]);

  useEffect(() => { load(); }, [load]);

  const markSubmitted = (po) => {
    setBusyId(po.id);
    callFn({ action: 'mark_submitted', po_id: po.id }).then((r) => {
      setBusyId(null);
      if (r.error) { showToast('Mark submitted failed: ' + r.error); load(); return; }
      showToast('PO ' + (po.po_number || '') + ' marked submitted');
      load();
    });
  };

  const runSweep = () => {
    setBusyId('sweep');
    callFn({ action: 'sweep' }).then((r) => {
      setBusyId(null);
      if (r.error) { showToast('Sweep failed: ' + r.error); return; }
      const n = (r.swept || []).length;
      showToast(n ? 'Sweep evaluated ' + n + ' order' + (n === 1 ? '' : 's') : 'Sweep: nothing pending');
      load();
    });
  };

  if (state.loading) return <div style={{ fontSize: 13, color: '#64748b', padding: 20 }}>Loading auto POs…</div>;

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', background: '#f8fafc', minHeight: '100vh', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>Team Shop — Auto POs</h1>
        {state.enabled && (
          <button
            type="button"
            aria-label="auto-po-sweep"
            disabled={busyId === 'sweep'}
            onClick={runSweep}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {busyId === 'sweep' ? 'Sweeping…' : 'Sweep unevaluated orders'}
          </button>
        )}
      </div>
      {!state.enabled && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
          Auto-PO migration (00202) not applied yet — nothing to review.
        </div>
      )}
      {state.error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          Failed to load: {state.error}
        </div>
      )}
      {toast && (
        <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          {toast}
        </div>
      )}
      {state.enabled && !state.error && state.pos.length === 0 && (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>No auto-generated purchase orders yet.</div>
      )}
      {state.pos.map((po) => (
        <div key={po.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{po.po_number || String(po.id).slice(0, 8)}</span>
            <span style={{ fontSize: 13, color: '#334155' }}>{po.vendor || '—'}</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtCents(po.totals_cents)}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: po.status === 'draft' ? '#fef3c7' : po.status === 'created' ? '#dcfce7' : '#fee2e2',
              color: po.status === 'draft' ? '#92400e' : po.status === 'created' ? '#166534' : '#991b1b',
            }}>
              {po.status === 'created' ? 'submitted' : po.status}
            </span>
            <span style={{ fontSize: 12, color: '#64748b' }}>{fmtAge(po.created_at)}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#475569', fontSize: 10, textTransform: 'uppercase' }}>
                  <th style={{ padding: '2px 8px' }}>SO</th>
                  <th style={{ padding: '2px 8px' }}>SKU</th>
                  <th style={{ padding: '2px 8px' }}>Size</th>
                  <th style={{ padding: '2px 8px' }}>Qty</th>
                  <th style={{ padding: '2px 8px' }}>Unit cost</th>
                </tr>
              </thead>
              <tbody>
                {(po.lines || []).map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '2px 8px', color: '#64748b' }}>{l.so_id || '—'}</td>
                    <td style={{ padding: '2px 8px' }}>{l.sku || '—'}</td>
                    <td style={{ padding: '2px 8px' }}>{l.size || '—'}</td>
                    <td style={{ padding: '2px 8px', fontWeight: 700 }}>{l.qty}</td>
                    <td style={{ padding: '2px 8px' }}>{fmtCents(l.unit_cost_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {po.status === 'draft' ? (
              <button
                type="button"
                aria-label={'mark-submitted-' + po.id}
                disabled={busyId === po.id}
                onClick={() => markSubmitted(po)}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#15803d', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                {busyId === po.id ? 'Working…' : 'Mark submitted'}
              </button>
            ) : po.submitted_at ? (
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Submitted {fmtAge(po.submitted_at)}{po.submitted_by ? ' by ' + po.submitted_by : ''}
              </span>
            ) : null}
          </div>
        </div>
      ))}
      {state.enabled && state.unmapped.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Needs manual ordering ({state.unmapped.length})
          </h2>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            Lines with no supplier mapping (custom items, or vendors not wired for auto-PO) — order these by hand.
          </div>
          {state.unmapped.map((n, i) => (
            <div key={n.so_id + '/' + (n.sku || '') + '/' + (n.size || '') + '/' + i} style={{ display: 'flex', gap: 12, padding: '6px 10px', borderBottom: '1px solid #e2e8f0', fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: '#64748b' }}>{n.so_id}</span>
              <span style={{ fontWeight: 600 }}>{n.sku || '—'}</span>
              <span>{n.size}</span>
              <span style={{ fontWeight: 700 }}>× {n.qty_needed}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamShopQueueTabs({ email }) {
  const [tab, setTab] = useState('queue');

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        padding: '6px 14px', fontSize: 13, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
        border: tab === key ? '1px solid #1d4ed8' : '1px solid #cbd5e1',
        background: tab === key ? '#1d4ed8' : '#fff',
        color: tab === key ? '#fff' : '#334155',
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px 0', background: '#f8fafc' }}>
        {tabBtn('queue', 'Queue')}
        {tabBtn('po', 'PO review')}
        {tabBtn('autopo', 'Auto POs')}
        {tabBtn('settings', 'Settings')}
      </div>
      {tab === 'queue' ? <TeamShopQueueBoard email={email} />
        : tab === 'po' ? <PoReviewSection />
        : tab === 'autopo' ? <AutoPoSection />
        : <TeamShopSettings />}
    </div>
  );
}

export default function TeamShopQueue() {
  const { loading, signedIn, email } = useStaffSession();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', color: '#64748b' }}>
        Loading…
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#334155', fontSize: 15, marginBottom: 12 }}>Sign in to Connect first.</p>
          <a href="/" style={{ color: '#1d4ed8', fontWeight: 700 }}>Go to sign in</a>
        </div>
      </div>
    );
  }

  return <TeamShopQueueTabs email={email} />;
}
