// 4×6 bag-label HTML for the Bagging Station. Pure string builder (no DOM) so
// it unit-tests directly (src/__tests__/bagLabel.test.js); BaggingStation.js
// prints it through a window.open + print() flow like Webstores' printHtml.
// The QR deep-links back to the station (?scan=WO-<order id>) so any tablet
// can reopen the bag — same api.qrserver.com pattern as utils.js's QR labels.

import { sortLinesForBag, shortSummary, playerHeader, itemDisplay } from './bagLogic';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LABEL_CSS = `
@page { size: 4in 6in; margin: 0; }
* { box-sizing: border-box; }
html, body { width: 4in; height: 6in; margin: 0; overflow: hidden; }
body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; }
/* Break BETWEEN pages, never after the last one — a break forced after every
   .page emitted a trailing blank sheet the packer had to de-select in the
   print dialog on every single label. */
.page { width: 4in; height: 6in; padding: 0.18in; display: flex; flex-direction: column; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
.page + .page { break-before: page; page-break-before: always; }
.name { font-size: 24pt; font-weight: 800; line-height: 1.05; text-transform: uppercase; }
.store { font-size: 11pt; font-weight: 700; margin-top: 4pt; }
.ord { font-size: 9.5pt; font-weight: 700; color: #333; margin-top: 2pt; }
.bagseq { font-size: 10pt; font-weight: 700; color: #333; margin-top: 2pt; }
.bo { display: inline-block; border: 2pt solid #000; padding: 2pt 6pt; font-size: 12pt; font-weight: 800; margin-top: 4pt; }
hr { border: none; border-top: 1.5pt solid #000; margin: 6pt 0; }
.item { font-size: 10.5pt; line-height: 1.35; }
.item .sz { font-weight: 800; border: 1pt solid #000; padding: 0 3pt; margin-left: 3pt; }
.item .pnum { font-weight: 800; border: 1.5pt solid #000; padding: 0 3pt; margin-left: 3pt; background: #000; color: #fff; }
.item + .item { margin-top: 3pt; }
/* What the garment actually IS — style number is the cross-check, this line is
   what the packer matches to the pile on the table. */
.item .desc { font-size: 8.5pt; font-weight: 600; color: #222; line-height: 1.2; }
.item.short { font-weight: 800; }
/* Long orders: shrink so every item still fits on the 4x6 */
.items.compact .item { font-size: 8.5pt; line-height: 1.25; }
.items.compact .item + .item { margin-top: 2pt; }
.items.compact .item .desc { font-size: 7.5pt; }
.items.compact .item .sz, .items.compact .item .pnum { padding: 0 2pt; }
.shorts { border: 2pt solid #000; padding: 4pt 6pt; margin-top: 6pt; font-size: 10pt; font-weight: 800; }
.foot { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 8pt; }
.foot img { width: 0.95in; height: 0.95in; }
.brand { font-size: 9pt; font-weight: 800; letter-spacing: 1pt; text-align: right; }
`;

export const bagScanCode = (orderId) => `WO-${orderId}`;
export const bagScanUrl = (origin, orderId) =>
  `${origin || ''}/bagging-station?scan=${encodeURIComponent(bagScanCode(orderId))}`;

const qrImgSrc = (data) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(data)}`;

// order: webstore_orders row; items: its webstore_order_items; store: {name};
// seqTotal: live count for "Bag N of M"; origin: window origin for the QR.
export function buildBagLabelHtml({ order, items, store, seqTotal, origin }) {
  const hdr = playerHeader(order, items);
  const isBackorder = !!(order && order.backorder_of);
  const shorts = shortSummary(items).filter((s) => s.status === 'open' || s.status === 'backordered');
  const liveLines = sortLinesForBag(items).filter((i) => (i.line_status || '') !== 'cancelled');
  const lines = liveLines
    .map((i) => {
      const short = (Number(i.short_qty) || 0) > 0 && ['open', 'backordered'].includes(i.short_status || '');
      // Style number + size + number up top (the pick), the garment's name and
      // color underneath (the identification) — the raw "PC55-JetBlack" sku on
      // its own never told the packer what she was holding.
      const d = itemDisplay(i);
      return `<div class="item${short ? ' short' : ''}">${i.bundle_ref && !i.is_bundle_parent ? '&nbsp;&nbsp;' : ''}`
        + `${Number(i.qty) || 0}× ${esc(d.head)}`
        + (i.size ? `<span class="sz">${esc(i.size)}</span>` : '')
        // jerseys: the number to verify is on THIS line (players differ per line)
        + (String(i.player_number || '').trim() ? `<span class="pnum">#${esc(String(i.player_number).trim())}</span>` : '')
        + (short ? ' ⚠ SHORT' : '')
        + (d.desc ? `<div class="desc">${esc(d.desc)}</div>` : '')
        + '</div>';
    }).join('');

  const seq = order && order.bag_seq
    ? `Bag ${order.bag_seq}${seqTotal ? ' of ' + seqTotal : ''}` : '';
  const orderNum = order && (order.omg_order_number || order.order_number || String(order.id || '').slice(0, 8));
  const buyerLine = order && order.buyer_name && order.buyer_name !== hdr.name ? ' · ' + esc(order.buyer_name) : '';

  return '<!doctype html><html><head><meta charset="utf-8"/>'
    + `<title>${esc(hdr.name)}${hdr.number ? ' #' + esc(hdr.number) : ''}</title>`
    + `<style>${LABEL_CSS}</style></head><body><div class="page">`
    + `<div class="name">${esc(hdr.name)}</div>`
    + `<div class="store">${esc((store && store.name) || '')}</div>`
    + `<div class="ord">Order #${esc(orderNum)}${buyerLine}</div>`
    + (seq ? `<div class="bagseq">${esc(seq)}</div>` : '')
    + (isBackorder ? '<div class="bo">BACKORDER — completes an earlier bag</div>' : '')
    + '<hr/>'
    + `<div class="items${liveLines.length > 6 ? ' compact' : ''}">${lines}</div>`
    + (shorts.length
      ? `<div class="shorts">⚠ PROBLEM SHELF — short, resolve before shipping:<br/>${shorts.map((s) => esc(s.text)).join('<br/>')}</div>`
      : '')
    + '<div class="foot">'
    + `<img src="${esc(qrImgSrc(bagScanUrl(origin, order.id)))}" alt="${esc(bagScanCode(order.id))}"/>`
    + '<div class="brand">NSA CONNECT<br/>BAGGING</div>'
    + '</div>'
    + '</div></body></html>';
}
