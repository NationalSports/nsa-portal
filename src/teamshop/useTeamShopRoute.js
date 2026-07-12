import { useState, useEffect, useCallback } from 'react';

const { isTeamShopHost } = require('../lib/hostRouting');

// Library-free URL + browser-history routing for the Team Shop storefront —
// mirrors src/storefront/Storefront.js's pattern (useState(parseRoute())
// seeded from window.location at mount, a single popstate listener as the
// only route-state writer, navTo -> buildUrl -> pushState/replaceState + a
// synthetic popstate so that one listener is the only writer).
//
// Base prefix lives in exactly one place here, reusing isTeamShopHost so
// there is no second copy of the host list: '' on the alias hosts
// (nationalteamshop.com / www.), '/teamshop' everywhere else (deploy
// previews, e2e). See src/lib/hostRouting.js.
//
// buildUrl is a strict whitelist — it only ever emits
// { sku, category, q, method, section, orderView } into the URL. Cart
// lines, checkoutQuote/quote_hash/client_secret, the coach session, the
// one-time ?handoff= code, and orderCustomer's pricing record are NEVER
// passed through it (TeamShopApp.js keeps all of that in memory /
// localStorage only).

// Note: launch-category keys (categories.js) are NOT validated here — an
// unrecognized `?category=` just yields an empty grid client-side, same as
// today's `initialCategory` prop; this hook stays free of a static import of
// categories.js.
const METHODS = new Set(['embroidery', 'dtf', 'heat']);
const SECTIONS = new Set(['logos', 'orders']);
const ORDER_VIEWS = new Set(['catalog', 'logos', 'placement', 'checkout', 'confirmed']); // 'start' = bare /order; 'cart' = top-level /cart

// isTeamShopHost is true by hostname alone on the alias, so a host-only probe tells us
// whether we own '/' ('' base) or live under '/teamshop'.
export function teamShopBase(loc = window.location) {
  return isTeamShopHost(loc.hostname, '/') ? '' : '/teamshop';
}

export function parseRoute(loc = window.location, base = teamShopBase(loc)) {
  let path = loc.pathname;
  // Safe only because index.js gates TeamShopApp to exactly /teamshop or /teamshop/* (segment-exact,
  // hostRouting.js:24), so this base-strip never sees /teamshopX. Keep that coupling if index.js changes.
  if (base && path.indexOf(base) === 0) path = path.slice(base.length);
  const segs = path.replace(/\/+$/, '').split('/').filter(Boolean);
  const qs = new URLSearchParams(loc.search);
  switch (segs[0]) {
    case undefined:    return { name: 'landing' };
    case 'catalog':    return { name: 'catalog', category: qs.get('category') || null };
    case 'product':    return { name: 'product', sku: decodeURIComponent(segs[1] || '') };
    case 'stores':     return { name: 'stores' };
    case 'decoration': return { name: 'decoration', method: METHODS.has(segs[1]) ? segs[1] : 'embroidery' };
    case 'account':    return { name: 'account', section: SECTIONS.has(segs[1]) ? segs[1] : null };
    case 'search':     return { name: 'search', q: qs.get('q') || '', category: qs.get('category') || null };
    case 'order':      return { name: 'order', orderView: ORDER_VIEWS.has(segs[1]) ? segs[1] : 'start' }; // bare/unknown → StartWithLogo
    case 'cart':       return { name: 'cart' };
    // 'faq' is not in the plan's original scheme table (a gap — FAQPage
    // already exists and is wired from the header/footer today); added here
    // as a zero-fetch content view in the same tier as landing/stores so
    // goFAQ() keeps a real, bookmarkable destination instead of silently
    // falling through to the landing-page soft-404 below.
    case 'faq':        return { name: 'faq' };
    default:           return { name: 'landing' }; // soft 404
  }
}

export function buildUrl(name, p = {}, base = teamShopBase()) {
  let path = '/';
  if (name === 'catalog')         path = '/catalog';
  else if (name === 'product')    path = `/product/${encodeURIComponent(p.sku)}`;
  else if (name === 'stores')     path = '/stores';
  else if (name === 'decoration') path = p.method && p.method !== 'embroidery' ? `/decoration/${p.method}` : '/decoration';
  else if (name === 'account')    path = p.section ? `/account/${p.section}` : '/account';
  else if (name === 'search')     path = '/search';
  else if (name === 'order')      path = p.orderView && p.orderView !== 'start' ? `/order/${p.orderView}` : '/order';
  else if (name === 'cart')       path = '/cart';
  else if (name === 'faq')        path = '/faq';
  const q = new URLSearchParams();
  if (name === 'catalog' && p.category) q.set('category', p.category);
  if (name === 'search'  && p.q)        q.set('q', p.q);
  if (name === 'search'  && p.category) q.set('category', p.category);
  const query = q.toString();
  return (base + (path === '/' ? '' : path) + (query ? `?${query}` : '')) || '/';
}

export function useTeamShopRoute() {
  const base = teamShopBase();
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navTo = useCallback((name, params = {}, { replace = false, scroll = !replace } = {}) => {
    const url = buildUrl(name, params, base);
    if (replace) window.history.replaceState({}, '', url);
    else         window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate')); // single writer → setRoute
    if (scroll) window.scrollTo(0, 0);
  }, [base]);
  return { route, navTo };
}
