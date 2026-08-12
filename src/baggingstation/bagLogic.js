// Pure helpers for the Bagging Station (src/baggingstation/BaggingStation.js)
// — no React, no supabase, no window, so they unit-test directly
// (src/__tests__/bagLogic.test.js). Mirrors of server logic are noted: the
// server RPCs in supabase/migrations/20260812030000_bagging_station.sql stay
// authoritative; these only decide what the tablet offers up front.

import { sizeRank } from '../floorstation/floorLogic';

// Stale-claim rule — mirrors bagging_claim_is_free's 15-minute window.
export const CLAIM_STALE_MS = 15 * 60 * 1000;
export const claimIsStale = (claimedAtIso, nowMs) => {
  const t = Date.parse(claimedAtIso || '');
  if (Number.isNaN(t)) return true;
  return (nowMs - t) > CLAIM_STALE_MS;
};

// A short currently "covering" its line: open or terminally resolved
// (backordered/refunded). found/pulled mean the physical item must still be
// tapped in — mirrors bagging_line_satisfied.
const shortCounts = (i) => ['open', 'backordered', 'refunded'].includes(i.short_status || '');

export const lineSatisfied = (i) => {
  if ((i.line_status || '') === 'cancelled') return true;
  const qty = Number(i.qty) || 0;
  const bagged = Number(i.bagged_qty) || 0;
  const short = shortCounts(i) ? (Number(i.short_qty) || 0) : 0;
  return bagged + short >= qty;
};

// A line the packer can't act on yet: OMG per-size receiving holds a line at
// on_order until goods arrive — it's a WAIT, not a short.
export const lineOnOrder = (i) => (i.line_status || '') === 'on_order';

// Unit-level progress for the order screen + confirmation:
// { total, checked, short, waiting, complete } (cancelled lines excluded).
export function orderProgress(items) {
  const list = (items || []).filter((i) => (i.line_status || '') !== 'cancelled');
  let total = 0; let checked = 0; let short = 0; let waiting = 0;
  let complete = list.length > 0;
  for (const i of list) {
    const qty = Number(i.qty) || 0;
    total += qty;
    checked += Math.min(Number(i.bagged_qty) || 0, qty);
    if (shortCounts(i)) short += Number(i.short_qty) || 0;
    if (lineOnOrder(i)) waiting += qty;
    if (!lineSatisfied(i)) complete = false;
  }
  return { total, checked, short, waiting, complete };
}

// Bag-screen line order: bundle parents first (each followed by its children),
// then loose lines; within each block, size order then name. Children carry
// bundle_ref = parent's bundle_ref; parents have is_bundle_parent.
export function sortLinesForBag(items) {
  const list = [...(items || [])];
  const byLine = (a, b) =>
    sizeRank(a.size) - sizeRank(b.size)
    || String(a.name || '').localeCompare(String(b.name || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
  const parents = list.filter((i) => i.is_bundle_parent).sort(byLine);
  const loose = list.filter((i) => !i.is_bundle_parent && !i.bundle_ref).sort(byLine);
  const children = list.filter((i) => !i.is_bundle_parent && i.bundle_ref);
  const out = [];
  for (const p of parents) {
    out.push(p);
    out.push(...children.filter((c) => c.bundle_ref === p.bundle_ref).sort(byLine));
  }
  // children whose parent line is missing (data drift) still render, at the end
  const seen = new Set(out.map((i) => i.id));
  out.push(...loose, ...children.filter((c) => !seen.has(c.id) && !out.includes(c)).sort(byLine));
  return out;
}

// Player identity for the order header + label: first line with a player name,
// else the buyer. Number may live on a different line than the name.
export function playerHeader(order, items) {
  const withName = (items || []).find((i) => (i.player_name || '').trim());
  const withNum = (items || []).find((i) => String(i.player_number || '').trim());
  return {
    name: (withName && withName.player_name.trim()) || (order && order.buyer_name) || 'Order',
    number: (withNum && String(withNum.player_number).trim()) || '',
  };
}

// Short lines for the label warning block + resolve list rows.
export function shortSummary(items) {
  return (items || [])
    .filter((i) => (Number(i.short_qty) || 0) > 0 && shortCounts(i))
    .map((i) => ({
      id: i.id,
      qty: Number(i.short_qty) || 0,
      status: i.short_status,
      text: `${i.short_qty}× ${i.name || i.sku || 'item'}${i.size ? ' ' + i.size : ''}`,
    }));
}

// Staging table for the batch start page: what should be on the table before
// bagging starts, per product × size, with live bagged/remaining counts.
// Rows keyed by sku+name+color; sizes collected across the batch and sorted in
// wear order. Cancelled lines are excluded; bundle parents are skipped (their
// children are the physical items).
export function batchItemTotals(orders) {
  const rows = new Map(); // key -> { sku, name, color, sizes: Map(size -> {total, bagged, short}) }
  const sizeSet = new Set();
  let total = 0;
  for (const o of (orders || [])) {
    for (const i of (o.webstore_order_items || o.items || [])) {
      if ((i.line_status || '') === 'cancelled' || i.is_bundle_parent) continue;
      const qty = Number(i.qty) || 0;
      if (!qty) continue;
      const key = `${i.sku || ''}|${i.name || ''}|${i.color || ''}`;
      if (!rows.has(key)) rows.set(key, { sku: i.sku || '', name: i.name || i.sku || 'Item', color: i.color || '', sizes: new Map() });
      const size = i.size || '—';
      sizeSet.add(size);
      const cell = rows.get(key).sizes.get(size) || { total: 0, bagged: 0, short: 0 };
      cell.total += qty;
      cell.bagged += Math.min(Number(i.bagged_qty) || 0, qty);
      if (['open', 'backordered', 'refunded'].includes(i.short_status || '')) cell.short += Number(i.short_qty) || 0;
      rows.get(key).sizes.set(size, cell);
      total += qty;
    }
  }
  // grand totals from the per-cell accumulations
  let baggedAll = 0; let shortAll = 0;
  for (const r of rows.values()) for (const c of r.sizes.values()) { baggedAll += c.bagged; shortAll += c.short; }
  const sizes = [...sizeSet].sort((a, b) => sizeRank(a) - sizeRank(b) || String(a).localeCompare(String(b)));
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.color.localeCompare(b.color));
  return { sizes, rows: list, totals: { total, bagged: baggedAll, short: shortAll, remaining: total - baggedAll - shortAll } };
}

// Board sort modes. 'size' groups same-size orders together so the packer
// works one stack of the staging table at a time (an order's size = the most
// common size among its live lines); 'name' is player alphabetical for
// find-a-specific-bag; 'oldest' matches the server's next-order pick.
export const ORDER_SORTS = [
  { key: 'oldest', label: 'Oldest first' },
  { key: 'size', label: 'By size' },
  { key: 'name', label: 'By player' },
];

export function dominantSize(items) {
  const counts = new Map();
  for (const i of (items || [])) {
    if ((i.line_status || '') === 'cancelled' || i.is_bundle_parent || !i.size) continue;
    counts.set(i.size, (counts.get(i.size) || 0) + (Number(i.qty) || 0));
  }
  let best = null; let n = -1;
  for (const [sz, c] of counts) if (c > n || (c === n && sizeRank(sz) < sizeRank(best))) { best = sz; n = c; }
  return best;
}

export function sortOrders(orders, mode) {
  const list = [...(orders || [])];
  const items = (o) => o.webstore_order_items || o.items || [];
  const name = (o) => (playerHeader(o, items(o)).name || '').toLowerCase();
  if (mode === 'size') {
    return list.sort((a, b) =>
      sizeRank(dominantSize(items(a))) - sizeRank(dominantSize(items(b)))
      || name(a).localeCompare(name(b)));
  }
  if (mode === 'name') return list.sort((a, b) => name(a).localeCompare(name(b)));
  return list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

// Client-side fallback "next order" pick (server bagging_next_order is the
// real one): unbagged, unclaimed-or-stale, oldest first.
export function nextOrderPick(orders, actor, nowMs) {
  return (orders || [])
    .filter((o) => !o.bagged_at)
    .filter((o) => !o.bagging_claimed_by
      || o.bagging_claimed_by === actor
      || claimIsStale(o.bagging_claimed_at, nowMs))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null;
}
