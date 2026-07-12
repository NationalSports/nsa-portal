import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStaffSession } from '../lib/useStaffSession';
import { fetchTicketArts, openTicket } from './ticket';

// Production HQ (formerly "Team Shop — Fast Turn Queue"). A staff-only lazy
// chunk, routed at /teamshop-queue (and, as of this pass, the alias /production
// — see src/index.js / src/lib/hostRouting.js isProductionHQPath) by
// src/index.js. This is the unified staff production-ops surface for Team
// Shop orders (webstore_orders.order_source='teamshop', see 00195 / 00196;
// the Pipeline tab also folds in 'club', see fetchPipeline) — a small,
// separate view from the main warehouse jobs board in App.js, which this
// chunk does not touch or import.
//
// Three top-level tabs (TeamShopQueueTabs, bottom of file):
//   Pipeline           — order-centric: every teamshop/club order with stage
//                         chips (Paid/Converted/Art/Goods/Floor/Shipped) plus
//                         the stuck-state action panels (awaiting-conversion +
//                         Retry, PO review, auto-PO drafts, unmapped lines)
//                         folded in as ACTIONS, and a manual "Run sweep now"
//                         (teamshop-stuck-sweep). See PipelineTab.
//   Production & Pull  — job-centric: the original Kanban queue board
//                         (TeamShopQueueBoard, unchanged behavior/tests) plus
//                         the 00205 release-gate override dialog and a
//                         per-job job_stage_events history drawer.
//   Settings            — every staff-editable Team Shop knob in one tab:
//                         deco rate card, delivery timelines, School-PO
//                         eligibility, shipping, plus two additions this pass
//                         — Auto-PO vendors (teamshop_auto_po_settings CRUD)
//                         and Automation (teamshop_settings auto-release
//                         toggle/scope, 00208).
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
// Stage moves go through the advance_job_stage RPC (00192/00205) exclusively
// — this chunk never writes prod_status directly, anywhere, including the new
// override path (Production & Pull's dialog still calls the same RPC with
// p_override:true — see handleOverrideConfirm). If the migration hasn't been
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

// 00205's release gate: a 'release' from hold with unfinished art or stock
// still on order raises NSA_NOT_READY:art=<art_status>,item=<item_status>.
// Parsed so the override dialog can show the actual state, not just the raw
// Postgres error text.
const parseNotReady = (msg) => {
  const m = /NSA_NOT_READY:art=([^,]*),item=(.*)$/.exec(msg || '');
  return m ? { art: m[1], item: m[2] } : null;
};

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

// ─────────────────────────────────────────────────────────────────────────
// Pipeline tab data — every teamshop/club order (not just paid/batched, the
// Kanban board's narrower slice) plus their so_jobs, for the Paid → Converted
// → Art → Goods → Floor → Shipped stage chips. Deliberately reuses fetchQueue's
// exact shape (select/in/order, then a soIds-keyed sales_orders + so_jobs
// fetch) rather than adding .neq/.limit to the query — that keeps this call
// compatible with every existing test's minimal supabase mock, and cancelled
// orders are few enough to filter client-side without real cost.
async function fetchPipeline() {
  const { data: orders, error: ordersErr } = await supabase
    .from('webstore_orders')
    .select('*')
    .in('order_source', ['teamshop', 'club'])
    .order('created_at', { ascending: false });
  if (ordersErr) throw ordersErr;
  const active = (orders || []).filter((o) => o.status !== 'cancelled');

  const soIds = [...new Set(active.map((o) => o.so_id).filter(Boolean))];
  const [soRes, jobsRes] = await Promise.all([
    soIds.length
      ? supabase.from('sales_orders').select('*').in('id', soIds)
      : Promise.resolve({ data: [], error: null }),
    soIds.length
      ? supabase.from('so_jobs').select('*').in('so_id', soIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (soRes.error) throw soRes.error;
  if (jobsRes.error) throw jobsRes.error;

  return { orders: active, salesOrders: soRes.data || [], jobs: jobsRes.data || [] };
}

const PIPELINE_STAGES = [
  ['paid', 'Paid'], ['converted', 'Converted'], ['art', 'Art'],
  ['goods', 'Goods'], ['floor', 'Floor'], ['shipped', 'Shipped'],
];

// Each flag is independently derived from data the board already fetches —
// no extra joins. "Shipped" is an honest proxy (every job packed_at set), not
// a true carrier-shipped signal: webstore_orders carries no top-level shipped
// status (shipstation-webhook.js marks ship state per LINE on
// webstore_order_items.line_status, a join this cheap query skips on purpose
// — see the file header's efficiency note).
function computeStageFlags(order, jobs) {
  const paid = !['pending_payment', 'unpaid'].includes(order.status);
  const converted = !!order.so_id;
  const hasJobs = jobs.length > 0;
  const art = converted && hasJobs && jobs.every((j) => j.art_status === 'art_complete');
  const goods = converted && hasJobs && jobs.every((j) => !!j.item_status && j.item_status !== 'need_to_order');
  const floor = converted && hasJobs && jobs.every((j) => ['staging', 'in_process', 'completed'].includes(normProdStatus(j.prod_status)));
  const shipped = converted && hasJobs && jobs.every((j) => !!j.packed_at);
  return { paid, converted, art, goods, floor, shipped };
}

function StageChips({ flags }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {PIPELINE_STAGES.map(([key, label]) => (
        <span key={key} style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: flags[key] ? '#dcfce7' : '#f1f5f9',
          color: flags[key] ? '#166534' : '#94a3b8',
        }}>{label}</span>
      ))}
    </div>
  );
}

// Awaiting-conversion + Retry — shared by the Production & Pull queue board
// (unchanged placement/behavior) and the Pipeline tab's Actions fold, so the
// retry-convert mechanics (netlify/functions/teamshop-retry-convert.js) live
// in exactly one place. `orders` is caller-filtered (status='paid', no so_id);
// `onConverted` is called after a successful convert so the caller can refetch.
function AwaitingConversionPanel({ orders, onConverted }) {
  const [retryState, setRetryState] = useState({});

  const handleRetryConvert = useCallback((order) => {
    setRetryState((s) => ({ ...s, [order.id]: { busy: true, message: null, ok: null } }));
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data && data.session && data.session.access_token;
      let r;
      try {
        const res = await fetch('/.netlify/functions/teamshop-retry-convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
          body: JSON.stringify({ order_id: order.id }),
        });
        r = await res.json().catch(() => ({}));
      } catch (e) {
        r = { error: e.message || String(e) };
      }
      if (r.error) {
        setRetryState((s) => ({ ...s, [order.id]: { busy: false, message: r.error, ok: false } }));
        return;
      }
      setRetryState((s) => ({ ...s, [order.id]: { busy: false, message: r.replayed ? 'Already converted' : ('Converted — ' + (r.so_id || '')), ok: true } }));
      if (onConverted) onConverted();
    })();
  }, [onConverted]);

  return (
    <div>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Awaiting conversion {orders.length > 0 && `(${orders.length})`}
      </h2>
      {orders.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>None — every paid order has been converted.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orders.map((o) => {
            const rs = retryState[o.id];
            return (
              <div key={o.id} style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{o.id}</span>
                <span style={{ fontSize: 13, color: '#334155' }}>{o.buyer_name || o.buyer_email || '—'}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtMoney(o.total)}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>{fmtAge(o.created_at)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {rs && rs.message && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: rs.ok ? '#166534' : '#991b1b' }}>{rs.message}</span>
                  )}
                  <button
                    type="button"
                    aria-label={'retry-convert-' + o.id}
                    disabled={!!(rs && rs.busy)}
                    onClick={() => handleRetryConvert(o)}
                    style={{
                      padding: '6px 12px', fontSize: 12, fontWeight: 700,
                      background: (rs && rs.busy) ? '#e2e8f0' : '#1d4ed8', color: (rs && rs.busy) ? '#94a3b8' : '#fff',
                      border: 'none', borderRadius: 6, cursor: (rs && rs.busy) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {(rs && rs.busy) ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Job stage-history drawer (deliverable B) — fetches job_stage_events lazily
// on first expand (staff SELECT only, 00192; never fetched for jobs nobody
// expands, so the board's own fetchQueue interval stays cheap). Shows the
// auditable trail including auto_release/override events (00205/00208's
// payload.override + payload.reason land here verbatim).
function JobHistory({ job }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && events === null) {
      setLoading(true);
      supabase.from('job_stage_events').select('*')
        .eq('so_id', job.so_id).eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .then(({ data, error }) => { setLoading(false); setEvents(error ? [] : (data || [])); });
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        aria-label={'history-' + job.id}
        onClick={toggle}
        style={{ padding: '2px 8px', fontSize: 11, background: 'none', border: '1px solid #cbd5e1', borderRadius: 4, color: '#475569', cursor: 'pointer' }}
      >
        {open ? 'Hide history' : 'History'}
      </button>
      {open && (
        <div style={{ marginTop: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, fontSize: 11 }}>
          {loading && <div style={{ color: '#94a3b8' }}>Loading…</div>}
          {!loading && events && events.length === 0 && <div style={{ color: '#94a3b8' }}>No events recorded.</div>}
          {!loading && events && events.map((e) => (
            <div key={e.id} style={{ padding: '3px 0', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontWeight: 700 }}>{e.event}</span>{' '}
              <span style={{ color: '#64748b' }}>{e.actor || 'system'} · {e.created_at || ''}</span>
              {e.payload && e.payload.override && (
                <span style={{ marginLeft: 6, color: '#b91c1c', fontWeight: 700 }}>
                  override{e.payload.reason ? ': ' + e.payload.reason : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, order, onAction, onTicket, actionsDisabled, actionBusy }) {
  const status = normProdStatus(job.prod_status);
  const buyer = order ? (order.buyer_name || order.buyer_email || '') : '';
  const busy = actionBusy === job.id;
  // Deliverable B: next to a hold job, show WHY it can't release yet — the
  // same art_status/item_status the 00205 release gate reads server-side.
  const notReady = status === 'hold' && (job.art_status !== 'art_complete' || job.item_status === 'need_to_order');

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
        <span style={{ background: '#f1f5f9', color: '#334155', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4 }}>
          item: {job.item_status || 'need_to_order'}
        </span>
        {job.packed_at && (
          <span style={{ background: '#dcfce7', color: '#166534', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4 }}>
            packed
          </span>
        )}
      </div>
      {notReady && (
        <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
          Can't release yet — art: {job.art_status || 'needs_art'}, item: {job.item_status || 'need_to_order'}
        </div>
      )}
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
      <JobHistory job={job} />
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
  // 00205 override dialog: { job, expected, art, item } when a release hit
  // NSA_NOT_READY, else null. Confirming re-calls advance_job_stage with
  // p_override:true, p_reason — the readiness gate's staff escape hatch.
  const [overrideDialog, setOverrideDialog] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);
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
        const notReady = event === 'release' ? parseNotReady(error.message) : null;
        if (isFunctionMissing(error)) {
          setRpcMissing(true);
          showToast('State machine migration not applied yet');
        } else if (isStaleState(error)) {
          showToast('Job moved by someone else — refreshed');
        } else if (notReady) {
          // 00205 release gate: show the real dialog (art/item state + an
          // Override + reason field) instead of a generic failure toast.
          setOverrideDialog({ job, expected, art: notReady.art, item: notReady.item });
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

  // Override & release (00205): re-calls advance_job_stage for the SAME job
  // with p_override:true, p_reason — never a direct so_jobs write. The
  // resulting job_stage_events row carries {override:true, reason} for the
  // audit trail (readable via JobHistory above).
  const handleOverrideConfirm = useCallback(() => {
    if (!overrideDialog) return;
    const { job, expected } = overrideDialog;
    setOverrideBusy(true);
    supabase.rpc('advance_job_stage', {
      p_so_id: job.so_id,
      p_job_id: job.id,
      p_event: 'release',
      p_actor: email || '',
      p_expected: expected,
      p_override: true,
      p_reason: overrideReason,
    }).then(({ error }) => {
      setOverrideBusy(false);
      if (error) {
        showToast('Override release failed: ' + (error.message || 'unknown error'));
        return;
      }
      showToast('Released with override');
      setOverrideDialog(null);
      setOverrideReason('');
      refetch();
    }).catch((e) => {
      setOverrideBusy(false);
      showToast('Override release failed: ' + (e.message || String(e)));
    });
  }, [overrideDialog, overrideReason, email, refetch]);

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
        <AwaitingConversionPanel orders={awaitingConversion} onConverted={refetch} />
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

      {overrideDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 20, maxWidth: 420, width: '90%' }}>
            <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Job isn't release-ready</h3>
            <div style={{ fontSize: 13, color: '#334155', marginBottom: 10 }}>
              Job <b>{overrideDialog.job.id}</b> — art status <b>{overrideDialog.art}</b>, item status <b>{overrideDialog.item}</b>.
              Releasing anyway skips the readiness gate and is recorded on the job's audit trail.
            </div>
            <textarea
              aria-label="override-reason"
              placeholder="Reason (required, staff-audited)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              style={{ width: '100%', minHeight: 60, padding: 8, fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setOverrideDialog(null); setOverrideReason(''); }}
                style={{ padding: '6px 14px', fontSize: 12, background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label="confirm-override-release"
                disabled={overrideBusy || !overrideReason.trim()}
                onClick={handleOverrideConfirm}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 700,
                  background: overrideReason.trim() ? '#b91c1c' : '#e2e8f0', color: overrideReason.trim() ? '#fff' : '#94a3b8',
                  border: 'none', borderRadius: 6, cursor: overrideReason.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                {overrideBusy ? 'Releasing…' : 'Override & release'}
              </button>
            </div>
          </div>
        </div>
      )}
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

// Delivery timelines (00203) — the staff-editable "Ships in ~X weeks" bands
// the storefront product page / cart / checkout display. Rules are rows:
// in-stock, per-source bands, and deco overrides (applied as max() — a deco
// override never SHORTENS an estimate). Staff edit min/max weeks, the label
// shown verbatim to shoppers, and active per row; the rule itself (which
// sources / which deco) is shown read-only. Same interaction style as
// RateCardSection, including the explicit-patch save on the Active toggle
// (the stale-closure fix from 8dbfda3 — never re-read edits after setEdits).
const timelineRuleDesc = (row) => {
  if (row.rule_type === 'in_stock') return 'NSA warehouse — full line in stock';
  if (row.rule_type === 'deco') return `Decoration override — ${row.deco_type || '?'} (never shortens; longer band wins)`;
  return `Blanks from: ${(row.inventory_sources || []).join(', ') || '(no sources)'}`;
};

function DeliveryTimelineSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [edits, setEdits] = useState({}); // id -> partial field overrides
  const [savingId, setSavingId] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setErr(null);
    return supabase
      .from('teamshop_delivery_timelines')
      .select('*')
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
    const minRaw = Object.prototype.hasOwnProperty.call(patch, 'min_weeks') ? patch.min_weeks : row.min_weeks;
    const maxRaw = Object.prototype.hasOwnProperty.call(patch, 'max_weeks') ? patch.max_weeks : row.max_weeks;
    const update = {
      label: Object.prototype.hasOwnProperty.call(patch, 'label') ? patch.label : row.label,
      min_weeks: Number(minRaw) || 0,
      max_weeks: Number(maxRaw) || 0,
      active: Object.prototype.hasOwnProperty.call(patch, 'active') ? patch.active : row.active,
    };
    if (!String(update.label || '').trim()) { showToast('Timeline save: label is required'); return; }
    if (update.max_weeks < update.min_weeks) { showToast('Timeline save: max weeks must be ≥ min weeks'); return; }
    setSavingId(row.id);
    // Optimistic update.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...update } : r)));
    supabase.from('teamshop_delivery_timelines').update(update).eq('id', row.id).then(({ error }) => {
      setSavingId(null);
      if (error) {
        showToast('Timeline save failed: ' + (error.message || 'unknown error'));
        load();
        return;
      }
      setEdits((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
    });
  };

  const toggleActive = (row) => {
    // Active is a simple flip — save immediately. The merged patch is built
    // here and passed explicitly (the 8dbfda3 rule): waiting on setEdits and
    // re-reading state from this render's closure would see the pre-flip
    // value and skip the save when the row had no other pending edit.
    const patch = { ...(edits[row.id] || {}), active: !fieldFor(row, 'active') };
    setEdits((prev) => ({ ...prev, [row.id]: patch }));
    saveRow(row, patch);
  };

  if (loading) return <div style={{ fontSize: 13, color: '#64748b' }}>Loading delivery timelines…</div>;

  if (missing) {
    return (
      <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
        Delivery timelines migration (00203) not applied yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        The delivery estimates shoppers see on the product page, cart, and checkout.
        Changes take effect within a minute. Estimates resolve: warehouse in-stock → blank source → decoration override (longer band wins).
      </div>
      {err && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          Failed to load delivery timelines: {err}
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
              <th style={{ padding: '4px 8px' }}>Rule</th>
              <th style={{ padding: '4px 8px' }}>Label shown</th>
              <th style={{ padding: '4px 8px' }}>Min weeks</th>
              <th style={{ padding: '4px 8px' }}>Max weeks</th>
              <th style={{ padding: '4px 8px' }}>Active</th>
              <th style={{ padding: '4px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: '4px 8px' }}>
                  <div>{timelineRuleDesc(row)}</div>
                  {row.notes && <div style={{ fontSize: 11, color: '#94a3b8' }}>{row.notes}</div>}
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input
                    type="text"
                    aria-label={'tl-label-' + row.id}
                    value={fieldFor(row, 'label') || ''}
                    onChange={(e) => setField(row, 'label', e.target.value)}
                    style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 130 }}
                  />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    aria-label={'tl-min-' + row.id}
                    value={fieldFor(row, 'min_weeks')}
                    onChange={(e) => setField(row, 'min_weeks', e.target.value)}
                    style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 70 }}
                  />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    aria-label={'tl-max-' + row.id}
                    value={fieldFor(row, 'max_weeks')}
                    onChange={(e) => setField(row, 'max_weeks', e.target.value)}
                    style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 70 }}
                  />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input
                    type="checkbox"
                    aria-label={'tl-active-' + row.id}
                    checked={!!fieldFor(row, 'active')}
                    onChange={() => toggleActive(row)}
                  />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <button
                    type="button"
                    aria-label={'save-tl-' + row.id}
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
            ))}
          </tbody>
        </table>
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

// Auto-PO vendors (new this pass) — full CRUD over teamshop_auto_po_settings
// (00202): vendor, inventory_sources (comma-separated text[] editor), contact
// email, auto-submit toggle, min order. Direct client read/insert/update,
// staff-gated by that table's own RLS (is_team_member()) — the same posture
// RateCardSection uses for teamshop_deco_rates, not a netlify function. No
// DELETE, by 00202's own design: disable a vendor by clearing its sources and
// turning auto-submit off.
const NEW_VENDOR_ROW = { vendor: '', inventory_sources: '', contact_email: '', min_order: '', auto_submit_enabled: false };

function AutoPoVendorsSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [edits, setEdits] = useState({}); // vendor -> partial field overrides
  const [savingVendor, setSavingVendor] = useState(null);
  const [newRow, setNewRow] = useState(NEW_VENDOR_ROW);
  const [addBusy, setAddBusy] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setErr(null);
    return supabase
      .from('teamshop_auto_po_settings')
      .select('*')
      .order('vendor', { ascending: true })
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
    const e = edits[row.vendor];
    return e && Object.prototype.hasOwnProperty.call(e, key) ? e[key] : row[key];
  };

  const setField = (row, key, value) => {
    setEdits((prev) => ({ ...prev, [row.vendor]: { ...(prev[row.vendor] || {}), [key]: value } }));
  };

  const isDirty = (row) => !!edits[row.vendor] && Object.keys(edits[row.vendor]).length > 0;

  const saveRow = (row, patchOverride) => {
    const patch = patchOverride || edits[row.vendor];
    if (!patch) return;
    const sourcesVal = Object.prototype.hasOwnProperty.call(patch, 'inventory_sources') ? patch.inventory_sources : row.inventory_sources;
    const sourcesArr = Array.isArray(sourcesVal) ? sourcesVal : String(sourcesVal || '').split(',').map((s) => s.trim()).filter(Boolean);
    const emailVal = Object.prototype.hasOwnProperty.call(patch, 'contact_email') ? patch.contact_email : row.contact_email;
    const minVal = Object.prototype.hasOwnProperty.call(patch, 'min_order')
      ? patch.min_order
      : (row.min_order_cents != null ? row.min_order_cents / 100 : '');
    const update = {
      inventory_sources: sourcesArr,
      contact_email: String(emailVal || '').trim() || null,
      auto_submit_enabled: Object.prototype.hasOwnProperty.call(patch, 'auto_submit_enabled') ? patch.auto_submit_enabled : row.auto_submit_enabled,
      min_order_cents: minVal === '' || minVal === null || minVal === undefined ? null : Math.round((Number(minVal) || 0) * 100),
    };
    // DTF lane (deco_type='dtf', 00211): the gates are threshold_qty (prints) and
    // max_age_days (backstop) instead of inventory_sources. Blank clears the gate
    // (null = off) — that's how a DTF vendor stays inert.
    if (row.deco_type === 'dtf') {
      const thVal = Object.prototype.hasOwnProperty.call(patch, 'threshold_qty') ? patch.threshold_qty : row.threshold_qty;
      const ageVal = Object.prototype.hasOwnProperty.call(patch, 'max_age_days') ? patch.max_age_days : row.max_age_days;
      update.threshold_qty = thVal === '' || thVal === null || thVal === undefined ? null : Math.max(0, Math.round(Number(thVal) || 0));
      update.max_age_days = ageVal === '' || ageVal === null || ageVal === undefined ? null : Math.max(0, Math.round(Number(ageVal) || 0));
    }
    setSavingVendor(row.vendor);
    setRows((prev) => prev.map((r) => (r.vendor === row.vendor ? { ...r, ...update } : r)));
    supabase.from('teamshop_auto_po_settings').update(update).eq('vendor', row.vendor).then(({ error }) => {
      setSavingVendor(null);
      if (error) {
        showToast('Vendor save failed: ' + (error.message || 'unknown error'));
        load();
        return;
      }
      setEdits((prev) => { const n = { ...prev }; delete n[row.vendor]; return n; });
    });
  };

  const toggleAutoSubmit = (row) => {
    const patch = { ...(edits[row.vendor] || {}), auto_submit_enabled: !fieldFor(row, 'auto_submit_enabled') };
    setEdits((prev) => ({ ...prev, [row.vendor]: patch }));
    saveRow(row, patch);
  };

  const addVendor = () => {
    const vendor = String(newRow.vendor || '').trim();
    if (!vendor) { showToast('Add vendor: vendor name is required'); return; }
    const insertRow = {
      vendor,
      inventory_sources: String(newRow.inventory_sources || '').split(',').map((s) => s.trim()).filter(Boolean),
      contact_email: String(newRow.contact_email || '').trim() || null,
      auto_submit_enabled: !!newRow.auto_submit_enabled,
      min_order_cents: newRow.min_order === '' ? null : Math.round((Number(newRow.min_order) || 0) * 100),
    };
    setAddBusy(true);
    supabase.from('teamshop_auto_po_settings').insert(insertRow).then(({ error }) => {
      setAddBusy(false);
      if (error) {
        showToast('Add vendor failed: ' + (error.message || 'unknown error'));
        return;
      }
      setNewRow(NEW_VENDOR_ROW);
      load();
    });
  };

  if (loading) return <div style={{ fontSize: 13, color: '#64748b' }}>Loading auto-PO vendors…</div>;

  if (missing) {
    return (
      <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
        Auto-PO migration (00202) not applied yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Per-vendor routing for the auto-PO engine. Inventory sources map a product's inventory source (sanmar, nike, ss_activewear,
        click, ua, momentec, …) to a supplier — comma-separated. Auto-submit only fires when a vendor has a contact email AND this
        toggle is on (below the vendor's min order, it stays a draft). No delete — disable a vendor by clearing its sources.
      </div>
      {err && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          Failed to load vendors: {err}
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
              <th style={{ padding: '4px 8px' }}>Vendor</th>
              <th style={{ padding: '4px 8px' }}>Inventory sources</th>
              <th style={{ padding: '4px 8px' }}>Contact email</th>
              <th style={{ padding: '4px 8px' }}>Min order ($)</th>
              <th style={{ padding: '4px 8px' }}>Auto-submit</th>
              <th style={{ padding: '4px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isDtf = row.deco_type === 'dtf';
              const sourcesField = fieldFor(row, 'inventory_sources');
              const thField = fieldFor(row, 'threshold_qty');
              const ageField = fieldFor(row, 'max_age_days');
              const minField = Object.prototype.hasOwnProperty.call(edits[row.vendor] || {}, 'min_order')
                ? edits[row.vendor].min_order
                : (row.min_order_cents != null ? row.min_order_cents / 100 : '');
              return (
                <tr key={row.vendor} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700 }}>{row.vendor}{isDtf && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#155e75', background: '#cffafe', padding: '1px 6px', borderRadius: 8 }}>DTF</span>}</td>
                  <td style={{ padding: '4px 8px' }}>
                    {isDtf ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#64748b' }}>batch ≥</span>
                        <input
                          type="number" min="0" step="1"
                          aria-label={'dtf-threshold-' + row.vendor}
                          placeholder="prints"
                          value={thField == null ? '' : thField}
                          onChange={(e) => setField(row, 'threshold_qty', e.target.value)}
                          style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 70 }}
                        />
                        <span style={{ fontSize: 11, color: '#64748b' }}>or age ≥</span>
                        <input
                          type="number" min="0" step="1"
                          aria-label={'dtf-max-age-' + row.vendor}
                          placeholder="days"
                          value={ageField == null ? '' : ageField}
                          onChange={(e) => setField(row, 'max_age_days', e.target.value)}
                          style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 60 }}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        aria-label={'vendor-sources-' + row.vendor}
                        value={Array.isArray(sourcesField) ? sourcesField.join(', ') : (sourcesField || '')}
                        onChange={(e) => setField(row, 'inventory_sources', e.target.value)}
                        style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 180 }}
                      />
                    )}
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="email"
                      aria-label={'vendor-email-' + row.vendor}
                      value={fieldFor(row, 'contact_email') || ''}
                      onChange={(e) => setField(row, 'contact_email', e.target.value)}
                      style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 180 }}
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={'vendor-min-order-' + row.vendor}
                      value={minField}
                      onChange={(e) => setField(row, 'min_order', e.target.value)}
                      style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 90 }}
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      aria-label={'vendor-auto-submit-' + row.vendor}
                      checked={!!fieldFor(row, 'auto_submit_enabled')}
                      onChange={() => toggleAutoSubmit(row)}
                    />
                    {fieldFor(row, 'auto_submit_enabled') && !String(fieldFor(row, 'contact_email') || '').trim() && (
                      <div style={{ fontSize: 10, color: '#b45309' }}>needs a contact email to actually send</div>
                    )}
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <button
                      type="button"
                      aria-label={'save-vendor-' + row.vendor}
                      disabled={!isDirty(row) || savingVendor === row.vendor}
                      onClick={() => saveRow(row)}
                      style={{
                        padding: '4px 10px', fontSize: 12, fontWeight: 700, borderRadius: 4, border: 'none',
                        background: isDirty(row) ? '#1d4ed8' : '#e2e8f0', color: isDirty(row) ? '#fff' : '#94a3b8',
                        cursor: isDirty(row) ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {savingVendor === row.vendor ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8, textTransform: 'uppercase' }}>Add vendor</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            aria-label="new-vendor-name"
            placeholder="Vendor name"
            value={newRow.vendor}
            onChange={(e) => setNewRow((r) => ({ ...r, vendor: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 160 }}
          />
          <input
            type="text"
            aria-label="new-vendor-sources"
            placeholder="inventory_sources (comma-separated)"
            value={newRow.inventory_sources}
            onChange={(e) => setNewRow((r) => ({ ...r, inventory_sources: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 220 }}
          />
          <input
            type="email"
            aria-label="new-vendor-email"
            placeholder="Contact email"
            value={newRow.contact_email}
            onChange={(e) => setNewRow((r) => ({ ...r, contact_email: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 180 }}
          />
          <input
            type="number"
            aria-label="new-vendor-min-order"
            min="0"
            step="0.01"
            placeholder="Min order $"
            value={newRow.min_order}
            onChange={(e) => setNewRow((r) => ({ ...r, min_order: e.target.value }))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, width: 100 }}
          />
          <button
            type="button"
            aria-label="add-vendor-submit"
            disabled={addBusy}
            onClick={addVendor}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {addBusy ? 'Adding…' : 'Add vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Automation (new this pass) — the teamshop_settings singleton (00208):
// auto_release_enabled + auto_release_scope. Direct client read/update,
// staff-gated by that table's own RLS. Honest helper text: this is OFF by
// default, and turning it on moves jobs into production with no human in the
// loop the moment the server can prove readiness — see the migration header.
function AutomationSection() {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [scope, setScope] = useState('auto_art_only');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setErr(null);
    return supabase
      .from('teamshop_settings')
      .select('*')
      .eq('id', 'global')
      .maybeSingle()
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          if (isMissingRelation(error)) { setMissing(true); return; }
          setErr(error.message || String(error));
          return;
        }
        setMissing(false);
        setRow(data || null);
        setEnabled(!!(data && data.auto_release_enabled));
        setScope((data && data.auto_release_scope) || 'auto_art_only');
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = !row || enabled !== !!row.auto_release_enabled || scope !== (row.auto_release_scope || 'auto_art_only');

  const save = () => {
    setSaving(true);
    const update = { auto_release_enabled: enabled, auto_release_scope: scope };
    supabase.from('teamshop_settings').update(update).eq('id', 'global').then(({ error }) => {
      setSaving(false);
      if (error) {
        showToast('Save failed: ' + (error.message || 'unknown error'));
        return;
      }
      setRow((r) => ({ ...(r || { id: 'global' }), ...update }));
      showToast('Automation settings saved');
    });
  };

  if (loading) return <div style={{ fontSize: 13, color: '#64748b' }}>Loading automation settings…</div>;

  if (missing) {
    return (
      <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
        Automation migration (00208) not applied yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Auto-release moves a job from Hold straight into production the moment the server can PROVE it's ready (art done, garments in
        hand) — through the same advance_job_stage release gate a staff scan uses (00205), never a direct write. <b>Off by default</b>:
        no jobs move automatically until this is switched on.
      </div>
      {err && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          Failed to load: {err}
        </div>
      )}
      {toast && (
        <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
          {toast}
        </div>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#334155', cursor: 'pointer', marginBottom: 12 }}>
        <input type="checkbox" aria-label="auto-release-enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Auto-release enabled
      </label>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>Scope</label>
        <select
          aria-label="auto-release-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 }}
        >
          <option value="auto_art_only">Only jobs born art-complete by auto-art — conservative</option>
          <option value="all">Any hold job the server proves ready</option>
        </select>
      </div>
      <button
        type="button"
        aria-label="save-automation-settings"
        disabled={saving || !dirty}
        onClick={save}
        style={{
          padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none',
          background: dirty ? '#1d4ed8' : '#e2e8f0', color: dirty ? '#fff' : '#94a3b8', cursor: dirty ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? 'Saving…' : 'Save automation settings'}
      </button>
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
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>Delivery timelines</h2>
        <DeliveryTimelineSection />
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>School PO eligibility</h2>
        <PoEligibilitySection />
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>Shipping</h2>
        <ShippingSection />
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>Auto-PO vendors</h2>
        <AutoPoVendorsSection />
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 0 }}>Automation</h2>
        <AutomationSection />
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

  // Folded into the Pipeline tab's Actions section (moved off its own
  // top-level tab this pass) — no more full-page background/minHeight, but
  // the heading text is unchanged (teamShopPoReviewTab.test.js still matches
  // it verbatim after clicking into Pipeline).
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      <h1 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: '0 0 12px' }}>Team Shop — PO review</h1>
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
  const [state, setState] = useState({ loading: true, enabled: true, pos: [], unmapped: [], dtf: null, error: null });
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
        if (r.error) { setState({ loading: false, enabled: true, pos: [], unmapped: [], dtf: null, error: r.error }); return; }
        setState({ loading: false, enabled: r.enabled !== false, pos: r.pos || [], unmapped: r.unmapped || [], dtf: r.dtf || null, error: null });
      })
      .catch((e) => setState({ loading: false, enabled: true, pos: [], unmapped: [], dtf: null, error: e.message || String(e) }));
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

  // DTF lane (00211): batch pending prints now (also runs hourly on a schedule).
  const runDtfSweep = () => {
    setBusyId('sweep_dtf');
    callFn({ action: 'sweep_dtf' }).then((r) => {
      setBusyId(null);
      if (r.error) { showToast('DTF batch failed: ' + r.error); return; }
      showToast(r.batched ? 'DTF batch created (' + (r.total_prints || 0) + ' prints, ' + (r.reason || '') + ')' : 'DTF: ' + (r.reason || 'nothing to batch').replace(/_/g, ' '));
      load();
    });
  };

  // Dismiss/resolve (00209) — staff ordered an unmapped line by hand; marks
  // dismissed_at server-side (teamshop-auto-po.js dismiss_unmapped, service
  // role) rather than a client delete — teamshop_auto_po_needs has no client
  // write policy on purpose (see 00202/00209 headers).
  const dismissUnmapped = (row) => {
    setBusyId('dismiss-' + row.id);
    callFn({ action: 'dismiss_unmapped', id: row.id }).then((r) => {
      setBusyId(null);
      if (r.error) { showToast('Dismiss failed: ' + r.error); return; }
      setState((s) => ({ ...s, unmapped: s.unmapped.filter((n) => n.id !== row.id) }));
    });
  };

  if (state.loading) return <div style={{ fontSize: 13, color: '#64748b', padding: 20 }}>Loading auto POs…</div>;

  // Folded into the Pipeline tab's Actions section — no more full-page
  // background/minHeight, but heading text is unchanged (teamshopAutoPo.test.js
  // still matches it verbatim after clicking into Pipeline).
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Team Shop — Auto POs</h1>
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
      {state.dtf && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#155e75', textTransform: 'uppercase', letterSpacing: 0.5 }}>DTF batch</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
            {state.dtf.pending_qty} / {state.dtf.threshold_qty != null ? state.dtf.threshold_qty : '—'} prints pending
            {state.dtf.pending_count ? ' · ' + state.dtf.pending_count + ' job' + (state.dtf.pending_count === 1 ? '' : 's') : ''}
          </span>
          {state.dtf.threshold_qty == null && state.dtf.max_age_days == null && (
            <span style={{ fontSize: 11, color: '#b45309' }}>lane inert — set a threshold in Auto-PO vendors to enable</span>
          )}
          {state.dtf.auto_submit_enabled && !String(state.dtf.contact_email || '').trim() && (
            <span style={{ fontSize: 11, color: '#b45309' }}>auto-submit on but no vendor email — batches stay draft</span>
          )}
          <button
            type="button"
            aria-label="dtf-sweep"
            disabled={busyId === 'sweep_dtf'}
            onClick={runDtfSweep}
            style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12, fontWeight: 700, background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {busyId === 'sweep_dtf' ? 'Batching…' : 'Batch DTF now'}
          </button>
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
            <div key={(n.id != null ? n.id : (n.so_id + '/' + (n.sku || '') + '/' + (n.size || '') + '/' + i))} style={{ display: 'flex', gap: 12, padding: '6px 10px', borderBottom: '1px solid #e2e8f0', fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>{n.so_id}</span>
              <span style={{ fontWeight: 600 }}>{n.sku || '—'}</span>
              <span>{n.size}</span>
              <span style={{ fontWeight: 700 }}>× {n.qty_needed}</span>
              {n.id != null && (
                <button
                  type="button"
                  aria-label={'dismiss-unmapped-' + n.id}
                  disabled={busyId === 'dismiss-' + n.id}
                  onClick={() => dismissUnmapped(n)}
                  style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11, fontWeight: 700, background: '#fff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer' }}
                >
                  {busyId === 'dismiss-' + n.id ? 'Dismissing…' : 'Dismiss'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline tab — order-centric view. Every teamshop/club order (fetchPipeline)
// as a row with Paid → Converted → Art → Goods → Floor → Shipped stage chips,
// plus the stuck-state panels folded in as ACTIONS: awaiting-conversion
// (AwaitingConversionPanel), PO review (PoReviewSection, moved here), auto-PO
// drafts + unmapped/no-vendor lines (AutoPoSection, moved here, dismiss added
// 00209), and a manual "Run sweep now" against teamshop-stuck-sweep.js.
function PipelineTab() {
  const [data, setData] = useState({ orders: [], salesOrders: [], jobs: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState(null);
  const [sweepErr, setSweepErr] = useState(null);

  const refetch = useCallback(() => {
    setErr(null);
    return fetchPipeline()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setErr(e.message || String(e)); setLoading(false); });
  }, []);

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, REFRESH_MS);
    return () => clearInterval(id);
  }, [refetch]);

  const jobsBySo = useMemo(() => {
    const m = {};
    data.jobs.forEach((j) => { (m[j.so_id] || (m[j.so_id] = [])).push(j); });
    return m;
  }, [data.jobs]);

  const awaitingConversion = useMemo(
    () => data.orders.filter((o) => o.status === 'paid' && !o.so_id),
    [data.orders]
  );

  const runSweep = () => {
    setSweepBusy(true);
    setSweepErr(null);
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess && sess.session && sess.session.access_token;
      let json;
      try {
        const res = await fetch('/.netlify/functions/teamshop-stuck-sweep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
          body: JSON.stringify({ action: 'run' }),
        });
        json = await res.json().catch(() => ({}));
      } catch (e) {
        json = { error: e.message || String(e) };
      }
      setSweepBusy(false);
      if (json.error) { setSweepErr(json.error); return; }
      setSweepResult(json);
    })();
  };

  if (loading) return <div style={{ fontSize: 13, color: '#64748b', padding: 20 }}>Loading pipeline…</div>;

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Order pipeline</h2>
        <button
          type="button"
          aria-label="run-stuck-sweep"
          disabled={sweepBusy}
          onClick={runSweep}
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          {sweepBusy ? 'Running…' : 'Run sweep now'}
        </button>
      </div>

      {sweepErr && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          Sweep failed: {sweepErr}
        </div>
      )}
      {sweepResult && (
        <div style={{ background: '#eff6ff', color: '#1e3a5f', padding: '10px 14px', borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
          Sweep result — paid/no SO: {(sweepResult.counts && sweepResult.counts.paid_no_so) || 0},
          {' '}stale pending: {(sweepResult.counts && sweepResult.counts.stale_pending_payment) || 0},
          {' '}stuck art: {(sweepResult.counts && sweepResult.counts.stuck_art) || 0},
          {' '}no PO/need order: {(sweepResult.counts && sweepResult.counts.no_po_need_order) || 0},
          {' '}auto-submit blocked: {(sweepResult.counts && sweepResult.counts.auto_submit_blocked) || 0}.
          {' '}Total stuck: {sweepResult.total_stuck || 0}{sweepResult.emailed ? ' — alert emailed.' : ''}
        </div>
      )}
      {err && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          Failed to load: {err}
        </div>
      )}

      <div style={{ overflowX: 'auto', marginBottom: 28 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={{ padding: '4px 8px' }}>Order</th>
              <th style={{ padding: '4px 8px' }}>Buyer</th>
              <th style={{ padding: '4px 8px' }}>Total</th>
              <th style={{ padding: '4px 8px' }}>Stage</th>
              <th style={{ padding: '4px 8px' }}>Age</th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map((o) => {
              const jobs = o.so_id ? (jobsBySo[o.so_id] || []) : [];
              const flags = computeStageFlags(o, jobs);
              return (
                <tr key={o.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 700 }}>{o.order_number || o.id}</td>
                  <td style={{ padding: '4px 8px' }}>{o.buyer_name || o.buyer_email || '—'}</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700 }}>{fmtMoney(o.total)}</td>
                  <td style={{ padding: '4px 8px' }}><StageChips flags={flags} /></td>
                  <td style={{ padding: '4px 8px', color: '#64748b' }}>{fmtAge(o.created_at)}</td>
                </tr>
              );
            })}
            {data.orders.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 12, color: '#94a3b8' }}>No teamshop/club orders.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Actions</h3>

      <div style={{ marginBottom: 24 }}>
        <AwaitingConversionPanel orders={awaitingConversion} onConverted={refetch} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <PoReviewSection />
      </div>

      <div>
        <AutoPoSection />
      </div>
    </div>
  );
}

function TeamShopQueueTabs({ email }) {
  // Default tab stays 'production' (the original queue board) — the
  // Production HQ rename/reorg is additive: existing staff muscle memory and
  // this file's original test coverage both land on the same board they
  // always did on open.
  const [tab, setTab] = useState('production');

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
      <div style={{ padding: '16px 20px 0', background: '#f8fafc' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 10 }}>Production HQ</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabBtn('pipeline', 'Pipeline')}
          {tabBtn('production', 'Production & Pull')}
          {tabBtn('settings', 'Settings')}
        </div>
      </div>
      {tab === 'pipeline' ? <PipelineTab />
        : tab === 'production' ? <TeamShopQueueBoard email={email} />
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
