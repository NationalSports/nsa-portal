// Scheduled wrapper for the operational-only OMG order-count refresh.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  const secret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try {
    const response = await fetch(site + '/.netlify/functions/omg-order-sync-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: '{}',
    });
    console.log('[omg-order-sync-cron] triggered:', response.status);
    return { statusCode: response.ok ? 200 : 502, body: `Triggered (${response.status})` };
  } catch (error) {
    console.error('[omg-order-sync-cron]', error);
    return { statusCode: 500, body: error.message };
  }
};
