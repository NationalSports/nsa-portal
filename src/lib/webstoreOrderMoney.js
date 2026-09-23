// What a webstore order is WORTH, and how that value rolls up per player.
//
// These two one-liners are the canonical answer to "how much did this order
// collect" — the store header's Sales figure, the rep dashboards, and the
// invoice paths all run through them. They live here so the condensed player
// report shares them rather than growing a fourth copy that drifts.
//
// original_total is the immutable amount billed; total can be edited after the
// fact, so the original wins when present. Refunds come off the top, and the
// result never goes negative (an over-refund is a data error, not a credit).
export const originalOrderTotal = (o) => Number(o && (o.original_total != null ? o.original_total : o.total)) || 0;
export const orderNetCollected = (o) => Math.max(0, originalOrderTotal(o) - (Number(o && o.refunded_amt) || 0));

// Fundraising the club is actually owed on an order: its fundraise_amt, less the
// share of any coupon discount that came off the pot. Checkout applies the % to
// subtotal + fundraise together, so a discounted order collected proportionally
// less fundraising, and a 100%-off order collected none. Same rule as
// netlify/functions/_webstoreClose.js (the store-close summary email).
export const netFundraise = (o) => {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const sub = Number(o && o.subtotal) || 0, fund = Number(o && o.fundraise_amt) || 0;
  if (fund <= 0) return 0;
  const base = sub + fund;
  if (base <= 0) return r2(fund);
  const disc = Math.min(Number(o.discount_amt) || 0, base);
  return Math.max(0, r2(fund - disc * (fund / base)));
};

// One row per player for the condensed report: who they are, whose card paid,
// how many items, and what it came to.
//
// The money basis is deliberately the ORDER's net-collected amount, never a sum
// of line prices. unit_price is $0 on 43% of OMG-imported lines and on every
// bundle component (the package price sits on a parent line the report scope
// drops), so a line sum silently under-reports whole stores.
//
// An order is therefore worth its amount ONCE. Orders carry a single player in
// practice, but nothing in the schema enforces it — so when one feeds two
// players its amount shows on both rows, flagged, while the grand total is
// computed from the distinct order set and stays exact.
export function buildCondensedPlayerRows({ lines = [], orderById = {}, netCollected = orderNetCollected } = {}) {
  const players = {};
  lines.forEach((l) => {
    const o = orderById[l.order_id] || {};
    const nm = (l.player_name || '').trim();
    const num = (l.player_number != null ? String(l.player_number) : '').trim();
    // Same keying as the packing slips, so the two PDFs always agree on who counts
    // as a player — including the unassigned-buyer fallback.
    const key = (nm || num) ? (nm.toLowerCase() + '|' + num) : ('buyer:' + (o.buyer_email || o.buyer_name || l.order_id));
    const p = players[key] || (players[key] = {
      label: nm || (o.buyer_name ? o.buyer_name + ' (buyer)' : 'Unassigned'),
      number: num, units: 0, buyers: [], orderIds: [],
    });
    p.units += (Number(l.qty) || 1);
    if (o.buyer_name && !p.buyers.includes(o.buyer_name)) p.buyers.push(o.buyer_name);
    if (l.order_id && !p.orderIds.includes(l.order_id)) p.orderIds.push(l.order_id);
  });

  const rows = Object.values(players).sort((a, b) => a.label.localeCompare(b.label));
  const playersPerOrder = {};
  rows.forEach((p) => p.orderIds.forEach((id) => { playersPerOrder[id] = (playersPerOrder[id] || 0) + 1; }));
  rows.forEach((p) => {
    p.total = p.orderIds.reduce((sum, id) => sum + netCollected(orderById[id] || null), 0);
    p.shared = p.orderIds.some((id) => playersPerOrder[id] > 1);
  });

  return {
    rows,
    totalUnits: rows.reduce((sum, p) => sum + p.units, 0),
    // From the DISTINCT order set — never double counts a shared order.
    grandTotal: Object.keys(playersPerOrder).reduce((sum, id) => sum + netCollected(orderById[id] || null), 0),
    anyShared: rows.some((p) => p.shared),
  };
}
