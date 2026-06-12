/* eslint-disable */
// Public coach-facing adidas inventory catalog at /adidas.
// Joins the portal's adidas product catalog (products, brand=Adidas) with live
// per-size availability from adidas Cowork (adidas_inventory, synced by the
// Mac Mini cron — see scripts/adidas-cowork-sync.js). Read-only: no cart, no
// pricing internals (nsa_cost is never selected), just what coaches can order.
//
// Cards are grouped by STYLE (one card per item, colorways inside); coaches
// filter by item type, gender, sport, color, and size availability. Built to
// grow into a multi-brand catalog later (Sanmar, Momentec) — the grouping and
// filter logic only assume {sku,name,color,category,sizes[]} per variant.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Type system aligned with the NSA marketing site (same as Storefront.js)
const DISPLAY = "'Barlow Condensed','Oswald','Helvetica Neue',Impact,sans-serif";
const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const PAGE_SIZE = 72; // cards rendered per "Show more" chunk

// ── Sizes ────────────────────────────────────────────────────────────
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
// Size filter chips (apparel only — footwear runs are too granular to chip)
const FILTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
// "Strong run" = these sizes each ≥ STRONG_MIN units in a single colorway
const STRONG_SIZES = ['S', 'M', 'L', 'XL'];
const STRONG_MIN = 6;

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

// ── Category / color / gender / sport derivation ─────────────────────
// Light category cleanup so near-duplicate labels land in one bucket.
const CATEGORY_ALIASES = { Hood: 'Hoods', Jerseys: 'Jersey', 'Jersey Tops': 'Jersey', 'Jersey Bottoms': 'Jersey' };
const normCategory = (c) => CATEGORY_ALIASES[c] || c || 'Other';

const COLOR_DOTS = {
  Black: '#191919', White: '#FFFFFF', Grey: '#9AA1AC', Red: '#C8102E', Orange: '#EA580C',
  Yellow: '#EAB308', Green: '#15803D', Blue: '#2563EB', Purple: '#6D28D9', Pink: '#EC4899',
  Brown: '#7C4A21', Other: '#CBD5E1',
};
const COLOR_FAMILIES = Object.keys(COLOR_DOTS);
// Fallback when products.color_category is empty: classify from the color
// string, scanning the first colorway segment before the whole string.
const FAMILY_RULES = [
  ['Black', /BLACK/], ['White', /WHITE|CREAM|IVORY/],
  ['Grey', /GREY|GRAY|SILVER|CHARCOAL|HEATHER|ONIX|CARBON|GRANITE/],
  ['Red', /\bRED\b|SCARLET|CRIMSON|BURGUNDY|MAROON|CARDINAL/],
  ['Orange', /ORANGE|AMBER/], ['Yellow', /YELLOW|GOLD|LEMON|SOLAR/],
  ['Green', /GREEN|FOREST|MINT|OLIVE/], ['Blue', /BLUE|NAVY|ROYAL|AQUA|TEAL|SKY|INDIGO/],
  ['Purple', /PURPLE|VIOLET|REGAL/], ['Pink', /PINK|MAGENTA|ROSE|FUCHSIA/],
  ['Brown', /BROWN|KHAKI|TAN\b|EARTH/],
];
const COLOR_CATEGORY_ALIASES = { 'Light Grey': 'Grey', 'Vegas Gold': 'Yellow', Royal: 'Blue' };
function colorFamily(colorCategory, colorStr) {
  const cc = COLOR_CATEGORY_ALIASES[colorCategory] || colorCategory;
  if (cc && COLOR_DOTS[cc]) return cc;
  const s = String(colorStr || '').toUpperCase();
  const first = s.split('/')[0];
  for (const part of [first, s]) {
    for (const [fam, re] of FAMILY_RULES) if (re.test(part)) return fam;
  }
  return 'Other';
}

// Gender from adidas naming conventions: leading W/M token, Youth / Y token,
// SKU suffix (catalog import appends W = women's, Y = youth), and for
// footwear the trailing M/W token ("DURAMO SL2 M").
function deriveGender(name, sku, category) {
  const tokens = String(name || '').replace(/^adidas\s+/i, '').toUpperCase().split(/\s+/);
  const skuUp = String(sku || '').toUpperCase();
  if (tokens.includes('YOUTH') || tokens.includes('Y') || /\dY$/.test(skuUp)) return 'Youth';
  if (tokens[0] === 'W' || tokens.some(t => /^WOMEN'?S?$/.test(t)) || /\dW$/.test(skuUp)) return "Women's";
  if (tokens[0] === 'M' || tokens.some(t => /^MEN'?S?$/.test(t))) return "Men's";
  if (category === 'Footwear') {
    const last = tokens[tokens.length - 1];
    if (last === 'W') return "Women's";
    if (last === 'M') return "Men's";
  }
  return 'Unisex';
}

// Best-effort sport tags from adidas line names; unmatched styles simply
// don't carry a sport tag and only show under "All sports".
const SPORT_RULES = [
  ['Soccer', /ESTRO|TIRO|SQUADRA|CONDIVO|ENTRADA|REGISTA|CAMPEON|FORTORE|GOALKEEPER|KEEPER|SOCCER/],
  ['Football', /A1 GHOST|NMPLATE|FOOTBALL|GRIDIRON/],
  ['Baseball / Softball', /\bVNJ\b|\b2BJ\b|ICON|DIAMOND|AFTERBURNER|BASEBALL|SOFTBALL/],
  ['Basketball', /BASKETBALL|REVERSIBLE|HOOPS|SELECT JERSEY/],
  ['Volleyball', /CRAZYFLIGHT|NOVAFLIGHT|VOLLEYBALL/],
  ['Golf', /ULTIMATE365|GOLF/],
  ['Running / Track', /DURAMO|SUPERNOVA|JUMPSTAR|RUNFALCON|QUESTAR|ADIZERO (SL|BOSTON|EVO)|SPRINT|TRACK/],
  ['Training & Sideline', /\bD4T\b|Z\.?N\.?E\.?|PREGAME|TECHFIT|3 STRIPE|FLEECE|STADIUM|TRAINING|WARM/],
];
function deriveSport(name) {
  const n = String(name || '').toUpperCase();
  for (const [sport, re] of SPORT_RULES) if (re.test(n)) return sport;
  return null;
}

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
        .ai-card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,26,56,.08);transition:transform .16s ease, box-shadow .16s ease;display:flex;flex-direction:column;cursor:pointer;border:none;padding:0;text-align:left;font-family:inherit}
        .ai-card:hover{transform:translateY(-3px);box-shadow:0 14px 32px rgba(15,26,56,.13)}
        .ai-chipgrid{display:flex;flex-wrap:wrap;gap:5px}
        .ai-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid #E2E5EA;border-radius:6px;padding:2px 7px;font-size:12px;font-weight:600;background:#FAFBFC;white-space:nowrap}
        .ai-chip b{font-weight:700}
        .ai-filterbtn{border:1px solid #D8DCE2;background:#fff;border-radius:999px;padding:5px 13px;font-size:13px;font-weight:600;cursor:pointer;color:#3A4150;white-space:nowrap;transition:background .12s,color .12s,border-color .12s;font-family:inherit}
        .ai-filterbtn:hover{border-color:#191919}
        .ai-filterbtn.on{background:#191919;color:#fff;border-color:#191919}
        .ai-select{border:1px solid #D8DCE2;background:#fff;border-radius:10px;padding:8px 10px;font-size:13.5px;font-weight:600;color:#3A4150;font-family:inherit;cursor:pointer;outline:none;max-width:180px}
        .ai-select:focus{border-color:#191919}
        .ai-search{width:100%;border:1px solid #D8DCE2;border-radius:10px;padding:9px 14px;font-size:15px;font-family:inherit;outline:none;background:#fff}
        .ai-search:focus{border-color:#191919;box-shadow:0 0 0 3px rgba(25,25,25,.08)}
        .ai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
        @media (max-width:560px){.ai-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}}
        .ai-more{display:block;margin:28px auto;border:2px solid #191919;background:#fff;color:#191919;border-radius:999px;padding:11px 38px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .12s,color .12s}
        .ai-more:hover{background:#191919;color:#fff}
        .ai-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(25,25,25,.18);display:inline-block;flex:none}
        .ai-badge{display:inline-block;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        .ai-modal-bg{position:fixed;inset:0;background:rgba(15,18,26,.55);z-index:50;display:flex;align-items:flex-start;justify-content:center;padding:4vh 14px;overflow-y:auto}
        .ai-modal{background:#fff;border-radius:16px;max-width:860px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.35);margin-bottom:6vh}
        .ai-cwrow{display:flex;gap:14px;padding:14px 0;border-top:1px solid #EEF0F3;align-items:flex-start}
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

const GENDER_BADGE = {
  "Women's": { bg: '#FCE7F3', fg: '#9D174D' },
  Youth: { bg: '#DBEAFE', fg: '#1E40AF' },
  "Men's": { bg: '#E5E7EB', fg: '#374151' },
};

function ColorDots({ colorways, max = 7 }) {
  const fams = [];
  const seen = new Set();
  for (const cw of colorways) {
    if (!seen.has(cw.family)) { seen.add(cw.family); fams.push(cw.family); }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {fams.slice(0, max).map((f) => <span key={f} className="ai-dot" style={{ background: COLOR_DOTS[f] || '#CBD5E1' }} title={f} />)}
      <span style={{ fontSize: 12, color: '#6A7180', fontWeight: 600, marginLeft: 2 }}>
        {colorways.length} {colorways.length === 1 ? 'color' : 'colors'}
      </span>
    </span>
  );
}

function ImageBox({ img, alt, height }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [img]);
  return img && !err ? (
    <img src={img} alt={alt} loading="lazy" onError={() => setErr(true)}
      style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} />
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#A8AEB8', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
      {STRIPES}
      Image coming soon
    </div>
  );
}

// ── Style card (one per item; colorways summarized) ──────────────────
function StyleCard({ st, matchCws, onOpen }) {
  const cover = matchCws.find((c) => c.img) || st.colorways.find((c) => c.img);
  const price = st.priceMin === st.priceMax
    ? fmtPrice(st.priceMin)
    : `${fmtPrice(st.priceMin)}–${fmtPrice(st.priceMax)}`;
  const gb = GENDER_BADGE[st.gender];
  // Union of in-stock sizes across the colorways that match current filters
  const sizes = [...new Set(matchCws.flatMap((c) => [...c.inStock]))].sort((a, b) => sizeRank(a) - sizeRank(b));
  const incomingOnly = sizes.length === 0;
  return (
    <button className="ai-card" onClick={onOpen} aria-label={`${st.name} — view colors and stock`}>
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4', width: '100%' }}>
        <ImageBox img={cover && cover.img} alt={st.name} />
        {price && (
          <span style={{ position: 'absolute', top: 10, right: 10, background: '#191919', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700 }}>{price}</span>
        )}
        {gb && (
          <span className="ai-badge" style={{ position: 'absolute', top: 10, left: 10, background: gb.bg, color: gb.fg }}>{st.gender}</span>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, width: '100%' }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, lineHeight: 1.15, textTransform: 'uppercase' }}>{st.name}</div>
          <div style={{ fontSize: 12, color: '#6A7180', marginTop: 3 }}>
            {st.category}{st.sport ? ' · ' + st.sport : ''}
          </div>
        </div>
        <ColorDots colorways={matchCws.length ? matchCws : st.colorways} />
        {incomingOnly ? (
          <div style={{ fontSize: 12, fontWeight: 600, color: '#B45309' }}>Out of stock — restock dates inside</div>
        ) : (
          <div className="ai-chipgrid">
            {sizes.slice(0, 14).map((s) => <span key={s} className="ai-chip">{sizeLabel(s)}</span>)}
            {sizes.length > 14 && <span className="ai-chip" style={{ color: '#6A7180' }}>+{sizes.length - 14}</span>}
          </div>
        )}
        <div style={{ marginTop: 'auto', fontSize: 12, fontWeight: 700, color: '#3A4150', borderTop: '1px dashed #E6E8EC', paddingTop: 8 }}>
          View colors & stock →
        </div>
      </div>
    </button>
  );
}

// ── Style detail modal (per-colorway stock + inbound dates) ──────────
function StyleModal({ st, matchSet, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  // Colorways that match the current filters float to the top
  const cws = [...st.colorways].sort((a, b) => (matchSet.has(b.sku) - matchSet.has(a.sku)) || a.color.localeCompare(b.color));
  const gb = GENDER_BADGE[st.gender];

  return (
    <div className="ai-modal-bg" onClick={onClose}>
      <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, margin: 0, textTransform: 'uppercase', lineHeight: 1.05 }}>{st.name}</h2>
              {gb && <span className="ai-badge" style={{ background: gb.bg, color: gb.fg }}>{st.gender}</span>}
            </div>
            <div style={{ fontSize: 13, color: '#6A7180', marginTop: 4 }}>
              {st.category}{st.sport ? ' · ' + st.sport : ''} · {st.colorways.length} {st.colorways.length === 1 ? 'colorway' : 'colorways'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: '#F0F1F4', borderRadius: 8, width: 34, height: 34, fontSize: 17, cursor: 'pointer', fontWeight: 700, color: '#3A4150', flex: 'none' }}>✕</button>
        </div>
        <div style={{ padding: '0 24px 22px' }}>
          {cws.map((cw) => {
            const inStock = cw.sizes.filter((s) => s.q > 0);
            const incoming = {};
            for (const s of cw.sizes) {
              if (s.q > 0 || !s.fd || !s.fq) continue;
              (incoming[s.fd] = incoming[s.fd] || []).push(s);
            }
            const dates = Object.keys(incoming).sort().slice(0, 3);
            return (
              <div key={cw.sku} className="ai-cwrow" style={matchSet.has(cw.sku) ? undefined : { opacity: .55 }}>
                <div style={{ width: 76, height: 76, flex: 'none', background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <ImageBox img={cw.img} alt={cw.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="ai-dot" style={{ background: COLOR_DOTS[cw.family] || '#CBD5E1' }} />
                    <span style={{ fontWeight: 700, fontSize: 14.5 }}>{cw.color || cw.family}</span>
                    <span style={{ fontSize: 12, color: '#6A7180' }}>{cw.sku}</span>
                    {fmtPrice(cw.price) && <span style={{ fontSize: 12.5, fontWeight: 700, marginLeft: 'auto' }}>{fmtPrice(cw.price)}</span>}
                  </div>
                  <div className="ai-chipgrid" style={{ marginTop: 7 }}>
                    {inStock.length > 0 ? inStock.map((s) => (
                      <span key={s.size} className="ai-chip" title={`${fmtQty(s.q)} available`}>
                        {sizeLabel(s.size)} <b style={{ color: s.q >= 24 ? '#15803D' : '#B45309' }}>{fmtQty(s.q)}</b>
                      </span>
                    )) : (
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#B45309' }}>Out of stock</span>
                    )}
                  </div>
                  {dates.length > 0 && (
                    <div style={{ fontSize: 11.5, color: '#6A7180', marginTop: 6 }}>
                      {dates.map((d) => (
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
          })}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function AdidasInventory() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [styles, setStyles] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [gender, setGender] = useState('All');
  const [sport, setSport] = useState('All');
  const [color, setColor] = useState('All');
  const [sizeSel, setSizeSel] = useState([]);
  const [strongOnly, setStrongOnly] = useState(false);
  const [includeIncoming, setIncludeIncoming] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openStyle, setOpenStyle] = useState(null);

  useEffect(() => { document.title = 'adidas Team Catalog | National Sports Apparel'; }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [prods, inv] = await Promise.all([
          fetchAllPages(() => supabase
            .from('products')
            .select('sku,name,color,color_category,category,retail_price,image_front_url,image_back_url')
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

        // Build colorways, then group into styles by cleaned name.
        const seen = new Set();
        const styleMap = new Map();
        for (const p of prods) {
          if (!p.sku || seen.has(p.sku)) continue; // catalog can carry the same SKU twice (e.g. re-imports)
          const sizes = bySku[p.sku];
          if (!sizes) continue; // no Cowork data — can't vouch for availability
          seen.add(p.sku);
          sizes.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
          const inStock = new Set(sizes.filter((s) => s.q > 0).map((s) => s.size));
          const cat = normCategory(p.category);
          const cw = {
            sku: p.sku,
            color: p.color || '',
            family: colorFamily(p.color_category, p.color),
            img: p.image_front_url || p.image_back_url || '',
            price: Number(p.retail_price) || 0,
            sizes,
            inStock,
            units: sizes.reduce((a, s) => a + (s.q > 0 ? s.q : 0), 0),
            hasIncoming: sizes.some((s) => !s.q && s.fd && s.fq),
            strongRun: cat === 'Footwear'
              ? [...inStock].length >= 8
              : STRONG_SIZES.every((sz) => sizes.some((s) => s.size === sz && s.q >= STRONG_MIN)),
          };
          const displayName = p.name.replace(/^adidas\s+/i, '');
          const key = displayName.toUpperCase() + '|' + cat;
          let st = styleMap.get(key);
          if (!st) {
            st = {
              key,
              name: displayName,
              category: cat,
              gender: deriveGender(p.name, p.sku, cat),
              sport: deriveSport(p.name),
              colorways: [],
            };
            styleMap.set(key, st);
          }
          st.colorways.push(cw);
        }

        const grouped = [...styleMap.values()];
        for (const st of grouped) {
          st.colorways.sort((a, b) => b.units - a.units);
          const prices = st.colorways.map((c) => c.price).filter(Boolean);
          st.priceMin = prices.length ? Math.min(...prices) : 0;
          st.priceMax = prices.length ? Math.max(...prices) : 0;
          st.searchText = (st.name + ' ' + st.colorways.map((c) => c.sku + ' ' + c.color).join(' ')).toLowerCase();
        }
        grouped.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        setStyles(grouped);
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

  // Colorway-level filters: a style shows if ANY colorway passes all of them.
  const cwMatcher = useCallback((cw) => {
    if (color !== 'All' && cw.family !== color) return false;
    if (sizeSel.length && !sizeSel.every((s) => cw.inStock.has(s))) return false;
    if (strongOnly && !cw.strongRun) return false;
    if (cw.units === 0 && !(includeIncoming && cw.hasIncoming)) return false;
    return true;
  }, [color, sizeSel, strongOnly, includeIncoming]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = [];
    for (const st of styles) {
      if (category !== 'All' && st.category !== category) continue;
      if (gender !== 'All' && st.gender !== gender) continue;
      if (sport !== 'All' && st.sport !== sport) continue;
      if (q && !st.searchText.includes(q)) continue;
      const matchCws = st.colorways.filter(cwMatcher);
      if (!matchCws.length) continue;
      out.push({ st, matchCws });
    }
    return out;
  }, [styles, search, category, gender, sport, cwMatcher]);

  // Facet options (with counts under everything-but-this-facet filtering kept
  // simple: counts reflect the full availability mode, not cross-facets)
  const facets = useMemo(() => {
    const cats = {}, sports = {}, genders = {}, colors = {};
    for (const st of styles) {
      const anyAvail = st.colorways.some((c) => c.units > 0 || (includeIncoming && c.hasIncoming));
      if (!anyAvail) continue;
      cats[st.category] = (cats[st.category] || 0) + 1;
      genders[st.gender] = (genders[st.gender] || 0) + 1;
      if (st.sport) sports[st.sport] = (sports[st.sport] || 0) + 1;
      for (const c of st.colorways) {
        if (c.units > 0 || (includeIncoming && c.hasIncoming)) colors[c.family] = 1;
      }
    }
    return {
      categories: Object.keys(cats).sort().map((c) => ({ v: c, n: cats[c] })),
      genders: ["Men's", "Women's", 'Youth', 'Unisex'].filter((g) => genders[g]).map((g) => ({ v: g, n: genders[g] })),
      sports: Object.keys(sports).sort().map((s) => ({ v: s, n: sports[s] })),
      colors: COLOR_FAMILIES.filter((f) => colors[f]),
    };
  }, [styles, includeIncoming]);

  useEffect(() => { setShown(PAGE_SIZE); }, [search, category, gender, sport, color, sizeSel, strongOnly, includeIncoming]);

  const toggleSize = (s) => setSizeSel((sel) => sel.includes(s) ? sel.filter((x) => x !== s) : [...sel, s]);
  const clearFilters = () => { setSearch(''); setCategory('All'); setGender('All'); setSport('All'); setColor('All'); setSizeSel([]); setStrongOnly(false); };
  const hasFilters = search || category !== 'All' || gender !== 'All' || sport !== 'All' || color !== 'All' || sizeSel.length || strongOnly;

  const openData = openStyle && visible.find((v) => v.st.key === openStyle);
  const openFallback = openStyle && !openData && styles.find((s) => s.key === openStyle);

  return (
    <div className="ai-root" style={{ fontFamily: BODY }}>
      <Styles />

      {/* Header */}
      <header style={{ background: '#191919', color: '#fff' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '26px 20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 'clamp(30px,5vw,44px)', margin: 0, textTransform: 'uppercase', letterSpacing: '.01em' }}>
              adidas Team Catalog
            </h1>
            <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: '#9AA1AC', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              National Sports Apparel
            </span>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: '#C3C8D0', maxWidth: 780, lineHeight: 1.5 }}>
            Every style we carry, with a live look at what's in the adidas warehouse right now — by color and size —
            and when restocks land. Quantities change daily{lastSynced ? ` — last updated ${new Date(lastSynced).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}.
            To place an order, contact your National Sports Apparel rep.
          </p>
        </div>
      </header>

      {/* Filter bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(244,245,247,.94)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #E6E8EC' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', maxWidth: 340 }}>
              <input className="ai-search" placeholder="Search style, SKU, or color…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="ai-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Item type">
              <option value="All">All items</option>
              {facets.categories.map(({ v, n }) => <option key={v} value={v}>{v} ({n})</option>)}
            </select>
            <select className="ai-select" value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender">
              <option value="All">All genders</option>
              {facets.genders.map(({ v, n }) => <option key={v} value={v}>{v} ({n})</option>)}
            </select>
            <select className="ai-select" value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport">
              <option value="All">All sports</option>
              {facets.sports.map(({ v, n }) => <option key={v} value={v}>{v} ({n})</option>)}
            </select>
            <select className="ai-select" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color">
              <option value="All">All colors</option>
              {facets.colors.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <span style={{ fontSize: 13, color: '#6A7180', fontWeight: 600, marginLeft: 'auto' }}>
              {loading ? 'Loading…' : `${visible.length} style${visible.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6A7180', textTransform: 'uppercase', letterSpacing: '.05em' }}>In stock in:</span>
            {FILTER_SIZES.map((s) => (
              <button key={s} className={'ai-filterbtn' + (sizeSel.includes(s) ? ' on' : '')} style={{ padding: '3px 11px', fontSize: 12.5 }} onClick={() => toggleSize(s)}>{s}</button>
            ))}
            <span style={{ width: 1, height: 18, background: '#D8DCE2', margin: '0 3px' }} />
            <button className={'ai-filterbtn' + (strongOnly ? ' on' : '')} style={{ padding: '3px 11px', fontSize: 12.5 }} onClick={() => setStrongOnly(v => !v)}
              title={`Only colorways with ${STRONG_SIZES.join('–')} each at ${STRONG_MIN}+ units (footwear: 8+ sizes in stock)`}>
              Strong size runs
            </button>
            <button className={'ai-filterbtn' + (includeIncoming ? ' on' : '')} style={{ padding: '3px 11px', fontSize: 12.5 }} onClick={() => setIncludeIncoming(v => !v)}
              title="Also show colorways that are out of stock now but have confirmed inbound deliveries">
              Include incoming
            </button>
            {hasFilters && (
              <button className="ai-filterbtn" style={{ padding: '3px 11px', fontSize: 12.5, color: '#B91C1C', borderColor: '#F1C4C4' }} onClick={clearFilters}>✕ Clear</button>
            )}
          </div>
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
            No styles match those filters.
            {hasFilters && <div style={{ marginTop: 12 }}><button className="ai-filterbtn" onClick={clearFilters}>Clear all filters</button></div>}
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="ai-grid">
              {visible.slice(0, shown).map(({ st, matchCws }) => (
                <StyleCard key={st.key} st={st} matchCws={matchCws} onOpen={() => setOpenStyle(st.key)} />
              ))}
            </div>
            {visible.length > shown && (
              <button className="ai-more" onClick={() => setShown(s => s + PAGE_SIZE * 2)}>
                Show more ({visible.length - shown} remaining)
              </button>
            )}
          </>
        )}
      </main>

      {(openData || openFallback) && (
        <StyleModal
          st={openData ? openData.st : openFallback}
          matchSet={new Set((openData ? openData.matchCws : openFallback.colorways).map((c) => c.sku))}
          onClose={() => setOpenStyle(null)}
        />
      )}

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
