import React, { useEffect, useMemo, useState } from 'react';
import { supabaseCoach } from '../lib/supabaseCoach';
import { fetchStockMap } from '../lib/storeInventory';
import CatalogCard from './CatalogCard';
import {
  ensureTeamShopStyles, NAVY, NAVY_DARK, RED, RED_SOFT, OFF_WHITE, BORDER,
  BORDER_DARK, TEXT, TEXT_MUTED, TEXT_FAINT, displayType,
} from './theme';

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
// Visual design: the approved "Shop - Polos" Claude Design mockup — page-head
// band with breadcrumb/eyebrow/title, filter sidebar (roster sizes, brand,
// decoration), results toolbar (count + sort), 3:4 product-card grid. The
// mockup's category page is implemented generically: the head/breadcrumb are
// driven by the current search, defaulting to an all-products view.
export default function Catalog({ onSelectProduct, onAddBlank }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [selectedBrands, setSelectedBrands] = useState([]); // multi-select; empty = all
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
        p_category: null,
        p_vendor_id: null,
        p_color_category: null,
        p_in_stock: false,
        p_limit: PAGE_SIZE,
        p_offset: 0,
      });
      if (!alive) return;
      if (rpcErr) { setError('Could not load the catalog'); setLoading(false); return; }
      const rows = data || [];
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
  }, [debounced]);

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

  // Generic category head: the mockup is a "Polos & Performance" category page;
  // we keep that title only when the search is polo-scoped, else all products.
  const isPolos = /polo/i.test(debounced);
  const title = isPolos ? 'Polos & Performance' : 'All Products';
  const subhead = isPolos
    ? 'Decoration-ready polos from the brands teams trust. Set your roster sizes once — they carry to every product and prefill your order.'
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
        </div>
      </div>

      {/* ---- Listing: filter sidebar + product grid ---- */}
      <section className="nts-listing" style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(28px, 3.5vw, 44px) 24px clamp(48px, 6vw, 80px)' }}>
        <aside className="nts-sidebar">
          {/* Search (existing behavior; the mockup's header search icon is inert) */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
            <label htmlFor="nts-catalog-search" style={displayType(15, { letterSpacing: '0.08em', color: NAVY, display: 'block', marginBottom: 14 })}>Search</label>
            <input
              id="nts-catalog-search"
              className="nts-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, SKU, or brand"
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, fontSize: 14, fontFamily: 'inherit', color: TEXT }}
            />
          </div>

          {/* Roster sizes (hero filter from the mockup — display/persist only) */}
          <div style={{ background: `linear-gradient(160deg, #1c2d4f, ${NAVY} 65%, ${NAVY_DARK})`, borderRadius: 14, padding: 18, color: '#fff', position: 'relative', overflow: 'hidden' }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: RED_SOFT }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={RED_SOFT} strokeWidth="1.9" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h10" /></svg>
              <span style={displayType(16, { letterSpacing: '0.08em' })}>Your roster sizes</span>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
              Enter how many of each size your team needs. It saves and prefills every product.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9 }}>
              {SIZES.map((s) => (
                <div key={s} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, padding: '7px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, minWidth: 0 }}>
                  <span style={displayType(12, { color: 'rgba(255,255,255,0.85)' })}>{s}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                    <button type="button" onClick={() => setSize(s, -1)} aria-label={`Decrease ${s}`} style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: '#fff', fontSize: 14, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>–</button>
                    <span style={{ minWidth: 14, textAlign: 'center', fontSize: 13, fontWeight: 600, color: roster[s] > 0 ? '#fff' : 'rgba(255,255,255,0.4)' }}>{roster[s] || 0}</span>
                    <button type="button" onClick={() => setSize(s, 1)} aria-label={`Increase ${s}`} style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: '#fff', fontSize: 13, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Roster total</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: '#fff' }}>
                {rosterTotal} <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>pcs</span>
              </span>
            </div>
            <button type="button" onClick={clearRoster} className="nts-ghost" style={{ marginTop: 12, width: '100%', background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 8, padding: 9, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Clear list
            </button>
          </div>

          {/* Brand filter (multi-select; drives the existing client-side brand filter) */}
          {brandCounts.length > 0 && (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
              <span style={displayType(15, { letterSpacing: '0.08em', color: NAVY, display: 'block', marginBottom: 14 })}>Brand</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {brandCounts.map(([b, count]) => {
                  const active = selectedBrands.includes(b);
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => toggleBrand(b)}
                      aria-pressed={active}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                    >
                      <span style={{ width: 20, height: 20, borderRadius: 6, border: active ? `1.5px solid ${NAVY}` : `1.5px solid ${BORDER_DARK}`, background: active ? NAVY : 'transparent', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" style={{ opacity: active ? 1 : 0 }} aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>
                      </span>
                      <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: TEXT }}>{b}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: TEXT_FAINT }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Decoration filter — VISUAL ONLY per the mockup's spec.
              TODO(decoration-filter): wire to a real decoration-capability
              facet when one exists on products. */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }} aria-hidden="true">
            <span style={displayType(15, { letterSpacing: '0.08em', color: NAVY, display: 'block', marginBottom: 14 })}>Decoration</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {['Embroidery', 'DTF Print', 'Heat Press'].map((d) => (
                <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${BORDER_DARK}`, flex: 'none' }} />
                  <span style={{ fontSize: 14, color: TEXT }}>{d}</span>
                </span>
              ))}
            </div>
          </div>
        </aside>

        <div>
          {/* Results toolbar: count + roster hint + (inert) sort */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
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

          <div className="nts-product-grid">
            {sorted.map((p) => (
              <CatalogCard key={p.id} product={p} stock={stock.get(p.id)} onSelect={onSelectProduct} onAddBlank={onAddBlank} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
