import { useCallback, useEffect, useState } from 'react';

// Client-side Team Shop cart — localStorage only, one cart per signed-in
// customer (team) so switching teams (TeamPicker) switches carts, same
// isolation idea as TeamPicker's STORAGE_KEY but keyed per customer id.
//
// This module NEVER stores a price. netlify/functions/quickorder-quote.js is
// the single source of truth for unit_sell/line_total — CartPage fetches a
// live quote for whatever is in the cart. A line only carries what's needed
// to re-request that quote and render a thumbnail/name/size/qty/decoration
// summary:
//   { id, product_id, product_name, image_url, sku, size, qty, color,
//     decorations: [spec] }
// decorations: [] means "blank / no decoration" — the retail-mixing case
// quickorder-quote.js already prices (garment-only line).

const PREFIX = 'nts_cart_v1';
const EVENT = 'nts-cart-changed';

const keyFor = (customerId) => `${PREFIX}:${String(customerId || '')}`;

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for environments without crypto.randomUUID (shouldn't happen in
  // supported browsers/jsdom, but never let cart writes throw).
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readRaw(customerId) {
  try {
    const raw = window.localStorage.getItem(keyFor(customerId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(customerId, lines) {
  try {
    window.localStorage.setItem(keyFor(customerId), JSON.stringify(lines));
  } catch {
    /* storage unavailable (private mode / quota) — cart just won't persist */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
  } catch {
    /* CustomEvent unavailable in some non-DOM test environments — no-op */
  }
}

// Whitelist only — no price field (unit_sell, line_total, sell_override, ...)
// is ever accepted here, so nothing computed client-side can leak into the
// persisted cart. Unknown/extra input keys are silently dropped.
function sanitizeLine(line, existingId) {
  const l = line || {};
  return {
    id: existingId || l.id || newId(),
    product_id: l.product_id != null ? l.product_id : null,
    product_name: l.product_name || '',
    image_url: l.image_url || '',
    sku: l.sku != null ? l.sku : null,
    size: l.size != null && String(l.size).trim() ? String(l.size).trim() : null,
    qty: Math.max(1, parseInt(l.qty, 10) || 1),
    color: l.color != null ? l.color : null,
    decorations: Array.isArray(l.decorations) ? l.decorations : [],
  };
}

export function getLines(customerId) {
  return readRaw(customerId);
}

export function addLine(customerId, line) {
  const lines = readRaw(customerId);
  const next = sanitizeLine(line);
  lines.push(next);
  writeRaw(customerId, lines);
  return next;
}

export function updateQty(customerId, id, qty) {
  const lines = readRaw(customerId).map((l) => (l.id === id ? { ...l, qty: Math.max(1, parseInt(qty, 10) || 1) } : l));
  writeRaw(customerId, lines);
  return lines;
}

export function setSize(customerId, id, size) {
  const lines = readRaw(customerId).map((l) => (l.id === id ? { ...l, size: size != null && String(size).trim() ? String(size).trim() : null } : l));
  writeRaw(customerId, lines);
  return lines;
}

export function removeLine(customerId, id) {
  const lines = readRaw(customerId).filter((l) => l.id !== id);
  writeRaw(customerId, lines);
  return lines;
}

export function clear(customerId) {
  writeRaw(customerId, []);
  return [];
}

// React hook: live cart lines for one customer, re-rendering whenever this
// tab mutates the cart (addLine/updateQty/setSize/removeLine/clear, via the
// nts-cart-changed CustomEvent) or another tab does (the native `storage`
// event, e.g. two coach tabs open on the same team).
export function useCart(customerId) {
  const [lines, setLines] = useState(() => (customerId ? getLines(customerId) : []));

  useEffect(() => {
    setLines(customerId ? getLines(customerId) : []);
    if (!customerId) return undefined;
    const refresh = (e) => {
      if (e && e.detail && e.detail.customerId != null && e.detail.customerId !== customerId) return;
      setLines(getLines(customerId));
    };
    const onStorage = (e) => {
      if (e.key && e.key !== keyFor(customerId)) return;
      setLines(getLines(customerId));
    };
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [customerId]);

  return {
    lines,
    addLine: useCallback((line) => addLine(customerId, line), [customerId]),
    updateQty: useCallback((id, qty) => updateQty(customerId, id, qty), [customerId]),
    setSize: useCallback((id, size) => setSize(customerId, id, size), [customerId]),
    removeLine: useCallback((id) => removeLine(customerId, id), [customerId]),
    clear: useCallback(() => clear(customerId), [customerId]),
  };
}
