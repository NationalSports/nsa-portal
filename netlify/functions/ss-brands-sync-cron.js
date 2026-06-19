// Scheduled trigger: fires ss-brands-sync-background daily.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/ss-brands-sync-background', { method: 'POST' });
    console.log('[ss-brands-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[ss-brands-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
