/* eslint-disable */
// Public, login-free team-store builder — opened from the /team-stores "Build"
// button by coaches whose team isn't in the system yet ("Don't see your store?").
//
// It mirrors the logged-in coach builder (src/CoachPortal.js → CoachStoreBuilder)
// but stands alone in the lightweight storefront chunk: no portal/App imports, no
// session. Because there's no customer/rep to anchor to, the coach first types in
// their CONTACT INFO; the rest of the flow is the same guided picker — choose
// in-stock items from the pre-approved allow-list pool (optionally narrowed by
// AI), brand it, review, submit. The coach-store-submit edge function re-validates
// the pool, locks prices, drops dead stock, and files it as a draft for staff to
// review (created_via='coach', customer_id=null) — see supabase/functions/.
//
// Anon RLS reality (migration 00116): the public can read `products`,
// `coach_store_config`, and the inventory views directly, but NOT `webstores` —
// so this builder uses the allow-list catalog pool only (no staff templates).
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchStockMap } from '../lib/storeInventory';
import { CatalogKitStyles, KitScope, DISPLAY } from '../ui/catalogKit';

// ── Tiny self-contained helpers (kept local so the public chunk stays lean and
//    doesn't pull in the heavy utils.js / portal graph). ──
const CLOUDINARY_CLOUD = 'dwlyljyuz';
const CLOUDINARY_PRESET = 'ml_default_nsaportal';
const cloudUpload = async (file, folder = 'nsa-store-logos') => {
  const fd = new FormData();
  fd.append('file', file); fd.append('upload_preset', CLOUDINARY_PRESET); fd.append('folder', folder);
  const resType = file.type?.startsWith('image/') ? 'image' : 'auto';
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resType}/upload`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.secure_url;
};
async function invokeEdgeFn(fnName, body) {
  const r = await supabase.functions.invoke(fnName, { body });
  let d = r.data;
  if (d && typeof d === 'object' && typeof d.text === 'function') { try { d = JSON.parse(await d.text()); } catch { d = null; } }
  else if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  if (!d && r.error) { const ctx = r.error?.context; if (ctx && typeof ctx.json === 'function') { try { d = await ctx.json(); } catch {} } if (!d) d = { ok: false, error: r.error?.message || String(r.error) }; }
  return d || { ok: false, error: 'No response from server' };
}

const _money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(/\.00$/, '');
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());

const NAVY = '#192853';
const RED = '#962C32';
// Lighten (pct>0) or darken (pct<0) a #rrggbb hex — for store-preview gradients.
function shade(hex, pct) {
  if (!hex || hex[0] !== '#' || hex.length !== 7) return hex || NAVY;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = pct < 0 ? 0 : 255, p = Math.abs(pct) / 100;
  r = Math.round((t - r) * p) + r; g = Math.round((t - g) * p) + g; b = Math.round((t - b) * p) + b;
  return '#' + (r * 65536 + g * 256 + b).toString(16).padStart(6, '0');
}
const slugify = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Color-word → swatch hex (verbatim from the coach builder so swatches match).
const COLOR_HEX = { black: '#191919', white: '#ffffff', royal: '#1e40af', navy: '#1e293b', red: '#dc2626', scarlet: '#dc2626', cardinal: '#9b1c31', maroon: '#7f1d1d', burgundy: '#7f1d1d', gold: '#d4af37', vegas: '#d4af37', yellow: '#facc15', kelly: '#15803d', forest: '#14532d', green: '#16a34a', orange: '#ea580c', purple: '#7c3aed', pink: '#ec4899', charcoal: '#374151', graphite: '#374151', grey: '#9ca3af', gray: '#9ca3af', silver: '#cbd5e1', brown: '#92400e', teal: '#0d9488', carolina: '#7dd3fc', columbia: '#60a5fa', 'light blue': '#7dd3fc', 'team royal': '#1e40af', cream: '#f5f0e1', natural: '#f5f0e1' };
const colorHex = (name) => { const s = (name || '').toLowerCase(); for (const k of Object.keys(COLOR_HEX)) { if (s.includes(k)) return COLOR_HEX[k]; } return null; };
const isLight = (hex) => { const h = (hex || '').replace('#', ''); if (h.length < 6) return true; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 160; };

// One STYLE with its colorways as pickable swatches (a coach can carry the same
// item in several colors). Each swatch toggles a specific colorway product_id.
function StyleCard({ g, sel, onToggle }) {
  const [imgErr, setImgErr] = useState(false);
  const selected = g.colorways.filter((c) => sel.has(c.product_id));
  const lead = selected[0] || g.colorways[0];
  const priceMin = Math.min(...g.colorways.map((c) => (c.price || 0) + (c.fundraise || 0)));
  const anyOn = selected.length > 0;
  // Tapping the photo is the big, obvious target: add the default color (or, if
  // some are already on, clear them all). The per-color swatches below still let
  // a coach fine-tune which colorways to carry.
  const toggleStyle = () => {
    if (selected.length) selected.forEach((c) => onToggle(c.product_id));
    else if (g.colorways[0]) onToggle(g.colorways[0].product_id);
  };
  return (
    <div className="ai-card" style={{ outline: anyOn ? '2px solid #191919' : '2px solid transparent', outlineOffset: -2, cursor: 'default' }}>
      <div onClick={toggleStyle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStyle(); } }}
        title={anyOn ? 'Tap to remove from store' : 'Tap to add to store'}
        style={{ position: 'relative', background: '#fff', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4', width: '100%', cursor: 'pointer' }}>
        {lead.image_url && !imgErr
          ? <img src={lead.image_url} alt="" loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} />
          : <div style={{ color: '#A8AEB8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>No image</div>}
        {anyOn && <span style={{ position: 'absolute', top: 8, left: 8, minWidth: 22, height: 22, padding: '0 5px', borderRadius: 6, background: '#191919', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{selected.length}</span>}
        <span style={{ position: 'absolute', top: 8, right: 8, background: '#191919', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 12.5, fontWeight: 700 }}>{_money(priceMin)}{g.colorways.length > 1 ? '+' : ''}</span>
      </div>
      <div style={{ padding: '10px 12px 12px', textAlign: 'left', width: '100%' }}>
        {g.brand && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{g.brand}</div>}
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 14.5, lineHeight: 1.12, textTransform: 'uppercase' }}>{g.name}</div>
        <div style={{ fontSize: 11.5, color: '#6A7180', marginTop: 2 }}>{g.category || ' '}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
          {g.colorways.map((c) => {
            const on = sel.has(c.product_id);
            const hex = colorHex(c.color);
            const title = `${c.color || 'Color'} · ${c._stock?.units || 0} in stock`;
            if (!hex) return (
              <button key={c.product_id} type="button" title={title} onClick={() => onToggle(c.product_id)}
                style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, cursor: 'pointer', border: on ? '2px solid #191919' : '1px solid #cbd5e1', background: on ? '#191919' : '#fff', color: on ? '#fff' : '#3A4150' }}>
                {on ? '✓ ' : ''}{c.color || 'Color'}
              </button>
            );
            return (
              <button key={c.product_id} type="button" title={title} onClick={() => onToggle(c.product_id)}
                style={{ width: 26, height: 26, borderRadius: '50%', background: hex, cursor: 'pointer', border: on ? '2px solid #191919' : '1px solid #cbd5e1', position: 'relative', boxShadow: on ? '0 0 0 2px #fff inset' : 'none' }}>
                {on && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isLight(hex) ? '#191919' : '#fff', fontSize: 13, fontWeight: 900 }}>✓</span>}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10.5, color: '#6A7180', marginTop: 7, fontWeight: 600 }}>{anyOn ? `${selected.length} color${selected.length === 1 ? '' : 's'} added` : `${g.colorways.length} color${g.colorways.length === 1 ? '' : 's'} — tap photo or color`}</div>
      </div>
    </div>
  );
}

// Compact summary tile for the review step.
function PickTile({ p }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div className="ai-card" style={{ cursor: 'default' }}>
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4' }}>
        {p.image_url && !imgErr
          ? <img src={p.image_url} alt="" loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} />
          : <div style={{ color: '#A8AEB8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>No image</div>}
        <span style={{ position: 'absolute', top: 8, right: 8, background: '#191919', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 12.5, fontWeight: 700 }}>{_money((p.price || 0) + (p.fundraise || 0))}</span>
      </div>
      <div style={{ padding: '9px 11px 11px', textAlign: 'left' }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13.5, lineHeight: 1.12, textTransform: 'uppercase' }}>{p.name}</div>
        <div style={{ fontSize: 11, color: '#6A7180', marginTop: 2 }}>{[p.category, p.color].filter(Boolean).join(' · ') || ' '}</div>
      </div>
    </div>
  );
}

// ── Live store preview (contact step) ─────────────────────────────────────────
// A stylized mock of the storefront we'll build, so a coach sees their store
// take shape — title + URL update live from the org field they're typing.
function Garment({ kind, fill }) {
  const svg = { viewBox: '0 0 100 100', width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' };
  if (kind === 'cap') {
    return (
      <svg {...svg}>
        <path d="M20 60 C20 33 44 30 52 30 C74 30 80 46 80 60 Z" fill={fill} />
        <path d="M78 58 C92 58 96 68 94 70 L78 70 Z" fill={fill} opacity="0.85" />
        <rect x="20" y="58" width="60" height="6" rx="3" fill="rgba(0,0,0,.13)" />
      </svg>
    );
  }
  return (
    <svg {...svg}>
      <path d="M34 14 C40 19 60 19 66 14 L84 24 L77 41 L69 37 V88 H31 V37 L23 41 L16 24 Z" fill={fill} />
      {kind === 'hoodie' && (
        <>
          <path d="M34 14 C40 24 60 24 66 14 L62 30 C56 35 44 35 38 30 Z" fill="rgba(0,0,0,.17)" />
          <rect x="38" y="60" width="24" height="15" rx="3" fill="rgba(0,0,0,.12)" />
          <rect x="47" y="31" width="2.4" height="13" rx="1.2" fill="rgba(0,0,0,.2)" />
          <rect x="50.6" y="31" width="2.4" height="13" rx="1.2" fill="rgba(0,0,0,.2)" />
        </>
      )}
    </svg>
  );
}

function PreviewTile({ kind, name, price, fill }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #eef0f3', boxShadow: '0 1px 3px rgba(15,26,56,.07)' }}>
      <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#F7F8FB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '70%', height: '70%' }}><Garment kind={kind} fill={fill} /></div>
        <span style={{ position: 'absolute', top: 7, right: 7, background: '#191919', color: '#fff', borderRadius: 5, padding: '2px 6px', fontSize: 11, fontWeight: 700 }}>{price}</span>
      </div>
      <div style={{ padding: '7px 9px 9px' }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 12.5, textTransform: 'uppercase', lineHeight: 1.1, color: NAVY }}>{name}</div>
      </div>
    </div>
  );
}

function StorePreview({ org, primary, accent }) {
  const title = (org || '').trim() || 'Your Team Store';
  const slug = slugify(org) || 'your-team';
  const initials = (title.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 3).join('') || 'TS').toUpperCase();
  const stripes = 'repeating-linear-gradient(-55deg, transparent 0 20px, rgba(255,255,255,0.06) 20px 40px)';
  const dot = (c) => <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} />;
  const items = [
    { kind: 'tee', name: 'Team Tee', price: '$24', fill: primary },
    { kind: 'hoodie', name: 'Pullover Hoodie', price: '$48', fill: accent },
    { kind: 'tee', name: 'Tri-Blend Tee', price: '$26', fill: shade(primary, 22) },
    { kind: 'cap', name: 'Snapback Cap', price: '$22', fill: NAVY },
  ];
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', background: '#fff', border: '1px solid #e7e9ee', boxShadow: '0 24px 60px rgba(15,26,56,.20), 0 4px 14px rgba(15,26,56,.08)' }}>
      {/* Browser chrome — signals this is a real, live website */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', background: '#eef0f4', borderBottom: '1px solid #e2e5ec' }}>
        {dot('#ef6f64')}{dot('#f4be4f')}{dot('#62c554')}
        <div style={{ flex: 1, marginLeft: 6, background: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#8a92a0', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>nationalsportsapparel.com/shop/{slug}</div>
      </div>
      {/* Banner */}
      <div style={{ position: 'relative', padding: '26px 18px 30px', textAlign: 'center', color: '#fff', background: `${stripes}, linear-gradient(135deg, ${primary}, ${shade(primary, -20)})` }}>
        <div style={{ width: 62, height: 62, borderRadius: '50%', margin: '0 auto 10px', background: 'rgba(255,255,255,.14)', border: '2px solid rgba(255,255,255,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, letterSpacing: '.04em' }}>{initials}</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, textTransform: 'uppercase', lineHeight: 1.05, letterSpacing: '.01em' }}>{title}</div>
        <div style={{ fontSize: 11, opacity: 0.82, marginTop: 5, textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 600 }}>Official Team Store</div>
        <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: accent }} />
      </div>
      {/* Products */}
      <div style={{ padding: 14, background: '#F7F8FB' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {items.map((it, i) => <PreviewTile key={i} {...it} />)}
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: '.06em', textTransform: 'uppercase', color: '#fff', background: accent, padding: '10px 22px', borderRadius: 8 }}>Shop the store →</span>
        </div>
      </div>
    </div>
  );
}

const LABEL = { display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', marginBottom: 6 };

export default function BuildStore({ onClose }) {
  const [step, setStep] = useState('contact'); // contact | items | brand | review | done
  const [loading, setLoading] = useState(false);

  // Contact (replaces the logged-in customer/rep identity).
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [org, setOrg] = useState('');

  // Pool + selection.
  const [pool, setPool] = useState([]);
  const [poolErr, setPoolErr] = useState('');
  const [search, setSearch] = useState('');
  const [brief, setBrief] = useState('');
  const [aiSpec, setAiSpec] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [sel, setSel] = useState(() => new Set());

  // Branding.
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState('#1e3a5f');
  const [accent, setAccent] = useState('#962C32');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [maxFund, setMaxFund] = useState(25);
  const [fundraise, setFundraise] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [submitErr, setSubmitErr] = useState('');

  useEffect(() => { document.title = 'Build your Team Store · National Sports Apparel'; }, []);

  // Build the in-stock, price-locked allow-list pool (anon-readable tables only).
  const loadPool = async () => {
    setLoading(true); setPoolErr(''); setPool([]); setSel(new Set());
    try {
      const { data: cfg } = await supabase.from('coach_store_config').select('*').eq('id', 1).maybeSingle();
      const brands = cfg?.allowed_brands || []; const cats = cfg?.allowed_categories || []; const dFund = Number(cfg?.default_fundraise) || 0;
      const mf = Number(cfg?.max_fundraise); setMaxFund(Number.isFinite(mf) ? mf : 25);
      let q = supabase.from('products').select('id,sku,name,brand,color,category,retail_price,catalog_sell_price,image_front_url').eq('is_active', true).or('is_archived.is.null,is_archived.eq.false').limit(400);
      if (brands.length) q = q.in('brand', brands);
      if (cats.length) q = q.in('category', cats);
      const { data: pr, error } = await q;
      if (error) throw error;
      const items = (pr || []).map((p) => ({
        product_id: p.id, sku: p.sku, name: p.name || p.sku, brand: p.brand || '', color: p.color || '', category: p.category || '',
        image_url: p.image_front_url || '',
        price: p.catalog_sell_price != null ? Number(p.catalog_sell_price) : Number(p.retail_price) || 0,
        fundraise: dFund,
      }));
      // Hard in-stock filter (vendor + in-house) and hide photoless items — coaches
      // are building a storefront, so a "No image" product is never a good pick.
      const stock = await fetchStockMap(items.map((i) => ({ id: i.product_id, sku: i.sku })));
      const inStock = items
        .map((i) => ({ ...i, _stock: stock.get(i.product_id) || { units: 0, sizes: [] } }))
        .filter((i) => (i._stock.units || 0) > 0 && i.image_url);
      setPool(inStock);
    } catch (e) { setPoolErr(e.message || String(e)); }
    setLoading(false);
  };

  const startBuilding = async () => {
    if (!cName.trim()) return;
    if (!isEmail(cEmail)) return;
    if (!name.trim()) setName(org.trim() ? `${org.trim()} Team Store` : 'Team Store');
    setStep('items');
    loadPool();
  };

  const runBrief = async () => {
    if (!brief.trim()) { setAiSpec(null); return; }
    setAiBusy(true);
    try { const d = await invokeEdgeFn('ai-store-builder', { brief: brief.trim() }); setAiSpec(d?.ok ? d.spec : null); }
    catch { setAiSpec(null); }
    setAiBusy(false);
  };

  // Filtered = approved pool narrowed by search + the AI brief (never widened).
  const qstr = search.trim().toLowerCase();
  let filtered = pool;
  if (qstr) filtered = filtered.filter((r) => (r.name + ' ' + (r.sku || '') + ' ' + r.color + ' ' + r.brand).toLowerCase().includes(qstr));
  if (aiSpec) {
    const sb = (aiSpec.brands || []).map((b) => b.toLowerCase());
    const sc = (aiSpec.categories || []).map((c) => c.toLowerCase());
    const scol = (aiSpec.colors || []).map((c) => c.toLowerCase());
    const skw = (aiSpec.keywords || []).map((k) => k.toLowerCase());
    filtered = filtered.filter((r) => {
      if (sb.length && !sb.includes((r.brand || '').toLowerCase())) return false;
      if (sc.length && !sc.includes((r.category || '').toLowerCase())) return false;
      if ((scol.length || skw.length) && !(scol.some((c) => (r.color || '').toLowerCase().includes(c)) || skw.some((k) => (r.name || '').toLowerCase().includes(k)))) return false;
      return true;
    });
  }
  const groupMap = new Map();
  for (const it of filtered) {
    const key = (it.name || it.sku || '').toUpperCase();
    let g = groupMap.get(key);
    if (!g) { g = { key, name: it.name, brand: it.brand, category: it.category, colorways: [] }; groupMap.set(key, g); }
    g.colorways.push(it);
  }
  const groups = [...groupMap.values()].slice(0, 90);

  const chosen = pool.filter((p) => sel.has(p.product_id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onLogo = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setLogoBusy(true);
    try { const url = await cloudUpload(f); setLogoUrl(url); } catch (err) { alert('Logo upload failed: ' + (err.message || err)); }
    setLogoBusy(false);
  };

  const submit = async () => {
    setSubmitting(true); setSubmitErr('');
    try {
      const d = await invokeEdgeFn('coach-store-submit', {
        public: true,
        name: name.trim(),
        item_product_ids: chosen.map((c) => c.product_id),
        fundraise,
        contact: { name: cName.trim(), email: cEmail.trim(), phone: cPhone.trim(), org: org.trim() },
        branding: { primary_color: primary, accent_color: accent, logo_url: logoUrl, hero_blurb: blurb.trim(), coach_contact_email: cEmail.trim() },
      });
      if (!d?.ok) throw new Error(d?.error || 'Submission failed.');
      setResult(d); setStep('done');
    } catch (e) { setSubmitErr(e.message || String(e)); }
    setSubmitting(false);
  };

  const ink = '#191919';
  const stepIdx = { contact: 1, items: 2, brand: 3, review: 4 }[step] || 0;
  const headBtn = { background: 'rgba(255,255,255,.16)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
  const contactValid = cName.trim() && isEmail(cEmail);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, overflowY: 'auto', background: '#f1f5f9' }}>
      <CatalogKitStyles />
      <style>{`
        .bs-contact { display: grid; grid-template-columns: minmax(0,1.05fr) minmax(0,1fr); gap: 44px; align-items: start; }
        @media (max-width: 860px) { .bs-contact { grid-template-columns: 1fr; gap: 30px; } .bs-contact-preview { max-width: 460px; } }
      `}</style>
      <div style={{ background: 'linear-gradient(135deg,#192853,#962C32)', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'sticky', top: 0, zIndex: 20 }}>
        <button onClick={onClose} style={headBtn}>← Back</button>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: '.02em' }}>Build Your Team Store</div>
        <div style={{ width: 90, textAlign: 'right', fontSize: 11.5, opacity: 0.9, fontWeight: 700 }}>{stepIdx ? `Step ${stepIdx} of 4` : ''}</div>
      </div>

      <KitScope style={{ maxWidth: 1120, margin: '0 auto', padding: '22px 16px 130px' }}>
        {step === 'contact' ? (
          <div className="bs-contact">
            {/* LEFT — who you are */}
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: RED, background: '#fbeaec', border: '1px solid #f3d2d6', padding: '5px 11px', borderRadius: 999 }}>★ Free setup · No upfront cost</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, textTransform: 'uppercase', letterSpacing: '.01em', marginTop: 12 }}>Let's build your store</div>
              <div style={{ color: '#5A616E', fontSize: 14.5, lineHeight: 1.6, marginTop: 6, marginBottom: 20 }}>Add your details and we'll start building your custom team store right away. You'll pick your gear next — then we set up shipping &amp; checkout and publish it for you. We'll email you the moment it's live.</div>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Your name</label>
                <input className="ai-search" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Coach Jordan Smith" aria-label="Your name" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Email</label>
                <input className="ai-search" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" />
                {cEmail && !isEmail(cEmail) && <div style={{ color: '#b91c1c', fontSize: 12, fontWeight: 600, marginTop: 5 }}>Enter a valid email so we can reach you.</div>}
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Phone <span style={{ textTransform: 'none', fontWeight: 600, color: '#9AA1AC' }}>(optional)</span></label>
                <input className="ai-search" value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="(555) 123-4567" aria-label="Phone" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={LABEL}>School / team / organization</label>
                <input className="ai-search" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="e.g. Lincoln High Baseball" aria-label="Organization" />
                <div style={{ fontSize: 12, color: '#9AA1AC', marginTop: 6 }}>Type it in and watch your store preview update →</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', paddingTop: 4 }}>
                {['Built for free', 'Live in days', 'Shipped to your team'].map((t) => (
                  <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#3A4150' }}>
                    <span style={{ color: '#166534', fontWeight: 900 }}>✓</span>{t}
                  </span>
                ))}
              </div>
              <button type="button" disabled={!contactValid} onClick={startBuilding}
                style={{ marginTop: 24, background: contactValid ? ink : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 30px', fontSize: 15, fontWeight: 800, letterSpacing: '.01em', cursor: contactValid ? 'pointer' : 'not-allowed' }}>Start building →</button>
              {!contactValid && <div style={{ fontSize: 12, color: '#9AA1AC', marginTop: 8 }}>Add your name and email to start building.</div>}
            </div>
            {/* RIGHT — live store preview */}
            <div className="bs-contact-preview">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#6A7180' }}>Your store preview</span>
                <span style={{ flex: 1, height: 1, background: '#e2e5ec' }} />
              </div>
              <StorePreview org={org} primary={primary} accent={accent} />
              <div style={{ fontSize: 12, color: '#9AA1AC', marginTop: 12, textAlign: 'center', lineHeight: 1.5 }}>A sample of what we'll build — your real store uses your gear, colors &amp; logo, which you'll choose next.</div>
            </div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '60px 10px', fontWeight: 600 }}>Loading the catalog…</div>
        ) : step === 'items' ? (
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.01em' }}>Choose your items</div>
            <div style={{ color: '#5A616E', fontSize: 14, marginTop: 4, marginBottom: 14 }}>Tap items to add them to your store. Only items in stock right now are shown, and prices are set for you.</div>
            <textarea className="ai-search" rows={2} value={brief} onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runBrief(); }}
              placeholder={'Optional — describe what you want and we\'ll narrow it down (e.g. "black and white tees and hoodies")'}
              style={{ resize: 'vertical', minHeight: 52, lineHeight: 1.4 }} aria-label="Describe your store" />
            <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="ai-more" style={{ margin: 0 }} onClick={runBrief} disabled={aiBusy || !brief.trim()}>{aiBusy ? 'Thinking…' : 'Narrow with AI'}</button>
              {aiSpec && <button type="button" className="ai-iconbtn" onClick={() => { setAiSpec(null); setBrief(''); }}>Clear</button>}
              <input className="ai-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" style={{ flex: 1, minWidth: 160 }} aria-label="Search items" />
            </div>
            {aiSpec?.interpretation && <div style={{ fontSize: 12.5, color: '#475569', marginTop: 10, fontStyle: 'italic' }}>{aiSpec.interpretation}</div>}
            {poolErr && <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 600, marginTop: 12 }}>{poolErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 10px' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{chosen.length} item{chosen.length === 1 ? '' : 's'} selected · {groups.length} style{groups.length === 1 ? '' : 's'} shown</div>
              {chosen.length > 0 && <button type="button" className="ai-iconbtn" onClick={() => setSel(new Set())}>Clear all</button>}
            </div>
            {groups.length === 0 ? (
              <div style={{ color: '#9AA1AC', fontSize: 13, padding: 8 }}>
                {pool.length === 0 ? 'No in-stock items are available to build from right now — submit your contact info above and our team will reach out.' : 'Nothing matches that — clear the search or AI filter to see all available items.'}
              </div>
            ) : (
              <div className="ai-grid">
                {groups.map((g) => <StyleCard key={g.key} g={g} sel={sel} onToggle={toggle} />)}
              </div>
            )}
          </div>
        ) : step === 'brand' ? (
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.01em' }}>Brand your store</div>
            <div style={{ color: '#5A616E', fontSize: 14, marginTop: 4, marginBottom: 18 }}>Give it a name, your team colors, and a logo. You can tell us anything else in the notes.</div>
            <label style={LABEL}>Store name</label>
            <input className="ai-search" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lincoln HS Baseball Store" aria-label="Store name" />
            <div style={{ display: 'flex', gap: 18, marginTop: 18, flexWrap: 'wrap' }}>
              <div>
                <label style={LABEL}>Primary color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} style={{ width: 46, height: 38, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer' }} aria-label="Primary color" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#3A4150', fontFamily: 'monospace' }}>{primary}</span>
                </div>
              </div>
              <div>
                <label style={LABEL}>Accent color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 46, height: 38, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer' }} aria-label="Accent color" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#3A4150', fontFamily: 'monospace' }}>{accent}</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <label style={LABEL}>Team logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 76, height: 76, borderRadius: 12, border: '1px dashed #cbd5e1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {logoUrl ? <img src={logoUrl} alt="logo" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} /> : <span style={{ color: '#A8AEB8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>No logo</span>}
                </div>
                <label className="ai-more" style={{ margin: 0, cursor: 'pointer' }}>
                  {logoBusy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input type="file" accept="image/*" onChange={onLogo} style={{ display: 'none' }} disabled={logoBusy} />
                </label>
              </div>
            </div>
            {maxFund > 0 && (
              <div style={{ marginTop: 18 }}>
                <label style={LABEL}>Fundraising (optional)</label>
                <div style={{ fontSize: 12.5, color: '#5A616E', marginBottom: 9 }}>Add an amount per item that goes back to your team — it's added on top of each price at checkout.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, color: '#3A4150', fontSize: 15 }}>$</span>
                    <input type="number" min={0} max={maxFund} step={1} value={fundraise}
                      onChange={(e) => setFundraise(Math.min(maxFund, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                      className="ai-search" style={{ width: 84 }} aria-label="Fundraising amount per item" />
                    <span style={{ fontSize: 12.5, color: '#6A7180' }}>/ item</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[0, 3, 5, 10].filter((v) => v <= maxFund).map((v) => (
                      <button key={v} type="button" onClick={() => setFundraise(v)}
                        style={{ borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: fundraise === v ? '1px solid #166534' : '1px solid #d1d5db', background: fundraise === v ? '#dcfce7' : '#fff', color: fundraise === v ? '#166534' : '#3A4150' }}>{v === 0 ? 'None' : `$${v}`}</button>
                    ))}
                  </div>
                  <span style={{ fontSize: 11.5, color: '#9AA1AC' }}>Max ${maxFund}/item</span>
                </div>
              </div>
            )}
            <div style={{ marginTop: 18 }}>
              <label style={LABEL}>Notes for our team (optional)</label>
              <textarea className="ai-search" rows={3} value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="Open/close dates, special requests, anything we should know…" style={{ resize: 'vertical' }} aria-label="Notes" />
            </div>
          </div>
        ) : step === 'review' ? (
          <div style={{ maxWidth: 720 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.01em' }}>Review &amp; submit</div>
            <div style={{ color: '#5A616E', fontSize: 14, marginTop: 4, marginBottom: 18 }}>Here's your store. When you submit, our team reviews it, sets up shipping &amp; checkout, and publishes it — we'll email you at <b>{cEmail}</b> when it's live.</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #eef0f3' }}>
              <div style={{ width: 64, height: 64, borderRadius: 10, background: primary, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} /> : <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{(name || '?').slice(0, 1)}</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', lineHeight: 1.1 }}>{name || 'Untitled store'}</div>
                <div style={{ fontSize: 13, color: '#6A7180', marginTop: 3 }}>{chosen.length} item{chosen.length === 1 ? '' : 's'} · prices set for you</div>
                {fundraise > 0 && <div style={{ fontSize: 12.5, color: '#166534', fontWeight: 700, marginTop: 3 }}>+ ${fundraise}/item fundraising for your team</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: primary, border: '1px solid #e2e8f0' }} />
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: accent, border: '1px solid #e2e8f0' }} />
                </div>
              </div>
            </div>
            <div className="ai-grid" style={{ marginTop: 16 }}>
              {chosen.slice(0, 12).map((p) => <PickTile key={p.product_id} p={p} />)}
            </div>
            {chosen.length > 12 && <div style={{ color: '#6A7180', fontSize: 13, marginTop: 10, fontWeight: 600 }}>+ {chosen.length - 12} more item{chosen.length - 12 === 1 ? '' : 's'}</div>}
            {submitErr && <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 700, marginTop: 14 }}>{submitErr}</div>}
          </div>
        ) : step === 'done' ? (
          <div style={{ maxWidth: 560, textAlign: 'center', padding: '40px 10px', margin: '0 auto' }}>
            <div style={{ fontSize: 46 }}>🎉</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, textTransform: 'uppercase', letterSpacing: '.01em', marginTop: 6 }}>Store submitted!</div>
            <div style={{ color: '#5A616E', fontSize: 15, marginTop: 8 }}>
              Thanks, {cName.split(' ')[0] || 'coach'}! <b>{name}</b> was sent to our team with {result?.count || chosen.length} item{(result?.count || chosen.length) === 1 ? '' : 's'}. We'll review it, set up shipping &amp; checkout, and publish it — you'll get an email at <b>{cEmail}</b> when it's live.
            </div>
            <button type="button" onClick={onClose} className="ai-more" style={{ marginTop: 22 }}>Done</button>
          </div>
        ) : null}
      </KitScope>

      {/* Sticky action bar — the primary next step for each screen. */}
      {step !== 'done' && step !== 'contact' && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e6e8ec', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, zIndex: 20, boxShadow: '0 -4px 16px rgba(0,0,0,.05)' }}>
          <button type="button" onClick={() => setStep(step === 'items' ? 'contact' : step === 'brand' ? 'items' : 'brand')}
            style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 9, padding: '10px 16px', fontSize: 13.5, fontWeight: 700, color: '#3A4150', cursor: 'pointer' }}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>{chosen.length} item{chosen.length === 1 ? '' : 's'} selected</span>
            {step === 'items' && (
              <button type="button" disabled={!chosen.length} onClick={() => setStep('brand')}
                style={{ background: chosen.length ? ink : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 20px', fontSize: 14, fontWeight: 800, cursor: chosen.length ? 'pointer' : 'not-allowed' }}>Continue to branding →</button>
            )}
            {step === 'brand' && (
              <button type="button" disabled={!name.trim()} onClick={() => setStep('review')}
                style={{ background: name.trim() ? ink : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 20px', fontSize: 14, fontWeight: 800, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>Review →</button>
            )}
            {step === 'review' && (
              <button type="button" disabled={submitting || !chosen.length} onClick={submit}
                style={{ background: submitting ? '#64748b' : '#166534', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer' }}>{submitting ? 'Submitting…' : 'Submit for approval'}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
