// Private daily Netlify trigger. Scheduled functions have no production URL;
// this starts the authenticated 15-minute background worker and returns quickly.
const { withCronAlert } = require('./_cronAlert');

exports.handler = withCronAlert(
  'Supplier bill processor',
  'Exact supplier bills are not applying costs or reaching QuickBooks automatically; review bills remain safely queued.',
  async () => {
    const site = String(process.env.URL || '').replace(/\/+$/, '');
    const secret = process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!site || !secret) return { statusCode: 500, body: 'Background worker configuration is missing' };
    const response = await fetch(`${site}/.netlify/functions/supplier-bill-process-background`, {
      method: 'POST',
      headers: { 'x-internal-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'daily-schedule' }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { statusCode: 502, body: `Background worker rejected the trigger (${response.status}): ${detail.slice(0, 200)}` };
    }
    console.log('[supplier-bill-process] background run accepted:', response.status);
    return { statusCode: 200, body: 'Supplier bill background run accepted' };
  },
);
