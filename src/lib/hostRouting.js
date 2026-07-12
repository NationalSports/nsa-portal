// Host-based routing predicates for src/index.js — pure and dependency-free so
// they can be unit-tested without a DOM (see src/__tests__/hostRouting.test.js).

// The Team Shop storefront's dedicated retail domain (aliased onto this Netlify
// app). Any visitor arriving on it lands on the Team Shop chunk, never the
// portal login.
const TEAM_SHOP_HOSTS = ['nationalteamshop.com', 'www.nationalteamshop.com'];

// Should this visit load the Team Shop storefront chunk?
//   - true when the hostname is nationalteamshop.com (with or without www);
//     hostnames are case-insensitive, and we tolerate a trailing FQDN dot or a
//     stray :port even though window.location.hostname never carries either.
//   - true when the path is /teamshop (or anything under /teamshop/) on ANY
//     host, so deploy previews and e2e runs can reach the storefront without
//     the domain. Path matching is segment-exact (/teamshopping doesn't match)
//     and case-sensitive, like every other path check in src/index.js.
function isTeamShopHost(hostname, pathname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '') // trailing FQDN dot: "nationalteamshop.com."
    .replace(/:\d+$/, ''); // defensive: strip a port if a host:port slipped in
  if (TEAM_SHOP_HOSTS.indexOf(host) !== -1) return true;
  const path = String(pathname || '');
  return path === '/teamshop' || path.indexOf('/teamshop/') === 0;
}

// Should this visit load the shop-floor scan station chunk
// (src/floorstation/FloorStation.js)? Path-exact on any host, with or without
// a trailing slash — the same shape as index.js's isTeamShopQueue check, kept
// here so it's unit-testable without a DOM.
function isFloorStationPath(pathname) {
  const path = String(pathname || '');
  return path === '/floor-station' || path === '/floor-station/';
}

// Should this visit load the Top Star digitizing vendor portal chunk
// (src/vendorportal/VendorDigitizing.js)? Path-exact on any host, with or without
// a trailing slash — same shape as isFloorStationPath.
function isVendorDigitizingPath(pathname) {
  const path = String(pathname || '');
  return path === '/vendor-digitizing' || path === '/vendor-digitizing/';
}

module.exports = { isTeamShopHost, isFloorStationPath, isVendorDigitizingPath };
