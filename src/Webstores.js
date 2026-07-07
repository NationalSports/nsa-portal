/* eslint-disable */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { cloudUpload, sendBrevoEmail, authFetch, invokeEdgeFn, printPdfLabels, estimateWeightOz, labelWeightLbs, validateShipAddress, computeOrderTracking, _cloudinaryPdfThumb } from './utils';
import { shipStationCall, sanmarResolveSku, ssResolveSku, richardsonResolveSku, momentecResolveSku, resolveSkuAcrossVendors } from './vendorApis';
import { searchVendorCatalogs, vendorColorToProductRow } from './vendorCatalogSearch';
import { NSA, pantoneHex, SZ_NORM } from './constants';
import { CatalogKitStyles, KitScope, DISPLAY, BODY, FilterBtn, ShowMore } from './ui/catalogKit';
import { fetchStockMap, foldScale, foldedQty, foldedSoon, sizeRank } from './lib/storeInventory';
import { ART_PLACEMENTS, placementById } from './lib/artPlacements';
import { normalizeWebLogos, pickCwAsset } from './businessLogic';
import { normSzName } from './pricing';
import { autoColorChoice, resolveItemPlacement, garmentTypeOf, garmentHex } from './lib/artGrid';
import QuickMockBuilder from './QuickMockBuilder';

const SS_CARRIERS = { fedex: { carrierCode: 'fedex', serviceCode: 'fedex_ground' }, ups: { carrierCode: 'ups', serviceCode: 'ups_ground' }, usps: { carrierCode: 'stamps_com', serviceCode: 'usps_priority_mail' } };

// Create a ShipStation label (base64 PDF) for one ship-to-home webstore order.
async function createWebstoreLabel(order, items, store, weightByPid = {}, imageByPid = {}) {
  const a = order.ship_address || {};
  const ss = await shipStationCall('/orders/createorder', { method: 'POST', body: JSON.stringify(webstoreToShipStation(order, items, store, imageByPid)) });
  const orderId = ss && ss.orderId;
  if (!orderId) throw new Error('ShipStation order not created');
  if (Number(store.shipstation_tag_id)) { try { await shipStationCall('/orders/addtag', { method: 'POST', body: JSON.stringify({ orderId, tagId: Number(store.shipstation_tag_id) }) }); } catch {} }
  const cm = SS_CARRIERS[(store.shipstation_carrier || 'fedex').toLowerCase()] || SS_CARRIERS.fedex;
  const payload = {
    orderId, carrierCode: cm.carrierCode, serviceCode: store.shipstation_service || cm.serviceCode,
    packageCode: 'package', confirmation: 'none', shipDate: new Date().toISOString().split('T')[0],
    weight: { value: labelWeightLbs(items, store, weightByPid), units: 'pounds' },
    shipFrom: { name: NSA.name, company: NSA.name, street1: NSA.addr, city: NSA.city, state: NSA.state, postalCode: NSA.zip, country: 'US', phone: NSA.phone },
    shipTo: { name: a.name || order.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: order.buyer_phone || '' },
    testLabel: false,
  };
  const res = await shipStationCall('/orders/createlabelfororder', { method: 'POST', body: JSON.stringify(payload) });
  return { labelData: res.labelData, trackingNumber: res.trackingNumber, carrier: cm.carrierCode, shipmentId: res.shipmentId || null, cost: res.shipmentCost != null ? Number(res.shipmentCost) + (Number(res.insuranceCost) || 0) : null };
}

// Printable club fundraising payout statement.
function printPayout(store, t) {
  const date = new Date().toLocaleDateString();
  printHtml(`<!doctype html><html><head><title>Fundraising payout — ${store.name}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e293b;max-width:640px;margin:40px auto;padding:0 24px}
    h1{font-size:20px;margin:0 0 4px}.sub{color:#64748b;font-size:13px;margin-bottom:24px}
    table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:10px 0;border-bottom:1px solid #eef1f5;font-size:14px}
    td.r{text-align:right;font-weight:700}.tot td{border-top:2px solid #1e293b;border-bottom:none;font-size:18px;font-weight:900;padding-top:14px}
  </style></head><body>
    <h1>${NSA.name} — Fundraising Payout</h1>
    <div class="sub">${store.name} webstore · ${t.orders} orders · ${date}</div>
    <table>
      <tr><td>Fundraising collected (paid orders)</td><td class="r">${money(t.fundPaid)}</td></tr>
      ${t.fundPending > 0.005 ? `<tr><td>Pending (unpaid / team-tab orders)</td><td class="r" style="color:#94a3b8">${money(t.fundPending)}</td></tr>` : ''}
      <tr class="tot"><td>Amount owed to club</td><td class="r">${money(t.fundPaid)}</td></tr>
    </table>
  </body></html>`);
}

// Printable accounting statement — the full money flow for a store: what was
// collected (sales, discounts, fundraising, shipping, tax), how it was paid
// (card vs team tab), and the costs booked against it (processing, postage).
function printAccounting(store, a, m) {
  const date = new Date().toLocaleDateString();
  const row = (label, amt, sign, cls) => `<tr class="${cls || ''}"><td>${label}</td><td class="r">${sign === '−' ? '−' : ''}${money(Math.abs(amt))}</td></tr>`;
  printHtml(`<!doctype html><html><head><title>Accounting — ${store ? store.name : 'Webstore'}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e293b;max-width:640px;margin:40px auto;padding:0 24px}
    h1{font-size:20px;margin:0 0 4px}.sub{color:#64748b;font-size:13px;margin-bottom:24px}
    table{width:100%;border-collapse:collapse}td{padding:9px 0;border-bottom:1px solid #eef1f5;font-size:14px}
    td.r{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
    tr.memo td{color:#94a3b8;font-weight:400;border-bottom:none;padding:3px 0 3px 18px;font-size:13px}
    tr.sub-tot td{border-top:2px solid #1e293b;font-weight:900;font-size:16px;padding-top:12px}
    tr.net td{border-top:2px solid #166534;color:#166534;font-weight:900;font-size:18px;padding-top:14px}
    .foot{color:#94a3b8;font-size:11px;margin-top:18px;line-height:1.5}
  </style></head><body>
    <h1>${NSA.name} — Webstore Accounting</h1>
    <div class="sub">${store ? store.name : ''} · ${m.orders} live orders · ${date}</div>
    <table>
      ${row('Product sales (retail before discounts)', a.grossSales, '+')}
      ${row('Coupon discounts', a.discounts, '−')}
      ${a.fundraiseAll > 0.005 ? row('Club fundraising', a.fundraiseAll, '+') : ''}
      ${row('Shipping charged', a.shipCharged, '+')}
      ${a.processing > 0.005 ? row('Processing fees', a.processing, '+') : ''}
      ${row('Sales tax collected', a.taxColl, '+')}
      ${row('Gross collected', a.grossColl, '', 'sub-tot')}
      <tr class="memo"><td>card payments</td><td class="r">${money(m.cardColl)}</td></tr>
      <tr class="memo"><td>team tab (billed on club invoice)</td><td class="r">${money(m.tabColl)}</td></tr>
      ${a.refunds > 0.005 ? row('Refunds issued', a.refunds, '−') + row('Net collected', a.netColl, '', 'sub-tot') : ''}
      ${row('Card processing fees', a.ccFees, '−')}
      ${row('Shipping label cost', a.labelCost, '−')}
      ${row('Net after fees', a.netAfterFees, '', 'net')}
    </table>
    <div class="foot">Sales tax is collected on the state's behalf and remitted to CDTFA — it is not store revenue. Card &amp; label costs apply only to card-paid orders; team-tab balances settle on the club invoice.</div>
  </body></html>`);
}

// Printable warehouse pull sheet: exact design transfers + numbers (grouped by
// size/color) with a count and a check box for each line.
function printPullSheet(store, soLabel, designs, numbers, pulledNote) {
  const row = (label, qty, sub) => `<tr><td class="ck">☐</td><td>${label}${sub ? `<div class="sub">${sub}</div>` : ''}</td><td class="q">${qty}</td></tr>`;
  // Group numbers by "size · color".
  const groups = {};
  (numbers || []).forEach((n) => { const [digit, size, color] = n.code.split('|'); const k = `${size || '?'} · ${color || '?'}`; (groups[k] = groups[k] || []).push({ digit, qty: n.qty }); });
  const designRows = (designs || []).map((d) => row(d.label, d.qty)).join('');
  const numberBlocks = Object.entries(groups).map(([k, digs]) => {
    digs.sort((a, b) => a.digit.localeCompare(b.digit));
    const tot = digs.reduce((a, d) => a + d.qty, 0);
    return `<h3>Numbers — ${k} <span class="tot">${tot} total</span></h3><table>${digs.map((d) => row(`Digit ${d.digit}`, d.qty)).join('')}</table>`;
  }).join('');
  printHtml(`<!doctype html><html><head><title>Pull sheet — ${soLabel}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:640px;margin:32px auto;padding:0 24px}
    h1{font-size:20px;margin:0 0 2px}.meta{color:#64748b;font-size:13px;margin-bottom:18px}
    h3{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin:18px 0 6px;border-bottom:2px solid #0b1220;padding-bottom:4px}
    h3 .tot{float:right;color:#94a3b8;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}
    td{padding:8px 6px;border-bottom:1px solid #eef1f5;font-size:14px}
    td.ck{width:24px;font-size:18px;color:#94a3b8}td.q{text-align:right;font-weight:800;width:60px}
    .sub{font-size:11px;color:#94a3b8}.pulled{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;margin-bottom:14px}
  </style></head><body>
    <h1>Transfer Pull Sheet</h1>
    <div class="meta">${store.name} · Batch ${soLabel} · ${new Date().toLocaleDateString()}</div>
    ${pulledNote ? `<div class="pulled">✓ Already pulled — reference copy</div>` : ''}
    ${designRows ? `<h3>Design transfers</h3><table>${designRows}</table>` : ''}
    ${numberBlocks || (designRows ? '' : '<div class="meta">No transfers needed for this batch.</div>')}
  </body></html>`);
}

// Merge the per-order ShipStation base64 PDFs into one document and print it.
// Chrome doesn't reliably rasterize stacked <embed> PDF plugins, so we hand the
// browser a single combined PDF (shared with the OMG label flow). Falls back to
// the stacked-embed window if the merge fails for any reason.
async function printLabels(labels) {
  try {
    await printPdfLabels(labels);
  } catch (e) {
    const embeds = labels.map((b64) => `<div class="lp"><embed src="data:application/pdf;base64,${b64}" type="application/pdf" width="100%" height="100%"></div>`).join('');
    printHtml(`<!doctype html><html><head><title>Shipping labels</title><style>body{margin:0}.lp{width:100%;height:6in;page-break-after:always}</style></head><body>${embeds || 'No labels.'}</body></html>`);
  }
}

// Print an HTML doc via a popup window (packing lists / player reports).
function printHtml(html) {
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to print.'); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 350);
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// One packing slip / player report per order. Doubles as the pull sheet.
function buildPackingLists(store, label, groups) {
  const slips = groups.map(({ order, items }) => {
    const a = order.ship_address || {};
    const shipTo = store.delivery_mode === 'deliver_club'
      ? 'Deliver to club'
      : [a.name || order.buyer_name, a.street1, a.street2, [a.city, a.state, a.zip].filter(Boolean).join(', ')].filter(Boolean).map(esc).join('<br>');
    const rows = items.filter((i) => !i.is_bundle_parent).map((i) => `<tr><td>${esc(i._effSku || i.sku || '')}</td><td>${esc(i.size || '')}</td><td>${esc(i.player_number || '')}</td><td>${esc(i.player_name || '')}</td><td style="text-align:center">${i.qty || 1}</td></tr>`).join('');
    const player = [...new Set(items.map((i) => i.player_name).filter(Boolean))].join(', ') || order.buyer_name || '';
    return `<div class="slip">
      <div class="hd"><div><div class="t">${esc(store.name)}</div><div class="s">Packing list · ${esc(label)}</div></div>
      <div class="pay">${order.payment_mode === 'paid' ? 'PAID' : 'TEAM TAB'}</div></div>
      <div class="meta"><div><b>Player:</b> ${esc(player)}</div><div><b>Buyer:</b> ${esc(order.buyer_name || '')} · ${esc(order.buyer_email || '')}</div>
      <div><b>Ship to:</b><br>${shipTo}</div></div>
      <table><thead><tr><th>SKU</th><th>Size</th><th>#</th><th>Name</th><th>Qty</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
  return `<!doctype html><html><head><title>Packing lists — ${esc(store.name)}</title><style>
    body{font-family:Arial,sans-serif;margin:0;color:#0b1220}
    .slip{padding:24px 28px;page-break-after:always;box-sizing:border-box}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0b1f3a;padding-bottom:8px}
    .t{font-size:22px;font-weight:800}.s{font-size:12px;color:#64748b}
    .pay{font-weight:800;font-size:12px;border:2px solid #0b1f3a;padding:4px 10px;border-radius:6px}
    .meta{margin:14px 0;font-size:13px;line-height:1.7}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
    th{text-align:left;border-bottom:1px solid #cbd5e1;padding:6px;color:#64748b;font-size:11px;text-transform:uppercase}
    td{padding:6px;border-bottom:1px solid #f1f5f9}
    @media print{.slip{padding:18px}}
  </style></head><body>${slips || '<div class="slip">No orders.</div>'}</body></html>`;
}

// Batch availability ("FAFO") report. For a set of orders, lay out exactly
// what we can fill, what we can't, and *whose* items fall short. Scarce stock
// (ours + Adidas) is allocated first-ordered-first-served, so any shortfall
// lands on the latest orders — the fair, defensible call when we can't cover
// everyone. Products with no stock record are made-to-order (decorated/custom)
// and treated as available, matching the batch flow's own inventory check.
function buildAvailabilityReport(store, label, lines, stockByPid, orderById, madeToOrder = new Set(), stockBySku = {}) {
  // Earliest orders claim stock first.
  const sorted = [...lines].sort((a, b) => {
    const ta = orderById[a.order_id]?.created_at || '', tb = orderById[b.order_id]?.created_at || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const remaining = {};   // stock-pool key -> units left to allocate (Infinity if untracked)
  const itemAgg = {};     // stock-pool key -> rollup row
  const orderShort = {};  // order_id -> { order, lines: [...] }
  let totalUnits = 0, shortUnits = 0, untrackedUnits = 0;

  sorted.forEach((i) => {
    const pid = i.product_id; const size = i.size || 'OS'; const need = i.qty || 1;
    totalUnits += need;
    if (!pid) { untrackedUnits += need; return; }
    // Override-aware: a size mapped to a different SKU pools + checks THAT SKU's
    // stock (lineStock reads inventory_unified for it), not the base product's.
    const k = lineStockKey(i);
    const ls = lineStock(i, stockByPid, stockBySku, madeToOrder);
    const wh = ls.ours, ven = ls.vendor, tracked = ls.tracked;
    if (remaining[k] === undefined) remaining[k] = tracked ? wh + ven : Infinity;
    if (!itemAgg[k]) itemAgg[k] = { name: ls.name || i.sku || pid, sku: i._effSku || i.sku || '', size, needed: 0, ours: wh, adidas: ven, filled: 0, tracked, known: ls.known, onOrder: ls.onOrder };
    const row = itemAgg[k];
    row.needed += need;
    const give = Math.min(need, Math.max(0, remaining[k]));
    remaining[k] -= give;
    row.filled += give;
    if (!tracked) untrackedUnits += need;
    const short = need - give;
    if (short > 0) {
      shortUnits += short;
      const o = orderById[i.order_id] || {};
      const bucket = orderShort[i.order_id] || (orderShort[i.order_id] = { order: o, lines: [] });
      bucket.lines.push({ name: row.name, sku: i._effSku || i.sku || '', size, short, player: i.player_name || '', number: i.player_number || '' });
    }
  });

  const rows = Object.values(itemAgg);
  const shortRows = rows.filter((r) => r.filled < r.needed).sort((a, b) => (b.needed - b.filled) - (a.needed - a.filled));
  const okRows = rows.filter((r) => r.filled >= r.needed).sort((a, b) => a.name.localeCompare(b.name) || (sizeRank(a.size) - sizeRank(b.size)) || a.size.localeCompare(b.size));
  const shortOrders = Object.values(orderShort).sort((a, b) => (a.order.created_at || '') < (b.order.created_at || '') ? -1 : 1);
  const ordersTotal = Object.keys(orderById).length;
  const availUnits = totalUnits - shortUnits;

  const chip = (n, l, danger) => `<div class="chip${danger ? ' bad' : ''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const itemRow = (r) => {
    // Show real stock numbers whenever we HAVE them (r.known) — an untracked /
    // made-to-order line still never shorts, but e.g. an override SKU's vendor
    // availability is informative rather than a dash.
    const show = r.tracked || r.known;
    const avail = show ? r.ours + r.adidas : '—';
    const sh = r.needed - r.filled;
    return `<tr${sh > 0 ? ' class="r"' : ''}><td>${esc(r.name)}${r.sku ? `<div class="sub">${esc(r.sku)}</div>` : ''}</td><td class="c">${esc(r.size)}</td><td class="c">${r.needed}</td><td class="c">${show ? r.ours : '—'}</td><td class="c">${show ? r.adidas : '—'}</td><td class="c">${avail}</td><td class="c b">${sh > 0 ? `<span class="neg">−${sh} short</span>${r.onOrder ? ' <span class="oo">on order</span>' : ''}` : '<span class="pos">✓ Good</span>'}</td></tr>`;
  };
  const itemTable = (list) => `<table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Need</th><th class="c">Ours</th><th class="c">Adidas</th><th class="c">Avail</th><th class="c">Status</th></tr></thead><tbody>${list.map(itemRow).join('')}</tbody></table>`;

  const orderBlock = (b) => {
    const o = b.order;
    const who = [o.buyer_name, o.buyer_email].filter(Boolean).map(esc).join(' · ');
    const ls = b.lines.map((l) => `<tr><td>${esc(l.name)}${l.sku ? `<div class="sub">${esc(l.sku)}</div>` : ''}</td><td class="c">${esc(l.size)}</td><td class="c">${[l.number ? '#' + esc(l.number) : '', esc(l.player)].filter(Boolean).join(' ') || '—'}</td><td class="c b"><span class="neg">−${l.short}</span></td></tr>`).join('');
    return `<div class="ord"><div class="oh">${who || 'Order'}${o.created_at ? `<span class="dt">${new Date(o.created_at).toLocaleDateString()}</span>` : ''}</div>
      <table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Player</th><th class="c">Short</th></tr></thead><tbody>${ls}</tbody></table></div>`;
  };

  printHtml(`<!doctype html><html><head><title>Availability — ${esc(store.name)}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:760px;margin:32px auto;padding:0 24px}
    h1{font-size:21px;margin:0 0 2px}.meta{color:#64748b;font-size:13px;margin-bottom:16px}
    h3{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin:24px 0 8px;border-bottom:2px solid #0b1220;padding-bottom:5px}
    h3 .ct{float:right;color:#94a3b8;font-weight:600}
    .chips{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
    .chip{flex:1;min-width:96px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
    .chip.bad{background:#fef2f2;border-color:#fecaca}
    .chip .n{font-size:22px;font-weight:900}.chip.bad .n{color:#b91c1c}.chip .l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px;margin-top:2px}
    table.grid{width:100%;border-collapse:collapse;font-size:13px}
    .grid th{text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 8px;color:#64748b;font-size:11px;text-transform:uppercase}
    .grid td{padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}
    .grid td.c{text-align:center}.grid td.b{font-weight:800}
    .grid tr.r td{background:#fef2f2}
    .sub{font-size:11px;color:#94a3b8}.neg{color:#b91c1c;font-weight:800}.pos{color:#047857;font-weight:800}
    .oo{font-size:10px;color:#92400e;background:#fef3c7;border-radius:4px;padding:1px 5px;font-weight:700}
    .ord{border:1px solid #fecaca;border-radius:10px;padding:10px 14px;margin-bottom:10px;background:#fff}
    .oh{font-weight:800;font-size:14px;margin-bottom:6px}.oh .dt{float:right;color:#94a3b8;font-weight:600;font-size:12px}
    .ok{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:700}
    @media print{.chip{-webkit-print-color-adjust:exact;print-color-adjust:exact}.grid tr.r td,.ord,.chip.bad{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
    <h1>Batch Availability Report</h1>
    <div class="meta">${esc(store.name)} · ${esc(label)} · ${new Date().toLocaleString()}</div>
    <div class="chips">
      ${chip(totalUnits, 'Units')}
      ${chip(availUnits, 'Available')}
      ${chip(shortUnits, 'Short', shortUnits > 0)}
      ${chip(ordersTotal - shortOrders.length, 'Orders OK')}
      ${chip(shortOrders.length, 'Orders short', shortOrders.length > 0)}
    </div>
    ${untrackedUnits ? `<div class="meta" style="margin-top:8px">${untrackedUnits} made-to-order unit${untrackedUnits === 1 ? '' : 's'} (no stock record) counted as available.</div>` : ''}
    ${shortRows.length ? `<h3>Not available <span class="ct">${shortRows.length} item${shortRows.length === 1 ? '' : 's'}</span></h3>${itemTable(shortRows)}` : ''}
    ${shortOrders.length ? `<h3>Whose items are short <span class="ct">${shortOrders.length} order${shortOrders.length === 1 ? '' : 's'}</span></h3>${shortOrders.map(orderBlock).join('')}` : '<h3>Whose items are short</h3><div class="ok">✓ Every order can be filled in full.</div>'}
    <h3>Available <span class="ct">${okRows.length} item${okRows.length === 1 ? '' : 's'}</span></h3>${okRows.length ? itemTable(okRows) : '<div class="meta">No fully-available stock items.</div>'}
  </body></html>`);
}

// ─── CSV export ──────────────────────────────────────────────────────
// Client-side CSV download. Cells are quote-escaped; a UTF-8 BOM is prepended
// so Excel opens accented names cleanly.
function downloadCsv(filename, header, rows) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const _csvDate = (d) => (d ? new Date(d).toLocaleDateString() : '');
const _itemName = (i, stockByPid) => i.name || (i.product_id && stockByPid[i.product_id] && stockByPid[i.product_id].name) || i.sku || i.product_id || 'Item';

// One place for "does this order count": an order that reached Stripe but never paid
// (pending_payment), was cancelled, or was fully refunded is dead for batching,
// tracking, and backorder math. NOTE: several older inline copies of this predicate
// exist in this file (loadStores stats, gatherAll, OrdersTab's `listable`, …) with
// slightly different exclusion sets — use this helper in new code and fold the old
// copies in as they're touched.
const isLiveWebstoreOrder = (o) => o && o.status !== 'pending_payment' && o.status !== 'cancelled' && o.status !== 'refunded';

// Render the calendar day a batch cutoff instant refers to. The cutoff is stored as
// the creating rep's LOCAL end-of-day; rendering that instant directly shows the
// NEXT day for viewers east of the creator. Nudging back 12h lands mid-day of the
// intended date for any viewer within ±11h of the creator's timezone.
const batchCutoffDay = (c) => new Date(new Date(c).getTime() - 12 * 3600 * 1000).toLocaleDateString();

// ─── Per-player roll-up ──────────────────────────────────────────────
// One section per player: exactly what they're getting across the whole store,
// plus the roster members who haven't ordered yet.
function buildPlayerReport(store, lines, orderById, roster, stockByPid) {
  const players = {};
  lines.forEach((i) => {
    const o = orderById[i.order_id] || {};
    const nm = (i.player_name || '').trim();
    const num = (i.player_number != null ? String(i.player_number) : '').trim();
    const key = (nm || num) ? (nm.toLowerCase() + '|' + num) : ('buyer:' + (o.buyer_email || o.buyer_name || i.order_id));
    const p = players[key] || (players[key] = { label: nm || (o.buyer_name ? o.buyer_name + ' (buyer)' : 'Unassigned'), number: num, units: 0, items: [], orders: {} });
    p.units += (i.qty || 1);
    p.items.push({ name: _itemName(i, stockByPid), sku: i._effSku || i.sku || '', size: i.size || '', qty: i.qty || 1, buyer: o.buyer_name || '' });
    // Who placed it + where it goes — the "more info" for each player block.
    if (o.id && !p.orders[o.id]) p.orders[o.id] = { buyer: o.buyer_name || '', email: o.buyer_email || '', phone: o.buyer_phone || '', ship: o.ship_address || null };
  });
  const shipLine = (s) => s
    ? [s.name, s.street1, s.street2, [s.city, s.state, s.zip].filter(Boolean).join(', ')].filter(Boolean).join(', ')
    : (store.delivery_mode === 'ship_home' ? '' : 'Delivered to the club');
  const list = Object.values(players).sort((a, b) => a.label.localeCompare(b.label));
  const notOrdered = (roster || []).filter((r) => !r.ordered);
  const totalUnits = list.reduce((a, p) => a + p.units, 0);
  const chip = (n, l) => `<div class="chip"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const block = (p) => {
    const rows = p.items.map((it) => `<tr><td>${esc(it.name)}${it.sku ? `<div class="sub">${esc(it.sku)}</div>` : ''}</td><td class="c">${esc(it.size)}</td><td class="c b">${it.qty}</td><td>${esc(it.buyer)}</td></tr>`).join('');
    const contacts = Object.values(p.orders).map((c) => {
      const sh = shipLine(c.ship);
      return `<div class="contact">👤 <b>${esc(c.buyer || '—')}</b>${c.email ? ` · <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}${c.phone ? ` · ${esc(c.phone)}` : ''}${sh ? `<div class="ship">📦 ${esc(sh)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="ord"><div class="oh">${esc(p.label)}${p.number ? ` <span class="num">#${esc(p.number)}</span>` : ''}<span class="dt">${p.units} item${p.units === 1 ? '' : 's'}</span></div>
      ${contacts}
      <table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Qty</th><th>Buyer</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  printHtml(`<!doctype html><html><head><title>Player report — ${esc(store.name)}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:760px;margin:32px auto;padding:0 24px}
    h1{font-size:21px;margin:0 0 2px}.meta{color:#64748b;font-size:13px;margin-bottom:16px}
    h3{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin:24px 0 8px;border-bottom:2px solid #0b1220;padding-bottom:5px}
    .chips{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
    .chip{flex:1;min-width:96px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
    .chip .n{font-size:22px;font-weight:900}.chip .l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px;margin-top:2px}
    table.grid{width:100%;border-collapse:collapse;font-size:13px}
    .grid th{text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 8px;color:#64748b;font-size:11px;text-transform:uppercase}
    .grid td{padding:7px 8px;border-bottom:1px solid #f1f5f9}.grid td.c{text-align:center}.grid td.b{font-weight:800}
    .sub{font-size:11px;color:#94a3b8}
    .ord{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:10px;break-inside:avoid}
    .oh{font-weight:800;font-size:14px;margin-bottom:6px}.oh .num{color:#2563eb}.oh .dt{float:right;color:#94a3b8;font-weight:600;font-size:12px}
    .contact{font-size:12px;color:#475569;margin:0 0 8px;line-height:1.5}.contact a{color:#2563eb;text-decoration:none}.contact .ship{color:#64748b;margin-top:2px}
    .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.7}
  </style></head><body>
    <h1>Player Report</h1>
    <div class="meta">${esc(store.name)} · ${new Date().toLocaleString()}</div>
    <div class="chips">${chip(list.length, 'Players')}${chip(totalUnits, 'Items')}${(roster && roster.length) ? chip(notOrdered.length, 'Not ordered') : ''}</div>
    ${list.map(block).join('') || '<div class="meta">No orders yet.</div>'}
    ${notOrdered.length ? `<h3>Roster — not ordered yet</h3><div class="warn">${notOrdered.map((r) => esc(r.player_name || '') + (r.player_number ? ' #' + esc(String(r.player_number)) : '')).join(' · ')}</div>` : ''}
  </body></html>`);
}

// Aggregate store demand vs stock per product+size, split into what we can fill
// from our own shelves, what we'd buy from the vendor (Adidas), and what nobody
// has (true backorder). The basis for the stock report + its CSV.
// Product ids the rep marked made-to-order (Inventory tracking → off). Treated
// exactly like products with no stock record: never stock-checked, so they don't
// show as shortfalls in the batch SO modal or the stock / availability reports.
function madeToOrderPids(catalog) {
  return new Set((catalog || []).filter((c) => c.product_id && c.track_inventory === false).map((c) => c.product_id));
}

// ── Size-level SKU overrides ─────────────────────────────────────────
// A size mapped to a different item number (catalog size_skus) is sourced as
// that SKU everywhere: the SO line (batch flow), the availability/stock
// reports, CSVs and the batch shortfall check. These helpers resolve a line's
// EFFECTIVE SKU and annotate order lines so every consumer agrees.
function sizeSkuMapOf(catalog) {
  const m = {};
  (catalog || []).forEach((c) => { if (c.product_id && c.size_skus && Object.keys(c.size_skus).length) m[c.product_id] = c.size_skus; });
  return m;
}
// Annotate lines with _effSku (the SKU production will actually source) and
// _skuOv (true when it differs from the line's own SKU).
function annotateEffSkus(lines, skuMap) {
  return (lines || []).map((i) => {
    const ov = i.product_id && skuMap[i.product_id] ? String(skuMap[i.product_id][i.size || 'OS'] || '').trim() : '';
    const eff = ov || i.sku || '';
    return { ...i, _effSku: eff, _skuOv: !!ov && ov !== (i.sku || '') };
  });
}
// Vendor stock for override SKUs (they have no product row, so the usual
// product-keyed stock map can't see them). Looks up inventory_unified by SKU →
// { SKU: { sizes: {size: qty}, eta: bool } }. Best-effort: on error returns {}
// and overridden lines simply report as untracked rather than wrong.
async function fetchOverrideSkuStock(lines) {
  const skus = [...new Set((lines || []).filter((l) => l._skuOv && l._effSku).map((l) => l._effSku))];
  if (!skus.length || !supabase) return {};
  try {
    const { data } = await supabase.from('inventory_unified').select('sku,size,stock_qty,future_delivery_date').in('sku', skus);
    const out = {};
    (data || []).forEach((r) => {
      const e = out[r.sku] || (out[r.sku] = { sizes: {}, eta: false });
      e.sizes[r.size] = (Number(e.sizes[r.size]) || 0) + (Number(r.stock_qty) || 0);
      if ((Number(r.stock_qty) || 0) <= 0 && r.future_delivery_date) e.eta = true;
    });
    return out;
  } catch { return {}; }
}
// Stock picture for one line, override-aware: overridden lines read the
// override SKU's vendor stock (warehouse stock is unknown for a bare SKU → 0);
// normal lines read the product's stock record as before.
function lineStock(i, stockByPid, stockBySku, madeToOrder) {
  const size = i.size || 'OS';
  if (i._skuOv) {
    const vst = stockBySku[i._effSku];
    const base = i.product_id ? stockByPid[i.product_id] : null;
    // known: we have real stock numbers to SHOW even when the item is untracked
    // (tracking off = never blocked/short, but availability is still informative).
    return { ours: 0, vendor: vst ? (Number(vst.sizes[size]) || 0) : 0, tracked: !!vst && !madeToOrder.has(i.product_id), known: !!vst, onOrder: !!(vst && vst.eta), name: base && base.name };
  }
  const st = i.product_id ? stockByPid[i.product_id] : null;
  return { ours: Number(((st && st.size_stock) || {})[size]) || 0, vendor: Number(((st && st.vendor_size_stock) || {})[size]) || 0, tracked: !!st && !madeToOrder.has(i.product_id), known: !!st, onOrder: !!(st && (st.on_order_qty || st.vendor_eta)), name: st && st.name };
}
// Aggregation key: overridden sizes pool stock separately from the base SKU.
const lineStockKey = (i) => (i.product_id || i.sku || 'x') + (i._skuOv ? '§' + i._effSku : '') + '|' + (i.size || 'OS');

function aggStock(lines, stockByPid, madeToOrder = new Set(), stockBySku = {}) {
  const agg = {};
  lines.forEach((i) => {
    const pid = i.product_id; const size = i.size || 'OS'; const need = i.qty || 1;
    const k = lineStockKey(i);
    const ls = lineStock(i, stockByPid, stockBySku, madeToOrder);
    if (!agg[k]) agg[k] = {
      name: ls.name || i.name || i.sku || pid, sku: i._effSku || i.sku || '', size, need: 0,
      ours: ls.ours, vendor: ls.vendor, tracked: ls.tracked, known: ls.known, onOrder: ls.onOrder,
    };
    agg[k].need += need;
  });
  return Object.values(agg).map((r) => {
    const fillOurs = Math.min(r.need, r.ours);
    const poVendor = Math.min(Math.max(0, r.need - r.ours), r.vendor);
    const backorder = r.tracked ? Math.max(0, r.need - r.ours - r.vendor) : 0;
    return { ...r, fillOurs, poVendor, backorder };
  });
}

// ─── Store-close stock / shortage report ─────────────────────────────
// "What can we fill from stock, what do we need to order from Adidas, and what
// is nobody able to supply (backorder)." Vendor-split, not the combined view.
function buildStockReport(store, label, lines, stockByPid, madeToOrder = new Set(), stockBySku = {}) {
  const rows = aggStock(lines, stockByPid, madeToOrder, stockBySku);
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const needSrc = rows.filter((r) => r.poVendor > 0 || r.backorder > 0)
    .sort((a, b) => (b.backorder - a.backorder) || (b.poVendor - a.poVendor));
  const fillable = rows.filter((r) => r.tracked && r.need <= r.ours).sort((a, b) => a.name.localeCompare(b.name) || (sizeRank(a.size) - sizeRank(b.size)) || a.size.localeCompare(b.size));
  const untracked = rows.filter((r) => !r.tracked);
  const chip = (n, l, danger) => `<div class="chip${danger ? ' bad' : ''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const srcRow = (r) => `<tr${r.backorder > 0 ? ' class="r"' : ''}><td>${esc(r.name)}${r.sku ? `<div class="sub">${esc(r.sku)}</div>` : ''}</td><td class="c">${esc(r.size)}</td><td class="c">${r.need}</td><td class="c">${r.ours}</td><td class="c">${r.vendor}</td><td class="c b">${r.poVendor > 0 ? r.poVendor : '—'}${r.onOrder && r.poVendor > 0 ? ' <span class="oo">on order</span>' : ''}</td><td class="c b">${r.backorder > 0 ? `<span class="neg">${r.backorder}</span>` : '—'}</td></tr>`;
  const fillRow = (r) => `<tr><td>${esc(r.name)}${r.sku ? `<div class="sub">${esc(r.sku)}</div>` : ''}</td><td class="c">${esc(r.size)}</td><td class="c">${r.need}</td><td class="c">${r.ours}</td></tr>`;
  printHtml(`<!doctype html><html><head><title>Stock report — ${esc(store.name)}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:780px;margin:32px auto;padding:0 24px}
    h1{font-size:21px;margin:0 0 2px}.meta{color:#64748b;font-size:13px;margin-bottom:16px}
    h3{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin:24px 0 8px;border-bottom:2px solid #0b1220;padding-bottom:5px}
    h3 .ct{float:right;color:#94a3b8;font-weight:600}
    .chips{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
    .chip{flex:1;min-width:110px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
    .chip.bad{background:#fef2f2;border-color:#fecaca}.chip.bad .n{color:#b91c1c}
    .chip .n{font-size:22px;font-weight:900}.chip .l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px;margin-top:2px}
    table.grid{width:100%;border-collapse:collapse;font-size:13px}
    .grid th{text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 8px;color:#64748b;font-size:11px;text-transform:uppercase}
    .grid td{padding:7px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}
    .grid td.c{text-align:center}.grid td.b{font-weight:800}.grid tr.r td{background:#fef2f2}
    .sub{font-size:11px;color:#94a3b8}.neg{color:#b91c1c;font-weight:800}.pos{color:#047857;font-weight:800}
    .oo{font-size:10px;color:#92400e;background:#fef3c7;border-radius:4px;padding:1px 5px;font-weight:700}
    .ok{background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:700}
    @media print{.chip,.grid tr.r td,.chip.bad{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
    <h1>Stock Report</h1>
    <div class="meta">${esc(store.name)} · ${esc(label)} · ${new Date().toLocaleString()}</div>
    <div class="chips">
      ${chip(sum((r) => r.need), 'Units ordered')}
      ${chip(sum((r) => r.fillOurs), 'From our stock')}
      ${chip(sum((r) => r.poVendor), 'Order from Adidas', sum((r) => r.poVendor) > 0)}
      ${chip(sum((r) => r.backorder), 'Backordered', sum((r) => r.backorder) > 0)}
    </div>
    ${untracked.length ? `<div class="meta" style="margin-top:8px">${untracked.reduce((a, r) => a + r.need, 0)} made-to-order unit(s) (no stock record) are not counted as shortfalls.</div>` : ''}
    ${needSrc.length
      ? `<h3>Need to source <span class="ct">${needSrc.length} line${needSrc.length === 1 ? '' : 's'}</span></h3>
         <table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Need</th><th class="c">Ours</th><th class="c">Adidas</th><th class="c">PO Adidas</th><th class="c">Backorder</th></tr></thead><tbody>${needSrc.map(srcRow).join('')}</tbody></table>`
      : '<h3>Need to source</h3><div class="ok">✓ Everything is covered by our own stock.</div>'}
    <h3>Fillable from our stock <span class="ct">${fillable.length} line${fillable.length === 1 ? '' : 's'}</span></h3>
    ${fillable.length ? `<table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Need</th><th class="c">Ours</th></tr></thead><tbody>${fillable.map(fillRow).join('')}</tbody></table>` : '<div class="meta">None.</div>'}
  </body></html>`);
}

// Convert a webstore order to a ShipStation order (ship-to-home label).
function webstoreToShipStation(order, items, store, imageByPid = {}) {
  const a = order.ship_address || {};
  return {
    orderNumber: 'WS-' + order.id, orderKey: 'ws-' + order.id,
    orderDate: order.created_at, orderStatus: 'awaiting_shipment',
    customerUsername: store.name, customerEmail: order.buyer_email || '',
    billTo: { name: order.buyer_name || a.name || 'Customer' },
    shipTo: { name: a.name || order.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: order.buyer_phone || '', residential: true },
    items: items.filter((i) => !i.is_bundle_parent).map((i) => ({
      lineItemKey: i.id, // echoed back on the shipment so the webhook marks the exact line shipped
      sku: i._effSku || i.sku || '', name: [i._effSku || i.sku, i.size && ('Size ' + i.size), i.player_number && ('#' + i.player_number), i.player_name].filter(Boolean).join(' · '),
      quantity: i.qty || 1, unitPrice: Number(i.unit_price) || 0,
      imageUrl: imageByPid[i.product_id] || undefined,
      options: [i.size && { name: 'Size', value: i.size }, i.player_number && { name: 'Number', value: String(i.player_number) }, i.player_name && { name: 'Name', value: i.player_name }].filter(Boolean),
    })),
    amountPaid: order.payment_mode === 'paid' ? (Number(order.total) || 0) : 0,
    carrierCode: null, serviceCode: null, packageCode: null, confirmation: 'none',
    advancedOptions: {
      source: 'NSA Webstore', customField1: store.name, customField2: order.so_id || '',
      ...(store.shipstation_store_id ? { storeId: Number(store.shipstation_store_id) || undefined } : {}),
    },
  };
}

// Reusable image uploader → Cloudinary, returns a secure URL via onChange.
function ImageUpload({ value, fallback, onChange, onBusy, label = 'Product image' }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const shown = value || fallback;
  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return; }
    setBusy(true); setErr(''); if (onBusy) onBusy(true);
    try { const url = await cloudUpload(file, 'nsa-webstores'); onChange(url); }
    catch (x) { setErr(x.message || 'Upload failed.'); }
    setBusy(false); if (onBusy) onBusy(false);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6A7180' }}>{label}</label>
      <div
        onClick={() => ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!over) setOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) upload(f); }}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 12, borderRadius: 12, cursor: 'pointer', border: '1.5px dashed ' + (over ? '#191919' : '#d7dbe2'), background: over ? '#f5f5ff' : '#fafbfc', transition: 'border-color .12s, background .12s' }}>
        {/* Thumbnail with the Remove control as a corner ×, so it never overlaps the image
            even when the uploader is squeezed into a narrow column. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ width: 60, height: 60, borderRadius: 10, background: '#fff', border: '1px solid #eef0f3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {shown ? <img src={shown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 700, textTransform: 'uppercase' }}>none</span>}
          </div>
          {value && <button type="button" title="Remove image" onClick={(e) => { e.stopPropagation(); onChange(null); }} style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff', color: '#b91c1c', fontSize: 12, fontWeight: 800, lineHeight: '16px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.15)', padding: 0 }}>×</button>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3A4150' }}>{busy ? 'Uploading…' : over ? 'Drop the image' : value ? 'Replace image' : 'Drag an image here, or click to browse'}</div>
          {!value && fallback && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>Using stock photo — drop one to override.</div>}
          {err && <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 3 }}>{err}</div>}
        </div>
        <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) upload(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Webstores admin (steps 2/4/5): list + detail, store create/edit, and
// catalog management (single products + bundles, jersey-number and
// fundraising config). Reads & writes the migration-011 tables directly
// via the Supabase client — intentionally isolated from the central
// _dbLoad/_diffSave engine so it can never affect existing estimate/SO
// persistence. Degrades to an "apply migration" message when absent.
// ─────────────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  open: { bg: '#dcfce7', fg: '#166534' },
  closed: { bg: '#dbeafe', fg: '#1e40af' },
  draft: { bg: '#f1f5f9', fg: '#64748b' },
  archived: { bg: '#fef3c7', fg: '#92400e' },
};
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg }}>{(status || 'draft').toUpperCase()}</span>;
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumSizes = (jsonb) => Object.values(jsonb || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Rough ship weight (oz) by item type, from the name/sku keywords. Used as a
// default in the catalog editor and as a fallback when a label is created.
// Map products -> which transfers they consume, then tally usage from order lines.
// Supports both new array columns (transfer_codes, num_transfer_sets) and old single columns.
function buildTransferMaps(catalog, bundleItems) {
  const designsByPid = {}, numSetsByPid = {}, takesNumByPid = {};
  const process = (c) => {
    if (!c.product_id) return;
    const codes = c.transfer_codes?.length ? c.transfer_codes : (c.transfer_code ? [c.transfer_code] : []);
    if (codes.length) designsByPid[c.product_id] = codes;
    if (c.takes_number) {
      takesNumByPid[c.product_id] = true;
      const sets = c.num_transfer_sets?.length
        ? c.num_transfer_sets.map((s) => { const [size, color] = s.split('|'); return { size, color }; })
        : (c.num_transfer_size ? [{ size: c.num_transfer_size, color: c.num_transfer_color }] : []);
      if (sets.length) numSetsByPid[c.product_id] = sets;
    }
  };
  (catalog || []).forEach(process);
  (bundleItems || []).forEach(process);
  return { designsByPid, numSetsByPid, takesNumByPid };
}
function transferUsage(lines, maps) {
  const used = {};
  (lines || []).forEach((i) => {
    if (i.is_bundle_parent) return;
    const units = i.qty || 1;
    (maps.designsByPid[i.product_id] || []).forEach((d) => { used[d] = (used[d] || 0) + units; });
    if (maps.takesNumByPid[i.product_id] && i.player_number) {
      (maps.numSetsByPid[i.product_id] || []).forEach((set) => {
        String(i.player_number).replace(/[^0-9]/g, '').split('').forEach((dg) => { const code = `${dg}|${set.size || ''}|${set.color || ''}`; used[code] = (used[code] || 0) + units; });
      });
    }
  });
  return used;
}

function isMissingTable(err) {
  if (!err) return false;
  const m = (err.message || err.details || '').toLowerCase();
  return err.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache');
}

// ── Coach launch email + printable flyer ─────────────────────────────
const _esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
// Families get the BRANDED marketing URL (nationalsportsapparel.com/shop/<slug>), which the
// marketing site 200-proxies to this storefront — never the raw portal origin staff happen
// to trigger the email from.
const PUBLIC_SITE = 'https://nationalsportsapparel.com';
const _storefrontUrl = (store) => `${PUBLIC_SITE}/shop/${store.slug}`;
// QuickChart renders a standard 8-bit PNG that email clients reliably display; the previous
// goqr.me image came back as a 1-bit colormap PNG that several clients/image-proxies dropped.
const _qrImg = (data, size = 300) => `https://quickchart.io/qr?size=${size}&margin=2&ecLevel=M&text=${encodeURIComponent(data)}`;
const _hex = (v, fb) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fb);
const _fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : null);
const _deliveryLabel = (store) => (store.delivery_mode === 'deliver_club' ? 'Delivered to the team' : "Shipped to each buyer's home");

// Launch email written for families (coach receives + forwards). Branded with team colors.
function launchEmailHtml(store, portalUrl) {
  const url = _storefrontUrl(store);
  const primary = _hex(store.primary_color, '#0b1f3a');
  const accent = _hex(store.accent_color, '#e11d2a');
  const lead = store.org_type === 'club' ? 'Director' : 'Coach';
  const closeDate = _fmtDate(store.close_at);
  const delivLabel = _deliveryLabel(store);
  const dk = (hex, a) => { try { const n = parseInt(hex.slice(1), 16); return '#' + [(n>>16)&255,(n>>8)&255,n&255].map((c)=>Math.round(c*(1-a)).toString(16).padStart(2,'0')).join(''); } catch(e){return hex;} };
  const primaryDark = dk(primary, 0.34);
  const ink = '#16223F'; const cream = '#FAF6EF'; const sub = '#6B6256';
  const steps = [
    { n:1, title:'Visit the store', body:'Tap the button above or scan the QR code to open your team\'s store.' },
    { n:2, title:'Pick sizes & gear', body:'Browse all items, choose sizes for your player, and add to your cart.' },
    { n:3, title:'Check out', body:`Place your order${closeDate ? ' before ' + closeDate : ''}. Everything is delivered together to the team.` },
  ];
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f0f0f0;padding:0">
  <div style="max-width:600px;margin:0 auto;background:#fff;overflow:hidden;border-radius:6px;box-shadow:0 4px 24px rgba(0,0,0,.12)">
    <div style="background:${ink};padding:11px 24px;text-align:center;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.8);font-weight:700">
      <span style="color:${accent}">&#9733;</span> Official Team Store &middot; Powered by National Sports Apparel
    </div>
    <div style="background:linear-gradient(135deg,${primary},${primaryDark});padding:34px 24px 28px;text-align:center">
      ${store.logo_url ? `<div style="margin-bottom:14px"><img src="${_esc(store.logo_url)}" alt="" style="height:56px;border-radius:10px;background:#fff;padding:6px"/></div>` : ''}
      <div style="font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:${accent};font-weight:700">${_esc(store.name)}</div>
      <h1 style="font-size:40px;font-weight:900;line-height:1;text-transform:uppercase;color:#fff;margin:12px 0 0">The Team Store Is <span style="color:${accent}">Now Open</span></h1>
      <p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,.88);margin:18px auto 0;max-width:420px">Order your player&rsquo;s official, custom-decorated gear online. Everything ships straight to the team &mdash; just place your order before the store closes.</p>
      <a href="${url}" style="display:inline-block;margin-top:22px;background:${accent};color:${ink};font-size:15px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;text-decoration:none;padding:14px 32px">Shop The Store &rarr;</a>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ink};border-collapse:collapse">
      <tr>
        <td style="padding:14px 12px;text-align:center;border-right:1px solid rgba(255,255,255,.12)">
          <div style="font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:${accent};font-weight:700">Order By</div>
          <div style="font-size:17px;text-transform:uppercase;color:#fff;font-weight:800;margin-top:3px">${closeDate || 'Open Now'}</div>
        </td>
        <td style="padding:14px 12px;text-align:center;border-right:1px solid rgba(255,255,255,.12)">
          <div style="font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:${accent};font-weight:700">Delivery</div>
          <div style="font-size:17px;text-transform:uppercase;color:#fff;font-weight:800;margin-top:3px">${_esc(delivLabel)}</div>
        </td>
        <td style="padding:14px 12px;text-align:center">
          <div style="font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:${accent};font-weight:700">Minimums</div>
          <div style="font-size:17px;text-transform:uppercase;color:#fff;font-weight:800;margin-top:3px">None</div>
        </td>
      </tr>
    </table>
    <div style="padding:26px 24px 8px;text-align:center">
      <div style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${ink};margin-bottom:12px">Scan to shop</div>
      <img src="${_qrImg(url, 220)}" alt="QR code to the store" width="160" height="160" style="border:4px solid ${primary};border-radius:10px"/>
      <div style="font-size:11px;color:${sub};margin-top:8px">${_esc(url)}</div>
    </div>
    <div style="padding:14px 24px 18px">
      <div style="background:${cream};border:1px solid #E7DFD0;border-radius:6px;padding:18px 20px">
        <h3 style="font-size:14px;font-weight:800;text-transform:uppercase;margin:0 0 14px;color:${ink};text-align:center;letter-spacing:.5px">How To Order</h3>
        ${steps.map((st)=>`<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:11px"><div style="flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:${primary};color:#fff;text-align:center;line-height:24px;font-weight:800;font-size:12px">${st.n}</div><div><div style="font-size:13px;font-weight:700;text-transform:uppercase;color:${ink};letter-spacing:.3px">${st.title}</div><div style="font-size:12.5px;line-height:1.5;color:${sub};margin-top:1px">${st.body}</div></div></div>`).join('')}
      </div>
    </div>
    <div style="padding:4px 24px 20px;text-align:center">
      <p style="font-size:13px;line-height:1.6;color:${sub};margin:0">Questions about sizing or your order? Your NSA team rep is here to help &mdash;<br/><a href="mailto:hello@nationalsportsapparel.com" style="color:${primary};font-weight:600;text-decoration:none">hello@nationalsportsapparel.com</a></p>
    </div>
    ${portalUrl ? `<div style="padding:0 24px 14px;text-align:center"><p style="font-size:11px;color:#94a3b8;margin:0">${lead}: <a href="${_esc(portalUrl)}" style="color:#2563eb;font-size:11px">Track orders in your ${lead.toLowerCase()} portal &rarr;</a></p></div>` : ''}
    <div style="background:${ink};padding:20px 24px;text-align:center">
      <div style="font-size:15px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#fff">National Sports Apparel</div>
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.5);margin-top:4px">California&rsquo;s Largest Independent Team Dealer &middot; Since 2009</div>
      <div style="font-size:10px;color:rgba(255,255,255,.35);margin-top:12px">2238 N Glassell St Ste E, Orange, CA 92865</div>
    </div>
  </div>
  </div>`;
}

// 2-page print-ready flyer with team colors, items, QR, and key dates.
function flyerHtml(store, items = []) {
  const url = _storefrontUrl(store);
  const primary = _hex(store.primary_color, '#0b1f3a');
  const accent = _hex(store.accent_color, '#e11d2a');
  const closeDate = _fmtDate(store.close_at);
  const delivLabel = _deliveryLabel(store);
  const dk = (hex, a) => { try { const n = parseInt(hex.slice(1), 16); return '#' + [(n>>16)&255,(n>>8)&255,n&255].map((c)=>Math.round(c*(1-a)).toString(16).padStart(2,'0')).join(''); } catch(e){return hex;} };
  const primaryDark = dk(primary, 0.34);
  const accentDeep = dk(accent, 0.24);
  const ink = '#16223F'; const cream = '#FAF6EF'; const sub = '#6B6256'; const line = '#E7DFD0';
  // The Player Pack (bundle) gets a highlighted feature band at the top; everything
  // else flows into the product grid below. Inactive items (active===false) are bundle
  // components — they're represented by the package band, so keep them out of the grid.
  const pkg = (items || []).find((i) => i.active !== false && (i.kind === 'bundle' || i.is_bundle_parent) && Number(i.retail_price) > 0);
  // The pack's component photos (all items in the bundle); fall back to a single image.
  const pkgImgs = (pkg && pkg._componentImages && pkg._componentImages.length)
    ? pkg._componentImages.slice(0, 4)
    : ((pkg && pkg.image_front_url) ? [pkg.image_front_url] : ((items || []).filter((i) => i.active === false && i.image_front_url).map((i) => i.image_front_url).slice(0, 4)));
  const visItems = (items || []).filter((i) => !i.is_bundle_parent && i.active !== false && i.kind !== 'bundle');
  // Image fills the whole card; the price floats as a pill badge (team accent color)
  // over the bottom-left corner so the product photo gets the maximum area.
  const itemCard = (it, h=150) => `<div style="position:relative;border:1px solid ${line};border-radius:6px;overflow:hidden;background:#fff;height:${h}px">${it.image_front_url?`<img src="${_esc(it.image_front_url)}" alt="" style="width:100%;height:100%;object-fit:contain;padding:8px"/>`:`<div style="width:100%;height:100%;background:linear-gradient(150deg,#F4EFE6,#E8E0D0);display:grid;place-items:center"><span style="font-size:10px;color:#b0a898">No image</span></div>`}${it.retail_price?`<div style="position:absolute;left:8px;bottom:8px;background:${accent};color:#fff;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:15px;line-height:1;padding:4px 11px;border-radius:20px;box-shadow:0 1px 4px rgba(0,0,0,.25)">$${Math.round(Number(it.retail_price))}</div>`:''}</div>`;
  // Render an item array as rows of 4.
  const grid = (arr, h) => { let o = ''; const rows = Math.ceil(arr.length / 4); for (let r = 0; r < rows; r++) { o += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;${r > 0 ? 'margin-top:10px' : ''}">${arr.slice(r * 4, r * 4 + 4).map((it) => itemCard(it, h)).join('')}</div>`; } return o; };
  // Highlighted Player Pack band (only when the store has a bundle).
  const pkgBand = pkg ? `
    <div style="margin:16px 40px 0">
      <div style="display:flex;align-items:stretch;border-radius:10px;overflow:hidden;border:2px solid ${accent};background:linear-gradient(120deg,${primary},${primaryDark});color:#fff">
        ${pkgImgs.length ? `<div style="flex:0 0 130px;background:#fff;display:grid;grid-template-columns:repeat(${pkgImgs.length === 1 ? 1 : 2},1fr);gap:3px;padding:6px;align-content:center">${pkgImgs.map((u) => `<div style="display:flex;align-items:center;justify-content:center;height:${pkgImgs.length <= 2 ? 104 : 52}px"><img src="${_esc(u)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain"/></div>`).join('')}</div>` : ''}
        <div style="flex:1;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 22px">
          <div>
            <div style="font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${accent}">&#9733; Required For Every Player</div>
            <div style="font-weight:800;font-size:30px;text-transform:uppercase;line-height:1.02;margin-top:3px">${_esc(pkg.name || pkg.display_name || 'Player Pack')}</div>
            <div style="font-size:13px;color:rgba(255,255,255,.82);margin-top:6px;font-family:Arial,sans-serif">Everything your player needs in one bundle &mdash; add it to the cart in one click.</div>
          </div>
          <div style="text-align:center;flex-shrink:0">
            <div style="font-weight:800;font-size:42px;color:#fff;line-height:1">$${Math.round(Number(pkg.retail_price))}</div>
            <div style="font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.72)">Complete Pack</div>
          </div>
        </div>
      </div>
    </div>` : '';
  const p1Items = visItems.slice(0, 12);
  const p2Items = visItems.slice(12);
  return `<!doctype html><html><head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;700;800&display=swap" rel="stylesheet">
  <title>${_esc(store.name)} — Team Store Flyer</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;font-family:'Barlow Condensed',Arial,sans-serif;background:#5b5b5b}
    .no-print{text-align:center;padding:12px;background:#444}
    .page{width:816px;min-height:1056px;margin:0 auto 28px;background:#fff;position:relative;overflow:hidden;box-shadow:0 12px 50px rgba(0,0,0,.35)}
    @media print{html,body{background:#fff}.no-print{display:none!important}.page{box-shadow:none;margin:0;page-break-after:always;width:100%}}
    @page{size:letter portrait;margin:0}
  </style></head><body>
  <div class="no-print">
    <button onclick="window.print()" style="padding:9px 20px;font-size:13.5px;font-weight:800;border:none;border-radius:7px;background:${primary};color:#fff;cursor:pointer;margin-right:8px">Print / Save as PDF</button>
    <span style="color:#aaa;font-size:12px">Browser Print → Save as PDF</span>
  </div>
  <!-- PAGE 1 -->
  <div class="page">
    <div style="background:${ink};color:rgba(255,255,255,.85);padding:9px 40px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;letter-spacing:1.6px;text-transform:uppercase">
      <span><span style="color:${accent}">&#9733;</span> Official Team Store</span>
      <span style="color:rgba(255,255,255,.62)">Powered by National Sports Apparel</span>
    </div>
    <div style="background:linear-gradient(135deg,${primary},${primaryDark});overflow:hidden;padding:14px 40px 12px;position:relative">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(-55deg,transparent,transparent 26px,rgba(255,255,255,.045) 26px,rgba(255,255,255,.045) 52px)"></div>
      <div style="position:relative;display:flex;align-items:center;gap:16px;margin-bottom:9px">
        ${store.logo_url ? `<img src="${_esc(store.logo_url)}" alt="" style="height:42px;background:#fff;border-radius:8px;padding:4px;flex-shrink:0"/>` : ''}
        <div>
          <div style="font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:${accent}">${_esc(store.name)}</div>
          ${closeDate ? `<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.6)">Order by ${_esc(closeDate)}</div>` : ''}
        </div>
      </div>
      <h1 style="position:relative;font-weight:800;font-size:40px;line-height:.92;text-transform:uppercase;color:#fff;margin:0">The Team Store Is <em style="font-style:italic;color:${accent}">Now Open</em></h1>
      <p style="position:relative;font-size:12.5px;line-height:1.4;color:rgba(255,255,255,.85);max-width:560px;margin:7px 0 0;font-family:Arial,sans-serif">Order your player&rsquo;s official, custom-decorated gear online. Everything ships straight to the team &mdash; place your order before the store closes.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);background:${ink}">
      <div style="padding:9px 40px;border-right:1px solid rgba(255,255,255,.12)"><div style="font-weight:700;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${accent}">Order By</div><div style="font-weight:800;font-size:20px;text-transform:uppercase;color:#fff;line-height:1.1">${closeDate || 'Open Now'}</div></div>
      <div style="padding:9px 24px;border-right:1px solid rgba(255,255,255,.12)"><div style="font-weight:700;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${accent}">Delivery</div><div style="font-weight:800;font-size:20px;text-transform:uppercase;color:#fff;line-height:1.1">${_esc(delivLabel)}</div></div>
      <div style="padding:9px 24px"><div style="font-weight:700;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${accent}">Minimums</div><div style="font-weight:800;font-size:20px;text-transform:uppercase;color:#fff;line-height:1.1">None</div></div>
    </div>
    ${pkgBand}
    ${p1Items.length > 0 ? `
    <div style="padding:18px 40px 104px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <h2 style="font-weight:800;font-size:26px;text-transform:uppercase;margin:0;color:${ink};white-space:nowrap">What&rsquo;s In The Store</h2>
        <div style="flex:1;height:3px;background:${accent};transform:skewX(-12deg)"></div>
      </div>
      ${grid(p1Items, pkg ? 142 : 156)}
    </div>` : (pkg ? '' : `
    <div style="padding:22px 40px 120px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px"><h2 style="font-weight:800;font-size:28px;text-transform:uppercase;margin:0;color:${ink}">How To Order</h2><div style="flex:1;height:3px;background:${accent};transform:skewX(-12deg)"></div></div>
      <div style="display:flex;flex-direction:column;gap:16px">${[['Visit the store','Scan the QR code or visit the link below to open the store.'],['Pick sizes & gear','Browse all items and choose sizes for each player.'],['Check out',`Place your order${closeDate?' before '+closeDate:''}. Gear ships to the team ~4–5 weeks after the store closes.`]].map(([t,b],i)=>`<div style="display:flex;align-items:flex-start;gap:12px"><div style="flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:${primary};color:#fff;text-align:center;line-height:28px;font-weight:800;font-size:15px">${i+1}</div><div><div style="font-weight:700;font-size:16px;text-transform:uppercase;color:${ink}">${t}</div><div style="font-size:13.5px;color:${sub};margin-top:2px;font-family:Arial,sans-serif">${b}</div></div></div>`).join('')}</div>
    </div>`)}
    <div style="position:absolute;bottom:0;left:0;right:0">
      <div style="background:${cream};border-top:1px solid ${line};padding:9px 40px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700;font-size:9.5px;letter-spacing:1.8px;text-transform:uppercase;color:${accentDeep}">Shop The Store</div>
          <div style="font-weight:800;font-size:15px;text-transform:uppercase;color:${ink}">${_esc(url)}</div>
          <div style="font-size:11px;color:${sub};margin-top:1px">Questions? hello@nationalsportsapparel.com</div>
        </div>
        <div style="text-align:center;flex-shrink:0">
          <img src="${_qrImg(url, 160)}" alt="QR" width="64" height="64" style="border:2px solid ${ink};border-radius:5px;display:block"/>
          <div style="font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:${sub};margin-top:3px">Scan To Shop</div>
        </div>
      </div>
      <div style="background:${ink};padding:6px 40px;display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.5)">
        <span>National Sports Apparel &middot; Orange, CA &middot; Since 2009</span>
        <span>Authorized Dealer &middot; Adidas &middot; Under Armour &middot; Rawlings</span>
      </div>
    </div>
  </div>
  ${p2Items.length > 0 ? `<!-- PAGE 2 -->
  <div class="page">
    <div style="background:${ink};color:rgba(255,255,255,.85);padding:9px 40px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;letter-spacing:1.6px;text-transform:uppercase">
      <span><span style="color:${accent}">&#9733;</span> ${_esc(store.name)}</span>
      <span style="color:rgba(255,255,255,.62)">Page 2 &middot; More Gear</span>
    </div>
    <div style="padding:22px 40px 80px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><h2 style="font-weight:800;font-size:28px;text-transform:uppercase;margin:0;color:${ink}">Also Available</h2><div style="flex:1;height:3px;background:${accent};transform:skewX(-12deg)"></div></div>
      ${grid(p2Items.slice(0, 16), 150)}
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;background:${ink};padding:9px 40px;display:flex;justify-content:space-between;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.5)">
      <span>National Sports Apparel &middot; Orange, CA &middot; Since 2009</span>
      <span>${_esc(url)}</span>
    </div>
  </div>` : ''}
  </body></html>`;
}

// Generate a branded PDF flyer (jsPDF, client-side) for email attachment or download.
async function generateFlyerPdfBase64(store, items = []) {
  const { jsPDF } = await import('jspdf');
  const url = _storefrontUrl(store);
  const primary = _hex(store.primary_color, '#0b1f3a');
  const accent = _hex(store.accent_color, '#e11d2a');
  const closeDate = _fmtDate(store.close_at);
  const delivLabel = _deliveryLabel(store);
  const hexRgb = (hex) => { const h = (_hex(hex,'#000000')).replace('#',''); return [parseInt(h.substr(0,2),16),parseInt(h.substr(2,2),16),parseInt(h.substr(4,2),16)]; };
  const [pr,pg,pb] = hexRgb(primary);
  const [ar,ag,ab] = hexRgb(accent);
  const INK = [22,34,63];
  const doc = new jsPDF({ unit:'pt', format:'letter', orientation:'portrait' });
  const W = 612, H = 792;
  let y = 0;
  // Top strip
  doc.setFillColor(...INK); doc.rect(0,0,W,24,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(ar,ag,ab);
  doc.text('★ OFFICIAL TEAM STORE', 20, 16);
  doc.setFont('helvetica','normal'); doc.setTextColor(190,190,190);
  doc.text('POWERED BY NATIONAL SPORTS APPAREL', W-20, 16, {align:'right'});
  y = 24;
  // Hero band
  doc.setFillColor(pr,pg,pb); doc.rect(0,y,W,148,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(ar,ag,ab);
  doc.text(store.name.toUpperCase(), W/2, y+22, {align:'center'});
  doc.setFontSize(30); doc.setTextColor(255,255,255);
  doc.text('THE TEAM STORE IS', W/2, y+60, {align:'center'});
  doc.setFontSize(42); doc.setTextColor(ar,ag,ab);
  doc.text('NOW OPEN', W/2, y+104, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(230,230,230);
  doc.text("Order your player's official, custom-decorated gear. Ships to the team.", W/2, y+128, {align:'center'});
  y += 148;
  // Stats strip
  doc.setFillColor(...INK); doc.rect(0,y,W,44,'F');
  [['ORDER BY',closeDate||'Open Now'],['DELIVERY',delivLabel],['MINIMUMS','None']].forEach(([lbl,val],i)=>{
    const cx = W/6 + (W/3)*i;
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(ar,ag,ab); doc.text(lbl,cx,y+14,{align:'center'});
    doc.setFontSize(13); doc.setTextColor(255,255,255); doc.text(val.toUpperCase(),cx,y+31,{align:'center'});
  });
  doc.setDrawColor(80,90,110); doc.setLineWidth(0.4);
  doc.line(W/3,y+6,W/3,y+40); doc.line(2*W/3,y+6,2*W/3,y+40);
  y += 44;
  // Items — the Player Pack (bundle) gets a highlighted band; the rest fill the grid.
  // Inactive items (active===false) are bundle components, surfaced via the band only.
  const pkg = (items||[]).find((i)=>i.active!==false && (i.kind==='bundle' || i.is_bundle_parent) && Number(i.retail_price)>0);
  const pkgImgs = (pkg && pkg._componentImages && pkg._componentImages.length)
    ? pkg._componentImages.slice(0, 4)
    : ((pkg && pkg.image_front_url) ? [pkg.image_front_url] : ((items||[]).filter((i)=>i.active===false && i.image_front_url).map((i)=>i.image_front_url).slice(0, 4)));
  const visItems = (items||[]).filter((i)=>!i.is_bundle_parent && i.active!==false && i.kind!=='bundle').slice(0,8);
  // Pre-load product images (best-effort, CORS permitting), including the package images.
  const imgCache = {};
  await Promise.all([...visItems, ...pkgImgs.map((u)=>({image_front_url: u}))].map(async (item) => {
    if (!item.image_front_url) return;
    try {
      const resp = await fetch(item.image_front_url);
      const blob = await resp.blob();
      imgCache[item.image_front_url] = await new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(blob); });
    } catch(_) {}
  }));
  const addImg = (b64, x, iy, w, h) => { try { const fmt=b64.startsWith('data:image/png')?'PNG':b64.startsWith('data:image/webp')?'WEBP':'JPEG'; doc.addImage(b64,fmt,x,iy,w,h,'','FAST'); return true; } catch(_) { return false; } };
  // Player Pack highlight band
  if (pkg) {
    y += 14;
    const bh = 88;
    doc.setFillColor(pr,pg,pb); doc.setDrawColor(ar,ag,ab); doc.setLineWidth(1.5); doc.roundedRect(40,y,W-80,bh,6,6,'FD');
    let tx = 54;
    if (pkgImgs.length) {
      const bx=48, by=y+8, bw=72, bhh=bh-16;
      doc.setFillColor(255,255,255); doc.roundedRect(bx,by,bw,bhh,4,4,'F');
      if (pkgImgs.length === 1) { const b=imgCache[pkgImgs[0]]; if (b) addImg(b, bx+4, by+4, bw-8, bhh-8); }
      else { const cols=2, rows=Math.ceil(pkgImgs.length/2), cw=(bw-6)/cols, ch=(bhh-6)/rows; pkgImgs.forEach((u,k)=>{ const b=imgCache[u]; if(!b) return; const cx=bx+3+(k%2)*cw, cy=by+3+Math.floor(k/2)*ch; addImg(b, cx+1, cy+1, cw-2, ch-2); }); }
      tx = 132;
    }
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(ar,ag,ab); doc.text('REQUIRED FOR EVERY PLAYER', tx, y+20);
    doc.setFontSize(20); doc.setTextColor(255,255,255);
    const pn=doc.splitTextToSize((pkg.name || pkg.display_name || 'Player Pack').toUpperCase(), W-80-tx-110); doc.text(pn[0], tx, y+42);
    if (pn[1]) { doc.setFontSize(14); doc.text(pn[1], tx, y+58); }
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(225,228,235); doc.text('Everything your player needs in one bundle.', tx, y+72);
    doc.setFont('helvetica','bold'); doc.setFontSize(30); doc.setTextColor(255,255,255); doc.text('$'+Math.round(Number(pkg.retail_price)), W-52, y+44, {align:'right'});
    doc.setFontSize(7.5); doc.setTextColor(ar,ag,ab); doc.text('COMPLETE PACK', W-52, y+58, {align:'right'});
    y += bh;
  }
  if (visItems.length > 0) {
    y += 16;
    doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(...INK);
    doc.text("WHAT'S IN THE STORE", 40, y);
    doc.setFillColor(ar,ag,ab); doc.rect(doc.getTextWidth("WHAT'S IN THE STORE")+50,y-5,W-doc.getTextWidth("WHAT'S IN THE STORE")-70,3,'F');
    y += 12;
    // Image fills the card; price floats as a pill over the bottom-left corner.
    const GAP=8, colW=(W-80-GAP*3)/4, cardH=pkg?100:128;
    visItems.forEach((item,idx)=>{
      const col=idx%4, row=Math.floor(idx/4), x=40+col*(colW+GAP), iy=y+row*(cardH+GAP);
      doc.setFillColor(255,255,255); doc.setDrawColor(231,223,208); doc.setLineWidth(0.4); doc.roundedRect(x,iy,colW,cardH,4,4,'FD');
      const b64=imgCache[item.image_front_url];
      if(!(b64 && addImg(b64,x+5,iy+5,colW-10,cardH-10))){ doc.setFillColor(235,231,224); doc.rect(x+5,iy+5,colW-10,cardH-10,'F'); }
      if(item.retail_price){
        const lbl='$'+Math.round(Number(item.retail_price));
        doc.setFont('helvetica','bold'); doc.setFontSize(11); const tw=doc.getTextWidth(lbl);
        doc.setFillColor(ar,ag,ab); doc.roundedRect(x+6, iy+cardH-21, tw+12, 16, 8, 8, 'F');
        doc.setTextColor(255,255,255); doc.text(lbl, x+6+(tw+12)/2, iy+cardH-10, {align:'center'});
      }
    });
    y += Math.ceil(visItems.length/4)*(cardH+GAP)+14;
  } else if (!pkg) {
    // Fallback: How To Order steps (mirrors the HTML flyer)
    y += 20;
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...INK);
    doc.text('HOW TO ORDER', 40, y);
    doc.setFillColor(ar,ag,ab); doc.rect(40+doc.getTextWidth('HOW TO ORDER')+12,y-5,W-40-doc.getTextWidth('HOW TO ORDER')-52,3,'F');
    y += 22;
    const closeDate2 = _fmtDate(store.close_at);
    [['1','Visit the store','Scan the QR code or visit the link below to open the store.'],['2','Pick sizes & gear','Browse all items and choose sizes for each player.'],['3','Check out',`Place your order${closeDate2?' before '+closeDate2:''}. Gear ships to the team ~4–5 weeks after close.`]].forEach(([num,title,body])=>{
      doc.setFillColor(pr,pg,pb); doc.circle(54,y+6,9,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255); doc.text(num,54,y+10,{align:'center'});
      doc.setTextColor(...INK); doc.setFontSize(13); doc.text(title.toUpperCase(),70,y+10);
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(100,116,139);
      const bl=doc.splitTextToSize(body,W-120); doc.text(bl,70,y+22);
      y += 52;
    });
    y += 10;
  }
  // QR
  y = Math.max(y, H-250);
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(...INK);
  doc.text('SCAN TO SHOP', W/2, y, {align:'center'});
  y += 10;
  try {
    const qrResp = await fetch(_qrImg(url, 200));
    const qrBlob = await qrResp.blob();
    const qrB64 = await new Promise((resolve)=>{ const r=new FileReader(); r.onloadend=()=>resolve(r.result); r.readAsDataURL(qrBlob); });
    doc.addImage(qrB64,'PNG',W/2-70,y,140,140);
  } catch(_){ /* skip if network fails */ }
  y += 150;
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(100,116,139);
  doc.text(url, W/2, y, {align:'center'});
  // Footer
  doc.setFillColor(...INK); doc.rect(0,H-50,W,50,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(255,255,255);
  doc.text('NATIONAL SPORTS APPAREL', W/2, H-29, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(160,160,160);
  doc.text("California's Largest Independent Team Dealer  ·  Since 2009", W/2, H-13, {align:'center'});
  return doc.output('datauristring').split(',')[1];
}

// Load a store's catalog shaped for the flyer/PDF: resolves each item's display
// name and front image (store mockup → master product photo), and KEEPS inactive
// items (bundle components) so the flyer can surface the package's hero image.
// webstore_products has no image_front_url column — it's image_url here.
async function loadFlyerItems(store) {
  // NOTE: webstore_products has NO is_bundle_parent column — selecting it 400s the whole query
  // (which silently emptied the flyer). Bundles are detected by kind==='bundle' below.
  const { data: cat } = await supabase.from('webstore_products')
    .select('id,display_name,retail_price,image_url,product_id,kind,active')
    .eq('store_id', store.id).order('sort_order');
  const rows = cat || [];
  const pids = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
  const meta = {};
  if (pids.length) {
    const { data: pr } = await supabase.from('products').select('id,name,image_front_url').in('id', pids);
    (pr || []).forEach((p) => { meta[p.id] = p; });
  }
  const items = rows.map((r) => ({
    ...r,
    name: r.display_name || (r.product_id && meta[r.product_id]?.name) || 'Item',
    image_front_url: r.image_url || (r.product_id && meta[r.product_id]?.image_front_url) || null,
  }));
  // Attach each package's component images so the flyer can show the full pack.
  const bundleIds = items.filter((i) => i.kind === 'bundle' || i.is_bundle_parent).map((i) => i.id);
  if (bundleIds.length) {
    const { data: bis } = await supabase.from('webstore_bundle_items').select('bundle_id,webstore_product_id,sort_order').in('bundle_id', bundleIds);
    attachBundleImages(items, bis || []);
  }
  return items;
}

// Attach a `_componentImages` array (the pack's member photos) to each bundle parent,
// resolved from the catalog by the bundle_items join. De-duped, in pack order.
function attachBundleImages(items, bundleItems) {
  const byId = {}; items.forEach((i) => { byId[i.id] = i; });
  const imgOf = (it) => (it && (it.image_url || it.image_front_url)) || '';
  items.forEach((p) => {
    if (p.kind !== 'bundle' && !p.is_bundle_parent) return;
    const comps = (bundleItems || []).filter((bi) => bi.bundle_id === p.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const imgs = [];
    comps.forEach((bi) => { const u = imgOf(byId[bi.webstore_product_id]); if (u && !imgs.includes(u)) imgs.push(u); });
    if (imgs.length) p._componentImages = imgs;
  });
  return items;
}

function Webstores({ cust = [], REPS = [], repCsr = [], sos = [], ests = [], cu, onCreateSO, onOpenSO }) {
  const [stores, setStores] = useState([]);
  // Live snapshot of in-memory orders/estimates so the detail loader can aggregate the
  // customer's full art library (their saved art + every art file off their SOs/ests),
  // the same sources as the customer's Artwork tab — without re-querying.
  const _live = useRef({});
  _live.current = { sos, ests };
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('catalog');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(null);   // null | 'new' | storeObj (settings edit)
  const [toast, setToast] = useState(null);
  const [wsSettings, setWsSettings] = useState(null); // global webstore defaults (singleton)
  const [showDefaults, setShowDefaults] = useState(false);
  const [soPrompt, setSoPrompt] = useState(null); // { orders[], shortagesFor(selIds), proceed(overrides, selIds, batchMeta) } for the Create-SO modal
  const [storeStats, setStoreStats] = useState({});
  // Applying an item template outside the store-detail view (Templates page):
  const [pendingStartTpl, setPendingStartTpl] = useState(null); // template to load into the store being created
  const [pickStoreForTpl, setPickStoreForTpl] = useState(null); // template awaiting an existing-store pick
  const [tplColorFlow, setTplColorFlow] = useState(null);       // { tpl, storeId, existingPids, store } → color selector

  // "Create from OMG" — the single unified entry point for turning an OMG report link into a
  // Club Webstore. Self-contained here (no dependency on the OMG Stores shadow-tracking tables):
  // 'link' = paste-URL step, 'review' = editable SKU/price/name table before the store is created.
  const [omgStep, setOmgStep] = useState(null); // null | 'link' | 'review'
  const [omgUrl, setOmgUrl] = useState('');
  const [omgFetching, setOmgFetching] = useState(false);
  const [omgItems, setOmgItems] = useState([]); // [{sku,name,color,sizes,retail,image_url,manufacturer,cost,vendor_id,_cost_source,product_id,_removed,_resolving}]
  const [omgName, setOmgName] = useState('');
  const [omgCustomerId, setOmgCustomerId] = useState('');
  const [omgStock, setOmgStock] = useState(null); // Map from fetchStockMap, keyed by product_id | 'omgtmp:'+i
  const [omgPrefill, setOmgPrefill] = useState(null); // { name, customer_id } → carried into the New Store settings form
  const [omgVendList, setOmgVendList] = useState([]); // cached at fetch time, reused on per-row SKU re-resolve
  const [omgMomentecDiscount, setOmgMomentecDiscount] = useState(0.15);

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); }, []);

  const custName = useCallback((id) => cust.find((c) => c.id === id)?.name || '—', [cust]);
  const repName = useCallback((id) => REPS.find((r) => r.id === id)?.name || '—', [REPS]);

  // Read-only coach/director portal link for a store's club (keyed on alpha_tag).
  const coachPortalUrl = useCallback((store) => {
    const c = cust.find((x) => x.id === store?.customer_id);
    const tag = c?.alpha_tag || c?.name || '';
    return tag ? `${PUBLIC_SITE}/coach?portal=${encodeURIComponent(tag)}` : '';
  }, [cust]);

  // Send the family-facing launch email with PDF flyer attached.
  // emailOverride lets the EmailStoreLinkModal specify a different recipient.
  const emailDirector = useCallback(async (store, emailOverride) => {
    const to = (emailOverride || store.director_email || store.coach_contact_email || '').trim();
    if (!to) { flash("Add a coach/director email in the store's Settings first"); return; }
    flash('Generating flyer PDF…');
    const items = await loadFlyerItems(store);
    let attachment;
    try { const b64 = await generateFlyerPdfBase64(store, items); attachment = [{ content: b64, name: `${store.slug||'team-store'}-flyer.pdf` }]; } catch(_) {}
    const r = await sendBrevoEmail({ to: [{ email: to, name: store.director_name || '' }], subject: `Your team store is live: ${store.name}`, htmlContent: launchEmailHtml(store, coachPortalUrl(store)), senderName: 'National Sports Apparel', senderEmail: 'noreply@nationalsportsapparel.com', ...(attachment ? { attachment } : {}) });
    if (r && r.error) flash('Email failed: ' + r.error);
    else flash('Store link emailed to ' + to + (attachment ? ' with PDF flyer' : ''));
  }, [coachPortalUrl, flash]);

  // Open the print-ready flyer in its own tab.
  const openFlyer = useCallback((store, items = []) => {
    const w = window.open('', '_blank');
    if (!w) { flash('Allow pop-ups to open the flyer.'); return; }
    w.document.write(flyerHtml(store, items)); w.document.close();
  }, [flash]);

  const loadStores = useCallback(async () => {
    setLoading(true); setErr(null); setNeedsMigration(false);
    const { data, error } = await supabase.from('webstores').select('*').eq('source', 'webstore').order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) setNeedsMigration(true); else setErr(error.message);
      setStores([]);
    } else {
      setStores((data || []).filter((s) => s.source !== 'omg' && !s.omg_sale_code));
      // Fetch per-store aggregate stats. Exclude abandoned card carts
      // (pending_payment — created before Stripe confirms) and cancelled orders,
      // which would otherwise inflate every store's Gross Sales and order count.
      const { data: aggOrders } = await supabase.from('webstore_orders').select('store_id, total, status, refunded_amt');
      const stats = {};
      (aggOrders || []).filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled').forEach((o) => {
        if (!stats[o.store_id]) stats[o.store_id] = { revenue: 0, orders: 0 };
        stats[o.store_id].revenue += Math.max(0, (Number(o.total) || 0) - (Number(o.refunded_amt) || 0));
        stats[o.store_id].orders += 1;
      });
      setStoreStats(stats);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  // Global webstore defaults (standard categories, checkout copy, default add-on options).
  const loadWsSettings = useCallback(async () => {
    const { data } = await supabase.from('webstore_settings').select('*').eq('id', 1).maybeSingle();
    setWsSettings(data || { standard_categories: [], checkout_message: '', default_options: [] });
  }, []);
  useEffect(() => { loadWsSettings(); }, [loadWsSettings]);
  const saveWsSettings = useCallback(async (patch, opts = {}) => {
    const next = { id: 1, standard_categories: [], checkout_message: '', default_options: [], ...(wsSettings || {}), ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('webstore_settings').upsert(next, { onConflict: 'id' });
    if (error) { if (!opts.quiet) flash('Error: ' + error.message); return false; }
    setWsSettings(next); if (!opts.quiet) flash('Store defaults saved'); return true;
  }, [wsSettings, flash]);
  // Placement memory: remember the last-used logo placement per garment TYPE (a hoodie's
  // left chest sits differently than a tee's), shared by all reps. Written quietly on
  // every Art-tab apply; read to seed the next placement.
  const savePlacementMemory = useCallback((patch) => {
    if (!patch || !Object.keys(patch).length) return;
    saveWsSettings({ placement_memory: { ...((wsSettings && wsSettings.placement_memory) || {}), ...patch } }, { quiet: true });
  }, [wsSettings, saveWsSettings]);

  const loadDetail = useCallback(async (store) => {
    setDetailLoading(true);
    const sid = store.id;
    const [catRes, bundleRes, stockRes, ordRes, itemRes, rosterRes, claimRes, transferRes, couponRes] = await Promise.all([
      supabase.from('webstore_products').select('*').eq('store_id', sid).order('sort_order'),
      supabase.from('webstore_bundle_items').select('*').order('sort_order'),
      supabase.from('webstore_storefront_products').select('webstore_product_id,product_id,size_stock,on_order_qty,earliest_eta,vendor_size_stock,vendor_on_hand,available_sizes,vendor_eta,vendor_size_eta,name,color,category,image_front_url').eq('store_id', sid),
      supabase.from('webstore_orders').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
      supabase.from('webstore_order_items').select('*'),
      supabase.from('webstore_roster').select('*').eq('store_id', sid).order('player_name'),
      supabase.from('webstore_number_claims').select('*').eq('store_id', sid).order('player_number'),
      supabase.from('webstore_transfers').select('*').eq('store_id', sid).order('kind').order('code'),
      supabase.from('webstore_coupons').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
    ]);
    const catalog = catRes.data || [];
    // Cost per product (for staff margin at review). Clearance items cost less.
    const pidList = [...new Set(catalog.map((c) => c.product_id).filter(Boolean))];
    const costByPid = {};
    const imgFrontByPid = {};
    const imgBackByPid = {};
    const invSrcByPid = {}; // product_id -> inventory_source ('manual' = custom / not stock-tracked)
    if (pidList.length) {
      const { data: costRows } = await supabase.from('products').select('id,nsa_cost,is_clearance,clearance_cost,image_front_url,image_back_url,inventory_source').in('id', pidList);
      for (const cp of costRows || []) {
        const cc = (cp.is_clearance && cp.clearance_cost != null) ? Number(cp.clearance_cost) : Number(cp.nsa_cost);
        costByPid[cp.id] = Number.isFinite(cc) ? cc : null;
        if (cp.image_front_url) imgFrontByPid[cp.id] = cp.image_front_url;
        if (cp.image_back_url) imgBackByPid[cp.id] = cp.image_back_url;
        invSrcByPid[cp.id] = cp.inventory_source || null;
      }
    }
    const catIds = new Set(catalog.map((c) => c.id));
    const orders = ordRes.data || [];
    const orderIds = new Set(orders.map((o) => o.id));
    const stockByWp = {}; (stockRes.data || []).forEach((s) => { stockByWp[s.webstore_product_id] = s; });
    // The storefront snapshot doesn't carry back images — fall back to the master product's
    // image_back_url so the editor's Back tab (and mockups) show it without a manual upload.
    catalog.forEach((c) => { const back = c.product_id && imgBackByPid[c.product_id]; if (!back) return; const s = stockByWp[c.id]; if (s) { if (!s.image_back_url) s.image_back_url = back; } else { stockByWp[c.id] = { image_back_url: back }; } });
    // Same for front image — if the store item has no custom mockup, use the master product photo.
    catalog.forEach((c) => { if (!c.image_front_url && c.product_id && imgFrontByPid[c.product_id]) c.image_front_url = imgFrontByPid[c.product_id]; });
    // Customer art LIBRARY — the SAME sources as the customer's Artwork tab: the team's
    // + parent org's saved art_files, PLUS every art file off their sales orders &
    // estimates (assembled in memory — that's where most file-backed art lives, which is
    // why reading only customers.art_files showed just one). De-duped by id; archived out.
    let libraryArt = [];
    let storeColors = [];
    if (store.customer_id) {
      const { data: cust } = await supabase.from('customers').select('id,parent_id,art_files,alpha_tag,name,pantone_colors').eq('id', store.customer_id).maybeSingle();
      let par = null;
      if (cust?.parent_id) {
        const { data: p } = await supabase.from('customers').select('id,art_files,alpha_tag,name,pantone_colors').eq('id', cust.parent_id).maybeSingle();
        par = p;
      }
      const { sos: allSos, ests: allEsts } = _live.current;
      const byName = new Map(); const acc = [];
      // De-dupe by name (the same logo recurs across orders with different ids); keep the
      // copy that actually has a PNG/SVG preview.
      const addArt = (a, label, srcCustId) => {
        if (!a || !a.id || a.archived) return;
        const key = (a.name || a.id).trim().toLowerCase();
        const rec = { ...a, _srcLabel: label, _srcCustId: srcCustId };
        const idx = byName.get(key);
        if (idx == null) { byName.set(key, acc.length); acc.push(rec); return; }
        if (artImgUrl(a) && !artImgUrl(acc[idx])) acc[idx] = rec;
      };
      (cust?.art_files || []).forEach((a) => addArt(a, 'Team library', cust.id));
      (par?.art_files || []).forEach((a) => addArt(a, (par.alpha_tag || par.name || 'Parent') + ' library', par.id));
      (allSos || []).filter((s) => s.customer_id === store.customer_id).forEach((so) => (so.art_files || []).forEach((a) => addArt(a, so.id, store.customer_id)));
      (allEsts || []).filter((e) => e.customer_id === store.customer_id).forEach((e) => (e.art_files || []).forEach((a) => addArt(a, e.id, store.customer_id)));
      libraryArt = acc;
      // Store palette (child's pantone, falling back to the parent org's) drives the
      // picker's default "school colors" filter.
      storeColors = (cust?.pantone_colors && cust.pantone_colors.length) ? cust.pantone_colors : (par?.pantone_colors || []);
    }
    setDetail({
      catalog,
      costByPid,
      invSrcByPid,
      bundleItems: (bundleRes.data || []).filter((b) => catIds.has(b.bundle_id)),
      stockByWp,
      orders,
      orderItems: (itemRes.data || []).filter((i) => orderIds.has(i.order_id)),
      roster: rosterRes.data || [],
      claims: claimRes.data || [],
      transfers: transferRes.data || [],
      coupons: couponRes.data || [],
      libraryArt,
      storeColors,
    });
    setDetailLoading(false);
    // Lazy AI cleanup of Adidas spec-dump descriptions for the items used in this store.
    // Fire-and-forget: the function rewrites only Adidas items not yet cleaned and saves
    // the result, so the clean copy is reused on the storefront and in future stores.
    // No-op until ANTHROPIC_API_KEY is configured in Netlify.
    try {
      const _pids = [...new Set(catalog.map((c) => c.product_id).filter(Boolean))];
      if (_pids.length) authFetch('/.netlify/functions/ai-clean-description', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_ids: _pids }) }).catch(() => {});
    } catch (e) { /* background best-effort */ }
  }, []);

  const openStore = useCallback(async (store) => {
    setSel(store); setTab('catalog'); setDetail(null);
    await loadDetail(store);
  }, [loadDetail]);

  // Deep-link: the store-closed email's "Process the store" button (and any
  // ?pg=webstores&store=<id> link) lands here. Once the store list is loaded, open that
  // store's page, then strip the param so a refresh / back-nav doesn't re-trigger it.
  const _deepLinked = useRef(false);
  useEffect(() => {
    if (_deepLinked.current || loading || !stores.length) return;
    let id = null;
    try { id = new URLSearchParams(window.location.search).get('store'); } catch { /* */ }
    if (!id) return;
    _deepLinked.current = true;
    const store = stores.find((s) => s.id === id);
    if (store) openStore(store);
    try { const u = new URL(window.location); u.searchParams.delete('store'); window.history.replaceState({}, '', u); } catch { /* */ }
  }, [stores, loading, openStore]);

  // ── writes ──────────────────────────────────────────────────────────
  // When a store is launched, email the coach/director the polished launch email
  // (shop link + scannable QR + key info + their tracking portal).
  const notifyCoachPublished = useCallback(async (store) => {
    const to = (store.coach_contact_email || store.director_email || '').trim();
    if (!to) { flash('Launched (no coach/director email on file to notify).'); return; }
    try {
      const items = await loadFlyerItems(store);
      let attachment;
      try { const b64 = await generateFlyerPdfBase64(store, items); attachment = [{ content: b64, name: `${store.slug||'team-store'}-flyer.pdf` }]; } catch(_) {}
      await sendBrevoEmail({ to: [{ email: to, name: store.director_name || '' }], subject: `Your team store is live: ${store.name}`, htmlContent: launchEmailHtml(store, coachPortalUrl(store)), senderName: 'National Sports Apparel', senderEmail: 'noreply@nationalsportsapparel.com', ...(attachment ? { attachment } : {}) });
      flash('Launched — family flyer emailed' + (attachment ? ' with PDF attachment' : '') + '.');
    } catch (e) { flash('Launched (coach email failed: ' + (e.message || e) + ').'); }
  }, [coachPortalUrl, flash]);

  // On a manual close, trigger the server handler that creates a rep to-do and emails the
  // rep + assigned CSR a breakdown of the closed store. The scheduled webstore-close-sweep
  // does the same for stores that close automatically on their schedule; both are idempotent
  // (closed_notified_at) so a store is processed once.
  const notifyStoreClosed = useCallback(async (store) => {
    flash('Store closed');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const r = await fetch('/.netlify/functions/webstore-closed-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ store_id: store.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.notified) flash('Store closed — rep notified + to-do created');
    } catch (e) { /* close already succeeded; the to-do/email is best-effort here */ }
  }, [flash]);

  const saveStore = useCallback(async (form, existingId) => {
    if (existingId) {
      const prevStore = stores.find((s) => s.id === existingId);
      const { data, error } = await supabase.from('webstores').update({ ...form, updated_at: new Date().toISOString() }).eq('id', existingId).select().single();
      if (error) return { error };
      setStores((prev) => prev.map((s) => (s.id === existingId ? data : s)));
      if (sel?.id === existingId) setSel(data);
      if (prevStore && prevStore.status !== 'open' && data.status === 'open' && data.created_via === 'coach') notifyCoachPublished(data);
      flash('Store saved'); return { data };
    }
    // New store — webstores.slug is UNIQUE, so guarantee a free one up front. A name that collides
    // with an existing store (e.g. re-importing the same OMG report, or two similarly-named teams)
    // auto-suffixes (-2, -3…) instead of failing the insert with a raw constraint error.
    const baseSlug = (form.slug || slugify(form.name) || 'team-store').slice(0, 60) || 'team-store';
    let form2 = form;
    try {
      const { data: ex } = await supabase.from('webstores').select('slug').ilike('slug', baseSlug + '%');
      const taken = new Set((ex || []).map((r) => r.slug));
      let slug = baseSlug;
      if (taken.has(slug)) { let n = 2; while (taken.has(`${baseSlug}-${n}`)) n++; slug = `${baseSlug}-${n}`; }
      if (slug !== form.slug) form2 = { ...form, slug };
    } catch (_) { /* fall through — the retry below still guards the constraint */ }
    let { data, error } = await supabase.from('webstores').insert(form2).select().single();
    // Race fallback: another create claimed the slug between the check and the insert.
    if (error && /slug/i.test(error.message || '') && /duplicate|unique/i.test(error.message || '')) {
      form2 = { ...form2, slug: `${baseSlug}-${Date.now().toString(36).slice(-4)}` };
      ({ data, error } = await supabase.from('webstores').insert(form2).select().single());
    }
    if (error) return { error };
    setStores((prev) => [data, ...prev]);
    flash(data.slug !== form.slug ? `Store created · URL set to /shop/${data.slug}` : 'Store created');
    return { data };
  }, [sel, flash, stores, notifyCoachPublished]);

  // ── "Create from OMG" — the one place to turn a shared OMG report link into a Club Webstore.
  // Self-contained (no dependency on the OMG Stores shadow-tracking tables): fetch → parse →
  // resolve each SKU against the catalog/supplier APIs → review (edit name/price/SKU, drop items,
  // check live stock) → create. Mirrors the OMG Stores section's own SKU resolution chain so a
  // corrected SKU here behaves identically to everywhere else in the app.
  const _omgSkuInvalid = (sku) => {
    const s = String(sku || '').trim();
    if (!s) return true;
    if (/[\/\\|,;]|\s/.test(s)) return true; // separators → compound / multi-token
    return false;
  };
  const _omgVendorCostSrc = (vendor = '') => ({ sanmar: 'sanmar', 's&s': 'ss', richardson: 'richardson', momentec: 'momentec' })[String(vendor).toLowerCase()] || 'api';
  // Manufacturer → NSA vendor (who we actually buy the blank from), for items an exact SKU
  // match didn't already resolve. Mirrors the OMG Stores section's own mapping.
  const _omgMfgToVendor = (mfg, vendList) => {
    if (!mfg) return null;
    const m = mfg.toLowerCase();
    const find = (re) => vendList.find((v) => re.test(v.name || ''))?.id || null;
    if (/comfort\s*colors|port\s*(&|and)\s*company|port\s*authority|sport-?tek|gildan|hanes|champion|district|cornerstone|allmade|rabbit\s*skins|jerzees/i.test(m)) return find(/sanmar/i);
    if (/independent\s*trading|next\s*level|bella\s*canvas|tultex|lat|american\s*apparel|alternative|econscious|threadfast/i.test(m)) return find(/s.s\s*active/i);
    if (/richardson/i.test(m)) return find(/richardson/i);
    if (/otto/i.test(m)) return find(/otto/i) || find(/s.s\s*active/i);
    if (/adidas/i.test(m)) return find(/adidas/i);
    if (/under\s*armou?r/i.test(m)) return find(/under\s*armou?r/i);
    if (/badger/i.test(m)) return find(/momentec/i);
    if (/momentec/i.test(m)) return find(/momentec/i);
    return null;
  };
  // Parse the raw OMG report JSON into flat product rows (name/sku/color/sizes/retail/image).
  // Pure — no DB or vendor calls.
  const _parseOmgReport = (report) => {
    const products = [];
    // Pull a SKU out of "Black/White (KB9093)" → KB9093. Requires a digit so a colour
    // descriptor like "(Solid)"/"(Heather)" is never mistaken for a style number.
    const extractSku = (str) => {
      const m = (str || '').match(/\(([A-Za-z0-9]{2,12})\)/);
      if (!m) return '';
      const tok = m[1];
      if (!/\d/.test(tok)) return '';
      return tok.toUpperCase();
    };
    // OMG appends an internal variant index, e.g. "KF5972 - 7" — the real catalog SKU is
    // the first whitespace-delimited token (NSA SKUs never contain a space).
    const cleanSku = (str) => ((str || '').trim().split(/\s+/)[0] || '').toUpperCase();
    (report.reports || []).forEach((r) => {
      (r.sections || []).forEach((section) => {
        const meta = section.meta || {};
        const rows = section.rows || [];
        const artworkList = meta.artwork || [];
        const sectionSku = meta.sku || '';
        const cleanSectionSku = cleanSku(sectionSku);
        const sectionSkuOk = cleanSectionSku && !cleanSectionSku.includes(' ') && cleanSectionSku.length <= 15;
        // One line per distinct colorway — colors sharing a style number can't be told
        // apart by SKU alone, so group by the per-row color SKU (falling back to color text).
        const groups = {};
        rows.forEach((row) => {
          const rawSz = (row.size || 'OS').trim().replace(/["''″]+$/, '');
          const sz = SZ_NORM[rawSz.toUpperCase()] || (/^adult\b/i.test(rawSz) ? 'OSFA' : rawSz);
          const qty = row.quantity || 0;
          const colorSku = extractSku(row.color);
          const rowColor = (row.color || '').trim();
          const rowSku = colorSku || (sectionSkuOk ? cleanSectionSku : '');
          const key = colorSku || rowColor || '__nosku__';
          if (!groups[key]) groups[key] = { sku: rowSku, sizes: {}, qty: 0, paid: 0, colors: new Set() };
          const g = groups[key];
          g.sizes[sz] = (g.sizes[sz] || 0) + qty;
          g.qty += qty;
          g.paid += (row.paid || 0);
          if (row.color) g.colors.add(row.color);
        });
        Object.values(groups).forEach((g) => {
          if (g.qty === 0) return; // no one ordered it
          let sku = g.sku;
          if (!sku) {
            const fromText = extractSku([...g.colors].join(' ') + ' ' + (meta.name || ''));
            sku = fromText || (sectionSkuOk ? cleanSectionSku : cleanSku(sectionSku));
          }
          // Prefer a COLOR match for the mockup (colors sharing a style number can't be
          // told apart by SKU), then a SKU match, then the section's first artwork.
          const _artText = (a) => `${a.caption || ''} ${a.color || ''} ${a.name || ''} ${a.label || ''}`.toUpperCase();
          const _colorUp = ([...g.colors][0] || '').toUpperCase();
          const matchedByColor = _colorUp ? artworkList.filter((a) => _artText(a).includes(_colorUp) || (a.color || '').toUpperCase() === _colorUp) : [];
          const matchedBySku = sku ? artworkList.filter((a) => _artText(a).includes(sku)) : [];
          const artForSku = matchedByColor.length ? matchedByColor : (matchedBySku.length ? matchedBySku : artworkList);
          const artwork = artForSku[0];
          products.push({
            sku, name: meta.name || '', manufacturer: meta.manufacturer || '', color: [...g.colors].join(', '),
            retail: meta.base_price || 0, sizes: g.sizes, image_url: artwork?.link || artwork?.thumbnail || '',
          });
        });
      });
    });
    return products;
  };
  // Resolve one item's SKU against the catalog, then (if still $0) the supplier APIs — the same
  // chain the OMG Stores SKU editor uses, so an edited SKU here re-sources identically.
  const _omgResolveOne = useCallback(async (p, vendList, momentecDiscount) => {
    const skuClean = (p.sku || '').trim().toUpperCase();
    if (!skuClean) return { ...p, sku: skuClean, product_id: null, vendor_id: null, cost: 0, _cost_source: '' };
    let product_id = null, vendor_id = null, cost = 0, _cost_source = '';
    const { data: rows } = await supabase.from('products').select('id,sku,brand,vendor_id,nsa_cost').ilike('sku', skuClean).limit(1);
    const catMatch = rows && rows[0];
    if (catMatch) {
      product_id = catMatch.id;
      if (catMatch.vendor_id) vendor_id = catMatch.vendor_id;
      const catCost = parseFloat(catMatch.nsa_cost) || 0;
      if (catCost > 0) { cost = catCost; _cost_source = 'catalog'; }
    }
    if (!vendor_id) vendor_id = _omgMfgToVendor(p.manufacturer, vendList);
    if (cost === 0) {
      const vendorName = (vendList.find((v) => v.id === vendor_id)?.name || p.manufacturer || '').toLowerCase();
      let hit = null;
      try {
        if (/richardson/i.test(vendorName)) hit = richardsonResolveSku(skuClean);
        else if (/sanmar/i.test(vendorName)) hit = await sanmarResolveSku(skuClean);
        else if (/s.?s\s*activ/i.test(vendorName)) hit = await ssResolveSku(skuClean);
        else if (/momentec/i.test(vendorName)) hit = await momentecResolveSku(skuClean, { discount: momentecDiscount });
        else hit = await resolveSkuAcrossVendors(skuClean);
      } catch (e) { /* API lookup miss — leave cost at 0, staff can enter manually */ }
      if (hit?.rate > 0) {
        cost = hit.rate; _cost_source = _omgVendorCostSrc(hit.vendor);
        const vid = vendList.find((v) => new RegExp(hit.vendor, 'i').test(v.name || ''))?.id;
        if (vid) vendor_id = vid;
      }
    }
    return { ...p, sku: skuClean, product_id, vendor_id, cost, _cost_source };
  }, []);

  // Step 1 → 2: fetch the OMG report, parse it, resolve every item's cost/vendor + live stock,
  // and hand off to the review table. Nothing is written to the database yet.
  const omgFetchReport = useCallback(async (urlRaw) => {
    const urlStr = (urlRaw || '').trim();
    const uuidMatch = urlStr.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (!uuidMatch) { flash('Invalid report URL — needs a valid OMG report link'); return; }
    setOmgFetching(true);
    try {
      const resp = await fetch(`/.netlify/functions/omg-report-proxy?id=${uuidMatch[1]}`);
      if (!resp.ok) throw new Error('Report fetch failed: ' + resp.status);
      const report = await resp.json();
      if (!report?.reports?.length) throw new Error('Report JSON has no data');
      const saleCode = report.options?.filter?.find((f) => f.key === 'sale_code')?.value || '';
      const storeName = report.details?.title || ('OMG Store ' + saleCode);
      const rawItems = _parseOmgReport(report);
      if (!rawItems.length) throw new Error('No items with sales found in this report');
      const { data: vendList } = await supabase.from('vendors').select('id,name,api_provider,api_price_discount');
      const vl = vendList || [];
      const discount = vl.find((v) => v.api_provider === 'momentec' || /momentec/i.test(v.name))?.api_price_discount ?? 0.15;
      setOmgVendList(vl); setOmgMomentecDiscount(discount);
      const resolved = await Promise.all(rawItems.map((p) => _omgResolveOne(p, vl, discount)));
      let stock = new Map();
      try { stock = await fetchStockMap(resolved.map((p, i) => ({ id: p.product_id || ('omgtmp:' + i), sku: p.sku }))); } catch { /* show without stock */ }
      setOmgItems(resolved.map((p) => ({ ...p, _included: true })));
      setOmgStock(stock);
      setOmgName(storeName);
      setOmgCustomerId('');
      setOmgStep('review');
    } catch (e) { flash('Failed: ' + e.message); } finally { setOmgFetching(false); }
  }, [flash, _omgResolveOne]);

  // A staff-edited SKU re-sources cost/vendor and re-checks live stock for that one row.
  const omgResolveRow = useCallback(async (index, newSku) => {
    const skuClean = (newSku || '').trim().toUpperCase();
    setOmgItems((prev) => prev.map((p, i) => (i === index ? { ...p, sku: skuClean, _resolving: true } : p)));
    const cur = omgItems[index];
    if (!cur) return;
    const resolved = await _omgResolveOne({ ...cur, sku: skuClean }, omgVendList, omgMomentecDiscount);
    setOmgItems((prev) => prev.map((p, i) => (i === index ? { ...resolved, _included: p._included, _resolving: false } : p)));
    try {
      const st = await fetchStockMap([{ id: resolved.product_id || ('omgtmp:' + index), sku: resolved.sku }]);
      const key = resolved.product_id || ('omgtmp:' + index);
      const hit = st.get(key);
      if (hit) setOmgStock((prevStock) => { const m = new Map(prevStock || []); m.set(key, hit); return m; });
    } catch { /* keep old stock display */ }
  }, [omgItems, omgVendList, omgMomentecDiscount, _omgResolveOne]);

  // Step 2 → don't create the store yet. Hand off to the SAME settings form "+ New Store" uses
  // (delivery, fundraising, coach contact, decoration mode, etc.), pre-filled with the reviewed
  // name/customer. The reviewed items stay staged in omgItems until that form is actually
  // submitted, so backing out of settings leaves nothing behind.
  const omgProceedToSettings = useCallback(() => {
    const included = omgItems.filter((p) => p._included !== false && (p.sku || p.name));
    if (!included.length) { flash('Select at least one item'); return; }
    setOmgPrefill({ name: (omgName || 'Team Store').trim() || 'Team Store', customer_id: omgCustomerId || '' });
    setOmgStep(null);
    setEditing('new');
  }, [omgItems, omgName, omgCustomerId, flash]);

  // Clears any items/prefill staged by the OMG wizard — called both when the review step is
  // cancelled outright and when the settings form itself is backed out of.
  const omgResetStaged = useCallback(() => {
    setOmgStep(null); setOmgUrl(''); setOmgItems([]); setOmgName(''); setOmgCustomerId(''); setOmgPrefill(null);
  }, []);

  // Settings form submitted → the store now exists with every setting the rep configured.
  // Add the reviewed items and queue in-house art (if a customer is linked), then open it.
  const omgFinishAfterSettings = useCallback(async (newStore) => {
    const included = omgItems.filter((p) => p._included !== false && (p.sku || p.name));
    const wsName = newStore.name || 'Team Store';
    const customerId = newStore.customer_id || null;
    // In-house art: the OMG mockup shows the finished garment, but OMG never hands over the real
    // production file. Queue one "needs file" record (art_id only, no art_url — the storefront
    // never composites a logo over the mockup) so it lands in the art queue instead of silently
    // looking done.
    let pendingArtId = null;
    if (customerId) {
      try {
        // status 'waiting_for_art' is the canonical "needs artist attention" state — it puts this
        // record in the customer Artwork Library's Waiting-for-Art queue and on the Art Dashboard,
        // so the separations request can't be missed. ('pending' isn't a real art status.)
        const rec = { id: 'logoomg' + Date.now() + Math.random().toString(36).slice(2, 6), name: wsName + ' — team art (attach production file)', kind: 'art', status: 'waiting_for_art', deco_type: 'screen_print', files: [], color_ways: [], uploaded: new Date().toLocaleDateString() };
        const { data: cRow } = await supabase.from('customers').select('art_files').eq('id', customerId).maybeSingle();
        const artArr = Array.isArray(cRow?.art_files) ? cRow.art_files : [];
        const { error: aErr } = await supabase.from('customers').update({ art_files: [...artArr, rec] }).eq('id', customerId);
        if (!aErr) { await supabase.from('webstores').update({ store_art: [{ ...rec, _srcLabel: 'From OMG import' }] }).eq('id', newStore.id); pendingArtId = rec.id; }
      } catch (e) { /* items still get created without the art queue */ }
    }
    let linked = 0;
    if (included.length) {
      const rows = included.map((p, i) => ({
        store_id: newStore.id, product_id: p.product_id || null, sku: p.sku || null, kind: 'single',
        display_name: (p.name || p.sku || 'Item').trim(), image_url: p.image_url || null,
        // Normalize the OMG report's size labels to catalog size codes ("Men's Small" → "S",
        // "Men's 3X-Large" → "3XL") so sizes_offered matches the product's scale — otherwise the
        // storefront filters every offered size out and an in-stock item reads "Sold out".
        retail_price: Number(p.retail) || 0, sizes_offered: Object.keys(p.sizes || {}).length ? foldScale(Object.keys(p.sizes).map(normSzName)) : null,
        sort_order: i, active: true,
        // Items come in with NO art linked. The old behavior blanket-stamped every item with the
        // placeholder team-art record, so the whole store read "Applied" before the rep chose
        // anything. Art is now applied deliberately in the Art tab (incl. "Bypass mocks" for OMG
        // stores whose images already show the decoration).
      }));
      const { error: pErr } = await supabase.from('webstore_products').insert(rows);
      if (pErr) { flash('Store created but items failed to add: ' + pErr.message); omgResetStaged(); await openStore(newStore); return; }
      linked = rows.filter((r2) => r2.product_id).length;
    }
    flash(`✓ ${wsName} created — ${included.length} item${included.length === 1 ? '' : 's'} (${linked} catalog-linked)${pendingArtId ? ' · in-house art queued' : ''}`);
    omgResetStaged();
    await openStore(newStore);
  }, [omgItems, openStore, flash, omgResetStaged]);

  // Launch / close a store from the detail view (the form no longer sets status —
  // a store is built as a draft, then launched when it's ready).
  const setStoreStatus = useCallback(async (store, status, opts = {}) => {
    const patch = { status, updated_at: new Date().toISOString() };
    // A coach email typed in the launch dialog is saved to the store so it's on file.
    const coachEmail = (opts.coachEmail || '').trim();
    if (status === 'open' && opts.emailCoach && coachEmail && coachEmail !== (store.coach_contact_email || '')) patch.coach_contact_email = coachEmail;
    const { data, error } = await supabase.from('webstores').update(patch).eq('id', store.id).select().single();
    if (error) { flash('Could not update status: ' + error.message); return; }
    setStores((prev) => prev.map((s) => (s.id === store.id ? data : s)));
    if (sel?.id === store.id) setSel(data);
    // Email the coach only when the launch dialog opted in (with a recipient).
    if (status === 'open' && opts.emailCoach && coachEmail) notifyCoachPublished({ ...data, coach_contact_email: coachEmail });
    // On a manual close, create the rep to-do + breakdown email (the sweep handles auto-closes).
    else if (store.status !== 'closed' && status === 'closed') notifyStoreClosed(data);
    else flash(status === 'open' ? "Store launched — it's live" : `Store ${status}`);
  }, [sel, flash, notifyCoachPublished, notifyStoreClosed]);

  const duplicateStore = useCallback(async (src, opts = {}) => {
    if (!window.confirm(`Duplicate "${src.name}"? This copies the catalog, packages and transfer setup into a new draft store (no orders).`)) return;
    // Unique slug: <slug>-copy, then -copy-2, -copy-3…
    const taken = new Set(stores.map((s) => s.slug));
    let slug = slugify(src.name) + '-copy';
    if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
    const { id, created_at, updated_at, ...rest } = src;
    const payload = { ...rest, name: src.name + (opts.suffix != null ? opts.suffix : ' (Copy)'), slug, status: 'draft', open_at: null, close_at: null, is_template: false, ...(opts.rebrand ? { logo_url: null } : {}) };
    flash('Duplicating store…');
    const { data: store, error } = await supabase.from('webstores').insert(payload).select().single();
    if (error) { flash('Could not duplicate: ' + error.message); return; }

    const { data: srcProducts } = await supabase.from('webstore_products').select('*').eq('store_id', src.id).order('sort_order');
    const idMap = {}; // old webstore_product id -> new id
    for (const p of (srcProducts || [])) {
      const { id: pid, created_at: pc, updated_at: pu, store_id, ...prest } = p;
      const { data: np, error: pe } = await supabase.from('webstore_products').insert({ ...prest, store_id: store.id }).select('id').single();
      if (pe) { flash('Catalog copy failed: ' + pe.message); break; }
      idMap[pid] = np.id;
    }
    const bundleIds = (srcProducts || []).filter((p) => p.kind === 'bundle').map((p) => p.id);
    if (bundleIds.length) {
      const { data: items } = await supabase.from('webstore_bundle_items').select('*').in('bundle_id', bundleIds);
      const rows = (items || []).map((it) => { const { id: iid, created_at: ic, updated_at: iu, bundle_id, ...irest } = it; return { ...irest, bundle_id: idMap[bundle_id] }; }).filter((r) => r.bundle_id);
      if (rows.length) { const { error: be } = await supabase.from('webstore_bundle_items').insert(rows); if (be) flash('Package items copy failed: ' + be.message); }
    }
    const { data: srcTransfers } = await supabase.from('webstore_transfers').select('*').eq('store_id', src.id);
    if ((srcTransfers || []).length) {
      const trows = srcTransfers.map((t) => { const { id: tid, created_at: tc, updated_at: tu, store_id, ...trest } = t; return { ...trest, store_id: store.id, on_hand: 0, incoming: 0, incoming_eta: null }; });
      const { error: te } = await supabase.from('webstore_transfers').insert(trows);
      if (te) flash('Transfer setup copy failed: ' + te.message);
    }
    setStores((prev) => [store, ...prev]);
    flash(opts.suffix === '' ? 'New store created from template (draft)' : 'Store duplicated as a draft');
    // "Clone & rebrand" lands you straight in settings to set the new customer/colors/logo.
    if (opts.rebrand) setEditing(store);
  }, [stores, flash]);

  // Mark / unmark a store as a reusable template — the starting point for
  // "New from template", which clones it into a fresh draft via duplicateStore.
  const toggleTemplate = useCallback(async (store) => {
    const next = !store.is_template;
    const { error } = await supabase.from('webstores').update({ is_template: next, updated_at: new Date().toISOString() }).eq('id', store.id);
    if (error) { flash('Error: ' + error.message); return; }
    setStores((prev) => prev.map((s) => s.id === store.id ? { ...s, is_template: next } : s));
    flash(next ? 'Saved as a template' : 'Removed from templates');
  }, [flash]);

  // Pull a batch's transfers: deduct physical on-hand by the counts used and
  // flag the batch's orders as pulled (they move from On order → In process).
  const pullBatchTransfers = useCallback(async (soId, neededByCode) => {
    const list = detail?.transfers || [];
    for (const t of list) {
      const need = neededByCode[t.code];
      if (need) await supabase.from('webstore_transfers').update({ on_hand: Math.max(0, (t.on_hand || 0) - need) }).eq('id', t.id);
    }
    const { error } = await supabase.from('webstore_orders').update({ transfers_pulled: true, transfers_pulled_at: new Date().toISOString() }).eq('store_id', sel.id).eq('so_id', soId);
    if (error) { flash('Pull failed: ' + error.message); return; }
    flash('Transfers pulled — moved to In process'); loadDetail(sel);
  }, [detail, sel, flash, loadDetail]);

  const addSingle = useCallback(async ({ product, price, fundraise, image_url, takes_number, takes_name, name_upcharge, transfer_codes, num_transfer_sets, decorations, category, kit_name, required, options }) => {
    // Seed the global default add-on options (Store defaults) when none were set on the item.
    const opts = (Array.isArray(options) && options.length) ? options : (Array.isArray(wsSettings?.default_options) ? wsSettings.default_options : []);
    const row = { store_id: sel.id, kind: 'single', product_id: product.id, sku: product.sku, retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, image_url: image_url || null, takes_number: !!takes_number, takes_name: !!takes_name, name_upcharge: Number(name_upcharge) || 0, transfer_codes: transfer_codes || [], num_transfer_sets: takes_number ? (num_transfer_sets || []) : [], decorations: decorations || [], category: category || null, kit_name: kit_name || null, required: !!required, options: opts, active: true, sort_order: (detail?.catalog?.length || 0) };
    const { error } = await supabase.from('webstore_products').insert(row);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Added ' + (product.name || product.sku)); loadDetail(sel);
  }, [sel, detail, wsSettings, flash, loadDetail]);

  // Add more colors of the same garment as options ON one card (not new cards).
  // Each color stays its own SKU/row — so per-color stock, the order line, and POs
  // all keep working — but the rows share variant_group_id (= the primary's id), so
  // the builder and storefront group them into a single item with a color picker.
  const addColorsToItem = useCallback(async (primary, colorProducts, shared = {}) => {
    if (!primary?.id || !Array.isArray(colorProducts) || !colorProducts.length) return;
    const groupId = primary.variant_group_id || primary.id;
    const base = (detail?.catalog?.length || 0);
    const takesNum = shared.takes_number != null ? shared.takes_number : primary.takes_number;
    const rows = colorProducts.map((p, i) => ({
      store_id: sel.id, kind: 'single', product_id: p.id, sku: p.sku,
      retail_price: Number(shared.price != null ? shared.price : primary.retail_price) || 0,
      fundraise_amount: Number(shared.fundraise != null ? shared.fundraise : primary.fundraise_amount) || 0,
      image_url: null,
      takes_number: !!takesNum,
      takes_name: !!(shared.takes_name != null ? shared.takes_name : primary.takes_name),
      name_upcharge: Number(shared.name_upcharge != null ? shared.name_upcharge : primary.name_upcharge) || 0,
      transfer_codes: shared.transfer_codes || primary.transfer_codes || [],
      num_transfer_sets: takesNum ? (shared.num_transfer_sets || primary.num_transfer_sets || []) : [],
      decorations: shared.decorations || primary.decorations || [],
      category: (shared.category != null ? shared.category : primary.category) || null,
      kit_name: (shared.kit_name != null ? shared.kit_name : primary.kit_name) || null,
      required: !!(shared.required != null ? shared.required : primary.required),
      options: Array.isArray(primary.options) ? primary.options : [],
      active: true, sort_order: base + i, variant_group_id: groupId,
    }));
    const ops = [supabase.from('webstore_products').insert(rows)];
    if (!primary.variant_group_id) ops.push(supabase.from('webstore_products').update({ variant_group_id: groupId }).eq('id', primary.id));
    const results = await Promise.all(ops);
    const e = results.find((r) => r.error);
    if (e?.error) { flash('Error: ' + e.error.message); return; }
    flash(`Added ${rows.length} color${rows.length === 1 ? '' : 's'}`); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  // Add a fit/gender variant (Adult/Women's/Youth) as an option ON one card. Like
  // colors each fit is its own SKU/row sharing variant_group_id, but it carries a
  // variant_label and the storefront shows all fits' sizes at once (no picker) on
  // the primary's shared image. fitItems = [{ product, label }].
  const addFitsToItem = useCallback(async (primary, fitItems) => {
    if (!primary?.id || !Array.isArray(fitItems) || !fitItems.length) return;
    const groupId = primary.variant_group_id || primary.id;
    const base = (detail?.catalog?.length || 0);
    const rows = fitItems.map((f, i) => ({
      store_id: sel.id, kind: 'single', product_id: f.product.id, sku: f.product.sku,
      retail_price: Number(primary.retail_price) || 0,
      fundraise_amount: Number(primary.fundraise_amount) || 0,
      image_url: null, variant_label: (f.label || '').trim() || null,
      takes_number: !!primary.takes_number, takes_name: !!primary.takes_name,
      name_upcharge: Number(primary.name_upcharge) || 0,
      transfer_codes: primary.transfer_codes || [],
      num_transfer_sets: primary.takes_number ? (primary.num_transfer_sets || []) : [],
      decorations: primary.decorations || [],
      category: primary.category || null, kit_name: primary.kit_name || null,
      required: !!primary.required, options: Array.isArray(primary.options) ? primary.options : [],
      active: true, sort_order: base + i, variant_group_id: groupId,
    }));
    const ops = [supabase.from('webstore_products').insert(rows)];
    // The primary is now part of a fit group — give it a label too (default it to
    // Adult so the storefront's stacked rows all read cleanly) and the group id.
    const primaryPatch = {};
    if (!primary.variant_group_id) primaryPatch.variant_group_id = groupId;
    if (!primary.variant_label) primaryPatch.variant_label = 'Adult';
    if (Object.keys(primaryPatch).length) ops.push(supabase.from('webstore_products').update(primaryPatch).eq('id', primary.id));
    const results = await Promise.all(ops);
    const e = results.find((r) => r.error);
    if (e?.error) { flash('Error: ' + e.error.message); return; }
    flash(`Added ${rows.length} fit${rows.length === 1 ? '' : 's'}`); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  // Explicit "copy to a new item": clone a row as its own standalone card
  // (variant_group_id cleared) for when a separate card really is wanted.
  const copyToNewItem = useCallback(async (row) => {
    if (!row?.id) return;
    const clone = {
      store_id: sel.id, kind: row.kind || 'single', product_id: row.product_id, sku: row.sku,
      retail_price: Number(row.retail_price) || 0, fundraise_amount: Number(row.fundraise_amount) || 0,
      image_url: row.image_url || null, image_back_url: row.image_back_url || null,
      takes_number: !!row.takes_number, takes_name: !!row.takes_name, name_upcharge: Number(row.name_upcharge) || 0,
      transfer_codes: row.transfer_codes || [], num_transfer_sets: row.num_transfer_sets || [],
      decorations: row.decorations || [], category: row.category || null, kit_name: row.kit_name || null,
      required: !!row.required, options: Array.isArray(row.options) ? row.options : [],
      display_name: row.display_name || null, active: true, sort_order: (detail?.catalog?.length || 0), variant_group_id: null,
    };
    const { error } = await supabase.from('webstore_products').insert(clone);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Copied to a new item'); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  // Bulk import from a sales rep's spreadsheet — one insert + one reload (vs. addSingle per
  // row). Each row is { product, price, fundraise, category, kit_name, required } already
  // matched to a product. Returns { added }.
  const addManyFromList = useCallback(async (rows) => {
    if (!sel?.id || !rows?.length) return { added: 0 };
    const base = (detail?.catalog?.length || 0);
    const defOpts = Array.isArray(wsSettings?.default_options) ? wsSettings.default_options : [];
    const payload = rows.map((r, i) => ({
      store_id: sel.id, kind: 'single', product_id: r.product.id, sku: r.product.sku,
      retail_price: Number(r.price) || 0, fundraise_amount: Number(r.fundraise) || 0,
      image_url: null, takes_number: false, takes_name: false, name_upcharge: 0,
      transfer_codes: [], num_transfer_sets: [], decorations: [],
      category: r.category || null, kit_name: r.kit_name || null, required: !!r.required,
      options: defOpts, active: true, sort_order: base + i,
    }));
    const { error } = await supabase.from('webstore_products').insert(payload);
    if (error) { flash('Import error: ' + error.message); return { added: 0, error: error.message }; }
    flash(`Imported ${payload.length} item${payload.length === 1 ? '' : 's'}`); loadDetail(sel);
    return { added: payload.length };
  }, [sel, detail, wsSettings, flash, loadDetail]);

  // Apply a saved template — resolve its SKUs to live products and add the ones not already
  // in this store (carrying the template's category / price / fundraising / kit). A SECTION
  // template (kind='section') drops every item into one named section/category instead.
  const applyTemplate = useCallback(async (tpl) => {
    const sectionCat = (tpl && tpl.kind === 'section') ? (tpl.section || tpl.name || null) : null;
    const items = Array.isArray(tpl?.items) ? tpl.items : [];
    const skus = [...new Set(items.map((i) => i.sku).filter(Boolean))];
    if (!skus.length) { flash('That template has no items'); return { added: 0 }; }
    const variants = [...new Set(skus.flatMap((s) => [s, s.toUpperCase(), s.toLowerCase()]))];
    const found = [];
    for (let i = 0; i < variants.length; i += 150) {
      const { data } = await supabase.from('products').select('id,sku,name,retail_price').in('sku', variants.slice(i, i + 150));
      if (data) found.push(...data);
    }
    const byKey = new Map(); found.forEach((p) => { const k = String(p.sku || '').trim().toUpperCase(); if (!byKey.has(k)) byKey.set(k, p); });
    const existing = new Set((detail?.catalog || []).map((c) => c.product_id).filter(Boolean));
    const seen = new Set();
    const rows = items.map((it) => {
      const product = byKey.get(String(it.sku || '').trim().toUpperCase());
      if (!product || existing.has(product.id) || seen.has(product.id)) return null;
      seen.add(product.id);
      return { product, price: (it.price != null && it.price !== '') ? it.price : product.retail_price, fundraise: it.fundraise || 0, category: sectionCat || it.category || null, kit_name: it.kit || null, required: !!it.required };
    }).filter(Boolean);
    if (!rows.length) { flash("All of this template's items are already in the store"); return { added: 0 }; }
    return addManyFromList(rows);
  }, [detail, flash, addManyFromList]);

  // Apply a template AFTER the rep picks which colors of each style to bring in (template
  // color-picker). plan = [{ products:[{id,sku,retail_price}], price, fundraise, category,
  // kit_name, required }]; each group's picked colors fold into ONE multi-color card (shared
  // variant_group_id = the primary row's id). Colors already in the store are skipped.
  // Core insert: fold a color-picker plan into an arbitrary store (used by both the in-store
  // "Add template" flow and the Templates-page "Start a store / Add to a store" flows).
  // `existingIds` are product_ids already in the store (skipped). `startSort` seeds sort_order.
  const applyTemplateColorsTo = useCallback(async (storeId, plan, existingIds, startSort = 0) => {
    if (!storeId || !Array.isArray(plan)) return { added: 0 };
    const existing = existingIds instanceof Set ? new Set(existingIds) : new Set(existingIds || []);
    let base = startSort;
    let added = 0;
    const defOpts = Array.isArray(wsSettings?.default_options) ? wsSettings.default_options : [];
    const mk = (p, grp, groupId) => ({ store_id: storeId, kind: 'single', product_id: p.id, sku: p.sku,
      retail_price: (grp.price != null && grp.price !== '') ? Number(grp.price) : (Number(p.retail_price) || 0),
      fundraise_amount: Number(grp.fundraise) || 0, image_url: null, takes_number: false, takes_name: false, name_upcharge: 0,
      transfer_codes: [], num_transfer_sets: [], decorations: [], category: grp.category || null, kit_name: grp.kit_name || null,
      required: !!grp.required, options: defOpts, active: true, sort_order: base++, ...(groupId ? { variant_group_id: groupId } : {}) });
    for (const grp of plan) {
      const cols = (grp.products || []).filter((p) => p && p.id && !existing.has(p.id));
      if (!cols.length) continue;
      const [primary, ...rest] = cols;
      if (rest.length) {
        const { data: pr, error: e1 } = await supabase.from('webstore_products').insert(mk(primary, grp, null)).select('id').single();
        if (e1 || !pr) { flash('Import error: ' + (e1?.message || '')); continue; }
        await supabase.from('webstore_products').update({ variant_group_id: pr.id }).eq('id', pr.id);
        const { error: e2 } = await supabase.from('webstore_products').insert(rest.map((p) => mk(p, grp, pr.id)));
        if (e2) flash('Import error: ' + e2.message);
        added += 1 + rest.length;
      } else {
        const { error: e0 } = await supabase.from('webstore_products').insert(mk(primary, grp, null));
        if (e0) { flash('Import error: ' + e0.message); continue; }
        added += 1;
      }
      cols.forEach((p) => existing.add(p.id));
    }
    return { added };
  }, [wsSettings, flash]);

  const applyTemplateColors = useCallback(async (plan) => {
    if (!sel?.id || !Array.isArray(plan)) return { added: 0 };
    const existing = new Set((detail?.catalog || []).map((c) => c.product_id).filter(Boolean));
    const { added } = await applyTemplateColorsTo(sel.id, plan, existing, detail?.catalog?.length || 0);
    flash(added ? `Added ${added} item${added === 1 ? '' : 's'}` : 'Those colors are already in the store'); loadDetail(sel);
    return { added };
  }, [sel, detail, flash, loadDetail, applyTemplateColorsTo]);

  // Templates-page flows — a template can START a new store or be ADDED to an existing one.
  // Both open the built-in garment color selector so the rep picks which colorways (adidas,
  // SanMar / S&S, Momentec, Richardson, …) of each style to bring in.
  const beginTplColorFlow = useCallback(async (tpl, store) => {
    const { data } = await supabase.from('webstore_products').select('product_id').eq('store_id', store.id);
    const existingPids = new Set((data || []).map((r) => r.product_id).filter(Boolean));
    setTplColorFlow({ tpl, storeId: store.id, existingPids, store, startSort: (data || []).length });
  }, []);
  const startStoreFromTemplate = useCallback((tpl) => { setPendingStartTpl(tpl); setEditing('new'); }, []);
  const finishTplColorFlow = useCallback(async (plan) => {
    const flow = tplColorFlow; if (!flow) return;
    const { added } = await applyTemplateColorsTo(flow.storeId, plan, flow.existingPids, flow.startSort || 0);
    setTplColorFlow(null);
    flash(added ? `Added ${added} item${added === 1 ? '' : 's'} to ${flow.store?.name || 'the store'}` : 'Those colors are already in the store');
    if (flow.store) openStore(flow.store);
  }, [tplColorFlow, applyTemplateColorsTo, flash, openStore]);

  const updateImage = useCallback(async (id, url) => {
    const { error } = await supabase.from('webstore_products').update({ image_url: url || null }).eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    flash(url ? 'Image updated' : 'Image removed'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // Edit the item's base cost. Cost lives on the catalog product (products.nsa_cost) and
  // drives the margin readout, so this updates it wherever the product is used — fine for
  // the custom/manual items reps create here. Reloads so costByPid (and margins) refresh.
  const updateProductCost = useCallback(async (productId, cost) => {
    if (!productId) return;
    const v = (cost === '' || cost == null) ? null : Number(cost);
    if (v != null && !Number.isFinite(v)) { flash('Enter a valid cost'); return; }
    const { error } = await supabase.from('products').update({ nsa_cost: v }).eq('id', productId);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Cost updated'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // Edit the catalog product's vendor (who a PO is cut to) and/or SKU. SKU also syncs onto
  // this product's webstore rows so stock & vendor lookups (matched by sku) stay aligned.
  const updateProductMeta = useCallback(async (productId, fields) => {
    if (!productId || !fields) return;
    const clean = {};
    if (fields.vendor_id !== undefined) clean.vendor_id = fields.vendor_id || null;
    if (fields.sku !== undefined) clean.sku = (fields.sku || '').trim().toUpperCase() || null;
    if (!Object.keys(clean).length) return;
    const { error } = await supabase.from('products').update(clean).eq('id', productId);
    if (error) { flash('Error: ' + error.message); return; }
    if (fields.sku !== undefined && clean.sku) await supabase.from('webstore_products').update({ sku: clean.sku }).eq('product_id', productId);
    flash('Product updated'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  const updateCatalogItem = useCallback(async (id, fields) => {
    const { data: _updated, error } = await supabase.from('webstore_products').update(fields).eq('id', id).select('id');
    if (error) { flash('Error: ' + error.message); return false; }
    // A silent 0-row update means RLS blocked the write (e.g. this login isn't a
    // registered team member). Surface it — otherwise the editor flashes "Saved ✓"
    // while the change never reached the database.
    if (!_updated || _updated.length === 0) { flash('Not saved — your login doesn’t have edit access. Ask an admin to add you as a team member.'); return false; }
    // Decorations (incl. per-color web-logo overrides) are a card-level concern: when a
    // multi-color card's art changes, push the same decorations to every color row in the
    // group so the storefront and order handoff render the right logo for each color.
    // Decorations and the inventory-tracking choice are card-level: fan them out to every
    // color row in the group so all colorways behave the same on the storefront.
    const groupFields = {};
    if (Object.prototype.hasOwnProperty.call(fields, 'decorations')) groupFields.decorations = fields.decorations;
    if (Object.prototype.hasOwnProperty.call(fields, 'track_inventory')) groupFields.track_inventory = fields.track_inventory;
    if (Object.prototype.hasOwnProperty.call(fields, 'size_skus')) groupFields.size_skus = fields.size_skus;
    if (Object.keys(groupFields).length) {
      const cat = detail?.catalog || [];
      const me = cat.find((c) => c.id === id);
      const groupKey = me ? (me.variant_group_id || me.id) : null;
      const groupIds = groupKey ? cat.filter((c) => (c.variant_group_id || c.id) === groupKey && c.id !== id).map((c) => c.id) : [];
      if (groupIds.length) await supabase.from('webstore_products').update(groupFields).in('id', groupIds);
    }
    // When takes_number / takes_name changes, push the new value to any bundle items that
    // snapshot these flags at the time the item was added to the package.
    const personalizationUpdate = {};
    if (Object.prototype.hasOwnProperty.call(fields, 'takes_number')) personalizationUpdate.takes_number = fields.takes_number;
    if (Object.prototype.hasOwnProperty.call(fields, 'takes_name')) personalizationUpdate.takes_name = fields.takes_name;
    if (Object.keys(personalizationUpdate).length) {
      await supabase.from('webstore_bundle_items').update(personalizationUpdate).eq('webstore_product_id', id);
    }
    // When retail_price changes, recalculate the price of any bundles that contain this item.
    if (Object.prototype.hasOwnProperty.call(fields, 'retail_price')) {
      const allBundleItems = detail?.bundleItems || [];
      const cat = detail?.catalog || [];
      const affectedBundleIds = [...new Set(
        allBundleItems.filter((bi) => bi.webstore_product_id === id).map((bi) => bi.bundle_id)
      )];
      for (const bundleId of affectedBundleIds) {
        const comps = allBundleItems.filter((bi) => bi.bundle_id === bundleId);
        let total = 0;
        for (const comp of comps) {
          if (comp.webstore_product_id === id) {
            total += Number(fields.retail_price) || 0;
          } else {
            const compItem = cat.find((c) => c.id === comp.webstore_product_id);
            total += compItem ? (Number(compItem.retail_price) || 0) : 0;
          }
        }
        await supabase.from('webstore_products').update({ retail_price: total }).eq('id', bundleId);
      }
    }
    flash('Item updated'); loadDetail(sel);
    return true;
  }, [sel, detail, flash, loadDetail]);

  // Bulk-edit catalog items. Accepts rows of { id, fields }; identical patches are
  // collapsed into one update so price/category/availability changes hit in a few
  // queries, while a per-item patch (e.g. % fundraising) still works. One reload.
  const bulkUpdateItems = useCallback(async (rows) => {
    const list = (rows || []).filter((r) => r && r.id && r.fields);
    if (!list.length) return 0;
    const groups = new Map();
    for (const r of list) { const k = JSON.stringify(r.fields); if (!groups.has(k)) groups.set(k, { fields: r.fields, ids: [] }); groups.get(k).ids.push(r.id); }
    let n = 0;
    for (const { fields, ids } of groups.values()) {
      const { error } = await supabase.from('webstore_products').update(fields).in('id', ids);
      if (error) { flash('Bulk update failed: ' + error.message); loadDetail(sel); return n; }
      n += ids.length;
    }
    flash(`Updated ${n} item${n === 1 ? '' : 's'}`); loadDetail(sel);
    return n;
  }, [sel, flash, loadDetail]);

  // Reprice every single (with a known cost) to a target margin: price = trueCost / (1 - m),
  // where trueCost = garment cost + ~$5 decoration when the item is decorated. One reload.
  const priceAllToMargin = useCallback(async (pct) => {
    const m = Math.max(0, Math.min(90, Number(pct) || 0)) / 100;
    const cat = detail?.catalog || []; const costs = detail?.costByPid || {};
    const updates = [];
    for (const c of cat) {
      if (c.kind === 'bundle') continue;
      const cost = costs[c.product_id]; if (cost == null) continue;
      const trueCost = Number(cost) + ((Array.isArray(c.decorations) && c.decorations.length) ? 5 : 0);
      const price = Math.max(0, Math.ceil(trueCost / (1 - m)));
      if (price !== Number(c.retail_price)) updates.push({ id: c.id, price });
    }
    if (!updates.length) { flash('Nothing to reprice (need items with a cost on file).'); return; }
    for (const u of updates) { await supabase.from('webstore_products').update({ retail_price: u.price }).eq('id', u.id); }
    flash(`Repriced ${updates.length} item${updates.length === 1 ? '' : 's'} to ~${Math.round(m * 100)}% margin`);
    loadDetail(sel);
  }, [detail, sel, flash, loadDetail]);

  // ── Logo & Art Studio ──
  // Save a recolored logo variant back onto the owning customer's art-library
  // record (customers.art_files[].variants) so it's reusable on future store and
  // order mockups — keyed by a color label, de-duped on re-save.
  const saveArtVariant = useCallback(async (customerId, artId, variant) => {
    if (!customerId || !artId) return null;
    const { data: cust } = await supabase.from('customers').select('art_files').eq('id', customerId).maybeSingle();
    const arts = Array.isArray(cust?.art_files) ? cust.art_files : [];
    const next = arts.map((a) => {
      if (a.id !== artId) return a;
      const variants = Array.isArray(a.variants) ? a.variants : [];
      const rest = variants.filter((v) => (v.label || '').toLowerCase() !== (variant.label || '').toLowerCase());
      return { ...a, variants: [...rest, variant] };
    });
    const { error } = await supabase.from('customers').update({ art_files: next }).eq('id', customerId);
    if (error) { flash('Could not save variant: ' + error.message); return null; }
    flash('Logo variant saved to library'); loadDetail(sel);
    return variant;
  }, [sel, flash, loadDetail]);

  // Save Quick Mock Builder output for a store: (1) merge the mocks/files/scenes
  // back onto the customer's shared art library (so order mockups can reuse them),
  // and (2) set each store item's image to its baked mock so the storefront shows it.
  const saveStoreMocks = useCallback(async ({ mocksByGarment, filesByLocation, sceneByGarment }, artList) => {
    const _u = (f) => typeof f === 'string' ? f : (f?.url || '');
    // Only arts actually placed (a scene carries their _layerId) or that gained new
    // source files get the mocks — and each is written back to ITS OWN customer
    // (the store's customer for own art, the parent for inherited art).
    const placed = new Set();
    Object.values(sceneByGarment || {}).forEach((objs) => (objs || []).forEach((o) => { if (o && o._layerId) placed.add(o._layerId); }));
    Object.keys(filesByLocation || {}).forEach((id) => placed.add(id));
    const custOf = {}; (artList || []).forEach((a) => { custOf[a.id] = a._srcCustId; });
    const byCust = {};
    placed.forEach((id) => { const cid = custOf[id]; if (cid) (byCust[cid] = byCust[cid] || []).push(id); });
    for (const [cid, ids] of Object.entries(byCust)) {
      const { data: cust } = await supabase.from('customers').select('art_files').eq('id', cid).maybeSingle();
      const arts = Array.isArray(cust?.art_files) ? cust.art_files : [];
      const next = arts.map((a) => {
        if (!ids.includes(a.id)) return a;
        const upd = { ...a };
        const locFiles = (filesByLocation || {})[a.id] || [];
        if (locFiles.length) { const have = new Set((a.files || []).map(_u)); upd.files = [...(a.files || []), ...locFiles.filter((f) => !have.has(_u(f)))]; }
        const im = {}; Object.entries(mocksByGarment || {}).forEach(([k, arr]) => { if (arr && arr.length) im[k] = arr.map((m) => ({ ...m, art_file_id: a.id })); });
        if (Object.keys(im).length) upd.item_mockups = { ...(a.item_mockups || {}), ...im };
        if (sceneByGarment && Object.keys(sceneByGarment).length) upd.qm_scenes = { ...(a.qm_scenes || {}), ...sceneByGarment };
        return upd;
      });
      const { error } = await supabase.from('customers').update({ art_files: next }).eq('id', cid);
      if (error) flash('Could not save to library: ' + error.message);
    }
    const cat = detail?.catalog || []; const sbw = detail?.stockByWp || {};
    let applied = 0;
    for (const [key, arr] of Object.entries(mocksByGarment || {})) {
      if (!arr || !arr.length) continue;
      const sep = key.indexOf('|'); const sku = sep >= 0 ? key.slice(0, sep) : key; const color = sep >= 0 ? key.slice(sep + 1) : '';
      const front = arr.find((m) => !m.side || m.side === 'front') || arr[0];
      if (!front || !front.url) continue;
      const item = cat.find((c) => c.sku === sku && (sbw[c.id]?.color || '') === color) || cat.find((c) => c.sku === sku);
      // The baked mock becomes the item image. Don't DROP the placed art — the store→SO
      // conversion reads webstore_products.decorations to build the production art lines,
      // so clearing them left production with a "no decoration" line for a garment that
      // clearly shows a logo. Instead mark each art decoration `baked: true`: the storefront
      // skips the CSS overlay for baked decorations (the logo is already in the image, so no
      // double-stamp), while the SO conversion still emits the art file + placement to print.
      if (item) {
        const prev = Array.isArray(item.decorations) ? item.decorations : [];
        const baked = prev.filter((d) => d && (d.art_url || d.art_id)).map((d) => ({ ...d, baked: true }));
        await supabase.from('webstore_products').update({ image_url: front.url, decorations: baked }).eq('id', item.id); applied++;
      }
    }
    flash(`Mockups saved to the library${applied ? ` and applied to ${applied} item${applied === 1 ? '' : 's'}` : ''}`);
    loadDetail(sel);
  }, [detail, sel, flash, loadDetail]);

  // Apply one decoration (a logo at a placement) to many items at once. Any
  // existing decoration at the same placement is replaced, so re-applying updates
  // in place rather than stacking duplicates.
  const applyLogoToItems = useCallback(async (itemIds, decoration) => {
    const cat = detail?.catalog || [];
    for (const id of itemIds) {
      const item = cat.find((c) => c.id === id);
      if (!item) continue;
      const existing = Array.isArray(item.decorations) ? item.decorations : [];
      // Replace every decoration on the SAME side, so re-applying a logo swaps it out
      // instead of leaving the old art stacked underneath (a back logo still leaves the
      // front intact, since it only clears its own side).
      const next = existing.filter((d) => (d.side || 'front') !== (decoration.side || 'front')).concat([decoration]);
      await supabase.from('webstore_products').update({ decorations: next }).eq('id', id);
    }
    flash(`Logo applied to ${itemIds.length} item${itemIds.length === 1 ? '' : 's'}`); loadDetail(sel);
  }, [detail, sel, flash, loadDetail]);

  // Bulk apply — each garment gets its OWN decoration (its per-garment placement +
  // color-way variant), written in one pass with a single flash/reload. entries:
  // [{ id, decoration }]. Like applyLogoToItems, replaces same-side decorations so a
  // re-apply swaps the logo instead of stacking. Used by the Art tab's apply grid.
  // Bulk apply — each entry carries the item's COMPLETE new decorations array (the Art
  // tab computes it: replace the logo on each side it's placing, preserve the other side
  // and personalization tokens). Written in one pass with a single flash/reload.
  const applyLogoBulk = useCallback(async (entries) => {
    let n = 0, fails = 0;
    for (const { id, decorations } of entries) {
      const { error } = await supabase.from('webstore_products').update({ decorations }).eq('id', id);
      if (error) fails += 1; else n += 1;
    }
    flash(fails ? `Logo applied to ${n} item${n === 1 ? '' : 's'} — ${fails} failed` : `Logo applied to ${n} item${n === 1 ? '' : 's'}`);
    loadDetail(sel);
    return n;
  }, [sel, flash, loadDetail]);

  const setItemDecorations = useCallback(async (itemId, decorations) => {
    const { error } = await supabase.from('webstore_products').update({ decorations }).eq('id', itemId);
    if (error) { flash('Error: ' + error.message); return; }
    loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // Save an uploaded logo into the store's customer art LIBRARY (customers.art_files)
  // so it's reusable on every item — and future stores — not just stamped on one
  // product. Returns the new art record (its id links the decoration to the library).
  const addStoreLogo = useCallback(async (url, name, opts = {}) => {
    if (!sel?.customer_id || !url) return null;
    const { data: cust } = await supabase.from('customers').select('art_files').eq('id', sel.customer_id).maybeSingle();
    const arr = Array.isArray(cust?.art_files) ? cust.art_files : [];
    // When a vector (.ai/.eps/.pdf) is rasterized, opts.sourceFile is the original art and
    // `url` is the web-ready PNG preview — keep both (source file + placeable preview).
    const base = { id: 'logo' + Date.now() + Math.random().toString(36).slice(2, 6), name: name || 'Store logo', files: [{ url: opts.sourceFile || url, name: name || 'logo' }], status: 'approved', deco_type: 'screen_print', uploaded: new Date().toLocaleDateString(), color_ways: [] };
    // Production source art (.ai/.eps/.pdf) with no preview stays source-only so the Art tab
    // asks for a placeable PNG/SVG instead of stamping the raw .ai url onto a garment.
    const rec = opts.source ? { ...base, kind: 'art' } : { ...base, preview_url: url, web_logo_url: url, kind: 'logo' };
    const { error } = await supabase.from('customers').update({ art_files: [...arr, rec] }).eq('id', sel.customer_id);
    if (error) { flash('Could not save logo: ' + error.message); return null; }
    // Also drop it into THIS store's curated art set so it's pickable on items now.
    const curArt = Array.isArray(sel.store_art) ? sel.store_art : [];
    const { data: st } = await supabase.from('webstores').update({ store_art: [...curArt, { ...rec, _srcLabel: 'Uploaded' }] }).eq('id', sel.id).select().single();
    if (st) { setStores((prev) => prev.map((s) => (s.id === sel.id ? st : s))); setSel(st); }
    flash('Logo added to the store'); loadDetail(sel);
    return rec;
  }, [sel, flash, loadDetail]);

  // Curate which art is in this store — the per-item logo picker draws from this set.
  const saveStoreArt = useCallback(async (nextArt) => {
    if (!sel) return;
    const { data: st, error } = await supabase.from('webstores').update({ store_art: nextArt || [] }).eq('id', sel.id).select().single();
    if (error) { flash('Could not update store art: ' + error.message); return; }
    setStores((prev) => prev.map((s) => (s.id === sel.id ? st : s)));
    setSel(st);
  }, [sel, flash]);

  // Attach a clean web-ready logo (transparent PNG/SVG) to a customer art record so it
  // can be PLACED on storefront garments and recolored. Production art (.ai source /
  // full-garment mockups) isn't usable for clean on-garment placement; this gives the
  // record a web cutout (web_logo_url). Written to the customer's master art_files so it's
  // one source of truth — carries to future stores AND to sales orders. If the art came
  // off an order/estimate and isn't in the library yet, it's promoted into it.
  const attachArtPreview = useCallback(async (art, url) => {
    if (!art || !url) return null;
    const custId = art._srcCustId || sel?.customer_id;
    if (!custId) { flash('No customer to attach the logo to'); return null; }
    const { data: cust } = await supabase.from('customers').select('art_files').eq('id', custId).maybeSingle();
    const arr = Array.isArray(cust?.art_files) ? cust.art_files : [];
    const nm = (art.name || '').trim().toLowerCase();
    const dt = art.deco_type || '';
    const idx = arr.findIndex((a) => a.id === art.id || (nm && (a.name || '').trim().toLowerCase() === nm && (a.deco_type || '') === dt));
    // Set BOTH the legacy single field and the "all garments (default)" entry of the
    // per-color-way web_logos[] model, so placement (which prefers web_logos[]) uses the
    // new cutout instead of ignoring it. Any per-CW entries already on the record are kept.
    const withWebLogo = (a) => {
      const wls = Array.isArray(a.web_logos) ? a.web_logos.filter((w) => w && w.url) : [];
      const di = wls.findIndex((w) => w.is_default || !((w.color_way || '').trim()));
      const web_logos = di >= 0 ? wls.map((w, i) => (i === di ? { ...w, url, is_default: true } : w)) : [{ url, color_way: '', is_default: true }, ...wls];
      // Re-key per-CW entries to their stable color_way_id while we're writing anyway.
      return { ...a, web_logo_url: url, web_logos: normalizeWebLogos(web_logos, a.color_ways) };
    };
    let next;
    if (idx >= 0) {
      next = arr.map((a, i) => (i === idx ? withWebLogo(a) : a));
    } else {
      next = [...arr, withWebLogo({ id: art.id, name: art.name || 'Logo', deco_type: art.deco_type || 'screen_print', color_ways: art.color_ways || [], files: art.files || [], mockup_files: art.mockup_files || [], kind: art.kind || 'art', status: art.status || 'approved', uploaded: new Date().toLocaleDateString() })];
    }
    const { error } = await supabase.from('customers').update({ art_files: next }).eq('id', custId);
    if (error) { flash('Could not attach web logo: ' + error.message); return null; }
    // Reflect on this store's curated set immediately if the record is in it.
    const curArt = Array.isArray(sel?.store_art) ? sel.store_art : [];
    if (curArt.some((a) => a.id === art.id)) {
      const nextStore = curArt.map((a) => (a.id === art.id ? withWebLogo(a) : a));
      const { data: st } = await supabase.from('webstores').update({ store_art: nextStore }).eq('id', sel.id).select().single();
      if (st) { setStores((prev) => prev.map((x) => (x.id === sel.id ? st : x))); setSel(st); }
    }
    flash('Web logo attached'); loadDetail(sel);
    return url;
  }, [sel, flash, loadDetail]);

  // Rep self-serve: promote a recolored cutout into a real per-color-way web logo, creating
  // the color way if the rep named a new one. Tagged source:'rep' so an artist can see it in
  // the art library and swap in a cleaner cutout for complex logos. cwName '' = all-garments.
  const saveRepWebLogo = useCallback(async (art, url, cwName) => {
    if (!art || !url) return null;
    const custId = art._srcCustId || sel?.customer_id;
    if (!custId) { flash('No customer to save the web logo to'); return null; }
    const { data: cust } = await supabase.from('customers').select('art_files').eq('id', custId).maybeSingle();
    const arr = Array.isArray(cust?.art_files) ? cust.art_files : [];
    const nm = (art.name || '').trim().toLowerCase();
    const dt = art.deco_type || '';
    const matches = (a) => a.id === art.id || (nm && (a.name || '').trim().toLowerCase() === nm && (a.deco_type || '') === dt);
    const label = String(cwName || '').trim();
    const withLogo = (a) => {
      const color_ways = Array.isArray(a.color_ways) ? [...a.color_ways] : [];
      // Resolve the target color way's stable id (create it, tagged rep-made, if new).
      let cwId = null;
      if (label) {
        const found = color_ways.find((c) => c && String(c.garment_color || '').trim().toLowerCase() === label.toLowerCase());
        if (found) cwId = found.id;
        else { cwId = 'cw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); color_ways.push({ id: cwId, garment_color: label, inks: [''], source: 'rep' }); }
      }
      // Replace the entry we're setting (matched by CW id OR label, so a renamed color way
      // never leaves a duplicate), keep the rest; empty label replaces only the default.
      const keep = (Array.isArray(a.web_logos) ? a.web_logos : []).filter((w) => {
        if (!w || !w.url) return false;
        const wl = String(w.color_way || '').trim().toLowerCase();
        return label ? (wl !== label.toLowerCase() && !(cwId && w.color_way_id === cwId)) : !(w.is_default || !wl);
      });
      const entry = label ? { url, color_way: label, color_way_id: cwId || undefined, source: 'rep' } : { url, color_way: '', is_default: true, source: 'rep' };
      const web_logos = normalizeWebLogos([...keep, entry], color_ways);
      const def = (web_logos.find((w) => w.is_default || !((w.color_way || '').trim())) || {}).url || a.web_logo_url || (label ? '' : url);
      return { ...a, color_ways, web_logos, web_logo_url: def };
    };
    const idx = arr.findIndex(matches);
    const next = idx >= 0 ? arr.map((a, i) => (i === idx ? withLogo(a) : a))
      : [...arr, withLogo({ id: art.id, name: art.name || 'Logo', deco_type: art.deco_type || 'screen_print', color_ways: art.color_ways || [], files: art.files || [], mockup_files: art.mockup_files || [], kind: art.kind || 'art', status: art.status || 'approved', uploaded: new Date().toLocaleDateString() })];
    const { error } = await supabase.from('customers').update({ art_files: next }).eq('id', custId);
    if (error) { flash('Could not save web logo: ' + error.message); return null; }
    const curArt = Array.isArray(sel?.store_art) ? sel.store_art : [];
    if (curArt.some(matches)) {
      const nextStore = curArt.map((a) => (matches(a) ? withLogo(a) : a));
      const { data: st } = await supabase.from('webstores').update({ store_art: nextStore }).eq('id', sel.id).select().single();
      if (st) { setStores((prev) => prev.map((x) => (x.id === sel.id ? st : x))); setSel(st); }
    }
    flash(label ? `Web logo saved for ${label}` : 'Web logo saved (all garments)'); loadDetail(sel);
    return url;
  }, [sel, flash, loadDetail]);

  const updateTransfer = useCallback(async (id, fields) => {
    const { error } = await supabase.from('webstore_transfers').update(fields).eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    setDetail((prev) => ({ ...prev, transfers: prev.transfers.map((t) => t.id === id ? { ...t, ...fields } : t) }));
  }, [flash]);

  const addTransfers = useCallback(async (rows) => {
    const payload = rows.map((r) => ({ store_id: sel.id, ...r }));
    const { error } = await supabase.from('webstore_transfers').insert(payload);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Transfer inventory added'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  const removeTransfer = useCallback(async (id) => {
    const { error } = await supabase.from('webstore_transfers').delete().eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // Generate `count` coupon codes (or insert a single explicit code).
  const createCoupons = useCallback(async ({ kind, value, count, single, prefix, batch_label, expires_at, code, cover_shipping }) => {
    const rand = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const rows = [];
    const n = code ? 1 : Math.max(1, Math.min(500, Number(count) || 1));
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      let c = code ? code.toUpperCase().trim() : `${(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}${rand()}`;
      while (seen.has(c)) c = `${(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}${rand()}`;
      seen.add(c);
      rows.push({ store_id: sel.id, code: c, kind, value: kind === 'percent' ? Number(value) || 0 : 0, max_uses: single ? 1 : null, batch_label: batch_label || null, expires_at: expires_at || null, cover_shipping: cover_shipping !== false, active: true });
    }
    const { data, error } = await supabase.from('webstore_coupons').insert(rows).select();
    if (error) { flash('Could not create codes: ' + error.message); return { error }; }
    flash(`Created ${rows.length} code${rows.length === 1 ? '' : 's'}`); loadDetail(sel);
    return { data };
  }, [sel, flash, loadDetail]);

  const updateCoupon = useCallback(async (id, fields) => {
    const { error } = await supabase.from('webstore_coupons').update(fields).eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    loadDetail(sel);
  }, [sel, flash, loadDetail]);

  const removeCoupon = useCallback(async (id) => {
    const { error } = await supabase.from('webstore_coupons').delete().eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // ── Roster: add players (each gets a unique link token), remove players ──
  // A url-safe 32-hex token per player backs /shop/<slug>?player=<token>. The DB
  // has a UNIQUE index on token, so a collision would surface as an insert error.
  const addRoster = useCallback(async (players) => {
    const tok = () => { try { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch { return (Math.random().toString(16) + Math.random().toString(16)).replace(/[^a-f0-9]/g, '').slice(0, 32); } };
    const normPos = (v) => { const s = String(v || '').trim().toLowerCase(); if (['gk', 'goalie', 'goalkeeper', 'keeper'].includes(s)) return 'gk'; if (['field', 'fielder', 'outfield', 'player'].includes(s)) return 'field'; return null; };
    const rows = (players || [])
      .map((p) => ({ player_name: String(p.player_name || '').trim(), player_number: String(p.player_number || '').trim() || null, parent_email: String(p.parent_email || '').trim() || null, position: normPos(p.position) }))
      .filter((p) => p.player_name)
      .map((p) => ({ ...p, store_id: sel.id, token: tok(), ordered: false }));
    if (!rows.length) { flash('Enter at least one player name.'); return { error: true }; }
    const { data, error } = await supabase.from('webstore_roster').insert(rows).select();
    if (error) { flash('Could not add players: ' + error.message); return { error }; }
    flash(`Added ${rows.length} player${rows.length === 1 ? '' : 's'}`); loadDetail(sel);
    return { data };
  }, [sel, flash, loadDetail]);

  const updateRoster = useCallback(async (id, fields) => {
    const { error } = await supabase.from('webstore_roster').update(fields).eq('id', id);
    if (error) { flash('Error: ' + error.message); return { error }; }
    loadDetail(sel);
    return {};
  }, [sel, flash, loadDetail]);

  const removeRoster = useCallback(async (id) => {
    const { error } = await supabase.from('webstore_roster').delete().eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // Email selected roster players their personal link (initial invite / resend).
  const inviteRoster = useCallback(async (playerIds) => {
    const ids = (playerIds || []).filter(Boolean);
    if (!ids.length) { flash('No players to email.'); return { error: true }; }
    try {
      const res = await fetch('/.netlify/functions/roster-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: sel.id, player_ids: ids }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { flash('Email failed: ' + (d.error || res.status)); return { error: true }; }
      const skipped = (d.skipped || []).length;
      flash(`Emailed ${d.sent} link${d.sent === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (no email)` : ''}`);
      loadDetail(sel);
      return { data: d };
    } catch (e) { flash('Email failed: ' + e.message); return { error: true }; }
  }, [sel, flash, loadDetail]);

  // Edit an order's line items (size/qty/remove), then recompute its totals.
  const saveOrderEdits = useCallback(async (order, edited) => {
    for (const it of edited) {
      if (it._removed) await supabase.from('webstore_order_items').delete().eq('id', it.id);
      else await supabase.from('webstore_order_items').update({ size: it.size || null, qty: Number(it.qty) || 1 }).eq('id', it.id);
    }
    // Recompute over ALL of the order's items, not just the edited (component) rows.
    // A bundle's price lives on its parent row (components are $0) and the parent is
    // never in the editable set — summing only `edited` would drop every package's
    // value and zero out the order's revenue and the club's fundraising payout.
    const editById = {}; edited.forEach((e) => { editById[e.id] = e; });
    const effective = (detail?.orderItems || []).filter((i) => i.order_id === order.id).map((i) => {
      const e = editById[i.id];
      if (!e) return i;                 // parents / untouched rows keep their stored price
      if (e._removed) return null;
      return { ...i, size: e.size, qty: Number(e.qty) || 1 };
    }).filter(Boolean);
    const round2 = (n) => Math.round(n * 100) / 100;
    const subtotal = round2(effective.reduce((a, i) => a + (Number(i.unit_price) || 0) * (Number(i.qty) || 1), 0));
    const fundraise = round2(effective.reduce((a, i) => a + (Number(i.unit_fundraise) || 0) * (Number(i.qty) || 1), 0));
    // Processing fee and sales tax are both levied on the product subtotal, so they scale
    // with it. Re-derive each from THIS order's own stored ratio (fee/subtotal, tax/subtotal)
    // and re-apply to the new subtotal: a size-only edit (subtotal unchanged) leaves the total
    // exactly as charged, while a qty/removal edit scales the fee + tax to match. Dropping
    // them — the old behavior — pushed the DB total below what the card actually paid and
    // broke the refund cap (which reads `total`). Mirrors webstore-checkout's preTax + tax.
    const oldSub = Number(order.subtotal) || 0;
    const processing = round2(oldSub > 0 ? (Number(order.processing_fee) || 0) / oldSub * subtotal : (Number(order.processing_fee) || 0));
    const tax = round2(oldSub > 0 ? (Number(order.tax) || 0) / oldSub * subtotal : (Number(order.tax) || 0));
    const preTax = round2(Math.max(0, subtotal + fundraise + (Number(order.shipping_fee) || 0) + processing - (Number(order.discount_amt) || 0)));
    const total = round2(preTax + tax);
    const { error } = await supabase.from('webstore_orders').update({ subtotal, fundraise_amt: fundraise, processing_fee: processing, tax, total }).eq('id', order.id);
    if (error) { flash('Save failed: ' + error.message); return { error }; }
    flash('Order updated'); loadDetail(sel); return { ok: true };
  }, [sel, detail, flash, loadDetail]);

  // Refund: Stripe for card orders, recorded credit for team-tab orders.
  // Guarded against double-processing: an in-flight latch blocks double-clicks, and the
  // already-refunded amount is re-read from the DB (not trusted from possibly-stale React
  // state) with an over-refund cap before any money moves.
  const refundingRef = useRef(false);
  const refundOrder = useCallback(async (order, amount) => {
    if (refundingRef.current) return { error: 'A refund is already in progress' };
    refundingRef.current = true;
    try {
      const cents = Math.round((Number(amount) || 0) * 100);
      if (cents <= 0) return { error: 'Enter an amount' };
      // Server-side, recorded, capped, idempotent. The endpoint resolves the
      // PaymentIntent from the order itself, issues the Stripe refund with an
      // idempotency key (attempt_id), and atomically records the refund + updates
      // refunded_amt/status via the apply_webstore_refund RPC. The browser no longer
      // writes refund state directly (RLS blocks it now; the server is the source of truth).
      const attemptId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('r' + Date.now() + Math.random().toString(36).slice(2));
      let d;
      try {
        const res = await authFetch('/.netlify/functions/stripe-payment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'refund_webstore_order', webstore_order_id: order.id, amount_cents: cents, attempt_id: attemptId }),
        });
        d = await res.json();
      } catch (e) { flash('Refund failed: ' + e.message); return { error: e.message }; }
      if (!d || d.error) { flash('Refund failed: ' + ((d && d.error) || 'unknown error')); return { error: (d && d.error) || 'refund_failed' }; }
      flash(d.kind === 'card' ? `Refunded ${money(cents / 100)} to card` : `Recorded ${money(cents / 100)} credit`);
      loadDetail(sel); return { ok: true, ...d };
    } finally { refundingRef.current = false; }
  }, [sel, flash, loadDetail]);

  const createBundle = useCallback(async ({ name, price, fundraise, image_url, components, category }) => {
    const { data: bundle, error } = await supabase.from('webstore_products').insert({ store_id: sel.id, kind: 'bundle', display_name: name, retail_price: price, fundraise_amount: Number(fundraise) || 0, image_url: image_url || null, category: category || null, active: true, sort_order: (detail?.catalog?.length || 0) }).select().single();
    if (error) { flash('Error: ' + error.message); return; }
    if (components.length) {
      const rows = components.map((c, i) => ({ bundle_id: bundle.id, webstore_product_id: c.webstore_product_id || null, product_id: c.product_id, sku: c.sku, qty: c.qty || 1, size_required: c.size_required !== false, takes_number: !!c.takes_number, takes_name: !!c.takes_name, name_upcharge: Number(c.name_upcharge) || 0, transfer_code: c.transfer_code || null, num_transfer_size: c.takes_number ? c.num_transfer_size : null, num_transfer_color: c.takes_number ? c.num_transfer_color : null, sort_order: i }));
      const { error: e2 } = await supabase.from('webstore_bundle_items').insert(rows);
      if (e2) { flash('Bundle created but items failed: ' + e2.message); loadDetail(sel); return; }
    }
    flash('Package created'); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  const addBundleItem = useCallback(async (bundleId, item) => {
    const existing = (detail?.bundleItems || []).filter((b) => b.bundle_id === bundleId);
    const row = { bundle_id: bundleId, webstore_product_id: item.webstore_product_id || item.id || null, product_id: item.product_id, sku: item.sku, qty: item.qty || 1, size_required: item.size_required !== false, takes_number: !!item.takes_number, takes_name: !!item.takes_name, name_upcharge: Number(item.name_upcharge) || 0, transfer_code: null, num_transfer_size: null, num_transfer_color: null, sort_order: existing.length };
    const { error } = await supabase.from('webstore_bundle_items').insert(row);
    if (error) { flash('Failed to add item: ' + error.message); return; }
    flash('Item added to package'); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  const removeBundleItem = useCallback(async (bundleItemId) => {
    const { error } = await supabase.from('webstore_bundle_items').delete().eq('id', bundleItemId);
    if (error) { flash('Failed to remove item: ' + error.message); return; }
    flash('Item removed from package'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  const reorderBundleItems = useCallback(async (bundleId, orderedIds) => {
    await Promise.all(orderedIds.map((id, i) => supabase.from('webstore_bundle_items').update({ sort_order: i }).eq('id', id)));
    loadDetail(sel);
  }, [sel, loadDetail]);

  // Gather this store's unbatched orders + their stock picture (shared by the
  // availability report and the batch flow's inventory check). Lines are
  // annotated with the effective SKU (size_skus overrides) and stockBySku
  // carries vendor stock for the override SKUs, so reports check/show the item
  // number production will actually source.
  const gatherBatch = useCallback(async () => {
    const open = (detail?.orders || []).filter((o) => !o.so_id && o.status !== 'pending_payment' && o.status !== 'cancelled');
    const openIds = new Set(open.map((o) => o.id));
    const skuMap = sizeSkuMapOf(detail?.catalog);
    const lines = annotateEffSkus((detail?.orderItems || []).filter((i) => openIds.has(i.order_id) && !i.is_bundle_parent), skuMap);
    const stockByPid = {};
    (detail?.catalog || []).forEach((c) => { const _s = detail.invSrcByPid?.[c.product_id]; if (c.product_id && detail.stockByWp?.[c.id] && _s && _s !== 'manual') stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    const stockBySku = await fetchOverrideSkuStock(lines);
    const orderById = {}; open.forEach((o) => { orderById[o.id] = o; });
    return { open, openIds, lines, stockByPid, stockBySku, orderById };
  }, [detail]);

  // Open the printable availability ("FAFO") report for the pending batch.
  const availabilityReport = useCallback(async () => {
    if (!sel || !detail) return;
    const { open, lines, stockByPid, stockBySku, orderById } = await gatherBatch();
    if (!open.length) { flash('No unbatched orders to report'); return; }
    buildAvailabilityReport(sel, `${open.length} order${open.length === 1 ? '' : 's'}`, lines, stockByPid, orderById, madeToOrderPids(detail.catalog), stockBySku);
  }, [sel, detail, gatherBatch, flash]);

  // All valid (non-cancelled, non-pending) orders — the whole-store picture for
  // the player + stock reports (not just the unbatched ones the FAFO report uses).
  const gatherAll = useCallback(async () => {
    const valid = (detail?.orders || []).filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled');
    const ids = new Set(valid.map((o) => o.id));
    const skuMap = sizeSkuMapOf(detail?.catalog);
    const lines = annotateEffSkus((detail?.orderItems || []).filter((i) => ids.has(i.order_id) && !i.is_bundle_parent), skuMap);
    const stockByPid = {};
    (detail?.catalog || []).forEach((c) => { const _s = detail.invSrcByPid?.[c.product_id]; if (c.product_id && detail.stockByWp?.[c.id] && _s && _s !== 'manual') stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    const stockBySku = await fetchOverrideSkuStock(lines);
    const orderById = {}; valid.forEach((o) => { orderById[o.id] = o; });
    return { valid, lines, stockByPid, stockBySku, orderById, roster: detail?.roster || [] };
  }, [detail]);

  // Per-player roll-up (printable): every player and exactly what they ordered.
  const playerReport = useCallback(async () => {
    if (!sel || !detail) return;
    const { valid, lines, orderById, roster, stockByPid } = await gatherAll();
    if (!valid.length) { flash('No orders yet'); return; }
    buildPlayerReport(sel, lines, orderById, roster, stockByPid);
  }, [sel, detail, gatherAll, flash]);

  // Store-close stock report (printable): fill-from-stock vs order-from-Adidas
  // vs backorder, split by vendor.
  const stockReport = useCallback(async () => {
    if (!sel || !detail) return;
    const { valid, lines, stockByPid, stockBySku } = await gatherAll();
    if (!valid.length) { flash('No orders yet'); return; }
    buildStockReport(sel, `${valid.length} order${valid.length === 1 ? '' : 's'}`, lines, stockByPid, madeToOrderPids(detail.catalog), stockBySku);
  }, [sel, detail, gatherAll, flash]);

  // CSV exports: 'players' (per-player line items), 'stock' (shortage split),
  // 'orders' (every line item with order + payment detail).
  const exportCsv = useCallback(async (kind) => {
    if (!sel || !detail) return;
    const { lines, orderById, stockByPid, stockBySku } = await gatherAll();
    if (!lines.length) { flash('No orders yet'); return; }
    const slug = (sel.slug || sel.name || 'store').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
    if (kind === 'players') {
      const header = ['Player', 'Number', 'Item', 'SKU', 'Size', 'Qty', 'Buyer', 'Buyer Email', 'Order Date'];
      const rows = lines.map((i) => { const o = orderById[i.order_id] || {}; return [i.player_name || '', i.player_number != null ? String(i.player_number) : '', _itemName(i, stockByPid), i._effSku || i.sku || '', i.size || '', i.qty || 1, o.buyer_name || '', o.buyer_email || '', _csvDate(o.created_at)]; });
      downloadCsv(`${slug}-players.csv`, header, rows);
    } else if (kind === 'stock') {
      const header = ['Item', 'SKU', 'Size', 'Need', 'Ours', 'Adidas', 'Fill from ours', 'PO from Adidas', 'Backorder', 'On order'];
      const rows = aggStock(lines, stockByPid, madeToOrderPids(detail.catalog), stockBySku)
        .sort((a, b) => (b.backorder - a.backorder) || (b.poVendor - a.poVendor) || a.name.localeCompare(b.name))
        .map((r) => [r.name, r.sku, r.size, r.need, (r.tracked || r.known) ? r.ours : '', (r.tracked || r.known) ? r.vendor : '', r.fillOurs, r.poVendor, r.backorder, r.onOrder ? 'yes' : '']);
      downloadCsv(`${slug}-stock.csv`, header, rows);
    } else {
      const header = ['Order', 'Date', 'Status', 'Payment', 'Buyer', 'Email', 'Player', 'Number', 'Item', 'SKU', 'Size', 'Qty', 'Unit Price'];
      const rows = lines.map((i) => { const o = orderById[i.order_id] || {}; return [o.id || '', _csvDate(o.created_at), o.status || '', o.payment_mode || '', o.buyer_name || '', o.buyer_email || '', i.player_name || '', i.player_number != null ? String(i.player_number) : '', _itemName(i, stockByPid), i._effSku || i.sku || '', i.size || '', i.qty || 1, Number(i.unit_price) || 0]; });
      downloadCsv(`${slug}-orders.csv`, header, rows);
    }
  }, [sel, detail, gatherAll, flash]);

  // Batch all not-yet-batched orders into one Sales Order via the app's normal
  // SO creation path (onCreateSO), then link each order back to the new SO id.
  const batchOrders = useCallback(async () => {
    if (!sel || !detail || !onCreateSO) return;
    // Fresh snapshot from the DB — not the possibly-minutes-old detail state — so the
    // modal's order list includes anything placed since the page loaded and excludes
    // anything batched/cancelled/refunded elsewhere in the meantime.
    const { data: freshOrders, error: foErr } = await supabase.from('webstore_orders').select('*').eq('store_id', sel.id).is('so_id', null);
    if (foErr) { flash('Could not load orders: ' + foErr.message); return; }
    const open = (freshOrders || []).filter(isLiveWebstoreOrder);
    if (!open.length) { flash('No unbatched orders to send'); return; }
    const openIds = new Set(open.map((o) => o.id));
    const openItems = [];
    for (let ii = 0, oidArr = [...openIds]; ii < oidArr.length; ii += 300) {
      const { data: chunk, error: fiErr } = await supabase.from('webstore_order_items').select('*').in('order_id', oidArr.slice(ii, ii + 300));
      if (fiErr) { flash('Could not load order items: ' + fiErr.message); return; }
      openItems.push(...(chunk || []));
    }
    const lines = annotateEffSkus(openItems.filter((i) => !i.is_bundle_parent), sizeSkuMapOf(detail.catalog));

    // Inventory check: compare demand for this batch against our warehouse +
    // Adidas vendor stock and surface any shortfalls before creating the SO.
    // Override-aware: a size mapped to a different SKU (size_skus) checks THAT
    // SKU's vendor stock, not the base product's — the SO will source it.
    const stockByPid = {};
    (detail.catalog || []).forEach((c) => { const _s = detail.invSrcByPid?.[c.product_id]; if (c.product_id && detail.stockByWp?.[c.id] && _s && _s !== 'manual') stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    const stockBySku = await fetchOverrideSkuStock(lines);
    // Items marked made-to-order (Inventory tracking → off) are decorated/custom and
    // produced to demand, so they're never a stock shortfall — same as products with
    // no stock record.
    const mto = madeToOrderPids(detail.catalog);
    // Shortfall check for whichever subset of orders is currently selected in the
    // modal (the rep can narrow the batch by cutoff date / checkboxes, and the
    // shortage list re-runs live against just those orders' demand).
    const shortagesFor = (selIds) => {
      const demand = {};
      lines.forEach((i) => { if (!i.product_id || !selIds.has(i.order_id)) return; const k = lineStockKey(i); (demand[k] = demand[k] || { line: i, q: 0 }).q += (i.qty || 1); });
      const shortages = [];
      Object.values(demand).forEach(({ line: i, q }) => {
        const pid = i.product_id, size = i.size || 'OS';
        const ls = lineStock(i, stockByPid, stockBySku, mto);
        if (!ls.tracked) return; // made-to-order / no stock record — never a shortfall
        const avail = ls.ours + ls.vendor;
        const nm = ls.name || (stockByPid[pid] && stockByPid[pid].name) || i._effSku || pid;
        if (q > avail) shortages.push({ pid, size, sku: i._effSku || i.sku || '', label: `${nm}${i._skuOv ? ` (${i._effSku})` : ''} ${size}: need ${q}, have ${avail} (${ls.ours} ours + ${ls.vendor} Adidas)${ls.onOrder ? ' — more on order' : ''}` });
      });
      return shortages;
    };
    // Everything from here on runs once the user confirms in the modal below.
    // inlineOverrides: { "pid|size" -> altSku } — typed in the shortfall modal.
    // selIds: the order ids the rep left checked (defaults to every open order).
    // batchMeta: { label, cutoff } — the batch name + order-date cutoff for the SO.
    const proceed = async (inlineOverrides = {}, selIds = openIds, batchMeta = {}) => {
    // Last-second re-check: another session may have batched, cancelled, or refunded
    // some of these orders while the modal sat open. Drop any that are no longer
    // open BEFORE building the SO, so its items and invoice/settle math only ever
    // cover orders the link below can actually claim. (A residual race between this
    // check and the claim remains, but the claim's .is('so_id',null) guard plus the
    // partial-link flash below still surface it.)
    try {
      const { data: cur } = await supabase.from('webstore_orders').select('id,status,so_id').in('id', [...selIds]);
      const gone = new Set((cur || []).filter((o) => o.so_id || !isLiveWebstoreOrder(o)).map((o) => o.id));
      if (gone.size) {
        selIds = new Set([...selIds].filter((id) => !gone.has(id)));
        flash(`${gone.size} order${gone.size === 1 ? '' : 's'} changed while the modal was open (batched or refunded elsewhere) — excluded from this batch.`);
      }
    } catch {} // recheck is best-effort; on failure we proceed from the modal snapshot as before
    const bOrders = open.filter((o) => selIds.has(o.id));
    if (!bOrders.length) { flash('No orders selected to batch'); return; }
    const bLines = lines.filter((i) => selIds.has(i.order_id));
    // Which products collect a number / name (from catalog singles + bundle components).
    const personalize = {};
    (detail.catalog || []).forEach((c) => { if (c.product_id) personalize[c.product_id] = { num: !!c.takes_number, name: !!c.takes_name }; });
    (detail.bundleItems || []).forEach((b) => { if (b.product_id) { const e = personalize[b.product_id] || { num: false, name: false }; personalize[b.product_id] = { num: e.num || !!b.takes_number, name: e.name || !!b.takes_name }; } });

    // SO sell price = what the buyer actually paid, NOT catalog retail. The webstore
    // charges a flat price per line (retail + size upcharge + fundraise + name upcharge),
    // stored as unit_price + unit_fundraise; numbers are free. We carry that collected
    // revenue onto each garment's unit_sell and suppress the name/number deco sells
    // (their COST still counts) so the SO total reconciles to SUM(order subtotal+fundraise).
    // Bundle components are stored at $0 with the whole package price on the parent row
    // (excluded from production), so we allocate the parent's price across its components
    // weighted by each component's catalog retail (a jersey absorbs more than socks).
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const retailByPid = {};
    (detail.catalog || []).forEach((c) => { if (c.product_id) retailByPid[c.product_id] = Number(c.retail_price) || 0; });
    const allItems = openItems.filter((i) => selIds.has(i.order_id));
    // Group each order's bundle parent(s) + components by order_id + bundle_product_id.
    // NOTE: older orders' PARENT rows have bundle_ref = null (it was added later), so we
    // cannot match parent→component by bundle_ref — doing so dropped the entire package
    // value for those orders. bundle_product_id is always present on both, so group on
    // that; summing parent values per group also handles the same bundle ordered twice.
    const allocById = {}; // component order_item id -> allocated package $
    const bundleGroups = {};
    allItems.forEach((i) => {
      if (!i.bundle_product_id) return;
      const k = i.order_id + '|' + i.bundle_product_id;
      if (!bundleGroups[k]) bundleGroups[k] = { parentVal: 0, kids: [] };
      if (i.is_bundle_parent) bundleGroups[k].parentVal += (Number(i.unit_price) || 0) + (Number(i.unit_fundraise) || 0);
      else bundleGroups[k].kids.push(i);
    });
    Object.values(bundleGroups).forEach((g) => {
      if (!g.kids.length || g.parentVal <= 0) return;
      const weights = g.kids.map((c) => retailByPid[c.product_id] || 0);
      const wsum = weights.reduce((a, b) => a + b, 0);
      g.kids.forEach((c, idx) => { allocById[c.id] = wsum > 0 ? r2(g.parentVal * weights[idx] / wsum) : r2(g.parentVal / g.kids.length); });
    });
    const collectedForLine = (i) => allocById[i.id] != null
      ? allocById[i.id]
      : r2(((Number(i.unit_price) || 0) + (Number(i.unit_fundraise) || 0)) * (i.qty || 1));

    // Aggregate by product + size; build parallel number/name rosters per size
    // (one entry per garment unit) so they attach as real deco lines.
    // size_skus overrides: if a size maps to a different vendor SKU, it becomes its
    // own SO line (same art/deco, same price, but a different item number to source).
    const sizeSkusByCatPid = {};
    (detail.catalog || []).forEach((c) => { if (c.product_id && c.size_skus && Object.keys(c.size_skus).length) sizeSkusByCatPid[c.product_id] = c.size_skus; });
    const byProduct = {};
    bLines.forEach((i) => {
      const basePid = i.product_id || i.sku || 'unknown';
      const sz = i.size || 'OS';
      const effectiveSku = inlineOverrides[i.product_id + '|' + sz] || (sizeSkusByCatPid[i.product_id] || {})[sz] || i.sku || '';
      const pid = basePid + '§' + effectiveSku;
      if (!byProduct[pid]) byProduct[pid] = { product_id: i.product_id || null, sku: effectiveSku, sizes: {}, numbers: {}, names: {}, collected: 0 };
      const g = byProduct[pid]; const q = i.qty || 1;
      const pdef = personalize[i.product_id] || {};
      g.sizes[sz] = (g.sizes[sz] || 0) + q;
      g.collected = r2(g.collected + collectedForLine(i));
      for (let u = 0; u < q; u++) {
        if (pdef.num) (g.numbers[sz] = g.numbers[sz] || []).push(i.player_number ? String(i.player_number) : '');
        if (pdef.name) (g.names[sz] = g.names[sz] || []).push(i.player_name || '');
      }
    });
    const pids = [...new Set(bLines.map((i) => i.product_id).filter(Boolean))];
    const pinfo = {};
    if (pids.length) {
      const { data } = await supabase.from('products').select('id,sku,name,brand,color,nsa_cost,retail_price').in('id', pids);
      (data || []).forEach((p) => { pinfo[p.id] = p; });
    }
    // Coupon discounts are order-level; the SO bills garments only (shipping/tax stay
    // at the webstore level). Scale every line's sell by the batch's net/gross ratio so
    // the SO total reconciles to what was actually collected after discounts. The
    // garment share of each order's discount is capped at its garment subtotal (the rest
    // came off shipping). With no coupons in the batch the ratio is 1 — no change.
    const garmentGross = Object.values(byProduct).reduce((a, g) => a + (g.collected || 0), 0);
    const totalDiscount = bOrders.reduce((a, o) => a + Math.min(Number(o.discount_amt) || 0, (Number(o.subtotal) || 0) + (Number(o.fundraise_amt) || 0)), 0);
    const discRatio = garmentGross > 0 ? Math.max(0, (garmentGross - totalDiscount) / garmentGross) : 1;
    // Club fundraising is a passthrough NSA owes the team, not rep margin. Its dollars are
    // baked into each garment's unit_sell (so the SO total reconciles to what was collected),
    // so we carry the same amount as an SO-level COST (_webstore_fundraise): calcGP subtracts
    // it, keeping fundraising out of the GP that rep commission is paid on. Scaled by discRatio
    // to match the fundraise embedded in the (already discount-scaled) unit_sells.
    const batchFundraiseGross = bOrders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
    const fundraiseCost = r2(batchFundraiseGross * discRatio);
    const hasVals = (m) => Object.values(m).some((arr) => arr.some((v) => v && v.trim()));
    // Logos placed in the store builder live on webstore_products.decorations (the
    // LogoPlacer format: art_id/art_url/placement/side). They must carry forward as real
    // kind:'art' deco lines — one per location — so the Art Dashboard shows a mockup slot
    // per logo and production gets each logo's own art file. (Mirrors the OMG store→SO
    // mapping in App.js.) Keyed by product_id (fallback sku) to match byProduct.
    const decosByKey = {};
    (detail.catalog || []).forEach((c) => {
      const arr = Array.isArray(c.decorations) ? c.decorations.filter((d) => d && (d.art_url || d.art_id)) : [];
      if (!arr.length) return;
      // Register under both product_id and sku so an order line keyed by either resolves.
      [c.product_id, c.sku].filter(Boolean).forEach((k) => { (decosByKey[k] = decosByKey[k] || []).push(...arr); });
    });
    // Bundle/kit components don't carry placed web-logo decos — their logo is a
    // heat-transfer "design" code (webstore_bundle_items.transfer_code). Map each
    // component product to its transfer code(s) and resolve the design label, so
    // we can emit a logo deco for it on the SO (numbers/names already carry via
    // `personalize`). Keyed by product_id to match byProduct.
    const xferLabel = {};
    (detail.transfers || []).forEach((t) => { if (t && t.code) xferLabel[t.code] = t.label || t.code; });
    const bundleXfersByPid = {};
    (detail.bundleItems || []).forEach((b) => {
      if (!b.product_id || !b.transfer_code) return;
      (bundleXfersByPid[b.product_id] = bundleXfersByPid[b.product_id] || new Set()).add(b.transfer_code);
    });
    const artById = {};
    (detail.libraryArt || []).forEach((a) => { if (a && a.id) artById[a.id] = a; });
    // Builder placement → the canonical SO position vocabulary (POSITIONS in settings; the
    // SO deco editor binds a <select> to it, so the value must be one of those options).
    const POS_LABEL = { left_chest: 'Left Chest', full_front: 'Front', full_back: 'Back', left_sleeve: 'Left Sleeve', right_sleeve: 'Right Sleeve' };
    const posOf = (d) => POS_LABEL[d.placement] || ((d.side === 'back') ? 'Back' : 'Front');
    const placeKey = (d) => (d.art_id || d.art_url || '') + '@' + (d.placement || '') + '@' + (d.side || 'front');
    const soArtFiles = new Map();
    // Garment mockups — attach each ordered product's store photo to the SO art,
    // keyed by sku|color (mirrors the OMG store→SO `item_mockups` mapping in
    // App.js), so the Art Dashboard / production sees the garment proof, not just
    // the bare logo. The order line captured the storefront image at purchase;
    // fall back to the catalog product photo.
    const catImgByPid = {};
    (detail.catalog || []).forEach((c) => { if (c.product_id && c.image_url && !catImgByPid[c.product_id]) catImgByPid[c.product_id] = c.image_url; });
    // SKU/color resolved from the product — the webstore order LINE's sku is null for
    // singles, so keying mockups off i.sku silently dropped every garment (the SO line
    // then showed "No mockup uploaded"). Key by the SO line's sku|color AND the bare sku
    // so the SO's mockup lookup (m[sku|color] → m[sku]) always resolves regardless of how
    // the line's stored color string compares to the master product color.
    const skuByPid = {}; const colorByPid = {};
    Object.values(pinfo).forEach((p) => { if (p && p.id) { if (p.sku) skuByPid[p.id] = p.sku; if (p.color) colorByPid[p.id] = p.color; } });
    (detail.catalog || []).forEach((c) => { if (c.product_id && c.sku && !skuByPid[c.product_id]) skuByPid[c.product_id] = c.sku; });
    const itemMockups = {};
    bLines.forEach((i) => {
      const rsku = i.sku || skuByPid[i.product_id] || '';
      if (!rsku) return;
      const img = i.image_url || catImgByPid[i.product_id] || '';
      if (!img) return;
      const color = i.color || colorByPid[i.product_id] || '';
      [rsku + '|' + color, rsku].forEach((key) => { const b = (itemMockups[key] = itemMockups[key] || []); if (!b.includes(img)) b.push(img); });
    });
    // Every art file carries the per-garment mockups (production filters by the
    // job's SKUs, same as OMG). The record's OWN mocks (auto-baked or QuickMockBuilder
    // proofs — real decorated composites) win over the captured storefront photo, which
    // only fills keys the record has nothing for. The old spread order let the bare
    // garment photo clobber a real proof for the same sku|color.
    const addArtFile = (rec) => { if (rec && rec.id && !soArtFiles.has(rec.id)) soArtFiles.set(rec.id, { ...rec, item_mockups: { ...itemMockups, ...(rec.item_mockups || {}) } }); };
    const cleanArt = (a) => { const { _srcLabel, _srcCustId, ...rest } = a; return rest; };
    const soItems = Object.values(byProduct).map((g) => {
      const info = pinfo[g.product_id] || {};
      const pdef = personalize[g.product_id] || {};
      const decorations = [];
      // Numbers / names attach as deco lines with the actual values (roster/names
      // keyed by size), NOT as free-text production notes.
      if (pdef.num && hasVals(g.numbers)) decorations.push({ kind: 'numbers', position: 'Back', num_method: 'screen_print', num_size: '6"', two_color: false, sell_override: null, sell_suppressed: true, custom_font_art_id: null, roster: g.numbers });
      if (pdef.name && hasVals(g.names)) decorations.push({ kind: 'names', position: 'Back Center', sell_override: null, sell_suppressed: true, sell_each: 6, cost_each: 3, names: g.names });
      // Each builder logo placement → one art deco + its art file on the SO.
      const seenPlace = new Set();
      (decosByKey[g.product_id] || decosByKey[g.sku] || []).forEach((d) => {
        const pk = placeKey(d); if (seenPlace.has(pk)) return; seenPlace.add(pk);
        const lib = d.art_id ? artById[d.art_id] : null;
        const artId = (lib && lib.id) || d.art_id || ('artweb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        if (lib) {
          // Carry the placed (possibly recolored) web logo so the mockup shows what the shopper saw.
          const base = cleanArt(lib);
          if (!base.web_logo_url && d.art_url) base.web_logo_url = d.art_url;
          addArtFile({ ...base, id: artId });
        } else {
          addArtFile({ id: artId, name: 'Store logo', deco_type: 'screen_print', web_logo_url: d.art_url || '', files: d.source_url ? [{ url: d.source_url, name: 'logo' }] : [], mockup_files: [], color_ways: [], status: 'approved', uploaded: new Date().toLocaleDateString() });
        }
        // Pin the production colorway. The builder's per-color web-logo pick is the source of
        // truth when it carries a color_way_id (the rep chose that CW's cutout for this exact
        // garment color — deterministic, not a guess). Only fall back to matching the CW's
        // garment_color label against the SO line's color (exact, then contains, then only-CW)
        // for legacy url-only picks.
        let cwId = null;
        const _pick = d.cw_by_color && d.cw_by_color[colorKeyOf(info.color)];
        if (_pick && typeof _pick === 'object' && _pick.color_way_id && lib && Array.isArray(lib.color_ways) && lib.color_ways.some((c) => c && c.id === _pick.color_way_id)) {
          cwId = _pick.color_way_id;
        }
        if (!cwId && lib && Array.isArray(lib.color_ways) && lib.color_ways.length) {
          const gc = colorKeyOf(info.color);
          const exact = gc && lib.color_ways.find((c) => c && colorKeyOf(c.garment_color) === gc);
          const fuzzy = gc && lib.color_ways.find((c) => { const cc = colorKeyOf(c && c.garment_color); return cc && (cc.includes(gc) || gc.includes(cc)); });
          cwId = (exact && exact.id) || (fuzzy && fuzzy.id) || (lib.color_ways.length === 1 ? lib.color_ways[0].id : null);
        }
        decorations.push({ kind: 'art', art_file_id: artId, position: posOf(d), type: (lib && lib.deco_type) || 'screen_print', color_way_id: cwId, web_url: decoUrlForColor(d, info.color, lib && lib.web_logos) || d.art_url || '', placement: d.placement || '', side: d.side || 'front', color_label: d.color_label || 'original', sell_override: 0, sell_each: 0, cost_each: 0 });
      });
      // Bundle/kit components: carry the component's heat-transfer logo to the SO
      // as a $0 art deco (it's baked into the package price) so production sees
      // which transfer to apply. One shared art file per transfer code.
      (bundleXfersByPid[g.product_id] ? [...bundleXfersByPid[g.product_id]] : []).forEach((code) => {
        const xId = 'xfer_' + code;
        addArtFile({ id: xId, name: 'Transfer: ' + (xferLabel[code] || code), deco_type: 'heat_press', web_logo_url: '', files: [], mockup_files: [], color_ways: [], status: 'approved', uploaded: new Date().toLocaleDateString() });
        decorations.push({ kind: 'art', art_file_id: xId, position: 'Front', type: 'heat_press', transfer_code: code, placement: 'full_front', side: 'front', color_label: 'original', sell_override: 0, sell_each: 0, cost_each: 0 });
      });
      // unit_sell = actual collected revenue ÷ units (weighted avg across sizes/bundles),
      // scaled by the batch discount ratio so the SO reconciles to net-of-coupon
      // collected. Deco sells are suppressed above so the garment line carries it all.
      const qtyTot = Object.values(g.sizes).reduce((a, v) => a + v, 0) || 1;
      const unitSell = r2((g.collected || 0) / qtyTot * discRatio);
      return { sku: g.sku || info.sku || '', name: info.name || g.sku || 'Item', brand: info.brand || '', color: info.color || '',
        product_id: g.product_id || null, nsa_cost: info.nsa_cost || 0, retail_price: unitSell, unit_sell: unitSell,
        sizes: g.sizes, available_sizes: Object.keys(g.sizes), no_deco: decorations.length === 0, decorations, pick_lines: [], po_lines: [] };
    });

    const units = soItems.reduce((a, i) => a + Object.values(i.sizes).reduce((b, v) => b + v, 0), 0);
    const discNote = totalDiscount > 0 ? `\nCoupon discounts applied: −$${totalDiscount.toFixed(2)} (spread across line prices).` : '';
    // Payment split — production runs as ONE order, but card orders are already
    // collected via Stripe; only the team-tab total should be invoiced to the club.
    const cardOrders = bOrders.filter((o) => o.payment_mode === 'paid');
    const tabOrders = bOrders.filter((o) => o.payment_mode !== 'paid');
    const netOf = (o) => Math.max(0, (Number(o.total) || 0) - (Number(o.refunded_amt) || 0));
    const cardTotal = r2(cardOrders.reduce((a, o) => a + netOf(o), 0));
    const tabTotal = r2(tabOrders.reduce((a, o) => a + netOf(o), 0));
    // Team-tab extras = the tab orders' tax/shipping/processing beyond their
    // product (+fundraise) share. The auto-invoice adds these on top of the SO's
    // product lines so the club's open balance equals the team-tab gross.
    const tabProduct = r2(tabOrders.reduce((a, o) => a + (Number(o.subtotal) || 0) + (Number(o.fundraise_amt) || 0), 0) * discRatio);
    const tabExtras = r2(Math.max(0, tabTotal - tabProduct));
    const payNote = `\n\n⚠ PAYMENT — INVOICE THE CLUB FOR THE TEAM-TAB TOTAL ONLY:\n• Already paid by card (collected via Stripe): $${cardTotal.toFixed(2)} · ${cardOrders.length} order${cardOrders.length === 1 ? '' : 's'}\n• To invoice to the club (team tab): $${tabTotal.toFixed(2)} · ${tabOrders.length} order${tabOrders.length === 1 ? '' : 's'}`;
    const cutoffNote = batchMeta.cutoff ? `\nBatch cutoff: orders placed through ${batchCutoffDay(batchMeta.cutoff)} — the store stays open; later orders go into the next batch.` : '';
    const notes = `Webstore: ${sel.name} (/shop/${sel.slug})${batchMeta.label ? `\nBatch: ${batchMeta.label}` : ''}${cutoffNote}\n${bOrders.length} orders · ${units} units · delivery: ${sel.delivery_mode === 'deliver_club' ? 'deliver to club' : 'ship to home'}\nNames & numbers are on each item's deco lines.${discNote}${payNote}`;

    // await — onCreateSO now persists the SO and only resolves an id once it's
    // confirmed saved, so we never tag orders to an SO that doesn't exist yet.
    const soId = await onCreateSO({ customer_id: sel.customer_id, memo: `${sel.name} webstore — ${bOrders.length} orders${batchMeta.label ? ` — ${batchMeta.label}` : ''}`, production_notes: notes, items: soItems, webstore_id: sel.id, art_files: [...soArtFiles.values()], fundraise_cost: fundraiseCost,
      batch_label: batchMeta.label || null, batch_cutoff: batchMeta.cutoff || null,
      // Money split for the automatic invoice+settle: Stripe-collected card total,
      // team-tab gross still owed by the club, and the tab's tax/ship/processing extras.
      settle: { cardTotal, tabTotal, tabExtras } });
    if (!soId) { flash('Could not create the Sales Order — orders were not batched. Please try again.'); return; }
    // Idempotent link: only claim orders still unbatched, so a concurrent batch
    // (two staff at once) can't steal another SO's orders. Returns the rows we won.
    const { data: linked, error } = await supabase.from('webstore_orders').update({ so_id: soId, status: 'batched' }).in('id', [...selIds]).is('so_id', null).select('id');
    if (error) flash(`SO ${soId} created, but linking failed: ${error.message}`);
    else if ((linked || []).length < selIds.size) flash(`Created ${soId} · linked ${(linked || []).length} of ${selIds.size} (some were just batched elsewhere)`);
    else flash(`Created ${soId} · linked ${bOrders.length} orders`);
    loadDetail(sel);
    }; // end proceed

    // Open the styled confirm modal; it calls proceed() on Create with the rep's
    // final selection (cutoff/checkboxes) and batch label.
    setSoPrompt({ orders: open, shortagesFor, proceed, stockByPid, storeId: sel.id });
  }, [sel, detail, onCreateSO, flash, loadDetail]);

  const removeCatalogItem = useCallback(async (id, label) => {
    if (!window.confirm('Remove "' + label + '" from this store?')) return;
    const { error } = await supabase.from('webstore_products').delete().eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Removed'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // Remove a whole garment card — the item and all of its color variants — in one go.
  const removeGroup = useCallback(async (ids, label) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) return;
    if (!window.confirm(`Remove "${label}"${list.length > 1 ? ` and its ${list.length} colors` : ''} from this store?`)) return;
    const { error } = await supabase.from('webstore_products').delete().in('id', list);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Removed'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  // Move a catalog item up/down; normalizes sort_order to its array index so
  // the storefront and admin show the same order.
  const reorderItem = useCallback(async (item, dir) => {
    const list = [...(detail?.catalog || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = list.findIndex((x) => x.id === item.id);
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= list.length) return;
    [list[idx], list[swap]] = [list[swap], list[idx]];
    for (let i = 0; i < list.length; i++) {
      if ((list[i].sort_order || 0) !== i) await supabase.from('webstore_products').update({ sort_order: i }).eq('id', list[i].id);
    }
    loadDetail(sel);
  }, [detail, sel, loadDetail]);

  // Move a catalog item to an arbitrary spot (drag-and-drop): drop it before
  // `beforeId` (or at the end when null), then renormalize sort_order so the
  // storefront and admin agree — same persistence path as the up/down arrows.
  const moveItem = useCallback(async (item, beforeId, category) => {
    const list = [...(detail?.catalog || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const fromIdx = list.findIndex((x) => x.id === item.id);
    if (fromIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    let toIdx = beforeId == null ? list.length : list.findIndex((x) => x.id === beforeId);
    if (toIdx < 0) toIdx = list.length;
    list.splice(toIdx, 0, moved);
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const needSort = (row.sort_order || 0) !== i;
      const setCat = category !== undefined && row.id === item.id && (row.category || null) !== (category || null);
      if (needSort || setCat) {
        const upd = {}; if (needSort) upd.sort_order = i; if (setCat) upd.category = category || null;
        await supabase.from('webstore_products').update(upd).eq('id', row.id);
      }
    }
    loadDetail(sel);
  }, [detail, sel, loadDetail]);

  // Move an entire category section before another category section.
  const moveCatSection = useCallback(async (fromCat, toCat) => {
    if (fromCat === toCat) return;
    const list = [...(detail?.catalog || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const fromItems = list.filter((x) => (x.category || '') === fromCat);
    const rest = list.filter((x) => (x.category || '') !== fromCat);
    const insertBefore = rest.findIndex((x) => (x.category || '') === toCat);
    const insertIdx = insertBefore < 0 ? rest.length : insertBefore;
    const reordered = [...rest.slice(0, insertIdx), ...fromItems, ...rest.slice(insertIdx)];
    for (let i = 0; i < reordered.length; i++) {
      if ((reordered[i].sort_order || 0) !== i) {
        await supabase.from('webstore_products').update({ sort_order: i }).eq('id', reordered[i].id);
      }
    }
    loadDetail(sel);
  }, [detail, sel, loadDetail]);

  // Reorder the color rows within one card (the filmstrip drag). Keeps the group's existing
  // band of sort_order values but reassigns them to match the new left-to-right order, so the
  // card stays put relative to other cards while the leftmost color becomes the primary (its
  // image leads the catalog row and the storefront card / default color).
  const reorderColorRows = useCallback(async (orderedIds) => {
    const cat = detail?.catalog || [];
    const rows = orderedIds.map((id) => cat.find((c) => c.id === id)).filter(Boolean);
    if (rows.length < 2) return;
    const slots = rows.map((r) => r.sort_order || 0).sort((a, b) => a - b);
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i].sort_order || 0) !== slots[i]) await supabase.from('webstore_products').update({ sort_order: slots[i] }).eq('id', rows[i].id);
    }
    loadDetail(sel);
  }, [detail, sel, loadDetail]);

  // ── render gates ─────────────────────────────────────────────────────
  if (needsMigration) return <MigrationNotice onRetry={loadStores} />;
  if (loading) return <div style={{ padding: 40, color: '#64748b', fontSize: 14 }}>Loading webstores…</div>;
  if (err) return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}><div className="card-body" style={{ padding: 24 }}>
      <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Couldn't load webstores</div>
      <div style={{ fontSize: 13, color: '#64748b' }}>{err}</div>
      <button className="btn btn-secondary" style={{ marginTop: 14 }} onClick={loadStores}>Retry</button>
    </div></div>
  );

  return (
    <>
      {toast && <div style={{ position: 'fixed', bottom: 20, right: 20, background: '#0f172a', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>{toast}</div>}
      {showDefaults && <StoreDefaultsModal settings={wsSettings} onSave={saveWsSettings} onClose={() => setShowDefaults(false)} />}
      {soPrompt && <SoConfirmModal orders={soPrompt.orders} shortagesFor={soPrompt.shortagesFor} stockByPid={soPrompt.stockByPid || {}} storeId={soPrompt.storeId} onCancel={() => setSoPrompt(null)} onConfirm={async (overrides, selIds, batchMeta) => { const p = soPrompt.proceed; setSoPrompt(null); await p(overrides, selIds, batchMeta); }} />}

      {tplColorFlow && <TemplateColorPicker tpl={tplColorFlow.tpl} existingPids={tplColorFlow.existingPids} onConfirm={finishTplColorFlow} onClose={() => setTplColorFlow(null)} />}
      {pickStoreForTpl && <StorePickerModal stores={stores.filter((s) => !s.is_template)} custName={custName} title={`Add “${pickStoreForTpl.name}” to which store?`} onPick={(store) => { const tpl = pickStoreForTpl; setPickStoreForTpl(null); beginTplColorFlow(tpl, store); }} onClose={() => setPickStoreForTpl(null)} />}

      {editing ? (
        <StoreForm cust={cust} REPS={REPS} repCsr={repCsr} store={editing === 'new' ? null : editing} initialOverrides={editing === 'new' ? omgPrefill : null}
          onCancel={() => { setPendingStartTpl(null); setEditing(null); omgResetStaged(); }}
          onSave={async (form) => {
            const isNew = editing === 'new';
            const r = await saveStore(form, isNew ? null : editing.id);
            if (r.error) return r;
            setEditing(null);
            // Arrived here from the OMG wizard (items staged in omgItems) — add them + queue
            // in-house art now that the store exists with every setting the rep just configured.
            if (isNew && omgPrefill && r.data) { await omgFinishAfterSettings(r.data); return r; }
            if (isNew && pendingStartTpl && r.data) { const tpl = pendingStartTpl; setPendingStartTpl(null); beginTplColorFlow(tpl, r.data); }
            return r;
          }}
          onImportFromOmg={(editing === 'new' && !omgPrefill) ? () => { setEditing(null); setOmgStep('link'); } : null} />
      ) : sel ? (
        <StoreDetail store={sel} detail={detail} loading={detailLoading} tab={tab} setTab={setTab} cu={cu}
          custName={custName} repName={repName} standardCategories={wsSettings?.standard_categories || []}
          onBack={() => { setSel(null); setDetail(null); }}
          onEdit={() => setEditing(sel)} onOpenSO={onOpenSO} onSetStatus={setStoreStatus}
          onAddSingle={addSingle} onAddColors={addColorsToItem} onAddFits={addFitsToItem} onCopyItem={copyToNewItem} onAddMany={addManyFromList} onApplyTemplate={applyTemplate} onApplyTemplateColors={applyTemplateColors} onPriceToMargin={priceAllToMargin} onCreateBundle={createBundle} onAddBundleItem={addBundleItem} onRemoveBundleItem={removeBundleItem} onReorderBundleItems={reorderBundleItems} onRemove={removeCatalogItem} onRemoveGroup={removeGroup} onUpdateImage={updateImage} onUpdateCost={updateProductCost} onUpdateProductMeta={updateProductMeta} onBatch={batchOrders} onAvailabilityReport={availabilityReport} onPlayerReport={playerReport} onStockReport={stockReport} onExportCsv={exportCsv} onReorder={reorderItem} onMove={moveItem} onReorderColors={reorderColorRows} onUpdateItem={updateCatalogItem} onBulkUpdate={bulkUpdateItems}
          onUpdateTransfer={updateTransfer} onAddTransfers={addTransfers} onRemoveTransfer={removeTransfer} onPullTransfers={pullBatchTransfers}
          onCreateCoupons={createCoupons} onUpdateCoupon={updateCoupon} onRemoveCoupon={removeCoupon}
          onAddRoster={addRoster} onUpdateRoster={updateRoster} onRemoveRoster={removeRoster} onInviteRoster={inviteRoster}
          onSaveOrderEdits={saveOrderEdits} onRefundOrder={refundOrder}
          onApplyLogo={applyLogoToItems} onApplyLogoBulk={applyLogoBulk} onSetItemDecorations={setItemDecorations} onSaveArtVariant={saveArtVariant} onSaveRepWebLogo={saveRepWebLogo} placementMemory={(wsSettings && wsSettings.placement_memory) || {}} onSavePlacementMemory={savePlacementMemory} onSaveMocks={saveStoreMocks} onAddStoreLogo={addStoreLogo} onSaveStoreArt={saveStoreArt} onAttachWebLogo={attachArtPreview} onFlash={flash}
          portalUrl={coachPortalUrl(sel)} onEmailDirector={(email) => emailDirector(sel, email)} onFlyer={() => openFlyer(sel, attachBundleImages([...(detail?.catalog || [])], detail?.bundleItems || []))} />
      ) : (
        <ListView stores={stores} custName={custName} repName={repName} REPS={REPS} cu={cu} storeStats={storeStats} onOpen={openStore} onNew={() => setEditing('new')} onDuplicate={duplicateStore} onToggleTemplate={toggleTemplate} onNewFromTemplate={(t) => duplicateStore(t, { suffix: '', rebrand: true })} onStoreDefaults={() => setShowDefaults(true)} onStartStoreFromTemplate={startStoreFromTemplate} onAddTemplateToStore={(t) => setPickStoreForTpl(t)} onCreateFromOmg={() => setOmgStep('link')} />
      )}

      {omgStep && <OmgImportWizard
        step={omgStep} url={omgUrl} setUrl={setOmgUrl} fetching={omgFetching} onFetch={omgFetchReport}
        items={omgItems} stock={omgStock} name={omgName} setName={setOmgName} vendList={omgVendList}
        customerId={omgCustomerId} setCustomerId={setOmgCustomerId} cust={cust}
        onSkuChange={(i, v) => setOmgItems((prev) => prev.map((p, j) => (j === i ? { ...p, sku: v } : p)))}
        onSkuBlur={omgResolveRow}
        onFieldChange={(i, key, v) => setOmgItems((prev) => prev.map((p, j) => (j === i ? { ...p, [key]: v } : p)))}
        onToggleIncluded={(i) => setOmgItems((prev) => prev.map((p, j) => (j === i ? { ...p, _included: p._included === false } : p)))}
        onCreate={omgProceedToSettings} creating={false}
        onClose={omgResetStaged}
      />}
    </>
  );
}

// "Create from OMG" wizard — paste a report link, review/fix every item (SKU, name, price,
// live stock), then create the draft Club Webstore. Step 1: URL. Step 2: review table.
function OmgImportWizard({ step, url, setUrl, fetching, onFetch, items, stock, name, setName, vendList = [], customerId, setCustomerId, cust, onSkuChange, onSkuBlur, onFieldChange, onToggleIncluded, onCreate, creating, onClose }) {
  const skuInvalid = (sku) => { const s = String(sku || '').trim(); return !s || /[\/\\|,;]|\s/.test(s); };
  const LINKED_SRC = ['catalog', 'sanmar', 'ss', 'richardson', 'momentec', 'api'];
  const isLinked = (p) => Number(p.cost) > 0 && LINKED_SRC.includes(p._cost_source);
  if (step === 'link') {
    return (
      <div className="modal-overlay" onClick={() => { if (!fetching) onClose(); }}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
          <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>📥 Create from OMG</h2>
            <button onClick={() => { if (!fetching) onClose(); }} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#94a3b8' }}>×</button>
          </div>
          <div className="modal-body" style={{ padding: '16px 20px 20px' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Paste the shared OMG report link. It pulls in every product, size, color and decorated mockup image, then lets you review and fix SKUs, prices and names before the store is created.</div>
            <input type="text" autoFocus placeholder="https://report.ordermygear.com/..." value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && !fetching) onFetch(url); }}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }} />
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={onClose} disabled={fetching} style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#64748b', cursor: fetching ? 'not-allowed' : 'pointer' }}>Cancel</button>
            <button onClick={() => onFetch(url)} disabled={fetching || !url.trim()} style={{ fontSize: 13, fontWeight: 800, padding: '8px 20px', borderRadius: 6, border: 'none', background: (fetching || !url.trim()) ? '#94a3b8' : '#166534', color: '#fff', cursor: (fetching || !url.trim()) ? 'not-allowed' : 'pointer' }}>{fetching ? '⏳ Fetching…' : 'Fetch & Review'}</button>
          </div>
        </div>
      </div>
    );
  }
  // step === 'review'
  const badSkus = items.filter((p) => skuInvalid(p.sku));
  // "Matched" (found a real catalog/vendor SKU) is a different fact than "priced" (that catalog
  // row happens to have a cost on file). A SKU can be a genuine match with $0 cost — e.g. an
  // Adidas item NSA hasn't priced yet, since Adidas has no live pricing API — and that is NOT
  // the same failure as never finding the SKU at all.
  const unmatched = items.filter((p) => p._included !== false && !p.product_id);
  const missingCost = items.filter((p) => p._included !== false && p.product_id && !isLinked(p));
  const included = items.filter((p) => p._included !== false);
  const totalUnits = included.reduce((a, p) => a + Object.values(p.sizes || {}).reduce((a2, v) => a2 + (Number(v) || 0), 0), 0);
  const chip = (bg, fg) => ({ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: bg, color: fg });
  const th = (align) => ({ textAlign: align || 'center', padding: '7px 8px', borderBottom: '2px solid #e2e8f0', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' });
  const sortedCust = [...(cust || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>📥 Review before creating the store</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', padding: '16px 20px 20px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>Store name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>Customer (for art library + CSR — can set later)</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="">— No customer yet —</option>
                {sortedCust.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Fix any SKU that's wrong — the cost and vendor <b>re-source automatically</b> from the catalog and supplier APIs. Uncheck an item to leave it out entirely.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={chip('#eef2ff', '#4338ca')}>{included.length} item{included.length === 1 ? '' : 's'} · {totalUnits} units</span>
            {badSkus.length > 0 && <span style={chip('#fef2f2', '#b91c1c')}>⚠ {badSkus.length} invalid SKU{badSkus.length === 1 ? '' : 's'}</span>}
            {unmatched.length > 0 && <span style={chip('#fef2f2', '#b91c1c')}>⚠ {unmatched.length} not linked to catalog/API</span>}
            {missingCost.length > 0 && <span style={chip('#fffbeb', '#92400e')}>{missingCost.length} matched, no cost on file</span>}
            {badSkus.length === 0 && unmatched.length === 0 && missingCost.length === 0 && <span style={chip('#f0fdf4', '#166534')}>✓ all linked &amp; valid</span>}
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f8fafc' }}>
                <th style={th('center')}></th>
                <th style={th('center')}></th>
                <th style={th('left')}>Name</th>
                <th style={th('left')}>SKU</th>
                <th style={th('left')}>Color / stock</th>
                <th style={th('right')}>Price</th>
                <th style={th('right')}>Cost · source</th>
                <th style={th('left')}>Vendor</th>
              </tr></thead>
              <tbody>
                {items.map((p, i) => {
                  const invalid = skuInvalid(p.sku);
                  const included2 = p._included !== false;
                  const key = p.product_id || ('omgtmp:' + i);
                  const st = stock && stock.get(key);
                  // Prefer the catalog/vendor's REAL current sizes over the size the OMG order
                  // historically recorded — that label (e.g. "Womens S", "OSFA") is whatever a
                  // parent typed years ago and routinely doesn't match today's raw size key, which
                  // made every live item look "out of stock" even when it had hundreds on hand.
                  const liveSizes = (st && st.sizes && st.sizes.length) ? st.sizes : null;
                  const regSizes = foldScale(liveSizes || Object.keys(p.sizes || {}));
                  const stockOf = (sz) => (st && st.sizeStock && st.sizeStock[sz]) || 0;
                  const sizeRows = regSizes.map((sz) => ({ sz, q: foldedQty(sz, stockOf) }));
                  const totalStock = sizeRows.reduce((a, s) => a + s.q, 0);
                  return (
                    <tr key={i} style={{ background: !included2 ? '#f8fafc' : invalid ? '#fef2f2' : i % 2 ? '#fafbfc' : '#fff', opacity: included2 ? 1 : 0.55 }}>
                      <td style={{ padding: 4, borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                        <input type="checkbox" checked={included2} onChange={() => onToggleIncluded(i)} title="Bring this item over" style={{ cursor: 'pointer' }} />
                      </td>
                      <td style={{ padding: 4, borderBottom: '1px solid #f1f5f9', width: 44, textAlign: 'center' }}>
                        {p.image_url ? <img src={p.image_url} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4, border: '1px solid #e2e8f0' }} /> : <span style={{ color: '#cbd5e1', fontSize: 16 }}>📦</span>}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <input type="text" value={p.name || ''} disabled={!included2} onChange={(e) => onFieldChange(i, 'name', e.target.value)} style={{ width: 160, fontSize: 12, fontWeight: 600, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' }} />
                        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{p.manufacturer || ''}</div>
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <input type="text" value={p.sku || ''} disabled={!included2} title="Edit the style number — leaving the field re-sources the cost & vendor across the catalog and supplier APIs."
                          onChange={(e) => onSkuChange(i, e.target.value)}
                          onFocus={(e) => { e.target.dataset.orig = p.sku || ''; }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          onBlur={(e) => { const orig = e.target.dataset.orig || ''; if ((e.target.value || '').trim() !== orig.trim()) onSkuBlur(i, e.target.value); }}
                          style={{ fontFamily: 'monospace', fontWeight: 700, color: invalid ? '#b91c1c' : '#1e40af', fontSize: 12, width: 100, padding: '4px 6px', border: '1px solid ' + (invalid ? '#fca5a5' : '#cbd5e1'), borderRadius: 4, background: '#fff' }} />
                        {p._resolving && <div style={{ fontSize: 8, color: '#64748b', marginTop: 2 }}>⏳ resolving…</div>}
                        {!p._resolving && invalid && <div style={{ fontSize: 8, fontWeight: 800, color: '#b91c1c', marginTop: 2, whiteSpace: 'nowrap' }}>⚠ fix this SKU</div>}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9', color: '#64748b', maxWidth: 140 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>{p.color || '—'}</div>
                        {sizeRows.length ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {sizeRows.map(({ sz, q }) => <span key={sz} title={`${q} available`} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 20, background: q > 0 ? '#dcfce7' : '#fef2f2', color: q > 0 ? '#166534' : '#b91c1c' }}>{sz} {q}</span>)}
                          </div>
                        ) : <span style={{ fontSize: 9, color: '#94a3b8' }}>{p.product_id ? 'no stock data' : 'not linked to catalog'}</span>}
                        {totalStock === 0 && sizeRows.length > 0 && <div style={{ fontSize: 8, fontWeight: 800, color: '#b91c1c', marginTop: 2 }}>⚠ out of stock</div>}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <input type="number" step="0.01" value={p.retail || 0} disabled={!included2} onChange={(e) => onFieldChange(i, 'retail', parseFloat(e.target.value) || 0)} style={{ width: 72, textAlign: 'right', fontSize: 12, fontWeight: 700, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4 }} />
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                        <div style={{ color: Number(p.cost) > 0 ? '#166534' : '#b91c1c', fontWeight: 700 }}>{Number(p.cost) > 0 ? '$' + Number(p.cost).toFixed(2) : '—'}</div>
                        {(() => {
                          const L = { catalog: ['✓ Catalog', '#15803d', '#dcfce7'], sanmar: ['✓ SanMar', '#1d4ed8', '#dbeafe'], ss: ['✓ S&S', '#6d28d9', '#ede9fe'], richardson: ['✓ Richardson', '#b45309', '#fef3c7'], momentec: ['✓ Momentec', '#0e7490', '#cffafe'], api: ['✓ API', '#475569', '#e2e8f0'] };
                          const hit = isLinked(p) && L[p._cost_source];
                          if (hit) return <span style={{ fontSize: 8, fontWeight: 800, color: hit[1], background: hit[2], padding: '1px 5px', borderRadius: 8, display: 'inline-block', marginTop: 2 }}>{hit[0]}</span>;
                          // A real catalog match with no cost on file (e.g. Adidas — no live pricing
                          // API) is a DIFFERENT problem than never matching the SKU at all; don't
                          // call it "not linked" when it genuinely is.
                          if (p.product_id) return <span title="Matched this exact SKU in the catalog, but it has no cost on file yet — enter one after creating the store." style={{ fontSize: 8, fontWeight: 800, color: '#b45309', background: '#fef3c7', padding: '1px 5px', borderRadius: 8, display: 'inline-block', marginTop: 2 }}>Catalog match · no cost</span>;
                          return <span title="This SKU didn't match the catalog or any supplier API." style={{ fontSize: 8, fontWeight: 800, color: '#b91c1c', background: '#fef2f2', padding: '1px 5px', borderRadius: 8, display: 'inline-block', marginTop: 2 }}>⚠ not linked</span>;
                        })()}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9', color: '#0f172a', fontSize: 11, maxWidth: 100, overflow: 'hidden' }}><div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vendList.find((v) => v.id === p.vendor_id)?.name || '—'}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {badSkus.length > 0 && <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 11, color: '#b91c1c' }}>⚠ {badSkus.length} item{badSkus.length === 1 ? '' : 's'} still {badSkus.length === 1 ? 'has' : 'have'} an invalid SKU. You can still create the store, but the Sales Order stays blocked until every SKU is a single valid style number.</div>}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button onClick={onClose} disabled={creating} style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#64748b', cursor: creating ? 'not-allowed' : 'pointer' }}>Cancel — don’t create</button>
          <button onClick={onCreate} disabled={creating || included.length === 0} title="Continue to delivery, fundraising, coach contact and the rest of the store's settings" style={{ fontSize: 13, fontWeight: 800, padding: '8px 22px', borderRadius: 6, border: 'none', background: (creating || included.length === 0) ? '#94a3b8' : '#166534', color: '#fff', cursor: (creating || included.length === 0) ? 'not-allowed' : 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}>{creating ? '⏳…' : `Next: Store Settings · ${included.length} item${included.length === 1 ? '' : 's'} →`}</button>
        </div>
      </div>
    </div>
  );
}

// Searchable product picker for substitute SKUs in the SO confirm modal.
// Queries products as the rep types; fetches live stock from webstore_storefront_products
// for that size so they can see what's actually available before picking.
// Uses position:fixed for the dropdown so it escapes the modal's overflow:hidden.
function SkuSearchInput({ size, value, onChange, stockByPid, storeId }) {
  const [q, setQ] = useState(value || '');
  const [results, setResults] = useState([]);
  const [resultStock, setResultStock] = useState({});
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState(null);
  const wrapRef = useRef(null);
  const timer = useRef(null);
  const search = (text) => {
    setQ(text);
    onChange(text);
    if (timer.current) clearTimeout(timer.current);
    if (!text.trim()) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const { data } = await supabase.from('products').select('id,sku,name,brand,color').or(`sku.ilike.%${text}%,name.ilike.%${text}%`).limit(8);
      const rows = data || [];
      setResults(rows);
      // Fetch size stock for found products from this store's storefront view.
      if (rows.length && storeId) {
        const pids = rows.map((p) => p.id);
        const { data: sr } = await supabase.from('webstore_storefront_products').select('product_id,size_stock,vendor_size_stock').eq('store_id', storeId).in('product_id', pids);
        const fresh = {};
        (sr || []).forEach((r) => { fresh[r.product_id] = r; });
        setResultStock(fresh);
      }
      if (wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        setDropPos({ top: r.bottom + 4, left: r.left });
      }
      setOpen(true);
    }, 250);
  };
  const openAgain = () => { if (results.length) { if (wrapRef.current) { const r = wrapRef.current.getBoundingClientRect(); setDropPos({ top: r.bottom + 4, left: r.left }); } setOpen(true); } };
  const select = (p) => { setQ(p.sku); onChange(p.sku); setOpen(false); };
  return (
    <div ref={wrapRef} style={{ flex: '0 0 auto' }}>
      <input className="form-input" value={q} onChange={(e) => search(e.target.value)}
        onFocus={openAgain}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder="Search SKU or name…"
        style={{ fontSize: 12, padding: '4px 8px', width: 220, fontFamily: 'monospace' }} />
      {open && results.length > 0 && dropPos && (
        <div style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 9999, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.22)', minWidth: 360, maxHeight: 280, overflowY: 'auto' }}>
          {results.map((p, i) => {
            const st = resultStock[p.id] || stockByPid[p.id];
            const wh = st ? (Number((st.size_stock || {})[size]) || 0) : null;
            const ven = st ? (Number((st.vendor_size_stock || {})[size]) || 0) : null;
            const inStock = wh !== null ? wh + ven : null;
            return (
              <div key={p.id} onMouseDown={() => select(p)}
                style={{ padding: '9px 13px', cursor: 'pointer', borderTop: i ? '1px solid #f1f5f9' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: '#1e293b' }}>{p.sku}</span>
                  {p.brand && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{p.brand}</span>}
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}{p.color ? ` · ${p.color}` : ''}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, color: inStock === null ? '#94a3b8' : inStock > 0 ? '#15803d' : '#dc2626' }}>
                  {inStock === null ? 'stock N/A' : inStock > 0 ? `${size}: ${inStock} avail` : `${size}: out of stock`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Styled confirm for "Create Batch" — replaces the native window.confirm.
// The rep scopes the batch here (an order-date cutoff and/or per-order checkboxes —
// unselected orders stay open for the next batch while the store keeps running),
// names it, and sees inventory shortfalls recomputed live for that selection.
// Shortfall rows have a product search so the rep can pick a substitute SKU
// with live stock verification without leaving the modal.
function SoConfirmModal({ orders = [], shortagesFor, onCancel, onConfirm, stockByPid = {}, storeId }) {
  const [busy, setBusy] = useState(false);
  // keyed by "pid|size" → altSku string
  const [overrideSkus, setOverrideSkus] = useState({});
  const [selIds, setSelIds] = useState(() => new Set(orders.map((o) => o.id)));
  const [label, setLabel] = useState('');
  const [cutoff, setCutoff] = useState(''); // yyyy-mm-dd; selects orders placed through end of that day
  const setOverride = (pid, size, val) => setOverrideSkus((prev) => {
    const k = pid + '|' + size; const n = { ...prev };
    const v = val.trim().toUpperCase(); if (v) n[k] = v; else delete n[k]; return n;
  });
  const cutoffEnd = (v) => new Date(v + 'T23:59:59.999');
  const applyCutoff = (v) => {
    setCutoff(v);
    if (!v) { setSelIds(new Set(orders.map((o) => o.id))); return; }
    const end = cutoffEnd(v);
    // Orders with a missing/unparseable created_at can't be judged against the cutoff —
    // keep them selected (the rep can uncheck) rather than silently dropping them.
    setSelIds(new Set(orders.filter((o) => { if (!o.created_at) return true; const t = new Date(o.created_at); return isNaN(t) || t <= end; }).map((o) => o.id)));
  };
  // A manual check/uncheck means the selection no longer equals "everything through
  // the cutoff", so clear the date — otherwise the SO would persist a cutoff that
  // misdescribes which orders are actually in the batch.
  const toggle = (id) => { setCutoff(''); setSelIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const shortages = useMemo(() => (shortagesFor ? shortagesFor(selIds) : []), [selIds, shortagesFor]);
  const count = selIds.size;
  const leftOut = orders.length - count;
  const go = async () => {
    setBusy(true);
    // Only pass substitutions that still have a live shortage row behind them — a
    // substitute typed for a shortage that later disappeared (selection narrowed)
    // must not silently rewrite that SKU's lines.
    const validKeys = new Set(shortages.map((s) => s.pid + '|' + s.size));
    const activeOverrides = {};
    Object.entries(overrideSkus).forEach(([k, v]) => { if (validKeys.has(k)) activeOverrides[k] = v; });
    try { await onConfirm(activeOverrides, selIds, { label: label.trim() || null, cutoff: cutoff ? cutoffEnd(cutoff).toISOString() : null }); }
    finally { setBusy(false); }
  };
  return (
    <div onClick={busy ? undefined : onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 24px 60px rgba(0,0,0,.32)', overflow: 'hidden' }}>
        <div style={{ background: '#192853', color: '#fff', padding: '18px 22px' }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', lineHeight: 1 }}>Create Batch</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>Batch {count} of {orders.length} open order{orders.length === 1 ? '' : 's'} into one production Sales Order.{leftOut > 0 ? ` ${leftOut} stay open for the next batch.` : ''}</div>
        </div>
        <div style={{ padding: '20px 22px', maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ flex: '1 1 220px', fontSize: 11.5, fontWeight: 700, color: '#475569' }}>Batch label <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span>
              <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={'e.g. "Spring round 1"'} style={{ marginTop: 4, fontSize: 13 }} />
            </label>
            <label style={{ flex: '0 1 190px', fontSize: 11.5, fontWeight: 700, color: '#475569' }}>Orders through <span style={{ fontWeight: 500, color: '#94a3b8' }}>(cutoff)</span>
              <input type="date" className="form-input" value={cutoff} onChange={(e) => applyCutoff(e.target.value)} style={{ marginTop: 4, fontSize: 13 }} />
            </label>
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 14, maxHeight: 200, overflowY: 'auto' }}>
            {orders.map((o, i) => (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: i ? '1px solid #f1f5f9' : 'none', cursor: 'pointer', fontSize: 12.5, background: selIds.has(o.id) ? '#fff' : '#f8fafc', color: selIds.has(o.id) ? '#0f172a' : '#94a3b8' }}>
                <input type="checkbox" checked={selIds.has(o.id)} onChange={() => toggle(o.id)} />
                <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.buyer_name || o.buyer_email || o.id}</span>
                <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{o.created_at ? new Date(o.created_at).toLocaleDateString() : ''}</span>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{money(o.total)}</span>
              </label>
            ))}
          </div>
          {shortages.length ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b45309', fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>
                <span style={{ fontSize: 16 }}>⚠️</span> Inventory shortfalls for this batch
              </div>
              <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 10, overflow: 'hidden' }}>
                {shortages.map((s, i) => (
                  <div key={i} style={{ borderTop: i ? '1px solid #fde68a' : 'none', padding: '10px 12px' }}>
                    <div style={{ fontSize: 13, color: '#7c2d12', lineHeight: 1.4, marginBottom: 6 }}>
                      {s.label}
                      {s.sku && <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '1px 5px' }}>{s.sku}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: '#92400e', whiteSpace: 'nowrap', fontWeight: 600 }}>Sub for {s.size}:</span>
                      <SkuSearchInput size={s.size} value={overrideSkus[s.pid + '|' + s.size] || ''} onChange={(v) => setOverride(s.pid, s.size, v)} stockByPid={stockByPid} storeId={storeId} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>Search by SKU or name — stock shown for that size. Substitute creates a separate SO line with the same decoration.</div>
            </>
          ) : (
            <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>{count === 0 ? 'No orders selected — pick at least one order (or clear the cutoff) to create a batch.' : 'Everything in this batch can be filled from stock or Adidas. Ready to create the Sales Order?'}</div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', borderTop: '1px solid #eef1f5', background: '#f8fafc' }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={go} disabled={busy || count === 0}>{busy ? 'Creating…' : `Create Batch${shortages.length ? ' anyway' : ''}`}</button>
        </div>
      </div>
    </div>
  );
}

function MigrationNotice({ onRetry }) {
  return (
    <div className="card" style={{ maxWidth: 620, margin: '40px auto' }}><div className="card-body" style={{ padding: 28, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
      <h2 style={{ margin: '0 0 8px', color: '#1e293b' }}>Webstores not set up yet</h2>
      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
        The webstore tables haven't been created in the database yet. Apply migration <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>supabase_migration_011_webstores.sql</code> in the Supabase SQL editor, then reload this page.
        <br /><br />The migration is purely additive — it only creates new tables and does not touch any existing data.
      </div>
      <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={onRetry}>Retry</button>
    </div></div>
  );
}

// Global webstore defaults — standard section categories, checkout copy, and default add-on
// options seeded onto new items. Saved to the webstore_settings singleton.
function StoreDefaultsModal({ settings, onSave, onClose }) {
  const [cats, setCats] = useState(() => Array.isArray(settings?.standard_categories) ? settings.standard_categories : []);
  const [msg, setMsg] = useState(settings?.checkout_message || '');
  const [opts, setOpts] = useState(() => Array.isArray(settings?.default_options) ? settings.default_options : []);
  const [newCat, setNewCat] = useState('');
  const [saving, setSaving] = useState(false);
  const addCat = (c) => { const v = (c || '').trim(); if (!v || cats.some((x) => x.toLowerCase() === v.toLowerCase())) return; setCats([...cats, v]); setNewCat(''); };
  const presets = CATEGORY_PRESETS.filter((p) => !cats.some((c) => c.toLowerCase() === p.toLowerCase()));
  const save = async () => { setSaving(true); const ok = await onSave({ standard_categories: cats, checkout_message: msg.trim() || null, default_options: cleanItemOptions(opts) }); setSaving(false); if (ok !== false) onClose(); };
  const sec = { fontSize: 12, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3, margin: '4px 0 8px' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 640, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>⚙ Store defaults</div><div style={{ fontSize: 11.5, color: '#64748b' }}>Shared across every webstore</div></div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ marginBottom: 18 }}>
            <div style={sec}>Standard categories <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' }}>· the section options in the builder</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {cats.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>None yet — add the sections reps should pick from.</span>}
              {cats.map((c, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#1e293b', background: '#f1f5f9', borderRadius: 8, padding: '4px 10px' }}>{c}<button onClick={() => setCats(cats.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontWeight: 800, fontSize: 13, padding: 0, lineHeight: 1 }}>×</button></span>)}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input className="form-input" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(newCat); } }} placeholder="Add a section (e.g. Spirit Wear)" style={{ maxWidth: 260 }} />
              <button className="btn btn-sm btn-secondary" onClick={() => addCat(newCat)}>Add</button>
            </div>
            {presets.length > 0 && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{presets.map((p) => <button key={p} onClick={() => addCat(p)} style={{ fontSize: 11, fontWeight: 600, color: '#475569', background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 8, padding: '3px 9px', cursor: 'pointer' }}>+ {p}</button>)}</div>}
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={sec}>Checkout message <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' }}>· shown to shoppers at checkout</span></div>
            <textarea className="form-input" value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} placeholder="e.g. Orders ship to the school once the store closes. Questions? Email your team rep." style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={sec}>Default add-on options <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' }}>· seeded onto new items</span></div>
            <OptionsEditor value={opts} onChange={setOpts} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderTop: '1px solid #eef0f3' }}>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save defaults'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_RANK = { Open: 0, 'Closing soon': 1, Scheduled: 2, Draft: 3, Closed: 4 };
const REP_PALETTE = ['#192853', '#962C32', '#2A6FDB', '#1B7F4B', '#7C3AED', '#0891B2'];

function ListView({ stores, custName, repName, REPS = [], cu, storeStats = {}, onOpen, onNew, onDuplicate, onToggleTemplate, onNewFromTemplate, onStoreDefaults, onStartStoreFromTemplate, onAddTemplateToStore, onCreateFromOmg }) {
  const [view, setView] = useState('stores');
  const [statusFilter, setStatusFilter] = useState('all');
  const [repFilter, setRepFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [sortKey, setSortKey] = useState('status');
  const [sortDir, setSortDir] = useState('asc');
  const [copiedId, setCopiedId] = useState(null);
  // Live-inventory panel (Reporting view): per-store stock for every item.
  const [invStoreId, setInvStoreId] = useState('');
  const [invItems, setInvItems] = useState([]);
  const [invStock, setInvStock] = useState(null); // Map: product_id | 'wp:'+id → { units, sizeStock, ... }
  const [invLoading, setInvLoading] = useState(false);

  const templates = stores.filter((s) => s.is_template);
  const nonTemplates = stores.filter((s) => !s.is_template);

  // Load a store's items + live availability (vendor by SKU + in-house by product_id), same source
  // of truth as every store builder so the numbers match. Unlinked items get a synthetic key so
  // several manual items never collide on a null product id.
  const loadInventory = useCallback(async (storeId) => {
    if (!storeId) { setInvItems([]); setInvStock(null); return; }
    setInvLoading(true);
    try {
      const { data: items } = await supabase.from('webstore_products')
        .select('id,product_id,sku,display_name,image_url,sizes_offered,kind,active')
        .eq('store_id', storeId).eq('active', true).eq('kind', 'single').order('sort_order');
      const rows = items || [];
      const stockRows = rows.map((p) => ({ id: p.product_id || ('wp:' + p.id), sku: p.sku }));
      let stock = new Map();
      try { stock = await fetchStockMap(stockRows); } catch { /* show without stock */ }
      setInvItems(rows); setInvStock(stock);
    } finally { setInvLoading(false); }
  }, []);
  // First time the Reporting view opens, default the picker to the first store.
  useEffect(() => {
    if (view === 'reporting' && !invStoreId && nonTemplates.length) {
      const first = nonTemplates[0].id; setInvStoreId(first); loadInventory(first);
    }
  }, [view, invStoreId, nonTemplates, loadInventory]);

  const money = (n) => '$' + Math.round(n || 0).toLocaleString();
  const moneyK = (n) => { n = n || 0; return n >= 1000 ? '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(n); };
  const initials = (name) => (name || '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const fmt = (d) => { if (!d) return null; const x = new Date(d); return isNaN(x) ? null : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const fmtYear = (d) => { if (!d) return null; const x = new Date(d); return isNaN(x) ? null : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

  const repColorMap = useMemo(() => {
    const m = {};
    REPS.forEach((r, i) => { m[r.id] = REP_PALETTE[i % REP_PALETTE.length]; });
    return m;
  }, [REPS]);

  const storeStatus = (s) => {
    if (s.status === 'closed') return 'Closed';
    if (s.status === 'draft') return 'Draft';
    if (!s.open_at && !s.close_at) return s.status === 'open' ? 'Open' : 'Draft';
    const now = Date.now();
    const openTs = s.open_at ? new Date(s.open_at).getTime() : null;
    const closeTs = s.close_at ? new Date(s.close_at).getTime() : null;
    if (openTs && openTs > now) return 'Scheduled';
    if (closeTs) {
      const diff = (closeTs - now) / 86400000;
      if (diff <= 3 && diff > 0) return 'Closing soon';
    }
    if (s.status === 'open') return 'Open';
    return 'Closed';
  };

  const daysLeft = (s) => {
    if (!s.close_at) return null;
    return Math.ceil((new Date(s.close_at).getTime() - Date.now()) / 86400000);
  };

  const statusStyle = (st) => {
    const map = {
      Open: ['#E3F4EA', '#1B7F4B'],
      'Closing soon': ['#F6E4E5', '#962C32'],
      Scheduled: ['#E4ECF8', '#2A6FDB'],
      Draft: ['#FBEFD6', '#9A6B12'],
      Closed: ['#EAEDF3', '#5A6075'],
    };
    const [bg, fg] = map[st] || ['#EAEDF3', '#5A6075'];
    return { display: 'inline-block', background: bg, color: fg, fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.8px', fontWeight: 700, fontSize: 11.5, padding: '3px 9px', borderRadius: 4, transform: 'skewX(-4deg)', whiteSpace: 'nowrap' };
  };

  const setSort = (key) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); return key; }
      setSortDir(['revenue', 'orders'].includes(key) ? 'desc' : 'asc');
      return key;
    });
  };

  const sortArrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const matchesFilter = (s) => {
    const st = storeStatus(s);
    if (statusFilter !== 'all' && st !== statusFilter) return false;
    if (repFilter !== 'all' && s.rep_id !== repFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!((s.name || '').toLowerCase().includes(q) || (custName(s.customer_id) || '').toLowerCase().includes(q) || (s.slug || '').toLowerCase().includes(q))) return false;
    }
    return true;
  };

  let filtered = nonTemplates.filter(matchesFilter);
  filtered = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    let av, bv;
    switch (sortKey) {
      case 'store': av = a.name; bv = b.name; break;
      case 'status': av = STATUS_RANK[storeStatus(a)]; bv = STATUS_RANK[storeStatus(b)]; break;
      case 'rep': av = repName(a.rep_id); bv = repName(b.rep_id); break;
      case 'revenue': av = (storeStats[a.id] || {}).revenue || 0; bv = (storeStats[b.id] || {}).revenue || 0; break;
      case 'orders': av = (storeStats[a.id] || {}).orders || 0; bv = (storeStats[b.id] || {}).orders || 0; break;
      case 'window': av = daysLeft(a) == null ? 9999 : daysLeft(a); bv = daysLeft(b) == null ? 9999 : daysLeft(b); break;
      default: av = STATUS_RANK[storeStatus(a)]; bv = STATUS_RANK[storeStatus(b)];
    }
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return ((av || 0) - (bv || 0)) * dir;
  });

  // Summary stats
  const allStats = nonTemplates;
  const openCount = allStats.filter((s) => { const st = storeStatus(s); return st === 'Open' || st === 'Closing soon'; }).length;
  const draftCount = allStats.filter((s) => storeStatus(s) === 'Draft').length;
  const closedCount = allStats.filter((s) => storeStatus(s) === 'Closed').length;
  const totalRev = Object.values(storeStats).reduce((a, s) => a + (s.revenue || 0), 0);
  const totalOrders = Object.values(storeStats).reduce((a, s) => a + (s.orders || 0), 0);

  const summaryStats = [
    { label: 'Total Stores', value: allStats.length, sub: openCount + ' currently live', bar: '#192853' },
    { label: 'Open', value: openCount, sub: 'Accepting orders', bar: '#1B7F4B' },
    { label: 'Drafts', value: draftCount, sub: 'Awaiting launch', bar: '#E0A92B' },
    { label: 'Closed', value: closedCount, sub: 'This season', bar: '#5A6075' },
    { label: 'Gross Sales', value: moneyK(totalRev), sub: totalOrders + ' orders', bar: '#962C32' },
    { label: 'Total Orders', value: totalOrders.toLocaleString(), sub: 'Across all stores', bar: '#2A6FDB' },
  ];

  // Status chip counts (against rep+search filtered, ignoring status filter)
  const repSearchSet = nonTemplates.filter((s) => {
    if (repFilter !== 'all' && s.rep_id !== repFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!((s.name || '').toLowerCase().includes(q) || (custName(s.customer_id) || '').toLowerCase().includes(q) || (s.slug || '').toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const statusCounts = { all: repSearchSet.length, Open: 0, 'Closing soon': 0, Scheduled: 0, Draft: 0, Closed: 0 };
  repSearchSet.forEach((s) => { const st = storeStatus(s); if (statusCounts[st] !== undefined) statusCounts[st]++; });

  // Reporting: rep stats
  const repStatsMap = {};
  nonTemplates.forEach((s) => {
    const rid = s.rep_id;
    if (!repStatsMap[rid]) repStatsMap[rid] = { revenue: 0, orders: 0, count: 0 };
    repStatsMap[rid].revenue += (storeStats[s.id] || {}).revenue || 0;
    repStatsMap[rid].orders += (storeStats[s.id] || {}).orders || 0;
    repStatsMap[rid].count++;
  });
  const repLeaderboard = REPS.filter((r) => repStatsMap[r.id]).map((r) => ({
    id: r.id, name: r.name, color: repColorMap[r.id] || '#5A6075',
    revenue: repStatsMap[r.id].revenue, orders: repStatsMap[r.id].orders, count: repStatsMap[r.id].count,
  })).sort((a, b) => b.revenue - a.revenue);
  const maxRepRev = Math.max(1, ...repLeaderboard.map((r) => r.revenue));

  const BCN = { fontFamily: "'Barlow Condensed',sans-serif" };
  const CHIP_BASE = { ...BCN, textTransform: 'uppercase', letterSpacing: '.7px', fontWeight: 700, fontSize: 13, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', border: 'none', display: 'inline-flex', gap: 7, alignItems: 'center', transform: 'skewX(-4deg)', transition: 'all .12s' };
  const chipStyle = (active) => ({ ...CHIP_BASE, background: active ? '#192853' : '#fff', color: active ? '#fff' : '#5A6075', border: active ? '1.5px solid #192853' : '1.5px solid #E2E6EE' });
  const repChipStyle = (active) => ({ fontFamily: "'Source Sans 3',sans-serif", fontWeight: 600, fontSize: 13, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', border: active ? '1.5px solid #192853' : '1.5px solid #E2E6EE', background: active ? '#192853' : '#fff', color: active ? '#fff' : '#5A6075', transition: 'all .12s' });
  const TAB = { ...BCN, textTransform: 'uppercase', letterSpacing: '.8px', fontWeight: 700, fontSize: 14, padding: '8px 18px', borderRadius: 6, cursor: 'pointer', border: 'none', transition: 'all .15s' };
  const tabStyle = (key) => ({ ...TAB, background: view === key ? '#192853' : 'transparent', color: view === key ? '#fff' : '#5A6075', boxShadow: view === key ? '0 3px 10px rgba(25,40,83,.22)' : 'none' });
  const TH = { ...BCN, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, fontSize: 12, color: '#5A6075', padding: '12px', userSelect: 'none' };
  const TD = { padding: '13px 12px', verticalAlign: 'middle' };

  // Column is just the close date on top, a short context line underneath — kept to one
  // line each so row height stays consistent regardless of status.
  const storeWindowText = (s) => {
    const st = storeStatus(s);
    if (st === 'Draft') return { main: '—', sub: 'Draft', subColor: '#8A93A8' };
    if (st === 'Scheduled') return { main: fmt(s.close_at) || '—', sub: 'Opens ' + fmt(s.open_at), subColor: '#2A6FDB' };
    if (st === 'Closed') return { main: fmt(s.close_at) || '—', sub: 'Closed', subColor: '#8A93A8' };
    const dl = daysLeft(s);
    return {
      main: s.close_at ? fmt(s.close_at) : 'No end date',
      sub: dl == null ? 'Open' : dl <= 0 ? 'Closes today' : dl === 1 ? '1 day left' : dl + ' days left',
      subColor: dl != null && dl <= 3 ? '#962C32' : '#1B7F4B',
    };
  };

  return (
    <div>
      {/* Page heading + tabs */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
        <div>
          <div style={{ ...BCN, fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: '#962C32', marginBottom: 4 }}>Sales — Team Stores</div>
          <h1 style={{ ...BCN, fontWeight: 800, fontSize: 36, letterSpacing: '.5px', textTransform: 'uppercase', color: '#192853', margin: 0, lineHeight: 1 }}>
            {view === 'stores' ? 'Club Webstores' : view === 'reporting' ? 'Store Reporting' : 'Store Templates'}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 5, background: '#fff', border: '1px solid #E2E6EE', borderRadius: 9, padding: 5, boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
            {['stores', 'reporting', 'templates'].map((k) => (
              <button key={k} style={tabStyle(k)} onClick={() => setView(k)}>{k.charAt(0).toUpperCase() + k.slice(1)}</button>
            ))}
          </div>
          {onStoreDefaults && <button className="btn btn-secondary" onClick={onStoreDefaults} title="Standard categories, checkout copy & default add-on options for all stores">⚙ Defaults</button>}
          {onCreateFromOmg && <button className="btn btn-secondary" onClick={onCreateFromOmg} title="Turn a shared OMG report link into a new Club Webstore — review & fix SKUs, prices and names first" style={{ borderColor: '#bbf7d0', background: '#f0fdf4', color: '#166534' }}>📥 Create from OMG</button>}
          <button className="btn btn-primary" onClick={onNew}>+ New Store</button>
        </div>
      </div>

      {/* ══════════ STORES VIEW ══════════ */}
      {view === 'stores' && (
        <>
          {/* Summary stats strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 14, marginBottom: 22 }}>
            {summaryStats.map((st) => (
              <div key={st.label} style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 8, padding: '16px 18px', boxShadow: '0 2px 12px rgba(0,0,0,.04)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: st.bar }} />
                <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 11.5, color: '#5A6075' }}>{st.label}</div>
                <div style={{ ...BCN, fontWeight: 800, fontSize: 28, color: '#192853', lineHeight: 1.1, marginTop: 3 }}>{st.value}</div>
                <div style={{ fontSize: 11.5, color: '#8A93A8', marginTop: 1 }}>{st.sub}</div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {[['all', 'All'], ['Open', 'Open'], ['Closing soon', 'Closing Soon'], ['Scheduled', 'Scheduled'], ['Draft', 'Draft'], ['Closed', 'Closed']].map(([key, label]) => (
                <button key={key} style={chipStyle(statusFilter === key)} onClick={() => setStatusFilter(key)}>
                  {label}<span style={{ opacity: .65, fontFamily: "'Source Sans 3',sans-serif", fontWeight: 600 }}>{statusCounts[key] ?? 0}</span>
                </button>
              ))}
            </div>
            <div style={{ height: 24, width: 1, background: '#D1D5DE' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...BCN, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 11.5, color: '#5A6075' }}>Rep</span>
              <select className="form-select" value={repFilter} onChange={(e) => setRepFilter(e.target.value)} style={{ fontSize: 13, padding: '6px 10px', minWidth: 140 }}>
                <option value="all">All reps</option>
                {REPS.filter((r) => nonTemplates.some((s) => s.rep_id === r.id)).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9, background: '#fff', border: '1px solid #D1D5DE', borderRadius: 7, padding: '7px 12px', minWidth: 210 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A93A8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter stores…" style={{ border: 'none', outline: 'none', fontFamily: "'Source Sans 3',sans-serif", fontSize: 14, color: '#2A2F3E', width: '100%', background: 'transparent' }} />
            </div>
          </div>

          {/* Table */}
          <div style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 10, boxShadow: '0 2px 12px rgba(0,0,0,.05)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#FAFBFD', borderBottom: '1.5px solid #EEF1F6' }}>
                  <th style={{ ...TH, width: 34, padding: '12px 8px' }}></th>
                  <th onClick={() => setSort('store')} style={{ ...TH, textAlign: 'left', cursor: 'pointer' }}>Store{sortArrow('store')}</th>
                  <th onClick={() => setSort('status')} style={{ ...TH, textAlign: 'left', cursor: 'pointer' }}>Status{sortArrow('status')}</th>
                  <th onClick={() => setSort('rep')} style={{ ...TH, textAlign: 'left', cursor: 'pointer' }}>Rep{sortArrow('rep')}</th>
                  <th onClick={() => setSort('revenue')} style={{ ...TH, textAlign: 'right', cursor: 'pointer' }}>Revenue{sortArrow('revenue')}</th>
                  <th onClick={() => setSort('orders')} style={{ ...TH, textAlign: 'right', cursor: 'pointer' }}>Orders{sortArrow('orders')}</th>
                  <th onClick={() => setSort('window')} style={{ ...TH, textAlign: 'left', cursor: 'pointer' }}>Close{sortArrow('window')}</th>
                  <th style={{ ...TH, textAlign: 'left', padding: '12px 16px 12px 12px' }}>Storefront</th>
                  <th style={{ ...TH, width: 28 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const st = storeStatus(s);
                  const ss = storeStats[s.id] || { revenue: 0, orders: 0 };
                  const rn = repName(s.rep_id);
                  const rc = repColorMap[s.rep_id] || '#5A6075';
                  const isExp = !!expanded[s.id];
                  const wt = storeWindowText(s);
                  const coachReview = s.created_via === 'coach' && s.status === 'draft';
                  return (
                    <React.Fragment key={s.id}>
                      <tr
                        onClick={() => setExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))}
                        style={{ cursor: 'pointer', borderBottom: isExp ? 'none' : '1px solid #EEF1F6', background: isExp ? '#FAFBFD' : '#fff', transition: 'background .1s' }}
                        onMouseEnter={(e) => { if (!isExp) e.currentTarget.style.background = '#FAFBFD'; }}
                        onMouseLeave={(e) => { if (!isExp) e.currentTarget.style.background = '#fff'; }}
                      >
                        <td style={{ ...TD, textAlign: 'center', color: '#8A93A8', padding: '13px 8px' }}>
                          <span style={{ display: 'inline-block', transition: 'transform .15s', transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 11 }}>▶</span>
                        </td>
                        <td style={{ ...TD, maxWidth: 260 }}>
                          <div style={{ fontWeight: 700, color: '#192853', fontSize: 15, lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span title={s.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.name}</span>
                            {coachReview && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 4 }}>★ Review</span>}
                          </div>
                          <div title={custName(s.customer_id)} style={{ color: '#8A93A8', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName(s.customer_id)}</div>
                        </td>
                        <td style={TD}><span style={statusStyle(st)}>{st}</span></td>
                        <td style={TD}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 26, height: 26, borderRadius: '50%', background: rc, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...BCN, fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{initials(rn)}</div>
                            <span style={{ color: '#2A2F3E', fontWeight: 600 }}>{rn}</span>
                          </div>
                        </td>
                        <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#192853' }}>{ss.revenue ? money(ss.revenue) : <span style={{ color: '#D1D5DE' }}>—</span>}</td>
                        <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2A2F3E' }}>{ss.orders || <span style={{ color: '#D1D5DE' }}>—</span>}</td>
                        <td style={TD}>
                          <div style={{ fontWeight: 600, color: '#2A2F3E' }}>{wt.main}</div>
                          <div style={{ fontSize: 12, color: wt.subColor, fontWeight: 600 }}>{wt.sub}</div>
                        </td>
                        <td style={{ ...TD, padding: '13px 16px 13px 12px' }}>
                          <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#8A93A8', wordBreak: 'break-all' }}>/shop/{s.slug}</div>
                        </td>
                        <td style={{ ...TD, padding: '13px 12px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                            {onToggleTemplate && <button title={s.is_template ? 'Remove template' : 'Save as template'} onClick={(e) => { e.stopPropagation(); onToggleTemplate(s); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: s.is_template ? '#E0A92B' : '#D1D5DE' }}>{s.is_template ? '★' : '☆'}</button>}
                            <button
                              title="Copy store link"
                              onClick={(e) => {
                                e.stopPropagation();
                                const url = 'https://nationalsportsapparel.com/shop/' + s.slug;
                                navigator.clipboard.writeText(url).catch(() => {});
                                setCopiedId(s.id);
                                setTimeout(() => setCopiedId((cur) => cur === s.id ? null : cur), 1800);
                              }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: copiedId === s.id ? '#dcfce7' : '#f1f5f9', color: copiedId === s.id ? '#15803d' : '#64748b', border: `1px solid ${copiedId === s.id ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: 7, padding: '7px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s' }}
                            >
                              {copiedId === s.id
                                ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied</>
                                : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</>
                              }
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onOpen(s); }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#192853', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              Store
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExp && (
                        <tr style={{ borderBottom: '1px solid #EEF1F6' }}>
                          <td colSpan={9} style={{ padding: 0, background: '#FAFBFD' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.9fr', gap: 26, padding: '22px 24px 24px 50px', animation: 'wsExpand .18s ease-out' }}>
                              {/* Col 1: Sales Reporting */}
                              <div>
                                <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, fontSize: 12, color: '#962C32', marginBottom: 12 }}>Sales Reporting</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px', marginBottom: 16 }}>
                                  {[
                                    ['Gross Sales', ss.revenue ? money(ss.revenue) : '—'],
                                    ['Orders', ss.orders ? ss.orders.toLocaleString() : '—'],
                                    ['Avg Order', ss.orders ? money(ss.revenue / ss.orders) : '—'],
                                    ['Catalog Items', s.catalog_count ?? '—'],
                                  ].map(([label, val]) => (
                                    <div key={label}>
                                      <div style={{ fontSize: 11.5, color: '#8A93A8', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600 }}>{label}</div>
                                      <div style={{ ...BCN, fontWeight: 800, fontSize: 24, color: '#192853', lineHeight: 1.1 }}>{val}</div>
                                    </div>
                                  ))}
                                </div>
                                <button className="btn btn-sm btn-secondary" onClick={() => onOpen(s)}>Open Orders Tab →</button>
                              </div>
                              {/* Col 2: Store URL + quick links */}
                              <div>
                                <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, fontSize: 12, color: '#962C32', marginBottom: 12 }}>Storefront</div>
                                <div style={{ fontSize: 13.5, color: '#2A6FDB', fontFamily: 'monospace', marginBottom: 12, wordBreak: 'break-all' }}>/shop/{s.slug}</div>
                                <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, fontSize: 12, color: '#962C32', marginBottom: 8, marginTop: 4 }}>Links</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  <a className="btn btn-sm btn-secondary" href={'/shop/' + s.slug} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>View Storefront ↗</a>
                                  {onDuplicate && <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onDuplicate(s); }}>Duplicate</button>}
                                  {onDuplicate && <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onDuplicate(s, { rebrand: true }); }}>Clone &amp; Rebrand</button>}
                                </div>
                              </div>
                              {/* Col 3: Store Setup */}
                              <div>
                                <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, fontSize: 12, color: '#962C32', marginBottom: 12 }}>Store Setup</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13.5, marginBottom: 16 }}>
                                  {[
                                    ['Payment', s.payment_mode === 'either' ? 'Paid + Invoice' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only'],
                                    ['Delivery', s.delivery_mode === 'deliver_club' ? 'Deliver to club' : 'Ship to home'],
                                    ['Numbers', s.number_enabled ? (s.number_unique ? 'Unique #s' : 'On') : '—'],
                                    ['Opened', fmtYear(s.open_at) || 'Not opened'],
                                    ['Closes', fmtYear(s.close_at) || 'No close date'],
                                  ].map(([label, val]) => (
                                    <React.Fragment key={label}>
                                      <span style={{ color: '#8A93A8' }}>{label}</span>
                                      <span style={{ color: '#2A2F3E', fontWeight: 600 }}>{val}</span>
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 48, textAlign: 'center', color: '#8A93A8', fontSize: 15 }}>No stores match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {nonTemplates.length > 0 && <div style={{ marginTop: 10, fontSize: 13, color: '#8A93A8' }}>Showing {filtered.length} of {nonTemplates.length} stores</div>}
        </>
      )}

      {/* ══════════ REPORTING VIEW ══════════ */}
      {view === 'reporting' && (
        <>
          {/* KPI tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
            {[
              { label: 'Gross Sales', value: moneyK(totalRev) },
              { label: 'Orders', value: totalOrders.toLocaleString() },
              { label: 'Avg Order', value: totalOrders ? money(totalRev / totalOrders) : '—' },
              { label: 'Open Stores', value: openCount },
            ].map((k) => (
              <div key={k.label} style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 8, padding: '16px 18px', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
                <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 12, color: '#5A6075' }}>{k.label}</div>
                <div style={{ ...BCN, fontWeight: 800, fontSize: 30, color: '#192853', lineHeight: 1.1, marginTop: 3 }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Live Inventory — per-store stock for every item */}
          <div style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 10, boxShadow: '0 2px 12px rgba(0,0,0,.05)', padding: '20px 22px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 800, fontSize: 19, color: '#192853' }}>Live Inventory</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select value={invStoreId} onChange={(e) => { setInvStoreId(e.target.value); loadInventory(e.target.value); }}
                  style={{ padding: '7px 10px', border: '1px solid #C3CAD8', borderRadius: 7, fontSize: 13, fontWeight: 600, color: '#192853', background: '#fff', maxWidth: 300 }}>
                  <option value="">Choose a store…</option>
                  {nonTemplates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={() => loadInventory(invStoreId)} disabled={!invStoreId || invLoading} title="Refresh live stock"
                  style={{ padding: '7px 12px', border: '1px solid #C3CAD8', borderRadius: 7, background: '#fff', fontSize: 12.5, fontWeight: 700, color: '#2A2F3E', cursor: (!invStoreId || invLoading) ? 'default' : 'pointer' }}>{invLoading ? '…' : '↻ Refresh'}</button>
              </div>
            </div>
            {!invStoreId ? (
              <div style={{ fontSize: 14, color: '#8A93A8' }}>Pick a store to see live stock for every item.</div>
            ) : invLoading ? (
              <div style={{ fontSize: 14, color: '#8A93A8' }}>Checking live stock…</div>
            ) : invItems.length === 0 ? (
              <div style={{ fontSize: 14, color: '#8A93A8' }}>No items on this store.</div>
            ) : (() => {
              const pill = (bg, fg) => ({ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: bg, color: fg, whiteSpace: 'nowrap' });
              let inStock = 0, out = 0, unlinked = 0;
              const rowData = invItems.map((p) => {
                const key = p.product_id || ('wp:' + p.id);
                const st = invStock && invStock.get(key);
                const offered = foldScale(Array.isArray(p.sizes_offered) ? p.sizes_offered : []);
                const stockOf = (sz) => (st && st.sizeStock && st.sizeStock[sz]) || 0;
                const list = offered.length ? offered : (st ? st.sizes : []);
                const sizeRows = list.map((sz) => ({ sz, q: foldedQty(sz, stockOf) }));
                const total = sizeRows.reduce((a, s) => a + s.q, 0);
                const linked = !!p.product_id;
                if (!linked && !(st && st.units)) unlinked++;
                else if (total > 0) inStock++;
                else out++;
                return { p, sizeRows, total, linked };
              });
              return (
                <>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12.5, color: '#5A6075', flexWrap: 'wrap' }}>
                    <span><b style={{ color: '#1B7F4B' }}>{inStock}</b> in stock</span>
                    <span><b style={{ color: '#962C32' }}>{out}</b> out</span>
                    {unlinked > 0 && <span><b style={{ color: '#9A6B00' }}>{unlinked}</b> not linked to catalog</span>}
                    <span style={{ color: '#8A93A8' }}>· {invItems.length} item{invItems.length === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ color: '#8A93A8', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                        <th style={{ padding: '8px', borderBottom: '1px solid #EEF1F6', textAlign: 'left' }}>Item</th>
                        <th style={{ padding: '8px', borderBottom: '1px solid #EEF1F6', textAlign: 'left' }}>Sizes — live stock</th>
                        <th style={{ padding: '8px', borderBottom: '1px solid #EEF1F6', textAlign: 'right' }}>Total</th>
                        <th style={{ padding: '8px', borderBottom: '1px solid #EEF1F6', textAlign: 'left' }}>Status</th>
                      </tr></thead>
                      <tbody>
                        {rowData.map(({ p, sizeRows, total, linked }) => (
                          <tr key={p.id}>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F4F6FA' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {p.image_url ? <img src={p.image_url} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 5, border: '1px solid #EEF1F6' }} /> : <div style={{ width: 34, height: 34, borderRadius: 5, background: '#F4F6FA' }} />}
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, color: '#192853', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 230 }}>{p.display_name || p.sku || 'Item'}</div>
                                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#8A93A8' }}>{p.sku || '—'}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F4F6FA' }}>
                              {sizeRows.length ? (
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                  {sizeRows.map(({ sz, q }) => (
                                    <span key={sz} title={`${q} available`} style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: q > 0 ? '#E7F5EE' : '#FBEBEC', color: q > 0 ? '#1B7F4B' : '#962C32', border: `1px solid ${q > 0 ? '#BFE6D0' : '#F3C7CB'}` }}>{sz}&nbsp;{q}</span>
                                  ))}
                                </div>
                              ) : <span style={{ color: '#8A93A8', fontSize: 12 }}>{linked ? 'No stock data' : 'Not linked — add a catalog SKU'}</span>}
                            </td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F4F6FA', textAlign: 'right', fontWeight: 800, color: total > 0 ? '#192853' : '#962C32' }}>{total}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F4F6FA' }}>
                              {!linked ? <span style={pill('#FDF3DA', '#9A6B00')}>⚠ not linked</span>
                                : total > 0 ? <span style={pill('#E7F5EE', '#1B7F4B')}>In stock</span>
                                  : <span style={pill('#FBEBEC', '#962C32')}>Out of stock</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Sales by Rep */}
          <div style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 10, boxShadow: '0 2px 12px rgba(0,0,0,.05)', padding: '20px 22px', marginBottom: 16 }}>
            <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 800, fontSize: 19, color: '#192853', marginBottom: 12 }}>Sales by Rep</div>
            {repLeaderboard.length === 0 && <div style={{ fontSize: 14, color: '#8A93A8' }}>No sales data yet.</div>}
            {repLeaderboard.map((r) => {
              const share = (r.revenue / Math.max(1, totalRev) * 100).toFixed(1);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderBottom: '1px solid #EEF1F6' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: r.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...BCN, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{initials(r.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: '#192853', fontSize: 14.5 }}>{r.name}</span>
                      <span style={{ ...BCN, fontWeight: 800, fontSize: 18, color: '#192853' }}>{moneyK(r.revenue)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#8A93A8', margin: '2px 0 7px' }}>{r.count} store{r.count === 1 ? '' : 's'} · {r.orders} order{r.orders === 1 ? '' : 's'} · {share}% of total</div>
                    <div style={{ height: 6, borderRadius: 3, background: '#EEF1F6', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: (r.revenue / maxRepRev * 100).toFixed(1) + '%', background: r.color, borderRadius: 3 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stores by status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 10, boxShadow: '0 2px 12px rgba(0,0,0,.05)', padding: '20px 22px' }}>
              <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 800, fontSize: 19, color: '#192853', marginBottom: 16 }}>Stores by Status</div>
              {[['Open', '#1B7F4B'], ['Closing soon', '#962C32'], ['Scheduled', '#2A6FDB'], ['Draft', '#E0A92B'], ['Closed', '#5A6075']].map(([st, color]) => {
                const count = nonTemplates.filter((s) => storeStatus(s) === st).length;
                return (
                  <div key={st} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 4 }}>
                      <span style={{ color: '#2A2F3E', fontWeight: 600 }}>{st}</span>
                      <span style={{ color: '#8A93A8' }}>{count} store{count === 1 ? '' : 's'}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: '#EEF1F6', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: (count / Math.max(1, nonTemplates.length) * 100).toFixed(0) + '%', background: color, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 10, boxShadow: '0 2px 12px rgba(0,0,0,.05)', padding: '20px 22px' }}>
              <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 800, fontSize: 19, color: '#192853', marginBottom: 16 }}>Top Stores <span style={{ color: '#962C32', fontStyle: 'italic' }}>by Revenue</span></div>
              {nonTemplates.filter((s) => (storeStats[s.id] || {}).revenue > 0).sort((a, b) => (storeStats[b.id]?.revenue || 0) - (storeStats[a.id]?.revenue || 0)).slice(0, 8).map((s, i) => {
                const rev = storeStats[s.id]?.revenue || 0;
                const maxR = Math.max(1, ...nonTemplates.map((x) => storeStats[x.id]?.revenue || 0));
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? '#962C32' : '#192853', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...BCN, fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, marginBottom: 3 }}>
                        <span style={{ color: '#2A2F3E', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        <span style={{ color: '#8A93A8', whiteSpace: 'nowrap' }}>{money(rev)}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: '#EEF1F6', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: (rev / maxR * 100).toFixed(0) + '%', background: '#192853', borderRadius: 3 }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {nonTemplates.filter((s) => (storeStats[s.id] || {}).revenue > 0).length === 0 && <div style={{ fontSize: 14, color: '#8A93A8' }}>No revenue data yet.</div>}
            </div>
          </div>
        </>
      )}

      {/* ══════════ TEMPLATES VIEW ══════════ */}
      {view === 'templates' && (
        <>
          <TemplateManager REPS={REPS} cu={cu} onStartStore={onStartStoreFromTemplate} onAddToStore={onAddTemplateToStore} />

          <div style={{ borderTop: '1px solid #E5E9F0', margin: '38px 0 26px' }} />
          <div style={{ ...BCN, textTransform: 'uppercase', fontWeight: 800, fontSize: 17, color: '#192853', letterSpacing: '.5px', marginBottom: 8 }}>Store Templates</div>
          <div style={{ marginBottom: 20, fontSize: 15, color: '#5A6075', maxWidth: 660, lineHeight: 1.6 }}>Spin up a new team store in seconds. Pick a template — gear, delivery, payment and numbering come pre-loaded. Rebrand and adjust anything before you launch.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 18 }}>
            {/* Blank store card */}
            <button onClick={onNew} style={{ textAlign: 'center', cursor: 'pointer', background: '#fff', border: '2px dashed #C3CAD8', borderRadius: 10, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: 12, color: '#5A6075', fontFamily: 'inherit', transition: 'all .15s' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#EEF1F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#192853" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </div>
              <div style={{ ...BCN, textTransform: 'uppercase', fontWeight: 800, fontSize: 19, color: '#192853', letterSpacing: '.5px' }}>Start from Blank</div>
              <div style={{ fontSize: 13 }}>Build a store from scratch</div>
            </button>
            {templates.map((t) => {
              const pay = t.payment_mode === 'either' ? 'Paid + Invoice' : t.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only';
              const deliver = t.delivery_mode === 'deliver_club' ? 'Deliver to club' : 'Ship to home';
              const nums = t.number_enabled ? (t.number_unique ? 'Unique #s' : 'On') : 'Off';
              return (
                <div key={t.id} style={{ background: '#fff', border: '1px solid #EEF1F6', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.05)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ position: 'relative', height: 88, background: 'linear-gradient(135deg,#1c2d4f,#0F1A38)', padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(-55deg,rgba(255,255,255,0.05) 0 1px,transparent 1px 9px)' }} />
                    <div style={{ position: 'relative', ...BCN, textTransform: 'uppercase', fontWeight: 800, fontSize: 20, letterSpacing: '.5px', color: '#fff', lineHeight: 1 }}>{t.name}</div>
                  </div>
                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '8px 0', borderBottom: '1px solid #EEF1F6' }}>
                      {[['Delivery', deliver], ['Payment', pay], ['Numbers', nums]].map(([l, v]) => (
                        <div key={l}>
                          <div style={{ ...BCN, textTransform: 'uppercase', letterSpacing: '.5px', fontSize: 10.5, fontWeight: 700, color: '#8A93A8' }}>{l}</div>
                          <div style={{ fontSize: 12.5, color: '#2A2F3E', fontWeight: 600, lineHeight: 1.2, marginTop: 2 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                      {onNewFromTemplate && <button className="btn btn-sm btn-primary" onClick={() => onNewFromTemplate(t)} style={{ flex: 1 }}>Start Store</button>}
                      {onToggleTemplate && <button className="btn btn-sm btn-secondary" onClick={() => onToggleTemplate(t)}>Remove Template</button>}
                    </div>
                  </div>
                </div>
              );
            })}
            {templates.length === 0 && (
              <div style={{ gridColumn: '1/-1', padding: '24px', fontSize: 14, color: '#8A93A8' }}>No templates yet. Mark a store as ☆ Template from the Stores list to add it here.</div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes wsExpand{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:translateY(0);}}`}</style>
    </div>
  );
}

function Quick({ label, children }) {
  return <div style={{ flex: '0 0 auto' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#94a3b8' }}>{label}</div><div style={{ fontSize: 13, color: '#1e293b', fontWeight: 600, marginTop: 2 }}>{children}</div></div>;
}

function Chip({ label, tone = 'slate' }) {
  const tones = { slate: { bg: '#f1f5f9', fg: '#475569' }, green: { bg: '#dcfce7', fg: '#166534' }, blue: { bg: '#dbeafe', fg: '#1e40af' }, gray: { bg: '#f8fafc', fg: '#94a3b8' }, amber: { bg: '#fef3c7', fg: '#92400e' } };
  const t = tones[tone] || tones.slate;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: t.bg, color: t.fg, fontFamily: tone === 'gray' ? 'monospace' : 'inherit' }}>{label}</span>;
}

// Type-ahead club picker — the customer list is ~2k rows, so a dropdown is
// unusable. Filters the in-memory parents list as you type.
function CustomerPicker({ customers, value, onChange, placeholder }) {
  const selected = customers.find((c) => c.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  // Searchable haystack per customer: its OWN name + alpha PLUS its parent's name
  // + alpha. That lets a team (child) be found by the parent org's tag too — e.g.
  // "OLU football" -> Orange Lutheran Football, "DHHS football" -> Dana Hills Football.
  const index = useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c]));
    return customers.map((c) => {
      const p = c.parent_id ? byId.get(c.parent_id) : null;
      const hay = [c.name, c.alpha_tag, p && p.name, p && p.alpha_tag].filter(Boolean).join(' ').toLowerCase();
      return { c, hay };
    });
  }, [customers]);
  // Token search like the global bar: EVERY word in the query must appear somewhere
  // in the haystack (any order, any field) — not as one contiguous substring. This is
  // what makes "olu football" (alpha + sport, from different fields) match.
  const matches = useMemo(() => {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    const out = [];
    for (const { c, hay } of index) {
      if (c.is_active === false) continue;
      if (toks.every((t) => hay.includes(t))) { out.push(c); if (out.length >= 30) break; }
    }
    return out;
  }, [q, index]);
  if (selected && !open) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="form-input" style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#f8fafc' }}>{selected.name}{selected.alpha_tag ? ` (${selected.alpha_tag})` : ''}</div>
      <button className="btn btn-sm btn-secondary" onClick={() => { onChange(''); setQ(''); setOpen(true); }}>Change</button>
    </div>;
  }
  return (
    <div style={{ position: 'relative' }}>
      <input className="form-input" autoFocus={open} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder={placeholder || 'Search by name…'} onFocus={() => setOpen(true)} />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {matches.map((c) => <div key={c.id} onClick={() => { onChange(c.id); setOpen(false); setQ(''); }} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>{c.name}{c.alpha_tag ? <span style={{ color: '#94a3b8' }}>{` · ${c.alpha_tag}`}</span> : ''}</div>)}
        </div>
      )}
      {open && q.trim().length >= 1 && matches.length === 0 && <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, padding: '8px 12px', fontSize: 12, color: '#94a3b8' }}>No matches.</div>}
    </div>
  );
}

// ── Store create / edit form ─────────────────────────────────────────
const BLANK = {
  name: '', slug: '', customer_id: '', rep_id: '', csr_id: '', status: 'draft',
  open_at: '', close_at: '',
  payment_mode: 'paid', require_login: false,
  delivery_mode: 'ship_home',
  shipstation_store_id: '', shipstation_tag_id: '', shipstation_carrier: 'ups', shipstation_service: '', label_weight_lbs: 1, flat_shipping: 0,
  director_name: '', director_email: '', director_phone: '',
  number_enabled: false, number_unique: true, number_min: 0, number_max: 99,
  so_creation: 'manual',
  fundraise_enabled: false, fundraise_show_parents: false, fundraise_pct: 0, fundraise_flat: 0, fundraise_round: false,
  processing_pct: 5,
  size_upcharge_enabled: true,
  public_listed: true,
  decoration_mode: 'in_house',
  theme: 'classic', primary_color: '#0f172a', accent_color: '#2563eb', logo_url: '', banner_url: '', hero_blurb: '',
  featured_product_ids: null,
};
// Trim a timestamptz to the yyyy-mm-dd a <input type=date> expects.
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
function StoreForm({ store, cust, REPS, repCsr = [], onCancel, onSave, onImportFromOmg, initialOverrides }) {
  const [f, setF] = useState(() => ({ ...BLANK, ...(store || {}), ...(initialOverrides || {}), open_at: dateOnly(store?.open_at), close_at: dateOnly(store?.close_at) }));
  const [slugTouched, setSlugTouched] = useState(!!store);
  // Once the name is hand-edited we stop auto-naming from the linked customer. A name carried
  // in from the OMG wizard counts as "touched" too, so picking a customer here doesn't clobber it.
  const [nameTouched, setNameTouched] = useState(!!(store && store.name) || !!(initialOverrides && initialOverrides.name));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Two pages so nothing scrolls: setup first, then delivery + branding.
  const [page, setPage] = useState('setup');
  // Count of in-flight image uploads — block save until they finish so a slow
  // banner/logo upload can't be left out of the saved store (the create races the
  // upload otherwise: the small logo lands, the larger banner doesn't).
  const [uploading, setUploading] = useState(0);
  const onUpBusy = (b) => setUploading((n) => Math.max(0, n + (b ? 1 : -1)));
  // Products for the "Featured items" hero picker (only meaningful once the
  // store exists and has products). Loaded lazily on the branding page.
  const [featProducts, setFeatProducts] = useState([]);
  useEffect(() => {
    if (!store?.id) return;
    let live = true;
    Promise.all([
      supabase.from('webstore_storefront_products')
        .select('webstore_product_id,name,image_front_url,category,kind,sort_order')
        .eq('store_id', store.id).order('sort_order'),
      supabase.from('webstore_products')
        .select('id,display_name,image_url')
        .eq('store_id', store.id).eq('active', false),
    ]).then(([{ data: vis }, { data: arch }]) => {
      if (!live) return;
      const visSet = new Set((vis || []).map((p) => p.webstore_product_id));
      const archItems = (arch || []).filter((p) => !visSet.has(p.id)).map((p) => ({
        webstore_product_id: p.id, name: p.display_name || '(unnamed)',
        image_front_url: p.image_url || null, kind: 'single', sort_order: 99999, _archived: true,
      }));
      setFeatProducts([...(vis || []).filter((p) => p.kind !== 'bundle'), ...archItems]);
    });
    return () => { live = false; };
  }, [store?.id]);
  // Team vs club only relabels the form (most stores are team stores). The
  // customer link is the same either way; defaults to team.
  const [orgType, setOrgType] = useState(store?.org_type || 'team');
  const noun = orgType === 'club' ? 'Club' : 'Team';
  const lead = orgType === 'club' ? 'Director' : 'Coach';
  // Fundraise mode: percent of price, or flat $ per item. Derived from whichever
  // column is set on an existing store; defaults to percent.
  const [fundMode, setFundMode] = useState(Number(store?.fundraise_flat) > 0 ? 'flat' : 'pct');
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setName = (v) => { setNameTouched(true); setF((p) => ({ ...p, name: v, slug: slugTouched ? p.slug : slugify(v) })); };
  // Auto-name the store from the customer's readable NAME (not its tag). The team
  // (child) record already carries the sport, so "Dana Hills Football" → "Dana Hills
  // Football Team Store"; a parent org → "<name> <noun> Store".
  const storeNameFor = (customerId, nounArg) => {
    const c = cust.find((x) => x.id === customerId);
    if (!c) return '';
    const base = (c.name || c.alpha_tag || '').trim();
    return base ? `${base} ${nounArg} Store` : '';
  };
  // Linking a customer also pulls its (or its parent's) rep + pantone colors and,
  // unless the name's been hand-edited, names the store.
  const applyCustomer = (id) => {
    const c = cust.find((x) => x.id === id);
    const parent = c && c.parent_id ? cust.find((x) => x.id === c.parent_id) : null;
    const pcs = (c && c.pantone_colors && c.pantone_colors.length ? c.pantone_colors : (parent && parent.pantone_colors)) || [];
    const ph = (i) => { const pc = pcs[i]; return pc ? (pantoneHex(pc.code) || pc.hex || '') : ''; };
    const autoName = storeNameFor(id, noun);
    const resolvedRep = (c && c.primary_rep_id) || (parent && parent.primary_rep_id) || f.rep_id;
    const primCsr = primaryCsrForRep(resolvedRep);
    setF((p) => ({
      ...p, customer_id: id,
      rep_id: resolvedRep || p.rep_id,
      csr_id: primCsr || p.csr_id,
      primary_color: ph(0) || p.primary_color, accent_color: ph(1) || p.accent_color,
      name: nameTouched ? p.name : (autoName || p.name),
      slug: nameTouched || slugTouched ? p.slug : (autoName ? slugify(autoName) : p.slug),
    }));
  };
  // Switching team/club re-labels the auto-name too (OLu Football Team Store → Club Store).
  const switchOrg = (t) => {
    setOrgType(t);
    if (!nameTouched && f.customer_id) {
      const nn = t === 'club' ? 'Club' : 'Team';
      const autoName = storeNameFor(f.customer_id, nn);
      if (autoName) setF((p) => ({ ...p, name: autoName, slug: slugTouched ? p.slug : slugify(autoName) }));
    }
  };
  // Build a fresh hero blurb from the store's own details — coach-approved, the
  // chosen delivery method, and the ~4-5 week post-close timeline. Varies each click.
  const genBlurb = () => {
    const team = (f.name || '').replace(/\s*(team |club )?store$/i, '').trim() || 'our team';
    const deliver = f.delivery_mode === 'ship_home' ? 'shipped right to your door' : `delivered to the ${noun.toLowerCase()}`;
    const closeOn = f.close_at ? ` on ${new Date(f.close_at + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : '';
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const open = pick([`Welcome to the official ${team} store!`, `The ${team} store is open!`, `Gear up — the official ${team} store is here.`]);
    const body = pick([`Everything here has been hand-picked and approved by your coaching staff, so you can order with confidence.`, `Every item is pre-approved by your coaches — no guesswork, just official gear.`, `It's all coach-approved, so the whole ${noun.toLowerCase()} looks the part.`]);
    const close = pick([`Orders are ${deliver} about 4–5 weeks after the store closes${closeOn}, so get yours in before the window shuts.`, `Once we close${closeOn}, orders go to production and arrive ${deliver} in roughly 4–5 weeks — don't miss it.`, `Place your order before the store closes${closeOn}; everything is ${deliver} about 4–5 weeks later.`]);
    return `${open} ${body} ${close}`;
  };
  // Sales reps: anyone who carries accounts. The owners (admins) are the primary rep
  // on hundreds of customers, so include them too — filtering to role==='rep' alone
  // hid the auto-set rep for ~25% of customers (it was set in state but had no option
  // to render, so the dropdown showed "—").
  const salesReps = (REPS || []).filter((r) => (r.role === 'rep' || r.role === 'admin') && r.is_active !== false);
  // Whatever rep is actually assigned must always be selectable, even if their role
  // (accounting/csr) or active flag would otherwise drop them from the list.
  const repOptions = (() => {
    const list = salesReps.slice();
    if (f.rep_id && !list.some((r) => r.id === f.rep_id)) {
      const cur = (REPS || []).find((r) => r.id === f.rep_id);
      if (cur) list.push(cur);
    }
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  })();
  // CSRs assigned to the selected rep (rep_csr_assignments), primary first. If the
  // rep has none assigned, fall back to all CSRs so the field is never empty — but
  // never the whole staff list.
  const allCsrs = (REPS || []).filter((r) => r.role === 'csr' && r.is_active !== false);
  const csrIdsForRep = (repId) => (repCsr || []).filter((a) => a.rep_id === repId && a.is_active !== false)
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)).map((a) => a.csr_id);
  const primaryCsrForRep = (repId) => {
    const a = (repCsr || []).find((x) => x.rep_id === repId && x.is_active !== false && x.is_primary);
    return a ? a.csr_id : (csrIdsForRep(repId)[0] || '');
  };
  const csrOptions = (() => {
    const ids = f.rep_id ? csrIdsForRep(f.rep_id) : [];
    let list = ids.length ? ids.map((id) => (REPS || []).find((r) => r.id === id)).filter(Boolean) : allCsrs.slice();
    list = list.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (f.csr_id && !list.some((r) => r.id === f.csr_id)) {
      const cur = (REPS || []).find((r) => r.id === f.csr_id);
      if (cur) list = [cur, ...list];
    }
    return list;
  })();

  const submit = async () => {
    setError('');
    if (uploading > 0) return setError("Hold on — an image is still uploading. It'll just be a moment.");
    if (!f.name.trim()) return setError('Store name is required.');
    if (!f.slug.trim()) return setError('A URL slug is required.');
    setBusy(true);
    // Only send known columns (strip view-only / id fields if editing).
    const payload = { ...BLANK, ...f };
    delete payload.id; delete payload.created_at; delete payload.updated_at;
    payload.number_min = Number(payload.number_min) || 0;
    payload.number_max = Number(payload.number_max) || 99;
    payload.customer_id = payload.customer_id || null;
    payload.rep_id = payload.rep_id || null;
    payload.csr_id = payload.csr_id || null;
    payload.open_at = payload.open_at || null;
    payload.close_at = payload.close_at || null;
    payload.label_weight_lbs = Number(payload.label_weight_lbs) || 1;
    payload.flat_shipping = Number(payload.flat_shipping) || 0;
    payload.processing_pct = Math.max(0, Number(payload.processing_pct) || 0);
    payload.org_type = orgType;
    // Team stores collect numbers per item (Catalog), so there's no store-wide
    // enable toggle — mark numbers active so order views/claims behave.
    if (orgType !== 'club') payload.number_enabled = true;
    // Normalize the store-level fundraising rule: keep only the active mode.
    payload.fundraise_pct = Number(payload.fundraise_pct) || 0;
    payload.fundraise_flat = Number(payload.fundraise_flat) || 0;
    payload.fundraise_round = !!payload.fundraise_round;
    if (!payload.fundraise_enabled) { payload.fundraise_pct = 0; payload.fundraise_flat = 0; payload.fundraise_round = false; }
    else if (fundMode === 'pct') payload.fundraise_flat = 0;
    else payload.fundraise_pct = 0;
    const r = await onSave(payload);
    setBusy(false);
    if (r?.error) setError(r.error.message || 'Save failed.');
  };

  return (
    <div className="ws-form" style={{ maxWidth: 1040, fontFamily: BODY, color: '#191919', paddingBottom: 8 }}>
      <CatalogKitStyles />
      <style>{`
        .ws-form .form-input,.ws-form .form-select,.ws-form textarea{width:100%;box-sizing:border-box;border:1px solid #e2e6ec;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;color:#191919;background:#fff;outline:none;transition:border-color .12s,box-shadow .12s}
        .ws-form .form-input::placeholder,.ws-form textarea::placeholder{color:#aab1bd}
        .ws-form .form-input:focus,.ws-form .form-select:focus,.ws-form textarea:focus{border-color:#191919;box-shadow:0 0 0 3px rgba(25,25,25,.07)}
        .ws-form .form-select{cursor:pointer;appearance:auto}
      `}</style>
      <button onClick={onCancel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e2e6ec', borderRadius: 9, padding: '6px 12px', fontSize: 13, fontWeight: 700, color: '#3A4150', cursor: 'pointer', marginBottom: 12 }}>← Back</button>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 27, textTransform: 'uppercase', letterSpacing: '.01em', lineHeight: 1 }}>{store ? 'Edit store' : 'New store'}</div>
          <div style={{ color: '#6A7180', fontSize: 13, marginTop: 4 }}>{store ? "Update this store's setup." : "Set it up here — add products and artwork after it's created."}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onImportFromOmg && <button type="button" onClick={onImportFromOmg} title="Skip this blank form — paste a shared OMG report link instead and build the store from its items" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>📥 Import from OMG instead</button>}
          <div style={{ display: 'inline-flex', background: '#eef0f3', borderRadius: 10, padding: 3 }} role="tablist" aria-label="Store type">
            {['team', 'club'].map((t) => (
              <button key={t} type="button" onClick={() => switchOrg(t)} style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', background: orgType === t ? '#fff' : 'transparent', color: orgType === t ? '#191919' : '#6A7180', boxShadow: orgType === t ? '0 1px 2px rgba(0,0,0,.10)' : 'none' }}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '11px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #eef0f3' }}>
        {[['setup', '1 · Setup'], ['delivery', '2 · Delivery & branding']].map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => setPage(k)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '8px 2px', marginRight: 18, fontSize: 13, fontWeight: 800, fontFamily: DISPLAY, textTransform: 'uppercase', letterSpacing: '.04em', color: page === k ? '#191919' : '#9aa1ad', borderBottom: page === k ? '2px solid #191919' : '2px solid transparent', marginBottom: -1 }}>{lbl}</button>
        ))}
      </div>
      {page === 'setup' && (
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>

      <Section title="Basics">
        <Row label={`${noun} (customer) — link this first`}><CustomerPicker customers={cust} value={f.customer_id} onChange={applyCustomer} placeholder="Search by name or alpha — e.g. OLu" /></Row>
        <Row label="Store name (auto-named from customer)"><input className="form-input" value={f.name} onChange={(e) => setName(e.target.value)} placeholder="OLu Football Team Store" /></Row>
        <Row label="URL slug"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'monospace' }}>/shop/</span><input className="form-input" value={f.slug} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }} placeholder="olu-football" /></div></Row>
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label="Rep (auto-set from customer)"><select className="form-select" value={f.rep_id || ''} onChange={(e) => { const rid = e.target.value; setF((p) => ({ ...p, rep_id: rid, csr_id: primaryCsrForRep(rid) || '' })); }}><option value="">—</option>{repOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Row>
          <Row label="CSR (handles messages)"><select className="form-select" value={f.csr_id || ''} onChange={(e) => set('csr_id', e.target.value)}><option value="">—</option>{csrOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Row>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label="Open date (optional)"><input className="form-input" type="date" value={f.open_at || ''} onChange={(e) => set('open_at', e.target.value)} /></Row>
          <Row label="Close date (optional)"><input className="form-input" type="date" value={f.close_at || ''} onChange={(e) => set('close_at', e.target.value)} /></Row>
        </div>
        <Row label="Decoration">
          <div style={{ display: 'flex', gap: 8 }}>
            {[['in_house', '🏭 In-house', 'We print / embroider it'], ['outsourced', '📦 Elsewhere', 'Decorated off-site']].map(([v, lbl, sub]) => { const on = (f.decoration_mode || 'in_house') === v; return (
              <button key={v} type="button" onClick={() => set('decoration_mode', v)} style={{ flex: 1, textAlign: 'left', padding: '9px 12px', borderRadius: 10, cursor: 'pointer', border: on ? '2px solid #4f46e5' : '1px solid #d1d5db', background: on ? '#eef2ff' : '#fff' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1e293b' }}>{lbl}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{sub}</div>
              </button>
            ); })}
          </div>
        </Row>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: -2 }}>In-house needs production-ready art (separations / vector) connected to the customer's art folder. Decorated elsewhere just needs a PNG/AI mockup — still saved to the customer's art library so it can be upgraded later.</div>
      </Section>

      <Section title="Ordering & payment">
        <Row label="Payment mode"><select className="form-select" value={f.payment_mode} onChange={(e) => set('payment_mode', e.target.value)}>
          <option value="paid">Card only (parents pay)</option><option value="unpaid">Invoice only (team tab)</option><option value="either">Both — card or team tab</option>
        </select></Row>
        <Row label="Processing fee (% of items)"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input className="form-input" type="number" step="0.5" min={0} style={{ maxWidth: 120 }} value={f.processing_pct} onChange={(e) => set('processing_pct', e.target.value)} placeholder="5" /><span style={{ color: '#6A7180', fontWeight: 700 }}>%</span></div></Row>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: -2 }}>Added to each order at checkout as a separate line, charged on the item subtotal only (not shipping, tax, or fundraising). Standard is 5%. Set to 0 to turn off.</div>
        <Row label="SO creation"><select className="form-select" value={f.so_creation} onChange={(e) => set('so_creation', e.target.value)}>{['manual', 'on_close', 'daily', 'weekly'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Row>
        <Toggle label={`Require login (${noun.toLowerCase()} members only)`} checked={f.require_login} onChange={(v) => set('require_login', v)} />
        <Toggle label="Findable on the public Team Stores search" checked={f.public_listed !== false} onChange={(v) => set('public_listed', v)} />
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: -2 }}>When on, this open store can be found by name at nationalsportsapparel.com/team-stores. Turn off to keep it unlisted (shareable by direct link only).</div>
      </Section>

      </div>
      <div style={{ flex: 1, minWidth: 0 }}>

      <Section title={`${noun} ${lead.toLowerCase()} (portal access)`}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>The {lead.toLowerCase()} uses this email to access their store-tracking portal.</div>
        <Row label={`${lead} name`}><input className="form-input" value={f.director_name || ''} onChange={(e) => set('director_name', e.target.value)} /></Row>
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label={`${lead} email`}><input className="form-input" type="email" value={f.director_email || ''} onChange={(e) => set('director_email', e.target.value)} /></Row>
          <Row label={`${lead} phone`}><input className="form-input" value={f.director_phone || ''} onChange={(e) => set('director_phone', e.target.value)} /></Row>
        </div>
      </Section>

      {orgType === 'club' && (
        <Section title="Jersey numbers">
          <Toggle label="Let players choose a number" checked={f.number_enabled} onChange={(v) => set('number_enabled', v)} />
          {f.number_enabled && <>
            <Toggle label="Unique numbers required — a player can only pick a number nobody else has taken" checked={f.number_unique} onChange={(v) => set('number_unique', v)} />
            <div style={{ display: 'flex', gap: 12 }}>
              <Row label="Min #"><input className="form-input" type="number" value={f.number_min} onChange={(e) => set('number_min', e.target.value)} /></Row>
              <Row label="Max #"><input className="form-input" type="number" value={f.number_max} onChange={(e) => set('number_max', e.target.value)} /></Row>
            </div>
          </>}
        </Section>
      )}

      <Section title="Fundraising">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Add fundraising on top of every item's price for the whole store. You can still set a specific amount on any single item in the Catalog — an item's own amount always wins.</div>
        <Toggle label="Add fundraising to this store" checked={f.fundraise_enabled} onChange={(v) => set('fundraise_enabled', v)} />
        {f.fundraise_enabled && <div style={{ marginTop: 2, marginBottom: 4 }}>
          <Row label="Fundraise by">
            <div style={{ display: 'inline-flex', background: '#eef0f3', borderRadius: 9, padding: 3 }}>
              {[['pct', '% of item price'], ['flat', '$ per item']].map(([m, lbl]) => (
                <button key={m} type="button" onClick={() => setFundMode(m)} style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 800, background: fundMode === m ? '#fff' : 'transparent', color: fundMode === m ? '#191919' : '#6A7180', boxShadow: fundMode === m ? '0 1px 2px rgba(0,0,0,.10)' : 'none' }}>{lbl}</button>
              ))}
            </div>
          </Row>
          {fundMode === 'pct'
            ? <Row label="Percent added to each item"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input className="form-input" type="number" step="1" min={0} style={{ maxWidth: 120 }} value={f.fundraise_pct} onChange={(e) => set('fundraise_pct', e.target.value)} placeholder="10" /><span style={{ color: '#6A7180', fontWeight: 700 }}>%</span></div></Row>
            : <Row label="Dollars added to each item"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#6A7180', fontWeight: 700 }}>$</span><input className="form-input" type="number" step="0.01" min={0} style={{ maxWidth: 120 }} value={f.fundraise_flat} onChange={(e) => set('fundraise_flat', e.target.value)} placeholder="5.00" /></div></Row>}
          <Toggle label="Round the fundraising amount up to the nearest $1" checked={f.fundraise_round} onChange={(v) => set('fundraise_round', v)} />
        </div>}
        <div style={{ borderTop: '1px solid #f3f4f7', margin: '6px 0 2px' }} />
        <Toggle label={'Show families the "$X supports the team" line on the storefront'} checked={f.fundraise_show_parents} onChange={(v) => set('fundraise_show_parents', v)} />
      </Section>

      <Section title="Bigger-size pricing">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Vendors charge more for 2XL/3XL and up. With this on, those sizes automatically cost the shopper a little more on the storefront — just enough to cover the bigger-size cost — while standard sizes stay the same. Turn it off to charge one price for every size.</div>
        <Toggle label="Charge more for bigger sizes (2XL/3XL+)" checked={f.size_upcharge_enabled !== false} onChange={(v) => set('size_upcharge_enabled', v)} />
      </Section>

      </div>
      </div>
      )}

      {page === 'delivery' && (
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>

      <Section title="Delivery">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Applies to the whole store (set by you, not chosen by shoppers).</div>
        <Row label="Delivery method"><select className="form-select" value={f.delivery_mode} onChange={(e) => set('delivery_mode', e.target.value)}>
          <option value="ship_home">Ship to home — collect each buyer's home address</option>
          <option value="deliver_club">{`Deliver to ${noun.toLowerCase()} — ships to the ${noun.toLowerCase()}'s default address`}</option>
        </select></Row>
        {f.delivery_mode === 'ship_home' && <Row label="Flat shipping charged to buyer ($)"><input className="form-input" type="number" step="0.01" min={0} value={f.flat_shipping} onChange={(e) => set('flat_shipping', e.target.value)} placeholder="0.00" /></Row>}
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label="ShipStation Store ID (optional)"><input className="form-input" value={f.shipstation_store_id || ''} onChange={(e) => set('shipstation_store_id', e.target.value)} placeholder="e.g. 123456" /></Row>
          <Row label="ShipStation Tag ID (optional)"><input className="form-input" value={f.shipstation_tag_id || ''} onChange={(e) => set('shipstation_tag_id', e.target.value)} placeholder="team tag id" /></Row>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -4 }}>Ship-to-home orders pushed to ShipStation route into that Store and get tagged (create a tag named after the team in ShipStation, paste its id). The team name is also set as the order's customer.</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <Row label="Label carrier"><select className="form-select" value={f.shipstation_carrier || 'ups'} onChange={(e) => set('shipstation_carrier', e.target.value)}>{['ups', 'fedex', 'usps'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}</select></Row>
          <Row label="Service code (optional)"><input className="form-input" value={f.shipstation_service || ''} onChange={(e) => set('shipstation_service', e.target.value)} placeholder="fedex_ground" /></Row>
          <Row label="Weight per order (lbs)"><input className="form-input" type="number" step="0.1" value={f.label_weight_lbs} onChange={(e) => set('label_weight_lbs', e.target.value)} /></Row>
        </div>
      </Section>

      </div>
      <div style={{ flex: 1, minWidth: 0 }}>

      <Section title="Branding">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>These control how the storefront looks — logo in the header, banner behind the hero, and your team colors throughout.</div>
        <Row label="Theme"><select className="form-select" value={f.theme} onChange={(e) => set('theme', e.target.value)}>{['classic', 'bold', 'minimal'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Row>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <ColorField label="Primary color" value={f.primary_color} onChange={(v) => set('primary_color', v)} fallback="#0b1f3a" />
          <ColorField label="Accent color" value={f.accent_color} onChange={(v) => set('accent_color', v)} fallback="#e11d2a" />
        </div>
        <ImageUpload value={f.logo_url || null} onChange={(url) => set('logo_url', url || '')} onBusy={onUpBusy} label="Main logo (header)" />
        <ImageUpload value={f.banner_url || null} onChange={(url) => set('banner_url', url || '')} onBusy={onUpBusy} label="Banner image (hero background)" />
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6A7180' }}>Hero blurb</label>
            <button type="button" onClick={() => set('hero_blurb', genBlurb())} style={{ background: '#191919', color: '#fff', border: 'none', borderRadius: 999, padding: '4px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>✨ Generate</button>
          </div>
          <textarea className="form-input" rows={3} value={f.hero_blurb || ''} onChange={(e) => set('hero_blurb', e.target.value)} placeholder="Welcome to the official team store — gear up for the season!" />
        </div>

        {/* Featured items — curate the hero collage. null = auto (first 3); [] = none; [ids] = those. */}
        {(() => {
          const featOn = Array.isArray(f.featured_product_ids);
          const featSel = featOn ? f.featured_product_ids : [];
          return (
            <div style={{ marginTop: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6A7180', display: 'block', marginBottom: 6 }}>Featured items · hero collage</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 8, color: '#3A4150' }}>
                <input type="checkbox" checked={featOn} onChange={(e) => set('featured_product_ids', e.target.checked ? [] : null)} />
                Choose specific items{featOn ? '' : ' — auto: first 3 products'}
              </label>
              {featOn && (
                !store?.id ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Save the store and add products first, then pick up to 3 featured items.</div>
                : featProducts.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No products in this store yet.</div>
                : <>
                    <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 8 }}>{featSel.length ? `${featSel.length} of 3 selected — shown in the hero collage.` : 'None selected — the hero shows no collage.'}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(86px,1fr))', gap: 8 }}>
                      {featProducts.map((p) => {
                        const idx = featSel.indexOf(p.webstore_product_id);
                        const on = idx >= 0;
                        const full = featSel.length >= 3 && !on;
                        return (
                          <button key={p.webstore_product_id} type="button" disabled={full} onClick={() => set('featured_product_ids', on ? featSel.filter((x) => x !== p.webstore_product_id) : [...featSel, p.webstore_product_id])}
                            style={{ position: 'relative', border: `2px solid ${on ? '#191919' : '#e2e6ec'}`, borderRadius: 8, background: '#fff', padding: 4, cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.5 : 1, textAlign: 'left' }}>
                            <div style={{ width: '100%', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: '#f1f5f9', display: 'grid', placeItems: 'center' }}>
                              {p.image_front_url ? <img src={p.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#cbd5e1' }}>No photo</span>}
                            </div>
                            {on && <span style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: '50%', background: '#191919', color: '#fff', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 800 }}>{idx + 1}</span>}
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#3A4150', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                            {p._archived && <div style={{ fontSize: 9, fontWeight: 800, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.4 }}>in package</div>}
                          </button>
                        );
                      })}
                    </div>
                  </>
              )}
            </div>
          );
        })()}
        {store?.id && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f3f4f7' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6A7180', marginBottom: 8 }}>Flyer &amp; Sharing</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={async () => {
                try {
                  setBusy(true);
                  const pdfItems = await loadFlyerItems(store);
                  const b64 = await generateFlyerPdfBase64(store, pdfItems);
                  const a = document.createElement('a');
                  a.href = 'data:application/pdf;base64,' + b64;
                  a.download = `${store.slug || 'team-store'}-flyer.pdf`;
                  a.click();
                } catch (e) { alert('PDF generation failed: ' + (e.message || e)); }
                finally { setBusy(false); }
              }} style={{ background: '#191919', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                ↓ Download Flyer PDF
              </button>
              <button type="button" onClick={async () => {
                const printItems = await loadFlyerItems(store);
                const w = window.open('', '_blank');
                if (!w) { alert('Allow pop-ups to open the flyer.'); return; }
                w.document.write(flyerHtml(store, printItems)); w.document.close();
              }} style={{ background: '#fff', color: '#191919', border: '1px solid #e2e6ec', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                Print Flyer
              </button>
            </div>
          </div>
        )}
      </Section>

      </div>
      </div>
      )}
      <div style={{ position: 'sticky', bottom: 0, background: 'rgba(247,248,250,.92)', backdropFilter: 'blur(6px)', borderTop: '1px solid #eef0f3', padding: '14px 0', display: 'flex', gap: 10, marginTop: 6 }}>
        {page === 'setup'
          ? <button type="button" onClick={() => setPage('delivery')} style={{ background: '#191919', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: DISPLAY, textTransform: 'uppercase', letterSpacing: '.04em' }}>Next: Delivery &amp; branding →</button>
          : <button type="button" onClick={() => setPage('setup')} style={{ background: '#fff', border: '1px solid #e2e6ec', borderRadius: 10, padding: '12px 20px', fontSize: 13.5, fontWeight: 700, color: '#3A4150', cursor: 'pointer' }}>← Back to setup</button>}
        <button disabled={busy || uploading > 0} onClick={submit} style={{ background: (busy || uploading > 0) ? '#6A7180' : (page === 'delivery' ? '#191919' : '#fff'), color: (page === 'delivery' || busy || uploading > 0) ? '#fff' : '#191919', border: (page === 'delivery' || busy || uploading > 0) ? 'none' : '1px solid #191919', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 800, cursor: (busy || uploading > 0) ? 'wait' : 'pointer', fontFamily: DISPLAY, textTransform: 'uppercase', letterSpacing: '.04em' }}>{busy ? 'Saving…' : uploading > 0 ? 'Uploading…' : store ? 'Save changes' : 'Create store'}</button>
        <button disabled={busy} onClick={onCancel} style={{ background: '#fff', border: '1px solid #e2e6ec', borderRadius: 10, padding: '12px 20px', fontSize: 13.5, fontWeight: 700, color: '#3A4150', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, fallback }) {
  const v = value || fallback;
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6A7180' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 38, padding: 0, border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', background: 'none' }} />
        <input className="form-input" style={{ width: 120 }} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={fallback} />
      </div>
    </div>
  );
}

function Section({ title, children, show = true }) {
  if (!show) return null;
  return <div style={{ background: '#fff', border: '1px solid #eef0f3', borderRadius: 12, marginBottom: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f7', fontFamily: DISPLAY, fontWeight: 800, fontSize: 13.5, textTransform: 'uppercase', letterSpacing: '.06em', color: '#191919' }}>{title}</div>
    <div style={{ padding: '12px 14px' }}>{children}</div>
  </div>;
}
function Row({ label, children }) {
  return <div style={{ marginBottom: 10, flex: 1 }}><label style={{ display: 'block', marginBottom: 5, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6A7180' }}>{label}</label>{children}</div>;
}
function Toggle({ label, checked, onChange }) {
  return <div role="switch" aria-checked={!!checked} onClick={() => onChange(!checked)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 0', cursor: 'pointer', fontSize: 13.5, color: '#3A4150', userSelect: 'none' }}>
    <span style={{ position: 'relative', width: 38, height: 22, borderRadius: 999, background: checked ? '#166534' : '#cbd5e1', transition: 'background .15s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
    </span>
    <span>{label}</span>
  </div>;
}

// ── Store detail (with catalog editing) ──────────────────────────────
// Lighten (pct>0) or darken (pct<0) a #rrggbb hex by a percentage — for the
// store-themed header gradient.
function shadeHex(hex, pct) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return hex || '#192853';
  const n = parseInt(h, 16); if (Number.isNaN(n)) return hex;
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = pct < 0 ? 0 : 255, p = Math.min(1, Math.abs(pct) / 100);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Compact dropdown menu — collapses a cluster of buttons into one. `items` is an
// array of { label, icon?, hint?, title?, onClick, disabled?, danger?, divider? }.
function MenuButton({ label, items = [], primary = false, align = 'left', icon }) {
  const [open, setOpen] = useState(false);
  const list = items.filter(Boolean);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className={`btn btn-sm ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>{icon ? icon + ' ' : ''}{label} ▾</button>
      {open && <>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
        <div style={{ position: 'absolute', top: '100%', [align === 'right' ? 'right' : 'left']: 0, marginTop: 4, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,.16)', zIndex: 41, minWidth: 210, padding: 4 }}>
          {list.map((it, i) => it.divider
            ? <div key={i} style={{ height: 1, background: '#eef0f3', margin: '4px 2px' }} />
            : <button key={i} type="button" disabled={it.disabled} title={it.title || ''} onClick={() => { setOpen(false); it.onClick && it.onClick(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 7, cursor: it.disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, color: it.disabled ? '#cbd5e1' : (it.danger ? '#b91c1c' : '#1f2937') }}
                onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = '#f1f5f9'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
                {it.icon != null && <span style={{ width: 18, textAlign: 'center', flexShrink: 0 }}>{it.icon}</span>}
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.hint && <span style={{ fontSize: 11, color: '#94a3b8' }}>{it.hint}</span>}
              </button>)}
        </div>
      </>}
    </div>
  );
}

// Launch confirmation — going live, with an explicit option to email the coach/director
function EmailStoreLinkModal({ store, onClose, onSend }) {
  const onFile = (store.director_email || store.coach_contact_email || '').trim();
  const [email, setEmail] = useState(onFile);
  const [busy, setBusy] = useState(false);
  const valid = /.+@.+\..+/.test(email.trim());
  const go = async () => { if (!valid) return; setBusy(true); await onSend(email.trim()); setBusy(false); onClose(); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 460, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>✉️ Email store link</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 12 }}>Send the store link, QR code, and PDF flyer to a coach or parent.</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Recipient email</div>
          <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="coach@school.org" style={{ width: '100%' }} autoFocus />
          {!valid && email && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>Enter a valid email address.</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderTop: '1px solid #eef0f3' }}>
          <button className="btn btn-primary" disabled={busy || !valid} onClick={go}>{busy ? 'Sending…' : 'Send email'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// the store link + QR (prefilled from the email on file; a newly typed one is saved).
function LaunchStoreModal({ store, onClose, onLaunch }) {
  const onFile = (store.coach_contact_email || store.director_email || '').trim();
  const [emailCoach, setEmailCoach] = useState(!!onFile);
  const [coachEmail, setCoachEmail] = useState(onFile);
  const [busy, setBusy] = useState(false);
  const valid = !emailCoach || /.+@.+\..+/.test(coachEmail.trim());
  const go = async () => { if (!valid) return; setBusy(true); await onLaunch({ emailCoach, coachEmail: coachEmail.trim() }); setBusy(false); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 460, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>🚀 Launch store</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 14 }}>Make <b>{store.name}</b> live for shoppers.</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
            <input type="checkbox" checked={emailCoach} onChange={(e) => setEmailCoach(e.target.checked)} />
            Email the coach the store link + QR
          </label>
          {emailCoach && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Coach / director email</div>
              <input className="form-input" type="email" value={coachEmail} onChange={(e) => setCoachEmail(e.target.value)} placeholder="coach@school.org" style={{ width: '100%' }} />
              {!onFile && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>No email on file — what you enter is saved to the store.</div>}
              {!valid && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>Enter a valid email, or uncheck to launch without notifying.</div>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderTop: '1px solid #eef0f3' }}>
          <button className="btn btn-primary" disabled={busy || !valid} style={{ background: '#166534' }} onClick={go}>{busy ? 'Launching…' : (emailCoach ? 'Launch & email coach' : 'Launch store')}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function StoreDetail({ store: s, detail, loading, tab, setTab, cu, custName, repName, standardCategories = [], onBack, onEdit, onOpenSO, onSetStatus, onAddSingle, onAddColors, onAddFits, onCopyItem, onAddMany, onApplyTemplate, onApplyTemplateColors, onPriceToMargin, onCreateBundle, onAddBundleItem, onRemoveBundleItem, onReorderBundleItems, onRemove, onRemoveGroup, onUpdateImage, onUpdateCost, onUpdateProductMeta, onBatch, onAvailabilityReport, onPlayerReport, onStockReport, onExportCsv, onReorder, onMove, onReorderColors, onUpdateItem, onBulkUpdate, onUpdateTransfer, onAddTransfers, onRemoveTransfer, onPullTransfers, onCreateCoupons, onUpdateCoupon, onRemoveCoupon, onAddRoster, onUpdateRoster, onRemoveRoster, onInviteRoster, onSaveOrderEdits, onRefundOrder, onApplyLogo, onApplyLogoBulk, onSetItemDecorations, onSaveArtVariant, onSaveRepWebLogo, placementMemory, onSavePlacementMemory, onSaveMocks, onAddStoreLogo, onSaveStoreArt, onAttachWebLogo, onFlash, portalUrl, onEmailDirector, onFlyer }) {
  const [portalCopied, setPortalCopied] = useState(false);
  const [showMock, setShowMock] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [emailLinkOpen, setEmailLinkOpen] = useState(false);
  const copyPortal = () => { if (!portalUrl) return; navigator.clipboard?.writeText(portalUrl); setPortalCopied(true); setTimeout(() => setPortalCopied(false), 1800); };
  const orders = detail?.orders || [];
  const orderItems = detail?.orderItems || [];
  const catalog = detail?.catalog || [];
  const roster = detail?.roster || [];
  const bundleItems = detail?.bundleItems || [];
  const stockByWp = detail?.stockByWp || {};

  // Real per-store batch numbers for the linked SOs (webstore_batch_no lives on the
  // Sales Order, not the order row). Fetched once here and shared by the "Batches
  // created" chips and the Orders tab's Batch column/sort, so both show the same
  // numbers with a single load. Keyed on the sorted so_id list so it only refetches
  // when the set of linked SOs actually changes.
  const [soBatch, setSoBatch] = useState({}); // so_id -> { no, label }
  const soIdsKey = [...new Set(orders.map((o) => o.so_id).filter(Boolean))].sort().join(',');
  useEffect(() => {
    const ids = soIdsKey ? soIdsKey.split(',') : [];
    if (!ids.length) { setSoBatch({}); return; }
    let dead = false;
    (async () => {
      const { data } = await supabase.from('sales_orders').select('id,webstore_batch_no,webstore_batch_label').in('id', ids);
      if (dead) return;
      const m = {};
      (data || []).forEach((so) => { m[so.id] = { no: so.webstore_batch_no, label: so.webstore_batch_label }; });
      setSoBatch(m);
    })();
    return () => { dead = true; };
  }, [soIdsKey]);

  // Abandoned pre-payment carts (pending_payment — reached Stripe, never paid) and
  // cancelled orders aren't real sales; exclude them so the banner counts, items,
  // and sales match reality (and the per-order tabs, which already filter them).
  const validOrders = orders.filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled');
  const validOrderIds = new Set(validOrders.map((o) => o.id));
  const totalSales = validOrders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const fundraiseTotal = validOrders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const totalItems = orderItems.filter((i) => !i.is_bundle_parent && validOrderIds.has(i.order_id)).reduce((a, i) => a + (Number(i.qty) || 0), 0);
  const notOrdered = roster.filter((r) => !r.ordered);
  // Batches created from this store (each batch = one Sales Order), with how many
  // orders each covers. Ordered by SO id, which increases with creation, so the
  // chips read in batch order (Batch 1, 2, 3…).
  const soSummary = (() => {
    const m = {};
    orders.forEach((o) => { if (o.so_id) m[o.so_id] = (m[o.so_id] || 0) + 1; });
    return Object.entries(m).map(([id, count]) => ({ id, count, batchNo: soBatch[id] ? soBatch[id].no : null, batchLabel: soBatch[id] ? soBatch[id].label : null }))
      // By real batch number when known; fall back to the SO id's numeric part
      // (increases with creation) until the batch numbers finish loading.
      .sort((a, b) => (a.batchNo != null && b.batchNo != null)
        ? a.batchNo - b.batchNo
        : (Number(String(a.id).replace(/\D/g, '')) || 0) - (Number(String(b.id).replace(/\D/g, '')) || 0));
  })();

  // Primary tabs stay visible; the rest tuck into a "More ▾" menu. Store settings
  // live behind the header ⚙ Settings button (the rich editor), not a tab.
  const PRIMARY_TABS = [
    { id: 'catalog', label: `Catalog (${catalog.length})` },
    { id: 'orders', label: `Orders (${validOrders.length})` },
    { id: 'art', label: 'Art & Logos' },
    { id: 'analytics', label: 'Analytics' },
  ];
  const MORE_TABS = [
    { id: 'batches', label: soSummary.length ? `Batches (${soSummary.length})` : 'Batches' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'roster', label: roster.length ? `Roster (${roster.length})` : 'Roster' },
    { id: 'coupons', label: (detail?.coupons || []).length ? `Coupons (${(detail.coupons || []).length})` : 'Coupons' },
  ];
  // The tab buttons render as their own row on most tabs, but on the Catalog tab
  // they share one line with the Add items / Tools / view controls (passed into
  // CatalogTab as tabsNode) so it's a single, tidy control row.
  const tabsButtons = (
    <>
      {PRIMARY_TABS.map((t) => <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      <MenuButton label={MORE_TABS.find((t) => t.id === tab)?.label || 'More'} primary={MORE_TABS.some((t) => t.id === tab)} items={MORE_TABS.map((t) => ({ label: t.label, onClick: () => setTab(t.id) }))} />
    </>
  );
  // product_id -> stock (warehouse + Adidas) for the batch health check.
  const productStock = {};
  Object.values(stockByWp).forEach((s) => { if (s.product_id) productStock[s.product_id] = s; });
  // product_id -> available sizes, for the order editor's size dropdown.
  const availSizes = {};
  Object.values(stockByWp).forEach((s) => { if (s.product_id && Array.isArray(s.available_sizes)) availSizes[s.product_id] = s.available_sizes; });

  // ── Quick Mock Builder inputs (store items as garments, the team's library art —
  // own + parent — as layers; saves route back to each art's owning customer) ──
  const _qmArt = (detail?.libraryArt || []);
  const _qmU = (f) => typeof f === 'string' ? f : (f && f.url) || '';
  const _qmIsImg = (u) => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u || '');
  const _qmIsVec = (u) => /\.(ai|eps|pdf)(\?|$)/i.test(u || '');
  const qmGarments = catalog.filter((c) => c.kind === 'single').map((c) => { const st = stockByWp[c.id] || {}; return { key: (c.sku || '') + '|' + (st.color || ''), sku: c.sku, color: st.color || '', name: c.display_name || st.name || c.sku, frontUrl: c.image_url || st.image_front_url || '', backUrl: st.image_back_url || '' }; });
  const qmLocations = _qmArt.map((a) => {
    // Web logos (color-way default + legacy web_logo_url) are clean transparent cutouts —
    // include them so art that only has a stored web logo (no preview/mockup/source file
    // yet) still shows up as a placeable layer instead of "No file yet".
    const urls = [webLogoDefault(a), a.web_logo_url, a.preview_url, ...((a.web_logos || []).map(_qmU)), ...((a.mockup_files || []).map(_qmU)), ...((a.files || []).map(_qmU))].filter(Boolean);
    const files = []; const seen = new Set();
    urls.forEach((u) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      const nm = (u.split('/').pop() || 'art').split('?')[0];
      if (_qmIsImg(u)) { files.push({ name: nm, url: u, preview: { url: u } }); }
      else if (_qmIsVec(u)) { const png = _cloudinaryPdfThumb(u); if (png) files.push({ name: nm, url: png, preview: { url: png, vectorSrc: u } }); }
    });
    return { artFileId: a.id, name: a.name || 'Logo', position: '', existingFiles: (a.files || []), files, preview: files[0] ? files[0].preview : null, garmentKeys: [] };
  });
  // Art already APPLIED to items (set on the item detail, or pushed by an artist) lives on each
  // catalog item's `decorations`. Surface it in the builder: pre-place it on that garment color at
  // its saved placement, and make sure the logo appears in the Logo Library with a real preview —
  // even when the deduped library entry had none (the "No art" case).
  const qmAppliedByGarment = {};
  const _qmLocById = new Map(qmLocations.map((l) => [l.artFileId, l]));
  // Color-specific web logos for a decoration (matches how the storefront / item detail resolve art).
  const _qmWebLogos = (d) => { const id = d.art_id || d.art_file_id; const a = (id && (_qmArt.find((x) => x.id === id) || (Array.isArray(s.store_art) ? s.store_art.find((x) => x.id === id) : null))) || null; return a && Array.isArray(a.web_logos) ? a.web_logos : []; };
  catalog.filter((c) => c.kind === 'single').forEach((c) => {
    const st = stockByWp[c.id] || {};
    const color = st.color || '';
    const key = (c.sku || '') + '|' + color;
    (Array.isArray(c.decorations) ? c.decorations : []).forEach((d) => {
      if (!d || d.kind !== 'art' || d.baked) return; // baked art is already in the item image — don't re-place it
      const url = decoUrlForColor(d, color, _qmWebLogos(d)) || d.art_url || d.web_url || '';
      if (!url || !_qmIsImg(url)) return;
      const artId = d.art_file_id || d.art_id || ('deco-' + url);
      const lib = _qmArt.find((a) => a.id === artId);
      const name = (lib && lib.name) || d.color_label || 'Logo';
      const p = placementById(d.placement);
      const xPct = d.x != null ? d.x : p.x, yPct = d.y != null ? d.y : p.y, wPct = d.w != null ? d.w : p.w;
      const side = (d.side || 'front') === 'back' ? 'back' : 'front';
      (qmAppliedByGarment[key] = qmAppliedByGarment[key] || []).push({ artFileId: artId, name, url, side, xPct, yPct, wPct });
      const ex = _qmLocById.get(artId);
      if (ex) { if (!ex.preview) { ex.preview = { url }; if (!ex.files || !ex.files.length) ex.files = [{ name, url, preview: { url } }]; } }
      else { const loc = { artFileId: artId, name, position: '', existingFiles: [], files: [{ name, url, preview: { url } }], preview: { url }, garmentKeys: [] }; qmLocations.push(loc); _qmLocById.set(artId, loc); }
    });
  });
  const qmInitialMocks = {}; const qmInitialScene = {};
  _qmArt.forEach((a) => { Object.entries(a.item_mockups || {}).forEach(([k, arr]) => { if (arr && arr.length) qmInitialMocks[k] = [...(qmInitialMocks[k] || []), ...arr]; }); Object.entries(a.qm_scenes || {}).forEach(([k, objs]) => { if (objs && objs.length && !qmInitialScene[k]) qmInitialScene[k] = objs; }); });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn btn-sm btn-secondary" onClick={onBack}>← Back to All Stores</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn-sm btn-secondary" href={'/shop/' + s.slug} target="_blank" rel="noopener noreferrer">↗ View storefront</a>
          <MenuButton label="Share" align="right" items={[
            portalUrl && { label: portalCopied ? '✓ Copied!' : 'Copy coach portal link', icon: '🔗', title: portalUrl, onClick: copyPortal },
            onFlyer && { label: 'Printable flyer (QR)', icon: '🖨️', title: 'Open a printable flyer with a QR code to the store', onClick: onFlyer },
            { label: 'Email store link', icon: '✉️', title: 'Send the store link + QR + PDF flyer to a coach or parent', onClick: () => setEmailLinkOpen(true) },
          ]} />
          {onSetStatus && (s.status !== 'open'
            ? <button className="btn btn-sm" style={{ background: '#166534', color: '#fff', fontWeight: 700 }} onClick={() => setLaunchOpen(true)} title="Make this store live for shoppers">🚀 Launch store</button>
            : <button className="btn btn-sm btn-secondary" onClick={() => onSetStatus(s, 'closed')} title="Stop taking orders">Close store</button>)}
          <button className="btn btn-sm btn-primary" onClick={onEdit}>⚙ Settings</button>
        </div>
      </div>
      {launchOpen && <LaunchStoreModal store={s} onClose={() => setLaunchOpen(false)} onLaunch={(opts) => { onSetStatus(s, 'open', opts); setLaunchOpen(false); }} />}
      {emailLinkOpen && <EmailStoreLinkModal store={s} onClose={() => setEmailLinkOpen(false)} onSend={(email) => onEmailDirector(email)} />}

      {(() => {
        const primary = s.primary_color || '#192853';
        const accent = s.accent_color || '#962C32';
        const stripes = 'repeating-linear-gradient(-55deg, transparent 0 22px, rgba(255,255,255,0.05) 22px 44px)';
        const BannerStat = ({ label, value }) => <div><div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 4 }}>{label}</div></div>;
        return (
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, marginBottom: 12, background: `linear-gradient(120deg, ${primary} 0%, ${shadeHex(primary, -24)} 100%)`, borderBottom: `3px solid ${accent}`, boxShadow: '0 2px 14px rgba(11,18,32,.14)' }}>
            <div aria-hidden style={{ position: 'absolute', inset: 0, background: stripes, pointerEvents: 'none' }} />
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '14px 18px', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
                {s.logo_url
                  ? <img src={s.logo_url} alt="" style={{ height: 48, width: 48, objectFit: 'contain', borderRadius: 10, background: '#fff', padding: 4, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,.28)' }} />
                  : <div style={{ height: 48, width: 48, borderRadius: 10, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 22, flexShrink: 0 }}>{(s.name || '?')[0].toUpperCase()}</div>}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: 0.2, lineHeight: 1.05, textTransform: 'uppercase' }}>{s.name}</div>
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.82)', marginTop: 3 }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)} · <span style={{ fontFamily: 'monospace' }}>/shop/{s.slug}</span></div>
                  <div style={{ marginTop: 6 }}><StatusBadge status={s.status} /></div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 22, textAlign: 'right', flexShrink: 0, alignSelf: 'flex-start', paddingTop: 2 }}>
                <BannerStat label="Orders" value={validOrders.length} />
                <BannerStat label="Items" value={totalItems} />
                <BannerStat label="Sales" value={money(totalSales)} />
                {fundraiseTotal > 0 && <BannerStat label="Fundraising" value={money(fundraiseTotal)} />}
              </div>
            </div>
          </div>
        );
      })()}

      {soSummary.length > 0 && <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Batches created</span>
        {soSummary.map((so, i) => (
          <button key={so.id} onClick={() => onOpenSO && onOpenSO(so.id)} title={`Open the batch's Sales Order (${so.id})`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>
            <span style={{ fontFamily: 'inherit', color: '#6d28d9' }}>Batch {so.batchNo != null ? so.batchNo : i + 1}{so.batchLabel ? ` · ${so.batchLabel}` : ''}</span> {so.id} <span style={{ fontFamily: 'inherit', fontWeight: 500, color: '#64748b' }}>· {so.count} order{so.count === 1 ? '' : 's'} ↗</span>
          </button>
        ))}
      </div></div>}

      {tab !== 'catalog' && <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>{tabsButtons}</div>}

      {loading && !detail ? <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}>Loading store details…</div> : (
        <>
          {tab === 'catalog' && <CatalogTab tabsNode={tabsButtons} catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} costByPid={detail?.costByPid || {}} invSrcByPid={detail?.invSrcByPid || {}} transfers={detail?.transfers || []} isTeam={(s.org_type || 'team') !== 'club'} library={(s.store_art || []).map((sa) => { const fresh = (detail?.libraryArt || []).find((la) => la.id === sa.id); return (fresh && Array.isArray(fresh.web_logos) && fresh.web_logos.length > (Array.isArray(sa.web_logos) ? sa.web_logos.length : 0)) ? { ...sa, web_logos: fresh.web_logos } : sa; })} storeColors={detail?.storeColors || []} storeFund={{ enabled: !!s.fundraise_enabled, pct: Number(s.fundraise_pct) || 0, flat: Number(s.fundraise_flat) || 0, round: !!s.fundraise_round }} onApplyLogo={onApplyLogo} onSaveLogo={onAddStoreLogo} onAddSingle={onAddSingle} onAddColors={onAddColors} onAddFits={onAddFits} onCopyItem={onCopyItem} onAddMany={onAddMany} onApplyTemplate={onApplyTemplate} onApplyTemplateColors={onApplyTemplateColors} onGoToArt={() => setTab('art')} standardCategories={standardCategories} onPriceToMargin={onPriceToMargin} onCreateBundle={onCreateBundle} onAddBundleItem={onAddBundleItem} onRemoveBundleItem={onRemoveBundleItem} onReorderBundleItems={onReorderBundleItems} onRemove={onRemove} onRemoveGroup={onRemoveGroup} onUpdateImage={onUpdateImage} onUpdateCost={onUpdateCost} onUpdateProductMeta={onUpdateProductMeta} onReorder={onReorder} onMove={onMove} onReorderColors={onReorderColors} onUpdateItem={onUpdateItem} onBulkUpdate={onBulkUpdate} />}
          {tab === 'art' && <ArtTab catalog={catalog} stockByWp={stockByWp} decorationMode={s.decoration_mode || 'in_house'} libraryArt={detail?.libraryArt || []} storeArt={s.store_art || []} onSaveStoreArt={onSaveStoreArt} onSaveLogo={onAddStoreLogo} onAttachWebLogo={onAttachWebLogo} onApplyLogo={onApplyLogo} onApplyLogoBulk={onApplyLogoBulk} onSetItemDecorations={onSetItemDecorations} onSaveArtVariant={onSaveArtVariant} onSaveRepWebLogo={onSaveRepWebLogo} placementMemory={placementMemory} onSavePlacementMemory={onSavePlacementMemory} canMock={qmGarments.length > 0 && (_qmArt.length > 0 || Object.keys(qmAppliedByGarment).length > 0)} onOpenMockBuilder={() => setShowMock(true)} />}
          {tab === 'orders' && <OrdersTab orders={orders} orderItems={orderItems} numbersEnabled={s.number_enabled} onBatch={onBatch} onAvailabilityReport={onAvailabilityReport} onPlayerReport={onPlayerReport} onStockReport={onStockReport} onExportCsv={onExportCsv} availSizes={availSizes} onSaveOrderEdits={onSaveOrderEdits} onRefundOrder={onRefundOrder} cu={cu} store={s} soBatch={soBatch} onOpenSO={onOpenSO} msgTagIds={[s.csr_id || s.rep_id].filter(Boolean)} />}
          {tab === 'batches' && <BatchesTab store={s} productStock={productStock} onOpenSO={onOpenSO} catalog={catalog} bundleItems={bundleItems} orders={orders} orderItems={orderItems} transfers={detail?.transfers || []} onPullTransfers={onPullTransfers} />}
          {tab === 'inventory' && <InventoryTab catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} transfers={detail?.transfers || []} orders={orders} orderItems={orderItems} onUpdateTransfer={onUpdateTransfer} onAddTransfers={onAddTransfers} onRemoveTransfer={onRemoveTransfer} />}
          {tab === 'coupons' && <CouponsTab store={s} coupons={detail?.coupons || []} orders={orders} onCreate={onCreateCoupons} onUpdate={onUpdateCoupon} onRemove={onRemoveCoupon} />}
          {tab === 'analytics' && <AnalyticsTab store={s} orders={orders} orderItems={orderItems} stockByWp={stockByWp} catalog={catalog} libraryArt={detail?.libraryArt || []} />}
          {tab === 'roster' && <RosterTab store={s} roster={roster} notOrdered={notOrdered} orders={orders} onAdd={onAddRoster} onUpdate={onUpdateRoster} onRemove={onRemoveRoster} onInvite={onInviteRoster} onFlash={onFlash} />}
          {tab === 'settings' && <SettingsTab store={s} />}
        </>
      )}
      {showMock && <QuickMockBuilder garments={qmGarments} locations={qmLocations} initialMocks={qmInitialMocks} initialScene={qmInitialScene} appliedByGarment={qmAppliedByGarment} nf={(m) => onFlash && onFlash(m)}
        onClose={() => setShowMock(false)}
        onSave={async (payload) => { if (onSaveMocks) await onSaveMocks(payload, _qmArt); setShowMock(false); }} />}
    </>
  );
}

function Stat({ label, value, tone }) {
  return <div><div style={{ fontSize: 18, fontWeight: 800, color: tone || '#1e293b' }}>{value}</div><div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div></div>;
}

// Per-size breakdown: in-house warehouse qty and Adidas vendor qty side by
// side, across the product's available sizes (with totals + ETA).
function StockBreakdown({ stock, summary, hideSummary }) {
  const house = stock?.size_stock || {};
  const vendor = stock?.vendor_size_stock || {};
  const sizes = Array.isArray(stock?.available_sizes) && stock.available_sizes.length
    ? stock.available_sizes
    : Array.from(new Set([...Object.keys(house), ...Object.keys(vendor)]));
  const houseTotal = sumSizes(house);
  const vendorTotal = Number(stock?.vendor_on_hand) || sumSizes(vendor);
  return (
    <div style={{ minWidth: 220 }}>
      {!hideSummary && <div style={{ fontWeight: 700, color: summary.color, marginBottom: 6 }}>{summary.text}</div>}
      {sizes.length > 0 && (
        <table style={{ borderCollapse: 'collapse', fontSize: 11, color: '#475569' }}>
          <thead><tr style={{ color: '#94a3b8' }}>
            <th style={{ textAlign: 'left', padding: '1px 8px 1px 0', fontWeight: 600 }}>Size</th>
            <th style={{ textAlign: 'right', padding: '1px 8px', fontWeight: 600 }}>In‑house</th>
            <th style={{ textAlign: 'right', padding: '1px 0 1px 8px', fontWeight: 600 }}>Adidas</th>
          </tr></thead>
          <tbody>
            {sizes.map((sz) => {
              const h = Number(house[sz]) || 0; const v = Number(vendor[sz]) || 0;
              return <tr key={sz}>
                <td style={{ padding: '1px 8px 1px 0', fontWeight: 600 }}>{sz}</td>
                <td style={{ textAlign: 'right', padding: '1px 8px', color: h > 0 ? '#166534' : '#cbd5e1' }}>{h.toLocaleString()}</td>
                <td style={{ textAlign: 'right', padding: '1px 0 1px 8px', color: v > 0 ? '#1e40af' : '#cbd5e1' }}>{v.toLocaleString()}</td>
              </tr>;
            })}
            <tr style={{ borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
              <td style={{ padding: '2px 8px 0 0' }}>Total</td>
              <td style={{ textAlign: 'right', padding: '2px 8px 0', color: '#166534' }}>{houseTotal.toLocaleString()}</td>
              <td style={{ textAlign: 'right', padding: '2px 0 0 8px', color: '#1e40af' }}>{vendorTotal.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      )}
      {(stock?.vendor_eta || stock?.earliest_eta) && houseTotal + vendorTotal === 0 && (
        <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>Arriving ~{[stock?.earliest_eta, stock?.vendor_eta].filter(Boolean).sort()[0]}</div>
      )}
    </div>
  );
}

// Effective availability = on-hand warehouse stock + Adidas vendor stock
// (drop-shippable). ETA falls back to the soonest of open-PO or Adidas
// future-delivery dates.
function stockText(stock) {
  const wh = sumSizes(stock?.size_stock);
  const vendor = Number(stock?.vendor_on_hand) || 0;
  const total = wh + vendor;
  if (total > 0) return { text: `In stock (${total.toLocaleString()})`, color: '#166534' };
  const eta = [stock?.earliest_eta, stock?.vendor_eta].filter(Boolean).sort()[0];
  if (stock?.on_order_qty > 0 || eta) return { text: eta ? `Arriving ~${eta}` : 'On order', color: '#92400e' };
  return { text: 'Out of stock', color: '#b91c1c' };
}

// A size is "available soon" when the vendor's per-size restock date is within ~2
// weeks (vendor_size_eta from the storefront view). Used so the store offers sizes
// you can actually get shortly — in stock now or arriving — and hides ones whose
// next delivery is months out (e.g. a style whose 3XL–6XL only return next season).
const SIZE_SOON_MS = 14 * 24 * 60 * 60 * 1000;
function sizeEtaSoon(etaMap, sz) {
  const d = etaMap && etaMap[sz];
  if (!d) return false;
  const t = Date.parse(d);
  return !isNaN(t) && t <= Date.now() + SIZE_SOON_MS;
}

// ── Catalog tab with editing ─────────────────────────────────────────
// Store-wide fundraising rule (Settings → Fundraising): a % of price or a flat $,
// optionally rounded up to the next $1. A per-item amount always overrides it.
const storeFundAmount = (price, sf) => {
  if (!sf || !sf.enabled) return 0;
  let amt = Number(sf.flat) > 0 ? Number(sf.flat) : (Number(price) || 0) * (Number(sf.pct) || 0) / 100;
  if (sf.round) amt = Math.ceil(amt);
  return Math.max(0, amt);
};
const effectiveFundraise = (price, perItemY, sf) => (Number(perItemY) > 0 ? Number(perItemY) : storeFundAmount(price, sf));

function CatalogTab({ tabsNode, catalog, bundleItems, stockByWp, costByPid = {}, invSrcByPid = {}, transfers = [], isTeam = false, library = [], storeColors = [], storeFund = {}, standardCategories = [], onApplyLogo, onSaveLogo, onAddSingle, onAddColors, onAddFits, onCopyItem, onAddMany, onApplyTemplate, onApplyTemplateColors, onGoToArt, onPriceToMargin, onCreateBundle, onAddBundleItem, onRemoveBundleItem, onReorderBundleItems, onRemove, onRemoveGroup, onUpdateImage, onUpdateCost, onUpdateProductMeta, onReorder, onMove, onReorderColors, onUpdateItem, onBulkUpdate }) {
  const [mode, setMode] = useState(null); // null | 'single' | 'bundle'
  const [pkgItems, setPkgItems] = useState([]); // components selected (via list checkboxes) for the package being built
  const [bulkSel, setBulkSel] = useState(() => new Set()); // catalog ids ticked for bulk edit
  const selMode = mode === 'select';
  const toggleBulk = (id) => setBulkSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkFund, setBulkFund] = useState('');
  const [bulkFundMode, setBulkFundMode] = useState('$'); // '$' flat | '%' of price
  const [bulkCat, setBulkCat] = useState('');
  const pkgSel = new Set(pkgItems.map((c) => c.webstore_product_id));
  const togglePkg = (p) => setPkgItems((cur) => {
    if (cur.some((c) => c.webstore_product_id === p.id)) return cur.filter((c) => c.webstore_product_id !== p.id);
    const stock = stockByWp[p.id];
    // Inherit number/name/sizing from the item itself — it's configured there.
    return [...cur, { webstore_product_id: p.id, product_id: p.product_id, sku: p.sku, name: p.display_name || stock?.name || p.sku, image: p.image_url || stock?.image_front_url || null, retail_price: Number(p.retail_price) || 0, qty: 1, size_required: true, takes_number: !!p.takes_number, takes_name: !!p.takes_name, name_upcharge: Number(p.name_upcharge) || 0, transfer_code: null, num_transfer_size: null, num_transfer_color: null }];
  });
  const [pending, setPending] = useState(null); // picked product awaiting price + fundraise
  const [editId, setEditId] = useState(null); // catalog row being edited inline
  const [pendingOpenPid, setPendingOpenPid] = useState(null); // product just created — open its card once it lands
  const [newCats, setNewCats] = useState([]);  // categories added via "+ Category" but not yet holding items
  const [overCat, setOverCat] = useState(null); // category section being dragged over
  const [dragCat, setDragCat] = useState(null); // category section being dragged
  const [overDragCat, setOverDragCat] = useState(null); // category drop target during cat-drag
  const paneEditorSaveRef = useRef(null); // bound to CatalogItemEditor's save() in split view
  const paneEditorDirtyRef = useRef(false); // true when the open editor has unsaved edits
  // Switch which item is being edited, but offer to save first if the current one is dirty —
  // so a rep never loses edits by clicking the next item before hitting Save.
  const switchEditId = (id) => {
    if (id !== editId && paneEditorDirtyRef.current && paneEditorSaveRef.current) {
      if (window.confirm('You have unsaved changes on this item. Save them before switching?')) paneEditorSaveRef.current();
    }
    paneEditorDirtyRef.current = false;
    setEditId(id);
  };
  const [paneTab, setPaneTab] = useState('details'); // side-by-side editor tab, lifted so it sits beside the name
  useEffect(() => { setPaneTab('details'); }, [editId]);
  // Side-by-side layout: a persistent item list on the left, the item editor in a
  // pane on the right (no popup). Toggle back to the classic list+popup; remembered locally.
  const [view, setView] = useState(() => { try { return localStorage.getItem('nsa_catalog_view') || 'split'; } catch { return 'split'; } });
  useEffect(() => { try { localStorage.setItem('nsa_catalog_view', view); } catch {} }, [view]);
  const designOptions = transfers.filter((t) => t.kind === 'design').map((t) => ({ code: t.code, label: t.label }));
  const numberSets = [...new Set(transfers.filter((t) => t.kind === 'number').map((t) => `${t.tsize || ''}|${t.color || ''}`))].map((k) => { const [size, color] = k.split('|'); return { size, color }; });
  const [expandAll, setExpandAll] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (id) => setOpenRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ordered = [...catalog].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  // Group color variants of the same garment into one card. Colors of a garment
  // share variant_group_id (= the primary row's id); a null group id = standalone.
  const groupKeyOf = (p) => p.variant_group_id || p.id;
  const groups = [];
  {
    const byKey = new Map();
    for (const p of ordered) { const k = groupKeyOf(p); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
    // The leftmost color (lowest sort_order — rows are pre-sorted) is the primary: its image
    // leads the catalog row and it's the default on the storefront. Reordering colors changes it.
    for (const [k, rows] of byKey) { groups.push({ key: k, rep: rows[0], rows }); }
    groups.sort((a, b) => (a.rep.sort_order || 0) - (b.rep.sort_order || 0));
  }
  const repsList = groups.map((g) => g.rep);
  const colorsForRep = (repId) => (groups.find((g) => g.rep.id === repId)?.rows) || [];
  // Up/down on a card moves the whole group (by its representative) past the next card.
  const moveRep = (i, dir) => { const p = repsList[i]; if (!p) return; if (dir === 'up' && i > 0) onMove(p, repsList[i - 1].id); else if (dir === 'down' && i < repsList.length - 1) onMove(p, repsList[i + 2] ? repsList[i + 2].id : null); };

  // ── Bulk edit (Select mode): tick items on the left, then act on them all at once.
  // Price/fundraising apply to the card's priced (representative) row; category &
  // availability apply to the whole color group so a hidden item hides every variant.
  const allCats = [...new Set([...(standardCategories || []), ...catalog.map((c) => (c.category || '').trim()).filter(Boolean)])].sort();
  const groupRowIds = (repId) => (groups.find((g) => g.rep.id === repId)?.rows || []).map((r) => r.id);
  const applyBulk = async (fields, expand) => {
    const ids = [...bulkSel].filter((id) => repsList.some((r) => r.id === id));
    if (!ids.length || !onBulkUpdate) return;
    const rows = expand ? ids.flatMap((id) => groupRowIds(id).map((rid) => ({ id: rid, fields }))) : ids.map((id) => ({ id, fields }));
    await onBulkUpdate(rows);
  };
  const applyBulkFund = async () => {
    const v = Number(bulkFund);
    if (!(v >= 0) || !onBulkUpdate) return;
    const rows = [...bulkSel].map((id) => {
      const rep = repsList.find((r) => r.id === id);
      if (!rep) return null;
      const amt = bulkFundMode === '%' ? Math.round((Number(rep.retail_price) || 0) * v) / 100 : v;
      return { id, fields: { fundraise_amount: amt } };
    }).filter(Boolean);
    if (rows.length) await onBulkUpdate(rows);
    setBulkFund('');
  };

  // ── Category sections (side list): group cards by their category, with "+ Category"
  // adding a (possibly empty) section you drag cards into. Dropping a card on a section
  // header sets its category; a card with no category sits under "Uncategorized". ──
  const maxSort = Math.max(0, ...catalog.map((c) => Number(c.sort_order) || 0));
  const addCat = (name) => { const c = (name || '').trim(); if (c) setNewCats((p) => (p.includes(c) ? p : [...p, c])); };
  const catSections = (() => {
    const byCat = new Map();
    for (const g of groups) { const c = (g.rep.category || '').trim(); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(g); }
    const arr = [...byCat.entries()].map(([cat, gs]) => ({ cat, groups: gs, minSort: Math.min(...gs.map((x) => x.rep.sort_order || 0)) }));
    arr.sort((a, b) => ((a.cat === '' ? 1 : 0) - (b.cat === '' ? 1 : 0)) || (a.minSort - b.minSort));
    for (const c of newCats) { if (!byCat.has(c)) arr.push({ cat: c, groups: [], minSort: Infinity }); }
    return arr;
  })();
  const useCats = catSections.length > 1 || catSections.some((s) => s.cat) || newCats.length > 0;
  const dropToCat = (cat) => { if (!dragId) return; onUpdateItem(dragId, { category: cat || null, sort_order: maxSort + 1 }); setDragId(null); setOverCat(null); setOverId(null); };
  const _webLogosOf = (d) => { const art = (library || []).find((a) => a.id === d.art_id); return art && Array.isArray(art.web_logos) ? art.web_logos : []; };
  const renderRep = ({ rep: p, rows: colorRows }) => {
    const stock = stockByWp[p.id];
    const label = p.display_name || stock?.name || p.sku || '(unnamed)';
    const fund = Number(p.fundraise_amount) || 0;
    const effFund = p.kind === 'bundle' ? fund : effectiveFundraise(p.retail_price, fund, storeFund);
    const sel = editId === p.id;
    const margin = (p.kind !== 'bundle' && costByPid[p.product_id] != null) ? (Number(p.retail_price) || 0) - costByPid[p.product_id] : null;
    const nColors = colorRows.length;
    const archived = p.active === false;
    const bulkOn = selMode && bulkSel.has(p.id);
    return (
      <div key={p.id} onClick={() => (selMode ? toggleBulk(p.id) : switchEditId(p.id))}
        onDragOver={(e) => onRowDragOver(e, p)} onDrop={(e) => onRowDrop(e, p)} onDragEnd={() => { setDragId(null); setOverId(null); setOverCat(null); }}
        style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '9px 12px', cursor: 'pointer',
          borderLeft: bulkOn ? '3px solid #2563eb' : sel ? '3px solid #191919' : '3px solid transparent',
          background: bulkOn ? '#eef2ff' : sel ? '#f1f5f9' : '#fff',
          borderTop: dragId && dragId !== p.id && overId === p.id && overPos === 'before' ? '2px solid #191919' : '1px solid #f4f6f9',
          borderBottom: dragId && dragId !== p.id && overId === p.id && overPos === 'after' ? '2px solid #191919' : undefined,
          opacity: dragId === p.id ? 0.4 : (archived && !bulkOn ? 0.5 : 1) }}>
        {selMode
          ? <input type="checkbox" checked={bulkSel.has(p.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleBulk(p.id)} title="Select for bulk edit" style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0, accentColor: '#2563eb' }} />
          : mode === 'bundle' && p.kind !== 'bundle'
          ? <input type="checkbox" checked={pkgSel.has(p.id)} onClick={(e) => e.stopPropagation()} onChange={() => togglePkg(p)} title="Add to the package" style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0, accentColor: '#4f46e5' }} />
          : <span draggable onClick={(e) => e.stopPropagation()} onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; }} title="Drag to reorder, or onto a category" style={{ cursor: 'grab', color: '#cbd5e1', fontSize: 14, userSelect: 'none' }}>⠿</span>}
        <div style={{ position: 'relative', width: 42, height: 42, borderRadius: 7, background: '#f4f6f9', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {(p.image_url || stock?.image_front_url) ? <img src={p.image_url || stock?.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#cbd5e1' }}>—</span>}
          {/* Overlay the placed front logo(s) so the thumbnail shows the decorated mockup.
              Skip `baked` decorations — already rendered into the item image (a Quick Mock). */}
          {(p.decorations || []).filter((d) => !d.baked && (d.side || 'front') !== 'back' && decoUrlForColor(d, stock?.color, _webLogosOf(d))).map((d, i) => { const pl = placementById(d.placement); const x = d.x != null ? d.x : pl.x, y = d.y != null ? d.y : pl.y, w = d.w != null ? d.w : pl.w; return (
            <img key={i} src={decoUrlForColor(d, stock?.color, _webLogosOf(d))} alt="" draggable={false} style={{ position: 'absolute', left: x + '%', top: y + '%', width: w + '%', transform: 'translate(-50%,-50%)', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.25))' }} />
          ); })}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}{archived ? <span style={{ fontSize: 9, color: '#92400e', fontWeight: 800, background: '#fef3c7', padding: '1px 5px', borderRadius: 4, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Archived</span> : null}{p.kind === 'bundle' ? <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 700 }}> · pkg</span> : null}{nColors > 1 ? <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 700 }}> · {nColors} {colorRows.some((c) => c.variant_label) ? 'fits' : 'colors'}</span> : null}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{money((Number(p.retail_price) || 0) + effFund)}{p.sku ? ` · ${p.sku}` : ''}</div>
        </div>
        {margin != null && <span title="margin" style={{ fontSize: 10, fontWeight: 800, color: margin < 0 ? '#b91c1c' : (p.retail_price > 0 && margin / Number(p.retail_price) < 0.3) ? '#92400e' : '#166534' }}>{margin >= 0 ? '+' : ''}{money(margin)}</span>}
      </div>
    );
  };
  // In side-by-side view keep one item selected so the editor pane is never empty
  // (and re-home the selection if the chosen item / its card gets removed).
  useEffect(() => { if (view === 'split' && repsList.length && !repsList.some((p) => p.id === editId)) setEditId(repsList[0].id); }, [view, catalog]);
  // After a custom product is created + added, drop the rep straight into the full item
  // editor once the reloaded catalog contains it — so they never have to reopen it to
  // finish pricing, art & colors, sizes, etc. Runs after the reselect effect above so it
  // wins the selection.
  useEffect(() => {
    if (!pendingOpenPid) return;
    const m = repsList.find((p) => p.product_id === pendingOpenPid);
    if (m) { setEditId(m.id); setPaneTab('details'); setPendingOpenPid(null); }
  }, [catalog, pendingOpenPid]);

  // Drag-to-reorder: the grab handle on a row starts the drag; every row is a
  // drop target. Hovering the top/bottom half drops the item before/after that
  // row. New order persists via onMove → sort_order (arrows still work too).
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [overPos, setOverPos] = useState('before');
  const onRowDragOver = (e, p) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    if (overId !== p.id || overPos !== pos) { setOverId(p.id); setOverPos(pos); }
  };
  const onRowDrop = (e, p) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation(); // the card handles the drop (position + recategorize) — don't also bubble to the section
    if (dragId !== p.id) {
      // Reorder operates on cards (representative rows), so step over to the next card.
      const tIdx = repsList.findIndex((x) => x.id === p.id);
      const beforeId = overPos === 'before' ? p.id : (repsList[tIdx + 1] ? repsList[tIdx + 1].id : null);
      if (beforeId !== dragId) {
        const dragged = repsList.find((x) => x.id === dragId);
        // In category mode, dropping onto a card also moves it into that card's section.
        if (dragged) onMove(dragged, beforeId, useCats ? ((catalog.find((c) => c.id === p.id) || {}).category || null) : undefined);
      }
    }
    setDragId(null); setOverId(null); setOverCat(null);
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {tabsNode}
        <span style={{ width: 1, alignSelf: 'stretch', background: '#e2e8f0', margin: '2px 2px' }} />
        <MenuButton label="Add items" primary items={[
          { label: 'Browse products', icon: '🔎', onClick: () => { setMode('single'); setPending(null); } },
          { label: 'New custom product', icon: '＋', onClick: () => { setMode('custom'); setPending(null); } },
          { label: 'Import list (Excel / Sheets)', icon: '⬆', onClick: () => { setMode('import'); setPending(null); } },
          { divider: true },
          { label: 'Add template', icon: '🎯', onClick: () => { setMode('template'); setPending(null); } },
          { label: 'Create a package', icon: '📦', onClick: () => { setMode('bundle'); setPending(null); setPkgItems([]); } },
          { label: 'Build with AI', icon: '✨', onClick: () => { setMode('ai'); setPending(null); } },
        ]} />
        <MenuButton label="Tools" items={[
          { label: 'Price to margin', icon: '💲', onClick: () => { setMode('margin'); setPending(null); } },
          (view === 'table') && { label: expandAll ? 'Collapse all sizes' : 'Expand all sizes', icon: '↕', onClick: () => { setExpandAll((v) => !v); setOpenRows(new Set()); } },
        ]} />
        <button type="button" onClick={() => { setMode(selMode ? null : 'select'); setBulkSel(new Set()); setPending(null); }} title="Select multiple items to price, add fundraising, move category, or archive them at once"
          style={{ border: '1px solid ' + (selMode ? '#2563eb' : '#d7dbe2'), cursor: 'pointer', borderRadius: 9, padding: '6px 12px', fontSize: 12.5, fontWeight: 800, background: selMode ? '#2563eb' : '#fff', color: selMode ? '#fff' : '#334155' }}>
          {selMode ? '✓ Done' : '☑ Select'}
        </button>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', background: '#eef0f3', borderRadius: 9, padding: 3 }} title="Switch how the catalog is laid out">
          {[['split', '▥ Side-by-side'], ['table', '☰ List + popup']].map(([v, lbl]) => (
            <button key={v} type="button" onClick={() => { if (v === 'table') switchEditId(null); setView(v); }} style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 800, background: view === v ? '#fff' : 'transparent', color: view === v ? '#191919' : '#6A7180', boxShadow: view === v ? '0 1px 2px rgba(0,0,0,.10)' : 'none' }}>{lbl}</button>
          ))}
        </div>
      </div>

      {selMode && (() => {
        const n = bulkSel.size;
        const gBtn = (bg) => ({ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 800, background: bg, color: '#fff' });
        const inp = { width: 64, border: '1px solid #334155', background: '#1e293b', color: '#fff', borderRadius: 6, padding: '4px 7px', fontSize: 12.5, outline: 'none' };
        const lbl = { fontSize: 10.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 };
        const grp = { display: 'inline-flex', alignItems: 'center', gap: 5 };
        const sep = { width: 1, height: 22, background: '#334155' };
        const link = { background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '2px 4px' };
        return (
          <div style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 1200, background: '#0f172a', color: '#fff', borderRadius: 14, boxShadow: '0 14px 44px rgba(0,0,0,.35)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap', maxWidth: '95vw' }}>
            <span style={{ fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>{n} selected</span>
            <button style={link} onClick={() => setBulkSel(new Set(repsList.map((r) => r.id)))}>All</button>
            <button style={link} onClick={() => setBulkSel(new Set())}>None</button>
            <span style={sep} />
            <div style={grp}>
              <span style={lbl}>Price $</span>
              <input value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} placeholder="0.00" style={inp} />
              <button style={{ ...gBtn('#2563eb'), opacity: !n || bulkPrice === '' ? 0.4 : 1 }} disabled={!n || bulkPrice === ''} onClick={async () => { const v = Number(bulkPrice); if (!(v >= 0)) return; await applyBulk({ retail_price: v }, false); setBulkPrice(''); }}>Set</button>
            </div>
            <span style={sep} />
            <div style={grp}>
              <span style={lbl}>Fundraise</span>
              <input value={bulkFund} onChange={(e) => setBulkFund(e.target.value)} placeholder="0" style={{ ...inp, width: 52 }} />
              <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #334155' }}>
                {['$', '%'].map((m) => <button key={m} onClick={() => setBulkFundMode(m)} style={{ border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: 12, fontWeight: 800, background: bulkFundMode === m ? '#2563eb' : '#1e293b', color: '#fff' }}>{m}</button>)}
              </div>
              <button style={{ ...gBtn('#2563eb'), opacity: !n || bulkFund === '' ? 0.4 : 1 }} disabled={!n || bulkFund === ''} onClick={applyBulkFund}>Apply</button>
            </div>
            <span style={sep} />
            <div style={grp}>
              <span style={lbl}>Category</span>
              <input list="bulk-cat-list" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} placeholder="move to…" style={{ ...inp, width: 104 }} />
              <datalist id="bulk-cat-list">{allCats.map((c) => <option key={c} value={c} />)}</datalist>
              <button style={{ ...gBtn('#2563eb'), opacity: !n ? 0.4 : 1 }} disabled={!n} onClick={async () => { await applyBulk({ category: (bulkCat || '').trim() || null }, true); setBulkCat(''); }}>Move</button>
            </div>
            <span style={sep} />
            <button style={{ ...gBtn('#b45309'), opacity: !n ? 0.4 : 1 }} disabled={!n} title="Hide from the store (stays here as Archived)" onClick={() => applyBulk({ active: false }, true)}>Archive</button>
            <button style={{ ...gBtn('#15803d'), opacity: !n ? 0.4 : 1 }} disabled={!n} title="Show in the store again" onClick={() => applyBulk({ active: true }, true)}>Restore</button>
            <span style={sep} />
            <button style={{ ...link, fontWeight: 800, color: '#fff' }} onClick={() => { setMode(null); setBulkSel(new Set()); }}>Done</button>
          </div>
        );
      })()}

      {mode === 'single' && <ProductPicker label="Add products to this store" storeColors={storeColors} storeFund={storeFund} library={library} catalog={catalog} standardCategories={standardCategories} onSaveLogo={onSaveLogo} onPick={(p) => setPending(p)} onPickMany={async (prods, decorations, cfg = {}) => { const hasPrice = cfg.price !== undefined && cfg.price !== '' && cfg.price !== null; for (const pr of prods) await onAddSingle({ product: pr, price: hasPrice ? cfg.price : pr.retail_price, fundraise: cfg.fundraise || 0, image_url: null, takes_number: !!cfg.takes_number, takes_name: !!cfg.takes_name, name_upcharge: cfg.name_upcharge || 0, transfer_codes: [], num_transfer_sets: [], category: cfg.category || null, kit_name: cfg.kit_name || null, required: !!cfg.required, options: cfg.options || [], decorations: decorations || [] }); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'ai' && <AiStoreBuilder onAddProducts={async (prods) => { for (const pr of prods) await onAddSingle({ product: pr, price: pr.retail_price, fundraise: 0, image_url: null, takes_number: false, takes_name: false, name_upcharge: 0, transfer_codes: [], num_transfer_sets: [] }); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'import' && <SkuImporter existingPids={new Set((catalog || []).map((c) => c.product_id).filter(Boolean))} storeFund={storeFund} onApplyColors={onApplyTemplateColors} onGoToArt={onGoToArt} onClose={() => setMode(null)} />}
      {mode === 'template' && <TemplateGallery catalog={catalog} stockByWp={stockByWp} existingPids={new Set((catalog || []).map((c) => c.product_id).filter(Boolean))} onApply={async (tpl) => { await onApplyTemplate(tpl); setMode(null); }} onApplyColors={async (plan) => { await onApplyTemplateColors(plan); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'custom' && <CustomProductCreator library={library} catSuggestions={[...new Set([...(catalog || []).map((c) => c.category).filter(Boolean), 'Tees', 'Hoods', 'Crew', 'Polos', 'Shorts', 'Pants', 'Outerwear', 'Jersey', 'Hats', 'Bags', 'Socks', 'Footwear', 'Accessories'])]} onClose={() => setMode(null)} onCreated={async (product, alsoAdd, decorations) => { if (alsoAdd && onAddSingle) { await onAddSingle({ product, price: product.retail_price, fundraise: 0, image_url: product.image_front_url || null, takes_number: false, takes_name: false, name_upcharge: 0, transfer_codes: [], num_transfer_sets: [], decorations: decorations || [] }); setPendingOpenPid(product.id); } setMode(null); }} />}
      {mode === 'margin' && <PriceToMarginModal catalog={catalog} costByPid={costByPid} onApply={(pct) => { onPriceToMargin && onPriceToMargin(pct); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'single' && pending && <SinglePriceEditor product={pending} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} library={library} storeFund={storeFund} onSaveLogo={onSaveLogo} onCancel={() => setPending(null)} onAdd={async ({ products, ...rest }) => { for (let i = 0; i < (products || []).length; i++) await onAddSingle({ ...rest, product: products[i], image_url: i === 0 ? rest.image_url : null }); setPending(null); }} />}
      {mode === 'bundle' && <BundleBuilder designOptions={designOptions} numberSets={numberSets} categories={[...new Set([...(standardCategories || []), ...catalog.map((c) => (c.category || '').trim()).filter(Boolean), ...catalog.map((c) => (stockByWp[c.id]?.category || '').trim()).filter(Boolean)])].sort()} components={pkgItems} setComponents={setPkgItems} onCreate={(b) => { onCreateBundle(b); setMode(null); setPkgItems([]); }} onClose={() => { setMode(null); setPkgItems([]); }} />}

      {catalog.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '34px 16px', border: '1.5px dashed #d7dbe2', borderRadius: 14, background: '#fafbfc' }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>🎯</div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Start fast with a template</div>
          <div style={{ fontSize: 13, color: '#6A7180', marginBottom: 14 }}>Pick a pre‑built sport store (baseball, football, volleyball…) — then tweak. Or add products by hand.</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { setMode('template'); setPending(null); }}>🎯 Browse templates</button>
            <button className="btn btn-secondary" onClick={() => { setMode('single'); setPending(null); }}>+ Add product</button>
          </div>
        </div>
      ) : view === 'split' ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* Left: persistent, scrollable item list */}
          <div style={{ width: 340, flexShrink: 0, position: 'sticky', top: 12, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', border: '1px solid #eef0f3', borderRadius: 12, background: '#fff' }}>
            <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '8px 10px', borderBottom: '1px solid #eef0f3', display: 'flex', alignItems: 'center', gap: 6, zIndex: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{groups.length} item{groups.length === 1 ? '' : 's'}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <MenuButton label="+ Category" items={[...[...standardCategories, ...CATEGORY_PRESETS.filter((c) => !standardCategories.some((s) => (s || '').toLowerCase() === c.toLowerCase()))].map((c) => ({ label: c, onClick: () => addCat(c) })), { divider: true }, { label: 'Custom name…', icon: '✏️', onClick: () => { const n = window.prompt('New category name'); if (n && n.trim()) addCat(n.trim()); } }]} />
                <button className="btn btn-sm btn-secondary" onClick={() => { setMode('single'); setPending(null); }}>+ Item</button>
              </div>
            </div>
            {useCats
              ? catSections.map((sec) => (
                <div key={sec.cat || '__unc'}
                  onDragOver={(e) => {
                    if (dragCat && dragCat !== sec.cat) { e.preventDefault(); setOverDragCat(sec.cat); }
                    else if (dragId) { e.preventDefault(); setOverCat(sec.cat); }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragCat && dragCat !== sec.cat) { moveCatSection(dragCat, sec.cat); setDragCat(null); setOverDragCat(null); }
                    else { dropToCat(sec.cat); }
                  }}
                  style={{ boxShadow: overCat === sec.cat && dragId ? 'inset 0 0 0 2px #93c5fd' : overDragCat === sec.cat && dragCat ? 'inset 0 0 0 2px #a78bfa' : undefined }}>
                  <div draggable={!!sec.cat} onDragStart={(e) => { e.stopPropagation(); setDragCat(sec.cat); }} onDragEnd={() => { setDragCat(null); setOverDragCat(null); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: overDragCat === sec.cat && dragCat ? '#ede9fe' : overCat === sec.cat && dragId ? '#dbeafe' : '#f8fafc', borderBottom: '1px solid #eef0f3', borderTop: '1px solid #eef0f3', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: sec.cat ? '#334155' : '#94a3b8', cursor: sec.cat ? 'grab' : 'default' }}>
                    {sec.cat && <span style={{ color: '#cbd5e1', fontSize: 10, marginRight: 2, cursor: 'grab' }}>⠿</span>}
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sec.cat || 'Uncategorized'}</span><span style={{ color: '#cbd5e1', fontWeight: 700 }}>· {sec.groups.length}</span>
                    {sec.groups.length === 0 && <button type="button" onClick={() => setNewCats((p) => p.filter((x) => x !== sec.cat))} title="Remove this empty section" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>}
                  </div>
                  {sec.groups.map((g) => renderRep(g))}
                  {sec.groups.length === 0 && <div style={{ padding: '16px 12px', fontSize: 11, color: overCat === sec.cat && dragId ? '#2563eb' : '#cbd5e1', textAlign: 'center', fontWeight: overCat === sec.cat && dragId ? 700 : 400 }}>{dragId ? `Drop here to add to ${sec.cat}` : 'Drag items here'}</div>}
                </div>
              ))
              : groups.map((g) => renderRep(g))}
          </div>
          {/* Right: editor pane for the selected item */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {(() => {
              const p = repsList.find((x) => x.id === editId) || null;
              if (!p) return <div style={{ border: '1.5px dashed #d7dbe2', borderRadius: 12, padding: '70px 20px', textAlign: 'center', color: '#94a3b8', background: '#fafbfc' }}>Select an item on the left to edit it here.</div>;
              const stock = stockByWp[p.id];
              const groupColors = colorsForRep(p.id);
              return (
                <div style={{ border: '1px solid #eef0f3', borderRadius: 14, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid #eef0f3', borderRadius: '14px 14px 0 0', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{p.display_name || stock?.name || p.sku}{groupColors.length > 1 ? <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}> · {groupColors.length} {groupColors.some((c) => c.variant_label) ? 'fits' : 'colors'}</span> : null}</div>
                    {p.kind !== 'bundle' && <div style={{ display: 'flex', gap: 2 }}>
                      {[['details', '1 · Item setup'], ['sizes', '2 · Sizes'], ['art', '3 · Art & colors']].map(([k, lbl]) => { const on = paneTab === k; return (
                        <button key={k} type="button" onClick={() => setPaneTab(k)} style={{ background: 'none', border: 'none', borderBottom: '2px solid ' + (on ? '#191919' : 'transparent'), color: on ? '#191919' : '#94a3b8', fontWeight: 800, fontSize: 12.5, padding: '4px 10px', cursor: 'pointer' }}>{lbl}</button>
                      ); })}
                    </div>}
                    <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => paneEditorSaveRef.current?.()}>Save</button>
                    {onCopyItem && <button className="btn btn-sm btn-secondary" title="Duplicate this item — image, price, art & options all copied" onClick={() => onCopyItem(p)}>⧉ Copy</button>}
                    <button className="btn btn-sm btn-secondary" style={{ color: '#b91c1c' }} onClick={() => onRemoveGroup(groupColors.map((r) => r.id), p.display_name || stock?.name || p.sku)}>Remove</button>
                  </div>
                  <div style={{ padding: 14 }}>
                    <CatalogItemEditor key={p.id} item={p} groupColors={groupColors} page={paneTab} setPage={setPaneTab} saveRef={paneEditorSaveRef} dirtyRef={paneEditorDirtyRef} onReorderColors={onReorderColors} defaultName={stock?.name} stockImg={stock?.image_front_url} stockBackImg={stock?.image_back_url} availableSizes={stock?.available_sizes || []} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} library={library} storeColors={storeColors} catalog={catalog} bundleItems={bundleItems} standardCategories={standardCategories} stockByWp={stockByWp} costByPid={costByPid} invSrcByPid={invSrcByPid} storeFund={storeFund} onApplyLogo={onApplyLogo} onAddSingle={onAddSingle} onAddColors={onAddColors} onCopyItem={onCopyItem} onRemoveColor={onRemove} onSaveLogo={onSaveLogo} onUpdateCost={onUpdateCost} onUpdateProductMeta={onUpdateProductMeta} onAddBundleItem={onAddBundleItem} onRemoveBundleItem={onRemoveBundleItem} onReorderBundleItems={onReorderBundleItems} onEditItem={switchEditId} onCancel={() => setEditId(null)} onSave={(fields) => onUpdateItem(p.id, fields)} />
                    {p.kind !== 'bundle' && paneTab === 'details' && onAddFits && <FitManager item={p} fits={groupColors} stockByWp={stockByWp} onAttach={async (pr) => { await onAddFits(p, [{ product: pr, label: '' }]); }} onLabel={(id, label) => onUpdateItem(id, { variant_label: label || null })} onRemoveFit={(id, nm) => onRemove(id, nm)} />}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="card"><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={th}>Order</th><th style={th}>Image</th><th style={th}>Product</th><th style={th}>Type</th><th style={th}>Price</th><th style={th}>Fundraising</th><th style={th}>Shopper pays</th><th style={th}>Stock / ETA</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {groups.map(({ rep: p, rows: colorRows }, i) => {
                const stock = stockByWp[p.id];
                const st = stockText(stock);
                const comps = p.kind === 'bundle' ? bundleItems.filter((b) => b.bundle_id === p.id) : [];
                const label = p.display_name || stock?.name || p.sku || '(unnamed)';
                const nColors = colorRows.length;
                const fund = Number(p.fundraise_amount) || 0;
                // Singles fall back to the store-wide fundraising rule when they have no own amount.
                const effFund = p.kind === 'bundle' ? fund : effectiveFundraise(p.retail_price, fund, storeFund);
                const open = expandAll || openRows.has(p.id);
                return (
                  <React.Fragment key={p.id}>
                  <tr
                    onDragOver={(e) => onRowDragOver(e, p)}
                    onDrop={(e) => onRowDrop(e, p)}
                    onDragEnd={() => { setDragId(null); setOverId(null); }}
                    style={{
                      borderTop: dragId && dragId !== p.id && overId === p.id && overPos === 'before' ? '2px solid #191919' : '1px solid #f1f5f9',
                      borderBottom: dragId && dragId !== p.id && overId === p.id && overPos === 'after' ? '2px solid #191919' : undefined,
                      opacity: dragId === p.id ? 0.4 : 1,
                    }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <span
                        draggable
                        onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; const row = e.currentTarget.closest('tr'); if (row) e.dataTransfer.setDragImage(row, 16, 16); }}
                        title="Drag to reorder"
                        style={{ cursor: 'grab', color: '#94a3b8', fontSize: 15, padding: '0 8px 0 2px', userSelect: 'none', display: 'inline-block' }}
                      >⠿</span>
                      <button onClick={() => moveRep(i, 'up')} disabled={i === 0} title="Move up" style={arrowBtn(i === 0)}>▲</button>
                      <button onClick={() => moveRep(i, 'down')} disabled={i === groups.length - 1} title="Move down" style={arrowBtn(i === groups.length - 1)}>▼</button>
                    </td>
                    <td style={td}><RowImage row={p} stockImg={stock?.image_front_url} onUpdateImage={onUpdateImage} /></td>
                    <td style={{ ...td, cursor: 'pointer' }} onClick={() => setEditId(p.id)} title="Click to edit this item">
                      <div style={{ fontWeight: 600, color: '#191919' }}>{label} <span style={{ fontSize: 11, fontWeight: 600, color: '#2563eb' }}>· edit</span></div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{[p.sku, stock?.color, stock?.category].filter(Boolean).join(' · ')}{nColors > 1 ? <span style={{ color: '#2563eb', fontWeight: 700 }}> · {nColors} {colorRows.some((c) => c.variant_label) ? 'fits' : 'colors'}</span> : null}</div>
                      {comps.length > 0 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        {comps.map((c) => <div key={c.id}>• {c.qty}× {c.sku || c.product_id}{c.size_required ? '' : ' (one size)'}{c.takes_number ? ' #' : ''}</div>)}
                      </div>}
                    </td>
                    <td style={td}>{p.kind === 'bundle' ? <Chip label="Bundle" tone="blue" /> : <Chip label="Single" />}</td>
                    <td style={td}>
                      {money(p.retail_price)}
                      {p.kind !== 'bundle' && costByPid[p.product_id] != null && (() => {
                        const m = (Number(p.retail_price) || 0) - costByPid[p.product_id];
                        const pct = p.retail_price > 0 ? Math.round((m / Number(p.retail_price)) * 100) : null;
                        const col = m < 0 ? '#b91c1c' : (p.retail_price > 0 && m / Number(p.retail_price) < 0.3) ? '#92400e' : '#166534';
                        return <div style={{ fontSize: 10.5, fontWeight: 700, color: col, marginTop: 2 }} title={`Cost ${money(costByPid[p.product_id])}`}>{m >= 0 ? '+' : ''}{money(m)}{pct != null ? ` (${pct}%)` : ''} margin</div>;
                      })()}
                    </td>
                    <td style={td}>{effFund > 0 ? <span style={{ color: '#166534', fontWeight: 600 }}>+{money(effFund)}{fund <= 0 ? <span style={{ color: '#94a3b8', fontWeight: 500 }}> · store</span> : null}</span> : '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{money((Number(p.retail_price) || 0) + effFund)}</td>
                    <td style={td}>
                      {p.kind === 'bundle' ? '—' : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700, color: st.color }}>{st.text}</span>
                            <button onClick={() => toggleRow(p.id)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11, padding: 0 }}>{open ? 'hide sizes ▲' : 'sizes ▾'}</button>
                          </div>
                          {open && <div style={{ marginTop: 6 }}><StockBreakdown stock={stock} summary={st} hideSummary /></div>}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setEditId(editId === p.id ? null : p.id)}>{editId === p.id ? 'Close' : 'Edit'}</button>
                      <button className="btn btn-sm btn-secondary" style={{ color: '#b91c1c', marginLeft: 6 }} onClick={() => onRemoveGroup(colorRows.map((r) => r.id), label)}>Remove</button>
                    </td>
                  </tr>
                  {editId === p.id && <tr><td colSpan={9} style={{ padding: 0 }}>
                    <div onClick={() => setEditId(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
                      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 1240, margin: 'auto' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3', background: '#fff', borderRadius: '14px 14px 0 0' }}>
                          <div style={{ fontWeight: 800, fontSize: 16 }}>{p.display_name || stock?.name || p.sku}</div>
                          <button onClick={() => setEditId(null)} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
                        </div>
                        <CatalogItemEditor key={p.id} item={p} groupColors={colorRows} defaultName={stock?.name} stockImg={stock?.image_front_url} stockBackImg={stock?.image_back_url} availableSizes={stock?.available_sizes || []} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} library={library} storeColors={storeColors} catalog={catalog} standardCategories={standardCategories} stockByWp={stockByWp} costByPid={costByPid} invSrcByPid={invSrcByPid} storeFund={storeFund} onApplyLogo={onApplyLogo} onAddSingle={onAddSingle} onAddColors={onAddColors} onCopyItem={onCopyItem} onRemoveColor={onRemove} onSaveLogo={onSaveLogo} onUpdateCost={onUpdateCost} onUpdateProductMeta={onUpdateProductMeta} onCancel={() => setEditId(null)} onSave={(fields) => onUpdateItem(p.id, fields)} />
                      </div>
                    </div>
                  </td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}
    </>
  );
}

// Per-item logo picker + on-garment placement. A decoration is stored as
// { art_id, art_url, source_url, placement, color_label, x, y, w } where x/y are the
// logo CENTER and w the width, as % of the garment image — the exact coordinates the
// storefront DecoOverlay renders, so this preview matches what shoppers see.
// "Apply this logo to other items, same location." Stamps the selected decoration
// (logo + placement + size + color + side) onto the chosen sibling items via the parent's
// apply handler, which replaces any decoration at the same placement+side on each.
function ApplyToOthers({ deco, siblings, onApply }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  if (!deco || !siblings.length || !onApply) return null;
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const apply = async () => {
    if (!picked.size) return;
    setBusy(true);
    // Carry the EXACT position & size the rep set: resolve x/y/w to concrete numbers
    // (a freshly-placed logo may still be reading them from the placement default), so
    // every target garment gets the logo at the same spot and scale. The deco's
    // cw_by_color map rides along too, so each garment color resolves its own colorway.
    const p = placementById(deco.placement);
    const full = { ...deco, x: deco.x != null ? deco.x : p.x, y: deco.y != null ? deco.y : p.y, w: deco.w != null ? deco.w : p.w };
    try { await onApply([...picked], full); setPicked(new Set()); setOpen(false); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ fontSize: 11.5, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>{open ? 'Done' : 'Apply this logo to other items →'}</button>
      {open && <div style={{ marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#fff' }}>
        <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 6 }}>Same logo, size &amp; color at <b>{placementById(deco.placement).label}</b>{(deco.side || 'front') === 'back' ? ' (back)' : ''} — pick items:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(76px,1fr))', gap: 6, maxHeight: 210, overflowY: 'auto' }}>
          {siblings.map((s) => { const on = picked.has(s.id); return (
            <button key={s.id} type="button" onClick={() => toggle(s.id)} title={s.name} style={{ position: 'relative', border: on ? '2px solid #166534' : '1px solid #e2e8f0', borderRadius: 8, padding: 4, background: '#fff', cursor: 'pointer' }}>
              <div style={{ height: 54, background: '#f8fafc', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.img ? <img src={s.img} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9, color: '#cbd5e1' }}>no image</span>}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
              {on && <span style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#166534', color: '#fff', fontSize: 10, fontWeight: 800, lineHeight: '16px', textAlign: 'center' }}>✓</span>}
            </button>
          ); })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <button type="button" onClick={() => setPicked(new Set(siblings.map((s) => s.id)))} style={{ fontSize: 11, fontWeight: 700, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>Select all</button>
          <button type="button" disabled={!picked.size || busy} onClick={apply} className="btn btn-sm btn-primary">{busy ? 'Applying…' : `Apply to ${picked.size || ''} item${picked.size === 1 ? '' : 's'}`}</button>
        </div>
      </div>}
    </div>
  );
}

// Cloudinary can rasterize the first page of a PDF/AI/EPS to a PNG via a delivery transform,
// so dropped vector art gets a placeable web preview. Returns null for non-Cloudinary urls.
const vectorPreviewUrl = (url) => {
  if (!url || !/res\.cloudinary\.com/.test(url)) return null;
  let u = url.replace('/raw/upload/', '/image/upload/');
  if (!/\/image\/upload\//.test(u)) return null;
  u = u.replace('/image/upload/', '/image/upload/f_png,pg_1,w_1000,c_limit/');
  u = u.replace(/\.(ai|eps|pdf)(\?|$)/i, '.png$2');
  if (!/\.png(\?|$)/i.test(u)) u += '.png';
  return u;
};
const _probeImg = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = u; });

function LogoPlacer({ imageUrl, decorations, onChange, library = [], onSaveLogo, backImageUrl, stockBackImg, onBackImageChange, storeColors = [], siblings = [], onApplyToItems, takesNumber = false, takesName = false, colorRows = [], primaryColorId = null, onReorderColors }) {
  const boxRef = useRef();
  const fileRef = useRef();
  const backRef = useRef();
  const [sel, setSel] = useState(0);
  const [side, setSide] = useState('front');
  const [upBusy, setUpBusy] = useState(false);
  const [note, setNote] = useState('');
  const [recoloring, setRecoloring] = useState('');
  const [swapFrom, setSwapFrom] = useState(null);   // a logo color the rep wants to change
  const [imgPalette, setImgPalette] = useState([]); // the selected logo's own colors
  const [dragOver, setDragOver] = useState(false);
  const drag = useRef(null);
  const decos = Array.isArray(decorations) ? decorations : [];
  const sideOf = (d) => d.side || 'front';
  // Detect the selected logo's colors so the rep can recolor just one of them.
  useEffect(() => {
    let cancelled = false;
    const url = decos[sel] && sideOf(decos[sel]) === side ? decos[sel].art_url : null;
    setSwapFrom(null);
    if (!url) { setImgPalette([]); return; }
    (async () => { try { const p = await extractPalette(url); if (!cancelled) setImgPalette(p); } catch (e) { if (!cancelled) setImgPalette([]); } })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, decos[sel] && decos[sel].art_url, side]);
  // Team palette for recolor swatches — the customer's PMS colors (e.g. Red, Royal),
  // deduped, so a single-color logo can be stamped in each team color per garment.
  const palette = [];
  { const seen = new Set();
    (storeColors || []).forEach((pc) => {
      let h = pantoneHex(pc && pc.code) || (pc && pc.hex) || '';
      if (h && h[0] !== '#') h = '#' + h;
      if (/^#[0-9a-f]{6}$/i.test(h) && !seen.has(h.toLowerCase())) { seen.add(h.toLowerCase()); palette.push({ label: (pc && (pc.name || pc.code)) || h, hex: h }); }
    });
  }
  // Which garment color is previewed on the stage. Defaults to the primary item; clicking a
  // color in the filmstrip below the canvas swaps the front image so reps can flip through
  // colorways without leaving the page. The primary uses imageUrl (honors a custom override).
  const [previewColorId, setPreviewColorId] = useState(primaryColorId);
  const [dragColorId, setDragColorId] = useState(null); // filmstrip chip being dragged to reorder
  const _prevRow = (colorRows || []).find((c) => c.id === previewColorId);
  const frontUrl = (previewColorId && previewColorId !== primaryColorId && _prevRow && _prevRow.frontUrl) ? _prevRow.frontUrl : imageUrl;
  const _prevColorName = _prevRow ? _prevRow.name : null;
  const webLogosOf = (d) => { const art = (library || []).find((a) => a.id === d.art_id); return art && Array.isArray(art.web_logos) ? art.web_logos : []; };
  const backUrl = backImageUrl || stockBackImg || '';
  const stageUrl = side === 'back' ? backUrl : frontUrl;
  // Show the front/back toggle when a back exists/can be added, or when the item is
  // personalized (numbers/names preview on the back even without a back photo).
  const canBack = !!(onBackImageChange || backUrl || takesNumber || takesName);
  const defaultPlacement = side === 'back' ? 'full_back' : 'left_chest';
  const switchSide = (s) => { setSide(s); const first = decos.findIndex((d) => sideOf(d) === s); setSel(first >= 0 ? first : 0); };
  const coord = (d, k) => { const p = placementById(d.placement); return d[k] != null ? d[k] : p[k]; };
  const update = (i, patch) => onChange(decos.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const remove = (i) => { onChange(decos.filter((_, j) => j !== i)); setSel((s) => Math.max(0, s - (i <= s ? 1 : 0))); };
  const addLogo = (art, urlOverride) => {
    const url = urlOverride || artPlaceUrl(art); if (!url) { setNote('That art has no web-ready logo yet — drop a PNG/SVG below to place it.'); return; }
    setNote('');
    const p = placementById(defaultPlacement);
    onChange([...decos, { art_id: art.id, art_url: url, orig_url: url, source_url: artSourceUrl(art), placement: defaultPlacement, color_label: 'original', side, x: p.x, y: p.y, w: p.w }]);
    setSel(decos.length);
  };
  // Upload a per-item BACK image (the "quick add a back" affordance). Held in editor state
  // and saved onto the item (webstore_products.image_back_url) when the editor saves.
  const uploadBack = async (file) => {
    if (!file || !file.type.startsWith('image/') || !onBackImageChange) return;
    setUpBusy(true);
    try { const url = await cloudUpload(file, 'nsa-webstores'); onBackImageChange(url); setSide('back'); }
    catch (x) { /* cloudUpload surfaces error via toast */ }
    setUpBusy(false);
  };
  // Recolor the selected logo from its ORIGINAL cutout (so swaps round-trip cleanly) and
  // re-upload the variant. choice is 'original' | 'white' | 'black' | a hex (#rrggbb) — so
  // a single-color logo can be team Red on one garment, Royal on another. color_label keeps
  // the choice for the active-swatch highlight.
  const recolor = async (i, choice) => {
    const d = decos[i]; if (!d) return;
    const orig = d.orig_url || d.art_url; if (!orig) return;
    if (choice === 'original') { update(i, { art_url: orig, color_label: 'original' }); return; }
    const hex = choice === 'white' ? '#ffffff' : choice === 'black' ? '#000000' : choice;
    setRecoloring(choice); setNote('');
    try {
      const blob = await recolorToBlob(orig, hex);
      const ext = isSvg(orig) ? 'svg' : 'png';
      const file = new File([blob], `logo-${String(hex).replace('#', '')}.${ext}`, { type: blob.type });
      const url = await cloudUpload(file, 'nsa-store-art');
      update(i, { art_url: url, color_label: choice });
    } catch (e) { setNote('Could not recolor: ' + (e.message || e)); }
    setRecoloring('');
  };
  // Change just ONE color of the logo (the selected swapFrom) to a target — applied to the
  // current art so swaps can be chained (white→red, then gold→navy).
  const swapColor = async (i, toHex) => {
    const d = decos[i]; if (!d || !swapFrom) return;
    setRecoloring(toHex); setNote('');
    try {
      const base = d.art_url;
      const blob = await swapColorToBlob(base, swapFrom, toHex);
      const ext = isSvg(base) ? 'svg' : 'png';
      const file = new File([blob], `logo-swap.${ext}`, { type: blob.type });
      const url = await cloudUpload(file, 'nsa-store-art');
      update(i, { art_url: url, color_label: 'custom' });
      setSwapFrom(null);
    } catch (e) { setNote('Could not change that color: ' + (e.message || e)); }
    setRecoloring('');
  };
  // A target swatch either swaps the selected logo color, or recolors the whole logo.
  const applyColor = (i, hex) => (swapFrom ? swapColor(i, hex) : recolor(i, hex));
  // Upload a logo file (PNG/SVG/JPG) straight from here and drop it on the garment —
  // no need to pre-load the Art & Logos library.
  const uploadLogo = async (file) => {
    if (!file) return;
    const name = file.name || 'Logo';
    const isImg = (file.type || '').startsWith('image/') || /\.(png|svg|jpe?g|webp|gif)$/i.test(name);
    const isArt = /\.(ai|eps|pdf)$/i.test(name);
    if (!isImg && !isArt) { setNote('Drop an image (PNG, JPG, SVG) or vector art (AI, EPS, PDF).'); return; }
    setUpBusy(true);
    try {
      const url = await cloudUpload(file, 'nsa-store-art');
      const label = name.replace(/\.[^.]+$/, '');
      const place = (artUrl, artId, sourceUrl) => { const p = placementById(defaultPlacement); onChange([...decos, { art_id: artId, art_url: artUrl, orig_url: artUrl, source_url: sourceUrl || artUrl, placement: defaultPlacement, color_label: 'original', side, x: p.x, y: p.y, w: p.w }]); setSel(decos.length); setNote(''); };
      if (isImg) {
        let artId = null;
        if (onSaveLogo) { const rec = await onSaveLogo(url, label); artId = (rec && rec.id) || null; }
        place(url, artId, url);
      } else {
        // Vector — try to rasterize a placeable PNG preview (keeping the .ai as the source).
        const png = vectorPreviewUrl(url);
        const ok = png ? await _probeImg(png) : false;
        if (ok) {
          let artId = null;
          if (onSaveLogo) { const rec = await onSaveLogo(png, label, { sourceFile: url }); artId = (rec && rec.id) || null; }
          place(png, artId, url);
        } else {
          // Couldn't rasterize — keep it as production source art to attach a PNG to later.
          if (onSaveLogo) await onSaveLogo(url, label, { source: true });
          setNote('Added “' + label + '” as production art. Drop a PNG or SVG to place & recolor it on the garment.');
        }
      }
    } catch (x) { /* cloudUpload surfaces error via toast */ }
    setUpBusy(false);
  };
  const uploadLogos = async (files) => { for (const f of [...(files || [])]) await uploadLogo(f); };
  const onPtrMove = (e) => {
    const d = drag.current; if (d == null || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    if (d.mode === 'resize') {
      // Width = twice the horizontal distance from the (centered) logo to the cursor.
      const cx = (coord(decos[d.i], 'x') / 100) * r.width;
      const halfW = Math.abs((e.clientX - r.left) - cx);
      update(d.i, { w: Math.max(4, Math.min(100, Math.round((halfW * 2 / r.width) * 100))) });
    } else {
      update(d.i, {
        x: Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100))),
        y: Math.max(0, Math.min(100, Math.round(((e.clientY - r.top) / r.height) * 100))),
      });
    }
  };
  const endDrag = () => { drag.current = null; };
  const current = decos[sel];
  const currentOnSide = current && sideOf(current) === side && !isPerso(current);
  const shown = decos.map((d, i) => ({ d, i })).filter(({ d }) => sideOf(d) === side && !isPerso(d));
  // Explicit perso placements (number/name) live in decorations as tokens.
  const persoIdx = (kind) => decos.findIndex((d) => d.kind === kind);
  const addPerso = (kind) => { const p = persoDefault(kind); onChange([...decos, { kind, side: 'back', x: p.x, y: p.y, w: p.w }]); setSel(decos.length); };
  const removePerso = (kind) => { const idx = persoIdx(kind); if (idx >= 0) { setSel(-1); onChange(decos.filter((_, i) => i !== idx)); } };
  const card = { background: '#fff', border: '1px solid #eef2f7', borderRadius: 12, padding: 12, marginBottom: 10 };
  const cardTitle = { fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 };
  const cardHint = { fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' };
  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* HERO CANVAS */}
      <div style={{ flex: '0 0 auto', width: 'min(360px, 40vw)' }}>
        {canBack && (
          <div style={{ display: 'flex', gap: 4, padding: 3, background: '#eef1f5', borderRadius: 10, marginBottom: 10, width: 'fit-content' }}>
            {['front', 'back'].map((s) => { const on = side === s; return (
              <button key={s} type="button" onClick={() => switchSide(s)} style={{ border: 'none', background: on ? '#fff' : 'transparent', color: on ? '#191919' : '#64748b', borderRadius: 8, padding: '5px 20px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', boxShadow: on ? '0 1px 3px rgba(0,0,0,.12)' : 'none' }}>{s === 'front' ? 'Front' : 'Back'}</button>
            ); })}
          </div>
        )}
        <div ref={boxRef} onPointerMove={onPtrMove} onPointerUp={endDrag} onPointerLeave={endDrag}
          style={{ position: 'relative', width: '100%', aspectRatio: '4/5', background: 'radial-gradient(circle at 50% 36%, #ffffff 0%, #eceff3 100%)', borderRadius: 16, overflow: 'hidden', border: '1px solid #e2e8f0', touchAction: 'none' }}>
          {stageUrl ? <img src={stageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
            : side === 'back' && onBackImageChange ? <button type="button" onClick={() => backRef.current && backRef.current.click()} style={{ position: 'absolute', inset: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', fontSize: 13, fontWeight: 700 }}>+ Add a back image</button>
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#cbd5e1', fontSize: 12 }}>no image</div>}
          {decos.map((d, i) => (sideOf(d) === side && !(d.kind === 'perso_number' && !takesNumber) && !(d.kind === 'perso_name' && !takesName) ? (
            <div key={i}
              onPointerDown={(e) => { e.preventDefault(); setSel(i); drag.current = { i, mode: 'move' }; }}
              style={{ position: 'absolute', left: `${coord(d, 'x')}%`, top: `${coord(d, 'y')}%`, width: `${coord(d, 'w')}%`, transform: 'translate(-50%,-50%)', cursor: 'move', outline: i === sel ? '2px solid #2563eb' : 'none', outlineOffset: 1, touchAction: 'none' }}>
              {isPerso(d)
                ? <PersoArt kind={d.kind} />
                : <img src={(side === 'front' && decoUrlForColor(d, _prevColorName, webLogosOf(d))) || d.art_url} alt="" draggable={false} style={{ display: 'block', width: '100%', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))' }} />}
              {i === sel && <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setSel(i); drag.current = { i, mode: 'resize' }; }} title="Drag to resize" style={{ position: 'absolute', right: -8, bottom: -8, width: 16, height: 16, borderRadius: 4, background: '#2563eb', border: '2px solid #fff', cursor: 'nwse-resize', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />}
            </div>
          ) : null))}
        </div>
        {side === 'back' && onBackImageChange && stageUrl && <div style={{ textAlign: 'center', marginTop: 8 }}><button type="button" onClick={() => backRef.current && backRef.current.click()} disabled={upBusy} style={{ border: '1px dashed #94a3b8', background: '#fff', color: '#475569', borderRadius: 8, padding: '4px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{upBusy ? '…' : 'Replace back image'}</button></div>}
        <input ref={backRef} type="file" accept="image/*,.png" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) uploadBack(f); e.target.value = ''; }} />
        {shown.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, justifyContent: 'center' }}>
            {shown.map(({ d, i }, n) => (
              <button key={i} type="button" onClick={() => setSel(i)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid ' + (i === sel ? '#191919' : '#d1d5db'), background: i === sel ? '#191919' : '#fff', color: i === sel ? '#fff' : '#3A4150', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                <img src={d.art_url} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} /> Logo {n + 1}
                <span onClick={(e) => { e.stopPropagation(); remove(i); }} style={{ color: i === sel ? '#fca5a5' : '#b91c1c', fontWeight: 800 }}>×</span>
              </button>
            ))}
          </div>
        )}
        {/* Garment-color filmstrip: each color previewed with the art. Click to flip the stage
            to that color; drag to reorder — the leftmost color leads the catalog row and the
            storefront card (its default color). */}
        {colorRows.length > 1 && side === 'front' && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {colorRows.map((c) => { const on = c.id === previewColorId; const isFirst = colorRows[0] && colorRows[0].id === c.id; const dragging = dragColorId === c.id; return (
                <button key={c.id} type="button" draggable={!!onReorderColors}
                  onClick={() => setPreviewColorId(c.id)}
                  onDragStart={(e) => { setDragColorId(c.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { if (dragColorId && dragColorId !== c.id) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (!onReorderColors || !dragColorId || dragColorId === c.id) return; const ids = colorRows.map((r) => r.id); const from = ids.indexOf(dragColorId); const to = ids.indexOf(c.id); if (from < 0 || to < 0) return; ids.splice(to, 0, ids.splice(from, 1)[0]); setDragColorId(null); onReorderColors(ids); }}
                  onDragEnd={() => setDragColorId(null)}
                  title={(onReorderColors ? 'Click to preview · drag to reorder' : 'Click to preview') + ' — ' + c.name}
                  style={{ flex: '0 0 auto', width: 76, border: '2px solid ' + (on ? '#191919' : '#e2e8f0'), borderRadius: 9, padding: 3, background: '#fff', cursor: onReorderColors ? 'grab' : 'pointer', opacity: dragging ? 0.4 : 1, position: 'relative' }}>
                  {isFirst && <span style={{ position: 'absolute', top: -7, left: -6, background: '#191919', color: '#fff', fontSize: 8, fontWeight: 800, letterSpacing: 0.3, padding: '1px 5px', borderRadius: 6, textTransform: 'uppercase' }}>1st</span>}
                  <GarmentLogoPreview imageUrl={c.frontUrl} decorations={decos} colorName={c.name} library={library} />
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: on ? '#191919' : '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{c.name}</div>
                </button>
              ); })}
            </div>
            {onReorderColors && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 5 }}>Drag to reorder · the <b>1st</b> color leads the catalog row &amp; the storefront.</div>}
          </>
        )}
      </div>

      {/* CONTROLS */}
      <div style={{ flex: 1, minWidth: 300 }}>
        <div style={card}>
          <div style={cardTitle}>Logo library <span style={cardHint}>· tap to place · drag &amp; drop a PNG / SVG / AI to add</span></div>
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!dragOver) setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); uploadLogos(e.dataTransfer.files); }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))', gap: 8, padding: 10, border: `1.5px dashed ${dragOver ? '#2563eb' : '#d7dbe2'}`, borderRadius: 12, background: dragOver ? '#eff4ff' : '#fafbfc', transition: 'background .12s, border-color .12s' }}>
            {library.flatMap((a) => {
              // Art with multiple per-color-way web logos shows one pickable tile per color
              // way (labeled), so a rep/CSR places the correct one; single-logo art = one tile.
              const wls = Array.isArray(a.web_logos) ? a.web_logos.filter((w) => w && w.url) : [];
              if (wls.length > 1) {
                return wls.map((w, wi) => (
                  <button key={a.id + ':cw' + wi} type="button" onClick={() => addLogo(a, w.url)} title={(a.name || 'Logo') + ' — ' + (w.color_way || 'All garments')} style={{ position: 'relative', aspectRatio: '1', padding: 5, borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src={w.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.2, color: '#fff', background: 'rgba(15,26,56,0.78)', padding: '1px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.color_way || 'All'}</span>
                  </button>
                ));
              }
              const u = artPlaceUrl(a); if (!u) return [];
              return [(
                <button key={a.id} type="button" onClick={() => addLogo(a)} title={a.name || 'Logo'} style={{ aspectRatio: '1', padding: 5, borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={u} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </button>
              )];
            })}
            <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={upBusy} style={{ aspectRatio: '1', borderRadius: 10, border: '1.5px dashed #cbd5e1', background: '#fff', cursor: 'pointer', color: '#6A7180', fontSize: 11, fontWeight: 800, lineHeight: 1.1 }}>{upBusy ? '…' : '+ Logo'}</button>
            <input ref={fileRef} type="file" accept="image/*,.svg,.png,.ai,.eps,.pdf" multiple style={{ display: 'none' }} onChange={(e) => { uploadLogos(e.target.files); e.target.value = ''; }} />
          </div>
          {dragOver && <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700, marginTop: 6 }}>Drop to add to the library</div>}
          {note && <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600, marginTop: 8 }}>{note}</div>}
        </div>

        {(takesNumber || takesName) && (
          <div style={card}>
            <div style={cardTitle}>Number &amp; name on the mockup <span style={cardHint}>· sample preview shoppers see on the back</span></div>
            {side !== 'back'
              ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Switch the mockup to <b>Back</b> to place the number/name.</div>
              : [takesNumber && 'perso_number', takesName && 'perso_name'].filter(Boolean).map((kind) => {
                  const idx = persoIdx(kind); const label = kind === 'perso_number' ? 'Number' : 'Name'; const placed = idx >= 0;
                  return (
                    <div key={kind} style={{ marginBottom: 8 }}>
                      {placed ? (<>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#191919' }}>{label} placed <span style={{ color: '#94a3b8', fontWeight: 500 }}>· drag it, corner to resize</span></span>
                          <button type="button" onClick={() => removePerso(kind)} style={{ background: 'none', border: 'none', color: '#b91c1c', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Remove</button>
                        </div>
                        <input type="range" min={8} max={80} value={Math.round((decos[idx] && decos[idx].w) || persoDefault(kind).w)} onChange={(e) => update(idx, { w: Number(e.target.value) })} style={{ width: '100%' }} />
                      </>) : (
                        <button type="button" onClick={() => addPerso(kind)} className="btn btn-sm btn-secondary">+ Add {label.toLowerCase()} to mockup</button>
                      )}
                    </div>
                  );
                })}
          </div>
        )}

        {shown.length === 0 ? <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '6px 2px' }}>No logo on the {side} yet — tap a logo above to drop it on the garment, then position &amp; recolor it here.</div> : currentOnSide && <React.Fragment>
          <div style={card}>
            <div style={cardTitle}>Placement</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ART_PLACEMENTS.map((p) => (
                <button key={p.id} type="button" onClick={() => update(sel, { placement: p.id, x: p.x, y: p.y, w: p.w })} style={{ border: '1px solid ' + (current.placement === p.id ? '#191919' : '#d1d5db'), background: current.placement === p.id ? '#191919' : '#fff', color: current.placement === p.id ? '#fff' : '#3A4150', borderRadius: 999, padding: '4px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{p.label}</button>
              ))}
            </div>
          </div>
          <div style={card}>
            <div style={cardTitle}>Size <span style={cardHint}>· {Math.round(coord(current, 'w'))}% of garment width</span></div>
            <input type="range" min={8} max={70} value={Math.round(coord(current, 'w'))} onChange={(e) => update(sel, { w: Number(e.target.value) })} style={{ width: '100%' }} />
          </div>
          <div style={card}>
            <div style={cardTitle}>Color <span style={cardHint}>· change one color, or recolor the whole logo</span></div>
            {imgPalette.length > 0 && (
              <div style={{ marginBottom: 9 }}>
                <div style={{ fontSize: 10.5, color: swapFrom ? '#2563eb' : '#94a3b8', fontWeight: swapFrom ? 700 : 500, marginBottom: 5 }}>{swapFrom ? 'Changing this color — pick a new one below' : 'Logo colors · tap one to change just it'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {imgPalette.map((c) => { const on = swapFrom === c.hex; return (
                    <button key={c.hex} type="button" disabled={!!recoloring} onClick={() => setSwapFrom(on ? null : c.hex)} title={on ? 'Selected — pick a new color below' : 'Change this color'} style={{ width: 26, height: 26, borderRadius: 13, border: on ? '3px solid #2563eb' : '1px solid #cbd5e1', background: c.hex, cursor: 'pointer', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
                  ); })}
                </div>
              </div>
            )}
            <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 6 }}>{swapFrom ? 'Change it to:' : 'Recolor the whole logo:'}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button type="button" disabled={!!recoloring} onClick={() => recolor(sel, 'original')} style={{ flex: 1, border: '1px solid #d1d5db', background: '#fff', color: '#3A4150', borderRadius: 8, padding: '5px 0', fontSize: 11.5, fontWeight: 700, cursor: recoloring ? 'wait' : 'pointer' }}>Original</button>
              <button type="button" disabled={!!recoloring} onClick={() => applyColor(sel, '#ffffff')} style={{ flex: 1, border: '1px solid #d1d5db', background: '#fff', color: '#3A4150', borderRadius: 8, padding: '5px 0', fontSize: 11.5, fontWeight: 700, cursor: recoloring ? 'wait' : 'pointer' }}>{recoloring === '#ffffff' ? '…' : 'White'}</button>
              <button type="button" disabled={!!recoloring} onClick={() => applyColor(sel, '#000000')} style={{ flex: 1, border: '1px solid #d1d5db', background: '#fff', color: '#3A4150', borderRadius: 8, padding: '5px 0', fontSize: 11.5, fontWeight: 700, cursor: recoloring ? 'wait' : 'pointer' }}>{recoloring === '#000000' ? '…' : 'Black'}</button>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
              {palette.map((c) => (
                <button key={c.hex + c.label} type="button" disabled={!!recoloring} onClick={() => applyColor(sel, c.hex)} title={c.label} style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid #cbd5e1', background: c.hex, cursor: recoloring ? 'wait' : 'pointer', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)' }}>{recoloring === c.hex ? '…' : ''}</button>
              ))}
              <label title="Custom color" style={{ width: 28, height: 28, borderRadius: 7, border: '1px dashed #cbd5e1', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, position: 'relative', color: '#64748b' }}>＋
                <input type="color" disabled={!!recoloring} onChange={(e) => applyColor(sel, e.target.value)} style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }} />
              </label>
              {palette.length === 0 && <span style={{ fontSize: 10.5, color: '#94a3b8' }}>Add team PMS colors to the customer for quick swatches.</span>}
            </div>
          </div>
          <div style={card}>
            <ApplyToOthers deco={current} siblings={siblings} onApply={onApplyToItems} />
          </div>
        </React.Fragment>}
      </div>
    </div>
  );
}

// Inline editor for an existing catalog item (single or bundle).
// Titled panel — the editor is organized into clear sectioned cards.
function ItemSection({ title, hint, right, children, pad = 14, subtle = false }) {
  return (
    <div style={{ border: `1px solid ${subtle ? '#eef0f3' : '#e8ebf0'}`, borderRadius: 12, padding: pad, marginBottom: 14, background: subtle ? '#fafbfc' : '#fff' }}>
      {(title || right) && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: subtle ? 8 : 10 }}>
        <div style={{ fontSize: subtle ? 11 : 12, fontWeight: subtle ? 700 : 800, color: subtle ? '#94a3b8' : '#334155', textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}{hint && <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94a3b8', marginLeft: 8 }}>{hint}</span>}</div>
        {right}
      </div>}
      {children}
    </div>
  );
}

// Shopper-facing add-on options for an item — either a yes/no add-on with one
// upcharge (e.g. "Embroidered name +$5") or a "pick one" choice list (e.g. collar
// color, each choice with its own upcharge). Stored on webstore_products.options.
function OptionsEditor({ value, onChange }) {
  const opts = Array.isArray(value) ? value : [];
  const set = (i, patch) => onChange(opts.map((o, j) => j === i ? { ...o, ...patch } : o));
  const add = () => onChange([...opts, { id: Math.random().toString(36).slice(2, 8), label: '', kind: 'addon', upcharge: 0, required: false, choices: [] }]);
  const remove = (i) => onChange(opts.filter((_, j) => j !== i));
  const setChoice = (i, ci, patch) => set(i, { choices: (opts[i].choices || []).map((c, j) => j === ci ? { ...c, ...patch } : c) });
  const addChoice = (i) => set(i, { choices: [...(opts[i].choices || []), { label: '', upcharge: 0 }] });
  const rmChoice = (i, ci) => set(i, { choices: (opts[i].choices || []).filter((_, j) => j !== ci) });
  return (
    <div>
      {opts.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>No add-ons yet — add things a shopper can pick, like an embroidered name (+$) or a collar color.</div>}
      {opts.map((o, i) => (
        <div key={o.id || i} style={{ border: '1px solid #e8ebf0', borderRadius: 10, padding: 10, marginBottom: 8, background: '#fff' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="form-input" style={{ flex: 1, minWidth: 150 }} placeholder="Option label (e.g. Embroidered name)" value={o.label} onChange={(e) => set(i, { label: e.target.value })} />
            <select className="form-input" style={{ width: 150 }} value={o.kind} onChange={(e) => set(i, { kind: e.target.value })}>
              <option value="addon">Yes / No add-on</option>
              <option value="choice">Pick one</option>
            </select>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={!!o.required} onChange={(e) => set(i, { required: e.target.checked })} />required</label>
            <button type="button" onClick={() => remove(i)} title="Remove option" style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
          {o.kind === 'addon'
            ? <div style={{ marginTop: 8, fontSize: 13 }}>Upcharge +$<input className="form-input" style={{ width: 90, display: 'inline-block', marginLeft: 4 }} type="number" step="0.01" min={0} value={o.upcharge || 0} onChange={(e) => set(i, { upcharge: Number(e.target.value) || 0 })} /></div>
            : <div style={{ marginTop: 8 }}>
                {(o.choices || []).map((c, ci) => (
                  <div key={ci} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                    <input className="form-input" style={{ flex: 1, minWidth: 120 }} placeholder="Choice (e.g. Royal)" value={c.label} onChange={(e) => setChoice(i, ci, { label: e.target.value })} />
                    <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>+$<input className="form-input" style={{ width: 80, display: 'inline-block', marginLeft: 3 }} type="number" step="0.01" min={0} value={c.upcharge || 0} onChange={(e) => setChoice(i, ci, { upcharge: Number(e.target.value) || 0 })} /></span>
                    <button type="button" onClick={() => rmChoice(i, ci)} title="Remove choice" style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>×</button>
                  </div>
                ))}
                <button type="button" onClick={() => addChoice(i)} style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ add choice</button>
              </div>}
        </div>
      ))}
      <button type="button" onClick={add} className="btn btn-sm btn-secondary">+ Add an option</button>
    </div>
  );
}

// Drop blank options / empty choices so we never store half-filled add-ons.
const cleanItemOptions = (options) => (Array.isArray(options) ? options : [])
  .map((o) => ({ ...o, label: (o.label || '').trim(), choices: (o.choices || []).filter((c) => (c.label || '').trim()).map((c) => ({ label: c.label.trim(), upcharge: Number(c.upcharge) || 0 })) }))
  .filter((o) => o.label && (o.kind === 'addon' || o.choices.length));

// Per-color web-logo override on a placed deco. cw_by_color maps a lowercased garment
// color name -> the web-logo URL to use for that color (e.g. a white logo on a black tee,
// a dark logo on a white tee). Falls back to the deco's placed art_url when unset.
const colorKeyOf = (name) => String(name || '').trim().toLowerCase();
// Pick the web-logo color way meant for a given garment color — e.g. a "Navy" colorway for
// a Navy garment, a "Grey" colorway for "Heather Grey". Matches on a shared word token so
// "Heather Grey" still finds the "Grey" colorway. Falls back to an "all garments"/blank
// colorway, then null (caller uses the deco's placed art_url).
const _normColorWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
// Returns the matched web_logos[] ENTRY (so callers can read its color_way_id, not just the
// url); webLogoForGarmentColor below keeps the original url-returning shape.
const webLogoEntryForGarmentColor = (webLogos, colorName) => {
  const wls = (webLogos || []).filter((w) => w && w.url);
  if (!wls.length) return null;
  const g = _normColorWords(colorName);
  if (g.length) {
    const hit = wls.find((w) => { const c = _normColorWords(w.color_way); return c.length && (c.some((t) => g.includes(t)) || g.some((t) => c.includes(t))); });
    if (hit) return hit;
  }
  return wls.find((w) => { const c = (w.color_way || '').trim(); return w.is_default || !c || /all/i.test(c); }) || null;
};
const webLogoForGarmentColor = (webLogos, colorName) => { const e = webLogoEntryForGarmentColor(webLogos, colorName); return e ? e.url : null; };
// A cw_by_color value is a bare url (legacy) or { url, color_way_id } (id-keyed, Decision 2).
const _cwPickUrl = (v) => (typeof v === 'string' ? v : (v && v.url) || '');
const decoUrlForColor = (deco, colorName, webLogos) => {
  if (!deco) return '';
  const m = deco.cw_by_color; const k = colorKeyOf(colorName);
  const pick = m && k && m[k];
  if (pick) return _cwPickUrl(pick);                     // explicit per-color override wins
  const auto = webLogoForGarmentColor(webLogos, colorName); // else auto-match the garment color
  return auto || deco.art_url || '';
};
// Read-only garment thumbnail with the placed FRONT logos composited at their saved
// placement — previews each color of a multi-color card with its art (and per-color web
// logo) applied. Mirrors the LogoPlacer hero-canvas math (x/y center %, w = width %).
function GarmentLogoPreview({ imageUrl, decorations = [], colorName, library = [] }) {
  const webLogosOf = (d) => { const art = (library || []).find((a) => a.id === d.art_id); return art && Array.isArray(art.web_logos) ? art.web_logos : []; };
  const front = (decorations || []).filter((d) => !d.baked && (d.side || 'front') !== 'back' && decoUrlForColor(d, colorName, webLogosOf(d)));
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '4/5', borderRadius: 6, overflow: 'hidden', background: '#f4f6f9' }}>
      {imageUrl && <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      {front.map((d, i) => { const p = placementById(d.placement); const x = d.x != null ? d.x : p.x, y = d.y != null ? d.y : p.y, w = d.w != null ? d.w : p.w; return (
        <img key={i} src={decoUrlForColor(d, colorName, webLogosOf(d))} alt="" draggable={false} style={{ position: 'absolute', left: x + '%', top: y + '%', width: w + '%', transform: 'translate(-50%,-50%)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))' }} />
      ); })}
    </div>
  );
}

// Sample number/name shown on the garment mockup so reps and shoppers can see an item is
// personalized. Default back placement; preview-only (real values are entered at checkout).
const PERSO_DEFAULTS = { name: { x: 50, y: 22, w: 64 }, number: { x: 50, y: 51, w: 34 } };
function PersoMock({ takesNumber, takesName, sampleName = 'PLAYER', sampleNumber = '00' }) {
  if (!takesNumber && !takesName) return null;
  const tok = (p, vb, ty, fs, body) => (
    <div style={{ position: 'absolute', left: p.x + '%', top: p.y + '%', width: p.w + '%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 1 }}>
      <svg viewBox={'0 0 100 ' + vb} style={{ display: 'block', width: '100%', overflow: 'visible' }}>
        <text x="50" y={ty} textAnchor="middle" fontFamily="'Barlow Condensed',Oswald,Impact,sans-serif" fontWeight="800" fontSize={fs} fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="1.3" paintOrder="stroke" letterSpacing="1">{body}</text>
      </svg>
    </div>
  );
  return <>
    {takesName && tok(PERSO_DEFAULTS.name, 26, 20, 20, String(sampleName).toUpperCase())}
    {takesNumber && tok(PERSO_DEFAULTS.number, 64, 52, 58, sampleNumber)}
  </>;
}
// A perso placement lives in the item's `decorations` as a token (no art_url), so
// it flows editor → DB → storefront with the logos and is ignored by DecoOverlay.
const isPerso = (d) => d && (d.kind === 'perso_number' || d.kind === 'perso_name');
const persoDefault = (kind) => ({ ...(kind === 'perso_number' ? PERSO_DEFAULTS.number : PERSO_DEFAULTS.name) });
// Sample text token that fills its container's width (so resizing the box resizes the text).
function PersoArt({ kind, sampleName = 'PLAYER', sampleNumber = '00' }) {
  const isNum = kind === 'perso_number';
  const vb = isNum ? 64 : 26, ty = isNum ? 52 : 20, fs = isNum ? 58 : 20;
  const body = isNum ? sampleNumber : String(sampleName).toUpperCase();
  return <svg viewBox={'0 0 100 ' + vb} style={{ display: 'block', width: '100%', overflow: 'visible', pointerEvents: 'none' }}>
    <text x="50" y={ty} textAnchor="middle" fontFamily="'Barlow Condensed',Oswald,Impact,sans-serif" fontWeight="800" fontSize={fs} fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="1.3" paintOrder="stroke" letterSpacing="1">{body}</text>
  </svg>;
}

// Fit/size variants of one garment. A jersey is the same design across Adult /
// Women's / Youth cuts, but each cut is its own product (own SKU + size scale), so
// we attach them as sibling rows on one card. The storefront shows every fit's
// sizes at once on the shared image; picking a size resolves that fit's own SKU.
const FIT_LABELS = ['Adult', "Men's", "Women's", 'Youth', 'Unisex'];
function FitManager({ item, fits = [], stockByWp = {}, onAttach, onLabel, onRemoveFit }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = fits || [];
  const isGroup = rows.length > 1 || rows.some((r) => r.variant_label);
  const attach = async (pr) => {
    if (!onAttach || busy) return;
    setBusy(true);
    try { await onAttach(pr); setAdding(false); } finally { setBusy(false); }
  };
  return (
    <ItemSection subtle title="Add-on · sizes / fits" hint="· optional — same garment in another cut; each fit is its own SKU & size row in the store"
      right={onAttach ? <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Add a fit'}</button> : null}>
      {isGroup ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => { const st = stockByWp[r.id]; const nm = r.display_name || st?.name || r.sku; const isPrimary = r.id === item.id; const cur = r.variant_label || ''; const preset = FIT_LABELS.includes(cur); return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', border: '1px solid #eef0f3', borderRadius: 8, background: '#fafbfc' }}>
              <div style={{ width: 34, height: 34, borderRadius: 6, overflow: 'hidden', background: '#f4f6f9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(r.image_url || st?.image_front_url) ? <img src={r.image_url || st?.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 8, color: '#cbd5e1' }}>—</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm}{isPrimary ? ' (main)' : ''}</div>
                <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{r.sku}</div>
              </div>
              <select value={cur} onChange={(e) => { const v = e.target.value; if (v === '__custom') { const c = window.prompt('Fit label (e.g. Adult, Women\'s, Youth)', cur); if (c != null) onLabel(r.id, c.trim()); } else onLabel(r.id, v); }} title="What cut this SKU is" style={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 6px', background: '#fff', cursor: 'pointer', flexShrink: 0 }}>
                <option value="">— fit —</option>
                {FIT_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
                {cur && !preset && <option value={cur}>{cur}</option>}
                <option value="__custom">Custom…</option>
              </select>
              {rows.length > 1 && !isPrimary && onRemoveFit && <button type="button" title="Remove this fit" onClick={() => onRemoveFit(r.id, nm)} style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#b91c1c', borderRadius: 6, width: 24, height: 24, fontSize: 13, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>×</button>}
            </div>
          ); })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: adding ? 10 : 0 }}>This jersey is one cut. Add a Women's or Youth version as its own SKU — shoppers pick the fit and size together, on this same image.</div>
      )}
      {adding && <div style={{ marginTop: 10 }}>
        <ProductSearch label="Find the other cut (its own SKU)" onPick={attach} onClose={() => setAdding(false)} />
      </div>}
    </ItemSection>
  );
}

function CatalogItemEditor({ item, groupColors = [], page: pageProp, setPage: setPageProp, saveRef, dirtyRef, onReorderColors, defaultName, stockImg, stockBackImg, availableSizes = [], designOptions = [], numberSets = [], isTeam = false, library = [], storeColors = [], catalog = [], bundleItems = [], standardCategories = [], stockByWp = {}, costByPid = {}, invSrcByPid = {}, storeFund = {}, onApplyLogo, onAddSingle, onAddColors, onCopyItem, onSaveLogo, onUpdateCost, onUpdateProductMeta, onAddBundleItem, onRemoveBundleItem, onReorderBundleItems, onEditItem, onCancel, onSave }) {
  const isBundle = item.kind === 'bundle';
  const [dragBundleId, setDragBundleId] = useState(null);
  const [overBundleId, setOverBundleId] = useState(null);
  // Other single items on this store, for "apply this logo to other items".
  const siblings = (catalog || []).filter((c) => c.kind === 'single' && c.id !== item.id).map((c) => ({ id: c.id, name: c.display_name || (stockByWp[c.id] && stockByWp[c.id].name) || c.sku, img: c.image_url || (stockByWp[c.id] && stockByWp[c.id].image_front_url) }));
  // Vendor (the PO recipient) + SKU live on the catalog product. Loaded here so the rep can
  // view/edit them in Basics; persisted via onUpdateProductMeta. The vendor is a searchable
  // datalist of all vendors. Only meaningful for product-backed items (not bundles).
  const [vendorList, setVendorList] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [vendorText, setVendorText] = useState(''); // free text in the vendor search box
  const [skuEdit, setSkuEdit] = useState(item.sku || '');
  const _initVendorId = useRef('');
  const _initSku = useRef(item.sku || '');
  useEffect(() => {
    if (isBundle || !item.product_id || !onUpdateProductMeta) return;
    let cancelled = false;
    (async () => {
      const [{ data: vs }, { data: pr }] = await Promise.all([
        supabase.from('vendors').select('id,name').order('name'),
        supabase.from('products').select('vendor_id,sku').eq('id', item.product_id).maybeSingle(),
      ]);
      if (cancelled) return;
      setVendorList(vs || []);
      const vid = (pr && pr.vendor_id) || '';
      const sk = (pr && pr.sku) || item.sku || '';
      setVendorId(vid); _initVendorId.current = vid;
      setVendorText((vs || []).find((v) => v.id === vid)?.name || '');
      setSkuEdit(sk); _initSku.current = sk;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.product_id]);
  const saveVendor = (vid) => { setVendorId(vid); if (vid !== _initVendorId.current) { _initVendorId.current = vid; onUpdateProductMeta(item.product_id, { vendor_id: vid || null }); } };
  const saveSku = () => { const s = (skuEdit || '').trim().toUpperCase(); if (s && s !== (_initSku.current || '').toUpperCase()) { _initSku.current = s; onUpdateProductMeta(item.product_id, { sku: s }); } };
  const [image, setImage] = useState(item.image_url || null);
  const [backImage, setBackImage] = useState(item.image_back_url || null);
  const [decorations, setDecorations] = useState(Array.isArray(item.decorations) ? item.decorations : []);
  const [name, setName] = useState(item.display_name || defaultName || '');
  const [price, setPrice] = useState(item.retail_price || 0);
  const [fundraise, setFundraise] = useState(item.fundraise_amount || '');
  // Decoration charge: a flat amount folded INTO retail_price to cover decorating an
  // otherwise-cheap garment (e.g. shorts). `price` always holds the full price the
  // shopper pays; `decoUp` is the slice of it that's the deco charge, persisted to
  // webstore_products.deco_upcharge so the toggle survives a reopen (and so margin math
  // and "price to margin" know it's already covered). Toggling adjusts price by ±amount,
  // so the whole order / SO / reporting pipeline keeps using retail_price unchanged.
  const [decoUp, setDecoUp] = useState(Number(item.deco_upcharge) || 0);
  // Inventory tracking: only stock-backed items (a real vendor / warehouse product) can
  // follow the stock guard. Custom / made-to-order items (inventory_source 'manual', or no
  // product link) are never tracked, so the toggle is hidden for them. Default ON.
  const _invSrc = invSrcByPid[item.product_id];
  const inventoryBacked = !isBundle && !!_invSrc && _invSrc !== 'manual';
  const [trackInv, setTrackInv] = useState(item.track_inventory !== false);
  const [sizeSkus, setSizeSkus] = useState(item.size_skus || {});
  // Estimated NSA decoration cost — NSA's cost to decorate this item, which raises the sale
  // price to keep the margin (the delta is stored as deco_upcharge). Defaults to $5 when the
  // item has artwork, $0 when it doesn't. Rep-editable.
  // Live artwork presence (ignoring number/name perso tokens), so adding/removing a logo on
  // the Art tab re-defaults the deco cost.
  const _itemDecorated = decorations.some((d) => d && d.kind !== 'perso_number' && d.kind !== 'perso_name') || isTeam;
  const [decoCostEst, setDecoCostEst] = useState(((Array.isArray(item.decorations) && item.decorations.some((d) => d && d.kind !== 'perso_number' && d.kind !== 'perso_name')) || isTeam) ? 5 : 0);
  // True once the rep types in the deco-cost box, so the artwork-driven default stops overriding it.
  const [decoCostTouched, setDecoCostTouched] = useState((Number(item.deco_upcharge) || 0) > 0);
  const setDecoCharge = (on, newCostStr) => {
    const newCost = Math.max(0, Number(newCostStr != null ? newCostStr : decoCostEst) || 0);
    if (newCostStr != null) setDecoCostEst(newCost);
    const base = (Number(price) || 0) - (Number(decoUp) || 0); // price without any deco delta
    if (on && newCost > 0) {
      // Increase price enough to maintain the current base margin (fall back to 45% target)
      const baseMarginFrac = effCost != null && base > 0 ? (base - effCost) / base : null;
      const targetFrac = baseMarginFrac != null ? Math.max(0.01, baseMarginFrac) : 0.45;
      const newPrice = effCost != null ? Math.ceil((effCost + newCost) / (1 - targetFrac)) : base + newCost;
      const delta = Math.max(0, newPrice - base);
      setDecoUp(delta); setPrice(newPrice);
    } else { setDecoUp(0); setPrice(Math.max(0, base)); }
  };
  // When artwork is added/removed in-session, default the deco cost to $5 / $0 (unless the rep
  // set it by hand). Skips the initial mount so opening an item never silently moves its price.
  const _decoMountRef = useRef(true);
  useEffect(() => {
    if (_decoMountRef.current) { _decoMountRef.current = false; return; }
    if (isBundle || decoCostTouched) return;
    const cost = _itemDecorated ? (decoCostEst > 0 ? decoCostEst : 5) : 0;
    setDecoCharge(cost > 0, cost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_itemDecorated]);
  const [takesNumber, setTakesNumber] = useState(!!item.takes_number);
  const [takesName, setTakesName] = useState(!!item.takes_name);
  const [nameUp, setNameUp] = useState(item.name_upcharge || 0);
  // Support both new array columns and old single columns for existing records
  const [transferCodes, setTransferCodes] = useState(
    item.transfer_codes?.length ? item.transfer_codes : (item.transfer_code ? [item.transfer_code] : [])
  );
  const [numTransferSets, setNumTransferSets] = useState(
    item.num_transfer_sets?.length ? item.num_transfer_sets
      : (item.num_transfer_size ? [`${item.num_transfer_size}|${item.num_transfer_color || ''}`] : [])
  );
  const [extraImages, setExtraImages] = useState(item.extra_image_urls || []);
  const [imgBusy, setImgBusy] = useState(false);
  // Two-page editor: 'details' (setup/info) and 'art' (image-driven art & colors).
  const [pageState, setPageState] = useState('details');
  const page = pageProp || pageState;
  const setPage = setPageProp || setPageState;
  // Storefront placement + requirement (new per-item fields).
  // Reflect only the item's own saved category — never fall back to the product's
  // stock category, or saving any edit (e.g. sizes) would silently file an
  // uncategorized item under that category. The stock category is still offered
  // as a datalist suggestion below.
  const [category, setCategory] = useState(item.category || '');
  const [required, setRequired] = useState(!!item.required);
  const [kitName, setKitName] = useState(item.kit_name || '');
  const [cardStyle, setCardStyle] = useState(item.card_style || '');
  // Roster audience: who this item is for — everyone ('all'), field players, or
  // goalkeepers. Drives per-player bifurcation of the storefront.
  const [audience, setAudience] = useState(item.roster_audience || 'all');
  const [options, setOptions] = useState(Array.isArray(item.options) ? item.options : []);
  const imgRef = useRef();
  const estOz = estimateWeightOz(name || item.display_name || defaultName || item.sku);
  const [weight, setWeight] = useState(item.weight_oz != null ? item.weight_oz : '');
  // Per-store size selection: which of the product's available sizes this store
  // shows. Default = all on; saving a strict subset hides the rest on the storefront.
  // Only sizes that are actually gettable are offerable: in stock now (warehouse or
  // vendor) OR restocking within ~2 weeks. A vendor lists a full scale (e.g. 3XL–6XL)
  // for some styles but carries zero with the next delivery months out, so those
  // shouldn't show as toggles. Falls back to the full scale if nothing qualifies yet
  // (e.g. a brand-new style still on the way). Tall sizes fulfill their regular twin
  // (a coach orders "L", we ship "LT"), so the store offers regular sizes only and a
  // size counts its tall twin's stock/ETA toward availability.
  const _stk = stockByWp[item.id] || {};
  const _rawQty = (sz) => (Number((_stk.size_stock || {})[sz]) || 0) + (Number((_stk.vendor_size_stock || {})[sz]) || 0);
  const _rawSoon = (sz) => sizeEtaSoon(_stk.vendor_size_eta, sz);
  const _scaleSizes = foldScale(availableSizes);
  const _sizeQty = (sz) => foldedQty(sz, _rawQty);
  const _sellableSizes = _scaleSizes.filter((sz) => _sizeQty(sz) > 0 || foldedSoon(sz, _rawSoon));
  const allSizes = _sellableSizes.length ? _sellableSizes : _scaleSizes;
  const [offeredSizes, setOfferedSizes] = useState(
    Array.isArray(item.sizes_offered) && item.sizes_offered.length ? item.sizes_offered : allSizes
  );
  const sortSizes = (arr) => [...new Set(arr)].sort((a, b) => sizeRank(a) - sizeRank(b));
  // The full set of chips shown on the Sizes tab: the product's scale plus any sizes the
  // rep has added (e.g. 3XL/4XL, or a whole footwear scale). `offeredSizes` is which of
  // these are toggled on (sold). Extras (not in the product scale) can be removed outright.
  const [sizeList, setSizeList] = useState(() => sortSizes([...allSizes, ...(Array.isArray(item.sizes_offered) ? item.sizes_offered : [])]));
  const [newSize, setNewSize] = useState('');
  const [addingToBundle, setAddingToBundle] = useState(false);
  const [bundleAddSelId, setBundleAddSelId] = useState('');
  const toggleSize = (sz) => setOfferedSizes((cur) => cur.includes(sz) ? cur.filter((s) => s !== sz) : [...cur, sz]);
  const addSizeChip = () => {
    const s = newSize.trim().toUpperCase();
    setNewSize('');
    if (!s || sizeList.includes(s)) return;
    setSizeList((cur) => sortSizes([...cur, s]));
    setOfferedSizes((cur) => cur.includes(s) ? cur : [...cur, s]);
  };
  const removeSizeChip = (sz) => { setSizeList((cur) => cur.filter((s) => s !== sz)); setOfferedSizes((cur) => cur.filter((s) => s !== sz)); };
  const applySizePreset = (preset) => { const sz = sortSizes(preset.sizes); setSizeList(sz); setOfferedSizes(sz); };
  const sizePresetLabel = SIZE_PRESETS.find((p) => p.sizes.length === sizeList.length && sortSizes(p.sizes).every((s, i) => s === sizeList[i]))?.label || 'Custom';
  // Singles fall back to the store-wide fundraising rule (10% + round-up etc.) when no
  // per-item amount is set, so "Shopper pays" matches what families are actually charged.
  const storeFundAmt = isBundle ? 0 : storeFundAmount(price, storeFund);
  const effFund = isBundle ? (Number(fundraise) || 0) : effectiveFundraise(price, fundraise, storeFund);
  const total = (Number(price) || 0) + effFund;

  // True-margin readout: garment cost + a rough $5 decoration cost (quantity unknown at
  // store-build time) when the item is decorated, so staff can price to ~45% margin.
  const garmentCost = (costByPid && costByPid[item.product_id] != null) ? Number(costByPid[item.product_id]) : null;
  // Cost is editable inline (persists to the catalog product via onUpdateCost); track it
  // locally so the margin readout updates live before the save round-trips.
  const [costInput, setCostInput] = useState(garmentCost != null ? String(garmentCost) : '');
  const _editedCost = costInput.trim() === '' ? null : Number(costInput);
  const effCost = (_editedCost != null && Number.isFinite(_editedCost)) ? _editedCost : garmentCost;
  const costDirty = onUpdateCost && !isBundle && (costInput.trim() === '' ? garmentCost != null : !(garmentCost != null && Number(costInput) === garmentCost));
  const decoIncluded = !isBundle && _itemDecorated;
  // Only a decorated item carries a deco cost (per the rule: no artwork → $0).
  const decoCost = (!isBundle && _itemDecorated) ? (Number(decoCostEst) || 0) : 0;
  const trueCost = (effCost != null ? effCost : 0) + decoCost;
  const priceNum = Number(price) || 0;
  const marginPct = (effCost != null && priceNum > 0) ? Math.round((1 - trueCost / priceNum) * 100) : null;
  const target45 = effCost != null ? Math.ceil(trueCost / 0.55) : null; // price for ~45% margin after deco
  const saveCost = () => { if (costDirty) onUpdateCost(item.product_id, costInput.trim() === '' ? null : Number(costInput)); };

  // Other colorways of this garment (same product name) the store doesn't already carry,
  // so staff can add them in one step at the same price/options.
  const [colorSibs, setColorSibs] = useState([]);
  const [pickedColors, setPickedColors] = useState(() => new Set());
  const [addingColors, setAddingColors] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (isBundle || !defaultName || !onAddSingle) { setColorSibs([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('products')
        .select('id,sku,name,color,retail_price,image_front_url,available_sizes,category,brand')
        .eq('name', defaultName).neq('id', item.product_id).order('color').limit(200);
      if (!cancelled) setColorSibs(data || []);
    })();
    return () => { cancelled = true; };
  }, [defaultName, item.product_id, isBundle, onAddSingle]);
  const existingForStyle = new Set((catalog || []).filter((c) => c.kind === 'single' && (stockByWp[c.id]?.name || '') === defaultName).map((c) => (stockByWp[c.id]?.color || '').trim().toLowerCase()));
  const colorOptions = useMemo(() => {
    const map = new Map();
    for (const s of colorSibs) {
      const colorKey = (s.color || '').trim().toLowerCase();
      // Blank color (caps & sublimated jerseys carry the color/pattern in the SKU) → key by
      // SKU so those variants don't all collapse into a single empty entry and disappear.
      const key = colorKey || ('sku:' + (s.sku || '').toLowerCase());
      if (!key || (colorKey && existingForStyle.has(colorKey)) || map.has(key)) continue;
      if (!map.get(key) || (!map.get(key).image_front_url && s.image_front_url)) map.set(key, s);
    }
    return [...map.values()].sort((a, b) => (a.color || a.sku || '').localeCompare(b.color || b.sku || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorSibs, catalog, stockByWp, defaultName]);
  // Section names already used on this store, offered as type-ahead for placement.
  const categorySuggestions = useMemo(() => {
    const set = new Set();
    (standardCategories || []).forEach((c) => { if (c) set.add(c); });
    (catalog || []).forEach((c) => { if (c.category) set.add(c.category); if (stockByWp[c.id]?.category) set.add(stockByWp[c.id].category); });
    return [...set].filter(Boolean).sort();
  }, [catalog, stockByWp, standardCategories]);
  // Kit/package names already on this store, plus existing package names, as type-ahead.
  const kitSuggestions = useMemo(() => {
    const set = new Set();
    (catalog || []).forEach((c) => { if (c.kit_name) set.add(c.kit_name); if (c.kind === 'bundle' && c.display_name) set.add(c.display_name); });
    return [...set].filter(Boolean).sort();
  }, [catalog]);
  const toggleColor = (id) => setPickedColors((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addColors = async () => {
    if (!onAddColors || !pickedColors.size) return;
    setAddingColors(true);
    try {
      const picks = colorOptions.filter((c) => pickedColors.has(c.id));
      // Add the picked colors as options ON this same card (sharing the editor's
      // current price/options/logos), instead of creating separate cards.
      await onAddColors(item, picks, { price: Number(price) || 0, fundraise: Number(fundraise) || 0, takes_number: !!takesNumber, takes_name: !!takesName, name_upcharge: Number(nameUp) || 0, transfer_codes: transferCodes.filter(Boolean), decorations });
      setPickedColors(new Set());
    } finally { setAddingColors(false); }
  };

  const addExtraFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImgBusy(true);
    try { const url = await cloudUpload(file, 'nsa-webstores'); setExtraImages((p) => [...p, url]); }
    catch (x) { /* cloudUpload surfaces error via toast */ }
    setImgBusy(false);
  };

  // Replace the main front photo (e.g. after copying an item that kept the
  // source garment's image). Empty = fall back to the catalog stock photo.
  const mainImgRef = useRef();
  const [mainDragOver, setMainDragOver] = useState(false);
  const setMainFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImgBusy(true);
    try { const url = await cloudUpload(file, 'nsa-webstores'); setImage(url); }
    catch (x) { /* cloudUpload surfaces error via toast */ }
    setImgBusy(false);
  };

  // Dirty tracking: a signature of every editable field. Compared to the baseline (the
  // values as last loaded / saved) so the parent can prompt a save before the rep switches
  // to another item. Reset to the current signature whenever we persist.
  const _dirtySig = JSON.stringify([name, price, fundraise, decoUp, weight, image, backImage, extraImages, category, required, kitName, audience, options, takesNumber, takesName, nameUp, transferCodes, numTransferSets, decorations, offeredSizes, sizeList, trackInv, sizeSkus]);
  const _baselineSig = useRef(_dirtySig);
  if (dirtyRef) dirtyRef.current = _dirtySig !== _baselineSig.current;

  const save = async () => {
    const cleanOptions = cleanItemOptions(options);
    const fields = { retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, deco_upcharge: Number(decoUp) || 0, display_name: (name.trim() && name.trim() !== (defaultName || '').trim()) ? name.trim() : null, weight_oz: weight === '' ? null : Number(weight) || 0, image_url: image || null, image_back_url: backImage || null, extra_image_urls: extraImages, category: category.trim() || null, required: !!required, kit_name: kitName.trim() || null, roster_audience: (audience && audience !== 'all') ? audience : null, options: cleanOptions, card_style: cardStyle || null };
    if (!isBundle) {
      fields.takes_number = !!takesNumber; fields.takes_name = !!takesName; fields.name_upcharge = Number(nameUp) || 0;
      fields.transfer_codes = transferCodes.filter(Boolean);
      fields.num_transfer_sets = takesNumber ? numTransferSets.filter((s) => s && s !== '|') : [];
      // Drop a perso placement if its toggle was turned back off.
      fields.decorations = decorations.filter((d) => !(d.kind === 'perso_number' && !takesNumber) && !(d.kind === 'perso_name' && !takesName));
      // Bake the auto-matched web-logo color way into cw_by_color for every garment color in
      // this card, so the storefront and SO handoff (which don't have the art library) show the
      // right logo per color — a "Navy" colorway on Navy, a "Grey" one on Heather Grey, etc.
      // Only fills colors without an explicit rep override.
      const _cardColors = (groupColors || []).map((c) => (stockByWp[c.id]?.color) || c.sku).filter(Boolean);
      if (_cardColors.length) fields.decorations = fields.decorations.map((d) => {
        const art = (library || []).find((a) => a.id === d.art_id);
        // normalize stamps color_way_id from the label match, so the bake below carries the
        // STABLE CW identity to the storefront/SO handoff — not just a url keyed by color name.
        const wls = art ? normalizeWebLogos(art.web_logos, art.color_ways) : [];
        if (wls.length < 2) return d;
        const m = { ...(d.cw_by_color || {}) };
        _cardColors.forEach((cn) => { const k = colorKeyOf(cn); if (!m[k]) { const e = webLogoEntryForGarmentColor(wls, cn); if (e) m[k] = e.color_way_id ? { url: e.url, color_way_id: e.color_way_id } : e.url; } });
        return Object.keys(m).length ? { ...d, cw_by_color: m } : d;
      });
      // null = the product's full scale, unchanged (default). Persist an explicit list
      // whenever the rep narrowed it OR added/swapped sizes (3XL/4XL, footwear, etc.).
      const _off = sizeList.filter((s) => offeredSizes.includes(s));
      const _sameAsScale = _off.length === allSizes.length && allSizes.every((s) => _off.includes(s));
      fields.sizes_offered = (_off.length === 0 || _sameAsScale) ? null : sortSizes(_off);
      // Inventory tracking only matters for stock-backed items; persist the choice there.
      if (inventoryBacked) fields.track_inventory = !!trackInv;
      // Size-level SKU overrides: only persist when there's something set.
      fields.size_skus = Object.keys(sizeSkus).length ? sizeSkus : {};
    }
    // Only claim success if the write actually landed. onSave returns false when
    // the DB rejected it (error or RLS-blocked 0-row write) — don't clear the dirty
    // flag or flash "Saved ✓" in that case, so the edit isn't silently lost.
    const _ok = await onSave(fields);
    if (_ok === false) return;
    _baselineSig.current = _dirtySig; // current state is now the saved baseline → no longer dirty
    if (dirtyRef) dirtyRef.current = false;
    // Stay on the item after saving — just confirm briefly on the button.
    setJustSaved(true); setTimeout(() => setJustSaved(false), 1800);
  };

  const catListId = 'cat-suggest-' + item.id;
  const kitListId = 'kit-suggest-' + item.id;
  if (saveRef) saveRef.current = save;
  return (
    <div style={{ padding: 16, background: '#f6f7f9' }}>
      {!setPageProp && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, position: 'sticky', top: 0, zIndex: 5, background: '#f6f7f9', paddingBottom: 12, borderBottom: '1px solid #e5e8ec' }}>
          {!isBundle && page === 'details' && <button type="button" className="btn btn-secondary" onClick={() => setPage('sizes')}>Next: Sizes →</button>}
          {!isBundle && page === 'sizes' && <button type="button" className="btn btn-secondary" onClick={() => setPage('art')}>Next: Art &amp; colors →</button>}
          <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={onCancel}>{justSaved ? 'Close' : 'Cancel'}</button>
          <button className="btn btn-primary" disabled={imgBusy} onClick={save}>{imgBusy ? 'Uploading…' : justSaved ? 'Saved ✓' : 'Save changes'}</button>
        </div>
      )}
      {!isBundle && !setPageProp && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid #e5e8ec' }}>
          {[['details', '1 · Item setup'], ['sizes', '2 · Sizes & options'], ['art', '3 · Art & colors']].map(([k, lbl]) => { const on = page === k; return (
            <button key={k} type="button" onClick={() => setPage(k)} style={{ background: 'none', border: 'none', borderBottom: '3px solid ' + (on ? '#191919' : 'transparent'), color: on ? '#191919' : '#94a3b8', fontWeight: 800, fontSize: 13.5, padding: '8px 14px', marginBottom: -2, cursor: 'pointer' }}>{lbl}</button>
          ); })}
        </div>
      )}

      {(page === 'details' || isBundle) && <React.Fragment>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div>
        <ItemSection title="Basics" hint="· name shown in the catalog">
          <Row label={isBundle ? 'Package name' : 'Display name (optional override)'}><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName || ''} /></Row>
          {!isBundle && item.product_id && onUpdateProductMeta && (
            <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <Row label="Vendor (PO goes to)">
                  <input className="form-input" list={'vendor-suggest-' + item.id} value={vendorText} placeholder="Search vendors…" style={{ width: '100%' }}
                    onChange={(e) => { setVendorText(e.target.value); const v = vendorList.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase()); if (v) saveVendor(v.id); else if (e.target.value.trim() === '') saveVendor(''); }}
                    onBlur={() => { const v = vendorList.find((x) => x.name.toLowerCase() === vendorText.trim().toLowerCase()); setVendorText(v ? v.name : (vendorList.find((x) => x.id === vendorId)?.name || '')); }} />
                  <datalist id={'vendor-suggest-' + item.id}>{vendorList.map((v) => <option key={v.id} value={v.name} />)}</datalist>
                </Row>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Row label="SKU"><input className="form-input" value={skuEdit} onChange={(e) => setSkuEdit(e.target.value)} onBlur={saveSku} placeholder="SKU" style={{ width: '100%' }} title="Catalog SKU — used to match vendor stock; saving updates the product" /></Row>
              </div>
            </div>
          )}
        </ItemSection>

        <ItemSection title="Pricing">
          {/* Sale price — hero input with live margin badge */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 }}>Sale price</div>
              <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #cbd5e1', borderRadius: 9, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.07)' }}>
                <span style={{ padding: '0 11px', color: '#94a3b8', borderRight: '1px solid #e2e8f0', fontSize: 15, height: 40, display: 'grid', placeItems: 'center' }}>$</span>
                <input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 96, border: 'none', borderRadius: 0, padding: '8px 10px', fontSize: 18, fontWeight: 700, outline: 'none', boxShadow: 'none' }} />
              </div>
            </div>
            {!isBundle && marginPct != null && (
              <div style={{ paddingBottom: 3, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: marginPct >= 45 ? '#15803d' : marginPct >= 35 ? '#b45309' : '#b91c1c', background: marginPct >= 45 ? '#dcfce7' : marginPct >= 35 ? '#fef3c7' : '#fee2e2', borderRadius: 20, padding: '3px 12px', display: 'inline-block' }}>{marginPct}% margin</span>
                {target45 != null && marginPct !== 45 && <button type="button" onClick={() => setPrice(target45)} style={{ fontSize: 11.5, fontWeight: 700, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textAlign: 'left' }}>→ {money(target45)} for 45%</button>}
              </div>
            )}
            {!isBundle && effCost == null && <div style={{ paddingBottom: 8, fontSize: 11.5, color: '#94a3b8' }}>Enter a cost below to see margin.</div>}
          </div>

          {/* Cost strip — garment cost + deco cost (only when decorated), non-bundles only */}
          {!isBundle && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#f8fafc', border: '1px solid #e9ecf0', borderRadius: 8, padding: '7px 12px', marginBottom: 10, fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: '#475569' }}>Cost</span>
              {onUpdateCost
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#374151' }}>$<input type="number" step="0.01" min={0} value={costInput} onChange={(e) => setCostInput(e.target.value)} onBlur={saveCost} placeholder="0.00" title="Base item cost — saves to catalog product" style={{ width: 64, padding: '2px 5px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5, background: '#fff' }} /></span>
                : <span style={{ fontWeight: 600, color: '#374151' }}>{effCost != null ? money(effCost) : <span style={{ color: '#94a3b8' }}>—</span>}</span>}
              {_itemDecorated && <>
                <span style={{ color: '#d1d5db', fontWeight: 400, fontSize: 14 }}>+</span>
                <span style={{ fontWeight: 700, color: '#475569' }}>Deco</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#374151' }}>$<input type="number" step="0.01" min={0} value={decoCostEst} onChange={(e) => { setDecoCostTouched(true); setDecoCharge(true, e.target.value); }} style={{ width: 52, padding: '2px 5px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5, background: '#fff' }} /></span>
                {decoUp > 0 && <span style={{ color: '#2563eb', fontWeight: 600 }}>+{money(decoUp)} to price</span>}
              </>}
              {effCost != null && <><span style={{ color: '#e2e8f0', fontWeight: 400, fontSize: 14 }}>·</span><span style={{ color: '#475569' }}>Total <b style={{ color: '#1e293b' }}>{money(trueCost)}</b></span></>}
            </div>
          )}

          {/* Fundraise add-on + shopper pays — inline, always visible */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Fundraise</span>
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 7, overflow: 'hidden', background: '#fff' }}>
              <span style={{ padding: '0 8px', color: '#94a3b8', borderRight: '1px solid #e2e8f0', fontSize: 13, height: 30, display: 'grid', placeItems: 'center' }}>$</span>
              <input type="number" step="0.01" min={0} value={fundraise} onChange={(e) => setFundraise(e.target.value)} placeholder={storeFundAmt > 0 ? storeFundAmt.toFixed(2) : '0.00'} style={{ width: 72, padding: '4px 6px', border: 'none', fontSize: 12.5, outline: 'none' }} />
            </div>
            {!isBundle && storeFund?.enabled && storeFundAmt > 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>{Number(fundraise) > 0 ? `overrides ${money(storeFundAmt)} store default` : `${money(storeFundAmt)} from store`}</span>}
            {(Number(fundraise) > 0 || (!isBundle && storeFund?.enabled && storeFundAmt > 0)) && <span style={{ fontSize: 12, color: '#475569' }}>→ shopper pays <b style={{ color: '#0f172a' }}>{money(total)}</b></span>}
          </div>
        </ItemSection>

        {isBundle && (
          <ItemSection title="Card style" hint="· how this package appears in the store grid">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setCardStyle('')} style={{ padding: 0, border: '2px solid ' + (cardStyle === '' ? '#191919' : '#d1d5db'), borderRadius: 8, background: '#fff', cursor: 'pointer', overflow: 'hidden' }}>
                <svg viewBox="0 0 88 100" style={{ display: 'block', width: 88, height: 100 }}>
                  <rect width="88" height="100" fill="#f8fafc" />
                  <rect x="0" y="0" width="88" height="66" fill="#e2e8f0" />
                  <rect x="14" y="74" width="44" height="6" rx="3" fill="#cbd5e1" />
                  <rect x="14" y="84" width="30" height="5" rx="2" fill="#e2e8f0" />
                </svg>
                <div style={{ padding: '4px 8px 6px', fontWeight: 700, fontSize: 11, color: cardStyle === '' ? '#191919' : '#374151', textAlign: 'center', background: cardStyle === '' ? '#f0f9ff' : '#fff', borderTop: '1px solid ' + (cardStyle === '' ? '#bfdbfe' : '#f1f5f9') }}>Standard card</div>
              </button>
              <button type="button" onClick={() => setCardStyle('banner')} style={{ padding: 0, border: '2px solid ' + (cardStyle === 'banner' ? '#191919' : '#d1d5db'), borderRadius: 8, background: '#fff', cursor: 'pointer', overflow: 'hidden' }}>
                <svg viewBox="0 0 176 76" style={{ display: 'block', width: 176, height: 76 }}>
                  <rect width="176" height="76" fill="#1e293b" />
                  <rect x="10" y="16" width="8" height="8" rx="2" fill="#ef4444" />
                  <rect x="21" y="17" width="32" height="5" rx="2" fill="rgba(239,68,68,0.7)" />
                  <rect x="10" y="28" width="70" height="7" rx="2" fill="rgba(255,255,255,0.9)" />
                  <rect x="10" y="39" width="55" height="5" rx="2" fill="rgba(255,255,255,0.5)" />
                  <rect x="10" y="54" width="32" height="14" rx="4" fill="#ef4444" />
                  <rect x="100" y="5" width="34" height="31" rx="4" fill="#2d4a6e" />
                  <rect x="138" y="5" width="34" height="31" rx="4" fill="#2d4a6e" />
                  <rect x="100" y="40" width="34" height="31" rx="4" fill="#2d4a6e" />
                  <rect x="138" y="40" width="34" height="31" rx="4" fill="#2d4a6e" />
                </svg>
                <div style={{ padding: '4px 8px 6px', fontWeight: 700, fontSize: 11, color: cardStyle === 'banner' ? '#191919' : '#374151', textAlign: 'center', background: cardStyle === 'banner' ? '#f0f9ff' : '#fff', borderTop: '1px solid ' + (cardStyle === 'banner' ? '#bfdbfe' : '#f1f5f9') }}>Banner + collage</div>
              </button>
              <button type="button" onClick={() => setCardStyle('showcase')} style={{ padding: 0, border: '2px solid ' + (cardStyle === 'showcase' ? '#191919' : '#d1d5db'), borderRadius: 8, background: '#fff', cursor: 'pointer', overflow: 'hidden' }}>
                <svg viewBox="0 0 176 90" style={{ display: 'block', width: 176, height: 90 }}>
                  <rect width="176" height="90" fill="#f8fafc" />
                  <rect width="176" height="26" fill="#1e293b" />
                  <rect x="10" y="9" width="72" height="8" rx="3" fill="rgba(255,255,255,0.85)" />
                  <rect x="136" y="8" width="30" height="10" rx="3" fill="#ef4444" />
                  <rect x="6" y="31" width="36" height="36" rx="4" fill="#e2e8f0" />
                  <rect x="48" y="31" width="36" height="36" rx="4" fill="#e2e8f0" />
                  <rect x="90" y="31" width="36" height="36" rx="4" fill="#e2e8f0" />
                  <rect x="132" y="31" width="38" height="36" rx="4" fill="#e2e8f0" />
                  <rect x="8" y="70" width="32" height="5" rx="2" fill="#cbd5e1" />
                  <rect x="50" y="70" width="32" height="5" rx="2" fill="#cbd5e1" />
                  <rect x="92" y="70" width="32" height="5" rx="2" fill="#cbd5e1" />
                  <rect x="134" y="70" width="32" height="5" rx="2" fill="#cbd5e1" />
                </svg>
                <div style={{ padding: '4px 8px 6px', fontWeight: 700, fontSize: 11, color: cardStyle === 'showcase' ? '#191919' : '#374151', textAlign: 'center', background: cardStyle === 'showcase' ? '#f0f9ff' : '#fff', borderTop: '1px solid ' + (cardStyle === 'showcase' ? '#bfdbfe' : '#f1f5f9') }}>Showcase (each item)</div>
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Banner and Showcase span the full store grid width.</div>
          </ItemSection>
        )}

        </div>
        <div>
        <ItemSection title="Store placement" hint="· section, kit & whether it's required">
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Row label="Category / section on the store">
              <input className="form-input" list={catListId} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Spirit Wear, Coaches, Headwear" />
              <datalist id={catListId}>{categorySuggestions.map((c) => <option key={c} value={c} />)}</datalist>
            </Row>
            <Row label="Part of a kit / package">
              <input className="form-input" list={kitListId} value={kitName} onChange={(e) => setKitName(e.target.value)} placeholder="e.g. Mandatory Player Kit" />
              <datalist id={kitListId}>{kitSuggestions.map((c) => <option key={c} value={c} />)}</datalist>
            </Row>
            <Row label="Who it's for (roster position)">
              <select className="form-input" value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value="all">Everyone</option>
                <option value="field">Field players only</option>
                <option value="gk">Goalkeepers only</option>
              </select>
            </Row>
            <div style={{ paddingBottom: 6 }}><Toggle label="Mandatory — every shopper must buy this" checked={required} onChange={(val) => { setRequired(val); if (item.id && !String(item.id).startsWith('tmp')) onSave({ required: val }); }} /></div>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Items sharing a kit name are bought together; mark the kit's items Mandatory to require them at checkout. “Who it's for” hides an item from players whose roster position doesn't match (players who open their personal link).</div>
        </ItemSection>

        <ItemSection title="Shipping" hint="· used for ship-to-home rates">
          <Row label="Ship weight (oz)"><input className="form-input" type="number" step="0.1" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={`auto ~${estOz}`} style={{ width: 130 }} /></Row>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Blank = auto-estimate by item type (~{estOz} oz).</div>
        </ItemSection>
        </div>
      </div>

        {isBundle && (() => {
          const myItems = (bundleItems || []).filter((b) => b.bundle_id === item.id);
          // Any single in the store can be added — including ones already in the package
          // (a 2nd pair of shorts) and archived ones (kept alive only inside the package).
          const eligible = (catalog || []).filter((c) => c.kind === 'single');
          const doAddItem = () => {
            if (!bundleAddSelId || !onAddBundleItem) return;
            const picked = (catalog || []).find((c) => c.id === bundleAddSelId);
            if (!picked) return;
            onAddBundleItem(item.id, { webstore_product_id: picked.id, product_id: picked.product_id, sku: picked.sku, qty: 1, size_required: true, takes_number: !!picked.takes_number, takes_name: !!picked.takes_name, name_upcharge: Number(picked.name_upcharge) || 0 });
            // Auto-bump bundle price by the item's retail price
            const added = Number(picked.retail_price) || 0;
            if (added > 0 && onSave) { const np = (Number(price) || 0) + added; setPrice(np); onSave({ retail_price: np }); }
            setBundleAddSelId('');
            setAddingToBundle(false);
          };
          return (
            <ItemSection title="Items in this package" hint="· stays linked — edit an item and the package follows">
              {myItems.length === 0
                ? <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '10px 12px', border: '1.5px dashed #d7dbe2', borderRadius: 8, marginBottom: 8 }}>No items yet — add from the store below.</div>
                : <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    {(() => {
                      let displayed = [...myItems];
                      if (dragBundleId && overBundleId && dragBundleId !== overBundleId) {
                        const fi = displayed.findIndex((x) => x.id === dragBundleId);
                        const ti = displayed.findIndex((x) => x.id === overBundleId);
                        if (fi !== -1 && ti !== -1) { const [mv] = displayed.splice(fi, 1); displayed.splice(ti, 0, mv); }
                      }
                      return displayed.map((b) => {
                        const c = (catalog || []).find((x) => x.id === b.webstore_product_id) || {};
                        const nm = c.display_name || (stockByWp[c.id] && stockByWp[c.id].name) || b.sku || 'Item';
                        const img = c.image_url || (stockByWp[c.id] && stockByWp[c.id].image_front_url);
                        const archived = c.active === false;
                        const canEdit = !!(c.id && onEditItem);
                        const isDragging = dragBundleId === b.id;
                        const isOver = overBundleId === b.id && dragBundleId !== b.id;
                        return (
                          <div key={b.id}
                            draggable={!!onReorderBundleItems}
                            onDragStart={() => setDragBundleId(b.id)}
                            onDragOver={(e) => { e.preventDefault(); setOverBundleId(b.id); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragBundleId && dragBundleId !== b.id && onReorderBundleItems) {
                                const fi = myItems.findIndex((x) => x.id === dragBundleId);
                                const ti = myItems.findIndex((x) => x.id === b.id);
                                if (fi !== -1 && ti !== -1) {
                                  const reord = [...myItems];
                                  const [mv] = reord.splice(fi, 1);
                                  reord.splice(ti, 0, mv);
                                  onReorderBundleItems(item.id, reord.map((x) => x.id));
                                }
                              }
                              setDragBundleId(null); setOverBundleId(null);
                            }}
                            onDragEnd={() => { setDragBundleId(null); setOverBundleId(null); }}
                            style={{ width: 120, border: '1px solid ' + (isOver ? '#93c5fd' : '#e2e8f0'), borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#fff', opacity: isDragging ? 0.45 : 1, boxShadow: isOver ? '0 0 0 2px #bfdbfe' : undefined }}>
                            {onReorderBundleItems && <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 14, background: '#f8fafc', cursor: 'grab', borderBottom: '1px solid #f1f5f9' }} title="Drag to reorder"><span style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1, userSelect: 'none' }}>⠿</span></div>}
                            {onRemoveBundleItem && <button type="button" title="Remove from package" onClick={() => {
                              onRemoveBundleItem(b.id);
                              const removed = Number((catalog || []).find((x) => x.id === b.webstore_product_id)?.retail_price) || 0;
                              if (removed > 0 && onSave) { const np = Math.max(0, (Number(price) || 0) - removed); setPrice(np); onSave({ retail_price: np }); }
                            }} style={{ position: 'absolute', top: onReorderBundleItems ? 18 : 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: '#fff', border: '1px solid #e2e8f0', color: '#b91c1c', cursor: 'pointer', fontSize: 12, lineHeight: '16px', padding: 0, textAlign: 'center', zIndex: 1 }}>×</button>}
                            {archived && <span style={{ position: 'absolute', top: onReorderBundleItems ? 18 : 4, left: 4, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 5px', zIndex: 1 }}>Archived</span>}
                            <div onClick={canEdit ? () => onEditItem(c.id) : undefined} title={canEdit ? 'Edit this item' : undefined} style={{ width: '100%', height: 76, background: '#f4f6f9', display: 'grid', placeItems: 'center', cursor: canEdit ? 'pointer' : 'default' }}>
                              {/* Linked singles show their DECORATED look (same as the storefront kit tiles). */}
                              {img && c && (c.decorations || []).some((d) => d && d.art_url)
                                ? <div style={{ height: 76, aspectRatio: '4 / 5' }}><GarmentLogoPreview imageUrl={img} decorations={c.decorations} colorName={stockByWp[c.id]?.color} library={library} /></div>
                                : img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4, boxSizing: 'border-box' }} /> : <span style={{ fontSize: 10, color: '#cbd5e1' }}>No image</span>}
                            </div>
                            <div style={{ padding: '5px 8px 7px' }}>
                              <div onClick={canEdit ? () => onEditItem(c.id) : undefined} style={{ fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: canEdit ? '#2563eb' : '#191919', cursor: canEdit ? 'pointer' : 'default' }} title={nm}>{nm}{canEdit ? ' · edit' : ''}</div>
                              {Number(b.qty) > 1 && <div style={{ fontSize: 11, color: '#64748b' }}>Qty {b.qty}</div>}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
              }
              {addingToBundle
                ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                    <select className="form-input" value={bundleAddSelId} onChange={(e) => setBundleAddSelId(e.target.value)} style={{ flex: '1 1 200px', fontSize: 13 }}>
                      <option value="">— pick an item —</option>
                      {eligible.map((c) => { const nm = c.display_name || (stockByWp[c.id] && stockByWp[c.id].name) || c.sku; return <option key={c.id} value={c.id}>{nm}{c.active === false ? ' (archived)' : ''}{c.retail_price ? ` · $${Number(c.retail_price).toFixed(2)}` : ''}</option>; })}
                    </select>
                    <button className="btn btn-sm btn-primary" disabled={!bundleAddSelId} onClick={doAddItem}>Add</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => { setAddingToBundle(false); setBundleAddSelId(''); }}>Cancel</button>
                  </div>
                : eligible.length > 0 && <button className="btn btn-sm btn-secondary" style={{ marginTop: 4 }} onClick={() => setAddingToBundle(true)}>+ Add item from store</button>
              }
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Archive a standalone item to take it off the store grid while keeping it sellable inside this package. Editing the (archived) item still updates the package.</div>
            </ItemSection>
          );
        })()}
      </React.Fragment>}

      {page === 'sizes' && !isBundle && <React.Fragment>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div>
        <ItemSection title="Sizes offered" hint="· tap to toggle, add your own, or switch the size style">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Size style</span>
            <select className="form-input" value={sizePresetLabel} onChange={(e) => { const p = SIZE_PRESETS.find((x) => x.label === e.target.value); if (p) applySizePreset(p); }} style={{ minWidth: 190, fontSize: 13 }}>
              {sizePresetLabel === 'Custom' && <option value="Custom">Custom</option>}
              {SIZE_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Switching replaces the sizes below.</span>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            {sizeList.map((sz) => { const on = offeredSizes.includes(sz); const extra = !allSizes.includes(sz); return (
              <span key={sz} style={{ position: 'relative', display: 'inline-flex' }}>
                <button type="button" onClick={() => toggleSize(sz)} style={{ border: '1px solid ' + (on ? '#191919' : '#d1d5db'), background: on ? '#191919' : '#fff', color: on ? '#fff' : '#3A4150', borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 40 }}>{sz}</button>
                {extra && <button type="button" title="Remove this size" onClick={() => removeSizeChip(sz)} style={{ position: 'absolute', top: -7, right: -7, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 11, lineHeight: '14px', cursor: 'pointer', padding: 0, textAlign: 'center' }}>×</button>}
              </span>
            ); })}
            <input className="form-input" value={newSize} onChange={(e) => setNewSize(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') { if (newSize.trim()) { e.preventDefault(); addSizeChip(); } } }} onBlur={addSizeChip} placeholder="+ size" style={{ width: 78, fontSize: 13 }} title="Type a size (e.g. 3XL) and press Enter or Tab" />
          </div>
          {offeredSizes.length > 0 && sizeList.some((s) => !offeredSizes.includes(s)) && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Storefront shows only: {sizeList.filter((s) => offeredSizes.includes(s)).join(', ')}</div>}
          {sizeList.some((s) => !allSizes.includes(s)) && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Added sizes are made-to-order (not stock-checked).</div>}
        </ItemSection>
        {inventoryBacked && (
          <ItemSection title="Inventory tracking" hint="· turn off for custom / made-to-order items">
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={trackInv} onChange={(e) => setTrackInv(e.target.checked)} style={{ width: 17, height: 17, marginTop: 1, cursor: 'pointer', accentColor: '#2563eb', flexShrink: 0 }} />
              <span>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#191919' }}>Follow vendor &amp; in-house stock</span>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{trackInv
                  ? 'On — a size stops selling when it runs out of stock (and shows as sold out).'
                  : 'Off — custom / made-to-order: every size keeps selling, and the item is never flagged as a stock shortfall when batching the Sales Order.'}</div>
              </span>
            </label>
          </ItemSection>
        )}
        {!isBundle && item.product_id && sizeList.length > 0 && (
          <ItemSection title="SKU overrides by size" hint="· substitute a different item number for specific sizes — same decoration, same price">
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Leave blank to use the default SKU{item.sku ? ` (${item.sku})` : ''}. Sizes with an override become a separate line on the Sales Order.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', alignItems: 'center' }}>
              {sizeList.map((sz) => (
                <React.Fragment key={sz}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{sz}</span>
                  <input
                    className="form-input"
                    value={sizeSkus[sz] || ''}
                    onChange={(e) => {
                      const v = e.target.value.trim().toUpperCase();
                      setSizeSkus((prev) => { const n = { ...prev }; if (v) n[sz] = v; else delete n[sz]; return n; });
                    }}
                    placeholder={item.sku || 'e.g. JL5412XL'}
                    style={{ fontSize: 12, padding: '4px 8px', fontFamily: 'monospace' }}
                  />
                </React.Fragment>
              ))}
            </div>
          </ItemSection>
        )}
        </div>
        <div>
        <ItemSection title="Add-on options" hint="· shopper-selected extras, e.g. embroidered name or collar color">
          <OptionsEditor value={options} onChange={setOptions} />
        </ItemSection>
        </div>
      </div>
      </React.Fragment>}

      {page === 'art' && !isBundle && <React.Fragment>
      <ItemSection title="Garment & decoration" hint="· drag a logo on, place it, recolor, then apply to other items">
        <input ref={mainImgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const fl = (e.target.files || [])[0]; if (fl) setMainFile(fl); e.target.value = ''; }} />
        <LogoPlacer imageUrl={image || stockImg || item.image_url} backImageUrl={backImage} stockBackImg={stockBackImg} onBackImageChange={setBackImage} decorations={decorations} onChange={setDecorations} library={library} storeColors={storeColors} siblings={siblings} onApplyToItems={onApplyLogo} onSaveLogo={onSaveLogo} takesNumber={takesNumber} takesName={takesName}
          primaryColorId={item.id} onReorderColors={onReorderColors} colorRows={(groupColors || []).map((c) => { const cs = stockByWp[c.id] || {}; return { id: c.id, name: cs.color || c.sku, frontUrl: c.image_url || cs.image_front_url || '' }; })} />
      </ItemSection>
      {!isBundle && (
        <ItemSection title="Personalization" hint="· numbers & names — previewed on the back of the mockup">
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Toggle label="Player adds a number" checked={takesNumber} onChange={setTakesNumber} />
            <Toggle label="Player adds a name" checked={takesName} onChange={setTakesName} />
            {takesName && <label style={{ fontSize: 12.5 }}>Name +$<input className="form-input" style={{ width: 70, display: 'inline-block', marginLeft: 4 }} type="number" step="0.01" min={0} value={nameUp} onChange={(e) => setNameUp(e.target.value)} /></label>}
            {(takesNumber || takesName) && <span style={{ fontSize: 11, color: '#64748b' }}>Switch the mockup to <b>Back</b> to preview.</span>}
          </div>
          {isTeam && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Logo &amp; number transfers are a club-store option — team-store decoration is handled in production.</div>}
          {!isTeam && <MultiTransferFields designOptions={designOptions} numberSets={numberSets} transferCodes={transferCodes} setTransferCodes={setTransferCodes} numTransferSets={numTransferSets} setNumTransferSets={setNumTransferSets} showNumber={takesNumber} />}
        </ItemSection>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div>
        {onAddColors && colorOptions.length > 0 && (
          <ItemSection title="Add more colors" hint="· add other colors of this garment to this same card, at this price" right={<button type="button" disabled={!pickedColors.size || addingColors} onClick={addColors} className="btn btn-sm btn-primary" style={{ opacity: (!pickedColors.size || addingColors) ? 0.5 : 1 }}>{addingColors ? 'Adding…' : `Add ${pickedColors.size || ''} color${pickedColors.size === 1 ? '' : 's'}`}</button>}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {colorOptions.map((s) => { const on = pickedColors.has(s.id); return (
                <button key={s.id} type="button" onClick={() => toggleColor(s.id)} title={s.color || s.sku} style={{ position: 'relative', width: 92, border: '2px solid ' + (on ? '#191919' : '#e2e8f0'), background: '#fff', borderRadius: 10, padding: 5, cursor: 'pointer' }}>
                  <div style={{ width: '100%', height: 86, borderRadius: 6, overflow: 'hidden', background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {s.image_front_url ? <img src={s.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#cbd5e1', fontWeight: 700, padding: 2, textAlign: 'center' }}>{(s.color || s.sku || '').slice(0, 12)}</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: on ? '#191919' : '#64748b', fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.color || s.sku}</div>
                  {on && <div style={{ position: 'absolute', top: -7, right: -7, background: '#191919', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, lineHeight: '18px', fontWeight: 800, textAlign: 'center' }}>✓</div>}
                </button>
              ); })}
            </div>
          </ItemSection>
        )}

        <ItemSection title="Additional images" hint="· front, back & extra angles shown on the product page">
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!mainDragOver) setMainDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setMainDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setMainDragOver(false); const first = [...(e.dataTransfer.files || [])].find((f) => f.type.startsWith('image/')); if (first) addExtraFile(first); else [...(e.dataTransfer.files || [])].forEach(addExtraFile); }}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, border: `1.5px dashed ${mainDragOver ? '#2563eb' : '#d7dbe2'}`, borderRadius: 10, background: mainDragOver ? '#eff4ff' : '#fafbfc', transition: 'background .12s, border-color .12s' }}>
            {/* Front (main) photo */}
            <div style={{ position: 'relative', cursor: 'pointer' }} title="Front photo — click to change" onClick={() => mainImgRef.current?.click()}>
              <div style={{ width: 64, height: 64, borderRadius: 6, border: '1px solid #cbd5e1', overflow: 'hidden', background: '#f1f5f9', display: 'grid', placeItems: 'center' }}>
                {(image || stockImg || item.image_url) ? <img src={image || stockImg || item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#94a3b8' }}>No photo</span>}
              </div>
              <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 8, fontWeight: 800, letterSpacing: 0.4, textAlign: 'center', background: 'rgba(15,26,56,0.78)', color: '#fff', borderBottomLeftRadius: 6, borderBottomRightRadius: 6, padding: '1px 0' }}>MAIN</span>
              {image && <button type="button" title="Remove custom photo (revert to stock)" onClick={(e) => { e.stopPropagation(); setImage(null); }} style={{ position: 'absolute', top: -6, right: -6, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0, textAlign: 'center' }}>×</button>}
            </div>
            {/* Back photo */}
            {(backImage || stockBackImg) && (
              <div style={{ position: 'relative' }} title="Back photo">
                <img src={backImage || stockBackImg} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 8, fontWeight: 800, letterSpacing: 0.4, textAlign: 'center', background: 'rgba(15,26,56,0.78)', color: '#fff', borderBottomLeftRadius: 6, borderBottomRightRadius: 6, padding: '1px 0' }}>BACK</span>
                {backImage && <button type="button" title="Remove custom back photo" onClick={() => setBackImage(null)} style={{ position: 'absolute', top: -6, right: -6, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0, textAlign: 'center' }}>×</button>}
              </div>
            )}
            {extraImages.map((url, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                <button type="button" onClick={() => setExtraImages((p) => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0, textAlign: 'center' }}>×</button>
              </div>
            ))}
            <input ref={imgRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { [...(e.target.files || [])].forEach(addExtraFile); e.target.value = ''; }} />
            <button type="button" className="btn btn-sm btn-secondary" disabled={imgBusy} onClick={() => imgRef.current?.click()}>{imgBusy ? 'Uploading…' : '+ Add images'}</button>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Click MAIN to change the front photo · drag any image here to add an extra angle</div>
        </ItemSection>
        </div>
      </div>
      </React.Fragment>}

    </div>
  );
}

// Compact per-row image control for the catalog table.
function RowImage({ row, stockImg, onUpdateImage }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const shown = row.image_url || stockImg;
  const pick = async (e) => {
    const file = e.target.files?.[0]; if (!file || !file.type.startsWith('image/')) return;
    setBusy(true);
    try { const url = await cloudUpload(file, 'nsa-webstores'); await onUpdateImage(row.id, url); } catch (x) { /* surfaced via toast in handler */ }
    setBusy(false);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 44, height: 44, borderRadius: 6, background: '#f1f5f9', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {shown ? <img src={shown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#cbd5e1' }}>none</span>}
      </div>
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
      <button onClick={() => ref.current?.click()} disabled={busy} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 10, padding: 0 }}>{busy ? '…' : row.image_url ? 'change' : 'upload'}</button>
      {row.image_url && <button onClick={() => onUpdateImage(row.id, null)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 10, padding: 0 }}>remove</button>}
    </div>
  );
}

// Multi-entry transfer selectors — supports multiple logo transfers and number sets per item.
function MultiTransferFields({ designOptions = [], numberSets = [], transferCodes, setTransferCodes, numTransferSets, setNumTransferSets, showNumber }) {
  const addDesign = () => setTransferCodes((p) => [...p, '']);
  const removeDesign = (i) => setTransferCodes((p) => p.filter((_, j) => j !== i));
  const setDesign = (i, v) => setTransferCodes((p) => p.map((x, j) => j === i ? v : x));
  const addNumSet = () => setNumTransferSets((p) => [...p, '|']);
  const removeNumSet = (i) => setNumTransferSets((p) => p.filter((_, j) => j !== i));
  const setNumSet = (i, v) => setNumTransferSets((p) => p.map((x, j) => j === i ? v : x));
  const rowStyle = { display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' };
  const rmBtn = (onClick) => <button type="button" onClick={onClick} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>;
  const addBtn = (onClick, label) => <button type="button" onClick={onClick} style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{label}</button>;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Logo transfers (deducts 1 per item ordered)</div>
        {transferCodes.map((code, i) => (
          <div key={i} style={rowStyle}>
            <select className="form-select" style={{ flex: 1 }} value={code} onChange={(e) => setDesign(i, e.target.value)}>
              <option value="">None</option>
              {designOptions.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
            {rmBtn(() => removeDesign(i))}
          </div>
        ))}
        {addBtn(addDesign, '+ Add logo transfer')}
      </div>
      {showNumber && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Number transfer sets (deducts digits per item)</div>
          {numTransferSets.map((s, i) => (
            <div key={i} style={rowStyle}>
              <select className="form-select" style={{ flex: 1 }} value={s} onChange={(e) => setNumSet(i, e.target.value)}>
                <option value="|">None</option>
                {numberSets.map((ns, j) => <option key={j} value={`${ns.size}|${ns.color}`}>{ns.size} · {ns.color}</option>)}
              </select>
              {rmBtn(() => removeNumSet(i))}
            </div>
          ))}
          {addBtn(addNumSet, '+ Add number set')}
        </div>
      )}
    </div>
  );
}

// Color-selector modal — clicking a product card opens this over the picker so the rep can
// see every colorway of the style and tick only the ones they want. Adds them at a shared
// price (tweak fundraising / art per item after, in the catalog editor).
function SinglePriceEditor({ product, storeFund = {}, onAdd, onCancel }) {
  const [price, setPrice] = useState(product.retail_price || 0);
  const [rows, setRows] = useState([]);       // one row per colorway (incl. base), with _stock
  const [loading, setLoading] = useState(true);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sel, setSel] = useState(() => new Set([product.id])); // base preselected
  useEffect(() => {
    let cancelled = false; setLoading(true);
    (async () => {
      let sibs = [];
      if (product?.name) {
        const { data } = await supabase.from('products')
          .select('id,sku,name,color,retail_price,image_front_url,available_sizes,category,brand')
          .eq('name', product.name).order('color').limit(300);
        sibs = data || [];
      }
      // One row per distinct color (incl. the base), preferring a row that has an image.
      const map = new Map();
      for (const s of [product, ...sibs]) {
        const key = (s.color || '').trim().toLowerCase() || ('sku:' + (s.sku || '').toLowerCase());
        const cur = map.get(key);
        if (!cur || (!cur.image_front_url && s.image_front_url)) map.set(key, s);
      }
      const list = [...map.values()];
      let stock = new Map();
      try { stock = await fetchStockMap(list); } catch { /* show without stock */ }
      for (const r of list) r._stock = stock.get(r.id) || { units: 0, sizes: [], incoming: false };
      list.sort((a, b) => (a.id === product.id ? -1 : b.id === product.id ? 1 : String(a.color || '').localeCompare(String(b.color || ''))));
      if (!cancelled) { setRows(list); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [product.id, product.name]);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const shown = inStockOnly ? rows.filter((r) => (r._stock?.units || 0) > 0) : rows;
  const chosen = rows.filter((r) => sel.has(r.id));
  const linkBtn = { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: 0 };
  const add = () => { if (!chosen.length) return; onAdd({ products: chosen, price: Number(price) || 0, fundraise: 0, image_url: null, takes_number: false, takes_name: false, name_upcharge: 0, transfer_codes: [], num_transfer_sets: [], decorations: [] }); };
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 720, margin: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div><div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', lineHeight: 1.1 }}>{product.name}</div><div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>Pick the colors to add to this store{[product.brand, product.category].filter(Boolean).length ? ' · ' + [product.brand, product.category].filter(Boolean).join(' · ') : ''}</div></div>
          <button onClick={onCancel} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6A7180', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#475569' }}>{chosen.length} selected</span>
          <button type="button" style={linkBtn} onClick={() => setSel(new Set(shown.map((r) => r.id)))}>All</button>
          <button type="button" style={linkBtn} onClick={() => setSel(new Set())}>None</button>
          <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> In stock only</label>
        </div>
        <div style={{ maxHeight: '52vh', overflowY: 'auto', padding: 14 }}>
          {loading ? <div style={{ padding: 34, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading colors…</div>
            : shown.length === 0 ? <div style={{ padding: 34, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No colors{inStockOnly ? ' in stock' : ''} for this style.</div>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(132px,1fr))', gap: 10 }}>
              {shown.map((r) => { const on = sel.has(r.id); const u = r._stock?.units || 0; const inc = r._stock?.incoming; return (
                <button key={r.id} type="button" onClick={() => toggle(r.id)} style={{ position: 'relative', textAlign: 'left', border: '2px solid ' + (on ? '#2563eb' : '#e2e8f0'), background: on ? '#eff6ff' : '#fff', borderRadius: 10, padding: 8, cursor: 'pointer' }}>
                  <div style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 6, background: on ? '#2563eb' : 'rgba(255,255,255,.92)', border: '1.5px solid ' + (on ? '#2563eb' : '#cbd5e1'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{on ? '✓' : ''}</div>
                  <div style={{ height: 92, borderRadius: 6, background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{r.image_front_url ? <img src={r.image_front_url} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} /> : <span style={{ width: 28, height: 28, borderRadius: '50%', background: colorNameToHex(r.color), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' }} />}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.color || r.sku}{r.id === product.id ? ' · base' : ''}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, marginTop: 1, color: u > 0 ? '#166534' : inc ? '#92400e' : '#b91c1c' }}>{u > 0 ? `${u} in stock` : inc ? 'Incoming' : 'Out of stock'}</div>
                </button>
              ); })}
            </div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: '1px solid #eef0f3', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Price&nbsp;$<input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 92, display: 'inline-block', marginLeft: 6 }} /></label>
          <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Applied to each color — tweak fundraising / art per item after.</span>
          <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen.length} style={{ opacity: chosen.length ? 1 : 0.5 }} onClick={add}>Add {chosen.length || ''} {chosen.length === 1 ? 'color' : 'colors'} →</button>
        </div>
      </div>
    </div>
  );
}

// Search the master products table (read-only) to pick catalog items.
function ProductSearch({ label, onPick, onClose, compact }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.from('products').select('id,sku,name,color,category,retail_price,image_front_url').or('is_active.is.null,is_active.eq.true').or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(25);
      if (!cancelled) { setResults(data || []); setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14 }}>
      {label && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>{onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>×</button>}</div>}
      <input className="form-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or SKU…" />
      <div style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
        {searching && <div style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>Searching…</div>}
        {!searching && q.trim().length >= 2 && results.length === 0 && <div style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>No matches.</div>}
        {results.map((p) => (
          <div key={p.id} onClick={() => onPick(p)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
            <div style={{ width: 34, height: 34, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>{p.image_front_url && <img src={p.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{[p.sku, p.color].filter(Boolean).join(' · ')}</div></div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{money(p.retail_price)}</div>
          </div>
        ))}
      </div>
    </div></div>
  );
}

// Map a store's pantone colors to the color-WORDS that appear in catalog color
// strings, so the picker can default to a school's colors. Each family lists the
// words seen in product colors ("Team Green / White", "Athletic Gold/Black", …).
const _COLOR_FAMILIES = [
  { fam: 'white', rgb: [245, 245, 245], words: ['white'] },
  { fam: 'black', rgb: [25, 25, 25], words: ['black'] },
  { fam: 'grey', rgb: [128, 128, 128], words: ['grey', 'gray', 'onix', 'onyx', 'charcoal', 'silver', 'graphite', 'pewter', 'heather'] },
  { fam: 'red', rgb: [166, 25, 46], words: ['red', 'scarlet', 'crimson', 'cardinal'] },
  { fam: 'maroon', rgb: [78, 21, 37], words: ['maroon', 'burgundy', 'wine'] },
  { fam: 'orange', rgb: [255, 106, 19], words: ['orange'] },
  { fam: 'gold', rgb: [255, 184, 28], words: ['gold', 'vegas', 'maize'] },
  { fam: 'yellow', rgb: [250, 224, 60], words: ['yellow'] },
  { fam: 'green', rgb: [0, 132, 61], words: ['green', 'kelly', 'forest'] },
  { fam: 'teal', rgb: [0, 142, 151], words: ['teal', 'aqua', 'mint'] },
  { fam: 'blue', rgb: [0, 87, 184], words: ['blue', 'royal', 'carolina'] },
  { fam: 'navy', rgb: [0, 34, 68], words: ['navy'] },
  { fam: 'purple', rgb: [95, 37, 159], words: ['purple', 'violet'] },
  { fam: 'pink', rgb: [227, 28, 121], words: ['pink', 'rose'] },
  { fam: 'brown', rgb: [90, 58, 41], words: ['brown'] },
  { fam: 'tan', rgb: [182, 165, 147], words: ['tan', 'khaki', 'beige', 'sand', 'taupe', 'stone', 'cream', 'natural'] },
];
const _hexToRgb = (hex) => { const h = String(hex || '').replace('#', ''); if (h.length !== 6) return null; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const colorFamilyOf = (hex) => {
  const rgb = _hexToRgb(hex); if (!rgb) return null;
  let best = null, bd = Infinity;
  for (const f of _COLOR_FAMILIES) { const d = (f.rgb[0] - rgb[0]) ** 2 + (f.rgb[1] - rgb[1]) ** 2 + (f.rgb[2] - rgb[2]) ** 2; if (d < bd) { bd = d; best = f; } }
  return best;
};
const storeColorWords = (pantone) => {
  const words = new Set();
  for (const pc of (pantone || [])) { const f = colorFamilyOf(pc && pc.hex); if (f) f.words.forEach((w) => words.add(w)); }
  return [...words];
};
// Match a product's PRIMARY (first) color segment so "Team Green / White" (green-led)
// is excluded for a red/white school, while "White / Black" (white-led) is included.
const productMatchesColors = (productColor, words) => {
  if (!words.length) return true;
  const primary = String(productColor || '').split(/[/,|]| - /)[0].toLowerCase();
  return words.some((w) => primary.includes(w));
};
// A small swatch hex for a catalog color name — match its primary segment to a color
// family and use that family's representative rgb. Falls back to a neutral grey.
const _rgbToHex = (rgb) => '#' + rgb.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
const colorNameToHex = (name) => {
  const primary = String(name || '').split(/[/,|]| - /)[0].trim().toLowerCase();
  if (!primary) return '#cbd5e1';
  for (const f of _COLOR_FAMILIES) { if (f.words.some((w) => primary.includes(w))) return _rgbToHex(f.rgb); }
  return '#cbd5e1';
};

const TEMPLATE_SPORTS = ['Baseball', 'Softball', 'Football', 'Basketball', 'Volleyball', 'Soccer', 'Wrestling', 'Track & Field', 'Cross Country', 'Lacrosse', 'Hockey', 'Golf', 'Tennis', 'Swim', 'Cheer', 'Band', 'General / Spirit'];

const colorFamilyWords = (fam) => (_COLOR_FAMILIES.find((f) => f.fam === fam)?.words) || [fam];

// Edit a saved template — rename / retag, add or drop items, and recolor (per item via a
// color selector, or "recolor all" to a family). Saves back over the same template row.
function TemplateEditor({ template, onClose, onSaved }) {
  const [meta, setMeta] = useState({ name: template.name || '', sport: template.sport || '', brand_focus: template.brand_focus || 'Mixed', gender: template.gender || 'Unisex' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addSku, setAddSku] = useState('');

  const dedupeColorways = (rows) => { const m = new Map(); for (const r of rows || []) { const k = (r.color || '').trim().toLowerCase(); if (!k) continue; if (!m.has(k) || (!m.get(k).image_front_url && r.image_front_url)) m.set(k, r); } return [...m.values()].sort((a, b) => (a.color || '').localeCompare(b.color || '')); };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const raw = Array.isArray(template.items) ? template.items : [];
      const skus = [...new Set(raw.map((i) => i.sku).filter(Boolean))];
      const variants = [...new Set(skus.flatMap((s) => [s, s.toUpperCase(), s.toLowerCase()]))];
      const found = [];
      for (let i = 0; i < variants.length; i += 150) { const { data } = await supabase.from('products').select('id,sku,name,color,image_front_url').in('sku', variants.slice(i, i + 150)); if (data) found.push(...data); }
      const byKey = new Map(); found.forEach((p) => { const k = String(p.sku || '').toUpperCase(); if (!byKey.has(k)) byKey.set(k, p); });
      const names = [...new Set(found.map((p) => p.name).filter(Boolean))];
      const sib = [];
      for (let i = 0; i < names.length; i += 40) { const { data } = await supabase.from('products').select('sku,name,color,image_front_url').in('name', names.slice(i, i + 40)); if (data) sib.push(...data); }
      const byName = new Map(); sib.forEach((p) => { const a = byName.get(p.name) || []; a.push(p); byName.set(p.name, a); });
      if (cancelled) return;
      setItems(raw.map((it) => { const product = byKey.get(String(it.sku || '').toUpperCase()) || null; const options = product ? dedupeColorways(byName.get(product.name) || []) : []; return { sku: it.sku, category: it.category || null, product, options }; }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [template]);

  const setColor = (idx, sku) => setItems((arr) => arr.map((it, i) => { if (i !== idx) return it; const opt = (it.options || []).find((o) => o.sku === sku); return { ...it, sku, product: opt ? { ...it.product, ...opt } : it.product }; }));
  const removeItem = (idx) => setItems((arr) => arr.filter((_, i) => i !== idx));
  const recolorAll = (fam) => setItems((arr) => arr.map((it) => { const opt = (it.options || []).find((o) => productMatchesColors(o.color, colorFamilyWords(fam))); return opt ? { ...it, sku: opt.sku, product: { ...it.product, ...opt } } : it; }));
  const addBySku = async () => {
    const s = addSku.trim(); if (!s) return;
    const { data } = await supabase.from('products').select('id,sku,name,color,image_front_url,category').in('sku', [s, s.toUpperCase(), s.toLowerCase()]).limit(1);
    const p = (data || [])[0];
    if (p) { const { data: sib } = await supabase.from('products').select('sku,name,color,image_front_url').eq('name', p.name); setItems((arr) => [...arr, { sku: p.sku, category: p.category || null, product: p, options: dedupeColorways(sib || []) }]); }
    setAddSku('');
  };

  const save = async () => {
    if (!meta.name.trim() || !items.length) return;
    setSaving(true);
    const { error } = await supabase.from('store_templates').update({ name: meta.name.trim(), sport: meta.sport || null, brand_focus: meta.brand_focus || null, gender: meta.gender || null, items: items.map((it) => ({ sku: it.sku, category: it.category || null })), updated_at: new Date().toISOString() }).eq('id', template.id);
    setSaving(false);
    if (!error) onSaved();
  };

  const RECOLOR_FAMS = ['black', 'white', 'grey', 'red', 'maroon', 'orange', 'gold', 'green', 'blue', 'navy', 'purple'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Row label="Template name"><input className="form-input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Row>
        <Row label="Sport"><input className="form-input" list="tpl-sports-edit" value={meta.sport} onChange={(e) => setMeta({ ...meta, sport: e.target.value })} /><datalist id="tpl-sports-edit">{TEMPLATE_SPORTS.map((s) => <option key={s} value={s} />)}</datalist></Row>
        <Row label="Brand focus"><select className="form-input" value={meta.brand_focus} onChange={(e) => setMeta({ ...meta, brand_focus: e.target.value })}>{['Mixed', 'Adidas', 'Non-branded'].map((b) => <option key={b} value={b}>{b}</option>)}</select></Row>
        <Row label="Gender"><select className="form-input" value={meta.gender} onChange={(e) => setMeta({ ...meta, gender: e.target.value })}>{['Unisex', "Men's", "Women's", 'Youth'].map((g) => <option key={g} value={g}>{g}</option>)}</select></Row>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#475569' }}>Recolor all to:</span>
        {RECOLOR_FAMS.map((f) => { const fam = _COLOR_FAMILIES.find((x) => x.fam === f); const rgb = fam ? `rgb(${fam.rgb.join(',')})` : '#ccc'; return (
          <button key={f} type="button" title={f} onClick={() => recolorAll(f)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #cbd5e1', background: rgb, cursor: 'pointer', padding: 0 }} />
        ); })}
        <span style={{ fontSize: 11, color: '#94a3b8' }}>swaps each item to that color when available</span>
      </div>

      {loading ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 12 }}>Loading items…</div> : (
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #eef0f3', borderRadius: 10 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ width: 38, height: 38, borderRadius: 6, background: '#f4f6f9', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{it.product?.image_front_url ? <img src={it.product.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 8, color: '#cbd5e1' }}>—</span>}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.product?.name || it.sku}</div>
                <div style={{ fontSize: 10.5, color: '#9AA1AC', fontFamily: 'monospace' }}>{it.sku}{it.product ? '' : ' · not found'}</div>
              </div>
              {it.options?.length > 1
                ? <select className="form-input" style={{ width: 170, fontSize: 12 }} value={it.sku} onChange={(e) => setColor(i, e.target.value)}>{it.options.map((o) => <option key={o.sku} value={o.sku}>{o.color}</option>)}</select>
                : <span style={{ fontSize: 12, color: '#6A7180', width: 170 }}>{it.product?.color || '—'}</span>}
              <button type="button" title="Remove" onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 17, cursor: 'pointer', padding: '0 4px' }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <input className="form-input" style={{ maxWidth: 220 }} placeholder="Add a SKU…" value={addSku} onChange={(e) => setAddSku(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBySku(); } }} />
        <button type="button" className="btn btn-sm btn-secondary" onClick={addBySku}>＋ Add</button>
        <span style={{ fontSize: 11.5, color: '#9AA1AC' }}>{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={!meta.name.trim() || !items.length || saving} onClick={save}>{saving ? 'Saving…' : 'Save template'}</button>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// Store templates — pick a pre-built sport store (the rep-facing fast start), or, for a
// curator, save the current store as a template or draft one with AI. Applying a template
// resolves its SKUs to live products and adds them to the store.
// On bring-in, pick which colors of each template style to add. Decoration never carries
// over (templates are product sets) — this only chooses garment colors. Each style's picked
// colors fold into one multi-color card. Defaults to the color(s) saved in the template.
// Some vendor feeds (notably adidas team gear) bake the colorway code into the product
// NAME — "M FLEECE HOOD ROYBLU/WHITE", "…BLACK/WHITE" — instead of leaving it to the color
// field. That makes every color look like its own one-color style. Strip a trailing
// ALL-CAPS color code (optionally slash-joined, e.g. ROYBLU/WHITE) so the colorways of a
// style collapse into one card. Mixed-case names (most of the catalog) keep their color in
// the color field and are left untouched.
const styleKey = (name) => {
  const n = String(name || '').trim();
  const base = n.replace(/\s+[A-Z]{4,}(?:\/[A-Z0-9]{2,})*$/, '').trim();
  return base || n;
};

// ── Shared style-rows machinery (TemplateColorPicker + SkuImporter) ──
// Group matched products into one row per garment STYLE and pull sibling colorways so
// the rep can bring in more colors. matched = [{ product, meta }] where meta rides from
// the source (template item / spreadsheet row): { price, fundraise, category, kit, required }.
// styleKey() strips any color baked into the name, so adidas-style "M FLEECE HOOD
// ROYBLU/WHITE" siblings group instead of each showing as its own "1 of 1 colors".
async function buildStyleRows(matched) {
  const styleMap = new Map();
  const savedByKey = new Map();
  (matched || []).forEach(({ product: p, meta }) => { if (!p) return;
    const key = styleKey(p.name);
    if (!styleMap.has(key)) { styleMap.set(key, { name: key, image: p.image_front_url, meta: { price: meta?.price, fundraise: meta?.fundraise || 0, category: meta?.category || null, kit: meta?.kit || null, required: !!meta?.required }, defaults: new Set() }); savedByKey.set(key, []); }
    styleMap.get(key).defaults.add(String(p.sku || '').trim().toUpperCase());
    savedByKey.get(key).push(p); });
  const keys = [...styleMap.keys()];
  // Pull every sibling sharing a style's base name (prefix), then keep only those whose
  // own style key matches — so "M FLEECE HOOD" never sweeps in "M FLEECE HOOD ZIP".
  const byKey = new Map();
  await Promise.all(keys.map(async (key) => {
    const like = key.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
    const { data } = await supabase.from('products').select('id,sku,name,color,retail_price,image_front_url').ilike('name', like).limit(1000);
    const sibs = (data || []).filter((p) => styleKey(p.name) === key);
    const seen = new Set(); const list = [];
    [...(savedByKey.get(key) || []), ...sibs].forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); list.push(p); } });
    byKey.set(key, list);
  }));
  return keys.map((key) => {
    const s = styleMap.get(key);
    // Dedupe colors (blank color → key by SKU so caps/jerseys don't collapse).
    const colMap = new Map();
    (byKey.get(key) || []).forEach((p) => { const ck = (p.color || '').trim().toLowerCase() || ('sku:' + String(p.sku || '').toLowerCase()); if (!colMap.has(ck) || (!colMap.get(ck).image_front_url && p.image_front_url)) colMap.set(ck, p); });
    const colors = [...colMap.values()].sort((a, b) => (a.color || a.sku || '').localeCompare(b.color || b.sku || ''));
    const picked = new Set(colors.filter((c) => s.defaults.has(String(c.sku || '').trim().toUpperCase())).map((c) => c.id));
    return { name: s.name, image: s.image, meta: s.meta, colors, picked, defaults: new Set(picked) };
  });
}
// Row aggregates — whether a style is coming in at all, and the addable-picked total.
const rowItemIn = (r, existingPids) => [...r.picked].some((id) => !existingPids.has(id));
const rowItemAvail = (r, existingPids) => r.colors.some((c) => !existingPids.has(c.id));
const rowsTotalPicked = (rows, existingPids) => rows.reduce((a, r) => a + [...r.picked].filter((id) => !existingPids.has(id)).length, 0);
// Build the apply plan applyTemplateColors expects (colors already in store are re-filtered there).
const rowsToPlan = (rows, forcedCategory) => rows.map((r) => ({ products: r.colors.filter((c) => r.picked.has(c.id)), price: r.meta.price, fundraise: r.meta.fundraise, category: forcedCategory || r.meta.category, kit_name: r.meta.kit, required: r.meta.required })).filter((g) => g.products.length);

// The style-rows list: one block per style with a whole-style checkbox and per-color
// swatches. renderRowExtra(r, ri, included) slots custom controls (e.g. the importer's
// price/fundraise inputs) into an included row's header area.
function StyleColorRows({ rows, setRows, existingPids = new Set(), renderRowExtra }) {
  const toggle = (ri, id) => setRows((rs) => rs.map((r, i) => { if (i !== ri) return r; const p = new Set(r.picked); p.has(id) ? p.delete(id) : p.add(id); return { ...r, picked: p }; }));
  const setAll = (ri, on) => setRows((rs) => rs.map((r, i) => i === ri ? { ...r, picked: on ? new Set(r.colors.filter((c) => !existingPids.has(c.id)).map((c) => c.id)) : new Set() } : r));
  const toggleItem = (ri, on) => setRows((rs) => rs.map((r, i) => i === ri ? { ...r, picked: on ? new Set([...(r.defaults && r.defaults.size ? r.defaults : new Set(r.colors.map((c) => c.id)))].filter((id) => !existingPids.has(id))) : new Set() } : r));
  return (
    <>
      {rows.map((r, ri) => { const included = rowItemIn(r, existingPids); const avail = rowItemAvail(r, existingPids); return (
        <div key={r.name} style={{ border: '1px solid ' + (included ? '#c7d2fe' : '#e8ebf0'), borderRadius: 12, padding: 12, marginBottom: 10, background: included ? '#fff' : '#fafbfc', opacity: avail ? 1 : 0.55 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: included ? 8 : 0, flexWrap: 'wrap' }}>
            <input type="checkbox" checked={included} disabled={!avail} onChange={(e) => toggleItem(ri, e.target.checked)} title={avail ? 'Bring this item into the store' : 'All colors already in the store'} style={{ width: 17, height: 17, cursor: avail ? 'pointer' : 'not-allowed', flexShrink: 0 }} />
            {r.image ? <img src={r.image} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6, border: '1px solid #eef2f7', background: '#fff' }} /> : null}
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: '#191919' }}>{r.name}</div><div style={{ fontSize: 11, color: '#64748b' }}>{avail ? `${[...r.picked].filter((id) => !existingPids.has(id)).length} of ${r.colors.filter((c) => !existingPids.has(c.id)).length} colors` : 'already in store'}</div></div>
            {included && renderRowExtra && renderRowExtra(r, ri, included)}
            {included && <button type="button" onClick={() => setAll(ri, true)} style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer' }}>All colors</button>}
            {included && <button type="button" onClick={() => setAll(ri, false)} style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>}
          </div>
          {included && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.colors.map((c) => { const inStore = existingPids.has(c.id); const on = r.picked.has(c.id); return (
              <button key={c.id} type="button" disabled={inStore} onClick={() => toggle(ri, c.id)} title={inStore ? (c.color || c.sku) + ' — already in store' : (c.color || c.sku)} style={{ position: 'relative', width: 80, border: '2px solid ' + (inStore ? '#e2e8f0' : on ? '#191919' : '#e2e8f0'), background: '#fff', borderRadius: 9, padding: 4, cursor: inStore ? 'not-allowed' : 'pointer', opacity: inStore ? 0.45 : 1 }}>
                <div style={{ width: '100%', height: 64, borderRadius: 5, overflow: 'hidden', background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.image_front_url ? <img src={c.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 8, color: '#cbd5e1', fontWeight: 700, padding: 2, textAlign: 'center' }}>{(c.color || c.sku || '').slice(0, 12)}</span>}</div>
                <div style={{ fontSize: 9.5, color: on && !inStore ? '#191919' : '#64748b', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.color || c.sku}</div>
                {on && !inStore && <div style={{ position: 'absolute', top: -7, right: -7, background: '#191919', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, lineHeight: '18px', fontWeight: 800, textAlign: 'center' }}>✓</div>}
                {inStore && <div style={{ position: 'absolute', top: 2, right: 2, background: '#64748b', color: '#fff', borderRadius: 5, fontSize: 8, fontWeight: 700, padding: '1px 4px' }}>IN</div>}
              </button>
            ); })}
          </div>}
        </div>
      ); })}
    </>
  );
}

function TemplateColorPicker({ tpl, existingPids = new Set(), onConfirm, onClose }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const forcedCategory = (tpl && tpl.kind === 'section') ? (tpl.section || tpl.name || null) : null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const items = Array.isArray(tpl?.items) ? tpl.items : [];
      const skus = [...new Set(items.map((i) => i.sku).filter(Boolean))];
      const variants = [...new Set(skus.flatMap((s) => [s, s.toUpperCase(), s.toLowerCase()]))];
      const found = [];
      for (let i = 0; i < variants.length; i += 150) { const { data } = await supabase.from('products').select('id,sku,name,color,retail_price,image_front_url').in('sku', variants.slice(i, i + 150)); if (data) found.push(...data); }
      const bySku = new Map(); found.forEach((p) => { const k = String(p.sku || '').trim().toUpperCase(); if (!bySku.has(k)) bySku.set(k, p); });
      const matched = items.map((it) => ({ product: bySku.get(String(it.sku || '').trim().toUpperCase()), meta: { price: it.price, fundraise: it.fundraise || 0, category: it.category || null, kit: it.kit || null, required: !!it.required } })).filter((m) => m.product);
      const built = await buildStyleRows(matched);
      if (!cancelled) { setRows(built); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tpl]);
  const setAllItems = (on) => setRows((rs) => rs.map((r) => ({ ...r, picked: on ? new Set([...(r.defaults && r.defaults.size ? r.defaults : new Set(r.colors.map((c) => c.id)))].filter((id) => !existingPids.has(id))) : new Set() })));
  const itemsAvailable = rows.filter((r) => rowItemAvail(r, existingPids)).length;
  const itemsIncluded = rows.filter((r) => rowItemIn(r, existingPids)).length;
  const totalPicked = rowsTotalPicked(rows, existingPids);
  const confirm = async () => {
    setBusy(true);
    await onConfirm(rowsToPlan(rows, forcedCategory));
    setBusy(false);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 760, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>Choose items &amp; colors — {tpl?.name}</div><div style={{ fontSize: 11.5, color: '#64748b' }}>Check the items to bring in, then pick each one's colors. No decoration carries over.</div></div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        {!loading && rows.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', borderBottom: '1px solid #eef0f3', background: '#f8fafc' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>Bringing in {itemsIncluded} of {itemsAvailable} item{itemsAvailable === 1 ? '' : 's'}</span>
            <span style={{ marginLeft: 'auto' }} />
            <button type="button" onClick={() => setAllItems(true)} style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer' }}>Select all</button>
            <button type="button" onClick={() => setAllItems(false)} style={{ fontSize: 12, fontWeight: 700, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>
          </div>
        )}
        <div style={{ padding: 16, maxHeight: '60vh', overflowY: 'auto' }}>
          {loading ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 16, textAlign: 'center' }}>Loading colors…</div>
            : rows.length === 0 ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 16, textAlign: 'center' }}>None of this template's items resolve to live products.</div>
            : <StyleColorRows rows={rows} setRows={setRows} existingPids={existingPids} />}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid #eef0f3' }}>
          <button className="btn btn-primary" disabled={busy || !totalPicked} onClick={confirm}>{busy ? 'Adding…' : `Add ${totalPicked} item${totalPicked === 1 ? '' : 's'}`}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {forcedCategory && <span style={{ fontSize: 11.5, color: '#047857', marginLeft: 'auto' }}>Lands in section: <b>{forcedCategory}</b></span>}
        </div>
      </div>
    </div>
  );
}

function TemplateGallery({ catalog = [], stockByWp = {}, existingPids = new Set(), onApply, onApplyColors, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myEmail, setMyEmail] = useState('');
  const [applying, setApplying] = useState('');
  const [picking, setPicking] = useState(null);
  const [sportSel, setSportSel] = useState(null);
  const [view, setView] = useState('gallery');     // 'gallery' | 'ai' | 'form' | 'edit'
  const [editingTpl, setEditingTpl] = useState(null);
  const [pendingItems, setPendingItems] = useState([]); // items captured for a new template
  const [meta, setMeta] = useState({ name: '', sport: '', brand_focus: 'Mixed', gender: 'Unisex', note: '' });
  const [saving, setSaving] = useState(false);
  const isCurator = FAV_CURATORS.includes((myEmail || '').toLowerCase());

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('store_templates').select('*').order('sport', { nullsFirst: false }).order('name');
    setTemplates(data || []); setLoading(false);
  }, []);
  useEffect(() => { (async () => { try { const { data } = await supabase.auth.getUser(); setMyEmail(data?.user?.email || ''); } catch (e) { /* */ } })(); load(); }, [load]);

  const sports = [...new Set(templates.map((t) => t.sport).filter(Boolean))].sort();
  const shown = sportSel ? templates.filter((t) => t.sport === sportSel) : templates;
  const itemsOf = (t) => (Array.isArray(t.items) ? t.items : []);

  const captureItems = () => (catalog || []).filter((c) => c.kind === 'single' && c.sku).map((c) => ({ sku: c.sku, category: c.category || (stockByWp[c.id]?.category) || null, price: c.retail_price, fundraise: c.fundraise_amount || 0, kit: c.kit_name || null, required: !!c.required }));
  const startFromStore = () => { setPendingItems(captureItems()); setMeta((m) => ({ ...m, name: '' })); setView('form'); };
  const del = async (id) => { await supabase.from('store_templates').delete().eq('id', id); load(); };
  // Sections the captured items already carry (a template can span one or many).
  const pendingSections = [...new Set(pendingItems.map((i) => (i.category || '').trim()).filter(Boolean))].sort();
  const saveTemplate = async () => {
    if (!meta.name.trim() || !pendingItems.length) return;
    setSaving(true);
    const { error } = await supabase.from('store_templates').insert({ name: meta.name.trim(), sport: meta.sport || null, brand_focus: meta.brand_focus || null, gender: meta.gender || null, note: meta.note || null, items: pendingItems, kind: 'store', section: null, created_by: myEmail || null });
    setSaving(false);
    if (!error) { setView('gallery'); setPendingItems([]); setMeta({ name: '', sport: '', brand_focus: 'Mixed', gender: 'Unisex', note: '' }); load(); }
  };

  const chip = (txt, bg = '#f1f5f9', c = '#475569') => <span style={{ fontSize: 10.5, fontWeight: 800, color: c, background: bg, borderRadius: 5, padding: '2px 7px' }}>{txt}</span>;

  return (
    <>
    {picking && <TemplateColorPicker tpl={picking} existingPids={existingPids} onConfirm={async (plan) => { await onApplyColors(plan); setPicking(null); }} onClose={() => setPicking(null)} />}
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: view === 'ai' ? 900 : 820, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{view === 'form' ? 'Save as a template' : view === 'ai' ? 'Draft a template with AI' : view === 'edit' ? 'Edit template' : '🎯 Add template'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>

          {view === 'ai' && (
            <AiStoreBuilder submitLabel="Use these for a template →" onAddProducts={(prods) => { setPendingItems((prods || []).map((p) => ({ sku: p.sku, price: p.retail_price }))); setView('form'); }} onClose={() => setView('gallery')} />
          )}

          {view === 'edit' && editingTpl && (
            <TemplateEditor template={editingTpl} onClose={() => { setView('gallery'); setEditingTpl(null); }} onSaved={() => { setView('gallery'); setEditingTpl(null); load(); }} />
          )}

          {view === 'form' && (
            <div>
              <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>{pendingItems.length} item{pendingItems.length === 1 ? '' : 's'} captured{pendingSections.length ? ` across ${pendingSections.length} section${pendingSections.length === 1 ? '' : 's'}` : ''}. Name it so reps can find it.</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Row label="Template name"><input className="form-input" autoFocus value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="e.g. Varsity Baseball — Adidas" /></Row>
                <Row label="Sport"><input className="form-input" list="tpl-sports" value={meta.sport} onChange={(e) => setMeta({ ...meta, sport: e.target.value })} placeholder="Baseball" /><datalist id="tpl-sports">{TEMPLATE_SPORTS.map((s) => <option key={s} value={s} />)}</datalist></Row>
                <Row label="Brand focus"><select className="form-input" value={meta.brand_focus} onChange={(e) => setMeta({ ...meta, brand_focus: e.target.value })}>{['Mixed', 'Adidas', 'Non-branded'].map((b) => <option key={b} value={b}>{b}</option>)}</select></Row>
                <Row label="Gender"><select className="form-input" value={meta.gender} onChange={(e) => setMeta({ ...meta, gender: e.target.value })}>{['Unisex', "Men's", "Women's", 'Youth'].map((g) => <option key={g} value={g}>{g}</option>)}</select></Row>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="btn btn-primary" disabled={!meta.name.trim() || !pendingItems.length || saving} onClick={saveTemplate}>{saving ? 'Saving…' : 'Save template'}</button>
                <button className="btn btn-secondary" onClick={() => setView('gallery')}>Cancel</button>
              </div>
            </div>
          )}

          {view === 'gallery' && (
            <div>
              {isCurator && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', alignSelf: 'center' }}>Curator:</span>
                  <button className="btn btn-sm btn-secondary" disabled={!(catalog || []).some((c) => c.kind === 'single')} onClick={startFromStore}>＋ Save this store as a template</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setView('ai')}>✨ Draft with AI</button>
                </div>
              )}

              {sports.length > 0 && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
                  <FilterBtn on={!sportSel} onClick={() => setSportSel(null)}>All</FilterBtn>
                  {sports.map((s) => <FilterBtn key={s} on={sportSel === s} onClick={() => setSportSel(sportSel === s ? null : s)}>{s}</FilterBtn>)}
                </div>
              )}

              {loading ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 12 }}>Loading templates…</div>
                : shown.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9AA1AC', fontSize: 13, padding: '28px 12px' }}>
                    No templates yet.{isCurator ? ' Build a great store, then “Save current store as template,” or draft one with AI.' : ' Ask an admin to set some up — or add products by hand.'}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {shown.map((t) => (
                      <div key={t.id} style={{ border: '1px solid #e8ebf0', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: '#fff' }}>
                        <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.2 }}>{t.name}</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {t.sport && chip(t.sport, '#eff6ff', '#1d4ed8')}
                          {t.brand_focus && chip(t.brand_focus)}
                          {t.gender && chip(t.gender)}
                        </div>
                        <div style={{ fontSize: 12, color: '#6A7180' }}>{itemsOf(t).length} item{itemsOf(t).length === 1 ? '' : 's'}{(() => { const secs = [...new Set(itemsOf(t).map((i) => (i.category || '').trim()).filter(Boolean))]; return secs.length ? ` · ${secs.length} section${secs.length === 1 ? '' : 's'}` : ''; })()}</div>
                        <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', paddingTop: 6 }}>
                          <button className="btn btn-sm btn-primary" onClick={() => setPicking(t)} style={{ flex: 1 }}>Add to store →</button>
                          {isCurator && <button title="Edit template" onClick={() => { setEditingTpl(t); setView('edit'); }} style={{ background: 'none', border: '1px solid #e2e6ec', borderRadius: 8, padding: '6px 9px', cursor: 'pointer', color: '#3A4150', fontSize: 13 }}>✎</button>}
                          {isCurator && <button title="Delete template" onClick={() => del(t.id)} style={{ background: 'none', border: '1px solid #e2e6ec', borderRadius: 8, padding: '6px 9px', cursor: 'pointer', color: '#b91c1c', fontSize: 13 }}>🗑</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              <div style={{ fontSize: 11.5, color: '#9AA1AC', marginTop: 14 }}>Using a template adds its products to this store (skipping any already added). Prices, colors &amp; art stay fully editable after.</div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

// Who "owns" a store template — a rep (matched by created_by email) or the shared
// "General" pool (curators/admins/legacy). Drives the Templates-page owner filter.
function templateOwner(tpl, REPS = []) {
  const email = String(tpl?.created_by || '').trim().toLowerCase();
  if (email) {
    const rep = (REPS || []).find((r) => r.role === 'rep' && String(r.email || '').trim().toLowerCase() === email);
    if (rep) return { scope: 'rep', id: rep.id, name: rep.name };
  }
  return { scope: 'general', id: 'general', name: 'General' };
}

// Build a store template from scratch — search the master catalog, add items with a
// price / section / kit, then name & save it to `store_templates`. Saved templates show
// up in every store's "Add template" button, so any of them can be bolted onto an
// existing store. Also used to edit an existing template (pass `template`).
function TemplateBuilder({ template = null, myEmail = '', onClose, onSaved }) {
  const editing = !!template;
  const [items, setItems] = useState(() => (editing && Array.isArray(template.items) ? template.items : []).map((it) => ({
    sku: it.sku, name: it.name || it.sku, image: it.image || null,
    category: it.category || null, price: it.price != null ? it.price : null,
    fundraise: it.fundraise || 0, kit: it.kit || null, required: !!it.required,
  })));
  const [meta, setMeta] = useState({
    name: template?.name || '', sport: template?.sport || '', brand_focus: template?.brand_focus || 'Mixed',
    gender: template?.gender || 'Unisex', note: template?.note || '',
  });
  const [saving, setSaving] = useState(false);

  // Fold newly-picked products into the item list, de-duped by SKU (re-adding a SKU
  // just refreshes its setup). Decorations don't carry into templates, so they're ignored.
  const addProducts = useCallback((products, _decos, setup = {}) => {
    setItems((prev) => {
      const bySku = new Map(prev.map((it) => [String(it.sku || '').trim().toUpperCase(), it]));
      (products || []).forEach((p) => {
        const key = String(p.sku || '').trim().toUpperCase();
        if (!key) return;
        bySku.set(key, {
          sku: p.sku, name: p.name || p.sku, image: p.image_front_url || null,
          category: (setup.category || '').trim() || null,
          price: (setup.price !== '' && setup.price != null) ? Number(setup.price) : (p.retail_price != null ? p.retail_price : null),
          fundraise: Number(setup.fundraise) || 0,
          kit: (setup.kit_name || '').trim() || null,
          required: !!setup.required,
        });
      });
      return [...bySku.values()];
    });
  }, []);
  const patchItem = (sku, patch) => setItems((prev) => prev.map((it) => it.sku === sku ? { ...it, ...patch } : it));
  const removeItem = (sku) => setItems((prev) => prev.filter((it) => it.sku !== sku));

  // Editing an existing template: its saved items are SKU-only, so resolve product
  // names / images once on open so the list shows real garments, not bare SKUs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const need = items.filter((it) => !it.image && it.sku);
      if (!need.length) return;
      const skus = [...new Set(need.map((it) => it.sku))];
      const variants = [...new Set(skus.flatMap((s) => [s, s.toUpperCase(), s.toLowerCase()]))];
      const found = [];
      for (let i = 0; i < variants.length; i += 150) { const { data } = await supabase.from('products').select('sku,name,image_front_url').in('sku', variants.slice(i, i + 150)); if (data) found.push(...data); }
      const bySku = new Map(); found.forEach((p) => { const k = String(p.sku || '').trim().toUpperCase(); if (!bySku.has(k)) bySku.set(k, p); });
      if (cancelled) return;
      setItems((prev) => prev.map((it) => { if (it.image) return it; const p = bySku.get(String(it.sku || '').trim().toUpperCase()); return p ? { ...it, name: p.name || it.name, image: p.image_front_url || null } : it; }));
    })();
    return () => { cancelled = true; };
  }, []); // once on mount

  const sections = [...new Set(items.map((it) => (it.category || '').trim()).filter(Boolean))];
  const canSave = meta.name.trim() && items.length;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const payload = {
      name: meta.name.trim(), sport: meta.sport || null, brand_focus: meta.brand_focus || null,
      gender: meta.gender || null, note: meta.note || null, kind: 'store', section: null,
      items: items.map((it) => ({ sku: it.sku, category: it.category || null, price: it.price, fundraise: it.fundraise || 0, kit: it.kit || null, required: !!it.required })),
    };
    let error;
    if (editing) {
      ({ error } = await supabase.from('store_templates').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', template.id));
    } else {
      ({ error } = await supabase.from('store_templates').insert({ ...payload, created_by: myEmail || null }));
    }
    setSaving(false);
    if (error) { alert('Could not save template: ' + error.message); return; }
    onSaved && onSaved();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#f7f8fa', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 1040, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3', background: '#fff', borderRadius: '14px 14px 0 0' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{editing ? 'Edit template' : 'Create a template'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          {/* Lead: name the template, then jump straight into the catalog finder */}
          <div style={{ background: '#fff', border: '1px solid #e8ebf0', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <Row label="Template name"><input className="form-input" autoFocus value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="e.g. Varsity Baseball — Adidas" /></Row>
            <div style={{ fontSize: 12.5, color: '#6A7180', marginTop: 2 }}>Search the catalog below and add the items this template should include. Give each item a <b>section</b> — a template can have one section or many. Sport / brand / gender are at the bottom.</div>
          </div>

          {/* Captured items */}
          <div style={{ background: '#fff', border: '1px solid #e8ebf0', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Items in this template <span style={{ color: '#94a3b8', fontWeight: 600 }}>({items.length})</span></div>
              {items.length > 0 && <button type="button" onClick={() => setItems([])} style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Clear all</button>}
            </div>
            {items.length === 0 ? (
              <div style={{ color: '#9AA1AC', fontSize: 13, padding: '14px 4px' }}>No items yet — search the catalog below and add products to build the template.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((it) => (
                  <div key={it.sku} style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid #eef1f5', borderRadius: 10, padding: '7px 10px' }}>
                    <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 6, border: '1px solid #eef2f7', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{it.image ? <img src={it.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 8, color: '#cbd5e1', fontWeight: 700 }}>{(it.sku || '').slice(0, 8)}</span>}</div>
                    <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{it.sku}</div>
                    </div>
                    <input className="form-input" value={it.category || ''} onChange={(e) => patchItem(it.sku, { category: e.target.value })} placeholder="Section" style={{ width: 130, fontSize: 12.5, padding: '5px 8px' }} />
                    <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>$<input className="form-input" type="number" step="0.01" value={it.price ?? ''} onChange={(e) => patchItem(it.sku, { price: e.target.value === '' ? null : Number(e.target.value) })} placeholder="list" style={{ width: 78, fontSize: 12.5, padding: '5px 8px' }} /></label>
                    <label style={{ fontSize: 11.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!it.required} onChange={(e) => patchItem(it.sku, { required: e.target.checked })} />Req</label>
                    <button type="button" onClick={() => removeItem(it.sku)} title="Remove" style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Catalog search / picker — the main way to add items */}
          <ProductPicker label="Add items to the template" onPickMany={addProducts} destLabel="template" initialInStock={false} standardCategories={[...new Set(items.map((it) => it.category).filter(Boolean))]} />

          {/* Who it's for */}
          <div style={{ background: '#fff', border: '1px solid #e8ebf0', borderRadius: 12, padding: 14, margin: '14px 0' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Details</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>{sections.length ? `${sections.length} section${sections.length === 1 ? '' : 's'}: ${sections.join(', ')}` : 'Tip: give items a section so they group when added to a store.'}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Row label="Sport"><input className="form-input" list="tplb-sports" value={meta.sport} onChange={(e) => setMeta({ ...meta, sport: e.target.value })} placeholder="Baseball" /><datalist id="tplb-sports">{TEMPLATE_SPORTS.map((s) => <option key={s} value={s} />)}</datalist></Row>
              <Row label="Brand focus"><select className="form-input" value={meta.brand_focus} onChange={(e) => setMeta({ ...meta, brand_focus: e.target.value })}>{['Mixed', 'Adidas', 'Non-branded'].map((b) => <option key={b} value={b}>{b}</option>)}</select></Row>
              <Row label="Gender"><select className="form-input" value={meta.gender} onChange={(e) => setMeta({ ...meta, gender: e.target.value })}>{['Unisex', "Men's", "Women's", 'Youth'].map((g) => <option key={g} value={g}>{g}</option>)}</select></Row>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 4, position: 'sticky', bottom: 0, background: '#f7f8fa', padding: '12px 0 4px' }}>
            <button className="btn btn-primary" disabled={!canSave || saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save template'}</button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            {!canSave && <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>{!meta.name.trim() ? 'Name the template' : 'Add at least one item'}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Read-only detail view for one template — resolves its saved SKUs to live products so you
// can see every item (image, name, section, price, fundraising, mandatory) in one place.
function TemplateDetail({ template, owner, canEdit, onClose, onEdit, onDelete, onStartStore, onAddToStore }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const sections = [...new Set((Array.isArray(template?.items) ? template.items : []).map((it) => (it.category || '').trim()).filter(Boolean))];
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const items = Array.isArray(template?.items) ? template.items : [];
      const skus = [...new Set(items.map((i) => i.sku).filter(Boolean))];
      const variants = [...new Set(skus.flatMap((s) => [s, s.toUpperCase(), s.toLowerCase()]))];
      const found = [];
      for (let i = 0; i < variants.length; i += 150) { const { data } = await supabase.from('products').select('id,sku,name,brand,color,retail_price,image_front_url').in('sku', variants.slice(i, i + 150)); if (data) found.push(...data); }
      const bySku = new Map(); found.forEach((p) => { const k = String(p.sku || '').trim().toUpperCase(); if (!bySku.has(k)) bySku.set(k, p); });
      const built = items.map((it) => ({ ...it, product: bySku.get(String(it.sku || '').trim().toUpperCase()) || null }));
      if (!cancelled) { setRows(built); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [template]);
  const chip = (txt, bg = '#f1f5f9', c = '#475569') => <span style={{ fontSize: 10.5, fontWeight: 800, color: c, background: bg, borderRadius: 5, padding: '2px 7px' }}>{txt}</span>;
  const missing = rows.filter((r) => !r.product).length;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1050, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 720, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{template.name}</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {owner && (owner.scope === 'rep' ? chip(owner.name, '#fef3c7', '#92400e') : chip('General', '#ede9fe', '#6d28d9'))}
              {template.sport && chip(template.sport, '#eff6ff', '#1d4ed8')}
              {template.brand_focus && chip(template.brand_focus)}
              {template.gender && chip(template.gender)}
              {sections.map((s) => chip('§ ' + s, '#ecfdf5', '#047857'))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: '12px 16px', maxHeight: '62vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 10 }}>{rows.length} item{rows.length === 1 ? '' : 's'} in this template.{missing > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> {missing} no longer in the catalog.</span>}</div>
          {loading ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 12 }}>Loading items…</div>
            : rows.length === 0 ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 12 }}>This template has no items.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((r, i) => {
                  const price = (r.price != null && r.price !== '') ? r.price : (r.product ? r.product.retail_price : null);
                  return (
                    <div key={(r.sku || '') + i} style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid #eef1f5', borderRadius: 10, padding: '7px 10px', opacity: r.product ? 1 : 0.6 }}>
                      <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 6, border: '1px solid #eef2f7', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{r.product?.image_front_url ? <img src={r.product.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 8, color: '#cbd5e1', fontWeight: 700 }}>{(r.sku || '').slice(0, 8)}</span>}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product?.name || r.sku}{!r.product && <span style={{ color: '#b45309', fontWeight: 700, fontSize: 11 }}> · not found</span>}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{r.sku}{r.product?.brand ? ` · ${r.product.brand}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                        {r.category && chip(r.category)}
                        {r.kit && chip('Kit: ' + r.kit, '#eff6ff', '#1d4ed8')}
                        {r.required && chip('Mandatory', '#fef2f2', '#b91c1c')}
                        {Number(r.fundraise) > 0 && chip('+' + money(r.fundraise) + ' fund', '#ecfdf5', '#047857')}
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#191919', minWidth: 54, textAlign: 'right' }}>{price != null ? money(price) : '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', borderTop: '1px solid #eef0f3' }}>
          {onAddToStore && <button className="btn btn-primary" onClick={() => onAddToStore(template)}>Add to a store →</button>}
          {onStartStore && <button className="btn btn-secondary" onClick={() => onStartStore(template)}>Start a store</button>}
          <span style={{ flex: '1 1 8px' }} />
          {canEdit && <button className="btn btn-secondary" onClick={onEdit}>Edit</button>}
          {canEdit && <button className="btn btn-secondary" onClick={onDelete} style={{ color: '#b91c1c' }}>Delete</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Templates page manager — lists the saved `store_templates` (the item sets that get bolted
// onto stores via "Add template"), lets a curator create/edit/delete them, and filters by
// owner: the shared "General" pool vs each rep's own templates.
function TemplateManager({ REPS = [], cu, onStartStore, onAddToStore }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState('all'); // 'all' | 'general' | rep id
  const [builder, setBuilder] = useState(null);           // null | 'new' | template object (edit)
  const [viewing, setViewing] = useState(null);           // template being inspected (detail view)
  // Identity from the logged-in team member (reliable), with the auth email as a fallback.
  const myEmail = (cu?.email || '').toLowerCase();
  const isAdmin = cu?.role === 'admin' || FAV_CURATORS.includes(myEmail);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('store_templates').select('*').order('name');
    setTemplates(data || []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const withOwner = templates.map((t) => ({ ...t, _owner: templateOwner(t, REPS) }));
  // Reps that actually have templates — drives the owner filter chips.
  const repChips = REPS.filter((r) => r.role === 'rep' && withOwner.some((t) => t._owner.scope === 'rep' && t._owner.id === r.id));
  const hasGeneral = withOwner.some((t) => t._owner.scope === 'general');
  const shown = withOwner.filter((t) => ownerFilter === 'all' || (ownerFilter === 'general' ? t._owner.scope === 'general' : t._owner.id === ownerFilter));
  const del = async (id) => { if (!window.confirm('Delete this template?')) return; await supabase.from('store_templates').delete().eq('id', id); load(); };
  const itemsOf = (t) => (Array.isArray(t.items) ? t.items : []);
  const sectionsOf = (t) => [...new Set(itemsOf(t).map((it) => (it.category || '').trim()).filter(Boolean))];
  const canEdit = (t) => isAdmin || (myEmail && String(t.created_by || '').toLowerCase() === myEmail);
  const chip = (txt, bg = '#f1f5f9', c = '#475569') => <span style={{ fontSize: 10.5, fontWeight: 800, color: c, background: bg, borderRadius: 5, padding: '2px 7px' }}>{txt}</span>;

  return (
    <div style={{ marginBottom: 34 }}>
      {builder && <TemplateBuilder template={builder === 'new' ? null : builder} myEmail={cu?.email || ''} onClose={() => setBuilder(null)} onSaved={() => { setBuilder(null); load(); }} />}
      {viewing && <TemplateDetail template={viewing} owner={templateOwner(viewing, REPS)} canEdit={canEdit(viewing)} onClose={() => setViewing(null)} onEdit={() => { const t = viewing; setViewing(null); setBuilder(t); }} onDelete={async () => { await del(viewing.id); setViewing(null); }} onStartStore={onStartStore ? (t) => { setViewing(null); onStartStore(t); } : null} onAddToStore={onAddToStore ? (t) => { setViewing(null); onAddToStore(t); } : null} />}
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', fontWeight: 800, fontSize: 17, color: '#192853', letterSpacing: '.5px', marginBottom: 8 }}>Item Templates</div>
      <div style={{ marginBottom: 16, fontSize: 15, color: '#5A6075', maxWidth: 720, lineHeight: 1.6 }}>Build a reusable set of items from the catalog, then add it to any existing store from that store's catalog → <b>Add template</b>. Prices, colors &amp; art stay editable after.</div>

      {(hasGeneral || repChips.length > 0) && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8A93A8', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 2 }}>Owner</span>
          <FilterBtn on={ownerFilter === 'all'} onClick={() => setOwnerFilter('all')}>All</FilterBtn>
          {hasGeneral && <FilterBtn on={ownerFilter === 'general'} onClick={() => setOwnerFilter('general')}>General</FilterBtn>}
          {repChips.map((r) => <FilterBtn key={r.id} on={ownerFilter === r.id} onClick={() => setOwnerFilter(r.id)}>{r.name}</FilterBtn>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {/* Build a Template — the primary action: opens the catalog picker */}
            <button onClick={() => setBuilder('new')} style={{ textAlign: 'center', cursor: 'pointer', background: '#fff', border: '2px dashed #C3CAD8', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 168, gap: 10, color: '#5A6075', fontFamily: 'inherit', transition: 'all .15s' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#EEF1F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#192853" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', fontWeight: 800, fontSize: 18, color: '#192853', letterSpacing: '.5px' }}>Build a Template</div>
              <div style={{ fontSize: 12.5 }}>Pick items from the catalog</div>
            </button>
            {loading ? <div style={{ gridColumn: '1/-1', color: '#9AA1AC', fontSize: 13, padding: 12 }}>Loading templates…</div>
              : shown.length === 0 ? <div style={{ gridColumn: '1/-1', color: '#8A93A8', fontSize: 13.5, padding: '18px 4px' }}>{templates.length === 0 ? 'No item templates yet — click “Build a Template” to create your first one.' : 'No templates for this owner.'}</div>
              : shown.map((t) => (
              <div key={t.id} onClick={() => setViewing(t)} title="View items" style={{ border: '1px solid #e8ebf0', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: '#fff', cursor: 'pointer' }}>
                <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.2 }}>{t.name}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {t._owner.scope === 'rep' ? chip(t._owner.name, '#fef3c7', '#92400e') : chip('General', '#ede9fe', '#6d28d9')}
                  {t.sport && chip(t.sport, '#eff6ff', '#1d4ed8')}
                  {t.brand_focus && chip(t.brand_focus)}
                </div>
                <div style={{ fontSize: 12, color: '#6A7180' }}>{itemsOf(t).length} item{itemsOf(t).length === 1 ? '' : 's'}{sectionsOf(t).length ? ` · ${sectionsOf(t).length} section${sectionsOf(t).length === 1 ? '' : 's'}` : ''}</div>
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onAddToStore && <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onAddToStore(t); }} style={{ flex: 1 }}>Add to store</button>}
                    {onStartStore && <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onStartStore(t); }} style={{ flex: 1 }}>Start store</button>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); setViewing(t); }} style={{ flex: 1 }}>View items</button>
                    {canEdit(t) && <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); setBuilder(t); }}>Edit</button>}
                    {canEdit(t) && <button title="Delete template" onClick={(e) => { e.stopPropagation(); del(t.id); }} style={{ background: 'none', border: '1px solid #e2e6ec', borderRadius: 8, padding: '6px 9px', cursor: 'pointer', color: '#b91c1c', fontSize: 13 }}>🗑</button>}
                  </div>
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}

// Pick an existing store to bolt a template onto (used by the Templates-page "Add to a
// store" action). Lists live (non-template) stores, searchable by store or club name.
function StorePickerModal({ stores = [], custName = () => '', title = 'Pick a store', onPick, onClose }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = stores
    .filter((s) => !ql || String(s.name || '').toLowerCase().includes(ql) || String(custName(s.customer_id) || '').toLowerCase().includes(ql))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 300);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1040, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 560, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <input className="form-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stores by name or club…" style={{ width: '100%', marginBottom: 12 }} />
          <div style={{ maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.length === 0 ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 12 }}>No stores match.</div>
              : list.map((s) => (
                <button key={s.id} type="button" onClick={() => onPick(s)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #eef1f5', borderRadius: 10, padding: '9px 12px', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{custName(s.customer_id)}{s.status ? ` · ${s.status}` : ''}{s.slug ? ` · /shop/${s.slug}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#1d4ed8' }}>Add →</span>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Common sizing scales, so a rep picks a type instead of typing sizes every time.
// Quick-pick category names for the side-list "+ Category" (reps can also type a custom one).
const CATEGORY_PRESETS = ['Gear', 'Varsity Gear', 'FROSH Gear', 'Player Pack', 'Mandatory Player Pack', 'Practice Gear', 'Footwear', 'Accessories', 'Parent Gear', 'Spirit Pack'];

const SIZE_PRESETS = [
  { label: 'Adult S–XL', sizes: ['S', 'M', 'L', 'XL'] },
  { label: 'Adult S–2XL', sizes: ['S', 'M', 'L', 'XL', '2XL'] },
  { label: 'Adult S–3XL', sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { label: 'Adult S–4XL', sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'] },
  { label: 'Adult XS–XL', sizes: ['XS', 'S', 'M', 'L', 'XL'] },
  { label: 'Adult XS–2XL', sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'] },
  { label: 'Adult XS–3XL', sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { label: 'Youth XS–XL', sizes: ['YXS', 'YS', 'YM', 'YL', 'YXL'] },
  { label: 'Youth S–XL', sizes: ['YS', 'YM', 'YL', 'YXL'] },
  { label: 'Numeric 28–40', sizes: ['28', '30', '32', '34', '36', '38', '40'] },
  { label: 'Jersey (numeric)', sizes: ['36', '38', '40', '42', '44', '46', '48', '50', '52'] },
  { label: 'Combo S/M · L/XL', sizes: ['S/M', 'L/XL'] },
  { label: 'Combo XS/S–XL/2XL', sizes: ['XS/S', 'S/M', 'M/L', 'L/XL', 'XL/2XL'] },
  { label: 'Shoe M 7–13', sizes: ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13'] },
  { label: 'Shoe W 5–11', sizes: ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '11'] },
  { label: 'Shoe Youth 1Y–7Y', sizes: ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y'] },
  { label: 'Hat — fitted', sizes: ['6 3/4', '6 7/8', '7', '7 1/8', '7 1/4', '7 3/8', '7 1/2', '7 5/8', '7 3/4'] },
  { label: 'One size (OSFA)', sizes: ['OSFA'] },
];

// Quick-create a master catalog product (saved to `products` for reuse in any store):
// name, vendor, sizing type, image, cost. Optionally drops it straight into this store.
// Reprice the whole store to a target margin in one shot, with a live before/after preview.
function PriceToMarginModal({ catalog = [], costByPid = {}, onApply, onClose }) {
  const [pct, setPct] = useState(45);
  const m = Math.max(0, Math.min(90, Number(pct) || 0)) / 100;
  const singles = (catalog || []).filter((c) => c.kind !== 'bundle');
  const priced = singles.filter((c) => costByPid[c.product_id] != null).map((c) => {
    const trueCost = Number(costByPid[c.product_id]) + ((Array.isArray(c.decorations) && c.decorations.length) ? 5 : 0);
    return { id: c.id, name: c.display_name || c.sku || '(item)', from: Number(c.retail_price) || 0, to: Math.max(0, Math.ceil(trueCost / (1 - m))) };
  });
  const changes = priced.filter((r) => r.to !== r.from);
  const noCost = singles.length - priced.length;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 560, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Price the store to a margin</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>Sets each item's price to hit this margin after cost (garment + ~$5 decoration when decorated). Items with no cost on file are skipped; fundraising still adds on top.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Target margin</span>
            <input className="form-input" type="number" min={0} max={90} step={1} value={pct} onChange={(e) => setPct(e.target.value)} style={{ width: 90 }} />
            <span style={{ fontWeight: 700 }}>%</span>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
            <span style={{ color: '#166534' }}>{changes.length} of {priced.length} priced item{priced.length === 1 ? '' : 's'} will change</span>
            {noCost > 0 && <span style={{ color: '#92400e', marginLeft: 10 }}>{noCost} skipped (no cost)</span>}
          </div>
          {changes.length > 0 && (
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #eef0f3', borderRadius: 10 }}>
              {changes.slice(0, 60).map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderTop: '1px solid #f1f5f9', fontSize: 12.5 }}>
                  <div style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ color: '#94a3b8' }}>{money(r.from)}</div>
                  <div style={{ color: '#94a3b8' }}>→</div>
                  <div style={{ fontWeight: 800, color: r.to >= r.from ? '#166534' : '#b45309' }}>{money(r.to)}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!changes.length} onClick={() => onApply(Number(pct) || 0)} style={{ opacity: changes.length ? 1 : 0.5 }}>Apply to {changes.length} item{changes.length === 1 ? '' : 's'}</button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomProductCreator({ catSuggestions = [], library = [], onClose, onCreated }) {
  const [vendors, setVendors] = useState([]);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [color, setColor] = useState('');
  const [sizes, setSizes] = useState(['S', 'M', 'L', 'XL']);
  const [newSize, setNewSize] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [image, setImage] = useState(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imageBack, setImageBack] = useState(null);
  const [imgBackBusy, setImgBackBusy] = useState(false);
  const [alsoAdd, setAlsoAdd] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showSizeTable, setShowSizeTable] = useState(false);
  const [sizeCost, setSizeCost] = useState({}); // size -> cost override (e.g. 2XL+ cost more)
  const [sizeQty, setSizeQty] = useState({});   // size -> in-house stock qty to seed
  const [reusable, setReusable] = useState(true); // recurring (save to catalog) vs one-time (this store only)
  const [logo, setLogo] = useState(null);         // { art_url, art_id, source_url, label } to decorate the item with
  const [logoBusy, setLogoBusy] = useState(false);

  useEffect(() => { (async () => { const { data } = await supabase.from('vendors').select('id,name').order('name'); setVendors(data || []); })(); }, []);

  const [customPresets, setCustomPresets] = useState([]);
  const [showNewPreset, setShowNewPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetSizes, setNewPresetSizes] = useState('');
  const allPresets = [...SIZE_PRESETS, ...customPresets];
  const presetLabel = allPresets.find((p) => p.sizes.length === sizes.length && p.sizes.every((s, i) => s === sizes[i]))?.label || 'Custom';
  // Keep the size list ordered smallest → largest no matter what order they're typed in.
  const sortSizes = (arr) => [...arr].sort((a, b) => sizeRank(a) - sizeRank(b));
  const addSize = () => {
    const s = newSize.trim().toUpperCase();
    if (s && !sizes.includes(s)) setSizes(sortSizes([...sizes, s]));
    setNewSize('');
  };
  const saveCustomPreset = () => {
    const label = newPresetName.trim();
    const szArr = newPresetSizes.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!label || !szArr.length) return;
    const preset = { label, sizes: szArr };
    setCustomPresets((prev) => [...prev.filter((p) => p.label !== label), preset]);
    setSizes(szArr);
    setNewPresetName(''); setNewPresetSizes(''); setShowNewPreset(false);
  };
  const logoUrlOf = (it) => it && (webLogoDefault(it) || it.web_logo_url || it.preview_url || it.art_url);
  const storeLogos = (library || []).filter((it) => it && it.kind !== 'art' && logoUrlOf(it));
  const pickLogoFile = async (file) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const url = await cloudUpload(file, 'nsa-webstores');
      const png = file.type && file.type.startsWith('image/') ? url : (vectorPreviewUrl(url) || url);
      setLogo({ art_url: png, art_id: 'cpc-' + Date.now().toString(36), source_url: url, label: file.name });
    } catch (e) { /* cloudUpload surfaces a toast */ }
    setLogoBusy(false);
  };

  const save = async () => {
    if (!name.trim()) { setErr('Give the item a name.'); return; }
    setSaving(true); setErr('');
    const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
    const finalSku = (sku.trim() || ('CUS-' + Date.now().toString(36).toUpperCase())).toUpperCase();
    // Per-size cost overrides (e.g. 2XL/3XL cost more) → products.size_costs.
    const size_costs = {};
    for (const s of sizes) { const v = sizeCost[s]; if (v !== '' && v != null && !Number.isNaN(Number(v))) size_costs[s] = Number(v); }
    const row = { id, vendor_id: vendorId || null, sku: finalSku, name: name.trim(), brand: brand.trim() || null, color: color.trim() || null, category: category.trim() || null, retail_price: Number(price) || 0, nsa_cost: cost === '' ? null : (Number(cost) || 0), available_sizes: sizes, size_costs: Object.keys(size_costs).length ? size_costs : null, image_front_url: image || null, image_back_url: imageBack || null, is_active: reusable, is_archived: false, inventory_source: 'manual', catalog_sell_price: Number(price) || null };
    const { error } = await supabase.from('products').insert(row);
    if (error) { setSaving(false); setErr('Could not save: ' + error.message); return; }
    // Seed in-house warehouse stock so the item shows as fulfillable right away.
    const invRows = sizes.map((s) => ({ product_id: id, size: s, quantity: Math.max(0, Math.floor(Number(sizeQty[s]) || 0)) })).filter((r) => r.quantity > 0);
    if (invRows.length) { try { await supabase.from('product_inventory').insert(invRows); } catch (e) { /* non-fatal */ } }
    // Attach the chosen logo as a front decoration (default placement; fine-tune later in Art).
    const decorations = logo ? [{ art_id: logo.art_id || ('cpc-' + Date.now().toString(36)), art_url: logo.art_url, orig_url: logo.art_url, source_url: logo.source_url || logo.art_url, placement: 'full-front', color_label: 'original', side: 'front', x: 50, y: 44, w: 30 }] : [];
    const addToStore = reusable ? alsoAdd : true; // a one-time item only makes sense in this store
    // Keep the spinner up through the (sometimes slow) add-to-store + catalog reload so it
    // never looks like nothing happened — onCreated closes the modal when it's done.
    try { await (onCreated && onCreated(row, addToStore, decorations)); } catch (e) { setSaving(false); setErr('Saved the product, but adding it to the store failed: ' + (e.message || e)); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 720, margin: 'auto' }}>
        {saving && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.78)', borderRadius: 14, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span style={{ display: 'inline-block', width: 34, height: 34, border: '3px solid #e2e8f0', borderTop: '3px solid #2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3A4150' }}>Saving the item{reusable ? '' : ' to this store'}…</div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>New custom product</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>{reusable ? 'Saved to the product catalog for reuse in any store.' : 'Created for this store only — not added to the shared catalog.'} Only a name is required.</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 auto', width: 160 }}>
              <ImageUpload value={image} onChange={setImage} onBusy={setImgBusy} label="Front image" />
              <ImageUpload value={imageBack} onChange={setImageBack} onBusy={setImgBackBusy} label="Back image" />
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Row label="Name"><input className="form-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Custom Booster Tee" /></Row>
                <Row label="SKU (blank = auto)"><input className="form-input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="auto" style={{ width: 150 }} /></Row>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Row label="Vendor"><select className="form-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={{ minWidth: 180 }}><option value="">— none —</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Row>
                <Row label="Brand"><input className="form-input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="optional" style={{ width: 150 }} /></Row>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Row label="Category"><input className="form-input" list="cpc-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Tees" /><datalist id="cpc-cats">{catSuggestions.map((c) => <option key={c} value={c} />)}</datalist></Row>
                <Row label="Color"><input className="form-input" value={color} onChange={(e) => setColor(e.target.value)} placeholder="optional" style={{ width: 150 }} /></Row>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Row label="Sizing type">
                <select className="form-input" value={presetLabel} onChange={(e) => { if (e.target.value === '__new__') { setShowNewPreset(true); return; } const p = allPresets.find((x) => x.label === e.target.value); if (p) setSizes(p.sizes); }} style={{ width: 210 }}>
                  {SIZE_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                  {customPresets.map((p) => <option key={p.label} value={p.label}>{p.label} ★</option>)}
                  {presetLabel === 'Custom' && <option value="Custom">Custom</option>}
                  <option value="__new__">+ Define new sizing...</option>
                </select>
              </Row>
              <Row label="Cost (NSA)"><input className="form-input" type="number" step="0.01" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" style={{ width: 110 }} /></Row>
              <Row label="Sale price"><input className="form-input" type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" style={{ width: 110 }} /></Row>
            </div>
            {showNewPreset && (
              <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: '#f0f9ff', border: '1px solid #bae6fd', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0369a1' }}>New preset</span>
                <input className="form-input" placeholder="Name (e.g. Shoe W 6–10)" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} style={{ width: 180 }} />
                <input className="form-input" placeholder="Sizes, comma-separated" value={newPresetSizes} onChange={(e) => setNewPresetSizes(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveCustomPreset(); } }} style={{ width: 210 }} />
                <button type="button" className="btn btn-sm btn-primary" onClick={saveCustomPreset}>Save</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowNewPreset(false)}>Cancel</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {sizes.map((s) => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f1f5f9', borderRadius: 7, padding: '3px 8px', fontSize: 12, fontWeight: 700 }}>{s}<button type="button" onClick={() => setSizes(sizes.filter((x) => x !== s))} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button></span>)}
              <input className="form-input" style={{ width: 90 }} placeholder="+ size" value={newSize} onChange={(e) => setNewSize(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); addSize(); } }} title="Type a size and press Tab or Enter to add it" />
            </div>
            {sizes.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => setShowSizeTable((v) => !v)} style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>{showSizeTable ? '− Hide' : '+ Set'} per-size cost &amp; in-house stock</button>
                {showSizeTable && (
                  <div style={{ marginTop: 8, border: '1px solid #eef0f3', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', gap: 8, padding: '6px 10px', background: '#f8fafc', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: '#64748b' }}>
                      <div style={{ width: 70 }}>Size</div><div style={{ width: 130 }}>Cost (blank = base)</div><div style={{ width: 110 }}>In-house qty</div>
                    </div>
                    {sizes.map((s) => (
                      <div key={s} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', borderTop: '1px solid #f1f5f9' }}>
                        <div style={{ width: 70, fontSize: 12.5, fontWeight: 700 }}>{s}</div>
                        <input className="form-input" style={{ width: 130 }} type="number" step="0.01" min={0} placeholder={cost === '' ? 'base' : String(cost)} value={sizeCost[s] ?? ''} onChange={(e) => setSizeCost((m) => ({ ...m, [s]: e.target.value }))} />
                        <input className="form-input" style={{ width: 110 }} type="number" step="1" min={0} placeholder="0" value={sizeQty[s] ?? ''} onChange={(e) => setSizeQty((m) => ({ ...m, [s]: e.target.value }))} />
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: '#94a3b8', padding: '6px 10px', borderTop: '1px solid #f1f5f9' }}>Cost overrides cover sizes that run pricier (2XL/3XL+). In‑house qty seeds your warehouse stock so the item shows as fulfillable.</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b', marginBottom: 6 }}>Logo <span style={{ fontWeight: 600, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>· optional — drop one or pick from the store's logos; place it precisely later in Art &amp; colors</span></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <label onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = (e.dataTransfer.files || [])[0]; if (f) pickLogoFile(f); }} style={{ width: 86, height: 86, border: '1.5px dashed #d7dbe2', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#fafbfc', fontSize: 10.5, color: '#94a3b8', textAlign: 'center', padding: 6, flexShrink: 0 }}>
                {logoBusy ? 'Uploading…' : <span>＋<br />Drop / browse</span>}
                <input type="file" accept="image/*,.ai,.eps,.pdf,.svg" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pickLogoFile(f); e.target.value = ''; }} />
              </label>
              {storeLogos.slice(0, 8).map((it) => { const u = logoUrlOf(it); const on = logo && logo.art_id === it.id; return (
                <button key={it.id} type="button" title={it.label || it.name || 'logo'} onClick={() => setLogo({ art_url: u, art_id: it.id, source_url: u, label: it.label || it.name })} style={{ width: 64, height: 64, border: '2px solid ' + (on ? '#191919' : '#e2e8f0'), borderRadius: 8, padding: 3, background: '#fff', cursor: 'pointer', flexShrink: 0 }}>
                  <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </button>
              ); })}
              {logo && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
                <div style={{ width: 64, height: 64, border: '2px solid #166534', borderRadius: 8, padding: 3, background: '#fff', flexShrink: 0 }}><img src={logo.art_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div>
                <button type="button" onClick={() => setLogo(null)} className="btn btn-sm btn-secondary" style={{ color: '#b91c1c' }}>Clear</button>
              </div>}
            </div>
          </div>

          {err && <div style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600, marginTop: 10 }}>{err}</div>}

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b', marginBottom: 6 }}>This item is</div>
            <div style={{ display: 'inline-flex', background: '#eef0f3', borderRadius: 9, padding: 3 }}>
              {[['reuse', 'Reusable — save to catalog'], ['once', 'One‑time — this store only']].map(([v, lbl]) => { const on = reusable === (v === 'reuse'); return (
                <button key={v} type="button" onClick={() => setReusable(v === 'reuse')} style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 800, background: on ? '#fff' : 'transparent', color: on ? '#191919' : '#6A7180', boxShadow: on ? '0 1px 2px rgba(0,0,0,.10)' : 'none' }}>{lbl}</button>
              ); })}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>{reusable ? "Recurring item — kept in the catalog so you can drop it into other stores later." : "Just for this store — it won't clutter the shared catalog or product search."}</div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={saving || imgBusy || imgBackBusy || logoBusy || !name.trim()} onClick={save}>{saving ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Saving…</span> : reusable ? 'Save to catalog' : 'Add to this store'}</button>
            {reusable && <Toggle label="Also add to this store" checked={alsoAdd} onChange={setAlsoAdd} />}
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Bulk import — a sales rep drops an Excel / Google-Sheets (CSV) export of SKUs to populate
// the store. Only a SKU column is required; optional Price, Fundraising, Category, Kit,
// Mandatory. SKUs are matched to products (case-insensitive) and a preview shows
// matched / already-in-store / not-found before anything is added.
function SkuImporter({ existingPids, storeFund = {}, onApplyColors, onGoToArt, onClose }) {
  // Spreadsheet → style rows: parse SKUs, group into one row per garment style with
  // sibling colorways pickable (same grid as the template color picker), price/fundraise
  // optional (blank = each color's list price / the store's fundraising rule), then the
  // picked colors fold into multi-color cards via the template-apply path.
  const [rows, setRows] = useState([]);
  const [issues, setIssues] = useState(null); // { notfound: [skus], dupRows: n, matched: n, viaVendor: n }
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(''); // sub-status while working (e.g. vendor lookup)
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState('');
  const fileRef = useRef(null);
  // Real vendor ids (products.vendor_id FK) so a vendor-API import upserts a valid id.
  const vendorMapRef = useRef(null);
  useEffect(() => { (async () => { const { data } = await supabase.from('vendors').select('id,api_provider'); const m = {}; (data || []).forEach((v) => { if (v.api_provider) m[v.api_provider] = v.id; }); vendorMapRef.current = m; })(); }, []);

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const pickField = (obj, keys) => { for (const k of Object.keys(obj)) { if (keys.includes(norm(k))) { const v = obj[k]; if (v !== '' && v != null) return v; } } return ''; };
  const metaOf = (r) => ({ price: r.price, fundraise: r.fundraise, category: r.category || null, kit: r.kit || null, required: r.mandatory });

  const downloadTemplate = () => {
    const csv = 'SKU,Price,Fundraising,Category,Kit,Mandatory\nJX4452,,,Spirit Wear,,no\nA595,45,5,Coaches,,no\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'store-import-template.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // Turn parsed spreadsheet rows into the style-row grid: parse SKUs, match the local
  // catalog, look up any leftovers live in the vendor catalogs (importing what's found),
  // then group into one row per style with sibling colorways.
  const processRaw = async (raw) => {
    const parsed = raw.map((r) => ({
      sku: String(pickField(r, ['sku', 'style', 'style #', 'item', 'item #', 'item number', 'product', 'product sku', 'number'])).trim(),
      price: pickField(r, ['price', 'retail', 'retail price', 'x']),
      fundraise: pickField(r, ['fundraise', 'fundraising', 'fundraiser', 'y']),
      category: String(pickField(r, ['category', 'section', 'group'])).trim(),
      kit: String(pickField(r, ['kit', 'package', 'bundle'])).trim(),
      mandatory: ['yes', 'y', 'true', '1', 'x', 'required'].includes(norm(pickField(r, ['mandatory', 'required']))),
    })).filter((r) => r.sku);
    if (!parsed.length) { setErr('No SKUs found — make sure a column is headed “SKU”.'); setBusy(false); setStage(''); return; }
    // Dedupe rows repeating the same SKU (first row's price/category wins).
    const seenSku = new Set(); let dupRows = 0;
    const uniq = parsed.filter((r) => { const k = r.sku.toUpperCase(); if (seenSku.has(k)) { dupRows += 1; return false; } seenSku.add(k); return true; });
    const variants = [...new Set(uniq.flatMap((r) => [r.sku, r.sku.toUpperCase(), r.sku.toLowerCase()]))];
    const cat = [];
    for (let i = 0; i < variants.length; i += 150) {
      const { data } = await supabase.from('products').select('id,sku,name,color,retail_price,image_front_url').in('sku', variants.slice(i, i + 150));
      if (data) cat.push(...data);
    }
    const byKey = new Map();
    cat.forEach((p) => { const k = String(p.sku || '').trim().toUpperCase(); if (!byKey.has(k)) byKey.set(k, p); });
    const matched = [];
    const notInCatalog = [];
    uniq.forEach((r) => { const p = byKey.get(r.sku.toUpperCase()); if (p) matched.push({ product: p, meta: metaOf(r) }); else notInCatalog.push(r); });

    // Vendor-API fallback: any SKU not in the catalog gets looked up live (SanMar / S&S /
    // Richardson / Momentec) and, if found, its colorways are imported so it behaves like
    // any catalog style. Vendors we don't have API search for just stay "not found".
    const notfound = [];
    let viaVendor = 0;
    const vm = vendorMapRef.current;
    if (notInCatalog.length && vm) {
      setStage(`Looking up ${notInCatalog.length} SKU${notInCatalog.length === 1 ? '' : 's'} in vendor catalogs…`);
      const hits = await Promise.all(notInCatalog.map(async (r) => {
        try { const { results } = await searchVendorCatalogs(r.sku, { vendorMap: vm }); const st = results.find((s) => String(s.sku).toUpperCase() === r.sku.toUpperCase()) || results[0] || null; return { r, st }; }
        catch (_) { return { r, st: null }; }
      }));
      const upsertById = new Map(); // dedupe imported color rows across all found styles
      const reps = []; // { r, id } — the representative color for each resolved style
      hits.forEach(({ r, st }) => {
        const prodRows = st ? (st.colors || []).map((c) => vendorColorToProductRow(st, c)).filter((p) => p && p.id) : [];
        if (!prodRows.length) { notfound.push(r.sku); return; }
        prodRows.forEach((p) => { if (!upsertById.has(p.id)) upsertById.set(p.id, p); });
        reps.push({ r, id: prodRows[0].id }); viaVendor += 1;
      });
      if (upsertById.size) {
        const { data, error } = await supabase.from('products').upsert([...upsertById.values()], { onConflict: 'id' }).select('id,sku,name,color,retail_price,image_front_url');
        if (error) { reps.forEach(({ r }) => notfound.push(r.sku)); viaVendor = 0; }
        else { const ins = new Map((data || []).map((p) => [p.id, p])); reps.forEach(({ r, id }) => { const p = ins.get(id) || upsertById.get(id); if (p) matched.push({ product: p, meta: metaOf(r) }); }); }
      }
      setStage('');
    } else if (notInCatalog.length) {
      notInCatalog.forEach((r) => notfound.push(r.sku));
    }

    if (!matched.length) { setErr('None of those SKUs matched the catalog or any vendor.' + (notfound.length ? ` Not found: ${notfound.slice(0, 8).join(', ')}${notfound.length > 8 ? '…' : ''}` : '')); setBusy(false); setStage(''); return; }
    const built = await buildStyleRows(matched);
    setRows(built);
    setIssues({ notfound, dupRows, matched: matched.length, viaVendor });
    setBusy(false); setStage('');
  };

  const rawFromSheet = (data, type) => { const wb = XLSX.read(data, { type }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); };

  const parseFile = async (file) => {
    if (!file) return;
    setErr(''); setDone(null); setBusy(true); setStage(''); setFileName(file.name); setRows([]); setIssues(null);
    try { const buf = await file.arrayBuffer(); await processRaw(rawFromSheet(buf, 'array')); }
    catch (e) { setErr('Could not read that file: ' + (e.message || e)); setRows([]); setBusy(false); setStage(''); }
  };

  const importLink = async () => {
    const url = link.trim();
    if (!url) return;
    if (!/docs\.google\.com|spreadsheets/i.test(url)) { setErr('Paste a Google Sheets share link (docs.google.com/spreadsheets/…).'); return; }
    setErr(''); setDone(null); setBusy(true); setStage('Reading the sheet…'); setFileName(''); setRows([]); setIssues(null);
    try {
      const res = await fetch('/.netlify/functions/sheet-fetch?url=' + encodeURIComponent(url));
      const text = await res.text();
      if (!res.ok) { setErr(text || 'Could not read that sheet.'); setBusy(false); setStage(''); return; }
      setFileName('Google Sheet'); setStage('');
      await processRaw(rawFromSheet(text, 'string'));
    } catch (e) { setErr('Could not read that sheet: ' + (e.message || e)); setBusy(false); setStage(''); }
  };

  const setMeta = (ri, patch) => setRows((rs) => rs.map((r, i) => (i === ri ? { ...r, meta: { ...r.meta, ...patch } } : r)));
  const totalPicked = rowsTotalPicked(rows, existingPids);
  const stylesIn = rows.filter((r) => rowItemIn(r, existingPids)).length;
  const setAllItems = (on) => setRows((rs) => rs.map((r) => ({ ...r, picked: on ? new Set([...(r.defaults && r.defaults.size ? r.defaults : new Set(r.colors.map((c) => c.id)))].filter((id) => !existingPids.has(id))) : new Set() })));

  const doImport = async () => {
    if (!totalPicked || !onApplyColors) return;
    setAdding(true);
    const res = await onApplyColors(rowsToPlan(rows, null));
    setAdding(false);
    if (res && !res.error) setDone({ added: res.added || 0 });
  };

  // Blank fundraising follows the store rule at checkout — say which rule that is.
  const fundHint = storeFund?.enabled ? (Number(storeFund.pct) ? `${storeFund.pct}% rule` : Number(storeFund.flat) ? `${money(storeFund.flat)} rule` : 'store rule') : 'none';

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 860, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Import a product list</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '20px 10px' }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Imported {done.added} item{done.added === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 13, color: '#6A7180', marginBottom: 16 }}>They're in the catalog{done.added ? ' — next, put your logo on them' : ''}.</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                {onGoToArt && done.added > 0 && <button className="btn btn-primary" onClick={() => { onClose(); onGoToArt(); }}>🎨 Place artwork →</button>}
                <button className={onGoToArt && done.added > 0 ? 'btn btn-secondary' : 'btn btn-primary'} onClick={onClose}>Done</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>
                Paste a <b>Google Sheets link</b> or drop an <b>Excel / CSV</b> file. Only a <b>SKU</b> column is required — price and fundraising are optional (blank price uses each color's list price, blank fundraising follows the store rule{storeFund?.enabled ? ` — ${fundHint}` : ''}). SKUs not in the catalog are looked up live in the vendor catalogs.
                <button type="button" onClick={downloadTemplate} style={{ marginLeft: 6, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}>Download template ↓</button>
              </div>

              {/* Primary: paste a Google Sheets link */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') importLink(); }} disabled={busy} placeholder="Paste a Google Sheets link (share it as “Anyone with the link”)" style={{ flex: 1, fontSize: 13, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none' }} />
                <button className="btn btn-primary" onClick={importLink} disabled={busy || !link.trim()} style={{ opacity: (busy || !link.trim()) ? 0.5 : 1 }}>Load</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 10px', color: '#94a3b8', fontSize: 11, fontWeight: 700 }}><div style={{ flex: 1, height: 1, background: '#eef0f3' }} />OR<div style={{ flex: 1, height: 1, background: '#eef0f3' }} /></div>

              {/* Secondary: drop / browse a file */}
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!over) setOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); parseFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current && fileRef.current.click()}
                style={{ border: `1.5px dashed ${over ? '#2563eb' : '#cbd5e1'}`, borderRadius: 12, padding: rows.length ? '10px 14px' : '18px 16px', textAlign: 'center', background: over ? '#eff4ff' : '#fafbfc', cursor: 'pointer' }}>
                <div style={{ fontWeight: 700, color: '#3A4150', fontSize: rows.length ? 12.5 : 13.5 }}>{busy ? (stage || 'Reading…') : fileName ? `${fileName} — drop another to replace` : 'Drop an Excel / CSV file here, or click to browse'}</div>
                {!rows.length && !busy && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>.xlsx · .xls · .csv</div>}
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={(e) => { parseFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </div>

              {busy && stage && <div style={{ fontSize: 12, color: '#4f46e5', fontWeight: 700, marginTop: 8 }}>⏳ {stage}</div>}
              {err && <div style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600, marginTop: 10 }}>{err}</div>}

              {rows.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                    <span style={{ color: '#166534' }}>{stylesIn} style{stylesIn === 1 ? '' : 's'} · {totalPicked} color{totalPicked === 1 ? '' : 's'} to add</span>
                    {issues?.viaVendor ? <span style={{ color: '#3730a3' }} title="Found live in the vendor catalogs and imported">{issues.viaVendor} via vendor lookup</span> : null}
                    {issues?.dupRows ? <span style={{ color: '#92400e' }}>{issues.dupRows} duplicate row{issues.dupRows === 1 ? '' : 's'} skipped</span> : null}
                    {issues?.notfound?.length ? <span style={{ color: '#b91c1c' }} title={issues.notfound.join(', ')}>{issues.notfound.length} not found: {issues.notfound.slice(0, 5).join(', ')}{issues.notfound.length > 5 ? '…' : ''}</span> : null}
                    <span style={{ marginLeft: 'auto' }} />
                    <button type="button" onClick={() => setAllItems(true)} style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer' }}>Select all</button>
                    <button type="button" onClick={() => setAllItems(false)} style={{ fontSize: 12, fontWeight: 700, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>
                  </div>
                  <div style={{ maxHeight: '48vh', overflowY: 'auto', paddingRight: 2 }}>
                    <StyleColorRows rows={rows} setRows={setRows} existingPids={existingPids} renderRowExtra={(r, ri) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>$
                          <input type="number" step="0.01" min="0" value={r.meta.price ?? ''} onChange={(e) => setMeta(ri, { price: e.target.value })} placeholder="auto" title="Selling price for every color of this style — blank uses each color's list price" style={{ width: 64, marginLeft: 3, fontSize: 12, padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: 6 }} />
                        </label>
                        <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>FR
                          <input type="number" step="0.01" min="0" value={r.meta.fundraise || ''} onChange={(e) => setMeta(ri, { fundraise: e.target.value })} placeholder={storeFund?.enabled ? fundHint : '0'} title={storeFund?.enabled ? `Per-item fundraising — blank follows the store rule (${fundHint}) at checkout` : 'Per-item fundraising dollars'} style={{ width: 62, marginLeft: 3, fontSize: 12, padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: 6 }} />
                        </label>
                      </span>
                    )} />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="btn btn-primary" disabled={!totalPicked || adding} onClick={doImport} style={{ opacity: (!totalPicked || adding) ? 0.5 : 1 }}>{adding ? 'Adding…' : `Add ${totalPicked} item${totalPicked === 1 ? '' : 's'} to store`}</button>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Catalog product picker — live-look card grid for adding items to a store ──
// Same visual language as the public catalog (/adidas live-look): a search box,
// brand/category quick-filter pills, and a responsive card grid. Picking a card
// hands off to SinglePriceEditor (price / fundraising / personalization),
// unchanged. State is a simple "filter spec" ({ q, brand, category }) so the
// future AI-brief and customer self-serve flows can drive the same engine.
// Who may edit the shared/curated "TEAM" favorites that show first for everyone. Personal
// favorites are open to any signed-in rep; only these emails can curate the shared list.
const FAV_CURATORS = ['smpeterson327@gmail.com'];

// Live vendor-catalog lookup. Searches SanMar/District, S&S, Richardson and Momentec APIs
// for any style (even ones not in the local catalog), then imports the picked colorways into
// `products` so they can be dropped into a store. Returns the imported product rows.
function VendorSearchModal({ initialQuery = '', destLabel = 'store', onAdd, onClose }) {
  const [q, setQ] = useState(initialQuery || '');
  const [loading, setLoading] = useState(false);
  const [styles, setStyles] = useState([]);
  const [errors, setErrors] = useState({});
  const [ran, setRan] = useState(false);
  const [selected, setSelected] = useState(() => new Map()); // key -> { style, color }
  const [importing, setImporting] = useState(false);
  // Real vendor ids from the DB — products.vendor_id has a FK to vendors, so imports must use
  // a valid id (or null). Map api_provider → id.
  const [vendorMap, setVendorMap] = useState(null);
  useEffect(() => { (async () => { const { data } = await supabase.from('vendors').select('id,api_provider,name'); const m = {}; (data || []).forEach((v) => { if (v.api_provider) m[v.api_provider] = v.id; }); setVendorMap(m); })(); }, []);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || vendorMap == null) { setStyles([]); setRan(false); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try { const { results, errors } = await searchVendorCatalogs(query, { vendorMap }); if (!cancelled) { setStyles(results); setErrors(errors || {}); } }
      catch (e) { if (!cancelled) { setStyles([]); setErrors({ Search: String(e?.message || e) }); } }
      finally { if (!cancelled) { setLoading(false); setRan(true); } }
    }, 550);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, vendorMap]);
  const SRC = { sm: 'SanMar', ss: 'S&S', rs: 'Richardson', mt: 'Momentec' };
  const keyOf = (s, c) => `${s.source}:${s.sku}:${c.colorName}`;
  const toggle = (s, c) => setSelected((prev) => { const m = new Map(prev); const k = keyOf(s, c); m.has(k) ? m.delete(k) : m.set(k, { style: s, color: c }); return m; });
  const add = async () => {
    if (!selected.size) return;
    setImporting(true);
    const rows = [...selected.values()].map(({ style, color }) => vendorColorToProductRow(style, color));
    const { data, error } = await supabase.from('products').upsert(rows, { onConflict: 'id' }).select('id,sku,name,brand,color,category,retail_price,nsa_cost,available_sizes,image_front_url');
    setImporting(false);
    if (error) { alert('Could not import from vendor: ' + error.message); return; }
    onAdd((data && data.length ? data : rows));
    onClose();
  };
  const errList = Object.entries(errors || {});
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 800, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>Search live vendor catalogs</div><div style={{ fontSize: 11.5, color: '#64748b' }}>SanMar / District · S&amp;S Activewear · Richardson · Momentec. Picked items are imported so they can go into a {destLabel}.</div></div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <input className="form-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Style number or name — e.g. DM130, PC61, 112, C2 Tee" style={{ width: '100%', marginBottom: 12 }} />
          {errList.length > 0 && <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 8 }}>Couldn't reach: {errList.map(([v]) => v).join(', ')}.</div>}
          <div style={{ maxHeight: '54vh', overflowY: 'auto' }}>
            {loading ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 16, textAlign: 'center' }}>Searching vendor catalogs…</div>
              : q.trim().length < 2 ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 16, textAlign: 'center' }}>Type a style number or name to search.</div>
              : styles.length === 0 ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 16, textAlign: 'center' }}>{ran ? 'No vendor styles matched. Try the exact style number (e.g. DM130).' : ''}</div>
              : styles.map((s) => (
                <div key={s.source + s.sku} style={{ border: '1px solid #e8ebf0', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    {s.image ? <img src={s.image} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6, border: '1px solid #eef2f7', background: '#fff' }} /> : null}
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: '#191919' }}>{s.name}</div><div style={{ fontSize: 11, color: '#64748b' }}>{s.sku} · {s.colors.length} color{s.colors.length === 1 ? '' : 's'}</div></div>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: '#3730a3', background: '#eef2ff', borderRadius: 5, padding: '2px 7px' }}>{SRC[s.source] || s.source}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {s.colors.map((c) => { const on = selected.has(keyOf(s, c)); return (
                      <button key={c.colorName || c.sku} type="button" onClick={() => toggle(s, c)} title={c.colorName} style={{ position: 'relative', width: 84, border: '2px solid ' + (on ? '#191919' : '#e2e8f0'), background: '#fff', borderRadius: 9, padding: 4, cursor: 'pointer' }}>
                        <div style={{ width: '100%', height: 64, borderRadius: 5, overflow: 'hidden', background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.image ? <img src={c.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 8, color: '#cbd5e1', fontWeight: 700, padding: 2, textAlign: 'center' }}>{(c.colorName || '').slice(0, 14)}</span>}</div>
                        <div style={{ fontSize: 9.5, color: on ? '#191919' : '#64748b', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.colorName || '—'}</div>
                        <div style={{ fontSize: 9, color: '#94a3b8' }}>{c.cost > 0 ? money(c.cost) : ''}{c.sizes?.length ? ` · ${c.sizes.length} sz` : ''}</div>
                        {on && <div style={{ position: 'absolute', top: -7, right: -7, background: '#191919', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, lineHeight: '18px', fontWeight: 800, textAlign: 'center' }}>✓</div>}
                      </button>
                    ); })}
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid #eef0f3' }}>
          <button className="btn btn-primary" disabled={importing || !selected.size} onClick={add}>{importing ? 'Importing…' : `Add ${selected.size} to ${destLabel}`}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <span style={{ fontSize: 11.5, color: '#9AA1AC', marginLeft: 'auto' }}>Imported at ~50% margin — reprice after.</span>
        </div>
      </div>
    </div>
  );
}

function ProductPicker({ label, onPick, onPickMany, onClose, storeColors = [], storeFund = {}, library = [], catalog = [], standardCategories = [], onSaveLogo, initialFilter = {}, destLabel = 'store', initialInStock = true }) {
  // Section options for the bulk-add category dropdown: the store's own sections plus the
  // global standard categories (Store defaults). First one is the default selection.
  const storeSections = useMemo(() => [...new Set([...(catalog || []).map((c) => c.category), ...(standardCategories || [])].filter(Boolean))].sort(), [catalog, standardCategories]);
  const [q, setQ] = useState(initialFilter.q || '');
  const [brandSel, setBrandSel] = useState(initialFilter.brand || null);
  const [catSel, setCatSel] = useState(initialFilter.category || null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(300);
  const [inStockOnly, setInStockOnly] = useState(initialInStock); // school stores default to fulfillable; templates don't
  const colorWords = useMemo(() => storeColorWords(storeColors), [storeColors]);
  const [colorOnly, setColorOnly] = useState(colorWords.length > 0); // default to the school's colors
  useEffect(() => { setColorOnly(colorWords.length > 0); }, [colorWords.length]);
  const [colorSel, setColorSel] = useState(() => new Set()); // color-family filter (e.g. {navy, red})
  const toggleColorFam = (f) => setColorSel((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [bulkDecos, setBulkDecos] = useState([]);
  // Shared "item setup" applied to every selected product when bulk-adding.
  const [bulkTab, setBulkTab] = useState('setup');
  const [bPrice, setBPrice] = useState('');
  const [bFund, setBFund] = useState('');
  const [bNumber, setBNumber] = useState(false);
  const [bName, setBName] = useState(false);
  const [bNameUp, setBNameUp] = useState('');
  const [bCategory, setBCategory] = useState('');
  const [bCatNew, setBCatNew] = useState(false); // typing a brand-new section vs picking one
  const [bKit, setBKit] = useState('');
  const [bRequired, setBRequired] = useState(false);
  const [bOptions, setBOptions] = useState([]);
  // Favorites — each rep stars products (rep_email = me); a shared/curated list (rep_email
  // = 'TEAM') shows for everyone. Favorites sort first in every category and can be filtered to.
  const [myEmail, setMyEmail] = useState('');
  // Favorites are STYLE-level: keyed by product name so starring one color stars the style
  // (all colorways). Maps are lower(name) -> original name (original kept for the fetch).
  const [favMine, setFavMine] = useState(() => new Map());
  const [favTeam, setFavTeam] = useState(() => new Map());
  const [favOnly, setFavOnly] = useState(false);   // show only favorites
  const [curate, setCurate] = useState(false);     // star toggles the shared TEAM list
  const favUnion = useMemo(() => new Set([...favMine.keys(), ...favTeam.keys()]), [favMine, favTeam]); // lower style keys
  const favNames = useMemo(() => [...new Set([...favMine.values(), ...favTeam.values()])], [favMine, favTeam]); // original names, for fetch
  const favStyleKey = (p) => String(p?.name || p?.sku || '').trim().toLowerCase();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let email = '';
      try { const { data } = await supabase.auth.getUser(); email = data?.user?.email || ''; } catch (e) { /* not signed in */ }
      if (cancelled) return;
      setMyEmail(email);
      const { data: favs } = await supabase.from('rep_product_favorites').select('rep_email,style_key').in('rep_email', [email || '__none__', 'TEAM']);
      if (cancelled) return;
      const mine = new Map(), team = new Map();
      (favs || []).forEach((f) => { const name = f.style_key; if (!name) return; (f.rep_email === 'TEAM' ? team : mine).set(name.trim().toLowerCase(), name); });
      setFavMine(mine); setFavTeam(team);
    })();
    return () => { cancelled = true; };
  }, []);
  const toggleFav = async (p) => {
    const owner = curate ? 'TEAM' : myEmail;
    const name = p?.name || p?.sku; if (!owner || !name) return;
    const key = name.trim().toLowerCase();
    const map = curate ? favTeam : favMine;
    const setter = curate ? setFavTeam : setFavMine;
    const has = map.has(key);
    const next = new Map(map); has ? next.delete(key) : next.set(key, name); setter(next); // optimistic
    if (has) await supabase.from('rep_product_favorites').delete().eq('rep_email', owner).eq('style_key', name);
    else await supabase.from('rep_product_favorites').insert({ rep_email: owner, style_key: name, product_id: p.id || null });
  };
  const BROWSE_CATS = ['Tees', '1/4 Zips', 'Hoods', 'Crew', 'Polos', 'Shorts', 'Pants', 'Outerwear', 'Jersey', 'Hats', 'Bags', 'Socks', 'Footwear', 'Accessories'];
  // A pill maps to one or more real DB category values (the catalog has singular/plural
  // and split variants), so "Hoods" also catches "Hood", "Jersey" catches the tops/bottoms, etc.
  const CAT_MAP = { 'Hoods': ['Hoods', 'Hood'], 'Jersey': ['Jersey', 'Jerseys', 'Jersey Tops', 'Jersey Bottoms'], 'Accessories': ['Accessories', 'Sport Accessories'] };

  // Load when there's a search OR a chosen category/brand — so a rep can browse by
  // filter without typing. No filter + no query shows the browse prompt.
  const active = q.trim().length >= 2 || !!brandSel || !!catSel || favOnly;
  useEffect(() => {
    if (!active) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const typed = q.trim();
      let rows = null;
      // Typed search → fast server-side trigram RPC (same one the order editor uses). It
      // covers the whole catalog including every vendor brand (SanMar/District, S&S,
      // Richardson, Momentec, …), so name/SKU searches resolve instantly instead of a slow
      // client-side ilike scan. Browse-by-category/brand and favorites keep the table query.
      if (!favOnly && typed.length >= 2) {
        try {
          const { data, error } = await supabase.rpc('search_products', { p_query: typed, p_category: null, p_vendor_id: null, p_color_category: null, p_in_stock: false, p_limit: limit, p_offset: 0 });
          if (error) throw error;
          rows = (data || []).filter((r) => (r.is_active == null || r.is_active === true) && !r.is_archived);
          // SKU matches are PREFIX-only — searching "112" returns Richardson 112, not IF9112
          // or JM5112 where "112" sits mid-SKU. Names still match on all tokens anywhere.
          { const ql = typed.toLowerCase(); const toks = ql.split(/\s+/).filter(Boolean); rows = rows.filter((r) => { const sku = String(r.sku || '').toLowerCase(); const name = String(r.name || '').toLowerCase(); return sku.startsWith(ql) || (toks.length && toks.every((tk) => name.includes(tk))); }); }
          if (brandSel) rows = rows.filter((r) => r.brand === brandSel);
          if (catSel) { const cats = CAT_MAP[catSel] || [catSel]; rows = rows.filter((r) => cats.includes(r.category)); }
        } catch (e) { rows = null; /* fall through to the table query */ }
      }
      if (rows == null) {
        // Hide retired products (archived) so the store builder can't add what the catalog
        // live-look already hides, while still including legacy rows whose is_active is null.
        let query = supabase.from('products').select('id,sku,name,brand,color,category,retail_price,nsa_cost,available_sizes,image_front_url')
          .or('is_active.is.null,is_active.eq.true').or('is_archived.is.null,is_archived.eq.false');
        if (favOnly) {
          // Favorites view — load every colorway of each starred STYLE (across all categories)
          // so the rep's + team's picks always show, regardless of color/stock filters.
          if (!favNames.length) { if (!cancelled) { setResults([]); setSearching(false); } return; }
          query = query.in('name', favNames);
          if (typed.length >= 2) query = query.or(`name.ilike.%${q}%,sku.ilike.${q}%`);
          if (brandSel) query = query.eq('brand', brandSel);
          if (catSel) query = query.in('category', CAT_MAP[catSel] || [catSel]);
        } else {
          if (typed.length >= 2) query = query.or(`name.ilike.%${q}%,sku.ilike.${q}%`);
          if (brandSel) query = query.eq('brand', brandSel);
          if (catSel) query = query.in('category', CAT_MAP[catSel] || [catSel]);
          // Narrow to the school's colors in the QUERY (not just client-side) so a 3k-item
          // category like Tees doesn't bury the school's colors past the row limit.
          // School colors only narrow when BROWSING; a typed search overrides them so a
          // specific SKU/name is found regardless of color (and skips ~15 color ilikes).
          if (colorOnly && colorWords.length && typed.length < 2) query = query.or(colorWords.map((w) => `color.ilike.%${w}%`).join(','));
        }
        const { data } = await query.order('name').order('color').limit(favOnly ? 500 : limit);
        rows = data || [];
      }
      const stock = await fetchStockMap(rows);
      for (const r of rows) r._stock = stock.get(r.id) || { units: 0, sizes: [], sizeStock: {}, incoming: false };
      if (!cancelled) { setResults(rows); setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // favOnly toggling refetches; toggling individual stars updates the grid client-side.
  }, [q, brandSel, catSel, limit, active, colorOnly, colorWords, favOnly]);

  const brands = [...new Set(results.map((r) => r.brand).filter(Boolean))].sort();
  // "In stock" means a real size run, not 1–2 stragglers: for S/M/L/XL apparel, require
  // all of S–XL on hand; items on another scale (hats, bags, OSFA) just need any stock.
  const APPAREL = ['S', 'M', 'L', 'XL'];
  const wellStocked = (r) => {
    const st = r._stock || {};
    const avail = (Array.isArray(r.available_sizes) ? r.available_sizes : []).map(String);
    if (!APPAREL.some((s) => avail.includes(s))) return (st.units || 0) > 0;
    const inSt = new Set((st.sizes || []).map(String));
    return APPAREL.every((s) => inSt.has(s));
  };
  const isSearch = q.trim().length >= 2;
  // Map a catalog color string to a color FAMILY (by its primary segment) for the color filter.
  const famOf = (color) => { const primary = String(color || '').split(/[/,|]| - /)[0].toLowerCase(); for (const f of _COLOR_FAMILIES) { if (f.words.some((w) => primary.includes(w))) return f.fam; } return null; };
  const matched = results.filter((r) =>
    (isSearch || !colorOnly || productMatchesColors(r.color, colorWords)) &&
    (!colorSel.size || colorSel.has(famOf(r.color))) &&
    // The catalog tags some jerseys as Tees — keep the Tees view to actual tees.
    !(catSel === 'Tees' && /jersey/i.test(r.name || '')));
  // Color families present in the loaded results — drives the color filter pills.
  const colorFams = [...new Set(results.map((r) => famOf(r.color)).filter(Boolean))].sort();
  // Collapse colorways → one card per STYLE (name), so the grid isn't the same short in six
  // colors. The rep prefers an image + in-stock; other colorways are added later from the
  // item editor's "Other colors of this garment".
  const styleKey = (r) => (r.name || r.sku || r.id || '').trim().toLowerCase();
  // Pick the colorway that fronts a style's card: a favorited one first, then the
  // school's own colors (so a navy school sees the navy hood, not the green one), then
  // image, then stock. Shared by the rep dedupe and the on-card color swatches.
  const repScore = (x) => (favUnion.has(favStyleKey(x)) ? 16 : 0) + (productMatchesColors(x.color, colorWords) ? 8 : 0) + (x.image_front_url ? 2 : 0) + (wellStocked(x) ? 1 : 0);
  const dedupeByStyle = (rows) => {
    const map = new Map();
    for (const r of rows) { const k = styleKey(r); const cur = map.get(k); if (!cur || repScore(r) > repScore(cur)) map.set(k, r); }
    return [...map.values()];
  };
  let styles = dedupeByStyle(inStockOnly ? matched.filter(wellStocked) : matched);
  if (favOnly) styles = styles.filter((p) => favUnion.has(favStyleKey(p)));
  // Favorites first (stable within each group), then everything else.
  styles = [...styles.filter((p) => favUnion.has(favStyleKey(p))), ...styles.filter((p) => !favUnion.has(favStyleKey(p)))];
  const allStyleN = new Set(matched.map(styleKey)).size;
  const inStockStyleN = new Set(matched.filter(wellStocked).map(styleKey)).size;
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // All sellable colorways per style (one entry per color, best image/stock kept), so a
  // card can offer color swatches inline — the rep no longer has to "add later" to swap
  // a green hood for the navy one. Sorted school-color-first to match the card's default.
  const swatchPool = inStockOnly ? matched.filter(wellStocked) : matched;
  const colorwaysByStyle = (() => {
    const m = new Map();
    for (const r of swatchPool) { const k = styleKey(r); if (!m.has(k)) m.set(k, new Map()); const byColor = m.get(k); const ck = (r.color || '').trim().toLowerCase() || ('sku:' + (r.sku || '').toLowerCase()); const cur = byColor.get(ck); if (!cur || repScore(r) > repScore(cur)) byColor.set(ck, r); }
    const out = new Map();
    for (const [k, byColor] of m) out.set(k, [...byColor.values()].sort((a, b) => repScore(b) - repScore(a) || String(a.color || '').localeCompare(String(b.color || ''))));
    return out;
  })();
  // Resolve any selected id (rep OR a swatch-picked colorway) to its product row.
  const rowById = new Map(swatchPool.map((r) => [r.id, r]));
  const selProducts = [...selected].map((id) => rowById.get(id)).filter(Boolean);

  const togBtn = (on, onClick, children, c = '#166534', bg = '#dcfce7') => (
    <button type="button" onClick={onClick} aria-pressed={on} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', borderRadius: 999, padding: '4px 13px 4px 8px', fontSize: 12.5, fontWeight: 700, border: '1px solid ' + (on ? c : '#d1d5db'), background: on ? bg : '#fff', color: on ? c : '#3A4150' }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', background: on ? c : '#cbd5e1' }}>{on ? '✓' : ''}</span>{children}
    </button>
  );

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      {vendorOpen && <VendorSearchModal initialQuery={q} destLabel={destLabel} onClose={() => setVendorOpen(false)} onAdd={(rows) => { if (onPickMany && rows && rows.length) onPickMany(rows, [], {}); }} />}
      <CatalogKitStyles />
      <KitScope style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.01em' }}>{label || 'Add products'}</div>
          {onClose && <button className="ai-iconbtn" onClick={onClose} aria-label="Close picker">✕ Close</button>}
        </div>

        <input className="ai-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or SKU — or pick a category below to browse…" aria-label="Search products" />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12, alignItems: 'center' }}>
          {BROWSE_CATS.map((c) => <FilterBtn key={c} on={catSel === c} onClick={() => setCatSel(catSel === c ? null : c)}>{c}</FilterBtn>)}
          <button type="button" onClick={() => setVendorOpen(true)} title="Look up any style from SanMar, S&S, Richardson or Momentec — even if it's not in the catalog yet" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 999, padding: '5px 12px', cursor: 'pointer' }}>🔎 Search vendor catalogs</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
          {togBtn(favOnly, () => setFavOnly((v) => !v), `★ Favorites${favUnion.size ? ' (' + favUnion.size + ')' : ''}`, '#b45309', '#fef3c7')}
          {FAV_CURATORS.includes((myEmail || '').toLowerCase()) && togBtn(curate, () => setCurate((v) => !v), 'Curate shared list', '#7c3aed', '#ede9fe')}
          {curate && <span style={{ fontSize: 11.5, color: '#7c3aed', fontWeight: 700 }}>Starring now edits the shared list everyone sees</span>}
          {!myEmail && <span style={{ fontSize: 11.5, color: '#9AA1AC' }}>Sign in to save favorites</span>}
        </div>

        {active && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {togBtn(inStockOnly, () => setInStockOnly((v) => !v), 'In stock only')}
            {colorWords.length > 0 && togBtn(colorOnly, () => setColorOnly((v) => !v), 'School colors', '#1d4ed8', '#dbeafe')}
            <span style={{ fontSize: 11.5, color: '#9AA1AC' }}>{inStockStyleN} of {allStyleN} styles in stock</span>
            {brands.length > 1 && <span style={{ width: 1, alignSelf: 'stretch', background: '#E2E5EA', margin: '0 2px' }} />}
            {brands.length > 1 && brands.map((b) => <FilterBtn key={'b-' + b} on={brandSel === b} onClick={() => setBrandSel(brandSel === b ? null : b)}>{b}</FilterBtn>)}
          </div>
        )}
        {active && colorFams.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3, marginRight: 2 }}>Color</span>
            {colorFams.map((f) => { const on = colorSel.has(f); return (
              <button key={f} type="button" onClick={() => toggleColorFam(f)} aria-pressed={on} title={`Show ${f} items`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', borderRadius: 999, padding: '4px 11px 4px 7px', fontSize: 12, fontWeight: 700, textTransform: 'capitalize', border: '1px solid ' + (on ? '#2563eb' : '#d1d5db'), background: on ? '#eff6ff' : '#fff', color: on ? '#1d4ed8' : '#3A4150' }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: colorNameToHex(f), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)' }} />{f}
              </button>
            ); })}
            {colorSel.size > 0 && <button type="button" onClick={() => setColorSel(new Set())} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>Clear</button>}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {!active && (
            <div style={{ textAlign: 'center', color: '#9AA1AC', fontSize: 14, padding: '34px 10px', fontWeight: 600 }}>
              Pick a category above, or search by name/SKU, to browse what's available.
            </div>
          )}
          {active && searching && results.length === 0 && (
            <div style={{ color: '#9AA1AC', fontSize: 13, padding: 8 }}>Searching…</div>
          )}
          {active && !searching && styles.length === 0 && (
            <div style={{ color: '#9AA1AC', fontSize: 13, padding: 8 }}>
              {favOnly && favUnion.size === 0
                ? 'No favorites yet — tap the ☆ on any product to save it here (your picks + the shared list show first in every category).'
                : matched.length > 0 && inStockOnly
                ? 'No in-stock matches — turn off "In stock only" to see more.'
                : colorOnly && colorWords.length
                  ? 'No matches in the school colors — turn off "School colors" to see all.'
                  : 'No matches. Try another category or search.'}
            </div>
          )}
          {styles.length > 0 && (
            <div className="ai-grid">
              {styles.map((p) => <PickerCard key={p.id} p={p} colorways={colorwaysByStyle.get(styleKey(p)) || [p]} selectedIds={selected} onToggleId={toggleSel} schoolWords={colorWords} fav={favUnion.has(favStyleKey(p))} team={favTeam.has(favStyleKey(p))} canFav={!!myEmail} curate={curate} onToggleFav={() => toggleFav(p)} onColors={onPick ? (row) => onPick(row || p) : null} />)}
            </div>
          )}
          {active && !searching && results.length >= limit && (
            <ShowMore onClick={() => setLimit((n) => n + 200)}>Show more results</ShowMore>
          )}
        </div>
      </KitScope>
      {selProducts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 60, background: 'rgba(255,255,255,.98)', backdropFilter: 'blur(6px)', border: '1px solid #d7e0ee', boxShadow: '0 10px 30px rgba(15,26,56,.22)', padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderRadius: 999 }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>{selProducts.length} selected</span>
          <button className="btn btn-primary" onClick={() => { setBulkDecos([]); setBulkTab('setup'); setBCategory((c) => c || storeSections[0] || ''); setBCatNew(storeSections.length === 0); setBPrice((p) => p || (selProducts.length === 1 ? String(selProducts[0].retail_price ?? '') : '')); setBulkOpen(true); }}>Add {selProducts.length} to {destLabel} →</button>
          <button className="btn btn-secondary" onClick={() => setSelected(new Set())}>Clear</button>
          <span style={{ fontSize: 11.5, color: '#9AA1AC' }}>Adds at list price — tweak fundraising / personalization per item after.</span>
        </div>
      )}
      {bulkOpen && (
        <div onClick={() => setBulkOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 760, margin: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Add {selProducts.length} item{selProducts.length === 1 ? '' : 's'} to the {destLabel}</div>
              <button onClick={() => setBulkOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '2px solid #e5e8ec' }}>
                {(destLabel === 'template' ? [['setup', 'Item setup']] : [['setup', '1 · Item setup'], ['art', '2 · Art & logo']]).map(([k, lbl]) => { const on = bulkTab === k; return (
                  <button key={k} type="button" onClick={() => setBulkTab(k)} style={{ background: 'none', border: 'none', borderBottom: '3px solid ' + (on ? '#191919' : 'transparent'), color: on ? '#191919' : '#94a3b8', fontWeight: 800, fontSize: 13.5, padding: '8px 14px', marginBottom: -2, cursor: 'pointer' }}>{lbl}</button>
                ); })}
              </div>

              {bulkTab === 'setup' && (
                <div>
                  <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>Applied to all <b>{selProducts.length}</b> items. Fine-tune sizes &amp; transfers per item afterward.</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                    <Row label="Price each (blank = list price)"><input className="form-input" type="number" step="0.01" value={bPrice} onChange={(e) => setBPrice(e.target.value)} placeholder="list" style={{ width: 160 }} /></Row>
                    <Row label="Fundraising on top"><input className="form-input" type="number" step="0.01" value={bFund} onChange={(e) => setBFund(e.target.value)} placeholder="0.00" style={{ width: 150 }} /></Row>
                  </div>
                  {storeFund?.enabled && Number(bFund) <= 0 && (
                    <div style={{ fontSize: 11.5, color: '#166534', marginTop: -4, marginBottom: 12 }}>Leave fundraising blank and the store rule applies — adds {Number(storeFund.flat) > 0 ? money(storeFund.flat) : (storeFund.pct || 0) + '%'}{storeFund.round ? ', rounded up' : ''} per item.</div>
                  )}
                  {/* Live cost / margin readout when a single item is being added. */}
                  {selProducts.length === 1 && (() => {
                    const sp = selProducts[0];
                    const list = Number(sp.retail_price) || 0;
                    const cost = Number(sp.nsa_cost) || 0;
                    const price = (bPrice !== '' && bPrice != null) ? Number(bPrice) : list;
                    const fund = (bFund !== '' && bFund != null && Number(bFund) > 0) ? Number(bFund) : storeFundAmount(price, storeFund);
                    const decoCost = bulkDecos.length ? 5 : 0;
                    const margin = price > 0 && cost > 0 ? Math.round((1 - (cost + decoCost) / price) * 100) : null;
                    return (
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, background: '#f8fafc', border: '1px solid #e8ebf0', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                        <span style={{ color: '#64748b' }}>List <b style={{ color: '#191919' }}>{money(list)}</b></span>
                        {cost > 0 && <span style={{ color: '#64748b' }}>Cost <b style={{ color: '#191919' }}>{money(cost)}</b></span>}
                        {decoCost > 0 && <span style={{ color: '#64748b' }}>Deco <b style={{ color: '#191919' }}>~{money(decoCost)}</b></span>}
                        <span style={{ color: '#64748b' }}>Shopper pays <b style={{ color: '#191919' }}>{money(price + fund)}</b>{fund > 0 ? <span style={{ color: '#94a3b8' }}> ({money(price)} + {money(fund)})</span> : null}</span>
                        {margin != null && <span style={{ color: margin >= 45 ? '#166534' : '#b45309', fontWeight: 800 }}>Margin {margin}%{decoCost ? ' after deco' : ''}</span>}
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                    <Toggle label="Player adds a number" checked={bNumber} onChange={setBNumber} />
                    <Toggle label="Player adds a name" checked={bName} onChange={setBName} />
                    {bName && <label style={{ fontSize: 13 }}>Name upcharge +$<input className="form-input" style={{ width: 80, display: 'inline-block', marginLeft: 4 }} type="number" step="0.01" min={0} value={bNameUp} onChange={(e) => setBNameUp(e.target.value)} /></label>}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
                    <Row label="Category / section">
                      {bCatNew || storeSections.length === 0
                        ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input className="form-input" autoFocus value={bCategory} onChange={(e) => setBCategory(e.target.value)} placeholder="New section name" style={{ width: 180 }} />
                            {storeSections.length > 0 && <button type="button" onClick={() => { setBCatNew(false); setBCategory(storeSections[0] || ''); }} style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>cancel</button>}
                          </div>
                        : <select className="form-input" value={bCategory} onChange={(e) => { if (e.target.value === '__new') { setBCatNew(true); setBCategory(''); } else setBCategory(e.target.value); }} style={{ width: 200 }}>
                            {storeSections.map((s) => <option key={s} value={s}>{s}</option>)}
                            <option value="__new">＋ New section…</option>
                          </select>}
                    </Row>
                    <Row label="Part of a kit / package"><input className="form-input" value={bKit} onChange={(e) => setBKit(e.target.value)} placeholder="e.g. Player Kit" /></Row>
                    <div style={{ paddingBottom: 6 }}><Toggle label="Mandatory" checked={bRequired} onChange={setBRequired} /></div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3, margin: '4px 0 6px' }}>Add-on options <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' }}>· shopper-selected extras</span></div>
                  <OptionsEditor value={bOptions} onChange={setBOptions} />
                </div>
              )}

              {bulkTab === 'art' && (
                <div>
                  <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 6 }}>Optionally place a logo — applied to <b>all {selProducts.length}</b> at the same spot. You can fine-tune any item afterward.</div>
                  <LogoPlacer imageUrl={selProducts[0] && selProducts[0].image_front_url} decorations={bulkDecos} onChange={setBulkDecos} library={library} storeColors={storeColors} onSaveLogo={onSaveLogo} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="btn btn-primary" onClick={() => { setBulkOpen(false); if (onPickMany) onPickMany(selProducts, bulkDecos, { price: bPrice, fundraise: bFund, takes_number: bNumber, takes_name: bName, name_upcharge: bNameUp, category: bCategory.trim(), kit_name: bKit.trim(), required: bRequired, options: cleanItemOptions(bOptions) }); }}>{bulkDecos.length ? `Add ${selProducts.length} with logo →` : `Add ${selProducts.length} to ${destLabel} →`}</button>
                {destLabel !== 'template' && (bulkTab === 'setup'
                  ? <button className="btn btn-secondary" onClick={() => setBulkTab('art')}>Next: Art &amp; logo →</button>
                  : <button className="btn btn-secondary" onClick={() => setBulkTab('setup')}>← Back to setup</button>)}
                <button className="btn btn-secondary" onClick={() => setBulkOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One catalog item, live-look card style. Click toggles selection (multi-select);
// Clicking the card (or "Colors →") opens the color-selector modal for the style.
function PickerCard({ p, colorways = [], selectedIds, onToggleId, schoolWords = [], fav = false, team = false, canFav = false, curate = false, onToggleFav, onColors }) {
  const [imgErr, setImgErr] = useState(false);
  const ways = colorways.length ? colorways : [p];
  // Which colorway the card is showing / will add. Defaults to the rep (ways[0] = the
  // school-color-preferred pick). Picking a swatch swaps the image, price, sizes & stock.
  const [activeId, setActiveId] = useState(null);
  const active = ways.find((c) => c.id === activeId) || p;
  const isSel = !!selectedIds && selectedIds.has(active.id);
  useEffect(() => { setImgErr(false); }, [active.id]);
  const st = active._stock || { units: 0, sizes: [], incoming: false };
  const out = (st.units || 0) <= 0;
  // Prefer the live in-stock sizes; fall back to the catalog's listed sizes.
  const sizes = st.sizes && st.sizes.length ? st.sizes : (Array.isArray(active.available_sizes) ? active.available_sizes : []);
  // Switch the shown color. If the old color was already selected, move the selection
  // to the newly-picked one so the basket follows what the rep is looking at.
  const pickColor = (c) => { if (c.id === active.id) return; if (isSel) { onToggleId(active.id); onToggleId(c.id); } setActiveId(c.id); };
  const toggle = () => onToggleId(active.id);
  return (
    <div className="ai-card" onClick={() => onColors && onColors(active)} role="button" title="See colors of this item" style={{ position: 'relative', cursor: 'pointer', outline: isSel ? '2px solid #2563eb' : 'none', outlineOffset: -1 }}>
      <div onClick={(e) => { e.stopPropagation(); toggle(); }} style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, width: 24, height: 24, borderRadius: 7, border: '2px solid ' + (isSel ? '#2563eb' : '#cbd5e1'), background: isSel ? '#2563eb' : 'rgba(255,255,255,.92)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800 }}>{isSel ? '✓' : ''}</div>
      {canFav && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleFav && onToggleFav(); }} title={fav ? (team ? 'Shared team favorite' : 'Your favorite') : (curate ? 'Add to the shared list' : 'Add to your favorites')}
          style={{ position: 'absolute', top: 8, left: 40, zIndex: 2, width: 26, height: 26, borderRadius: 7, border: 'none', background: 'rgba(255,255,255,.92)', cursor: 'pointer', fontSize: 16, lineHeight: '26px', padding: 0, color: fav ? '#f59e0b' : '#b6bcc6', boxShadow: '0 1px 3px rgba(0,0,0,.12)' }}>{fav ? '★' : '☆'}</button>
      )}
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4', width: '100%' }}>
        {active.image_front_url && !imgErr
          ? <img src={active.image_front_url} alt={active.name || ''} loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain', opacity: out ? 0.5 : 1 }} />
          : <div style={{ color: '#A8AEB8', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>No image</div>}
        {active.retail_price != null && (
          <span style={{ position: 'absolute', top: 10, right: 10, background: '#191919', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700 }}>{money(active.retail_price)}</span>
        )}
        {out && <span style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(185,28,28,.95)', color: '#fff', borderRadius: 5, padding: '2px 8px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' }}>{st.incoming ? 'Incoming' : 'Out of stock'}</span>}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, width: '100%' }}>
        <div>
          {active.brand && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{active.brand}</div>}
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, lineHeight: 1.15, textTransform: 'uppercase' }}>{active.name || active.sku}</div>
          {team && <span style={{ fontSize: 10, fontWeight: 800, color: '#7c3aed', background: '#ede9fe', borderRadius: 5, padding: '1px 6px', marginTop: 3, display: 'inline-block' }}>★ Team pick</span>}
          <div style={{ fontSize: 12, color: '#6A7180', marginTop: 3 }}>{[active.category, active.color].filter(Boolean).join(' · ') || ' '}</div>
          {active.sku && <div style={{ fontSize: 11.5, color: '#9AA1AC', fontFamily: 'monospace', marginTop: 2 }}>{active.sku}</div>}
        </div>
        {ways.length > 1 && (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }} title="Pick a color — this is the one added to the store">
            {ways.slice(0, 12).map((c) => { const on = c.id === active.id; const isSchool = schoolWords.length > 0 && productMatchesColors(c.color, schoolWords); return (
              <button key={c.id} type="button" title={(c.color || c.sku || '') + (isSchool ? ' (school color)' : '')} onClick={() => pickColor(c)}
                style={{ width: 20, height: 20, borderRadius: '50%', padding: 0, cursor: 'pointer', background: colorNameToHex(c.color), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)', border: on ? '2px solid #2563eb' : (isSchool ? '2px solid #f59e0b' : '2px solid transparent') }} />
            ); })}
            {ways.length > 12 && <span style={{ fontSize: 11, color: '#9AA1AC', fontWeight: 700 }}>+{ways.length - 12}</span>}
          </div>
        )}
        <div style={{ fontSize: 11.5, fontWeight: 800, color: st.units > 0 ? '#166534' : st.incoming ? '#92400e' : '#b91c1c' }}>
          {st.units > 0 ? `${st.units} in stock` : st.incoming ? 'Incoming only' : 'Out of stock'}
        </div>
        {sizes.length > 0 && (
          <div className="ai-chipgrid">
            {sizes.slice(0, 10).map((s) => <span key={s} className="ai-chip">{s}</span>)}
            {sizes.length > 10 && <span className="ai-chip" style={{ color: '#6A7180' }}>+{sizes.length - 10}</span>}
          </div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', gap: 8, borderTop: '1px dashed #E6E8EC', paddingTop: 8 }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} style={{ flex: 1, border: 'none', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.03em', background: isSel ? '#dbeafe' : '#191919', color: isSel ? '#1d4ed8' : '#fff' }}>{isSel ? '✓ Selected' : 'Select'}</button>
          {onColors && <button type="button" onClick={(e) => { e.stopPropagation(); onColors(active); }} title="See & add other colors of this item" style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: '#3A4150' }}>Colors →</button>}
        </div>
      </div>
    </div>
  );
}

// Shared "In stock only" pill — used by every store builder (manual picker, AI
// panel, and the coach portal) so the control looks and behaves identically.
function InStockToggle({ on, onToggle, count, total }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
      <button type="button" onClick={onToggle} aria-pressed={on} title="Only show items with stock on hand (NSA warehouse + vendor)"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', borderRadius: 999, padding: '4px 13px 4px 8px', fontSize: 12.5, fontWeight: 700,
          border: '1px solid ' + (on ? '#166534' : '#d1d5db'), background: on ? '#dcfce7' : '#fff', color: on ? '#166534' : '#3A4150' }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1, color: '#fff', background: on ? '#166534' : '#cbd5e1' }}>{on ? '✓' : ''}</span>
        In stock only
      </button>
      {total != null && <span style={{ fontSize: 11.5, color: '#9AA1AC' }}>{count} of {total} in stock now</span>}
    </div>
  );
}

// ── Build with AI ── A plain-English brief → the ai-store-builder edge function
// → a structured filter spec → matched catalog items → review/select → add to the
// store. The interpreted tags are shown and editable, so the AI is never a black box.
function AiStoreBuilder({ onAddProducts, onClose, submitLabel }) {
  const [brief, setBrief] = useState('');
  const [spec, setSpec] = useState(null);
  const [candidates, setCandidates] = useState([]); // color/keyword-filtered rows, each carrying live _stock
  const [inStockOnly, setInStockOnly] = useState(false);
  const [matches, setMatches] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  // Quick-pick options that hone the AI without typing. They're woven into the brief
  // the model reads, so it still returns editable brand/category/color facets.
  const [gender, setGender] = useState([]);
  const [types, setTypes] = useState([]);
  const [hues, setHues] = useState([]);
  const GENDERS = ["Men's", "Women's", 'Youth', 'Unisex'];
  const TYPES = ['Tees', '1/4 Zip', 'Hoodies', 'Crews', 'Polos', 'Shorts', 'Pants', 'Outerwear', 'Headwear', 'Bags', 'Cleats'];
  const HUES = ['Black', 'White', 'Red', 'Royal', 'Navy', 'Grey', 'Green', 'Gold', 'Orange', 'Maroon', 'Purple', 'Pink'];
  const toggleIn = (arr, setArr, v) => setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const structured = [
    gender.length ? `${gender.join(' / ')} items` : '',
    types.length ? `item types: ${types.join(', ')}` : '',
    hues.length ? `colors: ${hues.join(', ')}` : '',
  ].filter(Boolean).join('. ');
  const fullBrief = `${structured}${structured && brief.trim() ? '. ' : ''}${brief.trim()}`.trim();

  // Brand/category come back as exact catalog values (reliable .in filters);
  // colors/keywords are matched in-memory to dodge PostgREST wildcard quirks.
  // Each candidate is annotated with live availability (_stock) from the same
  // source as the catalog live-look, so the in-stock toggle and the per-card
  // stock badges agree on exactly what's orderable right now.
  const loadCandidates = async (s) => {
    // Match the catalog live-look: exclude archived products from AI candidates too,
    // while still including legacy rows whose is_active is null.
    let q = supabase.from('products').select('id,sku,name,brand,color,category,retail_price,available_sizes,image_front_url')
      .or('is_active.is.null,is_active.eq.true').or('is_archived.is.null,is_archived.eq.false').limit(300);
    if (s.brands?.length) q = q.in('brand', s.brands);
    if (s.categories?.length) q = q.in('category', s.categories);
    const { data } = await q;
    let rows = data || [];
    const colors = (s.colors || []).map((c) => c.toLowerCase());
    const keywords = (s.keywords || []).map((k) => k.toLowerCase());
    // Colors are a reliable product attribute — when the brief names colors, keep only
    // on-palette items. Off-color hits were the main "items all over the place" source.
    if (colors.length) rows = rows.filter((p) => colors.some((c) => (p.color || '').toLowerCase().includes(c)));
    // Relevance score from keyword hits in name/SKU (e.g. "training", "3 stripe", a
    // style number like JX4452) so the closest matches lead and weak ones trail.
    const scoreOf = (p) => {
      const hay = `${p.name || ''} ${p.sku || ''}`.toLowerCase();
      return keywords.reduce((a, k) => a + (hay.includes(k) ? 1 : 0), 0);
    };
    for (const r of rows) r._score = scoreOf(r);
    rows.sort((a, b) => (b._score - a._score) || (a.name || '').localeCompare(b.name || ''));
    rows = rows.slice(0, 120);
    const stock = await fetchStockMap(rows);
    for (const r of rows) r._stock = stock.get(r.id) || { units: 0, sizes: [], sizeStock: {}, incoming: false };
    return rows;
  };

  // One place decides what's visible: the candidate pool narrowed by the in-stock
  // toggle, capped, with the selection (re)seeded to everything shown.
  const applyFilter = (cands, inStock) => {
    const visible = (inStock ? cands.filter((p) => (p._stock?.units || 0) > 0) : cands).slice(0, 120);
    setMatches(visible);
    // Pre-check only the on-brief matches when the brief had keywords; otherwise the
    // whole (color-narrowed) set. Avoids "Add" dumping loosely-related items.
    const hasKw = visible.some((p) => (p._score || 0) > 0);
    setSel(new Set(visible.filter((p) => !hasKw || (p._score || 0) > 0).map((p) => p.id)));
  };

  const generate = async () => {
    if (!fullBrief) return;
    setBusy(true); setErr(''); setSpec(null); setCandidates([]); setMatches([]); setSel(new Set());
    try {
      const d = await invokeEdgeFn(supabase, 'ai-store-builder', { brief: fullBrief });
      if (!d?.ok) throw new Error(d?.error || 'The AI could not read that brief.');
      setSpec(d.spec);
      const cands = await loadCandidates(d.spec);
      // Default to in-stock-only across every builder so we never seed a store with
      // items we can't fulfill; one click flips it off to see (dimmed) out-of-stock.
      const inStock = true;
      setCandidates(cands); setInStockOnly(inStock);
      applyFilter(cands, inStock);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const dropTag = async (facet, val) => {
    const next = { ...spec, [facet]: (spec[facet] || []).filter((x) => x !== val) };
    setSpec(next);
    const cands = await loadCandidates(next);
    setCandidates(cands);
    applyFilter(cands, inStockOnly);
  };
  const toggleInStock = () => { const v = !inStockOnly; setInStockOnly(v); applyFilter(candidates, v); };
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = matches.filter((p) => sel.has(p.id));
  const inStockCount = candidates.reduce((a, p) => a + ((p._stock?.units || 0) > 0 ? 1 : 0), 0);

  const facetRow = (label, facet) => (spec?.[facet]?.length ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', minWidth: 74 }}>{label}</span>
      {spec[facet].map((v) => (
        <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #d1d5db', borderRadius: 999, padding: '3px 6px 3px 11px', fontSize: 12.5, fontWeight: 600 }}>
          {v}<button onClick={() => dropTag(facet, v)} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
        </span>
      ))}
    </div>
  ) : null);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <CatalogKitStyles />
      <KitScope style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.01em' }}>✨ Build with AI</div>
          {onClose && <button className="ai-iconbtn" onClick={onClose} aria-label="Close">✕ Close</button>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {[['Who', GENDERS, gender, setGender], ['Item types', TYPES, types, setTypes], ['Colors', HUES, hues, setHues]].map(([lbl, list, arr, setArr]) => (
            <div key={lbl} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', minWidth: 74, paddingTop: 5 }}>{lbl}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {list.map((v) => <FilterBtn key={v} on={arr.includes(v)} onClick={() => toggleIn(arr, setArr, v)}>{v}</FilterBtn>)}
              </div>
            </div>
          ))}
        </div>
        <textarea className="ai-search" rows={2} value={brief} onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
          placeholder={'Add detail (optional) — e.g. "training-focused, include style JX4452, prefer crew necks"'}
          style={{ resize: 'vertical', minHeight: 56, lineHeight: 1.4 }} aria-label="Store brief" />
        <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="ai-more" style={{ margin: 0 }} onClick={generate} disabled={busy || !fullBrief}>{busy ? 'Reading the brief…' : 'Find items'}</button>
          {err && <span style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600 }}>{err}</span>}
        </div>

        {spec && (
          <div style={{ marginTop: 14, padding: 12, background: '#f8fafc', borderRadius: 10, border: '1px solid #eef2f7' }}>
            <div style={{ fontSize: 13, color: '#3A4150', marginBottom: 9 }}>{spec.interpretation}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {facetRow('Brands', 'brands')}
              {facetRow('Categories', 'categories')}
              {facetRow('Colors', 'colors')}
              {facetRow('Keywords', 'keywords')}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 1 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6A7180', minWidth: 74 }}>Stock</span>
                <InStockToggle on={inStockOnly} onToggle={toggleInStock} count={inStockCount} total={candidates.length} />
              </div>
            </div>
          </div>
        )}

        {spec && (
          <div style={{ marginTop: 14 }}>
            {matches.length === 0 ? (
              <div style={{ color: '#9AA1AC', fontSize: 13, padding: 8 }}>
                {inStockOnly && candidates.length > 0
                  ? 'Nothing in stock matched — turn off “In stock only” above to include out-of-stock items, or remove a tag to loosen the search.'
                  : 'No catalog items matched — remove a tag above to loosen the search.'}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{chosen.length} of {matches.length} selected</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="ai-iconbtn" onClick={() => setSel(new Set(matches.map((p) => p.id)))}>Select all</button>
                    <button className="ai-iconbtn" onClick={() => setSel(new Set())}>Clear</button>
                  </div>
                </div>
                <div className="ai-grid">
                  {matches.map((p) => <AiMatchCard key={p.id} p={p} on={sel.has(p.id)} onToggle={() => toggleSel(p.id)} />)}
                </div>
              </>
            )}
          </div>
        )}
      </KitScope>
      {chosen.length > 0 && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #eef0f3', padding: '12px 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, borderRadius: '0 0 8px 8px' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>Added at catalog price — adjust pricing &amp; fundraising in the list after.</span>
          <button className="btn btn-primary" disabled={adding} onClick={async () => { setAdding(true); await onAddProducts(chosen); setAdding(false); }}>{adding ? 'Working…' : submitLabel ? `${submitLabel} (${chosen.length})` : `Add ${chosen.length} item${chosen.length === 1 ? '' : 's'} to store`}</button>
        </div>
      )}
    </div>
  );
}

function AiMatchCard({ p, on, onToggle }) {
  const [imgErr, setImgErr] = useState(false);
  const st = p._stock || { units: 0, sizes: [], incoming: false };
  const out = (st.units || 0) <= 0;
  const stockText = st.units > 0 ? `${st.units} in stock` : st.incoming ? 'Incoming only' : 'Out of stock';
  const stockColor = st.units > 0 ? '#166534' : st.incoming ? '#92400e' : '#b91c1c';
  return (
    <button className="ai-card" onClick={onToggle} aria-pressed={on} style={{ outline: on ? '2px solid #191919' : '2px solid transparent', outlineOffset: -2 }}>
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4', width: '100%' }}>
        {p.image_front_url && !imgErr
          ? <img src={p.image_front_url} alt="" loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain', opacity: out ? 0.5 : on ? 1 : 0.82 }} />
          : <div style={{ color: '#A8AEB8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>No image</div>}
        <span style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 6, background: on ? '#191919' : 'rgba(255,255,255,.9)', border: '1px solid ' + (on ? '#191919' : '#cbd5e1'), color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{on ? '✓' : ''}</span>
        {p.retail_price != null && <span style={{ position: 'absolute', top: 8, right: 8, background: '#191919', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 12.5, fontWeight: 700 }}>{money(p.retail_price)}</span>}
        {out && <span style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(185,28,28,.95)', color: '#fff', borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' }}>{st.incoming ? 'Incoming' : 'Out of stock'}</span>}
      </div>
      <div style={{ padding: '10px 12px 12px', textAlign: 'left', width: '100%' }}>
        {p.brand && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{p.brand}</div>}
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 14.5, lineHeight: 1.12, textTransform: 'uppercase' }}>{p.name || p.sku}</div>
        <div style={{ fontSize: 11.5, color: '#6A7180', marginTop: 2 }}>{[p.category, p.color].filter(Boolean).join(' · ') || ' '}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: stockColor }}>{stockText}</span>
          {st.sizes && st.sizes.length > 0 && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6A7180', letterSpacing: '.02em' }}>{st.sizes.slice(0, 7).join(' · ')}{st.sizes.length > 7 ? ` +${st.sizes.length - 7}` : ''}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Art & Logos ── Pull from the customer's art library, see every colorway of
// a style at once, recolor the logo per garment color (saved back to the library
// as a reusable variant), and apply to many items in one click. Applied art is
// written to webstore_products.decorations so the storefront can render the mock.
// The "all garments (default)" per-color-way web logo, if the record uses the
// per-CW web_logos[] model — equivalent to the legacy single web_logo_url.
const webLogoDefault = (art) => {
  if (!art || !Array.isArray(art.web_logos)) return null;
  const wl = art.web_logos.filter((w) => w && w.url);
  if (!wl.length) return null;
  return (wl.find((w) => w.is_default || !((w.color_way || '').trim())) || wl[0]).url;
};
const artImgUrl = (art) => {
  if (!art) return null;
  // web logo first: a clean transparent cutout attached for storefront placement
  // beats a full-garment mockup or .ai source for stamping a logo onto a garment.
  const cands = [webLogoDefault(art), art.web_logo_url, art.preview_url, ...((art.mockup_files || []).map((f) => f?.url)), ...((art.files || []).map((f) => f?.url))].filter(Boolean);
  return cands.find((u) => /\.(png|svg|jpe?g|webp)(\?|$)/i.test(u)) || null;
};
const artSourceUrl = (art) => (art?.files || []).map((f) => f?.url).find(Boolean) || artImgUrl(art) || null;
// Best DISPLAY thumbnail for an art record — mirrors the customer Art folder: web logo,
// then preview, then any garment mockup (incl. rep-built item_mockups), then a file. This
// is for showing the tile only; PLACEMENT uses artImgUrl (a clean cutout), never a mockup.
const artThumbUrl = (art) => {
  if (!art) return null;
  const u = (f) => (typeof f === 'string' ? f : f?.url);
  const itemMocks = Object.values(art.item_mockups || {}).flat();
  const cands = [webLogoDefault(art), art.web_logo_url, art.preview_url, ...((art.mockup_files || []).map(u)), ...itemMocks.map(u), ...((art.files || []).map(u))].filter(Boolean);
  return cands.find((x) => /\.(png|svg|jpe?g|webp)(\?|$)/i.test(x)) || null;
};
// Background for a logo THUMBNAIL so a transparent cutout stays visible wherever it's shown
// (a white logo washes out on a near-white card). Prefer the garment color(s) the shown
// cutout covers — a white logo on its dark garment reads perfectly — falling back to a soft
// transparency checker (light + medium gray) that reveals both light- and dark-ink logos
// when the cutout has no color assigned yet.
const LOGO_THUMB_CHECKER = 'repeating-conic-gradient(#94a3b8 0 25%, #e2e8f0 0 50%) 50% / 14px 14px';
const logoThumbBg = (art, thumbUrl) => {
  const wls = Array.isArray(art && art.web_logos) ? art.web_logos : [];
  const forUrl = thumbUrl ? wls.filter((w) => w && w.url === thumbUrl) : [];
  const src = forUrl.length ? forUrl : wls;
  const labels = [...new Set(src.map((w) => ((w && w.color_way) || '').trim()).filter(Boolean))];
  if (!labels.length) return LOGO_THUMB_CHECKER;
  const cols = labels.map(garmentHex);
  return cols.length === 1 ? cols[0] : ('linear-gradient(135deg, ' + cols[0] + ' 0 50%, ' + cols[1] + ' 50% 100%)');
};
const isSvg = (u) => /\.svg(\?|$)/i.test(u || '');
// Clean cutout for PLACING art on a garment — a real logo, never a full-garment mockup
// (recoloring an opaque mockup to white is exactly what produced the "white box"). Prefers
// an explicit web logo (per record, or per color way); for logos uploaded straight in (no
// production mockups) the preview/file IS the cutout. Production art that only has a mockup
// returns null, so the UI asks for a web logo instead of stamping the shirt image.
const artPlaceUrl = (art) => {
  if (!art) return null;
  if (Array.isArray(art.web_logos) && art.web_logos.length) {
    const wl = art.web_logos.filter((w) => w && w.url);
    const def = wl.find((w) => !((w.color_way || '').trim())) || wl[0];
    if (def) return def.url;
  }
  if (art.web_logo_url) return art.web_logo_url;
  const cwLogo = (art.color_ways || []).map((c) => c.web_logo_url).find(Boolean);
  if (cwLogo) return cwLogo;
  const hasMock = (art.mockup_files || []).length || Object.keys(art.item_mockups || {}).length;
  if (!hasMock) {
    const u = (f) => (typeof f === 'string' ? f : f?.url);
    const clean = [art.preview_url, ...((art.files || []).map(u))].filter(Boolean).find((x) => /\.(png|svg|jpe?g|webp)(\?|$)/i.test(x));
    if (clean) return clean;
  }
  return null;
};
const hexRgb = (hex) => { const h = (hex || '#000').replace('#', ''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
const cssTint = (choice) => choice === 'white' ? 'brightness(0) invert(1)' : choice === 'black' ? 'brightness(0)' : 'none';

// Recolor a logo to a single solid color, returning an uploadable Blob.
// SVG: force every fill/stroke to the color. PNG/raster: tint opaque pixels.
async function recolorToBlob(url, hex) {
  if (isSvg(url)) {
    let txt = await fetch(url).then((r) => r.text());
    txt = txt
      .replace(/fill:\s*#[0-9a-fA-F]{3,6}/g, `fill:${hex}`).replace(/fill="#[0-9a-fA-F]{3,6}"/g, `fill="${hex}"`)
      .replace(/stroke:\s*#[0-9a-fA-F]{3,6}/g, `stroke:${hex}`).replace(/stroke="#[0-9a-fA-F]{3,6}"/g, `stroke="${hex}"`);
    return new Blob([txt], { type: 'image/svg+xml' });
  }
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); c.width = img.naturalWidth || 400; c.height = img.naturalHeight || 400;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height); const px = d.data; const [r, g, b] = hexRgb(hex);
  for (let i = 0; i < px.length; i += 4) { if (px[i + 3] > 8) { px[i] = r; px[i + 1] = g; px[i + 2] = b; } }
  ctx.putImageData(d, 0, 0);
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

const _loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });

// Roughly, does this logo use more than one ink color? A flat white/black recolor (Autocolor's
// light-on-dark move) turns a MULTI-color mark — e.g. a gold+red+white crest — into a solid
// silhouette, so Autocolor must leave those as Orig. A single-ink mark (one color + anti-alias
// edges) can still flip. Returns true only when confident it's multi-color; any load/CORS/parse
// failure → false (keep the single-ink behavior). SVG: count distinct fill/stroke colors. Raster:
// bucket opaque pixels into black/white/grey + 12 hue bins and call it multi when ≥2 buckets each
// hold a meaningful share (≥8%), which discounts anti-aliasing.
async function logoIsMulticolor(url) {
  if (!url) return false;
  try {
    if (isSvg(url)) {
      const txt = await fetch(url).then((r) => r.text());
      const cols = new Set((txt.match(/(?:fill|stroke)\s*[:=]\s*["']?#[0-9a-fA-F]{3,6}/g) || [])
        .map((m) => m.replace(/.*#/, '#').toLowerCase())
        .filter((hxc) => !['#fff', '#ffffff', '#000', '#000000'].includes(hxc)));
      return cols.size >= 2;
    }
    const img = await _loadImg(url);
    const s = 72;
    const iw = img.naturalWidth || s, ih = img.naturalHeight || s;
    const scale = Math.min(1, s / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const groups = {}; let opaque = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      opaque++;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, sat = mx ? (mx - mn) / mx : 0;
      let key;
      if (sat < 0.22) key = v < 0.28 ? 'k' : v > 0.82 ? 'w' : 'g'; // near-grey: black / white / grey
      else { const d = mx - mn; let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360; key = 'h' + Math.floor(hue / 30); }
      groups[key] = (groups[key] || 0) + 1;
    }
    if (opaque < 20) return false;
    return Object.values(groups).filter((n) => n / opaque >= 0.08).length >= 2;
  } catch (_) { return false; }
}
const _toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

// The logo's own dominant colors, so a rep can pick the white / gold / etc. to change.
async function extractPalette(url, max = 7) {
  if (!url) return [];
  if (isSvg(url)) {
    const txt = await fetch(url).then((r) => r.text());
    const hexes = [...txt.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase());
    return [...new Set(hexes)].slice(0, max).map((hex) => ({ hex }));
  }
  const img = await _loadImg(url);
  const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
  const w = 64, h = Math.max(1, Math.round(64 / (ratio || 1)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const counts = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue; // skip transparent
    const r = Math.round(px[i] / 24) * 24, g = Math.round(px[i + 1] / 24) * 24, b = Math.round(px[i + 2] / 24) * 24;
    const key = (r << 16) | (g << 8) | b; counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  for (const [key] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
    if (out.some((o) => (o.r - r) ** 2 + (o.g - g) ** 2 + (o.b - b) ** 2 < 900)) continue; // merge near-dupes
    out.push({ r, g, b }); if (out.length >= max) break;
  }
  return out.map(({ r, g, b }) => ({ hex: _toHex(r, g, b) }));
}

// Replace ONE color in a logo (within a tolerance) with another, leaving every other color
// intact — e.g. the white in a shield → red, or Vegas gold → navy. Soft falloff keeps edges.
async function swapColorToBlob(url, fromHex, toHex, tol = 78) {
  if (isSvg(url)) {
    const txt = await fetch(url).then((r) => r.text());
    return new Blob([txt.split(fromHex.toLowerCase()).join(toHex.toLowerCase()).split(fromHex.toUpperCase()).join(toHex.toLowerCase())], { type: 'image/svg+xml' });
  }
  const img = await _loadImg(url);
  const c = document.createElement('canvas'); c.width = img.naturalWidth || 400; c.height = img.naturalHeight || 400;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height); const px = d.data;
  const [fr, fg, fb] = hexRgb(fromHex); const [tr, tg, tb] = hexRgb(toHex); const tol2 = tol * tol;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const dr = px[i] - fr, dg = px[i + 1] - fg, db = px[i + 2] - fb; const dist2 = dr * dr + dg * dg + db * db;
    if (dist2 > tol2) continue;
    const wgt = 1 - Math.sqrt(dist2) / tol; // 1 at exact match, →0 at the tolerance edge
    px[i] = Math.round(px[i] * (1 - wgt) + tr * wgt);
    px[i + 1] = Math.round(px[i + 1] * (1 - wgt) + tg * wgt);
    px[i + 2] = Math.round(px[i + 2] * (1 - wgt) + tb * wgt);
  }
  ctx.putImageData(d, 0, 0);
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

// A compact "attach a web logo" control for an art record. Production art (a .ai source
// or a full-garment mockup) can't be placed cleanly on a storefront garment; dropping a
// transparent PNG/SVG here saves a web-ready cutout onto the record (web_logo_url) so the
// art becomes placeable & recolorable — on this store, future stores, and orders.
function WebLogoSlot({ art, onAttach, compact }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const has = !!(art?.web_logo_url || (Array.isArray(art?.web_logos) && art.web_logos.some((w) => w && w.url)));
  const pick = async (file) => {
    if (!file || !onAttach) return;
    const ok = file.type?.startsWith('image/') || /\.(svg|png)$/i.test(file.name || '');
    if (!ok) return;
    setBusy(true);
    try { const url = await cloudUpload(file, 'nsa-store-art'); await onAttach(art, url); }
    catch (e) { /* cloudUpload surfaces errors via toast */ }
    setBusy(false);
  };
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); ref.current && ref.current.click(); }} disabled={busy}
        title={has ? 'Replace the web logo — the clean PNG/SVG used to place this art on garments' : 'Add a clean transparent PNG/SVG so this art can be placed & recolored on garments'}
        style={{ fontSize: compact ? 9.5 : 10.5, padding: compact ? '2px 6px' : '3px 8px', fontWeight: 800, borderRadius: 6, lineHeight: 1.3, cursor: busy ? 'wait' : 'pointer', border: has ? '1px solid #166534' : '1px dashed #2563eb', background: has ? '#ecfdf5' : '#eff6ff', color: has ? '#166534' : '#1d4ed8', whiteSpace: 'nowrap' }}>
        {busy ? '…' : has ? 'web ✓' : '+ web logo'}
      </button>
      <input ref={ref} type="file" accept="image/*,.svg,.png" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pick(f); e.target.value = ''; }} />
    </>
  );
}

// Color-coded decoration-method chip so two visually-identical logos (e.g. an embroidery
// version and a screen-print version of the same mark) are told apart at a glance. Reads
// the art record's `deco_type` (embroidery / screen_print / dtf / heat_transfer /
// sublimation / vinyl); unknown values fall back to a neutral chip, and a blank type
// renders nothing rather than guessing.
const DECO_BADGE = {
  embroidery: { label: 'Embroidery', bg: '#fef3c7', fg: '#92400e', bd: '#fcd34d' },
  screen_print: { label: 'Screen Print', bg: '#e0e7ff', fg: '#3730a3', bd: '#c7d2fe' },
  dtf: { label: 'DTF', bg: '#ccfbf1', fg: '#115e59', bd: '#5eead4' },
  heat_transfer: { label: 'Heat Transfer', bg: '#ffedd5', fg: '#9a3412', bd: '#fdba74' },
  heat_press: { label: 'Heat Press', bg: '#ffedd5', fg: '#9a3412', bd: '#fdba74' },
  sublimation: { label: 'Sublimation', bg: '#f3e8ff', fg: '#6b21a8', bd: '#e9d5ff' },
  vinyl: { label: 'Vinyl', bg: '#ffe4e6', fg: '#9f1239', bd: '#fecdd3' },
};
const decoBadge = (dt) => {
  const k = String(dt || '').toLowerCase().trim();
  if (DECO_BADGE[k]) return DECO_BADGE[k];
  return k ? { label: k.replace(/_/g, ' '), bg: '#f1f5f9', fg: '#475569', bd: '#e2e8f0' } : null;
};
function DecoBadge({ deco }) {
  const b = decoBadge(deco);
  if (!b) return null;
  return (
    <span title={`Decoration method: ${b.label}`} style={{
      display: 'inline-block', maxWidth: '100%', background: b.bg, color: b.fg,
      border: `1px solid ${b.bd}`, borderRadius: 999, padding: '1px 7px',
      fontSize: 9.5, fontWeight: 800, lineHeight: 1.5, whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'capitalize',
    }}>{b.label}</span>
  );
}

function ArtTab({ catalog, stockByWp, decorationMode = 'in_house', libraryArt, storeArt = [], onSaveStoreArt, onSaveLogo, onAttachWebLogo, onApplyLogoBulk, onSetItemDecorations, onSaveArtVariant, onSaveRepWebLogo, placementMemory = {}, onSavePlacementMemory, canMock, onOpenMockBuilder }) {
  const singles = (catalog || []).filter((c) => c.kind === 'single');
  const [activeId, setActiveId] = useState(storeArt[0]?.id || null);
  const [placement, setPlacement] = useState('left_chest');
  const [selected, setSelected] = useState(() => new Set()); // STYLE keys chosen for apply — a style card covers all its colors
  const [bulkOpen, setBulkOpen] = useState(true); // the apply-to-items grid IS the main flow — open by default after art is in (collapsible via ✕ Close)
  // Per-color logo choice (keyed by the color row's item id): a real per-CW variant
  // { kind:'variant', url, colorWayId, label } or a recolor { kind:'recolor', choice }.
  const [pickByItem, setPickByItem] = useState({});
  const [multiColorByArt, setMultiColorByArt] = useState({}); // art id -> is the logo multi-color? (async-detected; keeps Autocolor from whiting out a multi-color mark)
  // One card per style; each card pages through its colors. Placement is per STYLE
  // (drag/resize applies to all its colors — the photos match, so one size reads
  // consistently), with an optional nudge override for the odd color's photo.
  const [activeIdx, setActiveIdx] = useState({});       // styleKey -> index of the color being shown
  const [logoCwIdx, setLogoCwIdx] = useState({});       // art id -> index of the color way being previewed in "Pick a logo"
  const [placeByStyle, setPlaceByStyle] = useState({}); // styleKey -> { x, y, w }
  const [placeByItem, setPlaceByItem] = useState({});   // itemId  -> { x, y, w } (nudge override)
  const [nudgeItem, setNudgeItem] = useState(null);     // itemId currently in nudge mode
  const [presetTouched, setPresetTouched] = useState(false); // rep picked a placement preset → it overrides existing placements
  // Back logos are a rare, per-card add — not a whole-grid mode. A style card that gets
  // one carries it on every color (decorations are card-level on the storefront).
  const [backByStyle, setBackByStyle] = useState({});   // styleKey -> { placement, x, y, w }
  const [flipped, setFlipped] = useState(() => new Set()); // styleKeys whose card is showing the back
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(true); // collapse the logo-picker section
  const [upBusy, setUpBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const emptyRef = useRef();
  const boxRefs = useRef({}); // styleKey -> the card's stage element (for drag math)
  const dragRef = useRef(null); // { itemId, styleKey, mode:'move'|'resize', scope:'style'|'item'|'backStyle', box, grab }
  // Picks (and placements) are specific to the active logo — a variant pick holds that
  // logo's cutout URL — so switching logos starts a clean staging slate. Selection is kept.
  useEffect(() => { setPickByItem({}); setPlaceByStyle({}); setPlaceByItem({}); setNudgeItem(null); setBackByStyle({}); setFlipped(new Set()); setPresetTouched(false); setDone(''); }, [activeId]);
  // Upload a NEW artwork file here: saves it to the customer's art folder AND this
  // store's set, so it's reusable on orders later and pickable on items now.
  const uploadArt = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUpBusy(true);
    try { const url = await cloudUpload(file, 'nsa-store-art'); if (onSaveLogo) { const rec = await onSaveLogo(url, (file.name || 'Logo').replace(/\.[^.]+$/, '')); if (rec) setActiveId(rec.id); } }
    catch (x) { /* cloudUpload surfaces error via toast */ }
    setUpBusy(false);
  };

  const inStore = (id) => (storeArt || []).some((a) => a.id === id);
  const toggleStoreArt = (a) => { const cur = storeArt || []; onSaveStoreArt && onSaveStoreArt(inStore(a.id) ? cur.filter((x) => x.id !== a.id) : [...cur, a]); };
  const activeArt = (storeArt || []).find((a) => a.id === activeId) || libraryArt.find((a) => a.id === activeId) || null;
  const activeUrl = artPlaceUrl(activeArt);
  // Detect once whether the active logo is multi-color, so Autocolor keeps a multi-color mark
  // as Orig instead of knocking it out to a white silhouette on dark garments. Cached per art id.
  const activeMulti = multiColorByArt[activeId];
  useEffect(() => {
    if (!activeId || !activeUrl || multiColorByArt[activeId] !== undefined) return;
    let alive = true;
    logoIsMulticolor(activeUrl).then((m) => { if (alive) setMultiColorByArt((p) => (p[activeId] !== undefined ? p : { ...p, [activeId]: m })); });
    return () => { alive = false; };
  }, [activeId, activeUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const place = ART_PLACEMENTS.find((p) => p.id === placement) || ART_PLACEMENTS[0];
  const _fullBack = ART_PLACEMENTS.find((p) => p.id === 'full_back') || place;
  // The active logo's real per-CW variants (artist cutouts). ≥2 → the card shows variant
  // chips; otherwise the recolor chips. Re-keyed so each carries its stable color_way_id.
  const variants = normalizeWebLogos(activeArt && activeArt.web_logos, activeArt && activeArt.color_ways).filter((w) => w && w.url);

  // Group store items into styles, each with its colorways; stamp the style key on each
  // item so placement (per style) and drag can resolve it.
  const groups = [];
  { const m = new Map();
    for (const it of singles) {
      const st = stockByWp[it.id] || {};
      const key = (it.display_name || st.name || it.sku || '').toUpperCase();
      let g = m.get(key);
      if (!g) { g = { key, name: it.display_name || st.name || it.sku, items: [] }; m.set(key, g); groups.push(g); }
      g.items.push({ id: it.id, sku: it.sku, img: it.image_url || st.image_front_url, backImg: st.image_back_url || '', color: st.color || '', decorations: it.decorations || [], styleKey: key });
    }
  }
  const allItems = groups.flatMap((g) => g.items);
  const itemById = (id) => allItems.find((it) => it.id === id) || null;
  const selectedGroups = groups.filter((g) => selected.has(g.key));
  const includedItems = selectedGroups.flatMap((g) => g.items);
  const toggleStyle = (key) => setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const selectAll = () => setSelected(new Set(groups.map((g) => g.key)));
  const clearSel = () => setSelected(new Set());
  const activeItemOf = (g) => g.items[Math.min(activeIdx[g.key] || 0, g.items.length - 1)];
  const pageColor = (g, dir) => setActiveIdx((m) => { const cur = Math.min(m[g.key] || 0, g.items.length - 1); return { ...m, [g.key]: (cur + dir + g.items.length) % g.items.length }; });

  // Autocolor: the per-COLOR pick, resolved from the garment color (real CW variant when
  // the logo has one, else a light/dark recolor). Used as the live default and re-applied
  // in one click by the Autocolor button.
  const pickFor = (item) => pickByItem[item.id] || autoColorChoice(activeArt, item.color, { preferOriginal: activeMulti });
  const setPick = (id, pick) => setPickByItem((m) => ({ ...m, [id]: pick }));
  // Autocolor: with styles selected, recolor just those; with NOTHING selected it goes
  // store-wide — selects every style and colors every color in one click.
  const autocolorSelected = async () => {
    const targets = includedItems.length ? includedItems : allItems;
    if (!includedItems.length) setSelected(new Set(groups.map((g2) => g2.key)));
    // Make sure the multi-color check has resolved before Autocolor commits picks — otherwise a
    // fast click could still knock a multi-color logo out to white before detection lands.
    let multi = activeMulti;
    if (multi === undefined && activeUrl) { multi = await logoIsMulticolor(activeUrl); setMultiColorByArt((p) => (p[activeId] !== undefined ? p : { ...p, [activeId]: multi })); }
    setPickByItem((m) => { const n = { ...m }; for (const it of targets) n[it.id] = autoColorChoice(activeArt, it.color, { preferOriginal: multi }); return n; });
  };
  // Rep self-serve: turn the shown color's cutout (a recolor, or the base) into a saved,
  // reusable web logo tied to a color way — creating the CW if the rep names a new one.
  const [repSave, setRepSave] = useState(null); // { url } while the color-way prompt is open
  const [repBusy, setRepBusy] = useState(false);
  const [repNewCw, setRepNewCw] = useState('');
  const startRepSave = async (item) => {
    if (!activeArt || !activeUrl || !onSaveRepWebLogo) return;
    const pick = pickFor(item);
    setRepBusy(true);
    try {
      let url = activeUrl;
      if (pick.kind === 'variant') url = pick.url;
      else if (pick.choice !== 'original') {
        const hex = pick.choice === 'white' ? '#ffffff' : '#000000';
        const blob = await recolorToBlob(activeUrl, hex);
        const ext = isSvg(activeUrl) ? 'svg' : 'png';
        url = await cloudUpload(new File([blob], `${(activeArt.name || 'logo').replace(/\s+/g, '-')}-${pick.choice}.${ext}`, { type: blob.type }), 'nsa-store-art');
      }
      setRepNewCw(item.color || '');
      setRepSave({ url });
    } catch (e) { onFlash && onFlash('Could not prepare the web logo: ' + (e.message || e)); }
    setRepBusy(false);
  };
  const confirmRepSave = async (cwName) => {
    if (!repSave) return;
    setRepBusy(true);
    await onSaveRepWebLogo(activeArt, repSave.url, cwName || '');
    setRepBusy(false); setRepSave(null); setRepNewCw('');
  };
  // Where a garment's logo already sits (the active art's deco, else any logo on that
  // side) — so an already-decorated style loads its real placement instead of snapping
  // to the preset. Once the rep picks a preset pill (presetTouched), the preset wins.
  const existingPlace = (item, side) => {
    const decos = (item && item.decorations) || [];
    const d = decos.find((x) => x && (x.side || 'front') === side && x.art_id === (activeArt && activeArt.id)) || decos.find((x) => x && x.art_url && (x.side || 'front') === side && !isPerso(x));
    if (!d) return null;
    const dp = ART_PLACEMENTS.find((p) => p.id === d.placement) || (side === 'back' ? _fullBack : place);
    return { id: d.placement || dp.id, x: d.x != null ? d.x : dp.x, y: d.y != null ? d.y : dp.y, w: d.w != null ? d.w : dp.w };
  };
  const _groupOf = (item) => groups.find((g) => g.key === item.styleKey);
  const frontBase = (item) => {
    if (presetTouched) return { id: place.id, x: place.x, y: place.y, w: place.w };
    // Seed from this color's existing deco, else any color of the style (they share one
    // card-level placement), else the REMEMBERED placement for this garment type (a
    // hoodie's left chest sits differently than a tee's), else the preset.
    const g = _groupOf(item);
    let ex = existingPlace(item, 'front');
    if (!ex && g) for (const it of g.items) { ex = existingPlace(it, 'front'); if (ex) break; }
    if (ex) return ex;
    const mem = placementMemory[garmentTypeOf((g && g.name) || item.sku)];
    if (mem && mem.x != null) return { id: mem.placement || place.id, x: mem.x, y: mem.y, w: mem.w };
    return { id: place.id, x: place.x, y: place.y, w: place.w };
  };
  const placeForItem = (item) => resolveItemPlacement(frontBase(item), placeByStyle, placeByItem, item.styleKey, item.id);
  // Back logos: one per style card (rare), seeded from an existing back deco on any of the
  // style's colors, else the Full Back preset. Presence in backByStyle = gets a back logo.
  const _backSeed = (g) => { let ex = null; for (const it of g.items) { ex = existingPlace(it, 'back'); if (ex) break; } return ex ? { placement: ex.id, x: ex.x, y: ex.y, w: ex.w } : { placement: 'full_back', x: _fullBack.x, y: _fullBack.y, w: _fullBack.w }; };
  const backPlaceFor = (g) => backByStyle[g.key] || _backSeed(g);
  const addBack = (g) => { setBackByStyle((m) => (m[g.key] ? m : { ...m, [g.key]: _backSeed(g) })); setFlipped((s) => new Set(s).add(g.key)); };
  const removeBack = (key) => { setBackByStyle((m) => { const n = { ...m }; delete n[key]; return n; }); setFlipped((s) => { const n = new Set(s); n.delete(key); return n; }); };
  const flipSide = (key, toBack) => setFlipped((s) => { const n = new Set(s); toBack ? n.add(key) : n.delete(key); return n; });
  // Switching the base placement preset re-baselines everything (clears per-style /
  // per-color drags), so "put it all at Left Chest" is a clean reset to nudge from.
  const choosePlacement = (id) => { setPlacement(id); setPresetTouched(true); setPlaceByStyle({}); setPlaceByItem({}); setNudgeItem(null); };

  // Drag / resize the logo on a card's stage. Front scope is the whole STYLE (every color
  // moves together) unless the shown color is nudged; the back placement is per style too.
  const startDrag = (e, g, item, mode, side = 'front') => {
    if (!selected.has(g.key) || !activeUrl) return;
    e.preventDefault(); e.stopPropagation();
    const box = boxRefs.current[g.key];
    if (!box) return;
    try { box.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
    const curP = side === 'back' ? backPlaceFor(g) : placeForItem(item);
    // Capture where the logo was grabbed relative to its center, so a move tracks the
    // cursor from that point instead of snapping the center under it (no first-move jump).
    let grab = { dx: 0, dy: 0 };
    if (mode === 'move') {
      const r = box.getBoundingClientRect();
      grab = { dx: (e.clientX - r.left) - (curP.x / 100) * r.width, dy: (e.clientY - r.top) - (curP.y / 100) * r.height };
    }
    // The shown color keeps item scope if it's the nudge target OR already carries its own
    // override — otherwise dragging it would silently rewrite the whole style's placement.
    const scope = side === 'back' ? 'backStyle' : ((nudgeItem === item.id || placeByItem[item.id]) ? 'item' : 'style');
    dragRef.current = { itemId: item.id, styleKey: g.key, mode, box, grab, side, scope };
  };
  const onDragMove = (e) => {
    const d = dragRef.current; if (!d || !d.box) return;
    const r = d.box.getBoundingClientRect();
    const item = itemById(d.itemId); if (!item) return;
    const g = _groupOf(item); if (!g) return;
    const cur = d.side === 'back' ? backPlaceFor(g) : placeForItem(item);
    const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
    let patch;
    if (d.mode === 'resize') {
      const cx = (cur.x / 100) * r.width;
      const halfW = Math.abs((e.clientX - r.left) - cx);
      patch = { w: Math.max(4, Math.min(100, Math.round((halfW * 2 / r.width) * 100))) };
    } else {
      patch = {
        x: clamp(((e.clientX - r.left - d.grab.dx) / r.width) * 100),
        y: clamp(((e.clientY - r.top - d.grab.dy) / r.height) * 100),
      };
    }
    const merge = (prev) => ({ placement: cur.placement, x: cur.x, y: cur.y, w: cur.w, ...(prev || {}), ...patch });
    if (d.scope === 'backStyle') setBackByStyle((m) => ({ ...m, [d.styleKey]: merge(m[d.styleKey]) }));
    else if (d.scope === 'item') setPlaceByItem((m) => ({ ...m, [d.itemId]: merge(m[d.itemId]) }));
    else setPlaceByStyle((m) => ({ ...m, [d.styleKey]: merge(m[d.styleKey]) }));
  };
  const endDrag = (e) => { const d = dragRef.current; if (d && d.box) { try { d.box.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ } } dragRef.current = null; };
  const clearNudge = (id) => { setPlaceByItem((m) => { const n = { ...m }; delete n[id]; return n; }); if (nudgeItem === id) setNudgeItem(null); };

  // linkOnly = "Bypass mocks": record the art on each selected item (art_id + placement +
  // method) but with NO art_url and baked:true — so neither this grid nor the storefront
  // composites a logo over the (already-decorated) product image, while the store→SO handoff
  // still carries the art to production. Used for OMG stores whose images already show the art.
  const apply = async ({ linkOnly = false } = {}) => {
    if (!activeArt || (!linkOnly && !activeUrl) || !includedItems.length) return;
    setApplying(true); setDone('');
    try {
      const custId = activeArt._srcCustId;
      // Recolor each needed shade once (cached); variant picks use the artist cutout as-is.
      const recolorCache = {};
      const recoloredUrl = async (choice) => {
        if (choice === 'original') return activeUrl;
        if (recolorCache[choice]) return recolorCache[choice];
        const hex = choice === 'white' ? '#ffffff' : '#000000';
        const blob = await recolorToBlob(activeUrl, hex);
        const ext = isSvg(activeUrl) ? 'svg' : 'png';
        const file = new File([blob], `${(activeArt.name || 'logo').replace(/\s+/g, '-')}-${choice}.${ext}`, { type: blob.type });
        const url = await cloudUpload(file, 'nsa-store-art');
        recolorCache[choice] = url;
        if (custId && onSaveArtVariant) await onSaveArtVariant(custId, activeArt.id, { label: choice === 'white' ? 'White' : 'Black', color: hex, art_url: url, source: activeUrl });
        return url;
      };
      const source_url = artSourceUrl(activeArt);
      const deco_type = activeArt.deco_type || null;
      const entries = [];
      for (const g of selectedGroups) {
        // Resolve every color's pick once, and build the per-color map (Decision-2 shape:
        // {url, color_way_id}) that rides on EVERY row of the style — decorations are
        // card-level on the storefront/item editor, so each row must be able to resolve
        // any sibling color, and the SO handoff reads the CW id straight from this map.
        // Link-only skips all of this: no image is placed, so there's no recolor/upload work.
        const resolvedById = {};
        const cwMap = {};
        if (!linkOnly) for (const it of g.items) {
          const pick = pickFor(it);
          let r;
          if (pick.kind === 'variant') r = { url: pick.url, label: pick.label || 'variant', cwId: pick.colorWayId || null };
          else r = { url: await recoloredUrl(pick.choice), label: pick.choice, cwId: null };
          resolvedById[it.id] = r;
          const ck = colorKeyOf(it.color);
          if (ck) cwMap[ck] = r.cwId ? { url: r.url, color_way_id: r.cwId } : r.url;
        }
        const multi = g.items.length > 1;
        const hasBack = !!backByStyle[g.key];
        const bp = hasBack ? backPlaceFor(g) : null;
        for (const it of g.items) {
          const r = resolvedById[it.id];
          const mk = (side, pl) => {
            if (linkOnly) {
              // Art linked, image untouched: art_id + placement + method, baked:true so no
              // overlay renders anywhere; color_label keeps the intended logo color for production.
              const pk = pickFor(it);
              const d = { art_id: activeArt.id, placement: pl.placement, x: pl.x, y: pl.y, w: pl.w, side, baked: true, color_label: pk.kind === 'variant' ? (pk.label || 'variant') : pk.choice };
              if (deco_type) d.deco_type = deco_type;
              return d;
            }
            const d = { art_id: activeArt.id, source_url, orig_url: activeUrl, placement: pl.placement, x: pl.x, y: pl.y, w: pl.w, side, art_url: r.url, color_label: r.label };
            if (r.cwId) d.color_way_id = r.cwId;
            if (multi) d.cw_by_color = cwMap;
            return d;
          };
          const newDecos = [mk('front', placeForItem(it))];
          if (hasBack) newDecos.push(mk('back', bp));
          // Replace the logo on each side we're placing; keep the other side and — crucially —
          // any personalization tokens (number/name live on the back as perso decorations).
          const sides = new Set(newDecos.map((d) => d.side));
          const existing = Array.isArray(it.decorations) ? it.decorations : [];
          const kept = existing.filter((d) => isPerso(d) || !sides.has(d.side || 'front'));
          entries.push({ id: it.id, decorations: [...kept, ...newDecos] });
        }
      }
      const n = await onApplyLogoBulk(entries);
      // Remember each style's final front placement per garment type, so the next
      // hoodie/tee/polo seeds where reps actually put it (quiet write, shared by all reps).
      // Skip for link-only — nothing was visually placed, so there's no placement to learn.
      if (n > 0 && !linkOnly && onSavePlacementMemory) {
        const memPatch = {};
        for (const g2 of selectedGroups) {
          const pl2 = resolveItemPlacement(frontBase(g2.items[0]), placeByStyle, {}, g2.key, '');
          memPatch[garmentTypeOf(g2.name)] = { placement: pl2.placement, x: pl2.x, y: pl2.y, w: pl2.w };
        }
        onSavePlacementMemory(memPatch);
      }
      // Link-only: nothing is placed on the image, so drop the selection — this clears the
      // draggable placement previews, leaving each card as just the untouched image + its
      // "Applied" badge (the whole point of Bypass mocks).
      if (n > 0 && linkOnly) clearSel();
      setDone(n > 0 ? `${linkOnly ? 'Linked art to' : 'Applied to'} ${n} garment${n === 1 ? '' : 's'} across ${selectedGroups.length} style${selectedGroups.length === 1 ? '' : 's'}${linkOnly ? ' — image unchanged, no mockup.' : '.'}` : 'Error: nothing was applied — please retry.');
    } catch (e) { setDone('Error: ' + (e.message || e)); }
    setApplying(false);
  };

  if (!libraryArt.length && !(storeArt || []).length) {
    return (
      <div className="card">
        <div
          onClick={() => !upBusy && emptyRef.current && emptyRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) uploadArt(f); }}
          style={{ margin: 16, padding: '40px 24px', textAlign: 'center', border: '2px dashed ' + (dragOver ? '#2563eb' : '#cbd5e1'), borderRadius: 14, background: dragOver ? '#eff6ff' : '#fafbfc', cursor: upBusy ? 'wait' : 'pointer' }}>
          <input ref={emptyRef} type="file" accept="image/*,.svg,.png" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) uploadArt(f); e.target.value = ''; }} />
          <div style={{ fontSize: 34, marginBottom: 8 }}>🎨</div>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#191919', marginBottom: 6 }}>Add artwork to this store</div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 460, margin: '0 auto 16px', lineHeight: 1.55 }}>
            Drag a logo here, or click to upload (PNG, SVG). It's saved to this team's art library <i>and</i> this store — then set it up right here: attach a web‑ready cutout, place it, recolor, and apply to your items. No need to leave this page.
          </div>
          <button onClick={(e) => { e.stopPropagation(); emptyRef.current && emptyRef.current.click(); }} disabled={upBusy} className="btn btn-primary">{upBusy ? 'Uploading…' : '⬆ Upload artwork'}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Store decoration mode — drives how strict the art needs to be */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, marginBottom: 12, fontSize: 12.5, fontWeight: 600, border: '1px solid', ...(decorationMode === 'outsourced' ? { background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412' } : { background: '#eef2ff', borderColor: '#c7d2fe', color: '#3730a3' }) }}>
        {decorationMode === 'outsourced'
          ? <span>📦 <b>Decorated elsewhere</b> — a clean PNG/AI mockup is enough here. It's still saved to the customer's art library so it can be upgraded to real decoration art later.</span>
          : <span>🏭 <b>In-house decoration</b> — each logo needs production-ready art (separations / vector) on the customer's art folder so production knows exactly what to make.</span>}
      </div>
      <button onClick={onOpenMockBuilder} disabled={!canMock} title={canMock ? 'Open the full mock builder' : 'Needs library art and at least one store item'} style={{ width: '100%', textAlign: 'left', border: 'none', cursor: canMock ? 'pointer' : 'not-allowed', background: canMock ? 'linear-gradient(135deg,#7c3aed,#a78bfa)' : '#e2e8f0', color: '#fff', borderRadius: 12, padding: '14px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span><span style={{ fontSize: 16, fontWeight: 800 }}>🎨 Build mockups (full editor)</span><br /><span style={{ fontSize: 12.5, opacity: 0.92 }}>Place logos, eyedrop &amp; recolor, and apply to every garment color at once — saved to the art library and onto your store items.</span></span>
        <span style={{ fontSize: 13, fontWeight: 800, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)', borderRadius: 9, padding: '9px 15px', whiteSpace: 'nowrap' }}>Open →</span>
      </button>
      {/* Library picker + placement (quick decoration overlay path) */}
      <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5 }}>1 · Pick a logo <span style={{ fontWeight: 600, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>· this store's art set</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            {pickOpen && <>
              <button onClick={() => fileRef.current && fileRef.current.click()} disabled={upBusy} className="btn btn-sm btn-secondary" title="Upload a new logo — saved to the customer's art folder">{upBusy ? 'Uploading…' : '⬆ Upload art'}</button>
              <button onClick={() => setAddOpen((v) => !v)} className="btn btn-sm btn-secondary">{addOpen ? 'Done' : '+ Add from library'}</button>
              <input ref={fileRef} type="file" accept="image/*,.svg,.png" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) uploadArt(f); e.target.value = ''; }} />
            </>}
            <button onClick={() => setPickOpen((v) => !v)} className="btn btn-sm btn-secondary" title={pickOpen ? 'Collapse this section' : 'Expand'}>{pickOpen ? '▲ Collapse' : `▼ Logos (${storeArt.length})`}</button>
          </div>
        </div>
        {pickOpen && (<>
        {storeArt.length === 0 && !addOpen && <div style={{ fontSize: 13, color: '#64748b', padding: '4px 2px 8px' }}>No art chosen for this store yet — click <b>+ Add from library</b> to pick which logos belong on it.</div>}
        {storeArt.length > 0 && <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {storeArt.map((a) => {
            const u = artThumbUrl(a);
            const on = a.id === activeId;
            // Multiple color ways → let the rep tab through each CW's web logo on its garment
            // color, to eyeball that every color way's art is ready. pickCwAsset resolves the
            // right cutout per CW (real variant, else the shared default); garmentHex paints it.
            const cwList = (a.color_ways || []).filter((c) => c && (c.garment_color || '').trim());
            const views = cwList.length >= 2
              ? cwList.map((cw) => ({ label: cw.garment_color, url: pickCwAsset(a, { kind: 'web_logo', colorWayId: cw.id }) || u, bg: garmentHex(cw.garment_color) }))
              : [{ label: '', url: u, bg: u ? logoThumbBg(a, u) : '#f8fafc' }];
            const multi = views.length > 1;
            const idx = Math.min(logoCwIdx[a.id] || 0, views.length - 1);
            const view = views[idx] || views[0];
            const goIdx = (i) => setLogoCwIdx((m) => ({ ...m, [a.id]: (i + views.length) % views.length }));
            return (
            <div key={a.id} style={{ position: 'relative', flex: '0 0 auto', width: 96 }}>
              <button onClick={() => setActiveId(a.id)} title={a.name} style={{ width: 96, border: on ? '2px solid #191919' : '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: 6, cursor: 'pointer' }}>
                <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: view.url ? view.bg : '#f8fafc', borderRadius: 6, overflow: 'hidden', boxShadow: view.url ? 'inset 0 0 0 1px rgba(0,0,0,.06)' : 'none' }}>
                  {view.url ? <img src={view.url} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} /> : <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textAlign: 'center', padding: '0 4px' }}>{(a.files || [])[0] ? 'AI only — add a web logo' : 'Add a web logo'}</span>}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Logo'}</div>
                {decoBadge(a.deco_type) && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}><DecoBadge deco={a.deco_type} /></div>}
              </button>
              {multi && <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                  <button onClick={() => goIdx(idx - 1)} title="Previous color way" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13, lineHeight: 1, padding: '0 2px' }}>‹</button>
                  {views.length <= 6 ? views.map((v, i) => <button key={i} onClick={() => goIdx(i)} title={v.label || `Color way ${i + 1}`} aria-label={v.label || `Color way ${i + 1}`} style={{ width: i === idx ? 14 : 6, height: 6, borderRadius: 3, border: 'none', padding: 0, cursor: 'pointer', background: i === idx ? '#191919' : '#cbd5e1', transition: 'width .15s' }} />) : <span style={{ fontSize: 9.5, fontWeight: 700, color: '#64748b' }}>{idx + 1}/{views.length}</span>}
                  <button onClick={() => goIdx(idx + 1)} title="Next color way" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13, lineHeight: 1, padding: '0 2px' }}>›</button>
                </div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#475569', textAlign: 'center', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={view.label}>{view.label || '—'}</div>
              </div>}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}><WebLogoSlot art={a} onAttach={onAttachWebLogo} compact /></div>
              <button onClick={() => toggleStoreArt(a)} title="Remove from this store" style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#b91c1c', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', lineHeight: '20px', textAlign: 'center', padding: 0 }}>×</button>
            </div>
          ); })}
        </div>}
        {addOpen && <div style={{ marginTop: 10, border: '1px solid #eef2f7', borderRadius: 10, background: '#f8fafc', padding: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Customer's full art library — tap to add/remove from this store ({(storeArt || []).length} selected):</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(94px,1fr))', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {libraryArt.map((a) => { const u = artThumbUrl(a); const sel2 = inStore(a.id); return (
              <div key={a.id} style={{ position: 'relative' }}>
                <button onClick={() => toggleStoreArt(a)} title={a.name} style={{ position: 'relative', width: '100%', border: sel2 ? '2px solid #166534' : '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: 6, cursor: 'pointer' }}>
                  <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: u ? logoThumbBg(a, u) : '#f8fafc', borderRadius: 6, overflow: 'hidden', boxShadow: u ? 'inset 0 0 0 1px rgba(0,0,0,.06)' : 'none' }}>
                    {u ? <img src={u} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 700, textAlign: 'center', padding: '0 3px' }}>{(a.files || [])[0] ? 'AI — add web logo' : 'Add web logo'}</span>}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Logo'}</div>
                  {decoBadge(a.deco_type) && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 3 }}><DecoBadge deco={a.deco_type} /></div>}
                  {sel2 && <span style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: '#166534', color: '#fff', fontSize: 11, fontWeight: 800, lineHeight: '18px', textAlign: 'center' }}>✓</span>}
                </button>
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 3 }}><WebLogoSlot art={a} onAttach={onAttachWebLogo} compact /></div>
              </div>
            ); })}
          </div>
        </div>}
        {!activeUrl && activeArt && <div style={{ marginTop: 10, fontSize: 12.5, color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>This logo has no web-ready image (likely .ai / mockup only). Attach a clean transparent PNG or SVG to place &amp; recolor it: <WebLogoSlot art={activeArt} onAttach={onAttachWebLogo} /></div>}
        </>)}
      </div></div>

      {/* 2 · Bulk apply — opt-in. After bringing art in, the rep chooses to bulk-apply
          a logo: pick a starting placement, select items, Autocolor + drag to fine-tune,
          then apply & review them together. */}
      {activeArt && (!bulkOpen ? (
        <button onClick={() => activeUrl && setBulkOpen(true)} disabled={!activeUrl}
          style={{ width: '100%', textAlign: 'left', cursor: activeUrl ? 'pointer' : 'not-allowed', border: '1px solid #c7d2fe', background: activeUrl ? '#eef2ff' : '#f1f5f9', color: '#3730a3', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span><span style={{ fontSize: 15, fontWeight: 800 }}>Place “{activeArt.name || 'this logo'}” on items →</span><br /><span style={{ fontSize: 12.5, color: activeUrl ? '#4f46e5' : '#94a3b8' }}>{activeUrl ? 'Pick the garments, Autocolor the right logo per color, drag to fine-tune, then apply.' : 'Attach a web logo above first.'}</span></span>
        </button>
      ) : (
        <div className="card"><div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Place <span style={{ color: '#4f46e5' }}>{activeArt.name || 'logo'}</span> on garments</div>
            <button onClick={() => setBulkOpen(false)} className="btn btn-sm btn-secondary">✕ Close</button>
          </div>

          {/* 1 · Placement — a starting preset; drag on any garment to fine-tune per style */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5 }}>1 · Placement</span>
            {ART_PLACEMENTS.map((p) => (
              <button key={p.id} onClick={() => choosePlacement(p.id)} style={{ borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: placement === p.id ? '1px solid #191919' : '1px solid #d1d5db', background: placement === p.id ? '#191919' : '#fff', color: placement === p.id ? '#fff' : '#3A4150' }}>{p.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 14 }}>Starting point — each card is one style; <b>‹ ›</b> pages through its colors. <b>Drag the logo</b> to fine-tune (or its corner to resize) and every color follows. <b>⤢ nudge</b> adjusts just the shown color; <b>+ Back</b> adds a back logo to that style.</div>

          {/* 2 · Select styles + Autocolor — one card per style; page through its colors */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5 }}>2 · Select styles <span style={{ fontWeight: 600, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>· tap the cards — a style covers all its colors ({selectedGroups.length} of {groups.length})</span></div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={autocolorSelected} disabled={!allItems.length} title={includedItems.length ? 'Auto-pick the right logo color for every color of the selected styles (light logo on dark garments, dark on light — using your real color-way variants when the logo has them)' : 'One click: select EVERY style in the store and auto-pick the right logo color for each garment color'} style={{ fontSize: 12.5, fontWeight: 800, borderRadius: 999, padding: '6px 14px', cursor: allItems.length ? 'pointer' : 'not-allowed', border: 'none', background: allItems.length ? 'linear-gradient(135deg,#7c3aed,#a78bfa)' : '#e2e8f0', color: '#fff' }}>✨ Autocolor{includedItems.length ? '' : ' store'}</button>
              <button onClick={selectAll} className="btn btn-sm btn-secondary">Select all</button>
              <button onClick={clearSel} className="btn btn-sm btn-secondary" disabled={!selectedGroups.length}>Clear</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16, alignItems: 'start' }}>
          {groups.map((g) => {
            const selG = selected.has(g.key);
            const item = activeItemOf(g);
            const multi = g.items.length > 1;
            const idx = g.items.indexOf(item);
            const showBack = selG && flipped.has(g.key);
            const sideNow = showBack ? 'back' : 'front';
            const hasBack = !!backByStyle[g.key];
            const pick = pickFor(item);
            const pl = showBack ? backPlaceFor(g) : placeForItem(item);
            const bgImg = showBack ? item.backImg : item.img;
            const previewUrl = pick.kind === 'variant' ? pick.url : activeUrl;
            const previewFilter = pick.kind === 'variant' ? 'none' : cssTint(pick.choice);
            const has = g.items.some((it) => (it.decorations || []).some((d) => d && d.art_id === activeArt.id));
            const nudged = !!placeByItem[item.id];
            const navBtn = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: '50%', border: '1px solid #e2e8f0', background: 'rgba(255,255,255,.94)', color: '#334155', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.14)', padding: 0, zIndex: 3, lineHeight: 1 };
            return (
            <div key={g.key} onClick={() => { if (!selG) toggleStyle(g.key); }} title={selG ? '' : 'Tap to select this style'} style={{ border: selG ? '2px solid #4f46e5' : '1px solid #e2e8f0', borderRadius: 12, padding: 8, background: '#fff', cursor: selG ? 'default' : 'pointer', boxShadow: selG ? '0 2px 10px rgba(79,70,229,.10)' : 'none' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={g.name}>{g.name}</div>
              {/* WYSIWYG: this stage must render EXACTLY like the storefront card (4:5, cover)
                  — %-placement maps to a different visible spot if the crop/frame differs. */}
              <div ref={(el) => { if (el) boxRefs.current[g.key] = el; else delete boxRefs.current[g.key]; }} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}
                style={{ position: 'relative', aspectRatio: '4 / 5', background: '#fff', border: '1px solid #f1f5f9', borderRadius: 9, overflow: 'hidden', touchAction: selG ? 'none' : 'auto' }}>
                {bgImg ? <img src={bgImg} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 11 }}>No {sideNow} image</div>}
                {/* logos already on the shown color+side (other than the one we're placing) —
                    resolved per color (cw_by_color / web-logo variant), never the raw art_url,
                    which may be a different color's cutout. */}
                {(item.decorations || []).filter((d) => d && !d.baked && (d.side || 'front') === sideNow && !isPerso(d) && !(selG && d.art_id === activeArt.id)).map((d, di) => { const dp = ART_PLACEMENTS.find((x) => x.id === d.placement) || place; const dx = d.x != null ? d.x : dp.x; const dy = d.y != null ? d.y : dp.y; const dw = d.w != null ? d.w : dp.w; const wl = ((storeArt || []).find((a) => a.id === d.art_id) || libraryArt.find((a) => a.id === d.art_id) || {}).web_logos; const u = decoUrlForColor(d, item.color, wl); return u ? <img key={'ad' + di} src={u} alt="" draggable={false} style={{ position: 'absolute', left: `${dx}%`, top: `${dy}%`, width: `${dw}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} /> : null; })}
                {/* the logo being placed — draggable; corner square resizes; moves the whole style */}
                {activeUrl && selG && bgImg && (
                  <div onPointerDown={(e) => startDrag(e, g, item, 'move', sideNow)} style={{ position: 'absolute', left: `${pl.x}%`, top: `${pl.y}%`, width: `${pl.w}%`, transform: 'translate(-50%,-50%)', cursor: 'move', outline: '2px solid rgba(79,70,229,.7)', outlineOffset: 1, touchAction: 'none', zIndex: 2 }}>
                    <img src={previewUrl} alt="" draggable={false} style={{ display: 'block', width: '100%', filter: previewFilter, pointerEvents: 'none' }} />
                    <div onPointerDown={(e) => startDrag(e, g, item, 'resize', sideNow)} title="Drag to resize" style={{ position: 'absolute', right: -7, bottom: -7, width: 14, height: 14, borderRadius: 4, background: '#4f46e5', border: '2px solid #fff', cursor: 'nwse-resize', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                  </div>
                )}
                {/* color paging — browse colors without selecting the card */}
                {multi && <button onClick={(e) => { e.stopPropagation(); pageColor(g, -1); }} onPointerDown={(e) => e.stopPropagation()} title="Previous color" aria-label="Previous color" style={{ ...navBtn, left: 6 }}>‹</button>}
                {multi && <button onClick={(e) => { e.stopPropagation(); pageColor(g, 1); }} onPointerDown={(e) => e.stopPropagation()} title="Next color" aria-label="Next color" style={{ ...navBtn, right: 6 }}>›</button>}
                <button onClick={(e) => { e.stopPropagation(); toggleStyle(g.key); }} title={selG ? 'Deselect style' : 'Select style'} style={{ position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 6, background: selG ? '#4f46e5' : 'rgba(255,255,255,.92)', border: selG ? 'none' : '1px solid #cbd5e1', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.18)', cursor: 'pointer', padding: 0, zIndex: 3 }}>{selG ? '✓' : ''}</button>
                {showBack && <span style={{ position: 'absolute', top: 6, right: 6, background: '#0f172a', color: '#fff', fontSize: 8.5, fontWeight: 800, padding: '2px 6px', borderRadius: 5, textTransform: 'uppercase', zIndex: 3 }}>Back</span>}
                {!showBack && selG && hasBack && <span title="This style also gets a back logo" style={{ position: 'absolute', top: 6, right: 6, background: '#0f172a', color: '#fff', fontSize: 8.5, fontWeight: 800, padding: '2px 6px', borderRadius: 5, textTransform: 'uppercase', zIndex: 3 }}>+ Back</span>}
                {!selG && has && <span style={{ position: 'absolute', top: 6, right: 6, background: '#166534', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5, textTransform: 'uppercase', zIndex: 3 }}>Applied</span>}
                {nudged && !showBack && selG && <span title="This color has its own placement" style={{ position: 'absolute', bottom: 6, left: 6, background: '#b45309', color: '#fff', fontSize: 8.5, fontWeight: 800, padding: '2px 5px', borderRadius: 5, textTransform: 'uppercase', zIndex: 3 }}>Nudged</span>}
              </div>
              {/* color name + pager dots */}
              <div style={{ marginTop: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.color || '—'}{multi && <span style={{ fontWeight: 600, color: '#94a3b8' }}> · {idx + 1}/{g.items.length}</span>}</div>
                {multi && g.items.length <= 8 && (
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                    {g.items.map((it, i) => <button key={it.id} onClick={() => setActiveIdx((m) => ({ ...m, [g.key]: i }))} title={it.color || `Color ${i + 1}`} aria-label={it.color || `Color ${i + 1}`} style={{ width: i === idx ? 16 : 6, height: 6, borderRadius: 3, border: 'none', padding: 0, cursor: 'pointer', background: i === idx ? '#4f46e5' : '#cbd5e1', transition: 'width .15s' }} />)}
                  </div>
                )}
              </div>
              {selG && <div style={{ marginTop: 7 }} onClick={(e) => e.stopPropagation()}>
                {/* Logo color for the SHOWN color (Autocolor sets all colors at once) */}
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: '#94a3b8', marginBottom: 3 }}>Logo on {item.color || 'this color'}</div>
                {variants.length >= 2 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    {variants.map((v) => { const on = pick.kind === 'variant' && pick.url === v.url; return (
                      <button key={v.url} onClick={() => setPick(item.id, { kind: 'variant', url: v.url, colorWayId: v.color_way_id || null, label: v.color_way || '' })} title={`Use the ${v.color_way || 'default'} version on ${item.color || 'this color'}`} style={{ fontSize: 9.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, cursor: 'pointer', border: on ? '1px solid #4f46e5' : '1px solid #d1d5db', background: on ? '#4f46e5' : '#fff', color: on ? '#fff' : '#475569' }}>{v.color_way || 'Default'}</button>
                    ); })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['original', 'Orig'], ['white', 'White'], ['black', 'Black']].map(([c, lbl]) => { const on = pick.kind === 'recolor' && pick.choice === c; return (
                    <button key={c} onClick={() => setPick(item.id, { kind: 'recolor', choice: c })} title={`Recolor the base cutout: ${lbl}`} style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 6, cursor: 'pointer', border: on ? '1px solid #191919' : '1px solid #d1d5db', background: on ? '#191919' : '#fff', color: on ? '#fff' : '#475569' }}>{lbl}</button>
                  ); })}
                </div>
                {/* Rep self-serve: save this recolored cutout as a real per-CW web logo */}
                {onSaveRepWebLogo && pick.kind === 'recolor' && <button onClick={() => startRepSave(item)} disabled={repBusy} title="Save this recolored logo to the art library as a reusable web logo tied to a color way" style={{ width: '100%', fontSize: 9.5, fontWeight: 700, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '3px 8px', marginTop: 4, cursor: repBusy ? 'wait' : 'pointer' }}>{repBusy ? 'Saving…' : '💾 Save recolor as web logo'}</button>}
                {/* Front/Back + placement controls */}
                <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(item.backImg || hasBack) && (
                    <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                      <button onClick={() => flipSide(g.key, false)} title="Front" style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', cursor: 'pointer', border: 'none', background: !showBack ? '#0f172a' : '#fff', color: !showBack ? '#fff' : '#475569' }}>Front</button>
                      <button onClick={() => (hasBack ? flipSide(g.key, true) : addBack(g))} title={hasBack ? 'View / edit the back logo' : 'Add a back logo to this style'} style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', cursor: 'pointer', border: 'none', borderLeft: '1px solid #e2e8f0', background: showBack ? '#0f172a' : '#fff', color: showBack ? '#fff' : (hasBack ? '#0f172a' : '#94a3b8') }}>{hasBack ? 'Back' : '+ Back'}</button>
                    </div>
                  )}
                  {hasBack && <button onClick={() => removeBack(g.key)} title="Remove the back logo from this style" style={{ fontSize: 9.5, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '2px 7px', cursor: 'pointer' }}>✕ back</button>}
                  {!showBack && (nudged
                    ? <button onClick={() => clearNudge(item.id)} title="Reset this color to the style placement" style={{ fontSize: 9.5, fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '2px 7px', cursor: 'pointer' }}>↺ reset</button>
                    : <button onClick={() => setNudgeItem(nudgeItem === item.id ? null : item.id)} title="Drag this color's logo without moving the rest of the style" style={{ fontSize: 9.5, fontWeight: 700, color: nudgeItem === item.id ? '#4f46e5' : '#94a3b8', background: nudgeItem === item.id ? '#eef2ff' : '#fff', border: '1px solid ' + (nudgeItem === item.id ? '#c7d2fe' : '#e2e8f0'), borderRadius: 6, padding: '2px 7px', cursor: 'pointer' }}>{nudgeItem === item.id ? '⤢ nudging' : '⤢ nudge'}</button>)}
                </div>
              </div>}
            </div>
          ); })}
          </div>

          {/* Sticky apply bar */}
          <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e6e8ec', padding: '12px 4px', marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {done && <span style={{ fontSize: 12.5, color: done.startsWith('Error') ? '#b91c1c' : '#166534', fontWeight: 700 }}>{done}</span>}
            <span style={{ fontSize: 12.5, color: '#64748b' }}>{selectedGroups.length} style{selectedGroups.length === 1 ? '' : 's'} · {includedItems.length} garment{includedItems.length === 1 ? '' : 's'}{(() => { const b = selectedGroups.filter((g2) => backByStyle[g2.key]).length; return b ? ` · ${b} w/ back` : ''; })()}{activeArt ? ` · ${activeArt.name}` : ''}</span>
            <button className="btn btn-secondary" disabled={applying || !selectedGroups.length} onClick={() => apply({ linkOnly: true })} title="Bypass mockups: link this art to the selected styles for production (art, placement & method) without putting a logo on the image — for OMG stores whose product photos already show the decoration.">{applying ? '…' : `Bypass mocks · link art${selectedGroups.length ? ` to ${selectedGroups.length}` : ''}`}</button>
            <button className="btn btn-primary" disabled={applying || !activeUrl || !selectedGroups.length} onClick={() => apply()}>{applying ? 'Applying…' : selectedGroups.length ? `Apply to ${selectedGroups.length} style${selectedGroups.length === 1 ? '' : 's'}` : 'Select styles to apply'}</button>
          </div>
        </div></div>
      ))}

      {/* Rep self-serve: which color way does this saved web logo belong to? */}
      {repSave && (
        <div onClick={() => !repBusy && setRepSave(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 420, margin: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Save web logo for which color way?</div>
              <button onClick={() => !repBusy && setRepSave(null)} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <img src={repSave.url} alt="" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 8, border: '1px solid #eef2f7', background: '#f8fafc' }} />
                <div style={{ fontSize: 12, color: '#64748b' }}>Saved to <b>{activeArt && activeArt.name}</b>'s art library and reusable on every store.</div>
              </div>
              {(activeArt && activeArt.color_ways || []).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: '#94a3b8' }}>Existing color ways</div>
                  {(activeArt.color_ways || []).map((cw, ci) => <button key={cw.id || ci} disabled={repBusy} onClick={() => confirmRepSave(cw.garment_color || ('Color way ' + (ci + 1)))} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: repBusy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600, color: '#1e293b' }}><span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#64748b', borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>CW {ci + 1}</span>{cw.garment_color || ('Color way ' + (ci + 1))}</button>)}
                </div>
              )}
              <div style={{ paddingTop: 12, borderTop: '1px solid #eef2f7' }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: '#94a3b8', marginBottom: 6 }}>Or create a new color way</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={repNewCw} onChange={(e) => setRepNewCw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && repNewCw.trim()) confirmRepSave(repNewCw.trim()); }} placeholder="e.g. Navy, White" style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }} />
                  <button className="btn btn-primary" disabled={repBusy || !repNewCw.trim()} onClick={() => confirmRepSave(repNewCw.trim())}>Create &amp; save</button>
                </div>
                <button disabled={repBusy} onClick={() => confirmRepSave('')} style={{ marginTop: 10, fontSize: 11.5, fontWeight: 700, color: '#475569', background: 'none', border: 'none', cursor: repBusy ? 'wait' : 'pointer', padding: 0 }}>or save as the “all garments” default →</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Components are selected via the checkboxes on the catalog list (controlled by
// the parent); this panel just names/prices the package and tunes per-item options.
function BundleBuilder({ components = [], setComponents, designOptions = [], numberSets = [], categories = [], onCreate, onClose }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [fundraise, setFundraise] = useState('');
  const [category, setCategory] = useState('');
  const [image, setImage] = useState(null);
  const [picking, setPicking] = useState(false);
  const priceTouched = useRef(false);
  const catListId = 'pkg-cat-suggest';
  // ProductSearch (non-store products) returns {id,sku,name}.
  const addComp = (p) => { setComponents((c) => [...c, { webstore_product_id: p.webstore_product_id || null, product_id: p.product_id || p.id, sku: p.sku, name: p.name, image: p.image || null, retail_price: Number(p.retail_price) || 0, qty: 1, size_required: true, takes_number: false, takes_name: false, name_upcharge: 0, transfer_code: '', num_transfer_size: null, num_transfer_color: null }]); setPicking(false); };
  const upd = (i, k, v) => setComponents((c) => c.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  const rm = (i) => setComponents((c) => c.filter((_, idx) => idx !== i));
  // Sum the items' retail prices — default the package price to it (rep can then
  // discount); stop auto-filling once the price is hand-edited.
  const itemsTotal = components.reduce((a, c) => a + (Number(c.retail_price) || 0) * (Number(c.qty) || 1), 0);
  useEffect(() => { if (!priceTouched.current && itemsTotal > 0) setPrice(itemsTotal.toFixed(2)); }, [itemsTotal]);
  const valid = name.trim() && Number(price) > 0 && components.length > 0;
  const reason = !components.length ? 'Check the items on the left to add them' : !name.trim() ? 'Enter a package name' : !(Number(price) > 0) ? 'Enter a package price' : '';
  const total = (Number(price) || 0) + (Number(fundraise) || 0);
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><div style={{ fontWeight: 700 }}>Create a package <span style={{ fontWeight: 500, fontSize: 12, color: '#94a3b8' }}>· check items in the list to add them</span></div><button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>×</button></div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <Row label="Package name *"><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Player Kit" style={{ borderColor: !name.trim() ? '#fca5a5' : undefined }} /></Row>
        <Row label="Category / section"><input className="form-input" list={catListId} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Player Kits" /><datalist id={catListId}>{categories.map((c) => <option key={c} value={c} />)}</datalist></Row>
        <Row label="Package price *"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => { priceTouched.current = true; setPrice(e.target.value); }} placeholder="120.00" style={{ borderColor: !(Number(price) > 0) ? '#fca5a5' : undefined }} /></Row>
        <Row label="Fundraising on top (Y)"><input className="form-input" type="number" step="0.01" value={fundraise} onChange={(e) => setFundraise(e.target.value)} placeholder="0.00" /></Row>
        <Row label="Shopper pays"><div className="form-input" style={{ background: '#f8fafc', fontWeight: 700 }}>{money(total)}</div></Row>
      </div>
      {itemsTotal > 0 && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Items add up to <b>{money(itemsTotal)}</b>{Number(price) > 0 && Math.abs(Number(price) - itemsTotal) > 0.005 ? <> · package is {money(Number(price))} (<button type="button" onClick={() => { priceTouched.current = true; setPrice(itemsTotal.toFixed(2)); }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 700, fontSize: 12, padding: 0 }}>use sum</button>)</> : null}</div>}
      <ImageUpload value={image} onChange={setImage} label="Package image" />
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Items in this package <span style={{ fontWeight: 500, color: '#94a3b8' }}>({components.length})</span></div>
      {components.length === 0
        ? <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '10px 12px', border: '1.5px dashed #d7dbe2', borderRadius: 10, background: '#fafbfc' }}>← Tick the checkbox next to each item in the list to add it to this package.</div>
        : <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{components.map((c, i) => {
          const persoNote = [c.takes_number && 'number', c.takes_name && 'name'].filter(Boolean).join(' + ');
          return (
          <div key={c.webstore_product_id || c.product_id || i} style={{ width: 152, border: '1px solid #e6e8ec', borderRadius: 10, overflow: 'hidden', background: '#fff', position: 'relative' }}>
            <button onClick={() => rm(i)} title="Remove from package" style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,.95)', border: '1px solid #e2e8f0', color: '#b91c1c', cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'grid', placeItems: 'center', zIndex: 1 }}>×</button>
            <div style={{ width: '100%', height: 112, background: '#f4f6f9', display: 'grid', placeItems: 'center' }}>
              {c.image ? <img src={c.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6, boxSizing: 'border-box' }} /> : <span style={{ fontSize: 10, color: '#cbd5e1' }}>No image</span>}
            </div>
            <div style={{ padding: '8px 10px' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>{c.name}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.retail_price > 0 ? money(c.retail_price) : c.sku}{persoNote ? ` · ${persoNote}` : ''}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Qty</span>
                <input type="number" min={1} value={c.qty} onChange={(e) => upd(i, 'qty', Number(e.target.value) || 1)} style={{ width: 50 }} />
              </div>
            </div>
          </div>
        ); })}</div>}
      {picking ? <ProductSearch label="Add a product not in this store" onPick={addComp} onClose={() => setPicking(false)} /> :
        <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => setPicking(true)}>+ Add a product not in this store</button>}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" disabled={!valid} onClick={() => onCreate({ name: name.trim(), price: Number(price), fundraise: Number(fundraise) || 0, image_url: image, components, category: category.trim() || null })}>Create package</button>
        {!valid && <span style={{ fontSize: 12.5, color: '#b45309', fontWeight: 700 }}>{reason} (image optional)</span>}
      </div>
    </div></div>
  );
}

// Coupons / scholarship codes. Bulk-generate single-use % codes for coaches,
// or free-shipping promos. Redemption count is tracked per code.
function CouponsTab({ store, coupons = [], orders = [], onCreate, onUpdate, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState('single'); // 'single' | 'bulk'
  const [customCode, setCustomCode] = useState('');
  const [kind, setKind] = useState('percent');
  const [value, setValue] = useState(10);
  const [count, setCount] = useState(10);
  const [single, setSingle] = useState(false);
  const [coverShip, setCoverShip] = useState(true);
  const [prefix, setPrefix] = useState('');
  const [label, setLabel] = useState('');
  const [expires, setExpires] = useState('');
  const [generated, setGenerated] = useState(null);

  const usedByCode = {};
  orders.forEach((o) => { if (o.coupon_code && o.status !== 'cancelled' && o.status !== 'pending_payment') { const k = o.coupon_code.toUpperCase(); usedByCode[k] = (usedByCode[k] || 0) + 1; } });

  const submit = async () => {
    if (mode === 'single') {
      const code = customCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!code) return;
      const r = await onCreate({ kind, value, count: 1, single, prefix: '', batch_label: label, expires_at: expires || null, cover_shipping: coverShip, code });
      if (r && r.data) { setGenerated(r.data.map((c) => c.code)); setAdding(false); setCustomCode(''); }
    } else {
      const r = await onCreate({ kind, value, count, single: true, prefix, batch_label: label, expires_at: expires || null, cover_shipping: coverShip });
      if (r && r.data) { setGenerated(r.data.map((c) => c.code)); setAdding(false); }
    }
  };
  const copyAll = () => { if (generated) navigator.clipboard?.writeText(generated.join('\n')); };

  const sorted = [...coupons].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>Discount codes families enter at checkout. Use named codes (e.g. TEAM10) for store-wide promos, or bulk-generate single-use codes for comping individual players.</div>
        <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { setAdding((v) => !v); setGenerated(null); }}>+ Add code</button>
      </div>

      {adding && <div className="card"><div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setMode('single')} style={{ padding: '6px 14px', borderRadius: 8, border: '2px solid', borderColor: mode === 'single' ? '#0b1f3a' : '#e2e8f0', background: mode === 'single' ? '#0b1f3a' : '#fff', color: mode === 'single' ? '#fff' : '#0b1f3a', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Named code</button>
          <button onClick={() => setMode('bulk')} style={{ padding: '6px 14px', borderRadius: 8, border: '2px solid', borderColor: mode === 'bulk' ? '#0b1f3a' : '#e2e8f0', background: mode === 'bulk' ? '#0b1f3a' : '#fff', color: mode === 'bulk' ? '#fff' : '#0b1f3a', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Bulk single-use</button>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {mode === 'single' ? (
            <Row label="Code (letters & numbers)"><input className="form-input" value={customCode} onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="e.g. TEAM10" style={{ width: 160, fontFamily: 'monospace', fontWeight: 700 }} /></Row>
          ) : (
            <>
              <Row label="How many codes"><input className="form-input" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 90 }} /></Row>
              <Row label="Code prefix (optional)"><input className="form-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="SCHOL" style={{ width: 120 }} /></Row>
            </>
          )}
          <Row label="Type"><select className="form-select" value={kind} onChange={(e) => setKind(e.target.value)}><option value="percent">Percent off</option><option value="free_shipping">Free shipping</option></select></Row>
          {kind === 'percent' && <Row label="Percent off"><input className="form-input" type="number" min={1} max={100} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 90 }} /></Row>}
          <Row label="Batch label (optional)"><input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Spring promo" /></Row>
          <Row label="Expires (optional)"><input className="form-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Row>
          {mode === 'single' && <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}><input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} /> Single-use</label>}
          {kind === 'percent' && <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}><input type="checkbox" checked={coverShip} onChange={(e) => setCoverShip(e.target.checked)} /> Also discount shipping</label>}
          <button className="btn btn-primary" onClick={submit}>{mode === 'bulk' ? 'Generate' : 'Create'}</button>
          <button className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      </div></div>}

      {generated && <div className="card" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}><div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: '#166534' }}>{generated.length} code{generated.length === 1 ? '' : 's'} created — send to the coach</div>
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={copyAll}>Copy all</button>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 13, columnWidth: 120, color: '#0b1220' }}>{generated.map((c) => <div key={c}>{c}</div>)}</div>
      </div></div>}

      {sorted.length === 0 ? <Empty msg="No coupon codes yet." /> : (
        <div className="card"><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}><th style={th}>Code</th><th style={th}>Discount</th><th style={th}>Batch</th><th style={th}>Used</th><th style={th}>Expires</th><th style={th}>Active</th><th style={th}></th></tr></thead>
            <tbody>
              {sorted.map((c) => {
                const used = usedByCode[(c.code || '').toUpperCase()] || 0;
                const exhausted = c.max_uses != null && used >= c.max_uses;
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}>{c.code}</td>
                    <td style={td}>{c.kind === 'free_shipping' ? 'Free shipping' : `${c.value}% off${c.cover_shipping !== false ? ' + shipping' : ''}`}</td>
                    <td style={{ ...td, color: '#64748b' }}>{c.batch_label || '—'}</td>
                    <td style={td}>{used}{c.max_uses != null ? ` / ${c.max_uses}` : ''}{exhausted && <span style={{ color: '#b91c1c', fontWeight: 700 }}> ·used up</span>}</td>
                    <td style={{ ...td, color: '#64748b' }}>{c.expires_at || '—'}</td>
                    <td style={td}><button onClick={() => onUpdate(c.id, { active: !c.active })} style={{ background: c.active ? '#dcfce7' : '#f1f5f9', color: c.active ? '#166534' : '#94a3b8', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{c.active ? 'Active' : 'Off'}</button></td>
                    <td style={{ ...td, textAlign: 'right' }}><button onClick={() => onRemove(c.id)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>delete</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}

// Store analytics — computed live from orders.
function AnalyticsTab({ store, orders: allOrders, orderItems, stockByWp, catalog = [], libraryArt = [] }) {
  // Exclude abandoned pre-payment carts and cancellations from analytics.
  const orders = allOrders.filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled');
  if (!orders.length) return <Empty msg="No orders yet — analytics will appear once shoppers start ordering." />;
  const nameBySku = {}; Object.values(stockByWp).forEach((s) => { if (s.sku) nameBySku[s.sku] = s.name; });
  // Catalog (with placed decorations) + art names, for the decoration breakdown.
  const catByPid = {}; (catalog || []).forEach((c) => { if (c.product_id) catByPid[c.product_id] = c; });
  const catBySku = {}; (catalog || []).forEach((c) => { if (c.sku) catBySku[String(c.sku).toUpperCase()] = c; });
  const artName = {}; (libraryArt || []).forEach((a) => { if (a && a.id) artName[a.id] = a.name || 'Logo'; });
  const revenue = orders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const r2f = (n) => Math.round((Number(n) || 0) * 100) / 100;
  // Fundraising the club is actually owed on an order = its fundraise_amt, less the share of
  // any coupon discount that came off the pot. Checkout applies the % to subtotal + fundraise
  // together, so a discounted order collected proportionally less fundraising, and a 100%-off
  // order collected none — paying the club the gross fundraise_amt overpaid them on every
  // discounted order.
  const netFundraise = (o) => {
    const sub = Number(o.subtotal) || 0, fund = Number(o.fundraise_amt) || 0;
    if (fund <= 0) return 0;
    const base = sub + fund;
    if (base <= 0) return r2f(fund);
    const disc = Math.min(Number(o.discount_amt) || 0, base);
    return Math.max(0, r2f(fund - disc * (fund / base)));
  };
  const fundGross = orders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const shipCollected = orders.reduce((a, o) => a + (Number(o.shipping_fee) || 0), 0);
  const shipCost = orders.reduce((a, o) => a + (Number(o.label_cost) || 0), 0);
  const shipNet = shipCollected - shipCost;
  // "Collected & owed" counts fundraising on every card-paid order through its whole
  // lifecycle (paid → batched → shipped → complete), NOT just status==='paid' — the old test
  // dropped every batched order and cratered the payout right after the rep batched the store.
  // Team-tab / unpaid orders bill on the club invoice, so their fundraising is still "pending".
  // Fully-refunded orders (status 'refunded') owe nothing.
  const nonRefunded = orders.filter((o) => o.status !== 'refunded');
  const fundOwed = r2f(nonRefunded.reduce((a, o) => a + netFundraise(o), 0));
  const fundPaid = r2f(nonRefunded.filter((o) => o.payment_mode === 'paid').reduce((a, o) => a + netFundraise(o), 0));
  const fundPending = r2f(Math.max(0, fundOwed - fundPaid));
  const paid = orders.filter((o) => o.payment_mode === 'paid');

  // ── Accounting ledger — every dollar in and out of the store ──
  // Reconciliation (per checkout): total = subtotal − discount + fundraise + shipping + tax.
  // cc_fee and label_cost are booked after the sale (Stripe / postage) and are costs, not
  // money a buyer paid us. Team-tab orders collect $0 through the store — that balance is
  // billed to the club on the Sales Order / invoice instead of a card.
  const sumF = (f) => orders.reduce((a, o) => a + (Number(o[f]) || 0), 0);
  const acct = {
    grossSales: sumF('subtotal'),      // product retail before discounts
    discounts: sumF('discount_amt'),   // coupon savings given to buyers
    fundraiseAll: sumF('fundraise_amt'),
    shipCharged: sumF('shipping_fee'),
    processing: sumF('processing_fee'),
    taxColl: sumF('tax'),
    grossColl: sumF('total'),          // what every live order was billed
    refunds: sumF('refunded_amt'),
    ccFees: sumF('cc_fee'),
    labelCost: sumF('label_cost'),
  };
  acct.netColl = acct.grossColl - acct.refunds;
  acct.netAfterFees = acct.netColl - acct.ccFees - acct.labelCost;
  const cardColl = paid.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const tabColl = acct.grossColl - cardColl;

  // Scope line items to LIVE orders only — orderItems carries items for every order
  // in the store (incl. abandoned pre-payment carts and cancellations), which would
  // otherwise inflate Units, Top sellers, and the Size breakdown.
  const liveIds = new Set(orders.map((o) => o.id));
  const lines = orderItems.filter((i) => !i.is_bundle_parent && liveIds.has(i.order_id));
  const units = lines.reduce((a, i) => a + (i.qty || 1), 0);
  // Packages: each purchased package is one bundle-parent line. Reported for
  // reference + club fundraising (we sometimes pay the club per package). The
  // components still ship/report as individual items via the non-parent lines.
  const pkgLines = orderItems.filter((i) => i.is_bundle_parent && liveIds.has(i.order_id));
  const packagesSold = pkgLines.reduce((a, i) => a + (i.qty || 1), 0);
  const pkgFund = pkgLines.reduce((a, i) => a + (Number(i.unit_fundraise) || 0) * (i.qty || 1), 0);
  const byPkg = {}; pkgLines.forEach((i) => { const k = i.name || 'Package'; byPkg[k] = (byPkg[k] || 0) + (i.qty || 1); });
  const pkgRows = Object.entries(byPkg).sort((a, b) => b[1] - a[1]);

  // Top sellers keyed by product, labelled with the real item name (the order line
  // stores it; fall back to the storefront catalog name, then sku).
  const byProd = {}; lines.forEach((i) => {
    const k = i.sku || i.product_id || '?';
    if (!byProd[k]) byProd[k] = { q: 0, name: i.name || nameBySku[i.sku] || '' };
    byProd[k].q += (i.qty || 1);
    if (!byProd[k].name && i.name) byProd[k].name = i.name;
  });
  const topSellers = Object.entries(byProd).map(([sku, v]) => ({ sku, q: v.q, name: v.name || nameBySku[sku] || sku })).sort((a, b) => b.q - a.q).slice(0, 8);

  // Decoration breakdown — how many ordered units carry each placed logo. A product's
  // logos live on its catalog row's `decorations` (kind:'art'); every ordered unit of
  // that product (single or bundle component, matched by product_id then sku) counts
  // once per distinct logo it carries.
  const decoCounts = {};
  lines.forEach((i) => {
    const c = (i.product_id && catByPid[i.product_id]) || (i.sku && catBySku[String(i.sku).toUpperCase()]) || null;
    const decos = (c && Array.isArray(c.decorations)) ? c.decorations : [];
    const seen = new Set();
    decos.filter((d) => d && d.kind === 'art' && (d.art_id || d.art_url)).forEach((d) => {
      const key = d.art_id || d.art_url;
      if (seen.has(key)) return; seen.add(key); // don't double-count the same logo twice on one garment
      const label = (d.art_id && artName[d.art_id]) || d.name || (d.side === 'back' ? 'Back logo' : 'Front logo');
      if (!decoCounts[key]) decoCounts[key] = { label, units: 0 };
      decoCounts[key].units += (i.qty || 1);
    });
  });
  const decoRows = Object.values(decoCounts).sort((a, b) => b.units - a.units);
  const byDay = {}; orders.forEach((o) => { const d = (o.created_at || '').slice(0, 10); if (d) byDay[d] = (byDay[d] || 0) + 1; });
  const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const maxSeller = Math.max(1, ...topSellers.map((s) => s.q));
  const maxDay = Math.max(1, ...days.map((d) => d[1]));

  const Bar = ({ frac, color }) => <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: Math.round(frac * 100) + '%', height: '100%', background: color }} /></div>;

  // One line of the accounting ledger. `sign` colors and prefixes a deduction;
  // `sub` indents a memo line; `bold` + `divider` mark a subtotal.
  const Led = ({ label, amt, sign = '', bold, sub, color, note, divider }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: bold ? '9px 0' : '6px 0', borderTop: divider ? '1px solid #e2e8f0' : 'none', marginTop: divider ? 2 : 0 }}>
      <div style={{ fontSize: bold ? 14 : 13, fontWeight: bold ? 800 : (sub ? 400 : 600), color: sub ? '#94a3b8' : '#334155', paddingLeft: sub ? 16 : 0 }}>
        {label}{note && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>{note}</span>}
      </div>
      <div style={{ fontSize: bold ? 16 : 14, fontWeight: bold ? 900 : 700, color: color || (sign === '−' ? '#b91c1c' : '#1e293b'), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{sign}{money(Math.abs(amt))}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        {[['Revenue', money(revenue)], ['Fundraising', money(fundOwed), '#166534'], ['Orders', orders.length], ...(packagesSold > 0 ? [['Packages sold', packagesSold, '#7c3aed']] : []), ['Units', units], ['Avg order', money(revenue / orders.length)], ['Paid / Team tab', `${paid.length} / ${orders.length - paid.length}`],
          ...(shipCollected || shipCost ? [['Shipping collected', money(shipCollected)], ['Label cost (actual)', money(shipCost), '#b45309'], ['Shipping net', money(shipNet), shipNet >= 0 ? '#166534' : '#b91c1c']] : [])].map(([l, v, c]) => (
          <div key={l} className="card"><div style={{ padding: 14 }}><div style={{ fontSize: 22, fontWeight: 800, color: c || '#1e293b' }}>{v}</div><div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{l}</div></div></div>
        ))}
      </div>

      <div className="card"><div style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800 }}>Accounting · money flow</div>
          <button className="btn btn-secondary" onClick={() => printAccounting(store, acct, { cardColl, tabColl, orders: orders.length })}>🖨️ Print statement</button>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, marginBottom: 6 }}>Every dollar collected, discounted, and paid out across {orders.length} live order{orders.length === 1 ? '' : 's'}.</div>
        <Led label="Product sales" amt={acct.grossSales} sign="+" note="retail before discounts" />
        <Led label="Coupon discounts" amt={acct.discounts} sign="−" />
        {acct.fundraiseAll > 0.005 && <Led label="Club fundraising" amt={acct.fundraiseAll} sign="+" color="#166534" />}
        <Led label="Shipping charged" amt={acct.shipCharged} sign="+" />
        {acct.processing > 0.005 && <Led label="Processing fees" amt={acct.processing} sign="+" />}
        <Led label="Sales tax collected" amt={acct.taxColl} sign="+" />
        <Led label="Gross collected" amt={acct.grossColl} bold divider />
        <Led label="card payments" amt={cardColl} sub note="charged to cards" />
        <Led label="team tab" amt={tabColl} sub note="billed on club invoice" />
        {acct.refunds > 0.005 && <><Led label="Refunds issued" amt={acct.refunds} sign="−" divider /><Led label="Net collected" amt={acct.netColl} bold /></>}
        <Led label="Card processing fees" amt={acct.ccFees} sign="−" divider />
        <Led label="Shipping label cost" amt={acct.labelCost} sign="−" />
        <Led label="Net after fees" amt={acct.netAfterFees} bold color="#166534" divider />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>Sales tax is collected on the state's behalf and remitted to CDTFA — it is not store revenue. Card &amp; label costs apply only to card-paid orders; team-tab balances settle on the club invoice.</div>
      </div></div>

      {fundGross > 0 && <div className="card" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}><div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#15803d', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Club fundraising payout</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#166534' }}>{money(fundPaid)}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>collected & owed to the club{fundPending > 0.005 ? ` · ${money(fundPending)} pending on unpaid/team-tab orders` : ''}</div>
          {pkgFund > 0.005 && <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginTop: 4 }}>Includes {money(pkgFund)} from {packagesSold} package{packagesSold === 1 ? '' : 's'}.</div>}
        </div>
        <button className="btn btn-secondary" onClick={() => printPayout(store, { fundPaid, fundPending, orders: orders.length })}>🖨️ Print payout statement</button>
      </div></div>}

      {packagesSold > 0 && <div className="card"><div style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Packages sold</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>For reference & club fundraising — components still report &amp; ship as individual items.</div>
        {pkgRows.map(([nm, q]) => <div key={nm} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13 }}>
          <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nm}>{nm}</div>
          <Bar frac={q / Math.max(...pkgRows.map((r) => r[1]))} color="#7c3aed" /><div style={{ width: 36, textAlign: 'right', fontWeight: 700 }}>{q}</div>
        </div>)}
      </div></div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
        <div className="card"><div style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Top sellers</div>
          {topSellers.map((s) => <div key={s.sku} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13 }}>
            <div style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</div>
            <Bar frac={s.q / maxSeller} color="#2563eb" /><div style={{ width: 36, textAlign: 'right', fontWeight: 700 }}>{s.q}</div>
          </div>)}
        </div></div>

        <div className="card"><div style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Decoration breakdown</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Ordered units carrying each placed logo — how many of each decoration to produce.</div>
          {decoRows.length === 0 ? <div style={{ fontSize: 13, color: '#94a3b8' }}>No logos placed on this store's items yet.</div> : decoRows.map((d, idx) => { const m = Math.max(...decoRows.map((r) => r.units)); return <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13 }}><div style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</div><Bar frac={d.units / m} color="#7c3aed" /><div style={{ width: 36, textAlign: 'right', fontWeight: 700 }}>{d.units}</div></div>; })}
        </div></div>
      </div>

      <div className="card"><div style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>Orders over time</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
          {days.map(([d, n]) => <div key={d} title={`${d}: ${n}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ width: '100%', height: Math.round((n / maxDay) * 100) + '%', minHeight: 2, background: '#16a34a', borderRadius: 3 }} />
            <div style={{ fontSize: 9, color: '#94a3b8', transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>{d.slice(5)}</div>
          </div>)}
        </div>
      </div></div>
    </div>
  );
}

// Inventory: garment stock for everything in the store + heat-transfer
// inventory (design transfers deducted per item; number transfers deducted
// per digit, matched to the item's number size/color set). "Used" is computed
// live from all non-cancelled orders.
function InventoryTab({ catalog, bundleItems, stockByWp, transfers, orders, orderItems, onUpdateTransfer, onAddTransfers, onRemoveTransfer }) {
  const [addDesign, setAddDesign] = useState(false);
  const [addSet, setAddSet] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (id) => setOpenRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Transfer demand splits by lifecycle: On order = placed but not yet pulled;
  // In process = pulled & decorating (auto-clears once the order ships).
  const maps = buildTransferMaps(catalog, bundleItems);
  const itemsByOrder = {}; orderItems.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
  const orderDone = (o) => { const its = (itemsByOrder[o.id] || []).filter((i) => !i.is_bundle_parent); return its.length > 0 && its.every((i) => ['shipped', 'complete'].includes(i.line_status)); };
  const active = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'pending_payment');
  const onOrderIds = new Set(active.filter((o) => !o.transfers_pulled).map((o) => o.id));
  const inProcIds = new Set(active.filter((o) => o.transfers_pulled && !orderDone(o)).map((o) => o.id));
  const onOrderUse = transferUsage(orderItems.filter((i) => onOrderIds.has(i.order_id)), maps);
  const inProcUse = transferUsage(orderItems.filter((i) => inProcIds.has(i.order_id)), maps);

  const designs = transfers.filter((t) => t.kind === 'design');
  const numbers = transfers.filter((t) => t.kind === 'number');
  const sets = {}; numbers.forEach((t) => { const k = `${t.tsize || ''}|${t.color || ''}`; (sets[k] = sets[k] || []).push(t); });
  const ordered = [...catalog].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Available = physical on hand − pending (unpulled) demand.
  const Avail = ({ t }) => { const r = (t.on_hand || 0) - (onOrderUse[t.code] || 0); return <span style={{ fontWeight: 700, color: r < 0 ? '#b91c1c' : r < 10 ? '#92400e' : '#166534' }}>{r}</span>; };
  const InProc = ({ t }) => { const v = inProcUse[t.code] || 0; return <span style={{ color: v ? '#6d28d9' : '#cbd5e1', fontWeight: v ? 600 : 400 }}>{v}</span>; };
  const OnOrder = ({ t }) => { const v = onOrderUse[t.code] || 0; return <span style={{ color: v ? '#92400e' : '#cbd5e1', fontWeight: v ? 600 : 400 }}>{v}</span>; };
  const NumCell = ({ t, field }) => <input defaultValue={t[field] || 0} type="number" key={t[field]} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== (t[field] || 0)) onUpdateTransfer(t.id, { [field]: v }); }} style={{ width: 64, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />;
  const receiveRow = (t) => { if (!(t.incoming > 0)) return; onUpdateTransfer(t.id, { on_hand: (t.on_hand || 0) + (t.incoming || 0), incoming: 0, incoming_eta: null }); };
  const Recv = ({ t }) => t.incoming > 0 ? <button onClick={() => receiveRow(t)} title="Mark incoming as received into On hand" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>Receive</button> : <span style={{ color: '#cbd5e1' }}>—</span>;
  const EtaCell = ({ t }) => <input type="date" defaultValue={t.incoming_eta || ''} key={t.incoming_eta || ''} onBlur={(e) => { const v = e.target.value || null; if (v !== (t.incoming_eta || null)) onUpdateTransfer(t.id, { incoming_eta: v }); }} style={{ padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Garment stock */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#475569' }}>Garment stock</div>
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => { setExpandAll((v) => !v); setOpenRows(new Set()); }}>{expandAll ? 'Collapse all sizes' : 'Expand all sizes'}</button>
        </div>
        <div className="card"><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}><th style={th}>Item</th><th style={th}>Type</th><th style={th}>In-house</th><th style={th}>Adidas</th><th style={th}>Transfer</th></tr></thead>
            <tbody>
              {ordered.map((p) => {
                const st = stockByWp[p.id];
                const wh = sumSizes(st?.size_stock); const ven = Number(st?.vendor_on_hand) || 0;
                const open = expandAll || openRows.has(p.id);
                const tlabel = p.kind === 'bundle' ? '—' : [p.transfer_code && (designs.find((d) => d.code === p.transfer_code)?.label || p.transfer_code), p.takes_number && `#s ${p.num_transfer_size || '?'}/${p.num_transfer_color || '?'}`].filter(Boolean).join(' + ') || '—';
                return (
                  <React.Fragment key={p.id}>
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={td}><div style={{ fontWeight: 600 }}>{p.display_name || st?.name || p.sku}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{p.sku}</div></td>
                    <td style={td}>{p.kind === 'bundle' ? <Chip label="Bundle" tone="blue" /> : <Chip label="Single" />}</td>
                    <td style={td}>{p.kind === 'bundle' ? '—' : <span style={{ color: wh > 0 ? '#166534' : '#cbd5e1', fontWeight: 600 }}>{wh.toLocaleString()}</span>}</td>
                    <td style={td}>
                      {p.kind === 'bundle' ? '—' : <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: ven > 0 ? '#1e40af' : '#cbd5e1', fontWeight: 600 }}>{ven.toLocaleString()}</span><button onClick={() => toggleRow(p.id)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11, padding: 0 }}>{open ? 'hide sizes ▲' : 'sizes ▾'}</button></span>}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: '#475569' }}>{tlabel}</td>
                  </tr>
                  {open && p.kind !== 'bundle' && <tr><td colSpan={5} style={{ background: '#f8fafc', padding: '8px 16px' }}><StockBreakdown stock={st} summary={stockText(st)} /></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div></div>
      </div>

      {/* Transfer inventory */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#475569' }}>Heat-transfer inventory</div>
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setAddDesign((v) => !v)}>+ Design transfer</button>
          <button className="btn btn-sm btn-secondary" onClick={() => setAddSet((v) => !v)}>+ Number set</button>
        </div>
        {addDesign && <AddDesignTransfer onAdd={(row) => { onAddTransfers([row]); setAddDesign(false); }} onClose={() => setAddDesign(false)} />}
        {addSet && <AddNumberSet onAdd={(rows) => { onAddTransfers(rows); setAddSet(false); }} onClose={() => setAddSet(false)} />}
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}><b>On hand</b> = physically in the warehouse. <b>Incoming</b> = ordered from a supplier, not yet here (set an ETA, then "Receive" when it arrives). <b>On order</b> = needed by placed orders not yet pulled. <b>In process</b> = pulled & being decorated. <b>Available</b> = on hand − on order. Pull a batch's transfers from the <b>Batches</b> tab.</div>

        {designs.length > 0 && <div className="card" style={{ marginBottom: 12 }}><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}><th style={th}>Design transfer</th><th style={th}>On hand</th><th style={th}>Incoming</th><th style={th}>ETA</th><th style={th}></th><th style={th}>On order</th><th style={th}>In process</th><th style={th}>Available</th><th style={th}></th></tr></thead>
            <tbody>
              {designs.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{t.label}</div><div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{t.code}</div></td>
                  <td style={td}><NumCell t={t} field="on_hand" /></td><td style={td}><NumCell t={t} field="incoming" /></td><td style={td}><EtaCell t={t} /></td><td style={td}><Recv t={t} /></td>
                  <td style={td}><OnOrder t={t} /></td><td style={td}><InProc t={t} /></td><td style={td}><Avail t={t} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><button onClick={() => onRemoveTransfer(t.id)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>}

        {Object.entries(sets).map(([key, rows]) => {
          const [sz, col] = key.split('|');
          const sorted = [...rows].sort((a, b) => (a.digit || '').localeCompare(b.digit || ''));
          const setEta = sorted.find((t) => t.incoming_eta)?.incoming_eta || '';
          const setIncoming = sorted.reduce((a, t) => a + (Number(t.incoming) || 0), 0);
          const setAllEta = (v) => sorted.forEach((t) => onUpdateTransfer(t.id, { incoming_eta: v || null }));
          const receiveAll = () => sorted.forEach((t) => { if (t.incoming > 0) onUpdateTransfer(t.id, { on_hand: (t.on_hand || 0) + (t.incoming || 0), incoming: 0, incoming_eta: null }); });
          return (
            <div key={key} className="card" style={{ marginBottom: 12 }}>
              <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Numbers · {sz || '?'} · {col || '?'}</div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>Incoming ETA <input type="date" defaultValue={setEta} key={setEta} onBlur={(e) => { if ((e.target.value || '') !== setEta) setAllEta(e.target.value); }} style={{ padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }} /></label>
                {setIncoming > 0 && <button onClick={receiveAll} style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6 }}>Receive all ({setIncoming})</button>}
              </div>
              <div style={{ overflowX: 'auto', padding: '6px 0 4px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}><th style={th}>Digit</th><th style={th}>On hand</th><th style={th}>Incoming</th><th style={th}>On order</th><th style={th}>In process</th><th style={th}>Available</th></tr></thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr key={t.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ ...td, fontWeight: 700 }}>{t.digit}</td><td style={td}><NumCell t={t} field="on_hand" /></td><td style={td}><NumCell t={t} field="incoming" /></td><td style={td}><OnOrder t={t} /></td><td style={td}><InProc t={t} /></td><td style={td}><Avail t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          );
        })}
        {transfers.length === 0 && <Empty msg="No transfer inventory yet. Add a design transfer or a number set above." />}
      </div>
    </div>
  );
}

function AddDesignTransfer({ onAdd, onClose }) {
  const [label, setLabel] = useState(''); const [onHand, setOnHand] = useState(0);
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <Row label="Transfer name"><input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Left Chest Logo DTF" /></Row>
      <Row label="On hand"><input className="form-input" type="number" value={onHand} onChange={(e) => setOnHand(e.target.value)} /></Row>
      <button className="btn btn-primary" disabled={!label.trim()} onClick={() => onAdd({ code: slugify(label) || ('design-' + Date.now()), label: label.trim(), kind: 'design', on_hand: Number(onHand) || 0 })}>Add</button>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
    </div></div>
  );
}
function AddNumberSet({ onAdd, onClose }) {
  const [size, setSize] = useState('8in'); const [color, setColor] = useState('');
  const create = () => {
    const rows = [];
    for (let d = 0; d <= 9; d++) rows.push({ code: `${d}|${size}|${color}`, label: `Number ${d} · ${size} · ${color}`, kind: 'number', digit: String(d), tsize: size, color, on_hand: 0, incoming: 0 });
    onAdd(rows);
  };
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <Row label="Size"><input className="form-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="8in" /></Row>
      <Row label="Color"><input className="form-input" value={color} onChange={(e) => setColor(e.target.value)} placeholder="White" /></Row>
      <button className="btn btn-primary" disabled={!size.trim() || !color.trim()} onClick={create}>Add digits 0–9</button>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <div style={{ flexBasis: '100%', fontSize: 12, color: '#94a3b8' }}>Creates a row per digit (0–9). Enter the quantity for each digit individually below — you rarely stock the same count of every digit.</div>
    </div></div>
  );
}

// Batches: the Sales Orders created from this store, with full fulfillment
// status — ordered qty, picked qty, and stock health per line item.
// Batched SOs for a set of stores, with the fulfillment children the tracking views
// need (items + their PO/pick lines, decorations, jobs). Shared by BatchesTab
// (per-store) and StoreBackordersView (store or whole-customer scope) so the two
// views can't drift on what "a batch's fulfillment state" means. Throws on error.
async function fetchStoreSOFulfillment(storeIds) {
  // Soft-deleted SOs are excluded — a dead batch's unreceived units must not count
  // as open demand in the backorder rollup (or show as a batch card).
  const { data: orders, error } = await supabase.from('sales_orders').select('id,webstore_id,status,created_at,memo,production_notes,_shipping_status,_tracking_number,webstore_batch_no,webstore_batch_label,webstore_batch_cutoff').in('webstore_id', storeIds).is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw error;
  const ids = (orders || []).map((o) => o.id);
  if (!ids.length) return [];
  // jobs only need `ids` — fire now, await after the item children resolve.
  const jobsQ = supabase.from('so_jobs').select('so_id,art_name,deco_type,positions,art_status,prod_status,total_units,fulfilled_units').in('so_id', ids);
  const { data: items, error: itemErr } = await supabase.from('so_items').select('id,so_id,sku,name,product_id,sizes').in('so_id', ids);
  if (itemErr) throw itemErr;
  const itemIds = (items || []).map((i) => i.id);
  let picks = [], decos = [], pos = [];
  if (itemIds.length) {
    const [plRes, decoRes, poRes] = await Promise.all([
      supabase.from('so_item_pick_lines').select('so_item_id,sizes,status').in('so_item_id', itemIds),
      supabase.from('so_item_decorations').select('so_item_id,kind,position,type,num_method,deco_type,art_file_id').in('so_item_id', itemIds),
      supabase.from('so_item_po_lines').select('so_item_id,billed,received,sizes,status').in('so_item_id', itemIds),
    ]);
    // A failed child query must be loud: silently-empty pick/PO lines would render
    // every line as unreceived (or the backorder view as all-clear) instead of an error.
    const failed = [plRes, decoRes, poRes].find((r) => r.error);
    if (failed) throw failed.error;
    picks = plRes.data || []; decos = decoRes.data || []; pos = poRes.data || [];
  }
  const { data: jobRes, error: jobErr } = await jobsQ;
  if (jobErr) throw jobErr;
  const jobs = jobRes || [];
  const pickedByItem = {};
  picks.forEach((p) => { if ((p.status || '') === 'pulled') { const t = sumSizes(p.sizes); pickedByItem[p.so_item_id] = (pickedByItem[p.so_item_id] || 0) + t; } });
  const decosByItem = {};
  decos.forEach((d) => { (decosByItem[d.so_item_id] = decosByItem[d.so_item_id] || []).push(d); });
  // Attach PO + pick lines per item so the per-customer tracking grid can
  // read Billed/Received (PO lines) and on-IF (pick lines).
  const picksByItem = {}; picks.forEach((p) => { (picksByItem[p.so_item_id] = picksByItem[p.so_item_id] || []).push(p); });
  const posByItem = {}; pos.forEach((p) => { (posByItem[p.so_item_id] = posByItem[p.so_item_id] || []).push(p); });
  return (orders || []).map((o) => ({ ...o, items: (items || []).filter((i) => i.so_id === o.id).map((it) => ({ ...it, po_lines: posByItem[it.id] || [], pick_lines: picksByItem[it.id] || [] })), pickedByItem, decosByItem, jobs: jobs.filter((j) => j.so_id === o.id) }));
}

// Merged per-line tracking across a set of batch SOs: FIFO-allocate each SO's
// incoming/received stock to its LIVE orders (earliest first, within the batch) and
// merge the per-line maps. The ONE copy shared by BatchesTab's grids and
// StoreBackordersView's rollup, so their Need/Open numbers can never drift apart —
// including which orders count (dead orders must not soak up FIFO supply).
function mergeStoreTracking(sos, orders, itemsByOrder, products) {
  const bySo = {};
  (orders || []).forEach((w) => { if (w.so_id && isLiveWebstoreOrder(w)) (bySo[w.so_id] = bySo[w.so_id] || []).push(w); });
  const merged = {};
  (sos || []).forEach((so) => {
    const bOrders = (bySo[so.id] || []).map((w) => ({ ...w, items: itemsByOrder[w.id] || [] }));
    if (bOrders.length) Object.assign(merged, computeOrderTracking({ orders: bOrders, so: { items: so.items }, products: products || [], includeIF: true }));
  });
  return merged;
}

function BatchesTab({ store, productStock, onOpenSO, catalog = [], bundleItems = [], orders = [], orderItems = [], transfers = [], onPullTransfers }) {
  const [sos, setSos] = useState(null);
  const [err, setErr] = useState('');
  const [ssMsg, setSsMsg] = useState({}); // soId -> status message
  const [ssErr, setSsErr] = useState({}); // soId -> [{order, msg}] from the last run
  const shipHome = store.delivery_mode !== 'deliver_club';
  const [trackMode, setTrackMode] = useState('batch'); // 'batch' (per-SO) | 'all' (overall store) | 'backorders'
  // In-house on-hand by product → {size: qty}, for the "In Inv" column.
  const invProducts = useMemo(() => Object.values(productStock || {}).map((s) => ({ id: s.product_id, _inv: s.size_stock || {} })).filter((p) => p.id), [productStock]);
  // Per-customer-line incoming tracking, FIFO-allocated WITHIN each batch (SO),
  // then merged so the overall view can show every batch at once.
  const trackByLine = useMemo(() => {
    const itemsByOrder = {};
    (orderItems || []).forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
    return mergeStoreTracking(sos, orders, itemsByOrder, invProducts);
  }, [sos, orders, orderItems, invProducts]);
  const TRK = { shipped: { l: '✓ Shipped', c: '#166534', b: '#dcfce7' }, ready: { l: 'Ready', c: '#166534', b: '#dcfce7' }, partial: { l: 'Partial', c: '#92400e', b: '#fef3c7' }, incoming: { l: 'Incoming', c: '#1d4ed8', b: '#dbeafe' }, awaiting: { l: 'Awaiting', c: '#475569', b: '#f1f5f9' }, backordered: { l: 'Backordered', c: '#b91c1c', b: '#fee2e2' } };
  // The per-customer tracking grid (In Inv · Ordered+IF · Billed · Received ·
  // Need · Status) for a set of webstore orders.
  const renderTrackTable = (wOrders) => {
    if (!wOrders.length) return <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>No customer orders here yet.</div>;
    const ctd = { ...td, textAlign: 'center' };
    const num = (n, strong) => <span style={{ color: n > 0 ? '#0f172a' : '#cbd5e1', fontWeight: strong ? 700 : 500 }}>{n}</span>;
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
          {[['Customer', ''], ['Item', ''], ['SKU', ''], ['Size', ''], ['In Inv', 'c'], ['Ordered', 'c'], ['Billed', 'c'], ['Received', 'c'], ['Need', 'c'], ['Status', 'c']].map(([h, al]) => <th key={h} style={{ ...th, fontSize: 10.5, textAlign: al === 'c' ? 'center' : 'left' }} title={h === 'Ordered' ? 'Customer ordered (· N IF = fulfilled from in-house stock)' : h === 'Billed' ? 'Vendor shipped (from uploaded bills)' : h === 'Received' ? 'Received into the warehouse, earliest orders first' : undefined}>{h}</th>)}
        </tr></thead>
        <tbody>
          {wOrders.map((w) => {
            const its = (orderItems || []).filter((i) => i.order_id === w.id && !i.is_bundle_parent);
            return its.map((i, idx) => {
              const t = trackByLine[i.id] || { ordered: Number(i.qty) || 0, billed: 0, received: 0, onIf: 0, onHand: 0, need: Number(i.qty) || 0, status: 'awaiting' };
              const p = TRK[t.status] || TRK.backordered;
              return (
                <tr key={i.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}>{idx === 0 ? <span style={{ fontWeight: 600 }}>{w.buyer_name || w.buyer_email || '—'}</span> : ''}</td>
                  <td style={td}>{i.name || i.sku || '—'}</td>
                  <td style={td}>{t.sku ? <span style={{ fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }} title="SKU from the linked Sales Order">{t.sku}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={td}>{i.size || '—'}</td>
                  <td style={ctd}>{num(t.onHand)}</td>
                  <td style={ctd}>{num(t.ordered, true)}{t.onIf > 0 && <span style={{ color: '#0369a1', fontWeight: 700, fontSize: 11 }}> · {t.onIf} IF</span>}</td>
                  <td style={ctd}>{num(t.billed)}</td>
                  <td style={ctd}><span style={{ color: t.received >= t.ordered && t.ordered > 0 ? '#166534' : t.received > 0 ? '#0f172a' : '#cbd5e1', fontWeight: t.received > 0 ? 700 : 500 }}>{t.received}</span></td>
                  <td style={ctd}>{t.need > 0 ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '1px 8px', fontWeight: 800 }}>{t.need}</span> : <span style={{ color: '#16a34a', fontWeight: 800 }} title="Fully covered">✓</span>}</td>
                  <td style={ctd}><span style={{ background: p.b, color: p.c, borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{p.l}</span></td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    );
  };
  // Webstore orders + items belonging to one batched SO. Items carry the
  // effective SKU (size_skus overrides) so packing lists + ShipStation lines
  // show the item number production actually sourced.
  const batchGroups = (soId) => {
    const skuMap = sizeSkuMapOf(catalog);
    const linked = orders.filter((o) => o.so_id === soId);
    return linked.map((o) => ({ order: o, items: annotateEffSkus(orderItems.filter((i) => i.order_id === o.id), skuMap) }));
  };
  const printPacking = (soId, soLabel) => printHtml(buildPackingLists(store, soLabel, batchGroups(soId)));
  const homeGroups = (soId) => batchGroups(soId).filter((g) => (g.order.ship_method || store.delivery_mode) !== 'deliver_club' && g.order.ship_address);
  // product_id -> image, so ShipStation orders (and the ship email) carry thumbnails.
  const imageByPid = {};
  Object.values(productStock || {}).forEach((s) => { if (s.product_id && s.image_front_url) imageByPid[s.product_id] = s.image_front_url; });
  (catalog || []).forEach((c) => { if (c.product_id && c.image_url) imageByPid[c.product_id] = c.image_url; });
  const sendToShipStation = async (soId) => {
    const groups = homeGroups(soId);
    if (!groups.length) { setSsMsg((m) => ({ ...m, [soId]: 'No ship-to-home orders with addresses.' })); return; }
    setSsMsg((m) => ({ ...m, [soId]: `Sending ${groups.length}…` }));
    let ok = 0, fail = 0;
    const tagId = Number(store.shipstation_tag_id) || null;
    for (const g of groups) {
      try {
        const res = await shipStationCall('/orders/createorder', { method: 'POST', body: JSON.stringify(webstoreToShipStation(g.order, g.items, store, imageByPid)) });
        if (tagId && res && res.orderId) { try { await shipStationCall('/orders/addtag', { method: 'POST', body: JSON.stringify({ orderId: res.orderId, tagId }) }); } catch {} }
        ok++;
      } catch { fail++; }
    }
    setSsMsg((m) => ({ ...m, [soId]: `Sent ${ok} to ShipStation${fail ? `, ${fail} failed` : ''}. Bulk-print labels in ShipStation.` }));
  };
  const printShipLabels = async (soId) => {
    const groups = homeGroups(soId);
    if (!groups.length) { setSsMsg((m) => ({ ...m, [soId]: 'No ship-to-home orders with addresses.' })); return; }
    setSsMsg((m) => ({ ...m, [soId]: `Creating ${groups.length} labels…` }));
    const weightByPid = {}; (catalog || []).forEach((c) => { if (c.product_id && c.weight_oz != null) weightByPid[c.product_id] = Number(c.weight_oz) || 0; });
    const labels = []; const errs = []; let held = 0;
    for (const g of groups) {
      const o = g.order;
      const who = o.buyer_name || o.buyer_email || o.id;
      const lines = g.items.filter((i) => !i.is_bundle_parent);
      // Units still to ship per line = ordered − already shipped − short-now.
      const plan = lines.map((i) => { const remaining = (Number(i.qty) || 0) - (Number(i.shipped_qty) || 0); return { item: i, qty: Math.max(0, remaining - (Number(i.missing_qty) || 0)) }; }).filter((x) => x.qty > 0);
      if (!plan.length) { held++; continue; }
      const addrErr = validateShipAddress(o.ship_address);
      if (addrErr) { errs.push({ order: who, msg: addrErr }); continue; }
      const shipItems = plan.map((x) => ({ ...x.item, qty: x.qty }));
      try {
        const { labelData, trackingNumber, carrier, shipmentId, cost } = await createWebstoreLabel(o, shipItems, store, weightByPid, imageByPid);
        if (labelData) labels.push(labelData);
        for (const x of plan) { const i = x.item; const sq = (Number(i.shipped_qty) || 0) + x.qty; const done = sq >= (Number(i.qty) || 0); try { await supabase.from('webstore_order_items').update({ shipped_qty: sq, ...(done ? { line_status: 'shipped' } : {}) }).eq('id', i.id); } catch {} i.shipped_qty = sq; if (done) i.line_status = 'shipped'; }
        const allShipped = lines.every((i) => (Number(i.shipped_qty) || 0) >= (Number(i.qty) || 0));
        try { await supabase.from('webstore_orders').update({ tracking_number: trackingNumber || null, carrier: carrier || null, label_cost: cost != null ? cost : null, label_data: labelData || null, shipstation_shipment_id: shipmentId, ...(allShipped ? { shipped_at: new Date().toISOString() } : {}) }).eq('id', o.id); } catch {}
      } catch (e) { errs.push({ order: who, msg: (e && e.message) || 'Label failed' }); }
    }
    // Roll the Sales Order's outbound shipping cost up = sum of its orders' label
    // costs (the webhook later reconciles these to ShipStation's actual amounts).
    try {
      const { data: soOrds } = await supabase.from('webstore_orders').select('label_cost').eq('so_id', soId);
      const total = (soOrds || []).reduce((a, x) => a + (Number(x.label_cost) || 0), 0);
      await supabase.from('sales_orders').update({ _shipping_cost: total, _shipstation_cost: total }).eq('id', soId);
    } catch {}
    if (labels.length) await printLabels(labels);
    setSsErr((m) => ({ ...m, [soId]: errs }));
    setSsMsg((m) => ({ ...m, [soId]: `${labels.length} label${labels.length === 1 ? '' : 's'} created${errs.length ? `, ${errs.length} need attention` : ''}${held ? `, ${held} fully short` : ''}.` }));
  };
  const maps = buildTransferMaps(catalog, bundleItems);
  const transferLabel = (code) => { const t = transfers.find((x) => x.code === code); if (t) return t.label; const [d, s, c] = code.split('|'); return s ? `#${d} · ${s} · ${c}` : code; };
  // Transfers needed for one SO. By default counts only the orders whose
  // transfers haven't been pulled yet (so re-pulling won't double-deduct).
  const batchTransfers = (soId, onlyUnpulled = true) => {
    const linked = orders.filter((o) => o.so_id === soId && (!onlyUnpulled || !o.transfers_pulled));
    const ids = new Set(linked.map((o) => o.id));
    const used = transferUsage(orderItems.filter((i) => ids.has(i.order_id)), maps);
    const designs = []; const numbers = []; const byCode = {};
    Object.entries(used).forEach(([code, qty]) => { byCode[code] = qty; (code.includes('|') ? numbers : designs).push({ code, qty, label: transferLabel(code) }); });
    numbers.sort((a, b) => a.label.localeCompare(b.label));
    return { designs, numbers, byCode };
  };
  const batchPulled = (soId) => { const linked = orders.filter((o) => o.so_id === soId); return linked.length > 0 && linked.every((o) => o.transfers_pulled); };
  useEffect(() => {
    (async () => {
      setSos(null); setErr('');
      try { setSos(await fetchStoreSOFulfillment([store.id])); }
      catch (e) { setErr(e.message || 'Load failed'); setSos([]); }
    })();
  }, [store.id]);

  if (sos === null) return <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}>Loading batches…</div>;
  if (err) return <Empty msg={'Could not load batches: ' + err} />;
  if (!sos.length) return <Empty msg="No batches created from this store yet. Use Orders → Create Batch." />;

  const stockHealth = (item) => {
    const st = productStock[item.product_id];
    const sizes = item.sizes || {};
    let short = 0, ok = 0;
    Object.entries(sizes).forEach(([sz, qty]) => {
      const need = Number(qty) || 0; if (!need) return;
      const avail = (Number(st?.size_stock?.[sz]) || 0) + (Number(st?.vendor_size_stock?.[sz]) || 0);
      if (avail >= need) ok++; else short++;
    });
    if (!st) return { text: 'No stock data', color: '#94a3b8' };
    return short === 0 ? { text: 'Stock OK', color: '#166534' } : { text: `Short on ${short} size${short === 1 ? '' : 's'}`, color: '#b91c1c' };
  };

  // Live orders only, matching mergeStoreTracking — a cancelled/refunded order has no
  // tracking entry, so rendering it would show a misleading all-defaults row.
  const allWOrders = (orders || []).filter((w) => isLiveWebstoreOrder(w) && sos.some((o) => o.id === w.so_id)).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const tBtn = (mode, label) => <button onClick={() => setTrackMode(mode)} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid ' + (trackMode === mode ? '#0f172a' : '#e2e8f0'), background: trackMode === mode ? '#0f172a' : '#fff', color: trackMode === mode ? '#fff' : '#334155', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{label}</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>Tracking view:</span>
        {tBtn('batch', '📦 By batch')}
        {tBtn('all', '🏬 All orders (overall)')}
        {tBtn('backorders', '⏳ Backorders')}
      </div>
      {trackMode === 'backorders' && <StoreBackordersView store={store} onOpenSO={onOpenSO} />}
      {trackMode === 'all' && (
        <div className="card"><div style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>All customer orders — {store.name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Every batch combined. Incoming stock is allocated to the earliest orders first, within each batch.</div>
          {renderTrackTable(allWOrders)}
        </div></div>
      )}
      {trackMode === 'batch' && sos.map((o) => {
        const totalOrdered = o.items.reduce((a, i) => a + sumSizes(i.sizes), 0);
        const totalPicked = o.items.reduce((a, i) => a + (o.pickedByItem[i.id] || 0), 0);
        const pickPct = totalOrdered ? Math.round((totalPicked / totalOrdered) * 100) : 0;
        const allStockOk = o.items.every((i) => stockHealth(i).text === 'Stock OK');
        return (
          <div key={o.id} className="card"><div style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  {o.webstore_batch_no != null && <span style={{ fontSize: 12, fontWeight: 800, color: '#6d28d9', background: '#ede9fe', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>Batch {o.webstore_batch_no}{o.webstore_batch_label ? ` · ${o.webstore_batch_label}` : ''}</span>}
                  <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: '#1e40af', cursor: 'pointer' }} onClick={() => onOpenSO && onOpenSO(o.id)}>{o.id} ↗</div>
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{o.memo}{o.webstore_batch_cutoff ? ` · orders through ${batchCutoffDay(o.webstore_batch_cutoff)}` : ''}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => printPacking(o.id, o.id)}>🖨️ Packing lists</button>
                  {shipHome && <button className="btn btn-sm btn-secondary" onClick={() => printShipLabels(o.id)}>🏷️ Create & print labels</button>}
                </div>
                {ssMsg[o.id] && <div style={{ fontSize: 11, color: '#1e40af', marginTop: 4 }}>{ssMsg[o.id]}</div>}
                {ssErr[o.id] && ssErr[o.id].length > 0 && <div style={{ marginTop: 4, padding: '6px 8px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6 }}>
                  {ssErr[o.id].map((e, i) => <div key={i} style={{ fontSize: 10.5, color: '#7c2d12' }}>⚠️ <b>{e.order}</b> — {e.msg}</div>)}
                </div>}
              </div>
              <div style={{ display: 'flex', gap: 14, textAlign: 'right' }}>
                <Stat label="Ordered" value={totalOrdered} />
                <Stat label="Picked" value={`${totalPicked}/${totalOrdered}`} tone={pickPct === 100 ? '#166534' : '#92400e'} />
                <Stat label="Stock" value={allStockOk ? 'OK' : 'Short'} tone={allStockOk ? '#166534' : '#b91c1c'} />
                <Stat label="Status" value={(o._shipping_status || o.status || '—').replace(/_/g, ' ')} />
              </div>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ width: pickPct + '%', height: '100%', background: pickPct === 100 ? '#16a34a' : '#f59e0b' }} />
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={th}>Item</th><th style={th}>Ordered (by size)</th><th style={th}>Picked</th><th style={th}>Stock</th>
              </tr></thead>
              <tbody>
                {o.items.map((it) => {
                  const ordered = sumSizes(it.sizes);
                  const picked = o.pickedByItem[it.id] || 0;
                  const sh = stockHealth(it);
                  const sizeStr = Object.entries(it.sizes || {}).filter(([, q]) => Number(q) > 0).map(([sz, q]) => `${sz}:${q}`).join('  ');
                  const ds = (o.decosByItem || {})[it.id] || [];
                  return (
                    <tr key={it.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{it.name || it.sku}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{it.sku}</div>
                        {ds.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                          {ds.map((d, di) => <span key={di} style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 5, background: d.kind === 'numbers' ? '#dcfce7' : d.kind === 'names' ? '#fef3c7' : '#ede9fe', color: d.kind === 'numbers' ? '#166534' : d.kind === 'names' ? '#92400e' : '#6d28d9' }}>{d.kind === 'numbers' ? 'Numbers' : d.kind === 'names' ? 'Names' : (d.deco_type || d.type || 'art').replace(/_/g, ' ')}{d.position ? ' · ' + d.position : ''}{d.num_method ? ' · ' + d.num_method.replace(/_/g, ' ') : ''}</span>)}
                        </div>}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{sizeStr || '—'} <span style={{ color: '#94a3b8' }}>({ordered})</span></td>
                      <td style={{ ...td, color: picked >= ordered ? '#166534' : '#92400e', fontWeight: 600 }}>{picked}/{ordered}</td>
                      <td style={{ ...td, color: sh.color, fontWeight: 600 }}>{sh.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginBottom: 6 }}>Customer order tracking</div>
              {renderTrackTable((orders || []).filter((w) => isLiveWebstoreOrder(w) && w.so_id === o.id).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))))}
            </div>
            {(o.jobs || []).length > 0 && <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginBottom: 6 }}>Decoration / production</div>
              {o.jobs.map((j, ji) => (
                <div key={ji} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, minWidth: 140 }}>{j.art_name || (j.deco_type || '').replace(/_/g, ' ') || 'Deco'}</span>
                  <span style={{ color: '#94a3b8' }}>{(j.deco_type || '').replace(/_/g, ' ')}{j.positions ? ' · ' + j.positions : ''}</span>
                  <DecoStat label="Art" value={j.art_status} />
                  <DecoStat label="Prod" value={j.prod_status} />
                  <span style={{ color: '#64748b' }}>{j.fulfilled_units || 0}/{j.total_units || 0} units</span>
                </div>
              ))}
            </div>}
            {(() => {
              const all = batchTransfers(o.id, false); const hasAny = all.designs.length || all.numbers.length;
              if (!hasAny) return null;
              const pulled = batchPulled(o.id);
              const bt = batchTransfers(o.id, true); const pendingAny = bt.designs.length || bt.numbers.length;
              const doPull = () => {
                const total = Object.values(bt.byCode).reduce((a, n) => a + n, 0);
                if (!window.confirm(`Pull ${total} transfers for this batch? This deducts them from On hand and moves the batch to In process.`)) return;
                onPullTransfers && onPullTransfers(o.id, bt.byCode);
              };
              return (
                <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>Transfers to pull for this batch</div>
                    <button onClick={() => printPullSheet(store, String(o.id).slice(0, 8), all.designs, all.numbers, pulled)} style={{ marginLeft: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#475569' }}>🖨️ Pull sheet</button>
                    {pulled
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 6 }}>✓ Pulled — in process</span>
                      : onPullTransfers && pendingAny ? <button onClick={doPull} style={{ background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Pull transfers</button> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {all.designs.map((d) => <span key={d.code} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#ede9fe', color: '#6d28d9' }}>{d.label}: {d.qty}</span>)}
                    {all.numbers.map((n) => <span key={n.code} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#dcfce7', color: '#166534' }}>{n.label}: {n.qty}</span>)}
                  </div>
                </div>
              );
            })()}
            {o._tracking_number && <div style={{ fontSize: 12, color: '#1e40af', marginTop: 8 }}>Tracking: {o._tracking_number}</div>}
          </div></div>
        );
      })}
    </div>
  );
}

// Cross-batch backorder rollup: every ordered unit still waiting on stock, aggregated
// by SKU + size across ALL of the store's batches — and optionally across every store
// belonging to the same customer, since multiple batches (and stores) often ride on
// the same incoming stock shipment. Reuses computeOrderTracking (the same FIFO
// allocation the tracking grids use) so "Open" here always matches the per-line Need
// column in the batch views.
function StoreBackordersView({ store, onOpenSO }) {
  const [scope, setScope] = useState('store'); // 'store' | 'customer' (all this customer's stores)
  const [data, setData] = useState(null);      // { stores, sos, orders, items }
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    (async () => {
      setData(null); setErr('');
      try {
        let stores = [{ id: store.id, name: store.name }];
        if (scope === 'customer' && store.customer_id) {
          const { data: sibs, error: sErr } = await supabase.from('webstores').select('id,name').eq('customer_id', store.customer_id);
          if (sErr) throw sErr;
          if (sibs && sibs.length) stores = sibs;
        }
        const storeIds = stores.map((s) => s.id);
        // The SO-fulfillment chain and the orders query are independent — run them together.
        const [sos, ordsRes] = await Promise.all([
          fetchStoreSOFulfillment(storeIds),
          supabase.from('webstore_orders').select('id,store_id,so_id,status,buyer_name,buyer_email,created_at').in('store_id', storeIds).not('so_id', 'is', null),
        ]);
        if (ordsRes.error) throw ordsRes.error;
        const live = (ordsRes.data || []).filter(isLiveWebstoreOrder);
        const oIds = live.map((o) => o.id);
        const chunks = [];
        for (let i = 0; i < oIds.length; i += 300) chunks.push(oIds.slice(i, i + 300));
        const itemRes = await Promise.all(chunks.map((c) => supabase.from('webstore_order_items').select('*').in('order_id', c)));
        const failed = itemRes.find((r) => r.error);
        if (failed) throw failed.error;
        const items = itemRes.flatMap((r) => r.data || []);
        if (!dead) setData({ stores, sos, orders: live, items });
      } catch (e) { if (!dead) { setErr(e.message || 'Load failed'); setData({ stores: [], sos: [], orders: [], items: [] }); } }
    })();
    return () => { dead = true; };
  }, [store.id, store.name, store.customer_id, scope]);

  const rows = useMemo(() => {
    if (!data) return [];
    const { stores, sos, orders, items } = data;
    const storeName = {}; stores.forEach((s) => { storeName[s.id] = s.name; });
    const soById = {}; sos.forEach((s) => { soById[s.id] = s; });
    const itemsByOrder = {}; items.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
    // Same per-batch FIFO allocation (and live-order filter) as BatchesTab's grids —
    // one shared function, so Open here always equals Need there.
    const track = mergeStoreTracking(sos, orders, itemsByOrder, []);
    const agg = {};
    orders.forEach((w) => {
      const so = soById[w.so_id]; if (!so) return;
      (itemsByOrder[w.id] || []).forEach((i) => {
        if (i.is_bundle_parent) return;
        const t = track[i.id];
        if (!t || !(t.need > 0) || t.status === 'shipped') return;
        if (i.line_status === 'shipped' || i.line_status === 'cancelled') return;
        const sku = t.sku || i.sku || '';
        const k = (sku || i.product_id || i.name || '?') + '|' + (i.size || 'OS');
        // i.name first: t.soName is normalized (trimmed/UPPERCASED) inside
        // computeOrderTracking and would render all-caps here and in the CSV.
        const r = agg[k] = agg[k] || { sku, name: i.name || i.sku || (t.soName || '').toLowerCase() || 'Item', size: i.size || 'OS', open: 0, ordered: 0, incoming: 0, received: 0, buyers: new Set(), batches: new Map() };
        r.open += t.need; r.ordered += t.ordered; r.incoming += t.billed; r.received += t.received;
        r.buyers.add(w.buyer_email || w.buyer_name || w.id);
        const b = r.batches.get(so.id) || { soId: so.id, no: so.webstore_batch_no, label: so.webstore_batch_label, storeName: storeName[so.webstore_id] || '', open: 0 };
        b.open += t.need; r.batches.set(so.id, b);
      });
    });
    return Object.values(agg).map((r) => ({ ...r, buyers: r.buyers.size, batches: [...r.batches.values()] })).sort((a, b) => b.open - a.open || String(a.name).localeCompare(String(b.name)));
  }, [data]);

  const totalOpen = rows.reduce((a, r) => a + r.open, 0);
  const batchCount = new Set(rows.flatMap((r) => r.batches.map((b) => b.soId))).size;
  const exportCsv = () => {
    const header = ['Item', 'SKU', 'Size', 'Open', 'Incoming', 'Received', 'Buyers', 'Batches'];
    const rws = rows.map((r) => [r.name, r.sku, r.size, r.open, r.incoming, r.received, r.buyers, r.batches.map((b) => `${b.storeName ? b.storeName + ' ' : ''}Batch ${b.no != null ? b.no : '?'} (${b.soId})`).join('; ')]);
    downloadCsv(`${(store.slug || store.name || 'store').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-backorders.csv`, header, rws);
  };
  const scopeBtn = (v, lbl) => <button onClick={() => setScope(v)} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid ' + (scope === v ? '#0f172a' : '#e2e8f0'), background: scope === v ? '#0f172a' : '#fff', color: scope === v ? '#fff' : '#334155', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>{lbl}</button>;
  const ctd = { ...td, textAlign: 'center' };
  return (
    <div className="card"><div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>Open backorders — all batches</div>
        {store.customer_id && <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {scopeBtn('store', 'This store')}
          {scopeBtn('customer', 'All customer stores')}
        </div>}
        {rows.length > 0 && <button className="btn btn-sm btn-secondary" onClick={exportCsv}>⬇️ CSV</button>}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Every item unit that's batched but not yet covered by received (or in-house) stock, regardless of which batch it's in — so when a shipment lands, this is the one list of what it can fill.
        {data && <span style={{ fontWeight: 700, color: '#0f172a' }}> {totalOpen} units open · {rows.length} item/size line{rows.length === 1 ? '' : 's'} · {batchCount} batch{batchCount === 1 ? '' : 'es'}{scope === 'customer' ? ` · ${data.stores.length} store${data.stores.length === 1 ? '' : 's'}` : ''}</span>}
      </div>
      {err && <div style={{ fontSize: 12.5, color: '#b91c1c', padding: '8px 0' }}>Could not load backorders: {err}</div>}
      {!data && !err && <div style={{ fontSize: 13, color: '#64748b', padding: '14px 0' }}>Loading backorders…</div>}
      {data && !err && rows.length === 0 && <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, padding: '10px 0' }}>✓ Nothing on backorder — every batched item is covered by received or in-house stock.</div>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
            {[['Item', ''], ['SKU', ''], ['Size', ''], ['Open', 'c'], ['Incoming', 'c'], ['Received', 'c'], ['Buyers', 'c'], ['Batches', '']].map(([h, al]) => <th key={h} style={{ ...th, fontSize: 10.5, textAlign: al === 'c' ? 'center' : 'left' }} title={h === 'Open' ? 'Units still not covered by received or in-house stock' : h === 'Incoming' ? 'Units on vendor bills, allocated to these lines (earliest orders first)' : undefined}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}><span style={{ fontWeight: 600 }}>{r.name}</span></td>
                <td style={td}>{r.sku ? <span style={{ fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}>{r.sku}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={td}>{r.size}</td>
                <td style={ctd}><span style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: 6, padding: '1px 8px', fontWeight: 800 }}>{r.open}</span></td>
                <td style={ctd}><span style={{ color: r.incoming > 0 ? '#1d4ed8' : '#cbd5e1', fontWeight: r.incoming > 0 ? 700 : 500 }}>{r.incoming}</span></td>
                <td style={ctd}><span style={{ color: r.received > 0 ? '#166534' : '#cbd5e1', fontWeight: r.received > 0 ? 700 : 500 }}>{r.received}</span></td>
                <td style={ctd}><span style={{ color: '#475569' }}>{r.buyers}</span></td>
                <td style={td}><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.batches.map((b) => (
                    <span key={b.soId} onClick={() => onOpenSO && onOpenSO(b.soId)} title={`${b.soId}${b.label ? ' · ' + b.label : ''} — ${b.open} open unit${b.open === 1 ? '' : 's'}`} style={{ fontSize: 10.5, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap', cursor: onOpenSO ? 'pointer' : 'default' }}>
                      {scope === 'customer' && b.storeName ? b.storeName + ' · ' : ''}B{b.no != null ? b.no : '?'} · {b.open}
                    </span>
                  ))}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div></div>
  );
}

function DecoStat({ label, value }) {
  const v = (value || 'pending').replace(/_/g, ' ');
  const done = /complete|approved|done|art_complete/i.test(value || '');
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 5, background: done ? '#dcfce7' : '#f1f5f9', color: done ? '#166534' : '#475569' }}>{label}: {v}</span>;
}

function OrdersTab({ orders, orderItems, numbersEnabled, onBatch, onAvailabilityReport, onPlayerReport, onStockReport, onExportCsv, availSizes = {}, onSaveOrderEdits, onRefundOrder, cu, store, soBatch = {}, onOpenSO, msgTagIds = [] }) {
  const [q, setQ] = useState('');
  // Per-order customer message threads (same shared `messages` table the OMG
  // portal and the public order page use).
  const [msgsByOrder, setMsgsByOrder] = useState({});
  const [msgDraft, setMsgDraft] = useState({});
  const [msgBusy, setMsgBusy] = useState(null);
  const orderIdsKey = orders.map((o) => o.id).join(',');
  useEffect(() => {
    const ids = orders.map((o) => String(o.id));
    if (!ids.length) return;
    (async () => {
      const { data } = await supabase.from('messages').select('id,text,ts,created_at,from_customer,read_by_staff,author,entity_id').eq('entity_type', 'webstore_order').in('entity_id', ids);
      const by = {}; (data || []).forEach((m) => { (by[String(m.entity_id)] = by[String(m.entity_id)] || []).push(m); });
      setMsgsByOrder(by);
    })();
  }, [orderIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sendMsg = async (o) => {
    const text = (msgDraft[o.id] || '').trim(); if (!text) return;
    setMsgBusy(o.id);
    const now = new Date();
    const row = { id: 'm' + now.getTime() + Math.random().toString(36).slice(2, 7), entity_type: 'webstore_order', entity_id: String(o.id), so_id: o.so_id || null, author_id: (cu && cu.id) || null, author: (cu && cu.name) || (store && store.name) || 'NSA Team', text, ts: now.toLocaleString(), dept: 'store', from_customer: false, read_by_staff: true, tagged_members: msgTagIds || [] };
    const { error } = await supabase.from('messages').insert(row);
    if (error) { setMsgBusy(null); window.alert('Could not send: ' + error.message); return; }
    setMsgsByOrder((p) => ({ ...p, [o.id]: [...(p[o.id] || []), row] }));
    setMsgDraft((d) => ({ ...d, [o.id]: '' }));
    if (cu && cu.id) { try { await supabase.from('message_reads').upsert([{ message_id: row.id, user_id: cu.id }], { onConflict: 'message_id,user_id' }); } catch {} }
    try { await authFetch('/.netlify/functions/webstore-message-notify', { method: 'POST', body: JSON.stringify({ orderId: o.id, text }) }); } catch {}
    setMsgBusy(null);
  };
  const [fStatus, setFStatus] = useState('all');   // all | pending | in_production | shipped | complete
  const [fPay, setFPay] = useState('all');         // all | paid | unpaid
  const [fBatch, setFBatch] = useState('all');     // all | unbatched | batched
  const [sortBy, setSortBy] = useState('default'); // default | batch_new | batch_old
  const [editId, setEditId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [, setTick] = useState(0);
  const colCount = 9 + (numbersEnabled ? 1 : 0);
  // Flag a line short. Mutate the shared item object so the Batches tab's ship
  // flow (which reads the same orderItems references) holds it back without a
  // reload, then persist and re-render.
  const setItemMissing = async (item, v) => {
    const q = Math.max(0, Math.min(Number(item.qty) || 0, Number(v) || 0));
    item.missing_qty = q;
    setTick((t) => t + 1);
    try { await supabase.from('webstore_order_items').update({ missing_qty: q }).eq('id', item.id); } catch {}
  };
  // Reprint the order's last saved label (no re-buy).
  const reprintLabel = async (o) => { if (!o.label_data) return; try { await printPdfLabels([o.label_data]); } catch {} };
  // Void the order's last label in ShipStation and reopen the shipped lines.
  const voidLabel = async (o) => {
    if (!o.shipstation_shipment_id) return;
    if (!window.confirm(`Void the label for ${o.buyer_name || 'this order'}? This cancels it in ShipStation and reopens the order.`)) return;
    try {
      const res = await shipStationCall('/shipments/voidlabel', { method: 'POST', body: JSON.stringify({ shipmentId: Number(o.shipstation_shipment_id) }) });
      if (res && res.approved === false) throw new Error(res.message || 'ShipStation declined the void.');
      await supabase.from('webstore_order_items').update({ shipped_qty: 0, line_status: 'bagging' }).eq('order_id', o.id).eq('line_status', 'shipped');
      await supabase.from('webstore_shipments').delete().eq('order_id', o.id);
      await supabase.from('webstore_orders').update({ tracking_number: null, carrier: null, label_data: null, shipstation_shipment_id: null, label_cost: null, shipped_at: null }).eq('id', o.id);
      // Re-roll the Sales Order's shipping cost without this order's label.
      if (o.so_id) { try { const { data: soOrds } = await supabase.from('webstore_orders').select('label_cost').eq('so_id', o.so_id); const total = (soOrds || []).reduce((a, x) => a + (Number(x.label_cost) || 0), 0); await supabase.from('sales_orders').update({ _shipping_cost: total, _shipstation_cost: total }).eq('id', o.so_id); } catch {} }
      o.label_data = null; o.shipstation_shipment_id = null;
      (itemsByOrder[o.id] || []).forEach((i) => { if (i.line_status === 'shipped') { i.line_status = 'bagging'; i.shipped_qty = 0; } });
      setTick((t) => t + 1);
    } catch (e) { window.alert('Void failed: ' + e.message); }
  };
  const itemsByOrder = {};
  orderItems.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
  // Order's overall status = the least-advanced REAL line. Bundle parents have no SKU
  // to receive against so they sit at 'pending' forever; keying the badge off items[0]
  // (the parent, inserted first) showed shipped package orders as 'pending'.
  const SRANK = { pending: 0, received: 1, in_production: 2, bagging: 3, shipped: 4, complete: 5 };
  const enrich = (o) => {
    const items = itemsByOrder[o.id] || [];
    const real = items.filter((i) => !i.is_bundle_parent);
    const lineStatus = (real.length ? real : items).reduce((acc, i) => ((SRANK[i.line_status] ?? 0) < (SRANK[acc] ?? 0) ? i.line_status : acc), (real[0] || items[0] || {}).line_status || 'pending');
    return { o, items, players: [...new Set(items.map((i) => i.player_name).filter(Boolean))], numbers: [...new Set(items.map((i) => i.player_number).filter(Boolean))], lineStatus };
  };
  const unbatchedCount = orders.filter((o) => !o.so_id && o.status !== 'pending_payment' && o.status !== 'cancelled').length;
  // Abandoned pre-payment carts (pending_payment — reached Stripe, never paid) and
  // cancelled orders aren't real orders; keep them out of the list so they don't show
  // as a stray "Paid" duplicate of the shopper's actual order.
  const listable = orders.filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled');

  const filtered = listable.map(enrich).filter(({ o, players, numbers, lineStatus }) => {
    if (fStatus !== 'all' && lineStatus !== fStatus) return false;
    if (fPay === 'paid' && o.payment_mode !== 'paid') return false;
    if (fPay === 'unpaid' && o.payment_mode === 'paid') return false;
    if (fBatch === 'batched' && !o.so_id) return false;
    if (fBatch === 'unbatched' && o.so_id) return false;
    if (q.trim()) {
      const hay = `${o.buyer_name} ${o.buyer_email} ${players.join(' ')} ${numbers.join(' ')}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  // Batch number for an order's linked SO (null = not yet batched). Sorting by batch
  // groups orders by when they were processed; unbatched orders sort to the bottom
  // (they haven't been processed yet). Array.sort is stable, so within a batch orders
  // keep their existing order.
  const batchNoOf = (o) => (o.so_id && soBatch[o.so_id] && soBatch[o.so_id].no != null) ? soBatch[o.so_id].no : null;
  const sorted = sortBy === 'default' ? filtered : [...filtered].sort((a, b) => {
    const an = batchNoOf(a.o), bn = batchNoOf(b.o);
    if ((an == null) !== (bn == null)) return an == null ? 1 : -1; // unbatched last
    if (an == null && bn == null) return 0;
    return sortBy === 'batch_old' ? an - bn : bn - an;
  });

  if (!listable.length) return <Empty msg="No orders placed in this store yet." />;
  const sel = { padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, background: '#fff' };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" style={{ flex: 1, minWidth: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, parent, email, number…" />
        <select style={sel} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>{['all', 'pending', 'in_production', 'shipped', 'complete'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}</select>
        <select style={sel} value={fPay} onChange={(e) => setFPay(e.target.value)}><option value="all">All payment</option><option value="paid">Paid</option><option value="unpaid">Team tab</option></select>
        <select style={sel} value={fBatch} onChange={(e) => setFBatch(e.target.value)}><option value="all">All</option><option value="unbatched">Not batched</option><option value="batched">Batched</option></select>
        <select style={sel} value={sortBy} onChange={(e) => setSortBy(e.target.value)} title="Sort orders by the batch they were processed in">
          <option value="default">Sort: default</option>
          <option value="batch_new">Batch: newest first</option>
          <option value="batch_old">Batch: oldest first</option>
        </select>
        {onAvailabilityReport && (
          <button className="btn btn-secondary" disabled={!unbatchedCount} onClick={onAvailabilityReport} title={unbatchedCount ? 'What can we fill, and whose items fall short?' : 'No unbatched orders'} style={!unbatchedCount ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
            📋 Availability report
          </button>
        )}
        {onPlayerReport && (
          <button className="btn btn-secondary" onClick={onPlayerReport} title="Every player and exactly what they ordered (plus who hasn't ordered)">
            👥 Player report
          </button>
        )}
        {onStockReport && (
          <button className="btn btn-secondary" onClick={onStockReport} title="What we can fill from stock, what to order from Adidas, and what's backordered">
            📦 Stock report
          </button>
        )}
        {onExportCsv && (
          <select style={sel} value="" onChange={(e) => { const v = e.target.value; if (v) onExportCsv(v); }} title="Download as CSV (Excel)">
            <option value="">⬇️ Export CSV…</option>
            <option value="players">Players CSV</option>
            <option value="stock">Stock CSV</option>
            <option value="orders">Orders CSV</option>
          </select>
        )}
        <button className="btn btn-primary" disabled={!unbatchedCount} onClick={onBatch} title={unbatchedCount ? 'Pull the open orders into a batch (a Sales Order) — the store stays open' : 'No unbatched orders'} style={!unbatchedCount ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
          Create Batch ({unbatchedCount})
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Showing {filtered.length} of {listable.length} orders.</div>
      <div className="card"><div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={{ ...th, width: 22 }}></th><th style={th}>Buyer / Player</th>{numbersEnabled && <th style={th}>#</th>}<th style={th}>Items</th><th style={th}>Kind</th><th style={th}>Paid?</th><th style={th}>Total</th><th style={th}>Status</th><th style={th}>Batch</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {sorted.map(({ o, items, players, numbers, lineStatus }) => {
              const isOpen = expanded === o.id;
              const lineItems = items.filter((i) => !i.is_bundle_parent);
              const shortTotal = lineItems.reduce((a, i) => a + (Number(i.missing_qty) || 0), 0);
              const shippedLines = lineItems.filter((i) => i.line_status === 'shipped').length;
              return (
              <React.Fragment key={o.id}>
              <tr style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer', background: isOpen ? '#eff6ff' : '#fff' }} onClick={() => setExpanded(isOpen ? null : o.id)}>
                <td style={{ ...td, width: 22, color: '#94a3b8' }}>{isOpen ? '▾' : '▸'}</td>
                <td style={td}><div style={{ fontWeight: 600 }}>{o.buyer_name || '—'}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{players.join(', ') || o.buyer_email}</div></td>
                {numbersEnabled && <td style={td}>{numbers.join(', ') || '—'}</td>}
                <td style={td}>{lineItems.reduce((a, i) => a + (i.qty || 0), 0)}{shippedLines > 0 && <span style={{ color: '#166534', fontWeight: 700 }}> · {shippedLines} shipped</span>}{shortTotal > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> · {shortTotal} short</span>}</td>
                <td style={td}>{o.order_kind === 'bulk' ? <Chip label="Bulk" tone="blue" /> : <Chip label="Individual" />}</td>
                <td style={td}>{o.payment_mode === 'paid' ? <Chip label="Paid" tone="green" /> : <Chip label="Team tab" />}{Number(o.refunded_amt) > 0 && <div style={{ fontSize: 10, color: '#b45309' }}>−{money(o.refunded_amt)} refunded</div>}{Number(o.discount_amt) > 0 && <div style={{ fontSize: 10, color: '#16a34a' }}>{o.coupon_code} −{money(o.discount_amt)}</div>}</td>
                <td style={td}>{money(o.total)}</td>
                <td style={td}><Chip label={(o.status === 'refunded' ? 'refunded' : lineStatus || 'pending').replace(/_/g, ' ')} tone={o.status === 'refunded' ? 'gray' : lineStatus === 'complete' ? 'green' : lineStatus === 'shipped' ? 'blue' : 'slate'} /></td>
                <td style={td}>{o.so_id ? (
                  <div onClick={(e) => { e.stopPropagation(); onOpenSO && onOpenSO(o.so_id); }} style={{ cursor: onOpenSO ? 'pointer' : 'default' }} title={`${o.so_id}${soBatch[o.so_id] && soBatch[o.so_id].label ? ' · ' + soBatch[o.so_id].label : ''}`}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#6d28d9', background: '#ede9fe', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>{soBatch[o.so_id] && soBatch[o.so_id].no != null ? `Batch ${soBatch[o.so_id].no}` : 'Batched'}</span>
                    <div style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#1e40af', marginTop: 2 }}>{o.so_id}</div>
                  </div>
                ) : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>{(onSaveOrderEdits || onRefundOrder) && <button className="btn btn-sm btn-secondary" onClick={() => setEditId(o.id)}>Manage</button>}</td>
              </tr>
              {isOpen && (
                <tr style={{ background: '#eff6ff' }}>
                  <td colSpan={colCount} style={{ padding: '4px 16px 16px' }} onClick={(e) => e.stopPropagation()}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 4 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>{['Item', 'Size', 'Player', 'Qty', 'Ship', 'Short / missing'].map((h) => <th key={h} style={{ ...th, fontSize: 10.5 }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {lineItems.map((i) => (
                          <tr key={i.id} style={{ borderTop: '1px solid #dbeafe' }}>
                            <td style={td}><div style={{ fontWeight: 600 }}>{i.sku || '—'}</div>{i.name && i.name !== i.sku && <div style={{ fontSize: 11, color: '#64748b' }}>{i.name}</div>}</td>
                            <td style={td}>{i.size || '—'}</td>
                            <td style={td}>{[i.player_number && '#' + i.player_number, i.player_name].filter(Boolean).join(' · ') || '—'}</td>
                            <td style={td}>{i.qty}</td>
                            <td style={td}>{(Number(i.shipped_qty) || 0) >= (Number(i.qty) || 0) || i.line_status === 'shipped' ? <span style={{ color: '#166534', fontWeight: 700 }}>✓ Shipped</span> : (Number(i.shipped_qty) || 0) > 0 ? <span style={{ color: '#1d4ed8', fontWeight: 700 }}>{i.shipped_qty}/{i.qty} shipped</span> : Number(i.missing_qty) > 0 ? <span style={{ color: '#b45309', fontWeight: 700 }}>Short</span> : <span style={{ color: '#64748b' }}>To ship</span>}</td>
                            <td style={td}><input type="number" min={0} max={i.qty} value={Number(i.missing_qty) || 0} onChange={(e) => setItemMissing(i, e.target.value)} style={{ width: 64, padding: '5px 8px', borderRadius: 6, border: '1px solid ' + (Number(i.missing_qty) > 0 ? '#fde68a' : '#e2e8f0'), background: Number(i.missing_qty) > 0 ? '#fffbeb' : '#fff', fontSize: 13 }} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 8, fontSize: 11.5, color: '#94a3b8' }}>Lines marked short are held back when you create shipping labels — the order stays open so you can ship the rest later.</div>
                    {(o.label_cost != null || o.tracking_number) && <div style={{ marginTop: 8, fontSize: 11.5, color: '#475569' }}><span style={{ color: '#94a3b8' }}>Label </span><b>{o.label_cost != null ? money(o.label_cost) : '—'}</b>{o.carrier ? ' · ' + String(o.carrier).toUpperCase().replace('STAMPS_COM', 'USPS') : ''}{o.tracking_number ? ' · ' + o.tracking_number : ''}</div>}
                    {(o.label_data || o.shipstation_shipment_id) && <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                      {o.label_data && <button className="btn btn-sm btn-secondary" onClick={() => reprintLabel(o)}>🔁 Reprint label</button>}
                      {o.shipstation_shipment_id && <button className="btn btn-sm btn-secondary" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => voidLabel(o)}>✖ Void label</button>}
                    </div>}
                    {/* Customer message thread — emails the buyer a link to read & reply. */}
                    <div style={{ marginTop: 14, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 12px', background: '#f1f5f9', fontWeight: 700, fontSize: 12, color: '#334155' }}>💬 Messages with {o.buyer_name || 'the customer'}</div>
                      <div style={{ maxHeight: 200, overflowY: 'auto', padding: '8px 12px' }}>
                        {(msgsByOrder[o.id] || []).length === 0
                          ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No messages yet. Send one below — the customer gets an email with a link to read &amp; reply.</div>
                          : (msgsByOrder[o.id] || []).slice().sort((a, b) => String(a.created_at || a.ts).localeCompare(String(b.created_at || b.ts))).map((m) => (
                            <div key={m.id} style={{ marginBottom: 8, textAlign: m.from_customer ? 'left' : 'right' }}>
                              <div style={{ display: 'inline-block', maxWidth: '80%', padding: '6px 10px', borderRadius: 10, textAlign: 'left', background: m.from_customer ? '#fff' : '#dbeafe', border: '1px solid ' + (m.from_customer ? '#e2e8f0' : '#bfdbfe'), fontSize: 12.5 }}>
                                <div style={{ fontWeight: 700, fontSize: 10.5, color: '#64748b', marginBottom: 2 }}>{m.from_customer ? (o.buyer_name || 'Customer') : (m.author || 'NSA')}</div>
                                {m.text}
                              </div>
                            </div>
                          ))}
                      </div>
                      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid #eef1f5' }}>
                        <input value={msgDraft[o.id] || ''} onChange={(e) => setMsgDraft((d) => ({ ...d, [o.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(o); } }} placeholder={o.buyer_email ? 'Message the customer…' : 'No buyer email on file'} style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                        <button className="btn btn-sm btn-primary" disabled={msgBusy === o.id || !(msgDraft[o.id] || '').trim()} onClick={() => sendMsg(o)}>{msgBusy === o.id ? 'Sending…' : 'Send'}</button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div></div>
      {editId && (() => { const o = orders.find((x) => x.id === editId); if (!o) return null; return <OrderManageModal order={o} items={itemsByOrder[o.id] || []} availSizes={availSizes} onSave={onSaveOrderEdits} onRefund={onRefundOrder} onClose={() => setEditId(null)} />; })()}
    </>
  );
}

// Edit an order's line items (size/qty/remove) and issue refunds.
function OrderManageModal({ order, items, availSizes = {}, onSave, onRefund, onClose }) {
  const editable = items.filter((i) => !i.is_bundle_parent);
  const initRows = editable.map((i) => ({ id: i.id, sku: i.sku, name: i.name, size: i.size || '', qty: i.qty || 1, unit_price: i.unit_price, unit_fundraise: i.unit_fundraise, product_id: i.product_id, player_number: i.player_number, player_name: i.player_name, _removed: false }));
  const [rows, setRows] = useState(initRows);
  const [refundAmt, setRefundAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (id, k, v) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const remaining = (Number(order.total) || 0) - (Number(order.refunded_amt) || 0);

  // Auto-suggest refund = value of removed items when user clicks "remove"
  useEffect(() => {
    if (!rows.some((r) => r._removed)) { setRefundAmt(''); return; }
    const bSub = items.filter((i) => i.is_bundle_parent).reduce((a, i) => a + (Number(i.unit_price) || 0) * (Number(i.qty) || 1), 0);
    const bFund = items.filter((i) => i.is_bundle_parent).reduce((a, i) => a + (Number(i.unit_fundraise) || 0) * (Number(i.qty) || 1), 0);
    const sub = bSub + rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_price) || 0) * (Number(r.qty) || 1), 0);
    const fund = bFund + rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_fundraise) || 0) * (Number(r.qty) || 1), 0);
    const nt = Math.max(0, sub + fund - (Number(order.discount_amt) || 0)) + (Number(order.shipping_fee) || 0);
    const delta = Math.max(0, (Number(order.total) || 0) - (Number(order.tax) || 0) - nt);
    setRefundAmt(delta > 0.005 ? delta.toFixed(2) : '');
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only recompute total when the user has actually made a change — bundle
  // components have unit_price:0 (price lives on the parent row which is
  // excluded), so computing from scratch gives a wrong $0 on load.
  const hasChanges = rows.some((r, i) => r._removed || r.size !== initRows[i]?.size || Number(r.qty) !== Number(initRows[i]?.qty));
  // Bundle parents hold the package price (components are $0) and aren't editable, so
  // seed the recompute with their value — otherwise the New total drops every package.
  const bundleBaseSub = items.filter((i) => i.is_bundle_parent).reduce((a, i) => a + (Number(i.unit_price) || 0) * (Number(i.qty) || 1), 0);
  const bundleBaseFund = items.filter((i) => i.is_bundle_parent).reduce((a, i) => a + (Number(i.unit_fundraise) || 0) * (Number(i.qty) || 1), 0);
  const newSubtotal = bundleBaseSub + rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_price) || 0) * (Number(r.qty) || 1), 0);
  const newFund = bundleBaseFund + rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_fundraise) || 0) * (Number(r.qty) || 1), 0);
  const newTotal = Math.max(0, newSubtotal + newFund - (Number(order.discount_amt) || 0)) + (Number(order.shipping_fee) || 0);

  const save = async () => { setBusy(true); const r = await onSave(order, rows); setBusy(false); if (r && r.ok) onClose(); };
  const refund = async () => { setBusy(true); const r = await onRefund(order, Number(refundAmt)); setBusy(false); if (r && r.ok) { setRefundAmt(''); onClose(); } };

  const sectionLabel = { fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', marginBottom: 10 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 580, width: '100%', marginTop: 24, borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef1f5', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0b1220' }}>{order.buyer_name || order.buyer_email}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {order.payment_mode === 'paid' ? <span style={{ color: '#166534', fontWeight: 700 }}>Paid {money(order.total)}</span> : <span style={{ color: '#1e40af', fontWeight: 700 }}>Team tab {money(order.total)}</span>}
              {Number(order.discount_amt) > 0 && <span style={{ color: '#16a34a' }}> · {order.coupon_code} −{money(order.discount_amt)}</span>}
              {Number(order.refunded_amt) > 0 && <span style={{ color: '#b45309' }}> · {money(order.refunded_amt)} refunded</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '18px 20px' }}>
          {order.so_id && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>⚠️ Batched into SO <b>{order.so_id}</b> — adjust that SO too if needed.</div>}

          {/* Items */}
          <div style={sectionLabel}>Items</div>
          <div style={{ background: '#f8fafc', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
            {rows.map((r, idx) => {
              const sizes = availSizes[r.product_id] || [];
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: idx < rows.length - 1 ? '1px solid #eef1f5' : 'none', opacity: r._removed ? 0.4 : 1, background: r._removed ? '#fff5f5' : 'transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0b1220' }}>{r.sku || r.name || 'Item'}</div>
                    {r.name && r.name !== r.sku && <div style={{ fontSize: 11, color: '#64748b' }}>{r.name}</div>}
                    {(r.player_number || r.player_name) && <div style={{ fontSize: 11, color: '#94a3b8' }}>{[r.player_number && '#' + r.player_number, r.player_name].filter(Boolean).join(' · ')}</div>}
                  </div>
                  {sizes.length > 0
                    ? <select value={r.size} disabled={r._removed} onChange={(e) => upd(r.id, 'size', e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, background: '#fff' }}><option value="">size</option>{sizes.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    : <input value={r.size} disabled={r._removed} onChange={(e) => upd(r.id, 'size', e.target.value)} placeholder="size" style={{ width: 70, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />}
                  <input type="number" min={1} value={r.qty} disabled={r._removed} onChange={(e) => upd(r.id, 'qty', e.target.value)} style={{ width: 52, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, textAlign: 'center' }} />
                  <button onClick={() => upd(r.id, '_removed', !r._removed)} style={{ background: 'none', border: 'none', color: r._removed ? '#2563eb' : '#b91c1c', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{r._removed ? 'undo' : 'remove'}</button>
                </div>
              );
            })}
          </div>

          {hasChanges && (
            <div style={{ display: 'flex', justifyContent: 'space-between', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 14 }}>
              <span style={{ color: '#1e40af' }}>New total{Number(order.discount_amt) > 0 ? ` (after ${money(order.discount_amt)} discount)` : ''}</span>
              <span style={{ fontWeight: 800, color: '#1e40af' }}>{money(newTotal)} <span style={{ fontWeight: 400, color: '#94a3b8', textDecoration: 'line-through' }}>{money(order.total)}</span></span>
            </div>
          )}

          <button className="btn btn-primary" disabled={busy || !hasChanges} onClick={save}>{busy ? 'Saving…' : 'Save item changes'}</button>

          {/* Refund */}
          <div style={{ borderTop: '1px solid #eef1f5', marginTop: 20, paddingTop: 18 }}>
            <div style={sectionLabel}>Refund</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
              {order.stripe_pi_id ? "Refunds the buyer's card via Stripe." : 'Team-tab order — records a credit/adjustment (no card to refund).'}
              {Number(order.refunded_amt) > 0 && <> Already refunded <b>{money(order.refunded_amt)}</b>; <b>{money(remaining)}</b> remaining.</>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                <span style={{ padding: '0 10px', color: '#94a3b8', fontSize: 15, borderRight: '1px solid #e2e8f0', height: '100%', display: 'grid', placeItems: 'center' }}>$</span>
                <input type="number" min={0} step="0.01" value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} placeholder={remaining.toFixed(2)} style={{ width: 110, padding: '9px 10px', border: 'none', fontSize: 14, outline: 'none' }} />
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setRefundAmt(remaining.toFixed(2))}>Full ({money(remaining)})</button>
              <button className="btn btn-primary" disabled={busy || !(Number(refundAmt) > 0)} onClick={refund} style={{ background: '#b91c1c', borderColor: '#b91c1c' }}>{busy ? 'Processing…' : order.stripe_pi_id ? 'Refund to card' : 'Record credit'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Roster management: add players (each gets a private /shop link), copy links to
// hand out, and track who has ordered. Marking "ordered" happens automatically
// when a player checks out through their link (webstore-checkout.place_order).
function RosterTab({ store, roster, notOrdered, orders = [], onAdd, onUpdate, onRemove, onInvite, onFlash }) {
  const [showAdd, setShowAdd] = useState(false);
  const [single, setSingle] = useState({ player_name: '', player_number: '', parent_email: '', position: '' });
  const [bulk, setBulk] = useState('');
  const [bulkPos, setBulkPos] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const origin = (typeof window !== 'undefined' && window.location.origin) || '';
  const linkFor = (r) => r.token ? `${origin}/shop/${store.slug}?player=${r.token}` : '';
  const flash = (m) => onFlash && onFlash(m);
  const copyOne = (r) => { const l = linkFor(r); if (!l) return; navigator.clipboard?.writeText(l); setCopiedId(r.id); setTimeout(() => setCopiedId(null), 1500); };
  const copyMany = (rows, label) => {
    const withLinks = rows.filter((r) => r.token);
    if (!withLinks.length) { flash('No links to copy yet.'); return; }
    const text = withLinks.map((r) => `${r.player_name}${r.player_number ? ' #' + r.player_number : ''}: ${linkFor(r)}`).join('\n');
    navigator.clipboard?.writeText(text); flash(`Copied ${withLinks.length} ${label}`);
  };
  const emailMany = async (rows, label) => {
    const ids = rows.filter((r) => r.token && (r.parent_email || '').trim()).map((r) => r.id);
    if (!ids.length) { flash('No players with an email address to send to.'); return; }
    if (!window.confirm(`Email ${ids.length} ${label}?`)) return;
    setBusy(true); await onInvite(ids); setBusy(false);
  };

  const addSingle = async () => {
    if (!single.player_name.trim()) { flash('Enter a player name.'); return; }
    setBusy(true); const r = await onAdd([single]); setBusy(false);
    if (!r || !r.error) setSingle({ player_name: '', player_number: '', parent_email: '', position: single.position });
  };
  const addBulk = async () => {
    const players = bulk.split('\n').map((line) => {
      const parts = line.split(/[,\t]/).map((s) => s.trim());
      // Columns: Name, Number, Email, Position — a per-line position overrides the
      // "these are all…" selector; otherwise every pasted player gets bulkPos.
      return parts[0] ? { player_name: parts[0], player_number: parts[1] || '', parent_email: parts[2] || '', position: parts[3] || bulkPos } : null;
    }).filter(Boolean);
    if (!players.length) { flash('Paste at least one player (one per line).'); return; }
    setBusy(true); const r = await onAdd(players); setBusy(false);
    if (!r || !r.error) { setBulk(''); setShowAdd(false); }
  };

  const fmtDate = (s) => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const posName = (p) => p === 'gk' ? 'Goalkeeper' : p === 'field' ? 'Field' : '';
  const PosSelect = ({ value, onChange, width = 120 }) => (
    <select className="form-input" value={value || ''} onChange={(e) => onChange(e.target.value || null)} style={{ width, fontSize: 12.5, padding: '5px 8px' }}>
      <option value="">— Any —</option>
      <option value="field">Field</option>
      <option value="gk">Goalkeeper</option>
    </select>
  );

  const addPanel = showAdd && (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add players</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div><div style={rLbl}>Player name</div><input className="form-input" value={single.player_name} onChange={(e) => setSingle({ ...single, player_name: e.target.value })} placeholder="Jane Smith" style={{ width: 190 }} onKeyDown={(e) => e.key === 'Enter' && addSingle()} /></div>
        <div><div style={rLbl}>Number</div><input className="form-input" value={single.player_number} onChange={(e) => setSingle({ ...single, player_number: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} placeholder="#" style={{ width: 64 }} onKeyDown={(e) => e.key === 'Enter' && addSingle()} /></div>
        <div><div style={rLbl}>Position</div><PosSelect value={single.position} onChange={(v) => setSingle({ ...single, position: v || '' })} /></div>
        <div><div style={rLbl}>Parent email (optional)</div><input className="form-input" type="email" value={single.parent_email} onChange={(e) => setSingle({ ...single, parent_email: e.target.value })} placeholder="parent@email.com" style={{ width: 210 }} onKeyDown={(e) => e.key === 'Enter' && addSingle()} /></div>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={addSingle}>Add</button>
      </div>
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
        <div style={rLbl}>Or paste a list — one player per line, <code>Name, Number, Email, Position</code> (all but name optional)</div>
        <textarea className="form-input" value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} placeholder={'Jane Smith, 10, parent@email.com, field\nAlex Kim, 1, alex@email.com, gk\nSam Rivera, 7'} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
        <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>These are all:</span>
          <PosSelect value={bulkPos} onChange={(v) => setBulkPos(v || '')} />
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={addBulk}>Add from list</button>
        </div>
      </div>
    </div>
  );

  if (!roster.length) {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>Set up a roster so the club can track who’s ordered — each player gets their own store link.</div>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Close' : '+ Add players'}</button>
        </div>
        {addPanel}
        {!showAdd && <Empty msg="No players yet. Add a roster to hand each player a private link and see who hasn’t ordered." />}
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>{notOrdered.length} of {roster.length} player{roster.length === 1 ? '' : 's'} {notOrdered.length === 1 ? 'has' : 'have'} not ordered yet.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => copyMany(roster, 'links')}>Copy all links</button>
          <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => emailMany(notOrdered, 'not-ordered players their link')}>Email not-ordered</button>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Close' : '+ Add players'}</button>
        </div>
      </div>
      {addPanel}
      <div className="card"><div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Player</th><th style={th}>#</th><th style={th}>Position</th><th style={th}>Parent email</th><th style={th}>Opened?</th><th style={th}>Ordered?</th><th style={th}>Link</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}>{r.player_name}</td>
                <td style={td}>
                  <input defaultValue={r.player_number || ''} onBlur={(e) => { const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4); if (v !== (r.player_number || '')) onUpdate(r.id, { player_number: v || null }); }} placeholder="#" style={{ width: 48, border: '1px solid #e2e8f0', borderRadius: 5, padding: '3px 6px', fontSize: 12.5 }} />
                </td>
                <td style={td}><PosSelect value={r.position} width={118} onChange={(v) => onUpdate(r.id, { position: v })} /></td>
                <td style={td}>{r.parent_email || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={td}>
                  {r.last_opened_at
                    ? <Chip label={`Opened ${fmtDate(r.last_opened_at)}${r.open_count > 1 ? ` ·${r.open_count}×` : ''}`} tone="blue" />
                    : r.invite_sent_at
                      ? <Chip label={`Invited ${fmtDate(r.invite_sent_at)}`} tone="gray" />
                      : <span style={{ color: '#cbd5e1' }}>Not sent</span>}
                </td>
                <td style={td}>{r.ordered ? <Chip label={r.ordered_at ? `Ordered ${fmtDate(r.ordered_at)}` : 'Ordered'} tone="green" /> : <Chip label="Not yet" tone="gray" />}</td>
                <td style={td}>
                  {r.token ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => copyOne(r)} title={linkFor(r)}>{copiedId === r.id ? '✓' : 'Copy'}</button>
                      <button className="btn btn-sm btn-secondary" disabled={busy || !(r.parent_email || '').trim()} title={(r.parent_email || '').trim() ? `Email link to ${r.parent_email}` : 'Add a parent email first'} onClick={async () => { setBusy(true); await onInvite([r.id]); setBusy(false); }}>Email</button>
                    </div>
                  ) : <span style={{ color: '#94a3b8' }}>—</span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button onClick={() => { if (window.confirm(`Remove ${r.player_name} from the roster?`)) onRemove(r.id); }} title="Remove player" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}
const rLbl = { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, fontWeight: 600 };

function SettingsTab({ store: s }) {
  const dlv = s.delivery_mode === 'deliver_club' ? 'Deliver to club' : 'Ship to home';
  const rows = [
    ['Slug', '/shop/' + s.slug],
    ['Status', (s.status || 'draft').toUpperCase()],
    ['Open → Close', `${s.open_at ? String(s.open_at).slice(0, 10) : '—'} → ${s.close_at ? String(s.close_at).slice(0, 10) : '—'}`],
    ['Director', [s.director_name, s.director_email, s.director_phone].filter(Boolean).join(' · ') || '—'],
    ['Payment mode', s.payment_mode === 'either' ? 'Card + invoice-later' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only'],
    ['Login required', s.require_login ? 'Yes (club members only)' : 'No (public)'],
    ['Decoration', s.decoration_mode === 'outsourced' ? 'Decorated elsewhere (mockups only)' : 'In-house (production art required)'],
    ['Delivery', dlv],
    ['Numbers', s.number_enabled ? `Enabled (${s.number_min}–${s.number_max}${s.number_unique ? ', unique required' : ''})` : 'Off'],
    ['SO creation', s.so_creation],
    ['Fundraising', `Per-item${s.fundraise_show_parents ? ', shown to families' : ', hidden from families'}`],
    ['Theme', s.theme || 'classic'],
  ];
  return (
    <div className="card"><div style={{ padding: 16 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
          <div style={{ width: 160, color: '#64748b' }}>{k}</div><div style={{ fontWeight: 600 }}>{v}</div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>Use “Edit settings” above to change these.</div>
    </div></div>
  );
}

function Empty({ msg }) {
  return <div className="card"><div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>{msg}</div></div>;
}

const th = { padding: '10px 12px', fontWeight: 600 };
const td = { padding: '10px 12px', verticalAlign: 'top' };
const arrowBtn = (disabled) => ({ display: 'block', width: 22, height: 18, lineHeight: '16px', textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 4, background: '#fff', color: disabled ? '#cbd5e1' : '#475569', cursor: disabled ? 'default' : 'pointer', fontSize: 9, marginBottom: 2 });

export default Webstores;
