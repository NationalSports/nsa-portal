// Guards for vendor API order submission (S&S, Momentec, SanMar).
//
// Why this exists — batch NSA 4632 (SO-2277 Olu Baseball, 2026-09-01):
// the queued batch entry held every line TWICE, so the S&S payload carried each item
// number twice. S&S ADDS lines that share an item number, so 55 units were ordered as
// 110 and invoiced as such; 53 units (~$1,363) had to go back on an RA. Nothing in the
// portal flagged it, because the payload builders map portal lines 1:1 to vendor lines
// and never look at what the vendor did with them.
//
// Two pure helpers, shared by all three vendor modals so the rule can't drift:
//
//   collapseVendorLines  — one payload line per vendor item number (qty summed), plus a
//                          report of what merged, so the modal can make the rep confirm
//                          the MERGED totals rather than the line list they skimmed.
//   reconcileVendorLines — after the vendor accepts, compare what came back against what
//                          we sent. A line the vendor silently dropped must never be
//                          recorded as ordered.
//
// Deliberately NOT a hard block on duplicates: two sales orders in one batch legitimately
// want the same style/color/size, and merging them is the point of batching. What was
// missing is that the rep could not see the merge happen.

const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const qtyOf = (l) => Math.max(0, Number(l?.quantity ?? l?.qty) || 0);

// Human label for one order line, e.g. "AT203 Team Power Red/ White L".
export const vendorLineLabel = (l) =>
  [l?.style || l?.sku, l?.color, l?.size].filter(Boolean).join(' ') || '(unlabelled line)';

/**
 * Collapse order lines that share a vendor item number into one payload line.
 *
 * @param lines  portal order lines (already SKU-resolved)
 * @param keyOf  line -> the vendor's item number (S&S sku / Momentec sku / SanMar partId)
 * @returns {{ merged, duplicates, sentUnits, mergedUnits }}
 *   merged      one entry per distinct vendor key, in first-seen order, `quantity` summed
 *               and `parts` listing every portal line that folded into it.
 *   duplicates  the subset of `merged` with more than one part — what the rep must confirm.
 *   sentUnits / mergedUnits  always equal (collapsing never changes the total); exposed so
 *               a caller can assert that in a test rather than trusting the comment.
 *
 * A line with no vendor key (or no quantity) is left out of `merged` — a blank identifier is
 * not a line any vendor can fill. Every modal already blocks submit while any line is missing
 * its key, so this drops nothing that could otherwise have been ordered.
 */
export function collapseVendorLines(lines, keyOf) {
  const byKey = new Map();
  (lines || []).forEach((l) => {
    const key = String(keyOf ? keyOf(l) : (l?.sku || '')).trim();
    const qty = qtyOf(l);
    if (!key || qty <= 0) return;
    const part = { label: vendorLineLabel(l), quantity: qty, sourceSO: l?.sourceSO || '', sourcePO: l?.sourcePO || '' };
    const hit = byKey.get(key);
    if (hit) { hit.quantity += qty; hit.parts.push(part); }
    else byKey.set(key, { ...l, key, quantity: qty, parts: [part] });
  });
  const merged = [...byKey.values()];
  const sentUnits = (lines || []).reduce((s, l) => s + qtyOf(l), 0);
  return {
    merged,
    duplicates: merged.filter((m) => m.parts.length > 1),
    sentUnits,
    mergedUnits: merged.reduce((s, m) => s + m.quantity, 0),
  };
}

// Pull the line list out of a vendor's order-acknowledgement, whatever shape it arrived in.
// Returns null (not []) when the response carries no line detail at all — "the vendor told
// us nothing" and "the vendor told us zero lines" must not read the same.
const responseLines = (raw) => {
  const pick = (o) => {
    if (!o || typeof o !== 'object') return null;
    for (const k of ['lines', 'Lines', 'OrderLines', 'orderLines', 'items', 'Items']) {
      if (Array.isArray(o[k])) return o[k];
    }
    return null;
  };
  const direct = pick(raw);
  if (direct) return direct;
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.Orders) ? raw.Orders : (Array.isArray(raw?.orders) ? raw.orders : null));
  if (arr) {
    let found = null;
    arr.forEach((o) => { const l = pick(o); if (l) found = (found || []).concat(l); });
    return found;
  }
  return null;
};

const RESP_KEY_FIELDS = ['identifier', 'Identifier', 'sku', 'Sku', 'partId', 'PartId', 'gtin', 'Gtin', 'yourSku', 'YourSku'];
const RESP_QTY_FIELDS = ['qty', 'Qty', 'qtyOrdered', 'QtyOrdered', 'quantity', 'Quantity'];

/**
 * Compare a vendor's order acknowledgement against the lines we submitted.
 *
 * The S&S payload sets `rejectLineErrors: false` — "place what you can, drop the rest" —
 * so a line the vendor won't fill comes back as a missing line, not an error. Without this
 * the portal stamps `api_order_id` on it and the SO reads as ordered forever (NSA 4632's
 * AT203 Team Power Red, 6 units).
 *
 * @param sentLines  the collapsed payload lines (from collapseVendorLines().merged)
 * @param result     the vendor modal's submit result: { lineErrors?, raw? }
 * @param keyOf      line -> vendor item number, same function used to collapse
 * @returns {{ verified, lineErrors, missing, short, checkedAgainst }}
 *   verified       true only when the vendor returned line detail AND it covers every line
 *   checkedAgainst 'lines' when the response carried line detail, 'errors-only' otherwise
 *   missing        submitted lines absent from the acknowledgement
 *   short          lines acknowledged at a LOWER quantity than we sent
 */
export function reconcileVendorLines(sentLines, result, keyOf) {
  const lineErrors = (result?.lineErrors || []).map((e) =>
    (e && (e.error || e.Error || e.message || e.Message)) || (typeof e === 'string' ? e : JSON.stringify(e))
  ).filter(Boolean);

  const rows = responseLines(result?.raw);
  if (!rows) {
    // No line detail came back. Report only what the vendor explicitly told us, and say
    // plainly that the rest is unverified — never imply a silent drop we did not observe.
    return { verified: false, lineErrors, missing: [], short: [], checkedAgainst: 'errors-only' };
  }

  const ackByKey = new Map();
  rows.forEach((r) => {
    let key = '';
    for (const f of RESP_KEY_FIELDS) { if (r && r[f] != null && String(r[f]).trim()) { key = norm(r[f]); break; } }
    if (!key) return;
    let qty = 0;
    for (const f of RESP_QTY_FIELDS) { if (r && r[f] != null) { qty = Number(r[f]) || 0; break; } }
    ackByKey.set(key, (ackByKey.get(key) || 0) + Math.max(0, qty));
  });

  const missing = [], short = [];
  (sentLines || []).forEach((l) => {
    const key = norm(keyOf ? keyOf(l) : l?.sku);
    const want = qtyOf(l);
    if (!key || want <= 0) return;
    const got = ackByKey.has(key) ? ackByKey.get(key) : null;
    const row = { key, label: vendorLineLabel(l), sent: want, accepted: got || 0, sourceSO: l?.sourceSO || '' };
    if (got == null || got <= 0) missing.push(row);
    else if (got < want) short.push(row);
  });

  return {
    verified: missing.length === 0 && short.length === 0 && lineErrors.length === 0,
    lineErrors, missing, short, checkedAgainst: 'lines',
  };
}
