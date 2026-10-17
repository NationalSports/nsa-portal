// Scheduled trigger (see netlify.toml): scheduled functions are capped at
// ~10s, so this just fires the 15-min background sync and returns.
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  const triggerSecret = process.env.ADIDAS_SYNC_TRIGGER_SECRET;
  if (!site) return { statusCode: 500, body: 'No site URL' };
  if (!triggerSecret) {
    console.error('[ss-adidas-sync-cron] ADIDAS_SYNC_TRIGGER_SECRET missing');
    return { statusCode: 500, body: 'Trigger secret not configured' };
  }
  try {
    // Background functions return 202 immediately; the sync continues server-side.
    const res = await fetch(site + '/.netlify/functions/ss-adidas-sync-background', {
      method: 'POST',
      headers: { 'x-adidas-sync-secret': triggerSecret },
    });
    if (res.status !== 202) {
      const body = await res.text().catch(() => '');
      console.error('[ss-adidas-sync-cron] trigger failed:', res.status, body.slice(0, 300));
      return { statusCode: 502, body: 'Background trigger failed (' + res.status + ')' };
    }
    console.log('[ss-adidas-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[ss-adidas-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
