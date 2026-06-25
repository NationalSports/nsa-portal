/* eslint-disable */
// Public coach-facing adidas inventory catalog at /adidas.
// Joins the portal's adidas product catalog (products, brand=Adidas) with live
// per-size availability from inventory_unified — adidas Cowork CLICK
// (adidas_inventory) UNION Agron accessories (agron_inventory), both synced by
// the COWORK bot. Agron items (socks/bags/hats/underwear/sport accessories) are
// brand=Adidas with inventory_source='agron' and render identically to CLICK.
// Read-only: no cart, no pricing internals (nsa_cost is never selected), just
// what coaches can order.
//
// Cards are grouped by STYLE (one card per item, colorways inside); coaches
// filter by item type, gender, sport, color, and size availability. Built to
// grow into a multi-brand catalog later (Sanmar, Momentec) — the grouping and
// filter logic only assume {sku,name,color,category,sizes[]} per variant.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabaseCoach as supabase } from '../lib/supabaseCoach';
import { rQ, auTierDisc } from '../pricing';

// Type system aligned with the NSA marketing site (same as Storefront.js)
const DISPLAY = "'Barlow Condensed','Oswald','Helvetica Neue',Impact,sans-serif";
const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const PAGE_SIZE = 72; // cards rendered per "Show more" chunk

// Brands shown in the live-look catalog. All read live per-size stock from the
// synced inventory_unified view. Add a brand here once its *_inventory feed
// exists and the sync has populated it.
const CATALOG_BRANDS = [
  'Adidas', 'Under Armour', 'Nike',
  'Richardson', 'Momentec',
  'Port Authority', 'Sport-Tek', 'District', 'Bella+Canvas',
  'Boxercraft', 'Gildan',
];

// LiveLook collapses the brand FILTER to the three brands coaches actually pick
// by — Adidas / Under Armour / Nike — and lumps everything else (SanMar lines,
// Richardson, Boxercraft, Gildan, …) under one "Non Branded" bucket. The product
// CARD still shows each item's real brand; this only changes the filter chips.
const NAMED_BRANDS = ['Adidas', 'Under Armour', 'Nike'];
const NON_BRANDED = 'Non Branded';
const brandGroup = (b) => (NAMED_BRANDS.includes(b) ? b : NON_BRANDED);
const BRAND_FILTERS = [...NAMED_BRANDS, NON_BRANDED];

// ── Sizes ────────────────────────────────────────────────────────────
const SIZE_ORDER = [
  '3XS', '2XS', 'XXS', 'XS', '2XS/XS', 'XS/S', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL',
  'XL', 'XL/2XL', '2XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
  'ST', 'MT', 'LT', 'XLT', '2XLT', '3XLT', '4XLT',
  'OSFA', 'ONE SIZE', 'OS', 'NS',
];
export const sizeRank = (s) => {
  const up = String(s || '').trim().toUpperCase();
  const i = SIZE_ORDER.indexOf(up);
  if (i !== -1) return i;
  const m = up.match(/^(\d+(?:\.\d+)?)(-)?$/); // footwear: "10" or "10-" (= 10.5)
  if (m) return 500 + parseFloat(m[1]) + (m[2] ? 0.5 : 0);
  // Apparel sized by length: a base size followed by an inch number — shorts
  // run "S 3\"", "XL5\"", "2XL3" (spacing/quote vary in the feed). Rank by the
  // base size, then the inseam as a fine tiebreak (3" before 5") so each size's
  // lengths stay together and the run reads XS→2XL instead of alphabetically.
  const c = up.match(/^([0-9A-Z/]+?)\s*(\d{1,2})\s*"?$/);
  if (c) {
    const base = SIZE_ORDER.indexOf(c[1]);
    if (base !== -1) return base + parseFloat(c[2]) / 100;
  }
  return 400; // unknown labels between apparel and footwear
};
const sizeLabel = (s) => {
  const m = String(s || '').trim().match(/^(\d+(?:\.\d+)?)-$/);
  return m ? m[1] + '½' : s; // "10-" → "10½"
};
// One-size labels (OSFA & friends). Styles where every size is one-size — most
// Agron accessories (bags/hats/socks) — show a single size cell in the modal,
// so they get a larger product image instead of empty space beside it.
const ONE_SIZE = new Set(['OSFA', 'OSFM', 'OFA', 'ONE SIZE', 'OS', 'O/S', 'NS']);
const isOneSize = (s) => ONE_SIZE.has(String(s || '').trim().toUpperCase());
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
// Short date for the saved-orders list (handles ISO timestamps, e.g. "Jun 19").
const fmtUpdated = (d) => {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Order list persistence + clipboard ───────────────────────────────
const LIST_KEY = 'nsa_adidas_order_list';
const COACH_KEY = 'nsa_adidas_coach_info';
// Which saved order (coach_saved_orders.id) the working cart is tied to, so a
// reload keeps the cart linked to its saved order. null = unsaved working cart.
const ACTIVE_ORDER_KEY = 'nsa_adidas_active_order';
const loadJson = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    return true;
  } catch { return false; }
}

// Path the catalog is served at — /adidas, or /livelook when proxied onto the
// marketing site. Trailing slash stripped so shared links and the Supabase
// sign-in redirect match the canonical (slash-free) URLs in the auth allow-list.
const catalogPath = () => window.location.pathname.replace(/\/+$/, '') || '/adidas';

// Embedded mode: the marketing site iframes the catalog under its own site
// chrome (/livelook → .../adidas?embed=1). Hide our own page header + footer so
// the site header isn't doubled up. A cross-origin iframe can't be styled from
// the parent page, so this has to be opted into here.
const isEmbedded = () => { try { return new URLSearchParams(window.location.search).get('embed') === '1'; } catch { return false; } };

// "Adidas" + "W LS Pregame" → "Adidas W LS Pregame". Won't double up when the
// name already leads with the brand (only a leading "adidas" is stripped for
// display, so future non-adidas lines keep their brand in the name).
const withBrand = (brand, name) => {
  const n = String(name || '');
  if (!brand) return n;
  return n.toLowerCase().startsWith(String(brand).toLowerCase()) ? n : `${brand} ${n}`;
};

// ── Category / color / gender / sport derivation ─────────────────────
// Light category cleanup so near-duplicate labels land in one bucket.
const CATEGORY_ALIASES = { Hood: 'Hoods', Jerseys: 'Jersey', 'Jersey Tops': 'Jersey', 'Jersey Bottoms': 'Jersey' };
const normCategory = (c) => CATEGORY_ALIASES[c] || c || 'Other';
// Quick-pick category chips shown above the grid — the types coaches shop most,
// with Footwear surfaced first so it reads as its own section. Only chips whose
// category is actually present (live, imaged stock) render; the complete list of
// categories still lives in the "Item type" dropdown for the long tail.
const QUICK_CATS = ['Footwear', 'Tees', 'Hoods', '1/4 Zips', 'Outerwear', 'Polos', 'Shorts', 'Pants', 'Jersey', 'Hats', 'Bags', 'Socks'];
// Bags browse as one "Bags" category (backpacks, duffels, totes, coolers, …).
// The marquee team duffels (Defender, Team Issue) merchandise to the very top,
// then any other duffel — coaches shop bags by these first. Sort-only: the DB
// category and tier pricing are unchanged (auTierDisc only special-cases
// Footwear). Returns 0 for non-bags so it's a no-op everywhere else.
const bagMerchBoost = (st) => {
  if (st.category !== 'Bags') return 0;
  const n = st.name.toUpperCase();
  if (/DEFENDER|TEAM ISSUE/.test(n)) return 400; // marquee team duffels lead bags
  if (/DUFFEL|DUFFLE/.test(n)) return 200;        // then other duffels
  return 0;
};

// Fine-grained color families — Navy vs Royal (and Gold vs Yellow, Maroon vs
// Red) are different team colors, so they're first-class here even though the
// import's color_category lumps them together.
const COLOR_DOTS = {
  Black: '#191919', White: '#FFFFFF', Grey: '#9AA1AC',
  Navy: '#1B2A4A', Royal: '#2148C7', Blue: '#3B82F6',
  Red: '#C8102E', Maroon: '#6B1F2A', Orange: '#EA580C',
  Gold: '#C9A227', Yellow: '#EAB308', Green: '#15803D',
  Purple: '#6D28D9', Pink: '#EC4899', Brown: '#7C4A21', Other: '#CBD5E1',
};
const COLOR_FAMILIES = Object.keys(COLOR_DOTS);
// Default merchandising: dark/neutral team staples lead the grid (and pick
// the card cover image); Red is held out and sprinkled in as color pops.
const MERCH_PRIORITY = {
  Black: 6, Navy: 5, Grey: 4, White: 3,
  Royal: 2.5, Blue: 2.5, Maroon: 2, Green: 2, Purple: 2,
  Orange: 1.5, Gold: 1.5, Yellow: 1.5, Pink: 1, Brown: 1, Red: 0.5,
};
const POP_EVERY = 5; // a red pop after every N staple cards
// Crowd favorites get a fixed boost in the default browse order.
const POPULAR_RULES = [
  [/PREGAME/, 300], [/FLEECE/, 260], [/1\/4 ZIP|QUARTER ZIP/, 220],
];
const POPULAR_CATEGORIES = { '1/4 Zips': 220, Hoods: 150, Tees: 80 };
const popScore = (st) => {
  const n = st.name.toUpperCase();
  for (const [re, s] of POPULAR_RULES) if (re.test(n)) return s;
  return POPULAR_CATEGORIES[st.category] || 0;
};
// Per-segment classification: "Maroon/White" tags BOTH Maroon and White, so
// team-color matching sees every color a colorway features. Order matters —
// Navy/Royal before Blue, Maroon before Red, Gold before Yellow.
const SEGMENT_RULES = [
  ['Navy', /NAVY/], ['Royal', /ROYAL/], ['Maroon', /MAROON|BURGUNDY|CARDINAL/],
  ['Gold', /GOLD/], ['Black', /BLACK/], ['White', /WHITE|CREAM|IVORY/],
  ['Grey', /GREY|GRAY|SILVER|CHARCOAL|HEATHER|ONIX|CARBON|GRANITE/],
  ['Red', /\bRED\b|SCARLET|CRIMSON/], ['Orange', /ORANGE|AMBER/],
  ['Yellow', /YELLOW|LEMON|SOLAR/], ['Green', /GREEN|FOREST|MINT|OLIVE/],
  ['Blue', /BLUE|AQUA|TEAL|SKY|INDIGO/], ['Purple', /PURPLE|VIOLET|REGAL/],
  ['Pink', /PINK|MAGENTA|ROSE|FUCHSIA/], ['Brown', /BROWN|KHAKI|TAN\b|EARTH/],
];
const COLOR_CATEGORY_ALIASES = { 'Light Grey': 'Grey', 'Vegas Gold': 'Gold' };
const segFamily = (seg) => {
  const s = seg.toUpperCase();
  for (const [fam, re] of SEGMENT_RULES) if (re.test(s)) return fam;
  return null;
};
// → { primary (for the display dot), tags (Set of every featured color) }
function classifyColor(colorCategory, colorStr) {
  const segs = String(colorStr || '').split('/').map((s) => s.trim()).filter(Boolean);
  const tags = new Set();
  for (const seg of segs) { const f = segFamily(seg); if (f) tags.add(f); }
  let primary = segs.length ? segFamily(segs[0]) : null;
  if (!primary) {
    const cc = COLOR_CATEGORY_ALIASES[colorCategory] || colorCategory;
    primary = COLOR_DOTS[cc] ? cc : (tags.size ? [...tags][0] : 'Other');
  }
  tags.add(primary);
  return { primary, tags };
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

// ── Search: structured query compiler ────────────────────────────────
// Tokens that name a product type / sport / gender / color become hard
// constraints on those fields ("soccer ball" = sport:Soccer + category:Ball),
// so description text can't pull in jerseys whose copy mentions "ball".
// Unclassified tokens text-match name/SKU/color/description as before.
const CATEGORY_TOKENS = {
  ball: 'Ball', jersey: 'Jersey', tee: 'Tees', tshirt: 'Tees', shirt: 'Tees',
  hood: 'Hoods', hoodie: 'Hoods', sweatshirt: 'Hoods', fleece: 'Hoods',
  polo: 'Polos', short: 'Shorts', pant: 'Pants', jogger: 'Pants', tight: 'Pants',
  sock: 'Socks', hat: 'Hats', cap: 'Hats', beanie: 'Hats', visor: 'Hats',
  bag: 'Bags', // backpack/duffel aren't categories anymore — they text-match the name below
  shoe: 'Footwear', cleat: 'Footwear', sneaker: 'Footwear', footwear: 'Footwear', turf: 'Footwear',
  crew: 'Crew', jacket: 'Outerwear', coat: 'Outerwear', vest: 'Outerwear', windbreaker: 'Outerwear',
  zip: '1/4 Zips',
};
const SPORT_TOKENS = {
  soccer: 'Soccer', football: 'Football', baseball: 'Baseball / Softball', softball: 'Baseball / Softball',
  basketball: 'Basketball', volleyball: 'Volleyball', golf: 'Golf',
  running: 'Running / Track', track: 'Running / Track', training: 'Training & Sideline', sideline: 'Training & Sideline',
};
const GENDER_TOKENS = {
  women: "Women's", woman: "Women's", ladies: "Women's", female: "Women's",
  men: "Men's", man: "Men's",
  youth: 'Youth', kid: 'Youth', boy: 'Youth', girl: 'Youth', junior: 'Youth',
};
const COLOR_TOKENS = Object.fromEntries(COLOR_FAMILIES.map((f) => [f.toLowerCase(), f]));
const singular = (t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
function compileSearch(q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const checks = tokens.map((raw) => {
    const t = singular(raw);
    if (CATEGORY_TOKENS[t]) {
      // category match, or the literal word in name/SKU (catches miscategorized items)
      const cat = CATEGORY_TOKENS[t];
      return (st) => st.category === cat || st.coreText.includes(t);
    }
    if (SPORT_TOKENS[t]) {
      const sp = SPORT_TOKENS[t];
      return (st) => st.sport === sp || st.fullText.includes(t);
    }
    if (GENDER_TOKENS[t]) {
      const g = GENDER_TOKENS[t];
      return (st) => st.gender === g || (g === "Men's" && st.gender === 'Unisex') || st.coreText.includes(t);
    }
    if (COLOR_TOKENS[t]) {
      const fam = COLOR_TOKENS[t];
      return (st) => st.colorways.some((c) => c.tags.has(fam)) || st.coreText.includes(t);
    }
    return (st) => st.fullText.includes(raw) || (raw !== t && st.fullText.includes(t));
  });
  return (st) => checks.every((fn) => fn(st));
}

// Fetch pages in parallel waves of 6 — the dataset is ~35 pages now and
// serial paging made first load crawl. Stops at the first short page.
async function fetchAllPages(buildQuery) {
  const out = [];
  for (let wave = 0; ; wave++) {
    const starts = Array.from({ length: 6 }, (_, i) => (wave * 6 + i) * 1000);
    const results = await Promise.all(starts.map((from) => buildQuery().range(from, from + 999)));
    for (const r of results) {
      if (r.error) throw r.error;
      out.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) return out;
    }
  }
}

// Columns LiveLook needs for a product row — shared by the catalog load and the
// on-demand search effect. No cost columns: this renders on a public storefront.
const PROD_SELECT = 'id,sku,name,brand,color,color_category,category,retail_price,catalog_sell_price,pricing_group,image_front_url,image_back_url,description,inventory_source,is_featured';

// Live per-size availability for a set of product SKUs (inventory_unified) and a
// set of product ids (product_inventory = NSA in-house stock). Both feeds are
// read in URL-safe chunks: a single PostgREST .in() list of more than a few
// hundred values builds a request URL the Supabase gateway rejects outright with
// a bare 400 "Bad Request" — which is exactly what took LiveLook down once the
// featured set grew large. Splitting into batches of 400 (fetched in waves of 6)
// keeps every request well under the URL limit no matter how big the catalog or
// the featured/teaser set gets. Shared by both load phases and on-demand search.
const INV_SELECT = 'sku,size,stock_qty,future_delivery_date,future_delivery_qty,last_synced';
const chunkArr = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
async function fetchInventory(skus, ids, isAlive = () => true) {
  const waves = async (batches, buildReq) => {
    const rows = [];
    for (let w = 0; w < batches.length; w += 6) {
      if (!isAlive()) return rows;
      const res = await Promise.all(batches.slice(w, w + 6).map(buildReq));
      for (const r of res) { if (r.error) throw r.error; rows.push(...(r.data || [])); }
    }
    return rows;
  };
  const [inv, ih] = await Promise.all([
    waves(chunkArr(skus, 400), (batch) =>
      supabase.from('inventory_unified').select(INV_SELECT)
        .in('sku', batch).or('stock_qty.gt.0,future_delivery_qty.gt.0').limit(5000)),
    waves(chunkArr(ids, 400), (batch) =>
      supabase.from('product_inventory').select('product_id,size,quantity')
        .in('product_id', batch).gt('quantity', 0).limit(2000)),
  ]);
  return { inv, ih };
}

function buildStyles(prods, inv, inHouseRows, opts = {}) {
  const bySku = {};
  let synced = null;
  for (const r of inv) {
    (bySku[r.sku] = bySku[r.sku] || []).push({ size: r.size, q: r.stock_qty || 0, fd: r.future_delivery_date, fq: r.future_delivery_qty });
    if (r.last_synced && (!synced || r.last_synced > synced)) synced = r.last_synced;
  }
  const inHouseByPid = {};
  for (const r of inHouseRows) {
    (inHouseByPid[r.product_id] = inHouseByPid[r.product_id] || {})[r.size] =
      (inHouseByPid[r.product_id]?.[r.size] || 0) + (r.quantity || 0);
  }
  const seen = new Set();
  const styleMap = new Map();
  // When two vendors' products are confirmed-linked in a product_group, merge them
  // onto one style card by overriding the grouping key with the group's display_name.
  const groupByMember = {};
  for (const g of (opts.groups || [])) {
    for (const m of (g.product_group_members || [])) {
      groupByMember[m.vendor_id + '::' + m.style_key] = g;
    }
  }
  for (const p of prods) {
    if (!p.sku || seen.has(p.sku)) continue; // catalog can carry the same SKU twice (e.g. re-imports)
    // Momentec "Custom" programs (e.g. "Custom Series …" caps) are made-to-order,
    // not blank stock — keep them out of the live-look catalog.
    if (p.inventory_source === 'momentec' && /custom/i.test(p.name || '')) continue;
    // Underwear never belongs in the team catalog (all brands).
    if (/underwear/i.test(p.category || '')) continue;
    // Boxercraft: keep ONLY the flannel pajama / lounge pants (and flannel
    // joggers). Drop tees, hoods, crew, shorts, flannel shirts, boxers, etc.
    if (p.brand === 'Boxercraft') {
      const nm = p.name || '';
      if (!(/flannel|lounge|pajama/i.test(nm) && /pant|jogger/i.test(nm))) continue;
    }
    const inHouse = inHouseByPid[p.id] || null;
    const sizes = bySku[p.sku] || [];
    if (p.inventory_source === 'agron' && !sizes.length) continue;
    if (!sizes.length && !inHouse) continue;
    seen.add(p.sku);
    if (inHouse) {
      for (const [size, qty] of Object.entries(inHouse)) {
        const ex = sizes.find((s) => s.size === size);
        if (ex) ex.ih = qty;
        else sizes.push({ size, q: 0, fd: null, fq: null, ih: qty });
      }
    }
    sizes.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
    const availNow = (s) => (s.q || 0) + (s.ih || 0);
    const inStock = new Set(sizes.filter((s) => availNow(s) > 0).map((s) => s.size));
    const cat = normCategory(p.category);
    const colorInfo = classifyColor(p.color_category, p.color);
    const cw = {
      sku: p.sku,
      color: p.color || '',
      family: colorInfo.primary,
      tags: colorInfo.tags,
      img: p.image_front_url || p.image_back_url || '',
      price: Number(p.retail_price) || 0,
      sell: p.catalog_sell_price != null ? Number(p.catalog_sell_price) : null,
      pricing_group: p.pricing_group || null,
      category: cat,
      sizes,
      inStock,
      units: sizes.reduce((a, s) => a + availNow(s), 0),
      inHouseUnits: sizes.reduce((a, s) => a + (s.ih || 0), 0),
      hasIncoming: sizes.some((s) => !availNow(s) && s.fd && s.fq),
      strongRun: cat === 'Footwear'
        ? [...inStock].length >= 8
        : STRONG_SIZES.every((sz) => sizes.some((s) => s.size === sz && availNow(s) >= STRONG_MIN)),
    };
    const memberKey = p.vendor_id + '::' + p.name.trim().toUpperCase();
    const grp = groupByMember[memberKey];
    const displayName = grp ? grp.display_name : p.name.replace(/^adidas\s+/i, '');
    const key = displayName.toUpperCase() + '|' + cat;
    let st = styleMap.get(key);
    if (!st) {
      st = {
        key,
        brand: p.brand || 'Adidas',
        name: displayName,
        category: cat,
        gender: deriveGender(p.name, p.sku, cat),
        sport: deriveSport(p.name),
        description: '',
        colorways: [],
        isFeatured: false,
      };
      styleMap.set(key, st);
    }
    if (p.description && !st.description) st.description = p.description;
    if (p.is_featured) st.isFeatured = true;
    st.colorways.push(cw);
  }
  // Momentec's catalog is 30K+ styles — far too many to browse. Show ONLY
  // featured (hand-picked in Settings → Featured Styles) Momentec styles in the
  // grid; every other Momentec item is reachable via search (opts.keepAllMomentec),
  // which queries the full catalog on demand. The Phase 1/2 queries already load
  // only featured Momentec, so this is a defensive guard for any slipping through.
  if (!opts.keepAllMomentec) {
    for (const [k, st] of [...styleMap]) {
      if (st.brand === 'Momentec' && !st.isFeatured) styleMap.delete(k);
    }
  }
  const grouped = [...styleMap.values()];
  for (const st of grouped) {
    st.colorways.sort((a, b) => b.units - a.units);
    st.inHouseUnits = st.colorways.reduce((a, c) => a + (c.inHouseUnits || 0), 0);
    const prices = st.colorways.map((c) => c.price).filter(Boolean);
    st.priceMin = prices.length ? Math.min(...prices) : 0;
    st.priceMax = prices.length ? Math.max(...prices) : 0;
    st.coreText = (st.name + ' ' + st.category + ' ' + (st.sport || '') + ' ' + st.gender + ' ' + st.colorways.map((c) => c.sku + ' ' + c.color + ' ' + [...c.tags].join(' ')).join(' ')).toLowerCase();
    st.fullText = st.coreText + ' ' + (st.description || '').toLowerCase();
  }
  grouped.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return { grouped, synced };
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
        .ai-card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,26,56,.08);transition:transform .16s ease, box-shadow .16s ease;display:flex;flex-direction:column;cursor:pointer;border:none;padding:0;text-align:left;font-family:inherit;width:100%;height:100%}
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
        .ai-iconbtn{border:1px solid #E2E5EA;background:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;color:#3A4150;font-family:inherit;transition:border-color .12s}
        .ai-iconbtn:hover{border-color:#191919}
        .ai-fab{position:fixed;right:18px;bottom:18px;z-index:40;background:#191919;color:#fff;border:none;border-radius:999px;padding:13px 22px;font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 10px 28px rgba(15,26,56,.3);display:flex;align-items:center;gap:8px;transition:transform .15s}
        .ai-fab:hover{transform:translateY(-2px)}
        .ai-drawer-bg{position:fixed;inset:0;background:rgba(15,18,26,.45);z-index:60}
        .ai-drawer{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);background:#fff;z-index:61;box-shadow:-18px 0 50px rgba(0,0,0,.25);display:flex;flex-direction:column}
        .ai-input{width:100%;border:1px solid #D8DCE2;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none}
        .ai-input:focus{border-color:#191919}
        .ai-qbtn{border:1px solid #D8DCE2;background:#fff;border-radius:6px;width:26px;height:26px;font-size:14px;font-weight:700;cursor:pointer;color:#3A4150;line-height:1}
        .ai-qbtn:hover{border-color:#191919}
        .ai-toast{position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:#191919;color:#fff;border-radius:999px;padding:9px 20px;font-size:13.5px;font-weight:600;z-index:70;box-shadow:0 10px 28px rgba(0,0,0,.3);white-space:nowrap;animation:ai-toast-in .18s ease}
        .ai-colorpop{position:absolute;top:calc(100% + 6px);left:0;z-index:20;background:#fff;border:1px solid #E2E5EA;border-radius:12px;padding:12px;box-shadow:0 18px 44px rgba(15,26,56,.18);width:280px}
        .ai-swatch{display:flex;align-items:center;gap:7px;border:1px solid #E2E5EA;background:#FAFBFC;border-radius:8px;padding:6px 8px;font-size:12.5px;font-weight:600;cursor:pointer;color:#3A4150;font-family:inherit;transition:border-color .12s}
        .ai-swatch:hover{border-color:#191919}
        .ai-swatch.on{border-color:#191919;background:#191919;color:#fff}
        .ai-sizecell{display:flex;flex-direction:column;align-items:center;gap:3px;border:1px solid #E2E5EA;border-radius:8px;padding:5px 4px 4px;background:#FAFBFC;width:54px}
        .ai-sizecell.inbound{border-color:#F0DCC0;background:#FFFBF3}
        .ai-sizecell.inhouse{border-color:#BBE3C8;background:#F2FBF5}
        .ai-sizecell .lbl{font-size:11.5px;font-weight:700;line-height:1}
        .ai-sizecell .avail{font-size:10.5px;font-weight:700;line-height:1}
        .ai-qtyin{width:44px;border:1px solid #D8DCE2;border-radius:6px;padding:3px 2px;font-size:12.5px;font-weight:700;text-align:center;font-family:inherit;outline:none;background:#fff}
        .ai-qtyin:focus{border-color:#191919}
        .ai-qtyin:not(:placeholder-shown){border-color:#191919;background:#fff;color:#191919}
        @keyframes ai-toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
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
function StyleCard({ st, matchCws, colorSel, popColor, onOpen, yourPriceFn, canFav, isFav, onToggleFav }) {
  // Signed-in coaches see their tier price (green) with retail struck through
  const tierPrice = (() => {
    if (!yourPriceFn) return null;
    const ps = st.colorways.map(yourPriceFn).filter(Boolean);
    if (!ps.length) return null;
    const mn = Math.min(...ps), mx = Math.max(...ps);
    return mn === mx ? fmtPrice(mn) : `${fmtPrice(mn)}–${fmtPrice(mx)}`;
  })();
  // Cover image: a forced pop color wins, then the coach's picked team
  // colors, then staple colors (Black/Navy/Grey) so the default grid reads
  // dark-neutral with red pops.
  const pickCover = (cws) => {
    let best = null, bs = -1;
    for (const c of cws) {
      if (!c.img) continue;
      let s = MERCH_PRIORITY[c.family] ?? 1;
      if (popColor && c.family === popColor) s += 20;
      if (colorSel && colorSel.includes(c.family)) s += 10;
      else if (colorSel && colorSel.some((x) => c.tags.has(x))) s += 5;
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  };
  const cover = pickCover(matchCws) || pickCover(st.colorways);
  // SKU of the pictured colorway (so the code matches the image shown); falls
  // back to the first matching/any colorway when none of them carry an image.
  const coverSku = (cover && cover.sku) || (matchCws[0] || st.colorways[0]).sku;
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
          <span style={{ position: 'absolute', top: 10, right: 10, background: '#191919', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700 }}>
            {tierPrice ? <><s style={{ opacity: .55, fontWeight: 500, marginRight: 5 }}>{price}</s><b style={{ color: '#7CE08A' }}>{tierPrice}</b></> : price}
          </span>
        )}
        {gb && (
          <span className="ai-badge" style={{ position: 'absolute', top: 10, left: 10, background: gb.bg, color: gb.fg }}>{st.gender}</span>
        )}
        {matchCws.some((c) => c.inHouseUnits > 0) && (
          <span className="ai-badge" style={{ position: 'absolute', bottom: 10, left: 10, background: '#DCFCE7', color: '#166534' }}>In house — ships now</span>
        )}
        {/* Favorite/star — signed-in coaches only. role=button (not a real button)
            so it doesn't nest inside the card's <button>; stops card open on click. */}
        {canFav && (
          <span role="button" tabIndex={0} aria-label={isFav ? 'Remove favorite' : 'Add favorite'} aria-pressed={isFav}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            onClick={(e) => { e.stopPropagation(); onToggleFav && onToggleFav(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleFav && onToggleFav(); } }}
            style={{ position: 'absolute', bottom: 10, right: 10, width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.92)', boxShadow: '0 1px 4px rgba(15,26,56,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: isFav ? '#F5B301' : '#9AA1AC' }}>
            {isFav ? '★' : '☆'}
          </span>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, width: '100%' }}>
        <div>
          {st.brand && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{st.brand}</div>}
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, lineHeight: 1.15, textTransform: 'uppercase' }}>{st.name}</div>
          <div style={{ fontSize: 12, color: '#6A7180', marginTop: 3 }}>
            {st.category}{st.sport ? ' · ' + st.sport : ''}
          </div>
          {coverSku && (
            <div style={{ fontSize: 11.5, color: '#9AA1AC', fontFamily: 'monospace', marginTop: 2 }}>{coverSku}</div>
          )}
        </div>
        <ColorDots colorways={matchCws.length ? matchCws : st.colorways} />
        {incomingOnly ? (
          <div style={{ fontSize: 12, fontWeight: 600, color: '#B45309' }}>Out of stock — restock dates inside</div>
        ) : (
          <div className="ai-chipgrid">
            {sizes.slice(0, 8).map((s) => <span key={s} className="ai-chip">{sizeLabel(s)}</span>)}
            {sizes.length > 8 && <span className="ai-chip" style={{ color: '#6A7180' }}>+{sizes.length - 8}</span>}
          </div>
        )}
        <div style={{ marginTop: 'auto', fontSize: 12, fontWeight: 700, color: '#3A4150', borderTop: '1px dashed #E6E8EC', paddingTop: 8 }}>
          View colors & stock →
        </div>
      </div>
    </button>
  );
}

// One size = one cell: label, available count, and an order-qty input that
// writes straight into the order list (0/blank removes the line).
function SizeCell({ size, avail, inbound, ih, qty, onQty }) {
  const title = inbound
    ? `Projected ${fmtQty(avail)} available ${fmtDate(inbound)}`
    : ih
      ? `${fmtQty(ih)} in house at NSA (ships now)${avail - ih > 0 ? ` + ${fmtQty(avail - ih)} at adidas` : ''}`
      : `${fmtQty(avail)} available now`;
  return (
    <div className={'ai-sizecell' + (inbound ? ' inbound' : '') + (ih ? ' inhouse' : '')}>
      <span className="lbl">{sizeLabel(size)}</span>
      <span className="avail" style={{ color: inbound ? '#92580B' : ih ? '#166534' : avail >= 24 ? '#15803D' : '#B45309' }} title={title}>
        {fmtQty(avail)}
      </span>
      <input className="ai-qtyin" placeholder="0" inputMode="numeric" aria-label={`Order quantity, size ${sizeLabel(size)}`}
        value={qty || ''} onChange={(e) => onQty(parseInt(e.target.value.replace(/\D/g, '')) || 0)} />
    </div>
  );
}

// ── Style detail modal (per-colorway stock + inbound dates) ──────────
function StyleModal({ st, matchSet, onClose, onSetQty, qtyInList, unitsInList, onConfirm, notify, yourPriceFn }) {
  const [alertFor, setAlertFor] = useState(null); // sku with the restock-alert form open
  const [alertEmail, setAlertEmail] = useState(() => (loadJson(COACH_KEY, {}).email || ''));
  const [alertSize, setAlertSize] = useState('');
  const [alertBusy, setAlertBusy] = useState(false);
  const [inboundOpen, setInboundOpen] = useState({}); // sku → expanded inbound rows
  const [zoomImg, setZoomImg] = useState(null); // {img,alt} for the click-to-enlarge lightbox
  const [colorQ, setColorQ] = useState(''); // live filter for the colorway list (styles with many colors)

  useEffect(() => {
    // Escape closes the enlarged image first (if open), otherwise the modal.
    const onKey = (e) => { if (e.key === 'Escape') { if (zoomImg) setZoomImg(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose, zoomImg]);

  const submitAlert = async (cw) => {
    if (alertBusy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alertEmail.trim())) return;
    setAlertBusy(true);
    try {
      const res = await fetch('/.netlify/functions/catalog-stock-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: 'adidas', email: alertEmail.trim(), sku: cw.sku, size: alertSize || null, style_name: st.name, color: cw.color || cw.family }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save the alert');
      saveJson(COACH_KEY, { ...loadJson(COACH_KEY, {}), email: alertEmail.trim() });
      notify(`We'll email you when ${alertSize ? sizeLabel(alertSize) : 'it'} is back`);
      setAlertFor(null);
    } catch (e) {
      notify(e.message);
    } finally {
      setAlertBusy(false);
    }
  };

  const share = async () => {
    // Always share the public marketing URL (nationalsportsapparel.com/livelook) so the
    // link never exposes the raw nsa-portal.netlify.app app origin — even when a staff
    // member shares from /adidas inside the app.
    const url = `https://nationalsportsapparel.com/livelook?style=${encodeURIComponent(st.colorways[0].sku)}`;
    if (navigator.share) {
      try { await navigator.share({ title: `${st.name} — NSA adidas catalog`, url }); return; } catch { /* fall through to copy */ }
    }
    if (await copyText(url)) notify('Link copied — send it to anyone');
  };

  // Colorways that match the current filters float to the top
  const cws = [...st.colorways].sort((a, b) => (matchSet.has(b.sku) - matchSet.has(a.sku)) || a.color.localeCompare(b.color));
  // Live color filter — matches color name, family, or SKU. For styles like
  // Richardson 112 (100+ colorways) scrolling is unworkable without it.
  const cq = colorQ.trim().toLowerCase();
  const shownCws = cq
    ? cws.filter((cw) => ((cw.color || '') + ' ' + (cw.family || '') + ' ' + cw.sku).toLowerCase().includes(cq))
    : cws;
  const gb = GENDER_BADGE[st.gender];
  // One-size styles (OSFA — most Agron accessories) show a single size cell, so
  // the row would otherwise be mostly empty: give them a much larger, centered
  // product image. Sized apparel keeps the compact thumb so its size grid fits.
  const oneSize = st.colorways.every((cw) => cw.sizes.length > 0 && cw.sizes.every((s) => isOneSize(s.size)));
  const thumb = oneSize ? 72 : 76;

  return (
    <>
    <div className="ai-modal-bg" onClick={onClose}>
      <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 10px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            {st.brand && <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{st.brand}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, margin: 0, textTransform: 'uppercase', lineHeight: 1.05 }}>{st.name}</h2>
              {gb && <span className="ai-badge" style={{ background: gb.bg, color: gb.fg }}>{st.gender}</span>}
            </div>
            <div style={{ fontSize: 13, color: '#6A7180', marginTop: 4 }}>
              {st.category}{st.sport ? ' · ' + st.sport : ''} · {st.colorways.length} {st.colorways.length === 1 ? 'colorway' : 'colorways'}
            </div>
          </div>
          <button className="ai-iconbtn" style={{ padding: '7px 13px', fontSize: 13, flex: 'none' }} onClick={share}>Share ↗</button>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: '#F0F1F4', borderRadius: 8, width: 34, height: 34, fontSize: 17, cursor: 'pointer', fontWeight: 700, color: '#3A4150', flex: 'none' }}>✕</button>
        </div>
        {st.description && (
          <div style={{ padding: '0 24px 8px', fontSize: 13.5, color: '#3A4150', lineHeight: 1.5, maxWidth: 720 }}>
            {st.description}
          </div>
        )}
        <div style={{ padding: '0 24px 6px', fontSize: 12, color: '#6A7180' }}>
          Type quantities under the sizes you need — they go straight onto your order list.
        </div>
        {st.colorways.length > 10 && (
          <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', padding: '4px 24px 10px' }}>
            <input className="ai-search" value={colorQ} onChange={(e) => setColorQ(e.target.value)}
              placeholder={`Search ${st.colorways.length} colors…`} style={{ width: '100%' }} />
            {cq && <div style={{ fontSize: 12, color: '#6A7180', marginTop: 6 }}>{shownCws.length} of {st.colorways.length} colors</div>}
          </div>
        )}
        <div style={{ padding: '0 24px 22px', ...(oneSize ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 10, alignItems: 'start' } : null) }}>
          {cq && shownCws.length === 0 && (
            <div style={{ padding: '14px 0', fontSize: 13.5, color: '#6A7180', gridColumn: '1 / -1' }}>No colors match “{colorQ}”.</div>
          )}
          {shownCws.map((cw) => {
            const availNow = (s) => (s.q || 0) + (s.ih || 0);
            const inStock = cw.sizes.filter((s) => availNow(s) > 0);
            const incoming = {};
            for (const s of cw.sizes) {
              if (availNow(s) > 0 || !s.fd || !s.fq) continue;
              (incoming[s.fd] = incoming[s.fd] || []).push(s);
            }
            const dates = Object.keys(incoming).sort().slice(0, 3);
            const hasOOS = cw.sizes.some((s) => !availNow(s));
            const oosSizes = cw.sizes.filter((s) => !availNow(s));
            return (
              <div key={cw.sku} className="ai-cwrow" style={{ ...(oneSize ? { alignItems: 'center', borderTop: 'none', border: '1px solid #EEF0F3', borderRadius: 12, padding: 12, gap: 10 } : null), ...(matchSet.has(cw.sku) ? null : { opacity: .55 }) }}>
                <button type="button" disabled={!cw.img}
                  onClick={() => cw.img && setZoomImg({ img: cw.img, alt: cw.color || cw.family })}
                  title={cw.img ? 'Click to enlarge' : undefined}
                  aria-label={cw.img ? `Enlarge ${cw.color || cw.family} image` : undefined}
                  style={{ width: thumb, height: thumb, flex: 'none', background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', padding: 0, fontFamily: 'inherit', cursor: cw.img ? 'zoom-in' : 'default' }}>
                  <ImageBox img={cw.img} alt={cw.color} />
                  {cw.img && (
                    <span aria-hidden="true" style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(25,25,25,.6)', color: '#fff', borderRadius: 6, fontSize: 11, lineHeight: 1, padding: '3px 5px', fontWeight: 700 }}>⤢</span>
                  )}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="ai-dot" style={{ background: COLOR_DOTS[cw.family] || '#CBD5E1' }} />
                    <span style={{ fontWeight: 700, fontSize: 14.5 }}>{cw.color || cw.family}</span>
                    <span style={{ fontSize: 12, color: '#6A7180', fontFamily: 'monospace' }}>{cw.sku}</span>
                    <button className="ai-iconbtn" onClick={async () => { if (await copyText(cw.sku)) notify(`SKU ${cw.sku} copied`); }} title="Copy SKU">Copy SKU</button>
                    {hasOOS && (
                      <button className="ai-iconbtn" onClick={() => { setAlertFor(alertFor === cw.sku ? null : cw.sku); setAlertSize(''); }} title="Email me when out-of-stock sizes return">
                        🔔 Restock alert
                      </button>
                    )}
                    {fmtPrice(cw.price) && (
                      <span style={{ fontSize: 12.5, fontWeight: 700, marginLeft: 'auto' }}>
                        {(() => { const y = yourPriceFn && yourPriceFn(cw); return y ? <><s style={{ color: '#9AA1AC', fontWeight: 500, marginRight: 6 }}>{fmtPrice(cw.price)}</s><b style={{ color: '#15803D' }}>{fmtPrice(y)}</b></> : fmtPrice(cw.price); })()}
                      </span>
                    )}
                  </div>
                  {alertFor === cw.sku && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, background: '#F7F8FB', border: '1px solid #E6E8EC', borderRadius: 10, padding: '8px 10px' }}>
                      <select className="ai-input" style={{ width: 'auto', padding: '6px 8px', fontSize: 12.5 }} value={alertSize} onChange={(e) => setAlertSize(e.target.value)} aria-label="Size to watch">
                        <option value="">Any size</option>
                        {oosSizes.map((s) => <option key={s.size} value={s.size}>{sizeLabel(s.size)}</option>)}
                      </select>
                      <input className="ai-input" style={{ flex: '1 1 150px', padding: '6px 10px', fontSize: 13 }} placeholder="you@school.org" type="email"
                        value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} />
                      <button className="ai-iconbtn" style={{ padding: '7px 14px', fontSize: 12.5, background: '#191919', color: '#fff', borderColor: '#191919' }}
                        disabled={alertBusy} onClick={() => submitAlert(cw)}>
                        {alertBusy ? 'Saving…' : 'Email me'}
                      </button>
                    </div>
                  )}
                  {cw.inHouseUnits > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: '#166534' }}>
                      🏠 {fmtQty(cw.inHouseUnits)} units in house at NSA — ships now
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {inStock.length > 0 ? inStock.map((s) => (
                      <SizeCell key={s.size} size={s.size} avail={availNow(s)} inbound={null} ih={s.ih || 0}
                        qty={qtyInList(cw.sku, s.size)} onQty={(n) => onSetQty(st, cw, s.size, n, null)} />
                    )) : (
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#B45309', alignSelf: 'center' }}>Out of stock</span>
                    )}
                  </div>
                  {dates.length > 0 && (() => {
                    // Collapsed by default — auto-open if the coach already ordered an inbound size
                    const hasQty = dates.some((d) => incoming[d].some((s) => qtyInList(cw.sku, s.size) > 0));
                    const open = inboundOpen[cw.sku] ?? hasQty;
                    const nSizes = dates.reduce((a, d) => a + incoming[d].length, 0);
                    return open ? (
                      <div style={{ marginTop: 8 }}>
                        <button className="ai-iconbtn" style={{ fontSize: 10.5, color: '#92580B' }} onClick={() => setInboundOpen((o) => ({ ...o, [cw.sku]: false }))}>
                          ▾ Inbound restocks
                        </button>
                        {dates.map((d) => (
                          <div key={d} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#3A4150', whiteSpace: 'nowrap' }}>Inbound {fmtDate(d)}:</span>
                            {incoming[d].map((s) => (
                              <SizeCell key={s.size} size={s.size} avail={s.fq} inbound={d}
                                qty={qtyInList(cw.sku, s.size)} onQty={(n) => onSetQty(st, cw, s.size, n, d)} />
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button className="ai-iconbtn" style={{ marginTop: 8, fontSize: 11, color: '#92580B', borderColor: '#F0DCC0', background: '#FFFBF3' }}
                        onClick={() => setInboundOpen((o) => ({ ...o, [cw.sku]: true }))}
                        title="Show inbound sizes and order them for future delivery">
                        ▸ {nSizes} size{nSizes === 1 ? '' : 's'} inbound · {dates.map((d) => fmtDate(d)).join(' · ')}
                      </button>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #EEF0F3', borderRadius: '0 0 16px 16px', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: '#6A7180', flex: 1 }}>
            {unitsInList > 0
              ? `${fmtQty(unitsInList)} unit${unitsInList === 1 ? '' : 's'} from this style on your list`
              : 'Type quantities above to add sizes'}
          </span>
          <button
            onClick={onConfirm}
            disabled={unitsInList === 0}
            style={{ border: 'none', background: unitsInList > 0 ? '#191919' : '#C6CAD2', color: '#fff', borderRadius: 999, padding: '11px 26px', fontSize: 14.5, fontWeight: 700, cursor: unitsInList > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Add to order list{unitsInList > 0 ? ` (${fmtQty(unitsInList)})` : ''} →
          </button>
        </div>
      </div>
    </div>
    {zoomImg && (
      <div onClick={() => setZoomImg(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(10,12,18,.86)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 5vw', cursor: 'zoom-out' }}>
        <img src={zoomImg.img} alt={zoomImg.alt} onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff', borderRadius: 12, boxShadow: '0 30px 90px rgba(0,0,0,.55)', cursor: 'default' }} />
        <button onClick={() => setZoomImg(null)} aria-label="Close enlarged image"
          style={{ position: 'fixed', top: 16, right: 18, border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff', borderRadius: 10, width: 40, height: 40, fontSize: 19, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
        <div aria-hidden="true" style={{ position: 'fixed', left: 0, right: 0, bottom: 16, textAlign: 'center', color: '#E7E9ED', fontSize: 13, fontWeight: 600, pointerEvents: 'none' }}>{zoomImg.alt} · tap anywhere to close</div>
      </div>
    )}
    </>
  );
}

// Downscale a coach-selected image in the browser so the order-request email
// stays small: longest edge <= 1600px, PNG kept (transparency) else JPEG.
// Resolves { name, type, content (base64, no data: prefix), preview }.
function downscaleImage(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const isPng = file.type === 'image/png';
      const type = isPng ? 'image/png' : 'image/jpeg';
      const preview = canvas.toDataURL(type, isPng ? undefined : 0.85);
      const base = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 60) || 'image';
      resolve({ name: base + (isPng ? '.png' : '.jpg'), type, content: preview.split(',')[1] || '', preview });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

// ── Saved-orders list (shared by the order drawer + the account overlay) ──
function SavedOrdersList({ savedOrders = [], activeOrderId, savedLoading, onLoadOrder, onRenameOrder, onDeleteOrder, onNewOrder }) {
  const [renameId, setRenameId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const savedBtn = { background: '#fff', border: '1px solid #E2E5EA', borderRadius: 7, padding: '4px 9px', fontSize: 11, fontWeight: 600, color: '#3A4150', cursor: 'pointer', fontFamily: 'inherit', flex: 'none' };
  return (
    <div style={{ marginTop: 4 }}>
      {savedLoading && <div style={{ fontSize: 12.5, color: '#9AA1AC', padding: '6px 0' }}>Loading…</div>}
      {!savedLoading && savedOrders.length === 0 && (
        <div style={{ fontSize: 12.5, color: '#9AA1AC', padding: '4px 0 8px' }}>No saved orders yet — build a list and tap Save to keep it for later.</div>
      )}
      {savedOrders.map((o) => {
        const u = (Array.isArray(o.lines) ? o.lines : []).reduce((a, l) => a + (parseInt(l.qty) || 0), 0);
        const isActive = o.id === activeOrderId;
        return (
          <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 8, background: isActive ? '#F0F4FF' : '#F7F8FA', border: '1px solid ' + (isActive ? '#C7D6FF' : '#EEF0F3'), marginBottom: 6 }}>
            {renameId === o.id ? (
              <input
                className="ai-input" autoFocus value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { onRenameOrder && onRenameOrder(o.id, renameVal); setRenameId(null); } if (e.key === 'Escape') setRenameId(null); }}
                onBlur={() => { onRenameOrder && onRenameOrder(o.id, renameVal); setRenameId(null); }}
                style={{ flex: 1, padding: '4px 8px', fontSize: 12.5 }} />
            ) : (
              <button onClick={() => onLoadOrder && onLoadOrder(o)} title="Open this order"
                style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.name || 'Untitled order'}</div>
                <div style={{ fontSize: 11, color: '#6A7180', marginTop: 1 }}>
                  {u} unit{u === 1 ? '' : 's'} · {fmtUpdated(o.updated_at)}
                  {o.submit_count > 0 ? ` · sent ${o.submit_count}×` : ''}
                  {o.created_by_name ? ` · ${o.created_by_name}` : ''}
                </div>
              </button>
            )}
            {renameId !== o.id && (
              <>
                <button onClick={() => onLoadOrder && onLoadOrder(o)} style={savedBtn}>Open</button>
                <button onClick={() => { setRenameId(o.id); setRenameVal(o.name === 'Untitled order' ? '' : (o.name || '')); }} style={savedBtn}>Rename</button>
                <button onClick={() => { if (window.confirm(`Delete "${o.name || 'Untitled order'}"? This can't be undone.`)) onDeleteOrder && onDeleteOrder(o.id); }} style={{ ...savedBtn, color: '#B91C1C' }}>Delete</button>
              </>
            )}
          </div>
        );
      })}
      {onNewOrder && <button onClick={() => onNewOrder()} style={{ background: 'none', border: '1px dashed #C6CAD2', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#6A7180', cursor: 'pointer', fontFamily: 'inherit' }}>+ Start a new blank order</button>}
    </div>
  );
}

// ── Account overlay: a coach's home for saved orders + favorited items ──
function AccountPanel({ account, onClose, savedOrders, activeOrderId, savedLoading, favorites = [], favLoading, onOpenOrder, onRenameOrder, onDeleteOrder, onNewOrder, onUnfavorite, onOpenStyle }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ai-modal-bg" onClick={onClose} role="dialog" aria-label="My account">
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 780, width: '100%', overflow: 'hidden', boxShadow: '0 24px 60px rgba(15,26,56,.28)' }}>
        <div style={{ background: '#191919', color: '#fff', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, textTransform: 'uppercase' }}>My account</div>
            <div style={{ fontSize: 12.5, color: '#9AA1AC', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.customerName || account.email} · your team pricing</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: '#2B2F38', color: '#fff', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
        <div style={{ padding: '16px 22px 22px', maxHeight: '74vh', overflowY: 'auto' }}>
          <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, textTransform: 'uppercase', margin: '4px 0 8px' }}>Saved orders{savedOrders.length ? ` (${savedOrders.length})` : ''}</h3>
          <SavedOrdersList savedOrders={savedOrders} activeOrderId={activeOrderId} savedLoading={savedLoading}
            onLoadOrder={onOpenOrder} onRenameOrder={onRenameOrder} onDeleteOrder={onDeleteOrder} onNewOrder={onNewOrder} />

          <h3 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, textTransform: 'uppercase', margin: '22px 0 8px' }}>Favorites{favorites.length ? ` (${favorites.length})` : ''}</h3>
          {favLoading && <div style={{ fontSize: 12.5, color: '#9AA1AC' }}>Loading…</div>}
          {!favLoading && favorites.length === 0 && (
            <div style={{ fontSize: 12.5, color: '#9AA1AC', padding: '2px 0 6px' }}>No favorites yet — tap the ☆ on any item in the catalog to save it here.</div>
          )}
          {favorites.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 12 }}>
              {favorites.map((f) => (
                <div key={f.id} style={{ border: '1px solid #EEF0F3', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
                  <button onClick={() => onOpenStyle(f.style_key)} title="View colors & stock"
                    style={{ border: 'none', background: '#fff', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', display: 'block' }}>
                    <div style={{ aspectRatio: '1/1', background: '#F7F8FA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {f.image_url ? <img src={f.image_url} alt={f.name || ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: '#C6CAD2', fontSize: 26 }}>★</span>}
                    </div>
                    <div style={{ padding: '8px 10px' }}>
                      {f.brand && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{f.brand}</div>}
                      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, lineHeight: 1.15, textTransform: 'uppercase' }}>{f.name || f.style_key}</div>
                      {f.category && <div style={{ fontSize: 11, color: '#9AA1AC', marginTop: 2 }}>{f.category}</div>}
                    </div>
                  </button>
                  <button onClick={() => onUnfavorite(f.style_key)} aria-label="Remove favorite" title="Remove favorite"
                    style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.92)', boxShadow: '0 1px 4px rgba(0,0,0,.18)', cursor: 'pointer', color: '#F5B301', fontSize: 15, lineHeight: 1 }}>★</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Decoration methods a coach can request per item. Multi-select (an item can be
// screen-printed AND embroidered); "no deco" is the absence of any. Stored on the
// line as a comma-joined `decoration` string so the rep email / inbox / estimate
// all read one display value, with the free-text in `decoration_note`.
const DECO_METHODS = ['Screen print', 'Embroidery', 'Heat press'];
const parseDeco = (s) => new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean));

// ── Order list drawer: review lines, coach info, send to rep ─────────
function OrderDrawer({ list, updateLine, setSkuDeco, removeLine, clearList, onClose, notify, account,
  savedOrders = [], activeOrderId = null, savedLoading = false, onSaveOrder, onLoadOrder, onRenameOrder, onDeleteOrder, onNewOrder }) {
  const [coach, setCoach] = useState(() => {
    const s = loadJson(COACH_KEY, { name: '', email: '', phone: '', team: '' });
    // Signed-in coach account prefills anything the browser doesn't remember
    return account ? { ...s, name: s.name || account.name || '', email: s.email || account.email || '', team: s.team || account.customerName || '' } : s;
  });
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState([]); // [{ name, type, content, preview }]
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [errMsg, setErrMsg] = useState('');

  // Saved-order controls (signed-in coaches only): name the current list, save
  // it, browse the team's saved orders, rename/delete.
  const [orderName, setOrderName] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [savedOpen, setSavedOpen] = useState(false);
  const activeOrder = (savedOrders || []).find((o) => o.id === activeOrderId) || null;
  // When the coach loads a different saved order, sync the name/notes fields to
  // it. Keyed on the loaded id only, so saving (which doesn't change the id)
  // never clobbers what they're typing.
  useEffect(() => {
    if (!activeOrderId) return;
    const o = (savedOrders || []).find((x) => x.id === activeOrderId);
    if (o) { setOrderName(o.name && o.name !== 'Untitled order' ? o.name : ''); setNotes(o.notes || ''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrderId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doSave = async (forceNew) => {
    if (!account || !list.length || !onSaveOrder) return;
    setSaveState('saving');
    const r = await onSaveOrder({ name: orderName, notes, forceNew });
    if (r && r.error) { setSaveState('idle'); notify && notify(r.error); return; }
    setSaveState('saved');
    notify && notify(forceNew ? 'Saved as a new order' : 'Order saved');
    setTimeout(() => setSaveState('idle'), 1600);
  };

  const setField = (k) => (e) => {
    const next = { ...coach, [k]: e.target.value };
    setCoach(next);
    saveJson(COACH_KEY, next);
  };

  const MAX_IMG = 6;
  const onAddImages = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // let the same file be re-picked after removal
    const room = MAX_IMG - images.length;
    if (room <= 0) { notify && notify(`Up to ${MAX_IMG} images`); return; }
    const out = [];
    for (const f of files.slice(0, room)) {
      if (!f.type.startsWith('image/')) continue;
      try { out.push(await downscaleImage(f)); } catch { /* skip an image the browser can't decode */ }
    }
    if (out.length) setImages((prev) => [...prev, ...out]);
  };

  const total = list.reduce((a, l) => a + (l.price || 0) * l.qty, 0);
  const units = list.reduce((a, l) => a + l.qty, 0);
  const canSend = list.length > 0 && coach.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(coach.email.trim());

  // Group the flat list by colorway (SKU) so every size of an item sits together
  // (small → large) under one brand-prefixed heading. Each size row keeps its
  // original list index so the qty/remove callbacks still target the right line.
  const groups = (() => {
    const m = new Map();
    list.forEach((l, i) => {
      if (!m.has(l.sku)) m.set(l.sku, { sku: l.sku, brand: l.brand, name: l.name, color: l.color, lines: [] });
      m.get(l.sku).lines.push({ ...l, i });
    });
    const out = [...m.values()];
    out.forEach((g) => g.lines.sort((a, b) => sizeRank(a.size) - sizeRank(b.size)));
    return out;
  })();

  // Remove every size of one SKU at once — delete from the highest index down so
  // the earlier indices the loop still needs don't shift underneath it.
  const removeSku = (g) => [...g.lines].map((l) => l.i).sort((a, b) => b - a).forEach(removeLine);

  const submit = async () => {
    if (!canSend || state === 'sending') return;
    setState('sending');
    setErrMsg('');
    try {
      const res = await fetch('/.netlify/functions/catalog-order-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: 'adidas',
          coach_name: coach.name.trim(),
          coach_email: coach.email.trim(),
          coach_phone: coach.phone.trim(),
          team_name: coach.team.trim(),
          notes: notes.trim(),
          // The coach's order name becomes the estimate's memo line when the rep
          // builds it from this request.
          order_name: orderName.trim(),
          customer_id: (account && account.customerId) || null,
          lines: list.map((l) => ({ sku: l.sku, brand: l.brand, name: l.name, color: l.color, size: l.size, qty: l.qty, price: l.price, inbound: l.inbound, decoration: l.decoration, decoration_note: l.decoration_note })),
          images: images.map(({ name, type, content }) => ({ name, type, content })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || 'Something went wrong');
      if (account && onSaveOrder) {
        // Record the submit against the coach's saved order (creating one if the
        // cart wasn't saved yet) and keep the list — submitted orders stay
        // editable and re-submittable. The image attachments are email-only.
        await onSaveOrder({ name: orderName, notes, submit: { requestId: d.id } });
        setState('sent');
        setImages([]);
      } else {
        setState('sent');
        clearList();
        setImages([]);
      }
    } catch (e) {
      setState('error');
      setErrMsg(e.message || 'Could not send — please try again');
    }
  };

  return (
    <>
      <div className="ai-drawer-bg" onClick={onClose} />
      <div className="ai-drawer" role="dialog" aria-label="Your order list">
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid #EEF0F3', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, margin: 0, textTransform: 'uppercase', flex: 1 }}>Your order list</h2>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: '#F0F1F4', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', fontWeight: 700, color: '#3A4150' }}>✕</button>
        </div>

        {state === 'sent' ? (
          <div style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 42 }}>✅</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24, textTransform: 'uppercase', marginTop: 8 }}>Request sent</div>
            <p style={{ fontSize: 14, color: '#6A7180', lineHeight: 1.55, marginTop: 8 }}>
              Your rep has your list and will follow up with a formal estimate at your team pricing.
              A copy went to <b>{coach.email}</b>'s rep inbox — reply there with any changes.
            </p>
            {account ? (
              <>
                <p style={{ fontSize: 13, color: '#6A7180', lineHeight: 1.5, marginTop: 6 }}>
                  We saved this as <b>{orderName.trim() || 'Untitled order'}</b> in your team's orders — edit it and re-send anytime.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
                  <button className="ai-more" onClick={() => setState('idle')}>Back to this order</button>
                  <button className="ai-more" onClick={onClose}>Done</button>
                </div>
              </>
            ) : (
              <button className="ai-more" style={{ margin: '18px auto 0' }} onClick={onClose}>Done</button>
            )}
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 20px' }}>
              {account && (
                <div style={{ margin: '8px 0 2px' }}>
                  <button
                    onClick={() => setSavedOpen((s) => !s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#191919' }}>
                    <span style={{ fontSize: 11, color: '#9AA1AC' }}>{savedOpen ? '▾' : '▸'}</span>
                    Saved orders{savedOrders.length ? ` (${savedOrders.length})` : ''}
                    <span style={{ flex: 1 }} />
                    {activeOrder && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#6A7180', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>Editing: {activeOrder.name}</span>}
                  </button>
                  {savedOpen && (
                    <SavedOrdersList savedOrders={savedOrders} activeOrderId={activeOrderId} savedLoading={savedLoading}
                      onLoadOrder={onLoadOrder} onRenameOrder={onRenameOrder} onDeleteOrder={onDeleteOrder} onNewOrder={onNewOrder} />
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 4px' }}>
                    <input className="ai-input" placeholder={activeOrder ? activeOrder.name : 'Name this order (e.g. Fall practice gear)'}
                      value={orderName} onChange={(e) => setOrderName(e.target.value)} style={{ flex: 1 }} />
                    <button onClick={() => doSave(false)} disabled={!list.length || saveState === 'saving'}
                      style={{ border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: list.length ? 'pointer' : 'not-allowed', fontFamily: 'inherit', background: list.length ? '#191919' : '#C6CAD2', color: '#fff', whiteSpace: 'nowrap' }}>
                      {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : activeOrder ? 'Save' : 'Save order'}
                    </button>
                    {activeOrder && (
                      <button onClick={() => doSave(true)} disabled={!list.length || saveState === 'saving'} title="Save as a separate copy"
                        style={{ border: '1px solid #E2E5EA', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#3A4150', whiteSpace: 'nowrap' }}>
                        Save as new
                      </button>
                    )}
                  </div>
                  <div style={{ borderBottom: '1px solid #EEF0F3', margin: '6px 0 2px' }} />
                </div>
              )}
              {list.length === 0 && (
                <p style={{ fontSize: 14, color: '#6A7180', padding: '22px 0', textAlign: 'center' }}>
                  Your list is empty — {account ? 'load a saved order above, or open' : 'open'} a style and type quantities under the sizes you need.
                </p>
              )}
              {groups.map((g) => {
                const gUnits = g.lines.reduce((a, l) => a + l.qty, 0);
                const gTotal = g.lines.reduce((a, l) => a + (l.price || 0) * l.qty, 0);
                const deco = parseDeco(g.lines[0].decoration);
                const decoNote = g.lines[0].decoration_note || '';
                // Toggle one decoration method on/off for this SKU. Clearing the
                // last method drops the note too. Picking any method is mutually
                // exclusive with "no deco" (which is just the empty set).
                const toggleMethod = (m) => {
                  const next = new Set(deco);
                  if (next.has(m)) next.delete(m); else next.add(m);
                  const joined = DECO_METHODS.filter((x) => next.has(x)).join(', ');
                  setSkuDeco(g.sku, { decoration: joined || null, decoration_note: joined ? decoNote : null });
                };
                return (
                <div key={g.sku} style={{ padding: '12px 0', borderBottom: '1px solid #F0F1F4' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.2 }}>{withBrand(g.brand, g.name)}</div>
                      <div style={{ fontSize: 12, color: '#6A7180', marginTop: 2 }}>
                        {g.color} · <span style={{ fontFamily: 'monospace' }}>{g.sku}</span>
                      </div>
                    </div>
                    <button onClick={() => removeSku(g)} aria-label={`Remove ${g.name}`} style={{ border: 'none', background: 'none', color: '#B91C1C', cursor: 'pointer', fontSize: 15, fontWeight: 700, flex: 'none', padding: 2 }}>✕</button>
                  </div>
                  {/* Decoration: tap any methods that apply (an item can be
                      screen-printed AND embroidered). A description box appears
                      once a method is on; its text rides into the estimate line's
                      notes so the rep sees exactly what the coach wants. */}
                  <div role="group" aria-label={`Decoration for ${g.name}`} style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {DECO_METHODS.map((m) => {
                      const on = deco.has(m);
                      return (
                        <button key={m} type="button" className={'ai-filterbtn' + (on ? ' on' : '')} aria-pressed={on}
                          onClick={() => toggleMethod(m)} style={{ padding: '4px 11px', fontSize: 12 }}>
                          {on ? '✓ ' : ''}{m}
                        </button>
                      );
                    })}
                    <button type="button" className={'ai-filterbtn' + (deco.size === 0 ? ' on' : '')} aria-pressed={deco.size === 0}
                      onClick={() => setSkuDeco(g.sku, { decoration: null, decoration_note: null })} style={{ padding: '4px 11px', fontSize: 12 }}>
                      No deco
                    </button>
                  </div>
                  {deco.size > 0 && (
                    <textarea className="ai-input" rows={2} value={decoNote}
                      onChange={(e) => setSkuDeco(g.sku, { decoration_note: e.target.value })}
                      placeholder={`Describe the ${[...deco].join(' + ').toLowerCase()} — logo/text, colors, placement…`}
                      aria-label={`Decoration details for ${g.name}`}
                      style={{ marginTop: 7, resize: 'vertical', fontSize: 13, padding: '7px 10px' }} />
                  )}
                  {/* Every size for this item sits on one line — type a qty under each (0 removes it). */}
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
                    {g.lines.map((l) => (
                      <div key={l.sku + '|' + l.size} className={'ai-sizecell' + (l.inbound ? ' inbound' : '')} title={l.inbound ? `Inbound ${fmtDate(l.inbound)}` : undefined}>
                        <span className="lbl">{sizeLabel(l.size)}</span>
                        <input className="ai-qtyin" placeholder="0" inputMode="numeric" aria-label={`Quantity, size ${sizeLabel(l.size)}`}
                          value={l.qty} onChange={(e) => updateLine(l.i, parseInt(e.target.value.replace(/\D/g, '')) || 0)} />
                        {l.inbound && <span style={{ color: '#92580B', fontWeight: 600, fontSize: 9.5, lineHeight: 1 }}>{fmtDate(l.inbound)}</span>}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8, fontSize: 12.5 }}>
                    <span style={{ color: '#6A7180' }}>{gUnits} unit{gUnits === 1 ? '' : 's'}</span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{gTotal ? fmtPrice(gTotal) : '—'}</span>
                  </div>
                </div>
                );
              })}
              {list.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 4px', fontSize: 13.5, fontWeight: 700 }}>
                  <span>{units} unit{units === 1 ? '' : 's'} · {account ? 'your team pricing' : 'retail reference'}</span>
                  <span>{total ? fmtPrice(total) : '—'}</span>
                </div>
              )}
              {list.length > 0 && (
                <p style={{ fontSize: 11.5, color: '#6A7180', margin: '2px 0 10px' }}>
                  {account
                    ? 'Prices shown are your team pricing — your rep will confirm on the formal estimate.'
                    : 'Retail prices are list-price reference only — your rep will quote your team pricing on the estimate.'}
                </p>
              )}
            </div>

            <div style={{ borderTop: '1px solid #EEF0F3', padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="ai-input" placeholder="Your name *" value={coach.name} onChange={setField('name')} />
                <input className="ai-input" placeholder="Team / organization" value={coach.team} onChange={setField('team')} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="ai-input" placeholder="Email *" type="email" value={coach.email} onChange={setField('email')} />
                <input className="ai-input" placeholder="Phone" type="tel" value={coach.phone} onChange={setField('phone')} />
              </div>
              <textarea className="ai-input" placeholder="Notes for your rep (decoration, deadline, budget…)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: 'vertical' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {images.map((im, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={im.preview} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '1px solid #E2E5EA', display: 'block' }} />
                    <button onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove image"
                      style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#191919', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                  </div>
                ))}
                {images.length < MAX_IMG && (
                  <label style={{ width: 52, height: 52, borderRadius: 8, border: '1.5px dashed #C6CAD2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6A7180', fontSize: 22, flex: 'none' }}>
                    +<input type="file" accept="image/*" multiple onChange={onAddImages} style={{ display: 'none' }} />
                  </label>
                )}
                <span style={{ fontSize: 11, color: '#9AA1AC', flex: 1, minWidth: 130 }}>Optional — add a logo, mockup, or reference image for your rep.</span>
              </div>
              {state === 'error' && <div style={{ fontSize: 13, color: '#B91C1C', fontWeight: 600 }}>{errMsg}</div>}
              <button
                onClick={submit}
                disabled={!canSend || state === 'sending'}
                style={{ border: 'none', background: canSend ? '#191919' : '#C6CAD2', color: '#fff', borderRadius: 10, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: canSend ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {state === 'sending' ? 'Sending…' : 'Send to my rep for an estimate'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function AdidasInventory() {
  const [loading, setLoading] = useState(true);
  const [loadingAll, setLoadingAll] = useState(true); // Phase-2 full-catalog load still running
  const [error, setError] = useState('');
  const [styles, setStyles] = useState([]);
  const [productGroups, setProductGroups] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [search, setSearch] = useState('');
  // Styles pulled in by the on-demand DB search — items NOT in the browse set
  // (archived/X'd, non-featured Momentec, curated SanMar/S&S not yet loaded).
  const [searchExtra, setSearchExtra] = useState([]);
  const [brand, setBrand] = useState('All');
  const [subBrand, setSubBrand] = useState('All');
  const [category, setCategory] = useState('All');
  const [gender, setGender] = useState('All');
  const [sport, setSport] = useState('All');
  const [colorSel, setColorSel] = useState(() => loadJson('nsa_adidas_team_colors', []));
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = React.useRef(null);
  // Outside-click close. (A fixed backdrop doesn't work here: the sticky bar's
  // backdrop-filter makes it the containing block for fixed descendants.)
  useEffect(() => {
    if (!colorOpen) return;
    const h = (e) => {
      if (!colorRef.current || colorRef.current.contains(e.target)) return;
      setColorOpen(false);
      // Swallow the click that follows this mousedown so closing the popover
      // doesn't also activate whatever sits underneath (e.g. open a card).
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 400);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colorOpen]);
  const [sizeSel, setSizeSel] = useState([]);
  const [strongOnly, setStrongOnly] = useState(false);
  const [includeIncoming, setIncludeIncoming] = useState(true); // on by default — inbound restocks count as available
  // "Need by" date: only show gear in stock now or inbound at least 4 weeks
  // before that date (time for decoration + delivery).
  const [needBy, setNeedBy] = useState('');
  const needCutoff = useMemo(() => {
    if (!needBy) return null;
    const d = new Date(needBy + 'T00:00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() - 28);
    return d.toISOString().slice(0, 10);
  }, [needBy]);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openStyle, setOpenStyle] = useState(null);
  const [list, setList] = useState(() => loadJson(LIST_KEY, []));
  const [activeOrderId, setActiveOrderId] = useState(() => loadJson(ACTIVE_ORDER_KEY, null));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { document.title = 'Product Live Look | National Sports Apparel'; }, []);

  // ── Coach account: magic-link sign-in → customer-linked tier pricing ──
  const [coach, setCoach] = useState(null); // {email,name,customerId,customerName,tier,schoolColors}
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInEmail, setSignInEmail] = useState('');
  const [signInState, setSignInState] = useState('idle'); // idle|sending|sent|error
  useEffect(() => {
    let alive = true;
    const load = async (session) => {
      try {
        const email = session?.user?.email;
        if (!email) { if (alive) setCoach(null); return; }
        // RLS limits this to the signed-in coach's own row (matched by verified email)
        const { data: accts } = await supabase.from('coach_accounts').select('email,name,customer_id,status').limit(1);
        const acct = (accts || [])[0];
        if (!acct || acct.status !== 'active') { if (alive) setCoach(null); return; }
        const { data: custs } = await supabase.from('customers').select('id,name,adidas_ua_tier,school_colors,allowed_brands').eq('id', acct.customer_id).limit(1);
        const c = (custs || [])[0];
        if (!alive) return;
        setCoach({
          email, name: acct.name || '', customerId: acct.customer_id,
          customerName: (c && c.name) || '', tier: (c && c.adidas_ua_tier) || 'B',
          schoolColors: Array.isArray(c && c.school_colors) ? c.school_colors : [],
          allowedBrands: Array.isArray(c && c.allowed_brands) ? c.allowed_brands : [],
        });
      } catch { if (alive) setCoach(null); }
    };
    supabase.auth.getSession().then(({ data }) => load(data && data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => load(session));
    return () => { alive = false; if (sub && sub.subscription) sub.subscription.unsubscribe(); };
  }, []);
  // School colors pre-load the team-colors filter when the coach hasn't picked any
  useEffect(() => {
    if (!coach || colorSel.length) return;
    const valid = (coach.schoolColors || []).filter((f) => COLOR_DOTS[f]);
    if (valid.length) setColorSel(valid.slice(0, 5));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach]);
  const sendMagicLink = async () => {
    const em = signInEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || signInState === 'sending') return;
    setSignInState('sending');
    // Return the coach to wherever they signed in (/adidas or the proxied
    // /livelook). This exact URL must be allow-listed in Supabase Auth redirects.
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: window.location.origin + catalogPath() } });
    setSignInState(error ? 'error' : 'sent');
  };
  const signOut = () => { supabase.auth.signOut().catch(() => {}); setCoach(null); setSignInOpen(false); setSignInState('idle'); };
  // Team price for a colorway under the coach's adidas/UA tier (null when anonymous)
  const yourPriceFn = useCallback(
    (cw) => {
      if (!coach) return null;
      // Items with a flat catalog sell price (e.g. S&S = cost x 1.65) don't use
      // the adidas tier discount — same price for every tier.
      if (cw.sell != null) return cw.sell;
      return cw.price ? rQ(cw.price * (1 - auTierDisc(coach.tier, cw.pricing_group, cw.category))) : null;
    },
    [coach],
  );

  // Brands this account may see. A coach whose customer has allowed_brands set
  // is locked to those (e.g. an adidas-only account never sees UA/Nike); empty
  // / anonymous = all brands. Returns the exact CATALOG_BRANDS reference when
  // unrestricted so the product fetch below doesn't re-run for normal coaches.
  const effectiveBrands = useMemo(() => {
    const allow = Array.isArray(coach?.allowedBrands) ? coach.allowedBrands.filter((b) => CATALOG_BRANDS.includes(b)) : [];
    return allow.length ? allow : CATALOG_BRANDS;
  }, [coach]);
  // Brand-filter groups available to this account (named brands they can see +
  // "Non Branded" if any non-named brand is in reach).
  const availBrandGroups = useMemo(() => [...new Set(effectiveBrands.map(brandGroup))], [effectiveBrands]);
  // Don't strand a coach on a brand group their account can no longer see (e.g.
  // the restriction tightened mid-session) — the brand picker hides at one brand.
  useEffect(() => {
    if (brand !== 'All' && !availBrandGroups.includes(brand)) setBrand('All');
  }, [availBrandGroups, brand]);
  useEffect(() => { setSubBrand('All'); }, [brand]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((msg) => setToast({ msg, ts: Date.now() }), []);

  // ── Order list ──
  const mutateList = useCallback((fn) => {
    setList((prev) => { const next = fn(prev); saveJson(LIST_KEY, next); return next; });
  }, []);
  // Set an exact quantity for a SKU+size (qty inputs in the style modal);
  // 0 removes the line.
  const setLineQty = useCallback((st, cw, size, qty, inbound) => {
    const n = Math.max(0, Math.min(9999, qty));
    mutateList((prev) => {
      const i = prev.findIndex((l) => l.sku === cw.sku && l.size === size);
      if (n === 0) return i >= 0 ? prev.filter((_, j) => j !== i) : prev;
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: n } : l));
      return [...prev, { sku: cw.sku, brand: st.brand, name: st.name, color: cw.color || cw.family, size, qty: n, price: (yourPriceFn(cw) || cw.price) || 0, inbound: inbound || null, decoration: null, decoration_note: null }];
    });
  }, [mutateList, yourPriceFn]);
  const updateLine = useCallback((i, qty) => {
    mutateList((prev) => (qty <= 0 ? prev.filter((_, j) => j !== i) : prev.map((l, j) => (j === i ? { ...l, qty: Math.min(9999, qty) } : l))));
  }, [mutateList]);
  // Decoration is chosen per item (colorway), so a patch applies to every size
  // of that SKU on the list at once. `patch` is a partial line — { decoration,
  // decoration_note } — letting the drawer toggle methods and edit the note
  // without clobbering the other field.
  const setSkuDeco = useCallback((sku, patch) => {
    mutateList((prev) => prev.map((l) => (l.sku === sku ? { ...l, ...patch } : l)));
  }, [mutateList]);
  const removeLine = useCallback((i) => mutateList((prev) => prev.filter((_, j) => j !== i)), [mutateList]);
  const clearList = useCallback(() => mutateList(() => []), [mutateList]);
  const qtyInList = useCallback((sku, size) => {
    const l = list.find((x) => x.sku === sku && x.size === size);
    return l ? l.qty : 0;
  }, [list]);

  // ── Saved orders (signed-in coaches; team-shared via coach_saved_orders) ──
  const [savedOrders, setSavedOrders] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const SAVED_COLS = 'id,name,notes,lines,status,submit_count,last_submitted_at,created_by_name,updated_at';
  const setActiveOrder = useCallback((id) => { setActiveOrderId(id); saveJson(ACTIVE_ORDER_KEY, id); }, []);

  // Load the team's saved orders whenever the signed-in account changes (RLS
  // limits the rows to this coach's customer); clears on sign-out.
  const loadSavedOrders = useCallback(async () => {
    if (!coach || !coach.customerId) { setSavedOrders([]); return; }
    setSavedLoading(true);
    const { data, error } = await supabase
      .from('coach_saved_orders').select(SAVED_COLS)
      .eq('customer_id', coach.customerId).order('updated_at', { ascending: false });
    setSavedLoading(false);
    if (!error) setSavedOrders(data || []);
  }, [coach]);
  useEffect(() => { loadSavedOrders(); }, [loadSavedOrders]);

  const linesForSave = useCallback(() => list.map((l) => ({
    sku: l.sku, brand: l.brand, name: l.name, color: l.color, size: l.size,
    qty: l.qty, price: l.price, inbound: l.inbound || null, decoration: l.decoration || null,
    decoration_note: l.decoration_note || null,
  })), [list]);

  // Create or update a saved order from the current cart. forceNew always inserts
  // a copy; submit marks it submitted and bumps the counters but keeps it
  // editable/re-submittable. Returns { data } or { error }.
  const saveOrder = useCallback(async ({ name, notes, forceNew, submit } = {}) => {
    if (!coach || !coach.customerId) return { error: 'Sign in to save orders' };
    const clean = { name: (name || '').trim() || 'Untitled order', notes: (notes || '').trim() || null, lines: linesForSave(), updated_by_email: coach.email };
    const targetId = forceNew ? null : activeOrderId;
    try {
      if (targetId) {
        const patch = { ...clean };
        if (submit) {
          const cur = savedOrders.find((o) => o.id === targetId);
          patch.status = 'submitted';
          patch.submit_count = ((cur && cur.submit_count) || 0) + 1;
          patch.last_submitted_at = new Date().toISOString();
          if (submit.requestId) patch.last_request_id = submit.requestId;
        }
        const { data, error } = await supabase.from('coach_saved_orders').update(patch).eq('id', targetId).select(SAVED_COLS).single();
        if (error) return { error: error.message };
        setSavedOrders((prev) => [data, ...prev.filter((o) => o.id !== data.id)]);
        setActiveOrder(data.id);
        return { data };
      }
      const ins = { customer_id: coach.customerId, created_by_email: coach.email, created_by_name: coach.name || null, brand: 'adidas', ...clean };
      if (submit) { ins.status = 'submitted'; ins.submit_count = 1; ins.last_submitted_at = new Date().toISOString(); if (submit.requestId) ins.last_request_id = submit.requestId; }
      const { data, error } = await supabase.from('coach_saved_orders').insert(ins).select(SAVED_COLS).single();
      if (error) return { error: error.message };
      setSavedOrders((prev) => [data, ...prev]);
      setActiveOrder(data.id);
      return { data };
    } catch (e) { return { error: e.message || 'Could not save' }; }
  }, [coach, activeOrderId, savedOrders, linesForSave, setActiveOrder]);

  const loadOrderIntoCart = useCallback((o) => {
    if (list.length && activeOrderId !== o.id && !window.confirm('Replace your current list with this saved order?')) return;
    const lines = Array.isArray(o.lines) ? o.lines : [];
    setList(lines); saveJson(LIST_KEY, lines);
    setActiveOrder(o.id);
    notify(`Loaded “${o.name || 'Untitled order'}”`);
  }, [list, activeOrderId, setActiveOrder, notify]);

  const renameOrder = useCallback(async (id, name) => {
    const nm = (name || '').trim() || 'Untitled order';
    const { data, error } = await supabase.from('coach_saved_orders').update({ name: nm, updated_by_email: coach && coach.email }).eq('id', id).select(SAVED_COLS).single();
    if (!error && data) setSavedOrders((prev) => prev.map((o) => (o.id === id ? data : o)));
    else if (error) notify(error.message);
  }, [coach, notify]);

  const deleteOrder = useCallback(async (id) => {
    const { error } = await supabase.from('coach_saved_orders').delete().eq('id', id);
    if (error) { notify(error.message); return; }
    setSavedOrders((prev) => prev.filter((o) => o.id !== id));
    if (activeOrderId === id) setActiveOrder(null);
  }, [activeOrderId, setActiveOrder, notify]);

  const newBlankOrder = useCallback(() => {
    if (list.length && !window.confirm('Clear your current list to start a new order?')) return;
    setList([]); saveJson(LIST_KEY, []);
    setActiveOrder(null);
  }, [list, setActiveOrder]);

  // ── Favorites (starred styles, team-shared) + account overlay ──
  const [favorites, setFavorites] = useState([]);
  const [favLoading, setFavLoading] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const favKeys = useMemo(() => new Set(favorites.map((f) => f.style_key)), [favorites]);
  const FAV_COLS = 'id,style_key,brand,name,category,image_url';

  const loadFavorites = useCallback(async () => {
    if (!coach || !coach.customerId) { setFavorites([]); return; }
    setFavLoading(true);
    const { data, error } = await supabase
      .from('coach_favorite_items').select(FAV_COLS)
      .eq('customer_id', coach.customerId).order('created_at', { ascending: false });
    setFavLoading(false);
    if (!error) setFavorites(data || []);
  }, [coach]);
  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const unfavorite = useCallback(async (styleKey) => {
    const existing = favorites.find((f) => f.style_key === styleKey);
    if (!existing) return;
    setFavorites((prev) => prev.filter((f) => f.id !== existing.id)); // optimistic
    const { error } = await supabase.from('coach_favorite_items').delete().eq('id', existing.id);
    if (error) { notify(error.message); loadFavorites(); }
  }, [favorites, notify, loadFavorites]);

  const toggleFavorite = useCallback(async (st) => {
    if (!coach || !coach.customerId || !st) return;
    if (favKeys.has(st.key)) { unfavorite(st.key); return; }
    const cover = (st.colorways || []).find((c) => c.img);
    const row = { customer_id: coach.customerId, created_by_email: coach.email, style_key: st.key,
      brand: st.brand || null, name: st.name || null, category: st.category || null, image_url: (cover && cover.img) || null };
    const { data, error } = await supabase.from('coach_favorite_items').insert(row).select(FAV_COLS).single();
    if (error) { notify(error.message); return; }
    setFavorites((prev) => [data, ...prev.filter((f) => f.style_key !== st.key)]);
    notify('Added to favorites ★');
  }, [coach, favKeys, unfavorite, notify]);

  // Open a favorited style in the detail modal; guard against a stale favorite
  // whose style isn't in the current (brand-filtered) catalog.
  const openStyleByKey = useCallback((key) => {
    if (!styles.some((s) => s.key === key)) { notify('That item isn’t in your current catalog view'); return; }
    setAccountOpen(false);
    setOpenStyle(key);
  }, [styles, notify]);

  // From the account overlay: open a saved order (load into cart + show drawer).
  const openSavedOrderFromAccount = useCallback((o) => {
    loadOrderIntoCart(o); setAccountOpen(false); setDrawerOpen(true);
  }, [loadOrderIntoCart]);
  const newOrderFromAccount = useCallback(() => {
    newBlankOrder(); setAccountOpen(false); setDrawerOpen(true);
  }, [newBlankOrder]);

  useEffect(() => {
    let alive = true;
    setLoadingAll(true);
    // PROD_SELECT is module-scoped (shared with the search effect below).
    // Unrestricted accounts get the named-brand catalog PLUS every SanMar-sourced
    // item (the "Non Branded" lines) regardless of their exact brand string;
    // restricted coaches stay locked to just their allowed named brands.
    const unrestricted = effectiveBrands === CATALOG_BRANDS;
    const baseQ = () => {
      const q = supabase.from('products').select(PROD_SELECT)
        .eq('is_active', true).or('is_archived.is.null,is_archived.eq.false');
      return unrestricted
        ? q.or('brand.in.(' + CATALOG_BRANDS.map((b) => '"' + b + '"').join(',') + '),inventory_source.eq.sanmar')
        : q.in('brand', effectiveBrands);
    };
    (async () => {
      try {
        // Phase 1: featured (all) + per-brand teaser so every brand chip
        // appears from first paint. A single 500-item image-sorted query was
        // monopolized by Adidas/UA (most images), hiding every other brand.
        // For unrestricted accounts run one query per brand in parallel with
        // a per-brand cap; restricted accounts only have a few brands so the
        // original single query is fine.
        const mkBrandQ = (brand) =>
          supabase.from('products').select(PROD_SELECT)
            .eq('is_active', true).or('is_archived.is.null,is_archived.eq.false')
            .eq('brand', brand).or('is_featured.is.null,is_featured.eq.false')
            .order('image_front_url', { ascending: false, nullsFirst: false }).order('name');

        const [featRes, groupsRes, ...quickResults] = await Promise.all([
          baseQ().eq('is_featured', true).order('name'),
          supabase.from('product_groups').select('id,display_name,product_group_members(vendor_id,style_key)'),
          ...(unrestricted
            ? [
                // SanMar-sourced items (Port Authority, Sport-Tek, District, Bella+Canvas, …)
                supabase.from('products').select(PROD_SELECT)
                  .eq('is_active', true).or('is_archived.is.null,is_archived.eq.false')
                  .eq('inventory_source', 'sanmar').or('is_featured.is.null,is_featured.eq.false')
                  .order('image_front_url', { ascending: false, nullsFirst: false }).order('name').limit(200),
                mkBrandQ('Adidas').limit(80),
                mkBrandQ('Under Armour').limit(80),
                mkBrandQ('Nike').limit(50),
                mkBrandQ('Richardson').limit(50),
                mkBrandQ('Gildan').limit(30),
                mkBrandQ('Boxercraft').limit(30),
              ]
            : [
                baseQ().or('is_featured.is.null,is_featured.eq.false')
                  .order('image_front_url', { ascending: false, nullsFirst: false })
                  .order('name').limit(500),
              ]
          ),
        ]);
        if (!alive) return;
        if (featRes.error) throw featRes.error;
        for (const r of quickResults) if (r.error) throw r.error;
        const groupsData = (groupsRes && !groupsRes.error && groupsRes.data) || [];
        setProductGroups(groupsData);
        const prods = [...(featRes.data || []), ...quickResults.flatMap((r) => r.data || [])];
        const skus  = [...new Set(prods.map((p) => p.sku))];
        const ids   = [...new Set(prods.map((p) => p.id))];
        // Chunked so the SKU/id .in() lists can't overflow the gateway URL limit
        // (a large featured + teaser set previously 400'd here and broke LiveLook).
        const { inv, ih } = await fetchInventory(skus, ids, () => alive);
        if (!alive) return;
        const { grouped, synced } = buildStyles(prods, inv, ih, { groups: groupsData });
        if (!alive) return;
        setStyles(grouped);
        setLastSynced(synced);
        setLoading(false);

        // ── Phase 2 (background): the FULL catalog ──────────────────────
        // Phase 1 is only a 500-item teaser that skews to whichever brands
        // have the most images (Adidas/UA), so smaller brands never load.
        // Strategy: fetch ALL in-scope products first (~45K rows, paged),
        // then query inventory scoped to exactly those SKUs in batched
        // parallel waves — avoids a slow offset-pagination scan of the full
        // 136K-row inventory_unified view.
        try {
          // Skip non-featured Momentec in the full load — it's 30K+ rows and
          // only featured Momentec shows in the grid (the rest is search-only).
          // (brand != Momentec) OR (is_featured = true) keeps everything else
          // plus the hand-picked Momentec styles.
          const allProds = await fetchAllPages(
            () => baseQ().or('brand.neq.Momentec,is_featured.eq.true').order('name'));
          if (!alive) return;

          const allSkus = [...new Set(allProds.map((p) => p.sku))];
          const allIds  = [...new Set(allProds.map((p) => p.id))];

          const { inv: allInv, ih: allIh } = await fetchInventory(allSkus, allIds, () => alive);
          if (!alive) return;

          const full = buildStyles(allProds, allInv, allIh, { groups: groupsData });
          if (!alive) return;
          setStyles(full.grouped);
          if (full.synced) setLastSynced(full.synced);
        } catch (e) {
          // Keep the Phase-1 teaser on screen if the full load fails.
          console.warn('[livelook] full catalog load failed:', (e && e.message) || e);
        } finally {
          if (alive) setLoadingAll(false);
        }
      } catch (e) {
        if (!alive) return;
        setError(e.message || String(e));
        setLoading(false);
        setLoadingAll(false);
      }
    })();
    return () => { alive = false; };
  }, [effectiveBrands]);

  // On-demand search: when the user types, query the DB directly so items that
  // aren't in the browse set still surface — archived (X'd) items, non-featured
  // Momentec, and any curated SanMar/S&S not yet loaded. Results merge into
  // `visible` below; the in-stock filter still applies. SKU-first (the stated
  // "I have a SKU" case); multi-word over-fetches by token, then compileSearch
  // narrows with AND semantics.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setSearchExtra([]); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const toks = q.replace(/[%,()]/g, ' ').split(/\s+/).filter((t) => t.length >= 2).slice(0, 4);
        if (!toks.length) { setSearchExtra([]); return; }
        const orParts = [];
        for (const t of toks) orParts.push(`name.ilike.%${t}%`, `sku.ilike.%${t}%`, `color.ilike.%${t}%`);
        const unrestricted = effectiveBrands === CATALOG_BRANDS;
        let pq = supabase.from('products').select(PROD_SELECT)
          .eq('is_active', true)             // NOT is_archived: X'd items stay searchable
          .or(orParts.join(','))
          .limit(200);
        if (!unrestricted) pq = pq.in('brand', effectiveBrands);
        const { data: prods, error } = await pq;
        if (error) throw error;
        if (!alive) return;
        if (!prods || !prods.length) { setSearchExtra([]); return; }
        const skus = [...new Set(prods.map((p) => p.sku))];
        const ids  = [...new Set(prods.map((p) => p.id))];
        const { inv, ih } = await fetchInventory(skus, ids, () => alive);
        if (!alive) return;
        // keepAllMomentec: don't drop non-featured Momentec from search results.
        const { grouped } = buildStyles(prods, inv, ih, { keepAllMomentec: true, groups: productGroups });
        setSearchExtra(grouped);
      } catch (e) {
        if (alive) { console.warn('[livelook] search failed:', (e && e.message) || e); setSearchExtra([]); }
      }
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [search, effectiveBrands, productGroups]);

  // Colorway-level filters: a style shows if ANY colorway passes all of them.
  // Team colors: a colorway matches when it features ANY selected color —
  // so picking Maroon + Gold surfaces Maroon/White, Gold/Maroon, plain Maroon…
  const cwMatcher = useCallback((cw) => {
    if (colorSel.length && !colorSel.some((c) => cw.tags.has(c))) return false;
    // An inbound delivery counts when a "need by" date is set and it lands at
    // least 4 weeks before it; otherwise only via the "Include incoming" toggle.
    const inboundOk = (s) => !!(s.fd && s.fq) && (needCutoff ? s.fd <= needCutoff : includeIncoming);
    if (sizeSel.length) {
      const sizeAvail = (sz) => cw.inStock.has(sz) || cw.sizes.some((s) => s.size === sz && inboundOk(s));
      if (!sizeSel.every(sizeAvail)) return false;
    }
    if (strongOnly && !cw.strongRun) return false;
    if (cw.units > 0) return true;
    return cw.sizes.some(inboundOk);
  }, [colorSel, sizeSel, strongOnly, includeIncoming, needCutoff]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchQ = q ? compileSearch(q) : null;
    // When searching, fold in DB-search results (archived / non-featured Momentec /
    // not-yet-loaded curated items) that aren't already in the loaded browse set.
    let source = styles;
    if (q && searchExtra.length) {
      const m = new Map(styles.map((s) => [s.key, s]));
      for (const s of searchExtra) if (!m.has(s.key)) m.set(s.key, s);
      source = [...m.values()];
    }
    const out = [];
    for (const st of source) {
      if (brand !== 'All' && brandGroup(st.brand) !== brand) continue;
      if (brand === NON_BRANDED && subBrand !== 'All' && st.brand !== subBrand) continue;
      if (category !== 'All' && st.category !== category) continue;
      if (gender !== 'All' && st.gender !== gender) continue;
      if (sport !== 'All' && st.sport !== sport) continue;
      if (matchQ && !matchQ(st)) continue;
      const matchCws = st.colorways.filter(cwMatcher);
      if (!matchCws.length) continue;
      // Auto-hide imageless styles from the browse grid (no "image coming soon"
      // cards). Still findable via search, where q is set.
      if (!q && !matchCws.some((c) => c.img)) continue;
      out.push({ st, matchCws });
    }
    // With team colors picked, float styles whose colorways hit more of them;
    // ties broken by the bag merch boost so duffels still lead within Bags.
    if (colorSel.length) {
      const score = ({ matchCws }) => Math.max(...matchCws.map((c) => colorSel.filter((x) => c.tags.has(x)).length));
      out.sort((a, b) => score(b) - score(a) || bagMerchBoost(b.st) - bagMerchBoost(a.st));
      return out;
    }
    // Default merchandising order (stable sort keeps category/name ties):
    // NSA in-house stock first (ships now — move what we own), then crowd
    // favorites (Pregame / Fleece / 1/4 Zips), then stock depth, then
    // Black/Navy/Grey staple colors; imageless styles sink. After every few
    // cards a style with an imaged RED colorway is pulled forward as a color
    // pop — its card cover is forced to the red colorway.
    const score = (v) => {
      const ih = v.matchCws.reduce((a, c) => a + (c.inHouseUnits || 0), 0);
      const units = v.matchCws.reduce((a, c) => a + c.units, 0);
      let s = v.st.isFeatured ? 50000 : 0;
      if (ih > 0) s += 100000 + Math.min(ih, 500) / 5;
      s += popScore(v.st);
      s += bagMerchBoost(v.st); // duffels (Defender / Team Issue first) lead the Bags category
      s += Math.min(units, 2000) / 20;
      s += Math.max(...v.matchCws.map((c) => MERCH_PRIORITY[c.family] ?? 1)) * 10;
      if (!v.st.colorways.some((c) => c.img)) s -= 500;
      return s;
    };
    out.sort((a, b) => score(b) - score(a));
    const isRedCand = (v) => v.matchCws.some((c) => c.family === 'Red' && c.img);
    const used = new Set();
    const mixed = [];
    for (let i = 0; i < out.length; i++) {
      if (used.has(i)) continue;
      mixed.push(out[i]);
      if (mixed.length % POP_EVERY === 0) {
        for (let j = i + 1; j < out.length; j++) {
          if (!used.has(j) && isRedCand(out[j])) {
            used.add(j);
            mixed.push({ ...out[j], popColor: 'Red' });
            break;
          }
        }
      }
    }
    return mixed;
  }, [styles, searchExtra, search, brand, subBrand, category, gender, sport, cwMatcher, colorSel]);

  // Facet options (with counts under everything-but-this-facet filtering kept
  // simple: counts reflect the full availability mode, not cross-facets)
  const facets = useMemo(() => {
    const brands = {}, cats = {}, sports = {}, genders = {}, colors = {};
    for (const st of styles) {
      // Match the grid: count only styles with an available, imaged colorway.
      const anyAvail = st.colorways.some((c) => (c.units > 0 || (includeIncoming && c.hasIncoming)) && c.img);
      if (!anyAvail) continue;
      if (st.brand) brands[brandGroup(st.brand)] = (brands[brandGroup(st.brand)] || 0) + 1;
      cats[st.category] = (cats[st.category] || 0) + 1;
      genders[st.gender] = (genders[st.gender] || 0) + 1;
      if (st.sport) sports[st.sport] = (sports[st.sport] || 0) + 1;
      for (const c of st.colorways) {
        if (c.units > 0 || (includeIncoming && c.hasIncoming)) c.tags.forEach((t) => { colors[t] = 1; });
      }
    }
    return {
      // Collapsed to filter groups (Adidas, Under Armour, Nike, Non Branded), only those present
      brands: BRAND_FILTERS.filter((b) => brands[b]).map((b) => ({ v: b, n: brands[b] })),
      categories: Object.keys(cats).sort().map((c) => ({ v: c, n: cats[c] })),
      genders: ["Men's", "Women's", 'Youth', 'Unisex'].filter((g) => genders[g]).map((g) => ({ v: g, n: genders[g] })),
      sports: Object.keys(sports).sort().map((s) => ({ v: s, n: sports[s] })),
      colors: COLOR_FAMILIES.filter((f) => colors[f] && f !== 'Other'),
    };
  }, [styles, includeIncoming]);

  const subBrandOptions = useMemo(() => {
    if (brand !== NON_BRANDED) return [];
    const counts = {};
    for (const st of styles) {
      if (brandGroup(st.brand) !== NON_BRANDED) continue;
      const anyAvail = st.colorways.some((c) => (c.units > 0 || (includeIncoming && c.hasIncoming)) && c.img);
      if (!anyAvail) continue;
      counts[st.brand] = (counts[st.brand] || 0) + 1;
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([v, n]) => ({ v, n }));
  }, [styles, brand, includeIncoming]);

  useEffect(() => { setShown(PAGE_SIZE); }, [search, brand, subBrand, category, gender, sport, colorSel, sizeSel, strongOnly, includeIncoming, needBy]);

  // Deep link: /adidas?style=<sku> opens that style's detail view (Share button)
  useEffect(() => {
    if (!styles.length) return;
    const sku = new URLSearchParams(window.location.search).get('style');
    if (!sku) return;
    const st = styles.find((s) => s.colorways.some((c) => c.sku.toUpperCase() === sku.toUpperCase()));
    if (st) setOpenStyle(st.key);
  }, [styles]);

  const toggleSize = (s) => setSizeSel((sel) => sel.includes(s) ? sel.filter((x) => x !== s) : [...sel, s]);
  const toggleColor = (f) => setColorSel((sel) => {
    const next = sel.includes(f) ? sel.filter((x) => x !== f) : (sel.length < 5 ? [...sel, f] : sel);
    saveJson('nsa_adidas_team_colors', next);
    return next;
  });
  const clearFilters = () => { setSearch(''); setBrand('All'); setSubBrand('All'); setCategory('All'); setGender('All'); setSport('All'); setColorSel([]); saveJson('nsa_adidas_team_colors', []); setSizeSel([]); setStrongOnly(false); setNeedBy(''); };
  const hasFilters = search || brand !== 'All' || subBrand !== 'All' || category !== 'All' || gender !== 'All' || sport !== 'All' || colorSel.length || sizeSel.length || strongOnly || needBy;

  const openData = openStyle && visible.find((v) => v.st.key === openStyle);
  const openFallback = openStyle && !openData && styles.find((s) => s.key === openStyle);

  const embedded = isEmbedded();
  const REQUEST_ACCT_HREF = 'mailto:steve@nationalsportsapparel.com?subject=LiveLook+Access+Request&body=Hi+NSA+team%2C%0A%0AI%27d+like+a+LiveLook+account+so+I+can+see+team+pricing+and+save+orders.%0A%0AName%3A+%0ASchool+%2F+Team%3A+%0AEmail%3A+';

  // Coach magic-link sign-in controls — shared by the full dark header (standalone
  // page) and the compact bar shown when embedded on nationalsportsapparel.com/livelook.
  const signInControls = coach ? (
    <>
      <span style={{ background: '#2B2F38', borderRadius: 999, padding: '7px 16px', fontSize: 13.5, fontWeight: 600, color: '#E7E9ED' }}>
        {coach.customerName || coach.email} · <b style={{ color: '#7CE08A' }}>your team pricing is on</b>
      </span>
      <button onClick={() => setAccountOpen(true)}
        style={{ background: 'none', border: '1px solid #3A4150', color: '#C3C8D0', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
        My account{(savedOrders.length + favorites.length) ? ` (${savedOrders.length + favorites.length})` : ''}
      </button>
      <button onClick={signOut} style={{ background: 'none', border: 'none', color: '#9AA1AC', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>Sign out</button>
    </>
  ) : signInOpen ? (
    signInState === 'sent' ? (
      <span style={{ background: '#1E3A2A', borderRadius: 999, padding: '7px 16px', fontSize: 13.5, fontWeight: 600, color: '#7CE08A' }}>
        ✓ Check your email for the sign-in link
      </span>
    ) : (
      <>
        <input value={signInEmail} onChange={(e) => setSignInEmail(e.target.value)} placeholder="coach@school.org" type="email"
          onKeyDown={(e) => { if (e.key === 'Enter') sendMagicLink(); }}
          style={{ background: '#2B2F38', border: '1px solid #3A4150', borderRadius: 999, padding: '7px 16px', fontSize: 13.5, color: '#fff', outline: 'none', fontFamily: 'inherit', width: 230 }} autoFocus />
        <button onClick={sendMagicLink} disabled={signInState === 'sending'}
          style={{ background: '#fff', color: '#191919', border: 'none', borderRadius: 999, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {signInState === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </button>
        <button onClick={() => { setSignInOpen(false); setSignInState('idle'); }} style={{ background: 'none', border: 'none', color: '#9AA1AC', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
        {signInState === 'error' && <span style={{ fontSize: 12.5, color: '#FCA5A5' }}>Couldn't send — try again</span>}
        <a href={REQUEST_ACCT_HREF} style={{ fontSize: 11.5, color: '#9AA1AC', textDecoration: 'underline', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
          No account? Request one →
        </a>
      </>
    )
  ) : (
    <>
      <button onClick={() => setSignInOpen(true)}
        style={{ background: 'none', border: '1px solid #3A4150', color: '#C3C8D0', borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
        Coach sign in — see your team pricing
      </button>
      <a href={REQUEST_ACCT_HREF}
        style={{ fontSize: 13, color: '#9AA1AC', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        Request an account
      </a>
    </>
  );
  return (
    <div className="ai-root" style={{ fontFamily: BODY }}>
      <Styles />

      {/* Header — hidden when embedded; the marketing site supplies its own */}
      {!embedded && (
      <header style={{ background: '#191919', color: '#fff' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '26px 20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 'clamp(30px,5vw,44px)', margin: 0, textTransform: 'uppercase', letterSpacing: '.01em' }}>
              Product Live Look
            </h1>
            <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: '#9AA1AC', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              National Sports Apparel
            </span>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: '#C3C8D0', maxWidth: 780, lineHeight: 1.5 }}>
            Every style we carry, with a live look at what's in stock right now across Adidas, Under Armour, Nike, Richardson, Momentec, Port Authority, Sport-Tek, District, Bella+Canvas, Boxercraft & Gildan — by color and size — and when restocks land. Quantities change daily{lastSynced ? ` — last updated ${new Date(lastSynced).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}.
            Open a style, type the quantities you need per size, and send the list to your rep — they'll follow up with a formal estimate.
          </p>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {signInControls}
          </div>
        </div>
      </header>
      )}

      {/* Embedded (nationalsportsapparel.com/livelook): the marketing site hides
          our dark header, so surface a compact coach sign-in strip here instead. */}
      {embedded && (
        <div style={{ background: '#191919', color: '#fff' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {!coach && !signInOpen && (
              <span style={{ fontSize: 12.5, color: '#9AA1AC', marginRight: 'auto' }}>
                Coaches —{' '}
                <button onClick={() => setSignInOpen(true)} style={{ background: 'none', border: 'none', color: '#C3C8D0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0, textDecoration: 'underline' }}>sign in</button>
                {' '}for team pricing &amp; saved orders, or{' '}
                <a href={REQUEST_ACCT_HREF} style={{ color: '#C3C8D0', textDecoration: 'underline' }}>request an account</a>
              </span>
            )}
            {signInControls}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(244,245,247,.94)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #E6E8EC' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', maxWidth: 340 }}>
              <input className="ai-search" placeholder="Search style, SKU, or color…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {facets.brands.length > 1 && (
            <select className="ai-select" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand">
              <option value="All">All brands</option>
              {facets.brands.map(({ v, n }) => <option key={v} value={v}>{v}{loadingAll ? '' : ` (${n})`}</option>)}
            </select>
            )}
            {brand === NON_BRANDED && subBrandOptions.length > 1 && (
            <select className="ai-select" value={subBrand} onChange={(e) => setSubBrand(e.target.value)} aria-label="Brand name">
              <option value="All">All brands</option>
              {subBrandOptions.map(({ v, n }) => <option key={v} value={v}>{v}{loadingAll ? '' : ` (${n})`}</option>)}
            </select>
            )}
            <select className="ai-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Item type">
              <option value="All">All items</option>
              {facets.categories.map(({ v, n }) => <option key={v} value={v}>{v}{loadingAll ? '' : ` (${n})`}</option>)}
            </select>
            <select className="ai-select" value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender">
              <option value="All">All genders</option>
              {facets.genders.map(({ v, n }) => <option key={v} value={v}>{v}{loadingAll ? '' : ` (${n})`}</option>)}
            </select>
            <select className="ai-select" value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport">
              <option value="All">All sports</option>
              {facets.sports.map(({ v, n }) => <option key={v} value={v}>{v}{loadingAll ? '' : ` (${n})`}</option>)}
            </select>
            <div style={{ position: 'relative' }} ref={colorRef}>
              <button className={'ai-filterbtn' + (colorSel.length ? ' on' : '')} style={{ padding: '8px 13px', borderRadius: 10, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => setColorOpen((v) => !v)} aria-label="Team colors">
                {colorSel.length
                  ? <>{colorSel.map((f) => <span key={f} className="ai-dot" style={{ background: COLOR_DOTS[f], borderColor: 'rgba(255,255,255,.5)' }} />)} Team colors</>
                  : 'Team colors'} ▾
              </button>
              {colorOpen && (
                <>
                  <div className="ai-colorpop">
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6A7180', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                      Pick up to 5 — shows gear featuring your colors
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                      {facets.colors.map((f) => (
                        <button key={f} className={'ai-swatch' + (colorSel.includes(f) ? ' on' : '')} onClick={() => toggleColor(f)}>
                          <span className="ai-dot" style={{ background: COLOR_DOTS[f], width: 17, height: 17 }} />{f}
                        </button>
                      ))}
                    </div>
                    {colorSel.length > 0 && (
                      <button className="ai-filterbtn" style={{ marginTop: 10, width: '100%', fontSize: 12.5 }} onClick={() => { setColorSel([]); saveJson('nsa_adidas_team_colors', []); }}>
                        Clear colors
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <span style={{ fontSize: 13, color: '#6A7180', fontWeight: 600, marginLeft: 'auto' }}>
              {loading ? 'Loading…' : `${visible.length} style${visible.length === 1 ? '' : 's'}`}
              {!loading && loadingAll ? ' · loading more…' : ''}
            </span>
          </div>
          {/* Quick category chips — one-tap "sections" for the most-shopped types
              (Footwear surfaced first). Full category list stays in the dropdown above. */}
          {facets.categories.length > 1 && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6A7180', textTransform: 'uppercase', letterSpacing: '.05em' }}>Shop:</span>
            <button className={'ai-filterbtn' + (category === 'All' ? ' on' : '')} style={{ padding: '3px 11px', fontSize: 12.5 }} onClick={() => setCategory('All')}>All</button>
            {QUICK_CATS.filter((c) => facets.categories.some((fc) => fc.v === c)).map((c) => (
              <button key={c} className={'ai-filterbtn' + (category === c ? ' on' : '')} style={{ padding: '3px 11px', fontSize: 12.5 }}
                onClick={() => setCategory(category === c ? 'All' : c)}>
                {c === 'Footwear' ? '👟 Footwear' : c}
              </button>
            ))}
          </div>
          )}
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
            <span style={{ width: 1, height: 18, background: '#D8DCE2', margin: '0 3px' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6A7180', textTransform: 'uppercase', letterSpacing: '.05em' }}>Need by:</span>
            <input type="date" value={needBy} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setNeedBy(e.target.value)}
              style={{ border: '1px solid ' + (needBy ? '#191919' : '#D8DCE2'), background: needBy ? '#191919' : '#fff', color: needBy ? '#fff' : '#3A4150', borderRadius: 999, padding: '3px 11px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}
              title="Only show gear that's in stock now or arriving at least 4 weeks before this date — time for decoration and delivery" />
            {needCutoff && (
              <span style={{ fontSize: 11.5, color: '#6A7180' }}>
                = in stock now or inbound by <b style={{ color: '#3A4150' }}>{fmtDate(needCutoff)}</b>
              </span>
            )}
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
              {visible.slice(0, shown).map(({ st, matchCws, popColor }) => (
                <StyleCard key={st.key} st={st} matchCws={matchCws} colorSel={colorSel} popColor={popColor} onOpen={() => setOpenStyle(st.key)} yourPriceFn={yourPriceFn}
                  canFav={!!coach} isFav={favKeys.has(st.key)} onToggleFav={() => toggleFavorite(st)} />
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

      {(openData || openFallback) && (() => {
        const openSt = openData ? openData.st : openFallback;
        const openSkus = new Set(openSt.colorways.map((c) => c.sku));
        return (
          <StyleModal
            st={openSt}
            matchSet={new Set((openData ? openData.matchCws : openFallback.colorways).map((c) => c.sku))}
            onClose={() => setOpenStyle(null)}
            onSetQty={setLineQty}
            qtyInList={qtyInList}
            unitsInList={list.filter((l) => openSkus.has(l.sku)).reduce((a, l) => a + l.qty, 0)}
            onConfirm={() => { setOpenStyle(null); setDrawerOpen(true); }}
            notify={notify}
            yourPriceFn={yourPriceFn}
          />
        );
      })()}

      {/* Show the launcher when there's a working list, or — for signed-in
          coaches — when the team has saved orders to reopen even with an empty cart. */}
      {(list.length > 0 || (coach && savedOrders.length > 0)) && !drawerOpen && (
        <button className="ai-fab" onClick={() => setDrawerOpen(true)}>
          {list.length > 0 ? 'Order list' : 'Saved orders'}
          <span style={{ background: '#fff', color: '#191919', borderRadius: 999, minWidth: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 800, padding: '0 6px' }}>
            {list.length > 0 ? list.reduce((a, l) => a + l.qty, 0) : savedOrders.length}
          </span>
        </button>
      )}

      {drawerOpen && (
        <OrderDrawer
          list={list}
          updateLine={updateLine}
          setSkuDeco={setSkuDeco}
          removeLine={removeLine}
          clearList={clearList}
          onClose={() => setDrawerOpen(false)}
          notify={notify}
          account={coach}
          savedOrders={savedOrders}
          activeOrderId={activeOrderId}
          savedLoading={savedLoading}
          onSaveOrder={saveOrder}
          onLoadOrder={loadOrderIntoCart}
          onRenameOrder={renameOrder}
          onDeleteOrder={deleteOrder}
          onNewOrder={newBlankOrder}
        />
      )}

      {accountOpen && coach && (
        <AccountPanel
          account={coach}
          onClose={() => setAccountOpen(false)}
          savedOrders={savedOrders}
          activeOrderId={activeOrderId}
          savedLoading={savedLoading}
          favorites={favorites}
          favLoading={favLoading}
          onOpenOrder={openSavedOrderFromAccount}
          onRenameOrder={renameOrder}
          onDeleteOrder={deleteOrder}
          onNewOrder={newOrderFromAccount}
          onUnfavorite={unfavorite}
          onOpenStyle={openStyleByKey}
        />
      )}

      {toast && <div key={toast.ts} className="ai-toast">{toast.msg}</div>}

      {!embedded && (
      <footer style={{ background: '#191919', color: '#9AA1AC', fontSize: 12.5, lineHeight: 1.6 }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '22px 20px' }}>
          Availability is pulled from each brand's warehouse feed and updated automatically — quantities are not guaranteed until ordered.
          “Inbound” dates are projected restock delivery dates.
          “In house” stock is on the shelf at National Sports Apparel and ships immediately.
          <span style={{ display: 'block', marginTop: 6, color: '#C3C8D0', fontWeight: 600 }}>
            National Sports Apparel · nationalsportsapparel.com
          </span>
        </div>
      </footer>
      )}
    </div>
  );
}
