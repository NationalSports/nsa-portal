// Scheduled trigger: fires ss-orders-sync-background daily to mirror S&S Activewear orders
// (last 3 months) into the ss_documents queue. Schedule is in netlify.toml under
// [functions."ss-orders-sync-cron"].
exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  if (!site) return { statusCode: 500, body: 'No site URL' };
  try {
    const res = await fetch(site + '/.netlify/functions/ss-orders-sync-background', { method: 'POST' });
    console.log('[ss-orders-sync-cron] triggered:', res.status);
    return { statusCode: 200, body: 'Triggered (' + res.status + ')' };
  } catch (e) {
    console.error('[ss-orders-sync-cron]', e);
    return { statusCode: 500, body: e.message };
  }
};
