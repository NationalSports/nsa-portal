// src/lib/sizeScales.js
// ─────────────────────────────────────────────────────────
// The size scales the roster/kit surfaces order by. Extracted from
// RosterOrders.js so ClubStockPanel can share them rather than keep a second
// copy in step by hand — this repo's dominant regression source is duplicated
// logic drifting (see FABLE_SYSTEM_AUDIT_2026-07-03.md).
//
// Distinct from `SIZE_RANK_ORDER` in ./storeInventory.js, which ranks the
// storefront's own catalogue scale (tall sizes, footwear numbers) and has no
// youth prefixes. Keep them separate; they answer different questions.
// ─────────────────────────────────────────────────────────

export const SZ_YOUTH = ['YXS', 'YS', 'YM', 'YL', 'YXL'];
export const SZ_ADULT = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'OSFA'];
export const SZ_STANDARD = [...SZ_YOUTH, ...SZ_ADULT];
export const SZ_SOCKS = ['3XS', '2XS', 'XS', 'Youth Sleeves', 'Small', 'Medium', 'Large'];

export const SZ_ABBREV = { 'Youth Sleeves': 'YSlv', 'Small': 'Sm', 'Medium': 'Med', 'Large': 'Lg', 'OSFA': 'OS' };

// One-size items are carried on the adult list so the kit grid can column them,
// but a stock sheet reads better with them pulled out — they have no scale.
export const ONE_SIZE = ['OSFA', 'OS', 'NS'];

const up = (s) => String(s == null ? '' : s).trim().toUpperCase();

/**
 * Which grid a product belongs on, from the sizes it actually carries.
 *   'one'   — only one-size labels (backpack, sleeve sock)
 *   'youth' — any Y-prefixed size
 *   'adult' — everything else
 * Youth wins over adult when both appear: a product mixing scales is a data
 * problem, and showing it on the youth grid makes that visible rather than
 * silently dropping the youth columns.
 */
export const scaleOfSizes = (sizes) => {
  const list = (Array.isArray(sizes) ? sizes : []).map(up).filter(Boolean);
  if (!list.length) return 'adult';
  if (list.every((s) => ONE_SIZE.includes(s))) return 'one';
  if (list.some((s) => SZ_YOUTH.includes(s))) return 'youth';
  return 'adult';
};

/** Column order for a grid, keeping only the sizes actually in use. */
export const columnsFor = (scale, sizesInUse) => {
  const used = new Set((sizesInUse || []).map(up));
  const master = scale === 'youth'
    ? SZ_YOUTH
    : [...SZ_ADULT.filter((s) => !ONE_SIZE.includes(s)), ...SZ_SOCKS.filter((s) => !SZ_ADULT.includes(s))];
  const known = master.filter((s) => used.has(up(s)));
  // Anything the master list doesn't know about still deserves a column rather
  // than vanishing — sorted last so the familiar scale keeps its shape.
  const extra = [...used].filter((s) => !master.some((m) => up(m) === s) && !ONE_SIZE.includes(s)).sort();
  return [...known, ...extra];
};
