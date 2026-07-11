import React, { useEffect, useMemo, useState } from 'react';
import { supabaseCoach } from '../lib/supabaseCoach';
import CatalogCard from './CatalogCard';
import {
  NAVY, NAVY_DARK, RED_SOFT, BORDER_DARK, TEXT, TEXT_MUTED, displayType,
} from './theme';
import { LAUNCH_CATEGORIES, categoryForProduct, inLaunchCategories } from './categories';
import { groupByStyle } from './colorways';

// "Search" — the approved Claude Design mock, mapped onto the REAL backend:
// same `search_products` RPC + `supabaseCoach` client Catalog.js already
// uses for its own search box (p_query text search is already server-side —
// no TODO(server-text-search) needed here, this IS the server text search),
// and the same colorway-grouped CatalogCard grid, never a forked card.
//
// Category chips use the real 9 launch categories (categories.js) — NOT the
// mock's 'Caps'/'Uniforms' placeholders — with counts computed from the
// loaded result page, same convention as Catalog.js's brand/color chip
// counts (TODO(server-pagination) applies here the same way it does there:
// counts reflect the loaded page, not the whole catalog).
//
// props:
//   onSelectProduct  — (product) => void. A result card click; TeamShopApp
//     wires this to the same previewProduct/ProductPage flow the top-level
//     catalog uses.
//   onBrowseCatalog  — () => void. The empty state's "Browse all apparel".
const PAGE_SIZE = 200;
const POPULAR = ['Polos', 'Hoodies', 'Hats', 'adidas', 'Nike'];

// Same tiny debounce hook as Catalog.js's useDebounced (not exported there —
// this is the same 300ms-debounce-the-search-box pattern, not a fork of any
// business logic).
function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function Search({ onSelectProduct, onBrowseCatalog }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const [categoryKey, setCategoryKey] = useState(null); // null = All
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      const { data, error: rpcErr } = await supabaseCoach.rpc('search_products', {
        p_query: debounced.trim() || null,
        p_category: null,
        p_vendor_id: null,
        p_color_category: null,
        p_in_stock: false,
        p_limit: PAGE_SIZE,
        p_offset: 0,
      });
      if (!alive) return;
      if (rpcErr) { setError('Could not run that search'); setLoading(false); return; }
      // Same launch-category client filter Catalog.js's 'All' view applies —
      // Team Shop never surfaces non-launch categories (socks, jerseys, ...).
      setProducts((data || []).filter(inLaunchCategories));
      setLoading(false);
      setSearched(true);
    })();
    return () => { alive = false; };
  }, [debounced]);

  const groups = useMemo(() => groupByStyle(products), [products]);

  const categoryCounts = useMemo(() => {
    const counts = new Map();
    groups.forEach((g) => {
      const cat = categoryForProduct(g.variants[0]);
      if (cat) counts.set(cat.key, (counts.get(cat.key) || 0) + 1);
    });
    return LAUNCH_CATEGORIES.map((c) => ({ ...c, count: counts.get(c.key) || 0 })).filter((c) => c.count > 0);
  }, [groups]);

  const visible = useMemo(() => {
    if (!categoryKey) return groups;
    return groups.filter((g) => {
      const cat = categoryForProduct(g.variants[0]);
      return cat && cat.key === categoryKey;
    });
  }, [groups, categoryKey]);

  const trimmed = debounced.trim();
  const headline = trimmed ? `Results for "${trimmed}"` : 'Browse the catalog';
  const clearSearch = () => { setQuery(''); setCategoryKey(null); };

  return (
    <div style={{ width: '100%' }}>
      {/* ============ HERO ============ */}
      <section style={{ background: NAVY_DARK, padding: 'clamp(48px, 6vw, 76px) 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 12px' })}>Search</p>
          <h1 style={displayType('clamp(1.9rem, 3.6vw, 2.6rem)', { color: '#fff', margin: '0 0 24px', lineHeight: 1.06, letterSpacing: '0.01em' })}>
            Find your gear
          </h1>
          <label htmlFor="nts-search-input" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search products</label>
          <input
            id="nts-search-input"
            className="nts-input"
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCategoryKey(null); }}
            placeholder="Search polos, hoodies, brands…"
            style={{
              width: '100%', padding: '15px 20px', border: 'none', borderRadius: 999,
              fontSize: 15, fontFamily: 'inherit', color: TEXT, background: '#fff', boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>Popular:</span>
            {POPULAR.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => { setQuery(term); setCategoryKey(null); }}
                style={{
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 999,
                  cursor: 'pointer', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ============ RESULTS ============ */}
      <section style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(28px, 3.5vw, 44px) 24px clamp(48px, 6vw, 80px)' }}>
        <h2 style={displayType('clamp(1.4rem, 2.4vw, 1.8rem)', { color: NAVY, margin: '0 0 6px', letterSpacing: '0.01em' })}>{headline}</h2>
        {!loading && (
          <p style={{ margin: '0 0 20px', fontSize: 14, color: TEXT_MUTED }}>
            <strong style={{ color: NAVY, fontWeight: 600 }}>{visible.length}</strong> {visible.length === 1 ? 'result' : 'results'}
          </p>
        )}

        {categoryCounts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
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
              All <span style={{ fontSize: 11, fontWeight: 600, color: !categoryKey ? 'rgba(255,255,255,0.65)' : TEXT_MUTED }}>{groups.length}</span>
            </button>
            {categoryCounts.map((cat) => {
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
                  {cat.label} <span style={{ fontSize: 11, fontWeight: 600, color: active ? 'rgba(255,255,255,0.65)' : TEXT_MUTED }}>{cat.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {loading && <p style={{ color: TEXT_MUTED, fontSize: 14 }}>Searching…</p>}
        {!loading && error && <p style={{ color: '#dc2626', fontSize: 14 }}>{error}</p>}
        {!loading && !error && searched && !visible.length && (
          <div style={{ border: `1px dashed ${BORDER_DARK}`, borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
            <p style={displayType(18, { color: NAVY, margin: '0 0 6px' })}>No results</p>
            <p style={{ color: TEXT_MUTED, fontSize: 14, margin: '0 0 20px' }}>Try a different search term, or browse everything we carry.</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {onBrowseCatalog && (
                <button
                  type="button"
                  onClick={() => onBrowseCatalog()}
                  style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 14, background: NAVY, color: '#fff', border: 'none', padding: '11px 20px', borderRadius: 8, cursor: 'pointer' }}
                >
                  Browse all apparel
                </button>
              )}
              <button
                type="button"
                onClick={clearSearch}
                style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 14, background: '#fff', color: NAVY, border: `1px solid ${BORDER_DARK}`, padding: '11px 20px', borderRadius: 8, cursor: 'pointer' }}
              >
                Clear search
              </button>
            </div>
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="nts-product-grid">
            {visible.map((g) => (
              <CatalogCard key={g.key} group={g} stockMap={new Map()} onSelect={onSelectProduct} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
