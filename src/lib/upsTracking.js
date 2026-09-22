// Share in-flight lookups and briefly cache successful results within this tab.
const pending = new Map();
const cache = new Map();
let unavailableUntil = 0;
export async function checkUpsTracking(tracking) {
  const key = String(tracking || '').trim().toUpperCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  if (pending.has(key)) return pending.get(key);
  if (Date.now() < unavailableUntil) throw new Error('UPS tracking is temporarily unavailable. Please try again in a minute.');
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch('/.netlify/functions/ups-tracking?tracking=' + encodeURIComponent(key), { signal: controller.signal });
      if (!response.ok) throw new Error('UPS tracking returned ' + response.status);
      const data = await response.json();
      if (data.error || ['error', 'unknown'].includes(data.status) || typeof data.pickedUp !== 'boolean') {
        throw new Error(data.error || 'UPS tracking is unavailable');
      }
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, { data, expires: Date.now() + 300000 });
      return data;
    } catch (error) {
      unavailableUntil = Date.now() + 60000;
      throw error;
    } finally {
      clearTimeout(timer);
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}
