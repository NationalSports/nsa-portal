// Scheduled trigger: fires marketing-sync daily (schedule in netlify.toml).
// Same wrapper pattern as the vendor sync crons; marketing-sync is staff-or-
// internal gated, so the wrapper presents the shared internal secret.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  const secret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try {
    const res = await fetch(site + '/.netlify/functions/marketing-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: '{}',
    });
    console.log('[marketing-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[marketing-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
