// The coach portal's data request, started by index.js the moment a ?portal= link opens so the
// team's rows download while the portal's code does. Deliberately import-free: index.js is in
// the main bundle. src/lib/coachPortalData.js picks the request up (or makes its own).
export const COACH_PORTAL_DATA_URL = '/.netlify/functions/coach-portal-data';

export const requestCoachPortalData = (alphaTag, fetchImpl = fetch) => fetchImpl(COACH_PORTAL_DATA_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alphaTag }),
});

let pending = null;
export function prefetchCoachPortalData(alphaTag) {
  pending = { alphaTag, response: requestCoachPortalData(alphaTag) };
  pending.response.catch(() => {}); // a failure surfaces when the portal consumes it
}
// The prefetched response for this tag, once; later loads (retry, refresh) fetch fresh.
export function takePrefetchedCoachPortalData(alphaTag) {
  const p = pending; pending = null;
  return p && p.alphaTag === alphaTag ? p.response : null;
}
