// Scheduled trigger (see netlify.toml): scheduled functions are capped at
// ~10s, so this just fires the 15-min background sync and returns.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    // Background functions return 202 immediately; the sync continues server-side.
    const res = await fetch(site + '/.netlify/functions/ss-adidas-sync-background', { method: 'POST' });
    console.log('[ss-adidas-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[ss-adidas-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
