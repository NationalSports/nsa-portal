import React, { useEffect, useMemo, useState } from 'react';
import { supabaseCoach } from '../lib/supabaseCoach';
import { fetchStockMap } from '../lib/storeInventory';
import CatalogCard from './CatalogCard';
import {
  ensureTeamShopStyles, NAVY, RED, OFF_WHITE, BORDER,
  BORDER_DARK, TEXT, TEXT_MUTED, TEXT_FAINT, displayType,
} from './theme';
import { LAUNCH_CATEGORIES, categoryByKey, inLaunchCategories } from './categories';

const PAGE_SIZE = 24;

// Debounce a fast-changing value (the search box) so the RPC below doesn't
// fire on every keystroke.
function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ---- Roster sizes widget state (from the approved mockup's sidebar) --------
// Display/persistence ONLY at this stage: quantities save to localStorage
// 'nts_roster' and surface in the results line, but do NOT feed the cart or
// ordering yet. TODO(roster-prefill): when the size-level order flow lands,
// prefill each product's size quantities from this roster.
const ROSTER_KEY = 'nts_roster';
const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const emptyRoster = () => SIZES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});

function loadRoster() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(ROSTER_KEY) || '{}');
    const roster = emptyRoster();
    SIZES.forEach((s) => {
      const n = Number(raw[s]);
      if (Number.isFinite(n) && n > 0) roster[s] = Math.floor(n);
    });
    return roster;
  } catch { return emptyRoster(); }
}

function saveRoster(roster) {
  try { window.localStorage.setItem(ROSTER_KEY, JSON.stringify(roster)); } catch { /* best-effort */ }
}

// Anonymous garment catalog browse — no sign-in required. Reuses the
// `search_products` RPC (see src/lib/dbEngine.js _searchProductsServer for the
// staff-side call shape), which is GRANTed to the `anon` role
// (supabase/migrations/00151_search_products_exclude_api_vendors.sql), and the
// isolated supabaseCoach client (same one CoachGate/AdidasInventory use) so
// browsing works whether or not a coach happens to be signed in.
//
// Visual design: the approved "Shop - Polos" Claude Design mockup (v2) —
// page-head band with breadcrumb/eyebrow/title, a horizontal roster strip,
// a filter-chip row (brand + search + visual-only decoration pills), results
// toolbar (count + sort), 3:4 product-card grid, 4 across. The v2 revision
// moved the roster-sizes widget out of a sidebar (removed entirely) into that
// top strip, and turned the brand filter into chips. The mockup's category
// page is implemented generically: the head/breadcrumb are driven by the
// current search, defaulting to an all-products view.
//
// Category chips (see categories.js) sit above the grid: 'All' + the launch
// categories. Picking one drives a server-filtered fetch (see the effect
// below); 'All' stays client-filtered to the launch set so non-launch
// categories (socks, jerseys, ...) never show up here.
export default function Catalog({ onSelectProduct, onAddBlank, initialCategory }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [selectedBrands, setSelectedBrands] = useState([]); // multi-select; empty = all
  // Category chip state — key into LAUNCH_CATEGORIES, or null for 'All'.
  const [categoryKey, setCategoryKey] = useState(initialCategory || null);
  const activeCategory = categoryKey ? categoryByKey(categoryKey) : null;
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roster, setRoster] = useState(loadRoster);

  useEffect(() => { ensureTeamShopStyles(); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      const { data, error: rpcErr } = await supabaseCoach.rpc('search_products', {
        p_query: debounced || null,
        // Server-side filter uses the category's primary db value (exact
        // match — see src/lib/dbEngine.js _searchProductsServer / the
        // search_products RPC: `pr.category = p_category`). A handful of
        // rows use an alternate spelling (e.g. 'Hood' vs 'Hoods') that this
        // single value won't catch server-side.
        // TODO(server-category-list): search_products only accepts one
        // p_category value; a multi-category server param (e.g. p_categories
        // text[]) would make a per-category fetch exactly right instead of
        // "primary spelling only". The 'All' view below compensates by
        // client-filtering the loaded page through inLaunchCategories, so
        // non-launch categories never render there either way.
        p_category: activeCategory ? activeCategory.dbValues[0] : null,
        p_vendor_id: null,
        p_color_category: null,
        p_in_stock: false,
        p_limit: PAGE_SIZE,
        p_offset: 0,
      });
      if (!alive) return;
      if (rpcErr) { setError('Could not load the catalog'); setLoading(false); return; }
      let rows = data || [];
      // 'All' (no category selected): the server returns every category,
      // including ones the Team Shop doesn't sell (socks, jerseys, ...) — so
      // client-filter the loaded page down to launch categories only.
      // A specific category is already server-filtered exactly (bar the
      // alternate-spelling rows noted above), so no extra filtering there.
      if (!activeCategory) rows = rows.filter(inLaunchCategories);
      setProducts(rows);
      setLoading(false);
      // Live stock (src/lib/storeInventory.js — same source as the coach catalog
      // live-look) is a progressive enhancement: cards still render without it.
      try {
        const map = await fetchStockMap(rows.map((p) => ({ id: p.id, sku: p.sku })));
        if (alive) setStock(map);
      } catch { /* best-effort only */ }
    })();
    return () => { alive = false; };
    // activeCategory is derived from categoryKey, so depending on categoryKey covers it.
  }, [debounced, categoryKey]);

  // Per-brand counts come from the currently loaded result page.
  // TODO(brand-counts): real whole-catalog counts need a server aggregate.
  const brandCounts = useMemo(() => {
    const counts = new Map();
    products.forEach((p) => { if (p.brand) counts.set(p.brand, (counts.get(p.brand) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);

  const visible = useMemo(
    () => (selectedBrands.length ? products.filter((p) => selectedBrands.includes(p.brand)) : products),
    [products, selectedBrands],
  );

  const toggleBrand = (b) => setSelectedBrands((prev) => (
    prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]
  ));

  // Sort. search_products returns rows in relevance/DB order, which reads as
  // arbitrary on an all-products view — so we impose a stable default (Featured,
  // then A–Z) and let the shopper re-sort. Applied client-side over the loaded
  // page, same as the brand filter. Choice persists across visits.
  const [sortBy, setSortBy] = useState(() => {
    try { return localStorage.getItem('nts_sort') || 'featured'; } catch { return 'featured'; }
  });
  const changeSort = (v) => { setSortBy(v); try { localStorage.setItem('nts_sort', v); } catch { /* ignore */ } };

  // List-price basis for ORDERING ONLY (never displayed) — mirrors the server's
  // standard-sell fallback (catalog_sell_price → cost×1.65 → retail) so the
  // Price sort lines up with what shoppers actually pay.
  const listPrice = (p) => {
    if (p.catalog_sell_price != null) return Number(p.catalog_sell_price) || 0;
    const cost = p.is_clearance && p.clearance_cost != null ? p.clearance_cost : p.nsa_cost;
    if (cost != null) return (Number(cost) || 0) * 1.65;
    return Number(p.retail_price) || 0;
  };

  const sorted = useMemo(() => {
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    const arr = [...visible];
    switch (sortBy) {
      case 'name': arr.sort(byName); break;
      case 'brand': arr.sort((a, b) => String(a.brand || '').localeCompare(String(b.brand || '')) || byName(a, b)); break;
      case 'price_asc': arr.sort((a, b) => listPrice(a) - listPrice(b) || byName(a, b)); break;
      case 'price_desc': arr.sort((a, b) => listPrice(b) - listPrice(a) || byName(a, b)); break;
      case 'featured':
      default: arr.sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) || byName(a, b)); break;
    }
    return arr;
  }, [visible, sortBy]);

  const setSize = (size, delta) => setRoster((prev) => {
    const next = { ...prev, [size]: Math.max(0, (prev[size] || 0) + delta) };
    saveRoster(next);
    return next;
  });
  const clearRoster = () => { const next = emptyRoster(); saveRoster(next); setRoster(next); };
  const rosterTotal = SIZES.reduce((sum, s) => sum + (roster[s] || 0), 0);

  // Page-head title/breadcrumb: the active category's label (mockup treatment
  // like "Polos & Performance"), else "All Products".
  const title = activeCategory ? activeCategory.label : 'All Products';
  const subhead = activeCategory
    ? `Decoration-ready ${activeCategory.label.toLowerCase()} from the brands teams trust. Set your roster sizes once — they carry to every product and prefill your order.`
    : 'Decoration-ready gear from the brands teams trust. Set your roster sizes once — they carry to every product and prefill your order.';

  return (
    <div className="nts-root" style={{ width: '100%' }}>
      {/* ---- Page head band ---- */}
      <div style={{ background: OFF_WHITE, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(28px, 4vw, 48px) 24px' }}>
          <div style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 12 }}>
            <span>Home</span>
            <span style={{ margin: '0 8px', color: BORDER_DARK }}>/</span>
            <span>Apparel</span>
            <span style={{ margin: '0 8px', color: BORDER_DARK }}>/</span>
            <span style={{ color: NAVY, fontWeight: 600 }}>{title}</span>
          </div>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 6px' })}>Team apparel</p>
          <h1 style={displayType('clamp(2.2rem, 4vw, 3rem)', { color: NAVY, margin: '0 0 10px', letterSpacing: '0.01em' })}>{title}</h1>
          <p style={{ fontSize: 'clamp(15px, 1.4vw, 17px)', color: TEXT_MUTED, margin: 0, maxWidth: 600, lineHeight: 1.6 }}>{subhead}</p>

          {/* ---- Category chip row: All + the launch categories ---- */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
            <button
              type="button"
              onClick={() => setCategoryKey(null)}
              aria-pressed={!categoryKey}
              style={{
                fontFamily: 'inherit', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
                padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${!categoryKey ? NAVY : BORDER_DARK}`,
                background: !categoryKey ? NAVY : '#fff',
                color: !categoryKey ? '#fff' : TEXT,
              }}
            >
              All
            </button>
            {LAUNCH_CATEGORIES.map((cat) => {
              const active = categoryKey === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setCategoryKey(cat.key)}
                  aria-pressed={active}
                  style={{
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
                    padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${active ? NAVY : BORDER_DARK}`,
                    background: active ? NAVY : '#fff',
                    color: active ? '#fff' : TEXT,
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- Listing: roster strip -> filter chips -> toolbar -> grid ---- */}
      <section style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(28px, 3.5vw, 44px) 24px clamp(48px, 6vw, 80px)' }}>

        {/* Roster strip (moved out of the sidebar per the v2 mockup — display/
            persist only, see the ROSTER_KEY comment above). */}
        <div style={{ background: OFF_WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 24px', position: 'relative', overflow: 'hidden', marginBottom: 22 }}>
          <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: RED }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(20px, 3vw, 40px)', flexWrap: 'wrap' }}>
            <div style={{ flex: 'none', maxWidth: 230 }}>
              <span style={displayType(16, { letterSpacing: '0.08em', color: NAVY, display: 'block' })}>Your roster sizes</span>
              <span style={{ fontSize: 13, color: TEXT_MUTED, lineHeight: 1.4, display: 'block', marginTop: 2 }}>Set it once — it prefills every product.</span>
            </div>
            <div style={{ flex: 1, display: 'flex', gap: 'clamp(10px, 1.5vw, 20px)', flexWrap: 'wrap', alignItems: 'center' }}>
              {SIZES.map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={displayType(14, { letterSpacing: '0.05em', color: TEXT_MUTED, minWidth: 26 })}>{s}</span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', background: '#fff', border: `1px solid ${BORDER_DARK}`, borderRadius: 999, overflow: 'hidden' }}>
                    <button type="button" onClick={() => setSize(s, -1)} aria-label={`Decrease ${s}`} style={{ width: 30, height: 30, border: 'none', background: 'transparent', color: TEXT_MUTED, fontSize: 17, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>–</button>
                    <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700, fontSize: 15, color: roster[s] > 0 ? NAVY : BORDER_DARK }}>{roster[s] || 0}</span>
                    <button type="button" onClick={() => setSize(s, 1)} aria-label={`Increase ${s}`} style={{ width: 30, height: 30, border: 'none', background: 'transparent', color: TEXT_MUTED, fontSize: 16, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 18, borderLeft: `1px solid ${BORDER}`, paddingLeft: 'clamp(18px, 2.5vw, 28px)' }}>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 11, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, display: 'block' }}>Roster total</span>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 26, color: rosterTotal > 0 ? NAVY : BORDER_DARK, lineHeight: 1.1 }}>
                  {rosterTotal} <span style={{ fontSize: 13, fontWeight: 500, color: TEXT_FAINT }}>pcs</span>
                </span>
              </div>
              {rosterTotal > 0 && (
                <button type="button" onClick={clearRoster} style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: TEXT_FAINT, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }} className="nts-navlink">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filter chips: brand (real, server-page client filter) + search +
            decoration (visual only — see TODO(decoration-filter) below). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {brandCounts.length > 0 && (
            <>
              <span style={displayType(13, { letterSpacing: '0.08em', color: TEXT_FAINT })}>Brand</span>
              {brandCounts.map(([b, count]) => {
                const active = selectedBrands.includes(b);
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleBrand(b)}
                    aria-pressed={active}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
                      padding: '8px 15px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                      background: active ? NAVY : '#fff', color: active ? '#fff' : NAVY,
                      border: `1px solid ${active ? NAVY : BORDER_DARK}`,
                    }}
                  >
                    {b} <span style={{ fontSize: 11, fontWeight: 600, color: active ? 'rgba(255,255,255,0.65)' : TEXT_FAINT }}>{count}</span>
                  </button>
                );
              })}
              <span aria-hidden="true" style={{ width: 1, height: 22, background: BORDER, margin: '0 4px' }} />
            </>
          )}
          <span style={displayType(13, { letterSpacing: '0.08em', color: TEXT_FAINT })}>Decoration</span>
          {/* Decoration filter — VISUAL ONLY per the mockup's spec.
              TODO(decoration-filter): wire to a real decoration-capability
              facet when one exists on products. */}
          <span aria-hidden="true" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {['Embroidery', 'DTF Print', 'Heat Applications'].map((d) => (
              <span key={d} style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 999, background: '#fff', color: NAVY, border: `1px solid ${BORDER_DARK}` }}>{d}</span>
            ))}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <label htmlFor="nts-catalog-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search</label>
            <input
              id="nts-catalog-search"
              className="nts-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, SKU, or brand"
              style={{ padding: '9px 14px', border: `1px solid ${BORDER_DARK}`, borderRadius: 999, fontSize: 14, fontFamily: 'inherit', color: TEXT, width: 220 }}
            />
          </span>
        </div>

        {/* Count + sort */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24, paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
          <span style={{ fontSize: 14, color: TEXT_MUTED }}>
            <strong style={{ color: NAVY, fontWeight: 600 }}>{visible.length}</strong> products
            {rosterTotal > 0 ? ` · sized for your roster of ${rosterTotal}` : ''}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label htmlFor="nts-sort" style={{ fontSize: 13, color: TEXT_MUTED }}>Sort</label>
            <select
              id="nts-sort"
              value={sortBy}
              onChange={(e) => changeSort(e.target.value)}
              className="nts-navlink"
              style={{ fontSize: 14, fontWeight: 600, color: NAVY, border: `1px solid ${BORDER_DARK}`, borderRadius: 8, padding: '8px 14px', background: '#fff', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <option value="featured">Featured</option>
              <option value="name">Name: A–Z</option>
              <option value="brand">Brand: A–Z</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>
        </div>

        {loading && <p style={{ color: TEXT_MUTED, fontSize: 14 }}>Loading…</p>}
        {!loading && error && <p style={{ color: '#dc2626', fontSize: 14 }}>{error}</p>}
        {!loading && !error && !visible.length && (
          <div style={{ border: `1px dashed ${BORDER_DARK}`, borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
            <p style={displayType(18, { color: NAVY, margin: '0 0 6px' })}>No garments found</p>
            <p style={{ color: TEXT_MUTED, fontSize: 14, margin: 0 }}>Try a different search or clear the brand filter.</p>
          </div>
        )}

        {/* Product grid: full-width, 4-across (nts-product-grid, theme.js). */}
        <div className="nts-product-grid">
          {sorted.map((p) => (
            <CatalogCard key={p.id} product={p} stock={stock.get(p.id)} onSelect={onSelectProduct} onAddBlank={onAddBlank} />
          ))}
        </div>
      </section>
    </div>
  );
}
