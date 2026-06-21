// Scheduled (see netlify.toml): closes webstores whose close_at has passed and, for each,
// creates a rep to-do + emails the rep & assigned CSR a breakdown (via _webstoreClose).
// Idempotent on closed_notified_at, so a store handled here (or by a manual close) is
// never processed twice.
const { getSupabaseAdmin } = require('./_shared');
const { notifyStoreClosed } = require('./_webstoreClose');

exports.handler = async () => {
  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) { console.error('[close-sweep]', e.message); return { statusCode: 500, body: 'Not configured' }; }

  const nowIso = new Date().toISOString();
  try {
    // Open, real (non-OMG) stores whose close date has passed.
    const { data: due, error } = await admin.from('webstores')
      .select('*').eq('status', 'open').eq('source', 'webstore')
      .not('close_at', 'is', null).lte('close_at', nowIso);
    if (error) { console.error('[close-sweep] query failed:', error.message); return { statusCode: 500, body: error.message }; }
    if (!due || !due.length) return { statusCode: 200, body: 'No stores due to close' };

    let closed = 0, notified = 0;
    for (const store of due) {
      // Flip to closed first so the storefront stops taking orders even if notify fails.
      const { error: uErr } = await admin.from('webstores').update({ status: 'closed', updated_at: nowIso }).eq('id', store.id).eq('status', 'open');
      if (uErr) { console.error('[close-sweep] close failed for', store.id, uErr.message); continue; }
      closed++;
      try {
        const r = await notifyStoreClosed(admin, { ...store, status: 'closed' });
        if (r && r.notified) notified++;
      } catch (e) { console.error('[close-sweep] notify failed for', store.id, e.message); }
    }
    console.log(`[close-sweep] closed ${closed}, notified ${notified} of ${due.length} due`);
    return { statusCode: 200, body: `Closed ${closed}, notified ${notified}` };
  } catch (e) {
    console.error('[close-sweep]', e);
    return { statusCode: 500, body: e.message };
  }
};
