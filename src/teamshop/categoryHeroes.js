// Home category-tile hero products — one real, owner-approved product photo
// per launch category (categories.js), fetched once and cached so the Home
// category grid ("Everything the roster needs") can show real garment
// photography instead of flat gradient tiles.
//
// SKU picks are owner-approved (verified live rows with images, shot on a
// uniform light #EBEDEE studio background — see the task that added this
// file) — one per LAUNCH_CATEGORIES key.
//
// Fetch approach: a single `products` table SELECT filtered by
// `.in('sku', [...])`, using the same anonymous supabaseCoach client Catalog.js
// uses for search_products. This is anon-permitted: `products` carries the
// `products_select` RLS policy from supabase/migrations/00002_rls_policies.sql
// (`for select using (true)`, no role restriction), and none of the later RLS
// lockdown passes (00173–00179) touch the `products` table — it's not in any
// of their revoke lists. So a direct anon `select` works exactly like the
// anon `search_products` RPC Catalog.js already relies on, and is simpler
// than a per-sku RPC fallback (kept below as a documented option, unused,
// in case anon table access is ever locked down and this needs to switch).
import { supabaseCoach } from '../lib/supabaseCoach';
import { LAUNCH_CATEGORIES } from './categories';

export const CATEGORY_HERO_SKUS = {
  quarter_zips: 'KB9108', // Royal 3-Stripe LS 1/4 Zip
  hoodies: 'IW5145', // D4T Lightweight Hoodie, red/white
  polos: 'HS1301', // Classic Polo
  outerwear: 'HF6160', // Icon Cage Jacket
  hats: 'KW4982', // A-Frame Cap
  tees: 'JL3344', // 25 TEAM Pregame Tee, white
  bags: '5156595', // Adaptive Backpack
  shorts: 'GM2365', // 3 Stripe Knit Short
  footwear: 'HQ2467', // Adidilette Comfort Slides
};

const CACHE_KEY = 'nts_cat_heroes';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function readCache() {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.rows;
  } catch { return null; }
}

function writeCache(rows) {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
  } catch { /* best-effort — sessionStorage may be unavailable/full */ }
}

// Fetch the hero product row for every category in CATEGORY_HERO_SKUS, in one
// round trip. Returns [] on any error (Home falls back to gradient tiles) —
// never throws. Cached in sessionStorage for CACHE_TTL_MS so repeat visits in
// the same tab don't refetch.
export async function fetchCategoryHeroes() {
  const cached = readCache();
  if (cached) return cached;

  try {
    const skus = Object.values(CATEGORY_HERO_SKUS);
    const { data, error } = await supabaseCoach
      .from('products')
      .select('id,sku,name,brand,image_front_url,category')
      .in('sku', skus);

    if (error || !data) return [];
    writeCache(data);
    return data;
  } catch {
    // Defensive: a test double / older client build without `.from(...)`,
    // a network failure, etc. — Home always has the gradient-tile fallback.
    return [];
  }
}

// Pure match: given fetched hero rows and a LAUNCH_CATEGORIES entry, find the
// row whose sku is that category's designated hero sku. Returns null if no
// matching row was fetched (e.g. the sku's row was archived/deleted) or the
// row has no usable image — Home treats either as "no hero", falling back to
// the gradient tile.
export function pickHeroForCategory(rows, categoryDef) {
  if (!Array.isArray(rows) || !categoryDef) return null;
  const sku = CATEGORY_HERO_SKUS[categoryDef.key];
  if (!sku) return null;
  const row = rows.find((r) => r && r.sku === sku);
  if (!row || !row.image_front_url) return null;
  return row;
}

// Exported for tests / sanity checks — every launch category must have a
// hero sku assigned.
export function heroSkusCoverAllCategories() {
  return LAUNCH_CATEGORIES.every((c) => !!CATEGORY_HERO_SKUS[c.key]);
}
