// Scheduled trigger: fires sanmar-flat-images-background every 2 hours. Each run
// processes as many styles as fit its 15-min budget; sanmar_flat_state carries
// progress between runs, so the catalog converges over ~a day and steady-state
// runs are near no-ops (styles recheck every 60 days).
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/sanmar-flat-images-background', { method: 'POST' });
    console.log('[sanmar-flat-images-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[sanmar-flat-images-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
