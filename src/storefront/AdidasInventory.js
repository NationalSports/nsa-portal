/* eslint-disable */
// Public coach-facing adidas inventory reference at /adidas.
// Joins the portal's adidas product catalog (products, brand=Adidas) with live
// per-size availability from adidas Cowork (adidas_inventory, synced by the
// Mac Mini cron — see scripts/adidas-cowork-sync.js). Read-only: no cart, no
// pricing internals (nsa_cost is never selected), just what coaches can order.
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Type system aligned with the NSA marketing site (same as Storefront.js)
const DISPLAY = "'Barlow Condensed','Oswald','Helvetica Neue',Impact,sans-serif";
const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const PAGE_SIZE = 96; // cards rendered per "Show more" chunk

// Canonical size ordering for apparel labels; footwear sizes sort numerically after.
const SIZE_ORDER = [
  '3XS', '2XS', 'XXS', 'XS', '2XS/XS', 'XS/S', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL',
  'XL', 'XL/2XL', '2XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
  'ST', 'MT', 'LT', 'XLT', '2XLT', '3XLT', '4XLT',
  'OSFA', 'ONE SIZE', 'OS', 'NS',
];
const sizeRank = (s) => {
  const up = String(s || '').trim().toUpperCase();
  const i = SIZE_ORDER.indexOf(up);
  if (i !== -1) return i;
  const m = up.match(/^(\d+(?:\.\d+)?)(-)?$/); // footwear: "10" or "10-" (= 10.5)
  if (m) return 500 + parseFloat(m[1]) + (m[2] ? 0.5 : 0);
  return 400; // unknown labels between apparel and footwear
};
const sizeLabel = (s) => {
  const m = String(s || '').trim().match(/^(\d+(?:\.\d+)?)-$/);
  return m ? m[1] + '½' : s; // "10-" → "10½"
};

const fmtQty = (q) => (q > 999 ? '999+' : String(q));
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtPrice = (p) => {
  const n = Number(p);
  if (!n) return null;
  return '$' + (Number.isInteger(n) ? n : n.toFixed(2));
};

// Light category cleanup so near-duplicate labels land in one bucket.
const CATEGORY_ALIASES = { Hood: 'Hoods', Jerseys: 'Jersey', 'Jersey Tops': 'Jersey', 'Jersey Bottoms': 'Jersey' };
const normCategory = (c) => CATEGORY_ALIASES[c] || c || 'Other';

async function fetchAllPages(buildQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function Styles() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        .ai-root *{box-sizing:border-box}
        .ai-root{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;background:#F4F5F7;color:#191919;min-height:100vh}
        .ai-root ::selection{background:#191919;color:#fff}
        .ai-card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,26,56,.08);transition:transform .16s ease, box-shadow .16s ease;display:flex;flex-direction:column}
        .ai-card:hover{transform:translateY(-3px);box-shadow:0 14px 32px rgba(15,26,56,.13)}
        .ai-chipgrid{display:flex;flex-wrap:wrap;gap:5px}
        .ai-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid #E2E5EA;border-radius:6px;padding:2px 7px;font-size:12px;font-weight:600;background:#FAFBFC;white-space:nowrap}
        .ai-chip b{font-weight:700}
        .ai-filterbtn{border:1px solid #D8DCE2;background:#fff;border-radius:999px;padding:5px 14px;font-size:13px;font-weight:600;cursor:pointer;color:#3A4150;white-space:nowrap;transition:background .12s,color .12s,border-color .12s;font-family:inherit}
        .ai-filterbtn:hover{border-color:#191919}
        .ai-filterbtn.on{background:#191919;color:#fff;border-color:#191919}
        .ai-search{width:100%;border:1px solid #D8DCE2;border-radius:10px;padding:10px 14px;font-size:15px;font-family:inherit;outline:none;background:#fff}
        .ai-search:focus{border-color:#191919;box-shadow:0 0 0 3px rgba(25,25,25,.08)}
        .ai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
        @media (max-width:560px){.ai-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}}
        .ai-more{display:block;margin:28px auto;border:2px solid #191919;background:#fff;color:#191919;border-radius:999px;padding:11px 38px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .12s,color .12s}
        .ai-more:hover{background:#191919;color:#fff}
      `}</style>
    </>
  );
}

const STRIPES = (
  // adidas three-bar motif for image placeholders
  <svg width="56" height="44" viewBox="0 0 56 44" fill="none" aria-hidden="true">
    <g fill="#D6DAE0">
      <path d="M2 44L18 16l8 14-8 14H2z" />
      <path d="M22 44L40 12l8 14-10.3 18H22z" />
      <path d="M44 44L56 23v21H44z" />
    </g>
  </svg>
);

function ProductCard({ p }) {
  const [imgErr, setImgErr] = useState(false);
  const img = !imgErr && (p.image_front_url || p.image_back_url);
  const price = fmtPrice(p.retail_price);
  const inStock = p.sizes.filter((s) => s.q > 0);
  // Incoming = out-of-stock sizes with a known delivery; grouped by date.
  const incoming = {};
  for (const s of p.sizes) {
    if (s.q > 0 || !s.fd || !s.fq) continue;
    (incoming[s.fd] = incoming[s.fd] || []).push(s);
  }
  const incomingDates = Object.keys(incoming).sort().slice(0, 2);

  return (
    <div className="ai-card">
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4' }}>
        {img ? (
          <img src={img} alt={p.name} loading="lazy" onError={() => setImgErr(true)}
            style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#A8AEB8', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
            {STRIPES}
            Image coming soon
          </div>
        )}
        {price && (
          <span style={{ position: 'absolute', top: 10, right: 10, background: '#191919', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700 }}>{price}</span>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, lineHeight: 1.15, textTransform: 'uppercase' }}>{p.displayName}</div>
          <div style={{ fontSize: 12, color: '#6A7180', marginTop: 3 }}>
            {p.sku}{p.color ? ' · ' + p.color : ''}
          </div>
        </div>
        {inStock.length > 0 ? (
          <div className="ai-chipgrid">
            {inStock.map((s) => (
              <span key={s.size} className="ai-chip" title={`${fmtQty(s.q)} available`}>
                {sizeLabel(s.size)} <b style={{ color: s.q >= 24 ? '#15803D' : '#B45309' }}>{fmtQty(s.q)}</b>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 600, color: '#B45309' }}>Out of stock — incoming below</div>
        )}
        {incomingDates.length > 0 && (
          <div style={{ fontSize: 11.5, color: '#6A7180', borderTop: '1px dashed #E6E8EC', paddingTop: 7, marginTop: 'auto' }}>
            {incomingDates.map((d) => (
              <div key={d} style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontWeight: 700, color: '#3A4150', whiteSpace: 'nowrap' }}>Inbound {fmtDate(d)}:</span>
                <span>{incoming[d].map((s) => `${sizeLabel(s.size)} (${fmtQty(s.fq)})`).join(', ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdidasInventory() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [includeIncoming, setIncludeIncoming] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const searchRef = useRef(null);

  useEffect(() => { document.title = 'adidas Team Inventory | National Sports Apparel'; }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [prods, inv] = await Promise.all([
          fetchAllPages(() => supabase
            .from('products')
            .select('sku,name,color,category,retail_price,image_front_url,image_back_url')
            .ilike('brand', 'adidas')
            .eq('is_active', true)
            .or('is_archived.is.null,is_archived.eq.false')
            .order('sku')),
          fetchAllPages(() => supabase
            .from('adidas_inventory')
            .select('sku,size,stock_qty,future_delivery_date,future_delivery_qty,last_synced')
            .or('stock_qty.gt.0,future_delivery_qty.gt.0')
            .order('id')),
        ]);
        if (!alive) return;

        const bySku = {};
        let synced = null;
        for (const r of inv) {
          (bySku[r.sku] = bySku[r.sku] || []).push({ size: r.size, q: r.stock_qty || 0, fd: r.future_delivery_date, fq: r.future_delivery_qty });
          if (r.last_synced && (!synced || r.last_synced > synced)) synced = r.last_synced;
        }

        const seen = new Set();
        const joined = [];
        for (const p of prods) {
          if (!p.sku || seen.has(p.sku)) continue; // catalog can carry the same SKU twice (e.g. re-imports)
          const sizes = bySku[p.sku];
          if (!sizes) continue; // no Cowork data — can't vouch for availability
          seen.add(p.sku);
          sizes.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
          joined.push({
            ...p,
            category: normCategory(p.category),
            displayName: p.name.replace(/^adidas\s+/i, ''),
            sizes,
            stockUnits: sizes.reduce((a, s) => a + (s.q > 0 ? s.q : 0), 0),
            hasIncoming: sizes.some((s) => !s.q && s.fd && s.fq),
          });
        }
        joined.sort((a, b) => a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName) || a.sku.localeCompare(b.sku));
        setProducts(joined);
        setLastSynced(synced);
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setError(e.message || String(e));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!(p.stockUnits > 0 || (includeIncoming && p.hasIncoming))) return false;
      if (category !== 'All' && p.category !== category) return false;
      if (q && !(`${p.name} ${p.sku} ${p.color || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [products, search, category, includeIncoming]);

  const categories = useMemo(() => {
    const counts = {};
    for (const p of products) {
      if (p.stockUnits > 0 || (includeIncoming && p.hasIncoming)) counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return Object.keys(counts).sort().map((c) => ({ c, n: counts[c] }));
  }, [products, includeIncoming]);

  useEffect(() => { setShown(PAGE_SIZE); }, [search, category, includeIncoming]);

  const onSearch = useCallback((e) => setSearch(e.target.value), []);

  return (
    <div className="ai-root" style={{ fontFamily: BODY }}>
      <Styles />

      {/* Header */}
      <header style={{ background: '#191919', color: '#fff' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '26px 20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 'clamp(30px,5vw,44px)', margin: 0, textTransform: 'uppercase', letterSpacing: '.01em' }}>
              adidas Team Inventory
            </h1>
            <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: '#9AA1AC', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              National Sports Apparel
            </span>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: '#C3C8D0', maxWidth: 760, lineHeight: 1.5 }}>
            Live availability from the adidas warehouse for the styles we carry.
            Quantities change daily{lastSynced ? ` — last updated ${new Date(lastSynced).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}.
            To place an order, contact your National Sports Apparel rep.
          </p>
        </div>
      </header>

      {/* Filter bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(244,245,247,.94)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #E6E8EC' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', maxWidth: 420 }}>
              <input ref={searchRef} className="ai-search" placeholder="Search by style, SKU, or color…" value={search} onChange={onSearch} />
            </div>
            <button className={'ai-filterbtn' + (includeIncoming ? ' on' : '')} onClick={() => setIncludeIncoming(v => !v)}
              title="Also show styles that are out of stock now but have confirmed inbound deliveries">
              {includeIncoming ? '✓ ' : ''}Include incoming
            </button>
            <span style={{ fontSize: 13, color: '#6A7180', fontWeight: 600, marginLeft: 'auto' }}>
              {loading ? 'Loading…' : `${visible.length} style${visible.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {!loading && categories.length > 1 && (
            <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
              <button className={'ai-filterbtn' + (category === 'All' ? ' on' : '')} onClick={() => setCategory('All')}>All</button>
              {categories.map(({ c, n }) => (
                <button key={c} className={'ai-filterbtn' + (category === c ? ' on' : '')} onClick={() => setCategory(c)}>
                  {c} <span style={{ opacity: .55, fontWeight: 500 }}>{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <main style={{ maxWidth: 1240, margin: '0 auto', padding: '22px 20px 60px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#6A7180', fontSize: 15 }}>
            Loading live inventory…
          </div>
        )}
        {!loading && error && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#B91C1C', fontSize: 15 }}>
            Couldn't load inventory ({error}). Please refresh, or contact your NSA rep.
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#6A7180', fontSize: 15 }}>
            No styles match{search ? ` “${search}”` : ''}. Try clearing filters{includeIncoming ? '' : ' or turning on “Include incoming”'}.
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="ai-grid">
              {visible.slice(0, shown).map((p) => <ProductCard key={p.sku} p={p} />)}
            </div>
            {visible.length > shown && (
              <button className="ai-more" onClick={() => setShown(s => s + PAGE_SIZE * 2)}>
                Show more ({visible.length - shown} remaining)
              </button>
            )}
          </>
        )}
      </main>

      <footer style={{ background: '#191919', color: '#9AA1AC', fontSize: 12.5, lineHeight: 1.6 }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '22px 20px' }}>
          Availability reflects the adidas B2B warehouse and is updated automatically — quantities are not guaranteed until ordered.
          “Inbound” dates are adidas's projected delivery dates for restocks.
          <span style={{ display: 'block', marginTop: 6, color: '#C3C8D0', fontWeight: 600 }}>
            National Sports Apparel · nationalsportsapparel.com
          </span>
        </div>
      </footer>
    </div>
  );
}
