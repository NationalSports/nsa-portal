// Scheduled (see netlify.toml), two passes:
//   1. CLOSE — flips webstores whose close_at has passed to 'closed' so the storefront
//      stops taking orders. No process prompt yet.
//   2. NOTIFY — for stores closed at least 6 WEEKS (the _webstoreClose cost window, so
//      late costs — shipping, OMG/CC fees, refunds — have landed before anyone processes
//      the store), creates the rep to-do + emails the rep & assigned CSR the breakdown.
// Idempotent on closed_notified_at, so a store handled here (or by a manual close) is
// never processed twice.
const { getSupabaseAdmin } = require('./_shared');
const { notifyStoreClosed, COST_WINDOW_MS } = require('./_webstoreClose');

exports.handler = async () => {
  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) { console.error('[close-sweep]', e.message); return { statusCode: 500, body: 'Not configured' }; }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  try {
    // Pass 1 — open, real (non-OMG) stores whose close date has passed.
    const { data: due, error } = await admin.from('webstores')
      .select('id').eq('status', 'open').eq('source', 'webstore')
      .not('close_at', 'is', null).lte('close_at', nowIso);
    if (error) { console.error('[close-sweep] query failed:', error.message); return { statusCode: 500, body: error.message }; }

    let closed = 0;
    for (const store of due || []) {
      const { error: uErr } = await admin.from('webstores').update({ status: 'closed', updated_at: nowIso }).eq('id', store.id).eq('status', 'open');
      if (uErr) { console.error('[close-sweep] close failed for', store.id, uErr.message); continue; }
      closed++;
    }

    // Pass 2 — closed stores past the 6-week cost window that were never notified.
    // close_at anchors the window (manual close stamps it too); legacy closed rows with
    // no close_at are left to the notifyStoreClosed updated_at fallback via manual runs.
    const windowIso = new Date(now - COST_WINDOW_MS).toISOString();
    const { data: ready, error: nErr } = await admin.from('webstores')
      .select('*').eq('status', 'closed').eq('source', 'webstore')
      .is('closed_notified_at', null)
      .not('close_at', 'is', null).lte('close_at', windowIso);
    if (nErr) console.error('[close-sweep] notify query failed:', nErr.message);

    let notified = 0;
    for (const store of ready || []) {
      try {
        const r = await notifyStoreClosed(admin, store);
        if (r && r.notified) notified++;
      } catch (e) { console.error('[close-sweep] notify failed for', store.id, e.message); }
    }
    console.log(`[close-sweep] closed ${closed} of ${(due || []).length} due, notified ${notified} of ${(ready || []).length} past cost window`);
    return { statusCode: 200, body: `Closed ${closed}, notified ${notified}` };
  } catch (e) {
    console.error('[close-sweep]', e);
    return { statusCode: 500, body: e.message };
  }
};
