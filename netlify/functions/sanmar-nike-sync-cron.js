// Scheduled trigger (see netlify.toml): scheduled functions are capped at
// ~10s, so this just fires the 15-min background Nike-from-SanMar sync.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/sanmar-nike-sync-background', { method: 'POST' });
    console.log('[sanmar-nike-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[sanmar-nike-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
