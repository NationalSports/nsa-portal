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

// Deco gate — mirrors server bagging_order_ready: an order still has lines in
// production (before the job rollups advance them to 'bagging') and must not
// be bagged yet. Backorder child orders are exempt (lines sit at 'pending' by
// design; their goods come from receiving, not production).
export const orderInDeco = (order, items) => {
  if (order && order.backorder_of) return false;
  return (items || []).some((i) => !i.is_bundle_parent
    && ['pending', 'received', 'in_production'].includes(i.line_status || 'pending'));
};

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

// ── What the packer actually reads on a line ─────────────────────────────────
// Store lines carry the storefront's mashed-together sku ("PC55-JetBlack") and,
// on OMG imports, no name at all — so the screen and the label could only say
// "PC55-JetBlack", which tells the packer nothing about WHICH garment it is.
// These split a line back into the three things she needs to match it to a pile
// on the table: the style number, the garment's real name, and the color.
// (The catalog name is backfilled server-side — netlify/functions/bagging-api.js.)

const canon = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s) => String(s == null ? '' : s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// "PC55-JetBlack" + color "Jet Black" -> "PC55". Only strips a trailing run of
// sku tokens that canonically EQUALS the color, so a style number that merely
// looks suffixed ("JST488", "229162.080") is returned untouched — a wrong style
// number on a bag label is worse than a noisy one.
export function styleNumber(sku, color) {
  const raw = String(sku == null ? '' : sku).trim();
  const c = canon(color);
  if (!raw || !c) return raw;
  const parts = raw.split(/([-_. ])/); // separators land on the odd indices
  for (let start = 2; start < parts.length; start += 2) {
    // "112 -5 BLACK/WHITE/RED" leaves "112 -5" behind — the style is its first word.
    if (canon(parts.slice(start).join('')) === c) return parts.slice(0, start - 1).join('').trim().split(/\s+/)[0];
  }
  // Free-text skus the storefront never normalised ("18500 BLACK",
  // "1379806 (BLACK 001) - 5"): the style is the first word and the rest is the
  // colorway spelled some other way — a substring either way, or the same words
  // in another order. Anything less certain returns the sku whole.
  const head = raw.split(/\s+/)[0];
  if (head && head !== raw) {
    const tail = raw.slice(head.length);
    const rest = canon(tail);
    const restWords = new Set(words(tail));
    const colorWords = words(color);
    if (rest && (rest.includes(c) || c.includes(rest)
      || (colorWords.length > 0 && colorWords.every((w) => restWords.has(w))))) return head;
  }
  return raw;
}

// The garment's own name, with the noise vendor feeds leave behind stripped:
// a doubled brand prefix ("Port & Co Port & Co Core Blend Tee"), the style
// number repeated at the end ("... Pro Tee. ST420 ST420"), and a trailing
// "- <color>". Never returns empty when a name was given — falling back to the
// raw name beats showing nothing.
export function garmentName(name, sku, color) {
  const original = String(name == null ? '' : name).trim();
  if (!original) return '';
  let s = original;

  // "X X rest" -> "X rest" (longest repeated prefix wins)
  const w = s.split(/\s+/);
  for (let k = Math.floor(w.length / 2); k >= 1; k--) {
    if (w.slice(0, k).join(' ').toLowerCase() === w.slice(k, 2 * k).join(' ').toLowerCase()) {
      s = w.slice(k).join(' ');
      break;
    }
  }

  // trailing style number(s), with whatever "." or "-" the feed left attached
  const seen = new Set();
  for (const tok of [String(sku == null ? '' : sku).trim(), styleNumber(sku, color)]) {
    if (!tok || seen.has(tok)) continue;
    seen.add(tok);
    const lit = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('(?:[\\s.,-]*\\b' + lit + '\\b)+[\\s.,-]*$', 'i'), '').trim();
  }

  // trailing "- <color>" ("Gildan Softstyle® T-Shirt - Black"). The catalog name
  // often carries a SHORTER spelling than the line does ("- Black" against a
  // line color of "Black (001)"), so a color that contains the trailing token
  // counts — but never the other way round, which would strip real words.
  if (color) {
    const m = s.match(/^(.*?)\s*[-–—]\s*([^-–—]+)$/);
    const tok = m ? canon(m[2]) : '';
    if (tok.length >= 3 && (tok === canon(color) || canon(color).includes(tok))) s = m[1].trim();
  }

  s = s.replace(/[\s.,-]+$/, '').trim();
  return s || original;
}

// A style number a packer can read back off a bag: no whitespace, catalog length.
const CLEAN_STYLE = /^[A-Za-z0-9][A-Za-z0-9./-]{0,19}$/;

// One line's identity for the screen, the label and the staging sheet:
// { style: 'PC55', garment: 'Port & Co Core Blend Tee', color: 'Jet Black' },
// plus the two lines they all print: `head` (big) and `desc` (under it).
// `text` is the flat one-line form for places that can't lay out two.
export function itemDisplay(item) {
  const i = item || {};
  const sku = String(i.sku == null ? '' : i.sku).trim();
  const color = String(i.color == null ? '' : i.color).trim();
  const style = styleNumber(sku, color);
  let garment = garmentName(i.name, sku, color);
  // "PC55 · PC55" helps nobody — drop the name when it IS the style number.
  if (garment && canon(garment) === canon(style)) garment = '';
  // `head` is the big line, `desc` the one under it. The style number leads when
  // it IS one; a sku the storefront left as free text ("1382622 (GREY 011) - 5")
  // reads worse than the garment's own name, so the name leads instead.
  const head = (CLEAN_STYLE.test(style) ? style : '') || garment || sku || 'Item';
  const desc = [garment === head ? '' : garment, color].filter(Boolean).join(' · ');
  return { style, garment, color, head, desc, text: [head, desc].filter(Boolean).join(' · ') };
}

// Short lines for the label warning block + resolve list rows.
export function shortSummary(items) {
  return (items || [])
    .filter((i) => (Number(i.short_qty) || 0) > 0 && shortCounts(i))
    .map((i) => ({
      id: i.id,
      qty: Number(i.short_qty) || 0,
      status: i.short_status,
      text: `${i.short_qty}× ${itemDisplay(i).text}${i.size ? ' ' + i.size : ''}`,
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
      if (!rows.has(key)) {
        const d = itemDisplay(i);
        rows.set(key, { sku: i.sku || '', name: i.name || i.sku || 'Item', color: i.color || '', head: d.head, desc: d.desc, sizes: new Map() });
      }
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
