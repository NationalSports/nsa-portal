// Scheduled trigger: fires momentec-image-verify-background daily, just after
// the Momentec catalog sync. Verifies existing images and fills missing
// front/back URLs from Momentec's current catalog response.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/momentec-image-verify-background', { method: 'POST' });
    console.log('[momentec-image-verify-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[momentec-image-verify-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
