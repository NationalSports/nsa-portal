// Record-level URL routing helpers.
//
// The portal encodes BOTH the current section and the open record in the query string so
// that every record (an order, estimate, customer, vendor, product, or invoice) is its own
// address and its own browser-history entry:
//   • the Back button closes the record and returns to the list,
//   • a refresh reopens the exact record (URL-driven — no localStorage guesswork),
//   • an emailed deep-link lands on, and STAYS on, that record.
//
// The section lives in ?pg=<id> ('dashboard' is the clean default, no param). Exactly one
// record param is live at a time — the one belonging to the current section. These helpers
// are pure (no window / React) so the tricky serialization can be unit-tested on its own.

// The six record params, one per record-bearing section.
const REC_PARAMS = ['so', 'est', 'cust', 'vend', 'prod', 'inv'];

// Which record param a given section uses. Sections not listed have no record view.
const REC_PARAM_FOR_PG = {
  orders: 'so',
  estimates: 'est',
  customers: 'cust',
  vendors: 'vend',
  products: 'prod',
  invoices: 'inv',
};

// Build the canonical "?pg=…&<rec>=…" search string for a (pg, recParam, recId) route,
// starting from an existing search string so unrelated params (e.g. ?portal=) survive.
// 'dashboard' clears ?pg=. EVERY record param is cleared first, then the one live record
// (if any) is set — so a stale record param from a previous section can never linger.
// Returns '' for the clean dashboard URL, otherwise a string beginning with '?'.
function buildRouteSearch(search, pg, recParam, recId) {
  const p = new URLSearchParams(search || '');
  if (!pg || pg === 'dashboard') p.delete('pg'); else p.set('pg', pg);
  REC_PARAMS.forEach((k) => p.delete(k));
  if (recParam && recId) p.set(recParam, String(recId));
  const s = p.toString();
  return s ? '?' + s : '';
}

// Read a route back out of a search string: the section and any live record param.
// Returns { pg, recParam, recId } — recParam/recId are null when no record is open.
function readRoute(search) {
  const p = new URLSearchParams(search || '');
  const pg = p.get('pg') || 'dashboard';
  let recParam = null;
  let recId = null;
  // The record param that matches the section wins; fall back to the first present one so a
  // param-only link (e.g. ?so=SO-1 with no ?pg=) still resolves.
  const preferred = REC_PARAM_FOR_PG[pg];
  if (preferred && p.get(preferred)) {
    recParam = preferred;
    recId = p.get(preferred);
  } else {
    for (const k of REC_PARAMS) {
      const v = p.get(k);
      if (v) { recParam = k; recId = v; break; }
    }
  }
  return { pg, recParam, recId };
}

// A compact key for a route's record, used to detect open/close/switch transitions.
function recKey(recParam, recId) {
  return recParam && recId ? recParam + ':' + recId : '';
}

module.exports = { REC_PARAMS, REC_PARAM_FOR_PG, buildRouteSearch, readRoute, recKey };
