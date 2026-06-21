// Scheduled trigger: fires momentec-image-verify-background daily, just after
// the Momentec catalog sync (which re-derives image URLs from the SKU without
// checking they exist). Clears image_front_url/image_back_url for styles whose
// CDN photo is missing so the "no image" filters stay accurate.
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
