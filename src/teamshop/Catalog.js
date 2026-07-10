import React, { useEffect, useMemo, useState } from 'react';
import { supabaseCoach } from '../lib/supabaseCoach';
import { fetchStockMap } from '../lib/storeInventory';
import CatalogCard from './CatalogCard';

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

// Anonymous garment catalog browse — no sign-in required. Reuses the
// `search_products` RPC (see src/lib/dbEngine.js _searchProductsServer for the
// staff-side call shape), which is GRANTed to the `anon` role
// (supabase/migrations/00151_search_products_exclude_api_vendors.sql), and the
// isolated supabaseCoach client (same one CoachGate/AdidasInventory use) so
// browsing works whether or not a coach happens to be signed in.
export default function Catalog({ onSelectProduct }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [brand, setBrand] = useState('All');
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const brands = useMemo(() => [...new Set(products.map((p) => p.brand).filter(Boolean))].sort(), [products]);
  const visible = useMemo(() => (brand === 'All' ? products : products.filter((p) => p.brand === brand)), [products, brand]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 16px' }}>Browse Garments</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, SKU, or brand"
          style={{ flex: '1 1 260px', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }}
        />
        {brands.length > 1 && (
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            style={{ padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }}
          >
            <option value="All">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>

      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}
      {!loading && error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {!loading && !error && !visible.length && <p style={{ color: '#64748b' }}>No garments found.</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 18 }}>
        {visible.map((p) => (
          <CatalogCard key={p.id} product={p} stock={stock.get(p.id)} onSelect={onSelectProduct} />
        ))}
      </div>
    </div>
  );
}
