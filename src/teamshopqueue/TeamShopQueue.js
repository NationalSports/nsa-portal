import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Team Shop — Fast Turn Queue. A staff-only lazy chunk, routed at
// /teamshop-queue by src/index.js. This is the fast-turn production board for
// Team Shop orders ONLY (webstore_orders.order_source='teamshop', see 00191 /
// 00192) — a small, separate view from the main warehouse jobs board in
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
// Stage moves go through the advance_job_stage RPC (00188) exclusively — this
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

// Mirrors advance_job_stage's own normalization (00188: legacy 'ready' -> 'hold').
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

// Session tracker for the main staff client — mirrors
// src/teamshop/useCoachSession.js, but against `supabase` (staff auth), not
// the isolated supabaseCoach client.
function useStaffSession() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession((data && data.session) || null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => { if (alive) setSession(sess || null); });
    return () => { alive = false; if (sub && sub.subscription) sub.subscription.unsubscribe(); };
  }, []);

  return {
    loading: session === undefined,
    signedIn: !!session,
    email: (session && session.user && session.user.email) || null,
  };
}

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

function JobCard({ job, order, onAction, actionsDisabled, actionBusy }) {
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
      {actionFor && (
        <button
          type="button"
          disabled={actionsDisabled || busy}
          onClick={() => onAction(job, actionFor.event, status)}
          style={{
            marginTop: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700,
            background: actionsDisabled ? '#e2e8f0' : '#1d4ed8', color: actionsDisabled ? '#94a3b8' : '#fff',
            border: 'none', borderRadius: 6, cursor: actionsDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Working…' : actionFor.label}
        </button>
      )}
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

  return <TeamShopQueueBoard email={email} />;
}
