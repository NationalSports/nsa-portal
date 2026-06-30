// Scheduled trigger: fires sportslink-sync-background daily to mirror active Sports Inc
// documents into the si_documents queue. Schedule is in netlify.toml under
// [functions."sportslink-sync-cron"] — set after the 10:30am EST SI processing cutoff.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/sportslink-sync-background', { method: 'POST' });
    console.log('[sportslink-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[sportslink-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
