// Scheduled wrapper. The background function returns immediately and continues
// with Netlify's 15-minute execution budget.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  const secret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try {
    const response = await fetch(site + '/.netlify/functions/omg-profit-sync-background', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: '{}',
    });
    console.log('[omg-profit-sync-cron] triggered:', response.status);
    return { statusCode: 200, body: 'Triggered (' + response.status + ')' };
  } catch (error) {
    console.error('[omg-profit-sync-cron]', error);
    return { statusCode: 500, body: error.message };
  }
};
