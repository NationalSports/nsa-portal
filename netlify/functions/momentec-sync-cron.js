// Scheduled trigger: fires momentec-sync-background daily.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/momentec-sync-background', { method: 'POST' });
    console.log('[momentec-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[momentec-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
