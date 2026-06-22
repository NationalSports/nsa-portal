// Scheduled trigger: fires champro-catalog-sync-background daily. The background fn
// only touches Champro products with empty available_sizes, so this stays cheap after
// the initial backfill and picks up any newly-imported Champro rows.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/champro-catalog-sync-background', { method: 'POST' });
    console.log('[champro-catalog-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[champro-catalog-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
