/* eslint-disable */
// Shared faceted filtering for the team-store builders (CoachPortal →
// CoachStoreBuilder and storefront/BuildStore). The chips are built from the
// loaded pool itself, so every option is guaranteed to return results — unlike
// the old free-text "Narrow with AI" path, which guessed brand/category/color
// strings that often matched nothing in the small allowed pool. The AI brief is
// now just a convenience that pre-selects these same chips (see mapSpecToFacets).
import React from 'react';

// Map a raw product color ("Team Royal", "Collegiate Navy") to a display family
// so the color chips stay short and predictable. Order matters: more specific
// words win before generic ones (navy/royal before blue, maroon before red).
const FAMILY_HEX = {
  Black: '#191919', White: '#ffffff', Grey: '#9aa1ac', Silver: '#cbd5e1', Navy: '#1e293b',
  Royal: '#1e40af', Blue: '#3b82f6', Red: '#dc2626', Maroon: '#7f1d1d', Orange: '#ea580c',
  Gold: '#d4af37', Yellow: '#facc15', Green: '#16a34a', Teal: '#0d9488', Purple: '#7c3aed',
  Pink: '#ec4899', Brown: '#92400e',
};
const FAMILY_RULES = [
  ['Black', ['black']], ['White', ['white']], ['Navy', ['navy']], ['Royal', ['royal']],
  ['Maroon', ['maroon', 'cardinal', 'burgundy']], ['Red', ['red', 'scarlet', 'crimson']],
  ['Orange', ['orange']], ['Gold', ['gold', 'vegas']], ['Yellow', ['yellow']],
  ['Green', ['green', 'kelly', 'forest', 'olive', 'lime']], ['Teal', ['teal', 'aqua', 'mint']],
  ['Purple', ['purple', 'violet']], ['Pink', ['pink']], ['Brown', ['brown', 'khaki', 'tan']],
  ['Silver', ['silver']], ['Grey', ['grey', 'gray', 'graphite', 'charcoal', 'onix', 'onyx']],
  ['Blue', ['blue', 'carolina', 'columbia', 'sky']],
];
export function colorFamily(name) {
  const s = String(name || '').toLowerCase();
  if (!s) return null;
  for (const [fam, words] of FAMILY_RULES) if (words.some((w) => s.includes(w))) return fam;
  return null;
}
export function familyHex(fam) { return FAMILY_HEX[fam] || '#cbd5e1'; }

// Distinct facets present in the loaded pool, each with a count. These ARE the
// catalog, so selecting any chip always returns at least one item.
export function computeFacets(pool) {
  const cat = new Map(), col = new Map(), brand = new Map();
  for (const p of pool || []) {
    if (p.category) cat.set(p.category, (cat.get(p.category) || 0) + 1);
    const fam = colorFamily(p.color);
    if (fam) col.set(fam, (col.get(fam) || 0) + 1);
    if (p.brand) brand.set(p.brand, (brand.get(p.brand) || 0) + 1);
  }
  const byCount = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
  return { categories: byCount(cat), colors: byCount(col), brands: byCount(brand) };
}

// Narrow the pool by the chosen chips + free-text search. AND across facet
// types, OR within a type — standard faceted filtering.
export function filterPool(pool, { q = '', cats, colors, brands } = {}) {
  const t = String(q || '').trim().toLowerCase();
  return (pool || []).filter((r) => {
    if (cats && cats.size && !cats.has(r.category)) return false;
    if (brands && brands.size && !brands.has(r.brand)) return false;
    if (colors && colors.size && !colors.has(colorFamily(r.color))) return false;
    if (t && !((r.name || '') + ' ' + (r.sku || '') + ' ' + (r.color || '') + ' ' + (r.brand || '')).toLowerCase().includes(t)) return false;
    return true;
  });
}

// Map an AI brief spec onto the facets that ACTUALLY exist in the pool, so the
// AI just pre-selects real chips (visible + adjustable) and can never empty the
// grid. Style cues it can't map become free-text search.
export function mapSpecToFacets(spec, facets) {
  const out = { cats: new Set(), colors: new Set(), brands: new Set(), keywords: '' };
  if (!spec) return out;
  const matchInto = (wanted, available, set) => {
    for (const w of wanted || []) {
      const lw = String(w).toLowerCase().trim();
      if (!lw) continue;
      const hit = available.find((a) => a.toLowerCase() === lw)
        || available.find((a) => a.toLowerCase().includes(lw) || lw.includes(a.toLowerCase()));
      if (hit) set.add(hit);
    }
  };
  matchInto(spec.categories, (facets.categories || []).map((c) => c.value), out.cats);
  matchInto(spec.brands, (facets.brands || []).map((b) => b.value), out.brands);
  const famVals = (facets.colors || []).map((c) => c.value);
  for (const c of spec.colors || []) { const fam = colorFamily(c); if (fam && famVals.includes(fam)) out.colors.add(fam); }
  out.keywords = (spec.keywords || []).join(' ').trim();
  return out;
}

// Presentational chip bar. The parent owns the selected Sets + toggle handlers.
export function FacetBar({ facets, cats, colors, brands, onToggleCat, onToggleColor, onToggleBrand, onClear }) {
  if (!facets) return null;
  const showBrands = (facets.brands || []).length > 1; // a single brand isn't worth a row
  const hasAny = (facets.categories || []).length || (facets.colors || []).length || showBrands;
  if (!hasAny) return null;
  const active = cats.size + colors.size + (brands ? brands.size : 0);
  const chip = (on) => ({ fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: on ? '2px solid #191919' : '1px solid #cbd5e1', background: on ? '#191919' : '#fff', color: on ? '#fff' : '#3A4150', display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1 });
  const label = { fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', width: 52, flexShrink: 0, paddingTop: 6 };
  const row = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
  const count = (n) => <span style={{ opacity: .55, fontWeight: 600 }}>{n}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '6px 0 2px' }}>
      {showBrands && (
        <div style={row}><span style={label}>Brand</span>
          {facets.brands.map((b) => <button key={b.value} type="button" onClick={() => onToggleBrand(b.value)} style={chip(brands.has(b.value))}>{b.value} {count(b.n)}</button>)}
        </div>
      )}
      {facets.categories.length > 0 && (
        <div style={row}><span style={label}>Type</span>
          {facets.categories.map((c) => <button key={c.value} type="button" onClick={() => onToggleCat(c.value)} style={chip(cats.has(c.value))}>{c.value} {count(c.n)}</button>)}
        </div>
      )}
      {facets.colors.length > 0 && (
        <div style={row}><span style={label}>Color</span>
          {facets.colors.map((c) => (
            <button key={c.value} type="button" onClick={() => onToggleColor(c.value)} style={chip(colors.has(c.value))}>
              <span style={{ width: 13, height: 13, borderRadius: '50%', background: familyHex(c.value), border: '1px solid rgba(0,0,0,.18)', display: 'inline-block' }} />{c.value} {count(c.n)}
            </button>
          ))}
        </div>
      )}
      {active > 0 && <div><button type="button" className="ai-iconbtn" onClick={onClear}>Clear filters ({active})</button></div>}
    </div>
  );
}
