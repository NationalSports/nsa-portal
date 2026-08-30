Y��x-���jם��i��+��j[h��ܢ����x��=ߍ<o+^����ם/* eslint-disable */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { cloudUpload, sendBrevoEmail, authFetch, invokeEdgeFn, printPdfLabels, estimateWeightOz, labelWeightLbs, validateShipAddress, computeOrderTracking, _cloudinaryPdfThumb, _withTimeout, fetchWithTimeout } from './utils';
import { shipStationCall, sanmarResolveSku, ssResolveSku, richardsonResolveSku, momentecResolveSku, resolveSkuAcrossVendors } from './vendorApis';
import { searchVendorCatalogs, vendorColorToProductRow } from './vendorCatalogSearch';
import { NSA, pantoneHex } from './constants';
import { CatalogKitStyles, KitScope, DISPLAY, BODY, FilterBtn, ShowMore } from './ui/catalogKit';
import { fetchStockMap, foldScale, foldedQty, foldedSoon, sizeRank, scaleOf } from './lib/storeInventory';
import { fetchVendorSizeInventory, vendorInvSource } from './vendorInventory';
import { ART_PLACEMENTS, placementById } from './lib/artPlacements';
import { normalizeWebLogos, pickCwAsset, isCommissionRep } from './businessLogic';
import { normSzName } from './pricing';
import { autoColorChoice, resolveItemPlacement, garmentTypeOf, garmentHex, hydrateStoreArt } from './lib/artGrid';
import { buildTeamArtLibrary } from './lib/artIdentity';
import { ptToIso, ptDateInput, ptTimeInput, ptDateLabel, ptTimeLabel, isCustomCloseTime, DEFAULT_CLOSE_TIME, DEFAULT_OPEN_TIME } from './lib/storeClock';
import { ColorWaysEditor } from './components';
import { knockoutWhiteBackground } from './lib/imageKnockout';
import QuickMockBuilder from './QuickMockBuilder';
import { activeWebstoreLines, isLiveWebstoreOrder, mapLinesToSoItems, materializeMappedLine, resolveWebstoreReportLines } from './lib/soPlayerReport';
import { attachAdidasTagSkus } from './lib/adidasSsReport';
import { downloadSilverScreenFulfillment } from './lib/silverScreenFulfillment';

const SS_CARRIERS = { fedex: { carrierCode: 'fedex', serviceCode: 'fedex_ground' }, ups: { carrierCode: 'ups', serviceCode: 'ups_ground' }, usps: { carrierCode: 'stamps_com', serviceCode: 'usps_priority_mail' } };
const originalOrderTotal = (o) => Number(o && (o.original_total != null ? o.original_total : o.total)) || 0;
const orderNetCollected = (o) => Math.max(0, originalOrderTotal(o) - (Number(o && o.refunded_amt) || 0));

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
// Render the calendar day a batch cutoff instant refers to. The cutoff is stored as
// the creating rep's LOCAL end-of-day; rendering that instant directly shows the
// NEXT day for viewers east of the creator. Nudging back 12h lands mid-day of the
// intended date for any viewer within ±11h of the creator's timezone.
const batchCutoffDay = (c) => new Date(new Date(c).getTime() - 12 * 3600 * 1000).toLocaleDateString();

function reportSyncBanner(audit) {
  if (!audit) return '';
  const rows = [];
  (audit.substitutions || []).forEach((s) => rows.push(`↺ ${esc(s.soId)} · ${esc(s.from)} → <b>${esc(s.to)}</b>${s.verify ? ' <i>(best match — verify)</i>' : ''}`));
  (audit.sizeChanges || []).forEach((s) => rows.push(`↺ ${esc(s.soId)} · ${esc(s.sku)} size ${esc(s.from)} → <b>${esc(s.to)}</b>${s.verify ? ' <i>(verify player assignment)</i>' : ''}`));
  (audit.unmatched || []).forEach((u) => rows.push(`⚠ ${esc(u.soId)} · ${esc(u.item)} is active in the store but not matched to the SO`));
  (audit.missingSos || []).forEach((soId) => rows.push(`⚠ ${esc(soId)} could not be loaded`));
  (audit.wrongStoreLinks || []).forEach((x) => rows.push(`⚠ ${esc(x.soId)} belongs to another store — fix the batch link before fulfillment`));
  (audit.unitMismatches || []).forEach((m) => rows.push(`⚠ ${esc(m.soId)} has ${m.soUnits} SO units vs ${m.sourceUnits} active customer units (${m.delta > 0 ? '+' : ''}${m.delta})`));
  return rows.length ? `<div class="syncwarn"><b>Sales-order reconciliation:</b><br>${rows.join('<br>')}</div>` : '';
}

// ─── Per-player roll-up ──────────────────────────────────────────────
// One section per player: exactly what they're getting across the whole store,
// plus the roster members who haven't ordered yet.
function buildPlayerReport(store, lines, orderById, roster, stockByPid, audit) {
  const players = {};
  lines.forEach((i) => {
    const o = orderById[i.order_id] || {};
    const nm = (i.player_name || '').trim();
    const num = (i.player_number != null ? String(i.player_number) : '').trim();
    const key = (nm || num) ? (nm.toLowerCase() + '|' + num) : ('buyer:' + (o.buyer_email || o.buyer_name || i.order_id));
    const p = players[key] || (players[key] = { label: nm || (o.buyer_name ? o.buyer_name + ' (buyer)' : 'Unassigned'), number: num, units: 0, items: [], orders: {} });
    p.units += (i.qty || 1);
    p.items.push({ name: _itemName(i, stockByPid), sku: i._effSku || i.sku || '', adidasTagSku: i._adidasTagSku || '', size: i.size || '', qty: i.qty || 1, buyer: o.buyer_name || '', wasSku: i._wasSku || '', wasSize: i._wasSize || '', verify: !!i._verify, unmatched: !!i._unmatched });
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
    const rows = p.items.map((it) => `<tr${it.unmatched ? ' class="warnrow"' : ''}><td>${esc(it.name)}${it.sku ? `<div class="sub">${it.adidasTagSku ? `<b>S&amp;S:</b> ${esc(it.sku)} · <b>Adidas tag:</b> ${esc(it.adidasTagSku)}` : esc(it.sku)}</div>` : ''}${it.wasSku ? `<div class="was">↺ was SKU ${esc(it.wasSku)}${it.verify ? ' — verify' : ''}</div>` : ''}${it.wasSize ? `<div class="was">↺ was size ${esc(it.wasSize)}${it.verify ? ' — verify' : ''}</div>` : ''}${it.unmatched ? '<div class="was">⚠ not matched to SO — verify</div>' : ''}</td><td class="c">${esc(it.size)}</td><td class="c b">${it.qty}</td><td>${esc(it.buyer)}</td></tr>`).join('');
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
    .sub{font-size:11px;color:#94a3b8}.was{font-size:11px;color:#b45309;font-weight:700}.warnrow td{background:#fffbeb}
    .ord{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:10px;break-inside:avoid}
    .oh{font-weight:800;font-size:14px;margin-bottom:6px}.oh .num{color:#2563eb}.oh .dt{float:right;color:#94a3b8;font-weight:600;font-size:12px}
    .contact{font-size:12px;color:#475569;margin:0 0 8px;line-height:1.5}.contact a{color:#2563eb;text-decoration:none}.contact .ship{color:#64748b;margin-top:2px}
    .warn,.syncwarn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.7}.syncwarn{margin:12px 0}
  </style></head><body>
    <h1>Player Report</h1>
    <div class="meta">${esc(store.name)} · ${new Date().toLocaleString()}</div>
    <div class="chips">${chip(list.length, 'Players')}${chip(totalUnits, 'Items')}${(roster && roster.length) ? chip(notOrdered.length, 'Not ordered') : ''}</div>
    ${reportSyncBanner(audit)}
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
async function fetchSkuStock(skuList) {
  const skus = [...new Set((skuList || []).filter(Boolean))];
  if (!skus.length || !supabase) return {};
  try {
    const out = await _skuStockRows(skus);
    // S&S-imported adidas colorways duplicate a CLICK-synced product under a color-NAME
    // sku ('AT101-BLACK-WHITE') while inventory_unified keys stock by the CLICK code sku
    // ('AT101-50'), so a name-sku line reads 0 vendor stock and the batch modal flags a
    // phantom shortfall. For skus with no inventory rows, find the code-sku sibling —
    // same style prefix AND same colorway in products — and serve ITS stock under the
    // original sku. Only an unambiguous (exactly one) sibling is used, never a guess.
    const missed = skus.filter((s) => !out[s]);
    if (missed.length) {
      const { data: mine } = await supabase.from('products').select('sku,color').in('sku', missed);
      const named = (mine || []).filter((p) => p.sku && p.color);
      const bases = [...new Set(named.map((p) => String(p.sku).split('-')[0]).filter(Boolean))];
      const sibs = [];
      for (const b of bases) {
        const { data } = await supabase.from('products').select('sku,color').ilike('sku', b + '-%');
        sibs.push(...(data || []));
      }
      const cnorm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const alias = {};
      named.forEach((p) => {
        const base = String(p.sku).split('-')[0];
        const pref = (base + '-').toUpperCase();
        const codes = [...new Set(sibs
          .filter((s) => s.sku !== p.sku && String(s.sku).toUpperCase().startsWith(pref) && /^\d+$/.test(String(s.sku).slice(pref.length)) && cnorm(s.color) === cnorm(p.color))
          .map((s) => String(s.sku)))];
        if (codes.length === 1) alias[p.sku] = codes[0];
      });
      const aliasSkus = [...new Set(Object.values(alias))];
      if (aliasSkus.length) {
        const more = await _skuStockRows(aliasSkus);
        Object.entries(alias).forEach(([orig, code]) => { if (more[code]) out[orig] = more[code]; });
      }
    }
    return out;
  } catch { return {}; }
}
// One inventory_unified read, folded per-sku → { SKU: { sizes, sizeEta, sizeIncoming, eta, syncedAt } }.
async function _skuStockRows(skus) {
  const { data } = await supabase.from('inventory_unified').select('sku,size,stock_qty,future_delivery_date,future_delivery_qty,last_synced').in('sku', skus);
  const out = {};
  (data || []).forEach((r) => {
    const e = out[r.sku] || (out[r.sku] = { sizes: {}, sizeEta: {}, sizeIncoming: {}, eta: false, syncedAt: null });
    e.sizes[r.size] = (Number(e.sizes[r.size]) || 0) + (Number(r.stock_qty) || 0);
    if ((Number(r.stock_qty) || 0) <= 0 && r.future_delivery_date) {
      e.eta = true;
      e.sizeEta[r.size] = r.future_delivery_date;
      if ((Number(r.future_delivery_qty) || 0) > 0) e.sizeIncoming[r.size] = Number(r.future_delivery_qty);
    }
    if (r.last_synced && (!e.syncedAt || r.last_synced > e.syncedAt)) e.syncedAt = r.last_synced;
  });
  return out;
}
async function fetchOverrideSkuStock(lines) {
  return fetchSkuStock((lines || []).filter((l) => l._skuOv && l._effSku).map((l) => l._effSku));
}
// Resolve bare SKUs against the server catalog the way manual order entry would:
// exact SKU match adopts the row outright; failing that, the SKU as a base style
// whose colorway rows ("AT105-50", …) unanimously agree on one vendor yields the
// family's vendor/name/brand/(unanimous) cost with id:null — the exact colorway
// stays unknown. An ambiguous family or a SKU the catalog has never seen returns
// nothing: never guess a vendor. Shared by the batch confirm modal (to show which
// items still need a hand) and the SO build (to stamp what it can).
async function resolveSkuInfoBySku(skus) {
  const list = [...new Set((skus || []).filter(Boolean))];
  const skuInfo = {};
  if (!list.length || !supabase) return skuInfo;
  try {
    const { data: exact } = await supabase.from('products').select('id,sku,name,brand,color,vendor_id,nsa_cost').in('sku', list);
    (exact || []).forEach((p) => { if (p.sku && !skuInfo[p.sku]) skuInfo[p.sku] = p; });
    for (const s of list.filter((s) => !skuInfo[s])) {
      const { data: fam } = await supabase.from('products').select('id,sku,name,brand,vendor_id,nsa_cost').like('sku', s + '-%').limit(50);
      const rows = (fam || []).filter((p) => p.vendor_id);
      if (!rows.length) continue;
      const vids = [...new Set(rows.map((p) => p.vendor_id))];
      if (vids.length !== 1) continue;
      const costs = [...new Set(rows.map((p) => String(p.nsa_cost || 0)))];
      skuInfo[s] = { id: null, sku: s, name: rows[0].name, brand: rows[0].brand, color: '', vendor_id: vids[0], nsa_cost: costs.length === 1 ? rows[0].nsa_cost : 0 };
    }
  } catch (e) { console.warn('[Webstores] SKU catalog resolve failed:', e.message); }
  return skuInfo;
}
// ── Deliveries that have already landed ──────────────────────────────
// Vendor stock is a synced SNAPSHOT, not a live feed. When the last sync recorded a
// size as 0-on-hand with units due on a date that has since PASSED, those units are
// at the vendor — our row just hasn't been refreshed yet. Reading that stale 0 as a
// hard shortfall invents shortages that don't exist: JL5412's 5" run was synced
// 2026-07-31 as 0 on hand with 103 / 17 / 13 units due 2026-08-03, so on 2026-08-05
// a two-unit batch reported "need 2, have 0 — more on order" with the goods sitting
// in Adidas' warehouse. Credit the delivered quantity, and label it as inferred so
// nobody mistakes it for a confirmed count.
// Deliberately NOT applied to the public storefront's sold-out math — inferring
// stock there would oversell to customers; here it only softens an internal warning.
// Local calendar date, NOT toISOString() (UTC): after ~5pm Pacific the UTC date has
// already rolled over, which credited tomorrow's deliveries as "arrived" a day early.
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// Fetch EVERY webstore_order_items row for a set of order ids. Chunking the id list
// for `.in()` is not enough: PostgREST caps each RESPONSE at 1000 rows regardless of
// how few ids are in the filter, so a 300-order chunk of multi-item team orders still
// silently truncated — the same "orders show 0/fewer items" bug the chunking was added
// to fix. Each chunk is therefore also paged with .range() (ordered by id so pages are
// stable) until a short page signals the end. Exported for tests.
export const fetchOrderItemRows = async (db, orderIds, pageSize = 1000) => {
  const rows = [];
  const ids = [...new Set(orderIds)].filter(Boolean);
  for (let ii = 0; ii < ids.length; ii += 300) {
    const slice = ids.slice(ii, ii + 300);
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from('webstore_order_items').select('*').in('order_id', slice).order('id').range(from, from + pageSize - 1);
      if (error) return { rows, error };
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
  }
  return { rows, error: null };
};
export function arrivedVendorQty(sizeEta, sizeIncoming, size, today = todayIso()) {
  const eta = String((sizeEta || {})[size] || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eta) || eta > today) return 0;
  return Math.max(0, Number((sizeIncoming || {})[size]) || 0);
}
// Stock picture for one line, override-aware: overridden lines read the
// override SKU's vendor stock (warehouse stock is unknown for a bare SKU → 0);
// normal lines read the product's stock record as before.
// `arrived` = units the vendor said would land on/before today that our snapshot
// still shows as 0 (see arrivedVendorQty); `arrivedEta` / `syncedAt` let callers
// say WHY they're counting them.
export function lineStock(i, stockByPid, stockBySku, madeToOrder) {
  const size = i.size || 'OS';
  if (i._skuOv) {
    const vst = stockBySku[i._effSku];
    const base = i.product_id ? stockByPid[i.product_id] : null;
    // known: we have real stock numbers to SHOW even when the item is untracked
    // (tracking off = never blocked/short, but availability is still informative).
    return { ours: 0, vendor: vst ? (Number(vst.sizes[size]) || 0) : 0, arrived: vst ? arrivedVendorQty(vst.sizeEta, vst.sizeIncoming, size) : 0, arrivedEta: vst ? String((vst.sizeEta || {})[size] || '') : '', syncedAt: (vst && vst.syncedAt) || null, tracked: !!vst && !madeToOrder.has(i.product_id), known: !!vst, onOrder: !!(vst && vst.eta), name: base && base.name };
  }
  const st = i.product_id ? stockByPid[i.product_id] : null;
  // No product stock record, but the unified vendor inventory knows the SKU
  // (API/catalog-synced vendors — S&S adidas, UA, CLICK, …): read vendor stock by
  // SKU so these lines get a real availability picture instead of being skipped.
  // Tracked only for sizes the feed actually lists — a missing size stays "no
  // record" (never a phantom shortfall; some synced rows are '_na' placeholders).
  if (!st && i.sku && stockBySku[i.sku]) {
    const vst = stockBySku[i.sku];
    const has = vst.sizes[size] != null;
    return { ours: 0, vendor: has ? (Number(vst.sizes[size]) || 0) : 0, arrived: has ? arrivedVendorQty(vst.sizeEta, vst.sizeIncoming, size) : 0, arrivedEta: has ? String((vst.sizeEta || {})[size] || '') : '', syncedAt: vst.syncedAt || null, tracked: has && !madeToOrder.has(i.product_id), known: has, onOrder: !!vst.eta, name: i.name };
  }
  return { ours: Number(((st && st.size_stock) || {})[size]) || 0, vendor: Number(((st && st.vendor_size_stock) || {})[size]) || 0, arrived: st ? arrivedVendorQty(st.vendor_size_eta, st.vendor_size_incoming, size) : 0, arrivedEta: String(((st && st.vendor_size_eta) || {})[size] || ''), syncedAt: (st && st.vendor_synced_at) || null, tracked: !!st && !madeToOrder.has(i.product_id), known: !!st, onOrder: !!(st && (st.on_order_qty || st.vendor_eta)), name: st && st.name };
}
// Aggregation key: overridden sizes pool stock separately from the base SKU.
const lineStockKey = (i) => (i.product_id || i.sku || 'x') + (i._skuOv ? '§' + i._effSku : '') + '|' + (i.size || 'OS');

export function aggStock(lines, stockByPid, madeToOrder = new Set(), stockBySku = {}) {
  const agg = {};
  lines.forEach((i) => {
    const pid = i.product_id; const size = i.size || 'OS'; const need = i.qty || 1;
    const k = lineStockKey(i);
    const ls = lineStock(i, stockByPid, stockBySku, madeToOrder);
    if (!agg[k]) agg[k] = {
      name: ls.name || i.name || i.sku || pid, sku: i._effSku || i.sku || '', size, need: 0,
      ours: ls.ours, vendor: ls.vendor, arrived: ls.arrived, tracked: ls.tracked, known: ls.known, onOrder: ls.onOrder,
    };
    agg[k].need += need;
  });
  return Object.values(agg).map((r) => {
    // Deliveries already past their date count as sourceable from the vendor —
    // same rule the batch shortfall check uses, so the report can't call a line
    // backordered that the batch modal cleared.
    const vendorAvail = r.vendor + (r.arrived || 0);
    const fillOurs = Math.min(r.need, r.ours);
    const poVendor = Math.min(Math.max(0, r.need - r.ours), vendorAvail);
    const backorder = r.tracked ? Math.max(0, r.need - r.ours - vendorAvail) : 0;
    return { ...r, vendorAvail, fillOurs, poVendor, backorder };
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
  const srcRow = (r) => `<tr${r.backorder > 0 ? ' class="r"' : ''}><td>${esc(r.name)}${r.sku ? `<div class="sub">${esc(r.sku)}</div>` : ''}</td><td class="c">${esc(r.size)}</td><td class="c">${r.need}</td><td class="c">${r.ours}</td><td class="c">${r.vendorAvail}</td><td class="c b">${r.poVendor > 0 ? r.poVendor : '—'}${r.onOrder && r.poVendor > 0 ? ' <span class="oo">on order</span>' : ''}</td><td class="c b">${r.backorder > 0 ? `<span class="neg">${r.backorder}</span>` : '—'}</td></tr>`;
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
    ${sum((r) => r.arrived || 0) ? `<div class="meta" style="margin-top:8px">Adidas counts include ${sum((r) => r.arrived || 0)} unit(s) from deliveries dated on or before today that our last stock sync hadn't picked up yet — re-run the Adidas sync to confirm.</div>` : ''}
    ${needSrc.length
      ? `<h3>Need to source <span class="ct">${needSrc.length} line${needSrc.length === 1 ? '' : 's'}</span></h3>
         <table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Need</th><th class="c">Ours</th><th class="c">Adidas</th><th class="c">PO Adidas</th><th class="c">Backorder</th></tr></thead><tbody>${needSrc.map(srcRow).join('')}</tbody></table>`
      : '<h3>Need to source</h3><div class="ok">✓ Everything is covered by our own stock.</div>'}
    <h3>Fillable from our stock <span class="ct">${fillable.length} line${fillable.length === 1 ? '' : 's'}</span></h3>
    ${fillable.length ? `<table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Need</th><th class="c">Ours</th></tr></thead><tbody>${fillable.map(fillRow).join('')}</tbody></table>` : '<div class="meta">None.</div>'}
  </body></html>`);
}

// ─── Product roll-up ─────────────────────────────────────────────────
// One row per product (effective SKU): image, name, SKU, color, and how many
// of each size were ordered. The concise "what do we actually need to make"
// view — no buyers, no stock math.
function buildProductReport(store, label, lines, metaByPid, stockByPid, audit) {
  const groups = {};
  lines.forEach((i) => {
    const sku = i._effSku || i.sku || '';
    const key = (i.product_id || '') + '|' + sku + '|' + (i.color || '');
    const m = (i.product_id && metaByPid[i.product_id]) || {};
    const st = (i.product_id && stockByPid[i.product_id]) || {};
    const g = groups[key] || (groups[key] = { name: i.name || m.name || _itemName(i, stockByPid), sku, adidasTagSku: i._adidasTagSku || '', color: i.color || m.color || st.color || '', image: i._reportImage || i.image_url || m.image || st.image_front_url || '', sizes: {}, total: 0, wasSkus: new Set(), wasSizes: new Set(), verify: false, unmatched: false });
    const size = i.size || 'OS';
    const qty = i.qty || 1;
    g.sizes[size] = (g.sizes[size] || 0) + qty;
    g.total += qty;
    if (i._wasSku) g.wasSkus.add(i._wasSku);
    if (i._wasSize) g.wasSizes.add(i._wasSize);
    g.verify = g.verify || !!i._verify;
    g.unmatched = g.unmatched || !!i._unmatched;
  });
  const list = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
  const totalUnits = list.reduce((a, g) => a + g.total, 0);
  const chip = (n, l) => `<div class="chip"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const row = (g) => {
    const sizes = Object.keys(g.sizes).sort((a, b) => (sizeRank(a) - sizeRank(b)) || a.localeCompare(b))
      .map((sz) => `<span class="sz"><b>${esc(sz)}</b> × ${g.sizes[sz]}</span>`).join('');
    return `<tr>
      <td class="img">${g.image ? `<img src="${esc(g.image)}" alt="">` : '<div class="noimg">—</div>'}</td>
      <td><div class="nm">${esc(g.name)}</div>${g.sku ? `<div class="sub">${g.adidasTagSku ? `<b>S&amp;S:</b> ${esc(g.sku)} · <b>Adidas tag:</b> ${esc(g.adidasTagSku)}` : esc(g.sku)}</div>` : ''}${g.color ? `<div class="sub">${esc(g.color)}</div>` : ''}${g.wasSkus.size ? `<div class="was">↺ was SKU ${[...g.wasSkus].map(esc).join(', ')}${g.verify ? ' — verify' : ''}</div>` : ''}${g.wasSizes.size ? `<div class="was">↺ includes size change from ${[...g.wasSizes].map(esc).join(', ')}${g.verify ? ' — verify' : ''}</div>` : ''}${g.unmatched ? '<div class="was">⚠ not matched to SO — verify</div>' : ''}</td>
      <td class="szs">${sizes}</td>
      <td class="c b">${g.total}</td>
    </tr>`;
  };
  printHtml(`<!doctype html><html><head><title>Product report — ${esc(store.name)}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:760px;margin:32px auto;padding:0 24px}
    h1{font-size:21px;margin:0 0 2px}.meta{color:#64748b;font-size:13px;margin-bottom:16px}
    .chips{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 16px}
    .chip{flex:1;min-width:96px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
    .chip .n{font-size:22px;font-weight:900}.chip .l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px;margin-top:2px}
    table.grid{width:100%;border-collapse:collapse;font-size:13px}
    .grid th{text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 8px;color:#64748b;font-size:11px;text-transform:uppercase}
    .grid td{padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
    .grid td.c{text-align:center}.grid td.b{font-weight:800;font-size:15px}
    td.img{width:56px}td.img img{width:48px;height:48px;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px;background:#fff}
    .noimg{width:48px;height:48px;border:1px dashed #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#cbd5e1}
    .nm{font-weight:700}.sub{font-size:11px;color:#94a3b8}.was{font-size:11px;color:#b45309;font-weight:700}.syncwarn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.7;margin:12px 0}
    td.szs{line-height:2}
    .sz{display:inline-block;background:#f1f5f9;border-radius:6px;padding:2px 8px;margin-right:6px;font-size:12px;white-space:nowrap}
    .sz b{font-weight:800}
    @media print{.chip,.sz{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
    <h1>Product Report</h1>
    <div class="meta">${esc(store.name)} · ${esc(label)} · ${new Date().toLocaleString()}</div>
    <div class="chips">${chip(list.length, 'Products')}${chip(totalUnits, 'Units ordered')}</div>
    ${reportSyncBanner(audit)}
    ${list.length ? `<table class="grid"><thead><tr><th></th><th>Item</th><th>Sizes ordered</th><th class="c">Total</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>` : '<div class="meta">No orders yet.</div>'}
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
      options: [i.size && { name: 'Size', value: i.size }, i.player_number && { name: 'Number', value: String(i.player_number) }, i.player_name && { name: 'Name', value: i.player_name }, ...(Array.isArray(i.add_on_selections) ? i.add_on_selections.map((o) => ({ name: o.label || 'Add-on', value: o.kind === 'addon' ? 'Yes' : String(o.value || '') })) : [])].filter(Boolean),
    })),
    amountPaid: order.payment_mode === 'paid' ? orderNetCollected(order) : 0,
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

// Pure computation behind pullBatchTransfers: which transfer rows to decrement (each
// exactly once, regardless of how many orders/SOs share the code) and which so_ids to
// stamp transfers_pulled on. soId accepts a single so_id (team-store single-batch pull)
// or an array (club stores' Group Pull — every converted-but-unpulled order at once,
// each its own SO). Exported so this array-vs-single behavior is unit-testable without
// a live Supabase client.
export function computePullPlan(soId, neededByCode, transfers) {
  const soIds = Array.isArray(soId) ? soId.filter(Boolean) : [soId].filter(Boolean);
  const decrements = (transfers || [])
    .filter((t) => t && neededByCode && neededByCode[t.code])
    .map((t) => ({ id: t.id, on_hand: Math.max(0, (t.on_hand || 0) - neededByCode[t.code]) }));
  return { soIds, decrements };
}

function isMissingTable(err) {
  if (!err) return false;
  const m = (err.message || err.details || '').toLowerCase();
  return err.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache');
}

// ── Coach launch email + printable flyer ─────────────────────────────
// One card per STYLE, matching the storefront grid exactly (Storefront.js's
// variantKey/groupProducts): color variants share `variant_group_id`, and the FIRST
// row in sort_order is the representative whose photo/price leads the card. `items`
// is already sort_order-ordered (loadFlyerItems queries `.order('sort_order')`), so
// keeping the first occurrence per key reproduces that same lead selection.
const _groupFlyerItems = (items) => {
  const seen = new Set(); const out = [];
  for (const it of (items || [])) { const k = it.variant_group_id || it.id; if (seen.has(k)) continue; seen.add(k); out.push(it); }
  return out;
};
const _esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
// Families get the BRANDED marketing URL (nationalsportsapparel.com/shop/<slug>), which the
// marketing site 200-proxies to this storefront — never the raw portal origin staff happen
// to trigger the email from.
const PUBLIC_SITE = 'https://nationalsportsapparel.com';
// Per-image deadline for the flyer PDF's photo/QR fetches (see _imgB64).
const IMG_FETCH_MS = 12_000;
const _storefrontUrl = (store) => `${PUBLIC_SITE}/shop/${store.slug}`;
// QuickChart renders a standard 8-bit PNG that email clients reliably display; the previous
// goqr.me image came back as a 1-bit colormap PNG that several clients/image-proxies dropped.
const _qrImg = (data, size = 300) => `https://quickchart.io/qr?size=${size}&margin=2&ecLevel=M&text=${encodeURIComponent(data)}`;
const _hex = (v, fb) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fb);
// Flyers/emails print the PT close date — slicing the ISO string gave the UTC day,
// which is the day AFTER the rep's date for any evening close time.
const _fmtDate = (d) => ptDateLabel(d, { month: 'long', day: 'numeric', year: 'numeric' });
const _deliveryLabel = (store) => (store.delivery_mode === 'deliver_club' ? 'Delivered to the team' : "Shipped to each buyer's home");
// The item's applied web logos (webstore_products.decorations), front side, not yet baked
// into the photo — the same set the storefront's DecoOverlay composites at render time.
// The flyers must draw these too or items show as blank undecorated garments.
const _flyerDecos = (it) => (Array.isArray(it?.decorations) ? it.decorations : []).filter((d) => d && !d.baked && (d.side || 'front') === 'front' && d.art_url);
// Resolved placement (a decoration's own x/y/w override the preset), in % of the
// storefront card box the garment photo cover-fills.
const _decoPos = (d) => { const pl = placementById(d.placement); return { x: d.x != null ? d.x : pl.x, y: d.y != null ? d.y : pl.y, w: d.w != null ? d.w : pl.w }; };
// Trim SanMar garment photos to a uniform 4:5 frame via Cloudinary (mirrors the
// storefront's normGarment) so a logo drawn at a stored % lands consistently on
// the flyer too. Non-SanMar URLs (store mockups, logo art) pass through unchanged.
const normGarment = (url) => {
  if (!url || typeof url !== 'string') return url;
  let host; try { host = new URL(url).hostname; } catch (e) { return url; }
  if (!/(?:^|\.)cdn[pm]\.sanmar\.com$/i.test(host)) return url;
  return 'https://res.cloudinary.com/dwlyljyuz/image/fetch/e_trim:10/c_pad,w_800,h_1000,b_white,f_jpg,q_auto/' + encodeURIComponent(url);
};

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
  const visItems = _groupFlyerItems((items || []).filter((i) => !i.is_bundle_parent && i.active !== false && i.kind !== 'bundle'));
  // Image fills the whole card; the price floats as a pill badge (team accent color)
  // over the bottom-left corner so the product photo gets the maximum area.
  // A DECORATED garment renders RAW + object-fit:contain in a 4:5 box — exactly the
  // storefront card + art-editor frame — so the web-logo decorations land at the same %
  // placements shoppers see in the store. Undecorated garments keep normGarment's uniform
  // cover fill (nothing to align).
  const decoImgs = (it) => _flyerDecos(it).map((d) => { const p = _decoPos(d); return `<img src="${_esc(d.art_url)}" alt="" style="position:absolute;left:${p.x}%;top:${p.y}%;width:${p.w}%;transform:translate(-50%,-50%);filter:drop-shadow(0 1px 2px rgba(0,0,0,.2));z-index:1"/>`; }).join('');
  const itemCard = (it, h=150) => {
    const dec = _flyerDecos(it).length > 0;
    const gsrc = dec ? it.image_front_url : normGarment(it.image_front_url);
    const gfit = dec ? 'contain' : 'cover';
    return `<div style="position:relative;border:1px solid ${line};border-radius:6px;overflow:hidden;background:#fff;height:${h}px">${it.image_front_url?`<div style="position:relative;height:100%;aspect-ratio:4/5;margin:0 auto"><img src="${_esc(gsrc)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:${gfit}"/>${decoImgs(it)}</div>`:`<div style="width:100%;height:100%;background:linear-gradient(150deg,#F4EFE6,#E8E0D0);display:grid;place-items:center"><span style="font-size:10px;color:#b0a898">No image</span></div>`}${it.retail_price?`<div style="position:absolute;left:8px;bottom:8px;background:${accent};color:#fff;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:15px;line-height:1;padding:4px 11px;border-radius:20px;box-shadow:0 1px 4px rgba(0,0,0,.25)">$${Math.round(Number(it.retail_price))}</div>`:''}</div>`;
  };
  // Render an item array as rows of 4.
  const grid = (arr, h) => { let o = ''; const rows = Math.ceil(arr.length / 4); for (let r = 0; r < rows; r++) { o += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;${r > 0 ? 'margin-top:10px' : ''}">${arr.slice(r * 4, r * 4 + 4).map((it) => itemCard(it, h)).join('')}</div>`; } return o; };
  // Highlighted Player Pack band (only when the store has a bundle).
  const pkgBand = pkg ? `
    <div style="margin:16px 40px 0">
      <div style="display:flex;align-items:stretch;border-radius:10px;overflow:hidden;border:2px solid ${accent};background:linear-gradient(120deg,${primary},${primaryDark});color:#fff">
        ${pkgImgs.length ? `<div style="flex:0 0 130px;background:#fff;display:grid;grid-template-columns:repeat(${pkgImgs.length === 1 ? 1 : 2},1fr);gap:3px;padding:6px;align-content:center">${pkgImgs.map((u) => `<div style="display:flex;align-items:center;justify-content:center;height:${pkgImgs.length <= 2 ? 104 : 52}px"><img src="${_esc(normGarment(u))}" alt="" style="max-width:100%;max-height:100%;object-fit:contain"/></div>`).join('')}</div>` : ''}
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
  const visItems = _groupFlyerItems((items||[]).filter((i)=>!i.is_bundle_parent && i.active!==false && i.kind!=='bundle')).slice(0,8);
  // Pre-load product images (best-effort), including the package images. Supplier CDNs
  // (cdnm.sanmar.com etc.) send no CORS headers, so a direct browser fetch() throws and
  // the flyer rendered empty gray cards — go through image-proxy first (same pattern as
  // QuickMockBuilder), falling back to a direct fetch for hosts the proxy doesn't allow.
  const imgCache = {};
  // Every fetch here is bounded: a supplier CDN (or a cold image-proxy) that accepts the
  // connection and never answers used to hang this Promise.all forever, which silently
  // stalled the launch/share email before it ever reached Brevo. onerror must settle the
  // FileReader promise for the same reason.
  const _imgB64 = async (u) => {
    const toB64 = async (src) => { const resp = await fetchWithTimeout(src, {}, IMG_FETCH_MS); if (!resp.ok) throw new Error('img ' + resp.status); const blob = await resp.blob(); return new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); }); };
    try { return await toB64('/.netlify/functions/image-proxy?url=' + encodeURIComponent(u)); }
    catch(_) { try { return await toB64(u); } catch(_) { return null; } }
  };
  // Match the storefront's garment framing so the flyer items look like the store: a
  // DECORATED garment is fetched RAW (drawn object-fit:contain below, logos mapped onto it)
  // exactly like the store's product card + art editor; an UNDECORATED garment keeps
  // normGarment's uniform trim. Logo art passes through normGarment untouched (it's a no-op
  // for non-SanMar hosts). Map key = raw url so addImg/drawDecos lookups still resolve.
  const fetchOf = new Map();
  const noteGarment = (item, decorated) => { if (item && item.image_front_url && !fetchOf.has(item.image_front_url)) fetchOf.set(item.image_front_url, decorated ? item.image_front_url : normGarment(item.image_front_url)); };
  [pkg, ...visItems].forEach((item) => {
    if (!item) return;
    const decos = _flyerDecos(item);
    noteGarment(item, decos.length > 0);
    decos.forEach((d) => { if (!fetchOf.has(d.art_url)) fetchOf.set(d.art_url, d.art_url); });
  });
  pkgImgs.forEach((u) => { if (u && !fetchOf.has(u)) fetchOf.set(u, normGarment(u)); });
  await Promise.all([...fetchOf.entries()].map(async ([key, src]) => {
    const b64 = await _imgB64(src);
    if (b64) imgCache[key] = b64;
  }));
  // Contain-fit the image inside the (x,iy,w,h) box, centered — drawing at the raw box
  // size stretched photos to the card's aspect ratio and they came out scrunched.
  const addImg = (b64, x, iy, w, h) => { try {
    const fmt=b64.startsWith('data:image/png')?'PNG':b64.startsWith('data:image/webp')?'WEBP':'JPEG';
    let dw=w, dh=h, dx=x, dy=iy;
    try { const p=doc.getImageProperties(b64); if (p.width>0 && p.height>0) { const s=Math.min(w/p.width, h/p.height); dw=p.width*s; dh=p.height*s; dx=x+(w-dw)/2; dy=iy+(h-dh)/2; } } catch(_) {}
    doc.addImage(b64,fmt,dx,dy,dw,dh,'','FAST'); return {dx,dy,dw,dh};
  } catch(_) { return false; } };
  // Composite the item's applied web logos over its drawn garment photo, mirroring the
  // storefront's DecoOverlay. Placements are % of a 4:5 card box that CONTAIN-fits the raw
  // garment (matching the store card + the art editor); the PDF also contain-fits the photo,
  // so map box-% → garment fractions → PDF points.
  const drawDecos = (item, rect) => {
    if (!rect || !item) return;
    const gb64 = imgCache[item.image_front_url]; if (!gb64) return;
    let gp; try { gp = doc.getImageProperties(gb64); } catch(_) { return; }
    if (!(gp && gp.width > 0 && gp.height > 0)) return;
    const cw = 0.8, ch = 1; // storefront card box aspect (4:5), arbitrary units
    const s = Math.min(cw/gp.width, ch/gp.height); // CONTAIN-fit — matches the store
    const ox = (cw - gp.width*s)/2, oy = (ch - gp.height*s)/2;
    _flyerDecos(item).forEach((d) => {
      const b = imgCache[d.art_url]; if (!b) return;
      let lp; try { lp = doc.getImageProperties(b); } catch(_) { return; }
      const p = _decoPos(d);
      const u = ((p.x/100)*cw - ox)/(gp.width*s), v = ((p.y/100)*ch - oy)/(gp.height*s);
      const wpt = ((p.w/100)*cw)/(gp.width*s)*rect.dw;
      const hpt = (lp.width > 0 && lp.height > 0) ? wpt*lp.height/lp.width : wpt;
      const fmt = b.startsWith('data:image/png')?'PNG':b.startsWith('data:image/webp')?'WEBP':'JPEG';
      try { doc.addImage(b, fmt, rect.dx + u*rect.dw - wpt/2, rect.dy + v*rect.dh - hpt/2, wpt, hpt, '', 'FAST'); } catch(_) {}
    });
  };
  // Player Pack highlight band
  if (pkg) {
    y += 14;
    const bh = 88;
    doc.setFillColor(pr,pg,pb); doc.setDrawColor(ar,ag,ab); doc.setLineWidth(1.5); doc.roundedRect(40,y,W-80,bh,6,6,'FD');
    let tx = 54;
    if (pkgImgs.length) {
      const bx=48, by=y+8, bw=72, bhh=bh-16;
      doc.setFillColor(255,255,255); doc.roundedRect(bx,by,bw,bhh,4,4,'F');
      if (pkgImgs.length === 1) { const b=imgCache[pkgImgs[0]]; if (b) { const r = addImg(b, bx+4, by+4, bw-8, bhh-8); if (pkgImgs[0] === pkg.image_front_url) drawDecos(pkg, r); } }
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
      const r = b64 && addImg(b64,x+5,iy+5,colW-10,cardH-10);
      if(!r){ doc.setFillColor(235,231,224); doc.rect(x+5,iy+5,colW-10,cardH-10,'F'); }
      else drawDecos(item, r);
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
    const qrResp = await fetchWithTimeout(_qrImg(url, 200), {}, IMG_FETCH_MS);
    const qrBlob = await qrResp.blob();
    const qrB64 = await new Promise((resolve)=>{ const r=new FileReader(); r.onloadend=()=>resolve(r.result); r.readAsDataURL(qrBlob); });
    doc.addImage(qrB64,'PNG',W/2-70,y,140,140,'','FAST');
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

// Send the "store is live" email to one recipient, flyer PDF attached when it fits.
// Netlify's function payload cap (~6MB) rejects an oversized flyer BEFORE the request
// ever reaches Brevo, so: skip the attachment when the base64 is too big, and if a
// with-attachment send still fails, retry once without it so the email always goes out.
const _FLYER_ATTACH_MAX_B64 = 4_500_000; // chars ≈ 3.4MB binary, safe under the cap
// The flyer is a nice-to-have; the LINK is the point of this email. Building the PDF
// pulls every product photo over the network, so bound the whole build — a stall here
// must cost the attachment, never the email. (Before this, a hung image fetch stopped
// _sendLaunchEmail before Brevo was ever called: no email, no error, and the UI had
// already flashed "Generating flyer PDF…" as if the send were under way.)
const _FLYER_BUILD_MS = 45_000;
async function _sendLaunchEmail(store, to, coachUrl) {
  const items = await loadFlyerItems(store);
  let attachment;
  try {
    const b64 = await _withTimeout(generateFlyerPdfBase64(store, items), _FLYER_BUILD_MS, 'Flyer PDF build timed out');
    if (b64 && b64.length <= _FLYER_ATTACH_MAX_B64) attachment = [{ content: b64, name: `${store.slug || 'team-store'}-flyer.pdf` }];
  } catch (_) {}
  const base = { to: [{ email: to, name: store.director_name || '' }], subject: `Your team store is live: ${store.name}`, htmlContent: launchEmailHtml(store, coachUrl), senderName: 'National Sports Apparel', senderEmail: 'noreply@nationalsportsapparel.com' };
  let r = await sendBrevoEmail(attachment ? { ...base, attachment } : base);
  let attached = !!attachment;
  if (r && r.error && attachment) { r = await sendBrevoEmail(base); attached = false; }
  return { ...(r || {}), attached };
}

// Load a store's catalog shaped for the flyer/PDF: resolves each item's display
// name and front image (store mockup → master product photo), and KEEPS inactive
// items (bundle components) so the flyer can surface the package's hero image.
// webstore_products has no image_front_url column — it's image_url here.
async function loadFlyerItems(store) {
  // NOTE: webstore_products has NO is_bundle_parent column — selecting it 400s the whole query
  // (which silently emptied the flyer). Bundles are detected by kind==='bundle' below.
  const { data: cat } = await supabase.from('webstore_products')
    .select('id,display_name,retail_price,image_url,product_id,kind,active,decorations,variant_group_id')
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

// Tabs a deep link may open the store on (matches StoreDetail's PRIMARY_TABS + MORE_TABS).
// An unknown/absent ?tab= falls back to the default catalog tab.
const DEEP_LINK_TABS = new Set(['catalog', 'appearance', 'orders', 'art', 'analytics', 'batches', 'inventory', 'roster', 'coupons']);

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
  const [focusOrderId, setFocusOrderId] = useState(null); // deep-linked order to auto-open in the Orders tab
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
  const [templateFor, setTemplateFor] = useState(null);         // store being saved as a template → SaveAsTemplateModal
  const [tplAfterEdit, setTplAfterEdit] = useState(null);       // { storeId, tpl } — color picker queued to open after the settings save (Start Store from a store template)

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
    // Anything that throws on the way to Brevo has to surface: an uncaught rejection
    // here left the rep with a stale "Generating flyer PDF…" toast and no send.
    try {
      const r = await _sendLaunchEmail(store, to, coachPortalUrl(store));
      if (r && r.error) flash('Email failed: ' + r.error);
      else flash('Store link emailed to ' + to + (r.attached ? ' with PDF flyer' : ' (link only — the PDF flyer could not be attached)'));
    } catch (e) { flash('Email failed: ' + (e.message || e)); }
  }, [coachPortalUrl, flash]);

  // Open the print-ready flyer in its own tab.
  const openFlyer = useCallback((store, items = []) => {
    const w = window.open('', '_blank');
    if (!w) { flash('Allow pop-ups to open the flyer.'); return; }
    w.document.write(flyerHtml(store, items)); w.document.close();
  }, [flash]);

  const loadStores = useCallback(async () => {
    setLoading(true); setErr(null); setNeedsMigration(false);
    // `webstores` is RLS authenticated-only (migration 00134_webstore_rls_lockdown):
    // a read that fires before the auth token is attached — or after it lapsed while an
    // idle tab's background refresh was throttled — runs as the anon role, because
    // supabase-js falls back to the anon key when the client has no session. RLS answers
    // an anon read with an EMPTY array and NO error, which this loader used to treat as
    // "0 stores" — blanking the page ("No stores match these filters", every tile 0) while
    // a still-signed-in second tab showed every store. Confirm a live session (refreshing a
    // lapsed token) before trusting an empty result. Mirrors utils.js authFetch's guard.
    let authed = false;
    try {
      let { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) {
        try { await supabase.auth.refreshSession(); } catch { /* offline / no refresh token */ }
        ({ data: sess } = await supabase.auth.getSession());
      }
      authed = !!sess?.session;
    } catch { authed = false; }

    const { data, error } = await supabase.from('webstores').select('*').eq('source', 'webstore').order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) setNeedsMigration(true); else setErr(error.message);
      setStores([]);
    } else if ((data || []).length === 0 && !authed) {
      // Still no session → this is a blocked read, not an empty account. Surface a
      // recoverable prompt (the error card's Retry re-runs loadStores) instead of a
      // misleading empty page that looks like every store was deleted.
      setErr('Couldn’t confirm your sign-in, so your webstores didn’t load. Click Retry — if it keeps happening, sign out and back in.');
      setStores([]);
    } else {
      setStores((data || []).filter((s) => s.source !== 'omg' && !s.omg_sale_code));
      // Fetch per-store aggregate stats. Exclude abandoned card carts
      // (pending_payment — created before Stripe confirms) and cancelled orders,
      // which would otherwise inflate every store's Gross Sales and order count.
      // so_id rides along so the list can tell a closed store that's been fully
      // processed (every order batched onto a Sales Order) from one still waiting —
      // and so a processed store can link straight to the SO(s) it was batched onto
      // instead of showing a storefront URL nobody needs once the store is worked.
      const { data: aggOrders } = await supabase.from('webstore_orders').select('store_id, total, original_total, status, refunded_amt, so_id');
      const stats = {};
      const soSets = {};
      (aggOrders || []).filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled').forEach((o) => {
        if (!stats[o.store_id]) { stats[o.store_id] = { revenue: 0, orders: 0, batched: 0, soIds: [] }; soSets[o.store_id] = new Set(); }
        stats[o.store_id].revenue += orderNetCollected(o);
        stats[o.store_id].orders += 1;
        if (o.so_id) { stats[o.store_id].batched += 1; soSets[o.store_id].add(o.so_id); }
      });
      Object.keys(stats).forEach((sid) => { stats[sid].soIds = [...soSets[sid]].sort(); });
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
    const [catRes, bundleRes, stockRes, ordRes, rosterRes, claimRes, transferRes, couponRes] = await Promise.all([
      supabase.from('webstore_products').select('*').eq('store_id', sid).order('sort_order'),
      supabase.from('webstore_bundle_items').select('*').order('sort_order'),
      supabase.from('webstore_storefront_products').select('webstore_product_id,product_id,size_stock,on_order_qty,earliest_eta,vendor_size_stock,vendor_on_hand,available_sizes,vendor_eta,vendor_size_eta,vendor_size_incoming,vendor_synced_at,name,color,category,image_front_url').eq('store_id', sid),
      supabase.from('webstore_orders').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
      supabase.from('webstore_roster').select('*').eq('store_id', sid).order('player_name'),
      supabase.from('webstore_number_claims').select('*').eq('store_id', sid).order('player_number'),
      supabase.from('webstore_transfers').select('*').eq('store_id', sid).order('kind').order('code'),
      supabase.from('webstore_coupons').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
    ]);
    // Order items are fetched SCOPED to this store's orders, chunked AND paged
    // (see fetchOrderItemRows) — a blanket `select('*')` truncated at the PostgREST
    // 1000-row cap, and so did any single 300-order chunk of multi-item orders.
    const { rows: _itemRows } = await fetchOrderItemRows(supabase, (ordRes.data || []).map((o) => o.id));
    const itemRes = { data: _itemRows };
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
      // Parent-library art must NEVER replace a team-owned record of the same name
      // (that was how football art snuck onto volleyball stores / batch SOs — a parent
      // copy with a preview image overwrote the team's id in the name-deduped pool).
      // buildTeamArtLibrary keeps team rows authoritative; parent only fills gaps.
      const orderArt = [];
      (allSos || []).filter((s) => s.customer_id === store.customer_id).forEach((so) => (so.art_files || []).forEach((a) => orderArt.push({ art: a, label: so.id, srcCustId: store.customer_id })));
      (allEsts || []).filter((e) => e.customer_id === store.customer_id).forEach((e) => (e.art_files || []).forEach((a) => orderArt.push({ art: a, label: e.id, srcCustId: store.customer_id })));
      // The parent program's own order/estimate art also cascades to the child store — a logo the
      // program set up on its own order should be reusable by its teams, just like the parent's
      // curated library. buildTeamArtLibrary treats it as parent-level (gap-fill, never clobbers team).
      const parentOrderArt = [];
      if (cust?.parent_id) {
        (allSos || []).filter((s) => s.customer_id === cust.parent_id).forEach((so) => (so.art_files || []).forEach((a) => parentOrderArt.push({ art: a, label: so.id, srcCustId: cust.parent_id })));
        (allEsts || []).filter((e) => e.customer_id === cust.parent_id).forEach((e) => (e.art_files || []).forEach((a) => parentOrderArt.push({ art: a, label: e.id, srcCustId: cust.parent_id })));
      }
      libraryArt = buildTeamArtLibrary({
        teamArt: cust?.art_files || [],
        parentArt: par?.art_files || [],
        parentOrderArt,
        orderArt,
        teamId: cust?.id,
        parentId: par?.id,
        parentLabel: (par?.alpha_tag || par?.name || 'Parent') + ' library',
      });
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

  const openStore = useCallback(async (store, opts = {}) => {
    setSel(store); setTab(opts.tab || 'catalog'); setFocusOrderId(opts.focusOrder || null); setDetail(null);
    await loadDetail(store);
  }, [loadDetail]);

  // Deep-link boot: the store-closed email's "Process the store" button and the rep daily
  // digest's store/order links land here — ?pg=webstores&store=<id>[&tab=<tab>][&order=<id>].
  // Once the store list is loaded, open that store on the requested tab (defaulting to
  // catalog) and auto-open any linked order in the Orders tab. The params are KEPT in the URL
  // (not stripped) so the open store is a real address: a refresh reopens exactly this store
  // (and order), and the Back button has an entry to return to. Runs once; the sync effect
  // below keeps the URL in step from here on.
  const _deepLinked = useRef(false);   // boot has run
  const _wsRoutePrev = useRef(null);   // last route we wrote: "storeId|tab|order"
  const _wsRoutePop = useRef(false);   // the pending change came from Back/Forward — don't re-push
  useEffect(() => {
    if (_deepLinked.current || loading) return;
    let id = null, tabParam = null, orderParam = null;
    try { const p = new URLSearchParams(window.location.search); id = p.get('store'); tabParam = p.get('tab'); orderParam = p.get('order'); } catch { /* */ }
    if (id) {
      if (!stores.length) return; // wait for the store list before giving up on the deep-link
      const store = stores.find((s) => s.id === id);
      const resolvedTab = DEEP_LINK_TABS.has(tabParam) ? tabParam : 'catalog';
      if (store) {
        openStore(store, { tab: DEEP_LINK_TABS.has(tabParam) ? tabParam : undefined, focusOrder: orderParam || undefined });
        // Canonicalize (keep the deep-link, normalize ?tab=) — replaceState, no new entry.
        try { const u = new URL(window.location); u.searchParams.set('store', store.id); u.searchParams.set('tab', resolvedTab); if (orderParam) u.searchParams.set('order', orderParam); else u.searchParams.delete('order'); window.history.replaceState({}, '', u); } catch { /* */ }
        _wsRoutePrev.current = store.id + '|' + resolvedTab + '|' + (orderParam || '');
      } else {
        try { const u = new URL(window.location); ['store', 'tab', 'order'].forEach((k) => u.searchParams.delete(k)); window.history.replaceState({}, '', u); } catch { /* */ }
      }
    }
    _deepLinked.current = true;
  }, [stores, loading, openStore]);

  // Keep ?store=/?tab=/?order= in step with the open store so it stays its own address and
  // history entry: opening (or switching) a store pushes an entry; changing tab or closing
  // the store replaces (a tab is a sub-view, not a new page). Gated on the boot above so it
  // can't strip the initial deep-link before that opens it.
  useEffect(() => {
    if (typeof window === 'undefined' || !_deepLinked.current) return;
    const key = sel ? (sel.id + '|' + (tab || 'catalog') + '|' + (focusOrderId || '')) : '';
    if (_wsRoutePop.current) { _wsRoutePop.current = false; _wsRoutePrev.current = key; return; }
    try {
      const u = new URL(window.location);
      if (sel) { u.searchParams.set('store', sel.id); u.searchParams.set('tab', tab || 'catalog'); if (focusOrderId) u.searchParams.set('order', focusOrderId); else u.searchParams.delete('order'); }
      else { ['store', 'tab', 'order'].forEach((k) => u.searchParams.delete(k)); }
      const target = u.pathname + u.search + u.hash;
      if (target !== (window.location.pathname + window.location.search + window.location.hash)) {
        const prev = _wsRoutePrev.current;
        const prevStore = prev ? prev.split('|')[0] : '';
        const opening = !prevStore && sel;                       // list -> store
        const switching = prevStore && sel && prevStore !== sel.id; // store A -> store B
        if (opening || switching) window.history.pushState({}, '', target);
        else window.history.replaceState({}, '', target);         // tab change / close
      }
      _wsRoutePrev.current = key;
    } catch { /* history unavailable — non-fatal */ }
  }, [sel, tab, focusOrderId]);

  // Back/Forward: reconcile the open store / tab / order FROM the URL. Flags _wsRoutePop so
  // the sync effect above records the change instead of pushing it back onto the stack.
  const _applyWsRoute = useCallback(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const storeId = p.get('store') || null;
      const tabParam = p.get('tab');
      const orderParam = p.get('order') || null;
      let changed = false;
      if (storeId !== (sel ? sel.id : null)) {
        if (storeId) { const store = stores.find((s) => s.id === storeId); if (store) { openStore(store, { tab: DEEP_LINK_TABS.has(tabParam) ? tabParam : undefined, focusOrder: orderParam || undefined }); changed = true; } }
        else { setSel(null); setDetail(null); changed = true; }
      } else if (sel && tabParam && DEEP_LINK_TABS.has(tabParam) && tabParam !== tab) { setTab(tabParam); changed = true; }
      if (changed) _wsRoutePop.current = true;
    } catch { /* noop */ }
  }, [sel, tab, stores, openStore]);
  useEffect(() => {
    const onPop = () => _applyWsRoute();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [_applyWsRoute]);

  // ── writes ──────────────────────────────────────────────────────────
  // When a store is launched, email the coach/director the polished launch email
  // (shop link + scannable QR + key info + their tracking portal).
  const notifyCoachPublished = useCallback(async (store) => {
    const to = (store.coach_contact_email || store.director_email || '').trim();
    if (!to) { flash('Launched (no coach/director email on file to notify).'); return; }
    try {
      const r = await _sendLaunchEmail(store, to, coachPortalUrl(store));
      // Surface a failed send — this used to ignore the result and claim the email
      // went out even when it never reached Brevo.
      if (r && r.error) flash('Launched — but the coach email FAILED: ' + r.error);
      else flash('Launched — family flyer emailed' + (r.attached ? ' with PDF attachment' : '') + '.');
    } catch (e) { flash('Launched (coach email failed: ' + (e.message || e) + ').'); }
  }, [coachPortalUrl, flash]);

  // On a manual close, trigger the server handler that creates a rep to-do and emails the
  // rep + assigned CSR a breakdown of the closed store. The scheduled webstore-close-sweep
  // does the same for stores that close automatically on their schedule; both are idempotent
  // (closed_notified_at) so a store is processed once. Fund settlement is prompted
  // separately when the batched SO's final job finishes (App.js settle-on-finish).
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
    if (/badger|alleson|augusta|holloway|russell\s*athletic|high\s*five/i.test(m)) return find(/momentec/i);
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
          // OMG labels sized apparel with an age/gender qualifier — "Adult S", "Adult Medium",
          // "Youth L". normSzName strips the qualifier and normalizes the remainder (Adult Small → S).
          // A bare "Adult" with no size is a genuine one-size item → OSFA. The old /^adult\b/ shortcut
          // collapsed EVERY "Adult …" size to OSFA, so a multi-size store imported as one OSFA bucket.
          const sz = /^adult$/i.test(rawSz) ? 'OSFA' : normSzName(rawSz);
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
    let product_id = null, vendor_id = null, cost = 0, _cost_source = '', resolvedSku = skuClean;
    const { data: rows } = await supabase.from('products').select('id,sku,brand,vendor_id,nsa_cost').ilike('sku', skuClean).limit(1);
    let catMatch = rows && rows[0];
    // OMG reports carry a STYLE number ("ST420") + a color name, but the catalog and the live
    // stock table (inventory_unified) are keyed per color ("ST420-TrueRoyal"). A bare style
    // matches neither, which made every SanMar/S&S item read "out of stock" and "not linked".
    // Resolve this row's color variant and adopt its exact SKU so cost, the catalog link, AND
    // stock all land on the right row.
    if (!catMatch && p.color) {
      const { data: variants } = await supabase.from('products').select('id,sku,brand,vendor_id,nsa_cost,color').ilike('sku', skuClean + '-%').limit(500);
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const want = norm(p.color);
      const hits = (variants || []).filter((v) => norm(v.color) === want || norm(String(v.sku).slice(skuClean.length + 1)) === want);
      // Prefer the canonical CamelCase SKU (what inventory is keyed by) over any all-uppercase
      // duplicate left behind by an older manual add.
      catMatch = hits.find((v) => /[a-z]/.test(v.sku)) || hits[0] || null;
    }
    if (catMatch) {
      product_id = catMatch.id;
      resolvedSku = catMatch.sku || skuClean;
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
    return { ...p, sku: resolvedSku, product_id, vendor_id, cost, _cost_source };
  }, []);

  // Live availability for the OMG review rows, keyed by product_id || 'omgtmp:'+index to
  // match the review table's stock.get(key) lookup.
  //
  // DB-synced feeds (adidas CLICK / Agron / UA / Nike + NSA in-house) come from fetchStockMap.
  // Supplier-API vendors (SanMar / S&S / Richardson / Momentec) are pulled LIVE per style+color
  // via fetchVendorSizeInventory — the same source the App.js OMG pull uses. The synced view
  // couldn't serve these: it keys SanMar/S&S stock by {style}-{color} (e.g. "ST420-Black"),
  // while the OMG report hands over the bare style ("ST420"), so the exact-SKU match found
  // nothing and every in-stock item read "⚠ out of stock". The live API also covers styles the
  // nightly sync hasn't ingested yet. offset lets a single-row re-resolve reuse this by its index.
  const omgBuildStock = useCallback(async (resolved, vendList, offset = 0) => {
    const keyOf = (p, i) => p.product_id || ('omgtmp:' + (offset + i));
    const map = await fetchStockMap(resolved.map((p, i) => ({ id: keyOf(p, i), sku: p.sku }))).catch(() => new Map());
    await Promise.allSettled(resolved.map(async (p, i) => {
      const vRec = (vendList || []).find((v) => v.id === p.vendor_id);
      const src = vendorInvSource(vRec, { brand: p.manufacturer });
      if (!['ss', 'sm', 'rs', 'mt'].includes(src)) return; // DB-synced / in-house — fetchStockMap already covered it
      let inv;
      try { inv = await fetchVendorSizeInventory(src, { sku: p.sku, color: p.color, sizes: p.sizes, available_sizes: Object.keys(p.sizes || {}) }); }
      catch { return; } // API miss → keep whatever the synced view had
      const sizeStock = {};
      for (const [sz, q] of Object.entries(inv.sizes || {})) { const n = Number(q) || 0; if (n > 0) { const k = normSzName(String(sz).trim()); sizeStock[k] = (sizeStock[k] || 0) + n; } }
      if (!Object.keys(sizeStock).length && !inv.nextAvail) return; // nothing live → don't clobber the DB result
      map.set(keyOf(p, i), {
        units: Object.values(sizeStock).reduce((a, q) => a + q, 0),
        sizes: Object.keys(sizeStock).sort((a, b) => sizeRank(a) - sizeRank(b)),
        sizeStock,
        incoming: !Object.keys(sizeStock).length && !!inv.nextAvail,
      });
    }));
    return map;
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
      try { stock = await omgBuildStock(resolved, vl); } catch { /* show without stock */ }
      setOmgItems(resolved.map((p) => ({ ...p, _included: true })));
      setOmgStock(stock);
      setOmgName(storeName);
      setOmgCustomerId('');
      setOmgStep('review');
    } catch (e) { flash('Failed: ' + e.message); } finally { setOmgFetching(false); }
  }, [flash, _omgResolveOne, omgBuildStock]);

  // A staff-edited SKU re-sources cost/vendor and re-checks live stock for that one row.
  const omgResolveRow = useCallback(async (index, newSku) => {
    const skuClean = (newSku || '').trim().toUpperCase();
    setOmgItems((prev) => prev.map((p, i) => (i === index ? { ...p, sku: skuClean, _resolving: true } : p)));
    const cur = omgItems[index];
    if (!cur) return;
    const resolved = await _omgResolveOne({ ...cur, sku: skuClean }, omgVendList, omgMomentecDiscount);
    setOmgItems((prev) => prev.map((p, i) => (i === index ? { ...resolved, _included: p._included, _resolving: false } : p)));
    try {
      const st = await omgBuildStock([resolved], omgVendList, index);
      const key = resolved.product_id || ('omgtmp:' + index);
      const hit = st.get(key);
      if (hit) setOmgStock((prevStock) => { const m = new Map(prevStock || []); m.set(key, hit); return m; });
    } catch { /* keep old stock display */ }
  }, [omgItems, omgVendList, omgMomentecDiscount, _omgResolveOne, omgBuildStock]);

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
    // Templates are reusable starting points, never live stores: launching one would put
    // it in the public team-stores directory and make it purchasable.
    if (store.is_template && status === 'open') { flash("Templates can't be launched — use Start Store on the Templates tab to spin up a real store from it"); return; }
    const patch = { status, updated_at: new Date().toISOString() };
    // Manual close: stamp close_at with the actual close moment (when unset or still in
    // the future) so the record reflects when the store really stopped selling.
    if (status === 'closed' && (!store.close_at || new Date(store.close_at) > new Date())) patch.close_at = new Date().toISOString();
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

  // Change close date/time from the list row dropdown, without opening the full store
  // editor. The date+time are PT wall clock (see lib/storeClock) — writing the bare
  // picker date used to land on midnight UTC, closing the store 5 PM the day before.
  // Extending an already-closed store into the future reopens it (and clears the sweep's
  // idempotency stamp so the next close still notifies the rep/CSR).
  const changeCloseDate = useCallback(async (store, newDate, newTime = DEFAULT_CLOSE_TIME) => {
    const closeIso = ptToIso(newDate, newTime);
    if (newDate && !closeIso) { flash('That close date is not valid'); return; }
    const patch = { close_at: closeIso, updated_at: new Date().toISOString() };
    if (store.status === 'closed' && (!closeIso || new Date(closeIso) > new Date())) {
      if (!window.confirm(`"${store.name}" is closed. ${newDate ? 'Setting a future close date' : 'Removing the close date'} will reopen it and start taking orders again. Continue?`)) return;
      patch.status = 'open';
      patch.closed_notified_at = null;
    }
    const { data, error } = await supabase.from('webstores').update(patch).eq('id', store.id).select().single();
    if (error) { flash('Could not update close date: ' + error.message); return; }
    setStores((prev) => prev.map((s) => (s.id === store.id ? data : s)));
    if (sel?.id === store.id) setSel(data);
    flash(closeIso ? `Closes ${ptDateLabel(closeIso)} at ${ptTimeLabel(closeIso)} PT` : 'Close date cleared — store stays open');
  }, [sel, flash]);

  const duplicateStore = useCallback(async (src, opts = {}) => {
    if (!opts.asTemplate && !opts.startFromTemplate && !window.confirm(`Duplicate "${src.name}"? This copies the catalog, packages and transfer setup into a new draft store (no orders).`)) return null;
    const cloneName = opts.name != null ? opts.name : src.name + (opts.suffix != null ? opts.suffix : ' (Copy)');
    // Unique slug: <base>-copy (or -template), then -2, -3…
    const taken = new Set(stores.map((s) => s.slug));
    let slug = slugify(cloneName) + (opts.asTemplate ? '-template' : '-copy');
    if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
    const { id, created_at, updated_at, ...rest } = src;
    // A template is a separate is_template store carrying the ITEMS and packages only —
    // brand-free by definition (no logo, banner, art, mockups, decorations or transfer
    // codes from the source team). is_template makes it show in the Templates tab and
    // stay available to the coach store builder's item pool.
    // Clone hygiene — never carry from the source:
    //   featured_product_ids: webstore_product ids of the SOURCE store; they resolve to
    //     nothing in the clone, which hides the hero collage instead of the auto default.
    //   closed_notified_at: the close-sweep idempotency stamp; carrying it means the new
    //     store's close never creates the rep to-do/breakdown email.
    //   coach_contact_email (rebrand/template paths): the SOURCE team's coach; launch
    //     would prefill and email the wrong person.
    // Template philosophy: ONLY the items (and their categories/pricing/kit setup) come
    // over — every trace of the source team's branding strips, and the new team's colors
    // and logos are applied fresh. So template paths also drop the banner, hero blurb and
    // the curated store_art library (the source team's logos).
    const tplPath = opts.asTemplate || opts.startFromTemplate;
    const payload = { ...rest, name: cloneName, slug, status: 'draft', open_at: null, close_at: null, is_template: !!opts.asTemplate, featured_product_ids: null, closed_notified_at: null, ...((opts.rebrand || opts.asTemplate) ? { logo_url: null, coach_contact_email: null } : {}), ...(tplPath ? { banner_url: null, hero_blurb: null, store_art: [] } : {}) };
    flash(opts.asTemplate ? 'Saving template…' : opts.startFromTemplate ? 'Creating store from template…' : 'Duplicating store…');
    const { data: store, error } = await supabase.from('webstores').insert(payload).select().single();
    if (error) { flash('Could not duplicate: ' + error.message); return null; }

    // opts.itemIds limits the copy to those catalog rows (Save as template's picks, or
    // start-from-template's verbatim set); absent = whole catalog. Filter in the query —
    // no point pulling 200 rows to keep 5. An empty list means "copy no catalog".
    let srcProducts = [];
    if (!opts.itemIds || opts.itemIds.length) {
      let q = supabase.from('webstore_products').select('*').eq('store_id', src.id).order('sort_order');
      if (opts.itemIds) q = q.in('id', opts.itemIds);
      srcProducts = (await q).data || [];
    }
    const idMap = {}; // old webstore_product id -> new id
    for (const p of (srcProducts || [])) {
      const { id: pid, created_at: pc, updated_at: pu, store_id, ...prest } = p;
      // Template paths carry the ITEM, not the source team's branding: custom mockups
      // (which show the old team's logo on the garment), art placements and transfer
      // links strip; the new team decorates fresh. Plain Duplicate keeps everything.
      const row = tplPath ? { ...prest, image_url: null, image_back_url: null, decorations: [], transfer_codes: [], num_transfer_sets: [] } : prest;
      const { data: np, error: pe } = await supabase.from('webstore_products').insert({ ...row, store_id: store.id }).select('id').single();
      if (pe) { flash('Catalog copy failed: ' + pe.message); break; }
      idMap[pid] = np.id;
    }
    const bundleIds = (srcProducts || []).filter((p) => p.kind === 'bundle').map((p) => p.id);
    if (bundleIds.length) {
      const { data: items } = await supabase.from('webstore_bundle_items').select('*').in('bundle_id', bundleIds);
      // Remap the component's webstore_product_id link too — carrying the SOURCE store's
      // row id makes the package show (and the storefront fetch) another store's item.
      // Null when the linked single wasn't copied: components then resolve by product_id.
      const rows = (items || []).map((it) => { const { id: iid, created_at: ic, updated_at: iu, bundle_id, webstore_product_id, ...irest } = it; return { ...irest, bundle_id: idMap[bundle_id], webstore_product_id: idMap[webstore_product_id] || null, ...(tplPath ? { decoration_id: null } : {}) }; }).filter((r) => r.bundle_id);
      if (rows.length) { const { error: be } = await supabase.from('webstore_bundle_items').insert(rows); if (be) flash('Package items copy failed: ' + be.message); }
    }
    // Transfer setup (heat-press codes: the team's names/numbers/logos) is source-team
    // branding — it copies on plain Duplicate / Clone & Rebrand but never on template
    // paths, where the new team's transfers get set up fresh.
    if (!tplPath) {
      const { data: srcTransfers } = await supabase.from('webstore_transfers').select('*').eq('store_id', src.id);
      if ((srcTransfers || []).length) {
        const trows = srcTransfers.map((t) => { const { id: tid, created_at: tc, updated_at: tu, store_id, ...trest } = t; return { ...trest, store_id: store.id, on_hand: 0, incoming: 0, incoming_eta: null }; });
        const { error: te } = await supabase.from('webstore_transfers').insert(trows);
        if (te) flash('Transfer setup copy failed: ' + te.message);
      }
    }
    setStores((prev) => [store, ...prev]);
    flash(opts.asTemplate ? 'Saved as a template — find it in the Templates tab' : (opts.suffix === '' ? 'New store created from template (draft)' : 'Store duplicated as a draft'));
    // "Clone & rebrand" lands you straight in settings to set the new customer/colors/logo.
    // Templates skip that; start-from-template goes to the color picker instead.
    if (opts.rebrand && !opts.asTemplate && !opts.startFromTemplate) setEditing(store);
    return store;
  }, [stores, flash]);

  // "Save as template": clone the store into a SEPARATE, reusable template (its own name,
  // catalog only, no logo). The source store is left untouched and stays in the store list;
  // the template appears in the Templates tab and the coach store builder's item pool.
  const saveAsTemplate = useCallback((store) => setTemplateFor(store), []);
  // Confirmed from the modal: clone the store into a template carrying only the picked items.
  const confirmSaveAsTemplate = useCallback(async (name, itemIds) => {
    if (templateFor) await duplicateStore(templateFor, { asTemplate: true, name, itemIds });
    setTemplateFor(null);
  }, [templateFor, duplicateStore]);

  // Remove a template: un-flags it (is_template=false) so it's no longer a template and
  // returns to the normal store list as a draft. Non-destructive — never deletes a store.
  const toggleTemplate = useCallback(async (store) => {
    const next = !store.is_template;
    const { error } = await supabase.from('webstores').update({ is_template: next, updated_at: new Date().toISOString() }).eq('id', store.id);
    if (error) { flash('Error: ' + error.message); return; }
    setStores((prev) => prev.map((s) => s.id === store.id ? { ...s, is_template: next } : s));
    flash(next ? 'Saved as a template' : 'Removed from templates — it\'s back in the store list');
  }, [flash]);

  // Pull a batch's transfers: deduct physical on-hand by the counts used and
  // flag the batch's orders as pulled (they move from On order → In process).
  // soId accepts a single so_id (team-store single-batch pull, unchanged) OR an
  // array of so_ids (club stores' Group Pull — every converted-but-unpulled order
  // pulled in one action, each order individually converted to its own SO).
  //
  // Primary path (00206, Team Shop backend hardening #5): pull_webstore_transfers
  // does the decrement + stamp in ONE transaction, server-side, against the
  // LIVE on_hand row — no client read-then-write race between two staff
  // sessions (or a double-click) pulling overlapping batches. computePullPlan
  // still runs for soIds (needed either way) and `decrements` — kept ONLY as
  // the fallback write plan below, not sent to the RPC (the RPC re-derives the
  // decrement from p_needs against the current row itself).
  const pullBatchTransfers = useCallback(async (soId, neededByCode) => {
    const { soIds, decrements } = computePullPlan(soId, neededByCode, detail?.transfers || []);
    if (!soIds.length) return;
    const needs = Object.entries(neededByCode || {})
      .filter(([, qty]) => Number(qty) > 0)
      .map(([code, qty]) => ({ code, qty: Math.round(Number(qty)) }));
    const rpc = await supabase.rpc('pull_webstore_transfers', { p_store_id: sel.id, p_so_ids: soIds, p_needs: needs });
    if (rpc.error) {
      const msg = (rpc.error.message || '') + ' ' + (rpc.error.details || '') + ' ' + (rpc.error.hint || '');
      const migrationNotApplied = rpc.error.code === '42883' || rpc.error.code === '42P01' || /does not exist|could not find|schema cache/i.test(msg);
      if (!migrationNotApplied) { flash('Pull failed: ' + rpc.error.message); return; }
      // Fallback ONLY for "migration not applied yet" — any other RPC error
      // (bad input, forbidden, …) is a real failure and must surface, not
      // silently degrade to the racy client loop this migration replaces.
      console.warn('[pullBatchTransfers] pull_webstore_transfers RPC not found (00206 not applied yet) — falling back to the legacy client read-then-write loop:', rpc.error.message);
      for (const d of decrements) {
        await supabase.from('webstore_transfers').update({ on_hand: d.on_hand }).eq('id', d.id);
      }
      const { error } = await supabase.from('webstore_orders').update({ transfers_pulled: true, transfers_pulled_at: new Date().toISOString() }).eq('store_id', sel.id).in('so_id', soIds);
      if (error) { flash('Pull failed: ' + error.message); return; }
    }
    // Surface the RPC's structured result (00215): an already-pulled no-op and,
    // critically, any transfer SHORTFALL — an oversell used to be clamped to 0 and
    // silently swallowed, so production hit the press short with no warning.
    const res = rpc.data || {};
    if (res.already_pulled) { flash('Already pulled — no changes made'); loadDetail(sel); return; }
    const short = Array.isArray(res.shortfalls) ? res.shortfalls : [];
    if (short.length) {
      flash('⚠ Transfers pulled, but SHORT on: '
        + short.map((s) => `${s.code} (need ${s.needed}, had ${s.on_hand})`).join(', ')
        + ' — check transfer inventory before pressing');
    } else {
      flash('Transfers pulled — moved to In process');
    }
    loadDetail(sel);
  }, [detail, sel, flash, loadDetail]);

  const addSingle = useCallback(async ({ product, price, fundraise, image_url, takes_number, takes_name, name_upcharge, transfer_codes, num_transfer_sets, decorations, category, kit_name, required, options }) => {
    // Seed the global default add-on options (Store defaults) when none were set on the item.
    const opts = (Array.isArray(options) && options.length) ? options : (Array.isArray(wsSettings?.default_options) ? wsSettings.default_options : []);
    // Auto-group: if this store already carries the same style/family, attach this color to
    // that existing card (shared variant_group_id) instead of dropping in a separate row — so
    // adding colors one at a time (or via the AI builder / picker fallback, which add one
    // product at a time) still lands as a single item with a color picker. styleKey() strips
    // the trailing color token, so SanMar (same style name) and adidas "… ROYBLU/WHITE"
    // siblings both match. The explicit "copy to a new item" action uses copyToNewItem, so it
    // is unaffected and can still force a separate card.
    const _cat = detail?.catalog || [];
    const _stock = detail?.stockByWp || {};
    const _styleOf = (nm) => styleKey(String(nm || ''));
    const _newKey = _styleOf(product.name || product.sku);
    const _twin = _newKey ? _cat
      .filter((c) => c.kind !== 'bundle' && c.product_id !== product.id && _styleOf(_stock[c.id]?.name || c.display_name || c.sku) === _newKey)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] : null;
    const _groupId = _twin ? (_twin.variant_group_id || _twin.id) : null;
    const row = { store_id: sel.id, kind: 'single', product_id: product.id, sku: product.sku, retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, image_url: image_url || null, takes_number: !!takes_number, takes_name: !!takes_name, name_upcharge: Number(name_upcharge) || 0, transfer_codes: transfer_codes || [], num_transfer_sets: takes_number ? (num_transfer_sets || []) : [], decorations: decorations || [], category: category || null, kit_name: kit_name || null, required: !!required, options: opts, active: true, sort_order: (detail?.catalog?.length || 0), ...(_groupId ? { variant_group_id: _groupId } : {}) };
    const { error } = await supabase.from('webstore_products').insert(row);
    if (error) { flash('Error: ' + error.message); return; }
    // Promote a previously-standalone twin so both rows share its id as the group key.
    if (_twin && !_twin.variant_group_id) await supabase.from('webstore_products').update({ variant_group_id: _twin.id }).eq('id', _twin.id);
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

  // Bulk add from the product picker, with colorways of the same STYLE (same product
  // name — adidas colors carry different SKUs but share the name) folded into ONE card
  // via a shared variant_group_id, like the template flows — instead of one card per color.
  const addManyGrouped = useCallback(async (prods, decorations, cfg = {}) => {
    const list = (prods || []).filter((p) => p && p.id);
    if (!list.length) return;
    const hasPrice = cfg.price !== undefined && cfg.price !== '' && cfg.price !== null;
    const opts = (Array.isArray(cfg.options) && cfg.options.length) ? cfg.options : (Array.isArray(wsSettings?.default_options) ? wsSettings.default_options : []);
    let base = (detail?.catalog?.length || 0);
    // No explicit price from the rep → each product defaults to its ~45%-margin price
    // (deco $5 when artwork is attached or this is a team store — same rule as the editor),
    // falling back to the vendor list price when its cost is unknown.
    const _hasRealDeco = (decorations || []).some((d) => d && d.kind !== 'perso_number' && d.kind !== 'perso_name');
    const _decoEst = (_hasRealDeco || (sel?.org_type || 'team') !== 'club') ? 5 : 0;
    // Per-style price overrides from the add-items review table ({styleKey: price}); keyed
    // exactly like the grouping below, so an override prices the whole card (all its colors).
    const _itemPrices = cfg.itemPrices || {};
    const _priceOf = (p) => {
      const ov = _itemPrices[String(p.name || p.sku || p.id).trim().toLowerCase()];
      if (ov !== undefined && ov !== '' && Number(ov) > 0) return Number(ov);
      return hasPrice ? (Number(cfg.price) || 0) : (price45(p.nsa_cost, _decoEst) ?? (Number(p.retail_price) || 0));
    };
    const mk = (p, groupId) => ({ store_id: sel.id, kind: 'single', product_id: p.id, sku: p.sku,
      retail_price: _priceOf(p),
      fundraise_amount: Number(cfg.fundraise) || 0, image_url: null,
      takes_number: !!cfg.takes_number, takes_name: !!cfg.takes_name, name_upcharge: Number(cfg.name_upcharge) || 0,
      transfer_codes: [], num_transfer_sets: [], decorations: decorations || [],
      category: cfg.category || null, kit_name: cfg.kit_name || null, required: !!cfg.required,
      options: opts, active: true, sort_order: base++, ...(groupId ? { variant_group_id: groupId } : {}) });
    const groups = new Map();
    for (const p of list) { const k = String(p.name || p.sku || p.id).trim().toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    // Fold into the card this store ALREADY carries for the same style, the way addSingle
    // does. Grouping used to be batch-local, so a style whose colors arrived in two trips
    // through the picker (or one color at a time) left the later ones as their own cards
    // and the storefront listed one garment three times — while the art tab, which groups
    // by name, showed it once. Keyed by styleKey() so adidas "… ROYBLU/WHITE" siblings
    // match too; the explicit "copy to a new item" action still forces a separate card.
    const _cat = detail?.catalog || [];
    const _stock = detail?.stockByWp || {};
    const _styleOf = (nm) => styleKey(String(nm || '')).trim().toUpperCase();
    const _twinByStyle = new Map();  // styleKey -> the store's lowest-sorted row for that style
    for (const c of _cat) {
      if (c.kind === 'bundle') continue;
      const k = _styleOf(_stock[c.id]?.name || c.display_name || c.sku);
      if (!k) continue;
      const cur = _twinByStyle.get(k);
      if (!cur || (c.sort_order || 0) < (cur.sort_order || 0)) _twinByStyle.set(k, c);
    }
    const _groupByStyle = new Map(); // styleKey -> group id resolved during this run
    const _soloByStyle = new Map();  // styleKey -> row inserted this run that is still standalone
    let added = 0, cards = 0;
    for (const cols of groups.values()) {
      const _sk = _styleOf(cols[0].name || cols[0].sku);
      let groupId = _sk ? _groupByStyle.get(_sk) || null : null;
      if (!groupId && _sk) {
        const twin = _twinByStyle.get(_sk);
        // Promote a previously-standalone twin so both rows share its id as the group key.
        if (twin) { groupId = twin.variant_group_id || twin.id; if (!twin.variant_group_id) await supabase.from('webstore_products').update({ variant_group_id: twin.id }).eq('id', twin.id); }
      }
      if (groupId) {
        const solo = _soloByStyle.get(_sk);
        const [rA, rB] = await Promise.all([
          solo ? supabase.from('webstore_products').update({ variant_group_id: groupId }).eq('id', solo) : Promise.resolve({}),
          supabase.from('webstore_products').insert(cols.map((p) => mk(p, groupId))),
        ]);
        const bad = rA.error || rB.error;
        if (bad) { flash('Error: ' + bad.message); continue; }
        _soloByStyle.delete(_sk);
        added += cols.length;
        continue;
      }
      // First card for this style — create it, then remember it so another batch group of
      // the same style (adidas bake the color into the name) folds in instead of starting a
      // second card.
      const [primary, ...rest] = cols;
      const { data: pr, error: e1 } = await supabase.from('webstore_products').insert(mk(primary, null)).select('id').single();
      if (e1 || !pr) { flash('Error: ' + (e1?.message || 'insert failed')); continue; }
      added += 1; cards += 1;
      if (_sk) { _groupByStyle.set(_sk, pr.id); _soloByStyle.set(_sk, pr.id); }
      if (rest.length) {
        const [r1, r2] = await Promise.all([
          supabase.from('webstore_products').update({ variant_group_id: pr.id }).eq('id', pr.id),
          supabase.from('webstore_products').insert(rest.map((p) => mk(p, pr.id))),
        ]);
        const bad = r1.error || r2.error;
        if (bad) { flash('Error: ' + bad.message); continue; }
        _soloByStyle.delete(_sk);
        added += rest.length;
      }
    }
    if (added) { flash(`Added ${added} item${added === 1 ? '' : 's'} (${cards} new card${cards === 1 ? '' : 's'})`); loadDetail(sel); }
  }, [sel, detail, wsSettings, flash, loadDetail]);

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
  // Start a new store from a STORE template ("Start Store" on a Templates-tab card).
  // Clones the template's store settings and packages (brand-free — templates carry
  // items only), then opens SETTINGS FIRST — the rep sets the real name, customer and
  // colors (the clone still carries the template's) — and on save the color picker
  // opens for the template's pickable items, so palette matching uses the NEW team's
  // colors. The new team's logos/art get applied fresh on the Art & Logos tab.
  // Pickable = active, SKU'd singles (the picker resolves by SKU and inserts as live).
  // Everything else — packages, custom/no-SKU items, archived rows — copies verbatim
  // with all its fields, so nothing is dropped and archived items stay archived.
  const startStoreFromStoreTemplate = useCallback(async (t) => {
    const { data: rows } = await supabase.from('webstore_products').select('id,kind,sku,retail_price,fundraise_amount,category,kit_name,required,active').eq('store_id', t.id).order('sort_order');
    const all = rows || [];
    const pickable = (r) => r.kind === 'single' && r.sku && r.active !== false;
    const store = await duplicateStore(t, { suffix: '', rebrand: true, startFromTemplate: true, itemIds: all.filter((r) => !pickable(r)).map((r) => r.id) });
    if (!store) return;
    const singles = all.filter(pickable);
    if (singles.length) setTplAfterEdit({ storeId: store.id, tpl: { name: t.name, items: singles.map(wpRowToTplItem) } });
    setEditing(store);
  }, [duplicateStore]);
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
  // Returns true only when the write actually landed, so the caller can keep its
  // "last saved" baseline honest and put the field back if the DB refused.
  const updateProductMeta = useCallback(async (productId, fields) => {
    if (!productId || !fields) return false;
    const clean = {};
    if (fields.vendor_id !== undefined) clean.vendor_id = fields.vendor_id || null;
    if (fields.sku !== undefined) clean.sku = (fields.sku || '').trim().toUpperCase() || null;
    if (!Object.keys(clean).length) return false;
    // .select() so a silent 0-row update (RLS blocked this login, or the product row
    // is gone) is caught. Without it PostgREST returns no error and no rows, and the
    // editor flashed "Product updated" over a change that never reached the database.
    const { data: _hit, error } = await supabase.from('products').update(clean).eq('id', productId).select('id');
    if (error) {
      // products.sku carries a UNIQUE index — the raw Postgres text is unreadable.
      flash(/duplicate|unique/i.test(error.message || '') && clean.sku
        ? `SKU ${clean.sku} is already used by another product — pick a different one.`
        : 'Error: ' + error.message);
      return false;
    }
    if (!_hit || _hit.length === 0) { flash('Not saved — your login doesn’t have edit access. Ask an admin to add you as a team member.'); return false; }
    if (fields.sku !== undefined && clean.sku) await supabase.from('webstore_products').update({ sku: clean.sku }).eq('product_id', productId);
    flash('Product updated'); loadDetail(sel);
    return true;
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

  // Create ONE multi-file art FOLDER on the customer (and this store's set): several web
  // PNG/SVG cutouts — the logo's color ways — plus production files (.ai/.eps/.dst/.pdf).
  // Same record shape as the customer art library (files / prod_files / color_ways /
  // web_logos), so production later works from this folder instead of a loose single PNG.
  // webFiles/prodFiles are already-uploaded { url, name } lists; webFiles[1..] may carry
  // cwLabel (from the filenames) to name each color way — renameable on the art page later.
  const addStoreArtFolder = useCallback(async ({ name, webFiles = [], prodFiles = [], decoType, colorWays = [] }) => {
    if (!sel?.customer_id || (!webFiles.length && !prodFiles.length)) return null;
    const { data: cust } = await supabase.from('customers').select('art_files').eq('id', sel.customer_id).maybeSingle();
    const arr = Array.isArray(cust?.art_files) ? cust.art_files : [];
    const ts = Date.now();
    const dt = decoType || 'screen_print';
    // Color ways come from the modal's editor (garment color + ink/thread colors). Build the
    // list from there, then make sure EVERY labeled web cutout also has a color way — creating
    // one if the rep only named it on the logo row — so no cutout loses its color-way link.
    // A cutout matches a color way by garment-color name (case-insensitive); the first cutout
    // doubles as the "all garments" default entry. A single unlabeled PNG stays default-only.
    const _norm = (s) => String(s || '').trim().toLowerCase();
    const cwByName = new Map();
    const color_ways = [];
    (colorWays || []).forEach((cw, i) => {
      const gc = String(cw.garment_color || '').trim();
      const inks = Array.isArray(cw.inks) ? cw.inks.filter((x) => x && String(x).trim()) : [];
      if (!gc && !inks.length) return; // drop empty editor rows
      const rec = { id: cw.id || ('cw' + ts + '_e' + i), garment_color: gc, inks };
      color_ways.push(rec);
      if (gc) cwByName.set(_norm(gc), rec);
    });
    const cwForFile = webFiles.map((f, i) => {
      const label = String(f.cwLabel || '').trim();
      if (!label) return null;
      let cw = cwByName.get(_norm(label));
      if (!cw) { cw = { id: 'cw' + ts + '_' + i, garment_color: label, inks: [] }; color_ways.push(cw); cwByName.set(_norm(label), cw); }
      return cw;
    });
    const web_logos = webFiles.length ? normalizeWebLogos([
      { url: webFiles[0].url, color_way: '', is_default: true },
      ...webFiles.map((f, i) => (cwForFile[i] ? { url: f.url, color_way: cwForFile[i].garment_color, color_way_id: cwForFile[i].id } : null)).filter(Boolean),
    ], color_ways) : [];
    const base = {
      id: 'logo' + ts + Math.random().toString(36).slice(2, 6), name: name || 'Store logo',
      files: (webFiles.length ? webFiles : prodFiles).map((f) => ({ url: f.url, name: f.name })),
      prod_files: prodFiles.map((f) => ({ url: f.url, name: f.name })),
      status: 'approved', deco_type: dt, uploaded: new Date().toLocaleDateString(), color_ways,
    };
    // No web cutout at all (production files only) → source-only record, so the Art tab
    // asks for a placeable PNG/SVG instead of stamping a raw .ai url onto a garment.
    const rec = webFiles.length
      ? { ...base, preview_url: webFiles[0].url, web_logo_url: webFiles[0].url, web_logos, kind: 'logo' }
      : { ...base, kind: 'art' };
    const { error } = await supabase.from('customers').update({ art_files: [...arr, rec] }).eq('id', sel.customer_id);
    if (error) { flash('Could not save art folder: ' + error.message); return null; }
    const curArt = Array.isArray(sel.store_art) ? sel.store_art : [];
    const { data: st } = await supabase.from('webstores').update({ store_art: [...curArt, { ...rec, _srcLabel: 'Uploaded' }] }).eq('id', sel.id).select().single();
    if (st) { setStores((prev) => prev.map((s) => (s.id === sel.id ? st : s))); setSel(st); }
    const parts = [webFiles.length ? `${webFiles.length} web logo${webFiles.length === 1 ? '' : 's'}` : null, prodFiles.length ? `${prodFiles.length} production file${prodFiles.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' + ');
    flash('Art folder added (' + parts + ')'); loadDetail(sel);
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

  // Edit an order's line items (size/qty/remove) transactionally. The RPC keeps
  // removed rows as qty=0/cancelled, records the before/after audit, and returns
  // any cancelled units still waiting to be tied to a refund.
  const saveOrderEdits = useCallback(async (order, edited) => {
    const edits = (edited || []).map((it) => ({
      id: it.id,
      size: it.size || null,
      qty: Math.max(1, Number(it.qty) || 1),
      removed: !!it._removed,
    }));
    const { data, error } = await supabase.rpc('apply_webstore_order_item_edits', {
      p_order_id: order.id,
      p_edits: edits,
    });
    if (error || !data || data.ok === false) {
      const msg = (error && error.message) || (data && data.error) || 'unknown error';
      flash('Save failed: ' + msg);
      return { error: msg };
    }
    flash('Order updated');
    await loadDetail(sel);
    return { ok: true, ...data };
  }, [sel, flash, loadDetail]);

  // Refund: Stripe for card orders, recorded credit for team-tab orders.
  // Guarded against double-processing: an in-flight latch blocks double-clicks, and the
  // already-refunded amount is re-read from the DB (not trusted from possibly-stale React
  // state) with an over-refund cap before any money moves.
  const refundingRef = useRef(false);
  const refundOrder = useCallback(async (order, amount, customerMessage, itemAllocations = []) => {
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
          body: JSON.stringify({ action: 'refund_webstore_order', webstore_order_id: order.id, amount_cents: cents, attempt_id: attemptId, customer_message: (customerMessage || '').trim() || null, item_allocations: itemAllocations }),
        });
        d = await res.json();
      } catch (e) { flash('Refund failed: ' + e.message); return { error: e.message }; }
      if (!d || d.error) { flash('Refund failed: ' + ((d && d.error) || 'unknown error')); return { error: (d && d.error) || 'refund_failed' }; }
      // The refund notice fires automatically server-side. Say plainly whether it
      // actually went — a refund the buyer was never told about looks identical to a
      // clean one otherwise, and the rep is the only person who can follow up.
      const _who = order.buyer_email ? ` — emailed ${order.buyer_email}` : '';
      flash(d.kind === 'card' ? `Refunded ${money(cents / 100)} to card${d.notified ? _who : ''}` : `Recorded ${money(cents / 100)} credit${d.notified ? _who : ''}`);
      if (!d.notified) flash(`⚠️ Refund went through, but the confirmation email did NOT send${d.notify_error ? ' (' + d.notify_error + ')' : ''} — contact the customer yourself.`);
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
    // !backorder_of: bagging's child orders re-produce nothing — their goods
    // arrive via receiving; batching one would produce the shorted qty twice.
    const open = (detail?.orders || []).filter((o) => !o.so_id && !o.backorder_of && isLiveWebstoreOrder(o));
    const openIds = new Set(open.map((o) => o.id));
    const orderById = {}; open.forEach((o) => { orderById[o.id] = o; });
    const skuMap = sizeSkuMapOf(detail?.catalog);
    const lines = annotateEffSkus(activeWebstoreLines((detail?.orderItems || []).filter((i) => openIds.has(i.order_id)), orderById), skuMap);
    const stockByPid = {};
    (detail?.catalog || []).forEach((c) => { const _s = detail.invSrcByPid?.[c.product_id]; if (c.product_id && detail.stockByWp?.[c.id] && _s && _s !== 'manual') stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    const stockBySku = await fetchOverrideSkuStock(lines);
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
    const valid = (detail?.orders || []).filter(isLiveWebstoreOrder);
    const ids = new Set(valid.map((o) => o.id));
    const orderById = {}; valid.forEach((o) => { orderById[o.id] = o; });
    const skuMap = sizeSkuMapOf(detail?.catalog);
    const sourceLines = annotateEffSkus(activeWebstoreLines((detail?.orderItems || []).filter((i) => ids.has(i.order_id)), orderById), skuMap);
    const soIds = [...new Set(valid.map((o) => o.so_id).filter(Boolean))];
    const soItemsBySo = {};
    const soMetaBySo = {};
    soIds.forEach((id) => { soItemsBySo[id] = []; });
    for (let i = 0; i < soIds.length; i += 100) {
      const { data, error } = await supabase.from('so_items').select('so_id,sku,name,custom_desc,product_id,color,sizes').in('so_id', soIds.slice(i, i + 100));
      if (error) throw new Error('Could not reconcile Sales Order items: ' + error.message);
      (data || []).forEach((it) => { (soItemsBySo[it.so_id] = soItemsBySo[it.so_id] || []).push(it); });
    }
    for (let i = 0; i < soIds.length; i += 100) {
      const { data, error } = await supabase.from('sales_orders').select('id,webstore_id').in('id', soIds.slice(i, i + 100));
      if (error) throw new Error('Could not validate Sales Order links: ' + error.message);
      (data || []).forEach((so) => { soMetaBySo[so.id] = so; });
    }
    let { lines, audit } = resolveWebstoreReportLines({ orders: valid, lines: sourceLines, soItemsBySo, soMetaBySo });
    const stockByPid = {};
    (detail?.catalog || []).forEach((c) => { const _s = detail.invSrcByPid?.[c.product_id]; if (c.product_id && detail.stockByWp?.[c.id] && _s && _s !== 'manual') stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    // Replacement lines may not exist in this store's original catalog. Hydrate
    // their current master-product image/name by the SO SKU, never by the stale
    // checkout product id.
    const reportSkus = [...new Set(lines.filter((l) => l._wasSku && l._effSku).map((l) => l._effSku))];
    const productBySku = {};
    for (let i = 0; i < reportSkus.length; i += 100) {
      const { data } = await supabase.from('products').select('id,sku,name,color,image_front_url').in('sku', reportSkus.slice(i, i + 100));
      (data || []).forEach((p) => { if (p.sku && !productBySku[p.sku]) productBySku[p.sku] = p; });
    }
    lines = lines.map((l) => { const p = productBySku[l._effSku]; return p ? { ...l, product_id: l.product_id || p.id, name: l.name || p.name, color: l.color || p.color, _reportImage: p.image_front_url || '' } : l; });
    lines = await attachAdidasTagSkus(supabase, lines);
    const stockBySku = await fetchSkuStock(lines.filter((l) => l._effSku && (l._wasSku || !l.product_id || !stockByPid[l.product_id])).map((l) => l._effSku));
    return { valid, lines, audit, stockByPid, stockBySku, orderById, roster: detail?.roster || [] };
  }, [detail]);

  // Per-player roll-up (printable): every player and exactly what they ordered.
  const playerReport = useCallback(async () => {
    if (!sel || !detail) return;
    const { valid, lines, audit, orderById, roster, stockByPid } = await gatherAll();
    if (!valid.length) { flash('No orders yet'); return; }
    buildPlayerReport(sel, lines, orderById, roster, stockByPid, audit);
  }, [sel, detail, gatherAll, flash]);

  // Store-close stock report (printable): fill-from-stock vs order-from-Adidas
  // vs backorder, split by vendor.
  const stockReport = useCallback(async () => {
    if (!sel || !detail) return;
    const { valid, lines, stockByPid, stockBySku } = await gatherAll();
    if (!valid.length) { flash('No orders yet'); return; }
    buildStockReport(sel, `${valid.length} order${valid.length === 1 ? '' : 's'}`, lines, stockByPid, madeToOrderPids(detail.catalog), stockBySku);
  }, [sel, detail, gatherAll, flash]);

  // Silver Screen domestic fulfillment workbook. It uses the same active-order +
  // current-SO reconciliation as every other report, then refuses to download if
  // any required destination/product field is missing or still needs verification.
  const productReport = useCallback(async () => {
    if (!sel || !detail) return;
    const { valid, lines, audit, orderById } = await gatherAll();
    if (!valid.length) { flash('No orders yet'); return; }
    try {
      const result = downloadSilverScreenFulfillment({ store: sel, lines, orderById, customer: cust.find((c) => c.id === sel.customer_id) || null, audit });
      flash(`Downloaded ${result.unitCount} Silver Screen fulfillment unit${result.unitCount === 1 ? '' : 's'}`);
    } catch (e) { flash(e?.message || 'Silver Screen fulfillment export failed', 'error'); }
  }, [sel, detail, gatherAll, flash, cust]);

  // CSV exports: 'players' (per-player line items), 'stock' (shortage split),
  // 'orders' (every line item with order + payment detail).
  const exportCsv = useCallback(async (kind) => {
    if (!sel || !detail) return;
    const { lines, orderById, stockByPid, stockBySku } = await gatherAll();
    if (!lines.length) { flash('No orders yet'); return; }
    const slug = (sel.slug || sel.name || 'store').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
    if (kind === 'players') {
      const header = ['Order #', 'Player', 'Number', 'Item', 'SKU', 'Adidas Tag SKU', 'Size', 'Qty', 'Buyer', 'Buyer Email', 'Order Date'];
      // Sort by order number (every line of an order contiguous, oldest order first) —
      // same rule the Orders CSV got in #1991; without it the fetch order is arbitrary.
      const sorted = [...lines].sort((a, b) => {
        const oa = orderById[a.order_id] || {}, ob = orderById[b.order_id] || {};
        return ((Number(oa.order_number) || 0) - (Number(ob.order_number) || 0))
          || (new Date(oa.created_at || 0) - new Date(ob.created_at || 0))
          || String(oa.id || '').localeCompare(String(ob.id || ''))
          || String(a.player_name || '').localeCompare(String(b.player_name || ''))
          || _itemName(a, stockByPid).localeCompare(_itemName(b, stockByPid));
      });
      const rows = sorted.map((i) => { const o = orderById[i.order_id] || {}; return [o.order_number != null ? String(o.order_number) : '', i.player_name || '', i.player_number != null ? String(i.player_number) : '', _itemName(i, stockByPid), i._effSku || i.sku || '', i._adidasTagSku || '', i.size || '', i.qty || 1, o.buyer_name || '', o.buyer_email || '', _csvDate(o.created_at)]; });
      downloadCsv(`${slug}-players.csv`, header, rows);
    } else if (kind === 'stock') {
      const header = ['Item', 'SKU', 'Size', 'Need', 'Ours', 'Adidas', 'Fill from ours', 'PO from Adidas', 'Backorder', 'On order'];
      const rows = aggStock(lines, stockByPid, madeToOrderPids(detail.catalog), stockBySku)
        .sort((a, b) => (b.backorder - a.backorder) || (b.poVendor - a.poVendor) || a.name.localeCompare(b.name))
        .map((r) => [r.name, r.sku, r.size, r.need, (r.tracked || r.known) ? r.ours : '', (r.tracked || r.known) ? r.vendorAvail : '', r.fillOurs, r.poVendor, r.backorder, r.onOrder ? 'yes' : '']);
      downloadCsv(`${slug}-stock.csv`, header, rows);
    } else {
      const header = ['Order', 'Date', 'Status', 'Payment', 'Buyer', 'Email', 'Player', 'Number', 'Item', 'SKU', 'Size', 'Qty', 'Unit Price'];
      // Default sort: by order — oldest checkout first, every line of an order
      // contiguous (order ids are UUIDs, so the fetch order is arbitrary without
      // this), then player + item inside the order.
      const sorted = [...lines].sort((a, b) => {
        const oa = orderById[a.order_id] || {}, ob = orderById[b.order_id] || {};
        return (new Date(oa.created_at || 0) - new Date(ob.created_at || 0))
          || String(oa.id || '').localeCompare(String(ob.id || ''))
          || String(a.player_name || '').localeCompare(String(b.player_name || ''))
          || _itemName(a, stockByPid).localeCompare(_itemName(b, stockByPid))
          || String(a.size || '').localeCompare(String(b.size || ''));
      });
      const rows = sorted.map((i) => { const o = orderById[i.order_id] || {}; return [o.id || '', _csvDate(o.created_at), o.status || '', o.payment_mode || '', o.buyer_name || '', o.buyer_email || '', i.player_name || '', i.player_number != null ? String(i.player_number) : '', _itemName(i, stockByPid), i._effSku || i.sku || '', i.size || '', i.qty || 1, Number(i.unit_price) || 0]; });
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
    const { data: freshOrders, error: foErr } = await supabase.from('webstore_orders').select('*').eq('store_id', sel.id).is('so_id', null).is('backorder_of', null);
    if (foErr) { flash('Could not load orders: ' + foErr.message); return; }
    const open = (freshOrders || []).filter(isLiveWebstoreOrder);
    if (!open.length) { flash('No unbatched orders to send'); return; }
    const openIds = new Set(open.map((o) => o.id));
    const { rows: openItems, error: fiErr } = await fetchOrderItemRows(supabase, [...openIds]);
    if (fiErr) { flash('Could not load order items: ' + fiErr.message); return; }
    const openById = {}; open.forEach((o) => { openById[o.id] = o; });
    const lines = annotateEffSkus(activeWebstoreLines(openItems, openById), sizeSkuMapOf(detail.catalog));

    // Inventory check: compare demand for this batch against our warehouse +
    // Adidas vendor stock and surface any shortfalls before creating the SO.
    // Override-aware: a size mapped to a different SKU (size_skus) checks THAT
    // SKU's vendor stock, not the base product's — the SO will source it.
    const stockByPid = {};
    (detail.catalog || []).forEach((c) => { const _s = detail.invSrcByPid?.[c.product_id]; if (c.product_id && detail.stockByWp?.[c.id] && _s && _s !== 'manual') stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    // Override SKUs, plus lines the store stock map can't cover (no linked product,
    // or a linked product with no stock record): check those against the unified
    // vendor inventory by SKU — the same synced source manual order entry reads —
    // so API-carried items (S&S adidas, UA, …) get a real pre-batch stock check
    // instead of silently skipping it. Bare styles with no colorway ('AT105') have
    // no inventory row and stay unchecked, same as before.
    const stockBySku = {
      ...(await fetchSkuStock(lines.filter((i) => !i._skuOv && i.sku && !(i.product_id && stockByPid[i.product_id])).map((i) => i.sku))),
      ...(await fetchOverrideSkuStock(lines)),
    };
    // Items marked made-to-order (Inventory tracking → off) are decorated/custom and
    // produced to demand, so they're never a stock shortfall — same as products with
    // no stock record.
    const mto = madeToOrderPids(detail.catalog);
    // Shortfall check for whichever subset of orders is currently selected in the
    // modal (the rep can narrow the batch by cutoff date / checkboxes, and the
    // shortage list re-runs live against just those orders' demand).
    // Full availability picture for the modal — every line's demand vs. our warehouse
    // + vendor stock (same aggregation as the store-close stock report), not just the
    // shortfalls. The rep SEES what each item has before the SO exists.
    const stockRowsFor = (selIds) => aggStock(lines.filter((i) => selIds.has(i.order_id)), stockByPid, mto, stockBySku);
    const shortagesFor = (selIds) => {
      const demand = {};
      lines.forEach((i) => { if (!selIds.has(i.order_id)) return; if (!i.product_id && !(i.sku && stockBySku[i.sku])) return; const k = lineStockKey(i); (demand[k] = demand[k] || { line: i, q: 0 }).q += (i.qty || 1); });
      const shortages = [];
      Object.values(demand).forEach(({ line: i, q }) => {
        const pid = i.product_id, size = i.size || 'OS';
        const ls = lineStock(i, stockByPid, stockBySku, mto);
        if (!ls.tracked) return; // made-to-order / no stock record — never a shortfall
        // Stock we can actually source = ours + the vendor's on-hand + any delivery
        // whose date has already passed (arrivedVendorQty). Without that last term a
        // snapshot taken before a landed delivery reports a shortfall that isn't real.
        const avail = ls.ours + ls.vendor + ls.arrived;
        const nm = ls.name || (stockByPid[pid] && stockByPid[pid].name) || i._effSku || i.sku || pid;
        const who = `${nm}${i._skuOv ? ` (${i._effSku})` : ''}`;
        const sku = i._effSku || i.sku || '';
        if (q > avail) {
          shortages.push({ kind: 'short', pid, size, sku, syncedAt: ls.syncedAt, label: `${who} ${size}: need ${q}, have ${avail} (${ls.ours} ours + ${ls.vendor} vendor${ls.arrived ? ` + ${ls.arrived} delivered ${ls.arrivedEta}` : ''})${ls.onOrder ? ' — more on order' : ''}` });
        } else if (ls.arrived && q > ls.ours + ls.vendor) {
          // Covered only BECAUSE we credited a landed delivery — say so rather than
          // showing a silent all-clear on numbers we know are out of date.
          shortages.push({ kind: 'assumed', pid, size, sku, syncedAt: ls.syncedAt, label: `${who} ${size}: need ${q}, on hand 0 as of our last sync — the vendor had ${ls.arrived} due ${ls.arrivedEta}, which has passed, so it's counted as available.` });
        }
      });
      return shortages;
    };
    // Everything from here on runs once the user confirms in the modal below.
    // inlineOverrides: { "pid|size" -> altSku } — typed in the shortfall modal.
    // selIds: the order ids the rep left checked (defaults to every open order).
    // batchMeta: { label, cutoff } — the batch name + order-date cutoff for the SO.
    // Logos placed in the store builder live on webstore_products.decorations (the
    // LogoPlacer format: art_id/art_url/placement/side). They must carry forward as real
    // kind:'art' deco lines — one per location — so the Art Dashboard shows a mockup slot
    // per logo and production gets each logo's own art file. (Mirrors the OMG store→SO
    // mapping in App.js.) Keyed by product_id (fallback sku) to match byProduct.
    // Built here (not inside proceed) so the confirm modal can count logo units too.
    const decosByKey = {};
    (detail.catalog || []).forEach((c) => {
      const arr = Array.isArray(c.decorations) ? c.decorations.filter((d) => d && (d.art_url || d.art_id)) : [];
      if (!arr.length) return;
      // Register under both product_id and sku so an order line keyed by either resolves.
      [c.product_id, c.sku].filter(Boolean).forEach((k) => { (decosByKey[k] = decosByKey[k] || []).push(...arr); });
    });
    const artById = {};
    (detail.libraryArt || []).forEach((a) => { if (a && a.id) artById[a.id] = a; });
    // Decoration review for the confirm modal: one row per placed store logo with how
    // many garments in the current selection get it, so the rep confirms (or switches)
    // the method BEFORE the SO exists — a handful of units often moves screen print →
    // DTF (no screen burn), a big run the other way.
    const decoRowsFor = (selIds) => {
      const units = {}; const meta = {};
      lines.forEach((i) => {
        if (!selIds.has(i.order_id)) return;
        const seen = new Set();
        (decosByKey[i.product_id] || decosByKey[i.sku] || []).forEach((d) => {
          const k = d.art_id || d.art_url; if (!k || seen.has(k)) return; seen.add(k);
          units[k] = (units[k] || 0) + (i.qty || 1);
          if (!meta[k]) { const lib = d.art_id ? artById[d.art_id] : null; meta[k] = { key: k, name: (lib && lib.name) || 'Store logo', method: (lib && lib.deco_type) || 'screen_print', img: d.art_url || (lib && lib.web_logo_url) || '' }; }
        });
      });
      return Object.keys(units).map((k) => ({ ...meta[k], units: units[k] }));
    };
    // Items with no linked catalog product get one more chance BEFORE the SO exists:
    // pre-resolve their bare SKUs so the confirm modal can list anything the catalog
    // can't fully place (no match at all, or family-only — vendor known, colorway not)
    // with a catalog search. The rep links the right item there, or knowingly lets it
    // through as an unlinked line to fix on the SO.
    const _bareSkus = [...new Set(lines.filter((i) => !i.product_id && i.sku).map((i) => i.sku))];
    const preSkuInfo = await resolveSkuInfoBySku(_bareSkus);
    const unmatchedRowsFor = (selIds) => {
      const agg = {};
      lines.forEach((i) => {
        if (!selIds.has(i.order_id) || i.product_id || !i.sku) return;
        const inf = preSkuInfo[i.sku];
        if (inf && inf.id) return; // exact catalog match — resolves at batch, nothing to review
        const r = agg[i.sku] || (agg[i.sku] = { sku: i.sku, name: i.name || i.sku, units: 0, sizes: {}, partial: !!inf, partialName: inf ? inf.name : '' });
        r.units += i.qty || 1;
        const sz = i.size || 'OS';
        r.sizes[sz] = (r.sizes[sz] || 0) + (i.qty || 1);
      });
      return Object.values(agg).map((r) => ({ ...r, topSize: Object.entries(r.sizes).sort((a, b) => b[1] - a[1])[0][0] }));
    };
    // decoMethods: { artKey (art_id|art_url) -> deco method } — the modal's per-logo
    // method switches; applied to that logo's SO deco lines AND its art file.
    // skuLinks: { original bare sku -> catalog sku the rep picked in the modal } —
    // the line takes that SKU, so the resolution below adopts its catalog row.
    const proceed = async (inlineOverrides = {}, selIds = openIds, batchMeta = {}, decoMethods = {}, skuLinks = {}) => {
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
      const effectiveSku = inlineOverrides[(i.product_id || i.sku) + '|' + sz] || (!i.product_id && skuLinks[i.sku]) || (sizeSkusByCatPid[i.product_id] || {})[sz] || i.sku || '';
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
      const { data } = await supabase.from('products').select('id,sku,name,brand,color,vendor_id,nsa_cost,retail_price').in('id', pids);
      (data || []).forEach((p) => { pinfo[p.id] = p; });
    }
    // Store lines that never got linked to a catalog product (the builder let a bare
    // typed SKU like "AT105" through) arrive here with product_id null. Resolve them
    // against the server catalog the way manual order entry would (exact SKU, then
    // colorway family — see resolveSkuInfoBySku). Runs on the FINAL effective skus,
    // so a catalog item the rep linked in the confirm modal resolves here too.
    const skuInfo = await resolveSkuInfoBySku([...new Set(Object.values(byProduct).filter((g) => !g.product_id && g.sku).map((g) => g.sku))]);
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
    // Bundle/kit components don't carry placed web-logo decos — their logo is a
    // heat-transfer "design" code (webstore_bundle_items.transfer_code). Map each
    // component product to its transfer code(s) and resolve the design label, so
    // we can emit a logo deco for it on the SO (numbers/names already carry via
    // `personalize`). Keyed by product_id to match byProduct.
    const xferLabel = {};
    // Transfer cost-of-record (webstore_transfers.unit_cost, 00204): staff set it from
    // their bulk transfer buys; each batched application carries it as cost_each so GP/
    // commissions see real transfer cost (dP's art branch prefers cost_each on
    // transfer_code decos — previously these rows hit the generic DTF matrix cost).
    const xferCost = {};
    (detail.transfers || []).forEach((t) => { if (t && t.code) { xferLabel[t.code] = t.label || t.code; if (t.unit_cost != null && Number.isFinite(Number(t.unit_cost))) xferCost[t.code] = Number(t.unit_cost); } });
    const bundleXfersByPid = {};
    (detail.bundleItems || []).forEach((b) => {
      if (!b.product_id || !b.transfer_code) return;
      (bundleXfersByPid[b.product_id] = bundleXfersByPid[b.product_id] || new Set()).add(b.transfer_code);
    });
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
    // Store setting "decorated elsewhere" → every decoration lands on the SO already
    // flagged Outside: the whole store is produced off-site, names and numbers
    // included. fulfillment:'outside' is the unified switch (isDecoOutsourced) — it
    // suppresses the in-house job AND reads the cost from the Deco PO instead, so
    // the two can never disagree. The rep still picks the decorator on the Deco PO.
    const outsideDeco = (sel.decoration_mode || 'in_house') === 'outsourced';
    const routing = outsideDeco ? { fulfillment: 'outside' } : {};
    const soItems = Object.values(byProduct).map((g) => {
      const info = pinfo[g.product_id] || skuInfo[g.sku] || {};
      const pdef = personalize[g.product_id] || {};
      const decorations = [];
      // Numbers / names attach as deco lines with the actual values (roster/names
      // keyed by size), NOT as free-text production notes.
      if (pdef.num && hasVals(g.numbers)) decorations.push({ kind: 'numbers', position: 'Back', num_method: 'screen_print', num_size: '6"', two_color: false, sell_override: null, sell_suppressed: true, custom_font_art_id: null, roster: g.numbers, ...routing });
      if (pdef.name && hasVals(g.names)) decorations.push({ kind: 'names', position: 'Back Center', sell_override: null, sell_suppressed: true, sell_each: 6, cost_each: 3, names: g.names, ...routing });
      // Each builder logo placement → one art deco + its art file on the SO.
      const seenPlace = new Set();
      (decosByKey[g.product_id] || decosByKey[g.sku] || []).forEach((d) => {
        const pk = placeKey(d); if (seenPlace.has(pk)) return; seenPlace.add(pk);
        const lib = d.art_id ? artById[d.art_id] : null;
        // Confirm-modal method switch for this logo (e.g. screen print → DTF on a
        // small run) — wins over the library record's deco_type on both the deco
        // line and the art file, for this SO only (the library record is untouched).
        const _ovType = decoMethods[d.art_id || d.art_url] || null;
        const artId = (lib && lib.id) || d.art_id || ('artweb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        if (lib) {
          // Carry the placed (possibly recolored) web logo so the mockup shows what the shopper saw.
          const base = cleanArt(lib);
          if (!base.web_logo_url && d.art_url) base.web_logo_url = d.art_url;
          // Inherited production files must be re-reviewed on THIS order, never auto-confirmed:
          // a prod_files_attached:true carried over from a prior order/colorway would combine
          // with the forced 'approved' below to skip the separations stage entirely (audit A8).
          // Mirrors the manual reuse path (OrderEditor addPrevArt).
          base.prod_files_attached = false;
          // Mirror the OMG pull (createOmgSO in App.js): the store sale IS the customer's
          // approval, so library art lands at least 'approved'. Without this, a library record
          // still at waiting_for_art/needs_approval — e.g. the OMG-import "attach production
          // file" shell — drags the SO's job back into the artist/coach approval pipeline.
          // Production files still gate normally (artProdFilesConfirmed): approval is skipped,
          // the prod-files stage is not.
          if (base.status !== 'approved' && base.status !== 'art_complete') { base.status = 'approved'; if (!base.approved_at) base.approved_at = new Date().toISOString(); }
          addArtFile({ ...base, id: artId, ...(_ovType ? { deco_type: _ovType } : {}) });
        } else {
          addArtFile({ id: artId, name: 'Store logo', deco_type: _ovType || 'screen_print', web_logo_url: d.art_url || '', files: d.source_url ? [{ url: d.source_url, name: 'logo' }] : [], mockup_files: [], color_ways: [], status: 'approved', uploaded: new Date().toLocaleDateString() });
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
        decorations.push({ kind: 'art', art_file_id: artId, position: posOf(d), type: _ovType || (lib && lib.deco_type) || 'screen_print', color_way_id: cwId, web_url: decoUrlForColor(d, info.color, lib && lib.web_logos) || d.art_url || '', placement: d.placement || '', side: d.side || 'front', color_label: d.color_label || 'original', sell_override: 0, sell_each: 0, cost_each: 0, ...routing });
      });
      // Bundle/kit components: carry the component's heat-transfer logo to the SO
      // as a $0 art deco (it's baked into the package price) so production sees
      // which transfer to apply. One shared art file per transfer code.
      (bundleXfersByPid[g.product_id] ? [...bundleXfersByPid[g.product_id]] : []).forEach((code) => {
        const xId = 'xfer_' + code;
        addArtFile({ id: xId, name: 'Transfer: ' + (xferLabel[code] || code), deco_type: 'heat_press', web_logo_url: '', files: [], mockup_files: [], color_ways: [], status: 'approved', uploaded: new Date().toLocaleDateString() });
        decorations.push({ kind: 'art', art_file_id: xId, position: 'Front', type: 'heat_press', transfer_code: code, placement: 'full_front', side: 'front', color_label: 'original', sell_override: 0, sell_each: 0, cost_each: xferCost[code] != null ? xferCost[code] : 0, ...routing });
      });
      // unit_sell = actual collected revenue ÷ units (weighted avg across sizes/bundles),
      // scaled by the batch discount ratio so the SO reconciles to net-of-coupon
      // collected. Deco sells are suppressed above so the garment line carries it all.
      const qtyTot = Object.values(g.sizes).reduce((a, v) => a + v, 0) || 1;
      const unitSell = r2((g.collected || 0) / qtyTot * discRatio);
      return { sku: g.sku || info.sku || '', name: info.name || g.sku || 'Item', brand: info.brand || '', color: info.color || '',
        product_id: g.product_id || info.id || null, vendor_id: info.vendor_id || null, nsa_cost: info.nsa_cost || 0, retail_price: unitSell, unit_sell: unitSell,
        sizes: g.sizes, available_sizes: Object.keys(g.sizes), no_deco: decorations.length === 0, decorations, pick_lines: [], po_lines: [] };
    });

    const units = soItems.reduce((a, i) => a + Object.values(i.sizes).reduce((b, v) => b + v, 0), 0);
    const discNote = totalDiscount > 0 ? `\nCoupon discounts applied: −$${totalDiscount.toFixed(2)} (spread across line prices).` : '';
    // Payment split — production runs as ONE order, but card orders are already
    // collected via Stripe; only the team-tab total should be invoiced to the club.
    const cardOrders = bOrders.filter((o) => o.payment_mode === 'paid');
    const tabOrders = bOrders.filter((o) => o.payment_mode !== 'paid');
    const netOf = (o) => orderNetCollected(o);
    const cardTotal = r2(cardOrders.reduce((a, o) => a + netOf(o), 0));
    const tabTotal = r2(tabOrders.reduce((a, o) => a + netOf(o), 0));
    // Team-tab extras = the tab orders' tax/shipping/processing beyond their
    // product (+fundraise) share. The auto-invoice adds these on top of the SO's
    // product lines so the club's open balance equals the team-tab gross.
    const tabProduct = r2(tabOrders.reduce((a, o) => a + (Number(o.subtotal) || 0) + (Number(o.fundraise_amt) || 0), 0) * discRatio);
    const tabExtras = r2(Math.max(0, tabTotal - tabProduct));
    const payNote = `\n\n⚠ PAYMENT — INVOICE THE CLUB FOR THE TEAM-TAB TOTAL ONLY:\n• Already paid by card (collected via Stripe): $${cardTotal.toFixed(2)} · ${cardOrders.length} order${cardOrders.length === 1 ? '' : 's'}\n• To invoice to the club (team tab): $${tabTotal.toFixed(2)} · ${tabOrders.length} order${tabOrders.length === 1 ? '' : 's'}`;
    const cutoffNote = batchMeta.cutoff ? `\nBatch cutoff: orders placed through ${batchCutoffDay(batchMeta.cutoff)} — the store stays open; later orders go into the next batch.` : '';
    const notes = `Webstore: ${sel.name} (/shop/${sel.slug})${batchMeta.label ? `\nBatch: ${batchMeta.label}` : ''}${cutoffNote}\n${bOrders.length} orders · ${units} units · delivery: ${sel.delivery_mode === 'deliver_club' ? 'deliver to club' : 'ship to home'}\nNames & numbers are on each item's deco lines.${outsideDeco ? '\nDecoration: OUTSIDE — this store is set to be decorated off-site, so every deco (art, names and numbers) is routed Outside and spawns no in-house job. Add a Deco PO to pick the decorator and cost it.' : ''}${discNote}${payNote}`;

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
    const { data: linked, error } = await supabase.from('webstore_orders').update({ so_id: soId, status: 'batched' }).in('id', [...selIds]).is('so_id', null).is('backorder_of', null).select('id');
    if (error) flash(`SO ${soId} created, but linking failed: ${error.message}`);
    else if ((linked || []).length < selIds.size) flash(`Created ${soId} · linked ${(linked || []).length} of ${selIds.size} (some were just batched elsewhere)`);
    else flash(`Created ${soId} · linked ${bOrders.length} orders`);
    loadDetail(sel);
    }; // end proceed

    // Open the styled confirm modal; it calls proceed() on Create with the rep's
    // final selection (cutoff/checkboxes) and batch label.
    setSoPrompt({ orders: open, shortagesFor, stockRowsFor, decoRowsFor, unmatchedRowsFor, proceed, stockByPid, storeId: sel.id });
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

  // Bulk delete: permanently remove every selected row (all colors of each picked
  // item) in one shot. The bulk toolbar does its own summary confirm, so this one
  // doesn't re-prompt. Same hard-delete path as removeGroup — an item that already
  // has orders is FK-protected and the delete errors rather than orphaning history.
  const bulkRemove = useCallback(async (ids) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) return;
    const { error } = await supabase.from('webstore_products').delete().in('id', list);
    if (error) { flash('Error: ' + error.message); return; }
    flash(`Deleted ${list.length} item${list.length === 1 ? '' : 's'}`); loadDetail(sel);
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

  // Remove ONE color from a garment card (the filmstrip ×). Colors are separate
  // webstore_products rows sharing variant_group_id (= the primary row's id). Deleting the
  // primary would orphan its siblings, so when the removed color IS the primary we promote the
  // next color (by sort order) and repoint the group to it; when only one color would remain it
  // becomes a standalone card (variant_group_id cleared). Falls back to a whole-item remove when
  // the color isn't actually part of a multi-color group.
  const removeColorFromItem = useCallback(async (colorId, colorName) => {
    const cat = detail?.catalog || [];
    const me = cat.find((c) => c.id === colorId);
    if (!me) return;
    const groupKey = me.variant_group_id || me.id;
    const group = cat.filter((c) => (c.variant_group_id || c.id) === groupKey);
    if (group.length <= 1) return removeCatalogItem(colorId, colorName);
    if (!window.confirm('Remove the "' + (colorName || 'selected') + '" color from this item?')) return;
    const remaining = group.filter((c) => c.id !== colorId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const removingPrimary = me.id === groupKey;
    const ops = [supabase.from('webstore_products').delete().eq('id', colorId)];
    if (remaining.length === 1) {
      // One color left → plain standalone card.
      if ((remaining[0].variant_group_id || null) !== null) ops.push(supabase.from('webstore_products').update({ variant_group_id: null }).eq('id', remaining[0].id));
    } else if (removingPrimary) {
      // Promote the new leftmost color to primary and repoint the whole group to it.
      const np = remaining[0];
      ops.push(supabase.from('webstore_products').update({ variant_group_id: np.id }).in('id', remaining.map((r) => r.id)));
    }
    const results = await Promise.all(ops);
    const e = results.find((r) => r && r.error);
    if (e) { flash('Error: ' + e.error.message); return; }
    flash('Color removed'); loadDetail(sel);
  }, [detail, sel, flash, loadDetail, removeCatalogItem]);

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
      {soPrompt && <SoConfirmModal orders={soPrompt.orders} shortagesFor={soPrompt.shortagesFor} stockRowsFor={soPrompt.stockRowsFor} decoRowsFor={soPrompt.decoRowsFor} unmatchedRowsFor={soPrompt.unmatchedRowsFor} stockByPid={soPrompt.stockByPid || {}} storeId={soPrompt.storeId} onCancel={() => setSoPrompt(null)} onConfirm={async (overrides, selIds, batchMeta, decoMethods, skuLinks) => { const p = soPrompt.proceed; setSoPrompt(null); await p(overrides, selIds, batchMeta, decoMethods, skuLinks); }} />}

      {tplColorFlow && <TemplateColorPicker tpl={tplColorFlow.tpl} existingPids={tplColorFlow.existingPids} teamHexes={[tplColorFlow.store?.primary_color, tplColorFlow.store?.accent_color].filter(Boolean)} onConfirm={finishTplColorFlow} onClose={() => setTplColorFlow(null)} />}
      {pickStoreForTpl && <StorePickerModal stores={stores.filter((s) => !s.is_template)} custName={custName} title={`Add “${pickStoreForTpl.name}” to which store?`} onPick={(store) => { const tpl = pickStoreForTpl; setPickStoreForTpl(null); beginTplColorFlow(tpl, store); }} onClose={() => setPickStoreForTpl(null)} />}
      {templateFor && <SaveAsTemplateModal store={templateFor} onClose={() => setTemplateFor(null)} onConfirm={confirmSaveAsTemplate} />}

      {editing ? (
        <StoreForm cust={cust} REPS={REPS} repCsr={repCsr} store={editing === 'new' ? null : editing} initialOverrides={editing === 'new' ? omgPrefill : null}
          onCancel={() => { setPendingStartTpl(null); if (tplAfterEdit) { setTplAfterEdit(null); flash('Store saved as a draft — bring the template\'s items in any time via Add items → Add template'); } setEditing(null); omgResetStaged(); }}
          onSave={async (form) => {
            const isNew = editing === 'new';
            const r = await saveStore(form, isNew ? null : editing.id);
            if (r.error) return r;
            setEditing(null);
            // Arrived here from the OMG wizard (items staged in omgItems) — add them + queue
            // in-house art now that the store exists with every setting the rep just configured.
            if (isNew && omgPrefill && r.data) { await omgFinishAfterSettings(r.data); return r; }
            if (isNew && pendingStartTpl && r.data) { const tpl = pendingStartTpl; setPendingStartTpl(null); beginTplColorFlow(tpl, r.data); return r; }
            // Start-Store-from-template: settings are saved, so the store now has the real
            // team's name/customer/colors — open the color picker with THAT palette.
            if (!isNew && tplAfterEdit && r.data && r.data.id === tplAfterEdit.storeId) { const q = tplAfterEdit; setTplAfterEdit(null); beginTplColorFlow(q.tpl, r.data); return r; }
            // A brand-new team store (not from OMG or a template): open it straight to the
            // Catalog tab so the rep starts by adding products (art/logos come after there
            // are items to decorate) — instead of bouncing back to the store list. Club
            // stores stay on the list (product-first).
            if (isNew && r.data && r.data.org_type !== 'club') { setSel(r.data); setTab('catalog'); setDetail(null); await loadDetail(r.data); return r; }
            return r;
          }}
          onImportFromOmg={(editing === 'new' && !omgPrefill) ? () => { setEditing(null); setOmgStep('link'); } : null} />
      ) : sel ? (
        <StoreDetail store={sel} detail={detail} loading={detailLoading} tab={tab} setTab={setTab} focusOrderId={focusOrderId} cu={cu}
          custName={custName} repName={repName} standardCategories={wsSettings?.standard_categories || []}
          onBack={() => { setSel(null); setDetail(null); }}
          onEdit={() => setEditing(sel)} onOpenSO={onOpenSO} onSetStatus={setStoreStatus}
          onAddSingle={addSingle} onAddGrouped={addManyGrouped} onAddColors={addColorsToItem} onAddFits={addFitsToItem} onCopyItem={copyToNewItem} onAddMany={addManyFromList} onApplyTemplate={applyTemplate} onApplyTemplateColors={applyTemplateColors} onPriceToMargin={priceAllToMargin} onCreateBundle={createBundle} onAddBundleItem={addBundleItem} onRemoveBundleItem={removeBundleItem} onReorderBundleItems={reorderBundleItems} onRemove={removeCatalogItem} onRemoveGroup={removeGroup} onBulkRemove={bulkRemove} onUpdateImage={updateImage} onUpdateCost={updateProductCost} onUpdateProductMeta={updateProductMeta} onBatch={batchOrders} onAvailabilityReport={availabilityReport} onPlayerReport={playerReport} onStockReport={stockReport} onProductReport={productReport} onExportCsv={exportCsv} onReorder={reorderItem} onMove={moveItem} onReorderColors={reorderColorRows} onRemoveColor={removeColorFromItem} onUpdateItem={updateCatalogItem} onBulkUpdate={bulkUpdateItems}
          onUpdateTransfer={updateTransfer} onAddTransfers={addTransfers} onRemoveTransfer={removeTransfer} onPullTransfers={pullBatchTransfers}
          onCreateCoupons={createCoupons} onUpdateCoupon={updateCoupon} onRemoveCoupon={removeCoupon}
          onAddRoster={addRoster} onUpdateRoster={updateRoster} onRemoveRoster={removeRoster} onInviteRoster={inviteRoster}
          onSaveOrderEdits={saveOrderEdits} onRefundOrder={refundOrder}
          onApplyLogo={applyLogoToItems} onApplyLogoBulk={applyLogoBulk} onSetItemDecorations={setItemDecorations} onSaveArtVariant={saveArtVariant} onSaveRepWebLogo={saveRepWebLogo} placementMemory={(wsSettings && wsSettings.placement_memory) || {}} onSavePlacementMemory={savePlacementMemory} onSaveMocks={saveStoreMocks} onAddStoreLogo={addStoreLogo} onAddStoreArtFolder={addStoreArtFolder} onSaveStoreArt={saveStoreArt} onAttachWebLogo={attachArtPreview} onFlash={flash}
          portalUrl={coachPortalUrl(sel)} onEmailDirector={(email) => emailDirector(sel, email)} onFlyer={() => openFlyer(sel, attachBundleImages([...(detail?.catalog || [])], detail?.bundleItems || []))} />
      ) : (
        <ListView stores={stores} custName={custName} repName={repName} REPS={REPS} cu={cu} storeStats={storeStats} onOpen={openStore} onOpenSO={onOpenSO} onNew={() => setEditing('new')} onDuplicate={duplicateStore} onChangeCloseDate={changeCloseDate} onToggleTemplate={toggleTemplate} onSaveAsTemplate={saveAsTemplate} onNewFromTemplate={startStoreFromStoreTemplate} onStoreDefaults={() => setShowDefaults(true)} onStartStoreFromTemplate={startStoreFromTemplate} onAddTemplateToStore={(t) => setPickStoreForTpl(t)} onCreateFromOmg={() => setOmgStep('link')} />
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

// Manufacturer → the NSA vendor NAME we buy the blank from — for DISPLAY only. The review's
// vendor column maps vendor_id through the vendors table, but that read is RLS-gated
// (is_team_member), so it can come back empty and show "—" even when we clearly know the
// source. This derives the vendor from the manufacturer with no DB dependency, so an item
// tagged "Sport-Tek" reads "SanMar" and "Alleson"/"Augusta" read "Momentec".
const mfgVendorName = (mfg) => {
  const m = String(mfg || '').toLowerCase();
  if (!m) return '';
  if (/badger|alleson|augusta|holloway|russell\s*athletic|high\s*five/.test(m)) return 'Momentec';
  if (/comfort\s*colors|port\s*(&|and)\s*(company|co)\b|port\s*authority|sport-?tek|gildan|hanes|champion|district|cornerstone|allmade|rabbit\s*skins|jerzees|new\s*era|ogio|eddie\s*bauer|north\s*face|carhartt|mercer|travismathew|bella\s*\+?\s*canvas/.test(m)) return 'SanMar';
  if (/independent\s*trading|next\s*level|tultex|\blat\b|american\s*apparel|alternative|econscious|threadfast|otto/.test(m)) return 'S&S Activewear';
  if (/richardson/.test(m)) return 'Richardson';
  if (/adidas/.test(m)) return 'adidas';
  if (/under\s*armou?r/.test(m)) return 'Under Armour';
  return '';
};

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
          <div style={{ padding: '12px 20px', borderTop: '1px solid #e2�my��$z{-���jםk={() => setBulkOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
            </div>
            <div style={{ padding: 16 }}>
              {/* Single setup step — the logo is placed on the Art page that opens next, so there
                  is no Art tab here (it only ever showed one shared placement anyway). */}
              {bulkTab === 'setup' && (
                <div>
                  <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>Applied to all <b>{selProducts.length}</b> items. Fine-tune sizes &amp; transfers per item afterward.</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                    <Row label={destLabel === 'template' ? 'Price each (blank = list price)' : 'Price each (blank = ~45% margin)'}><input className="form-input" type="number" step="0.01" value={bPrice} onChange={(e) => setBPrice(e.target.value)} placeholder={destLabel === 'template' ? 'list' : '~45%'} style={{ width: 160 }} /></Row>
                    <Row label="Fundraising on top"><input className="form-input" type="number" step="0.01" value={bFund} onChange={(e) => setBFund(e.target.value)} placeholder="0.00" style={{ width: 150 }} /></Row>
                  </div>
                  {storeFund?.enabled && Number(bFund) <= 0 && (
                    <div style={{ fontSize: 11.5, color: '#166534', marginTop: -4, marginBottom: 12 }}>Leave fundraising blank and the store rule applies — adds {Number(storeFund.flat) > 0 ? money(storeFund.flat) : (storeFund.pct || 0) + '%'}{storeFund.round ? ', rounded up' : ''} per item.</div>
                  )}
                  {/* Per-item review table — ONE row per garment card (colors of a style fold
                      into a single row, same grouping the add uses), showing cost + est deco
                      + the final price with live margin. Each row's price is editable; blank
                      = the shared price above (or the ~45% default). */}
                  {(() => {
                    const styleKeyOf = (p) => String(p.name || p.sku || p.id).trim().toLowerCase(); // MUST match addManyGrouped's grouping
                    const groups = [];
                    { const m = new Map();
                      for (const p of selProducts) { const k = styleKeyOf(p); let g = m.get(k); if (!g) { g = { key: k, name: p.name || p.sku, img: p.image_front_url, cost: null, list: 0, colors: 0 }; m.set(k, g); groups.push(g); }
                        g.colors += 1;
                        const c = Number(p.nsa_cost); if (Number.isFinite(c) && c > 0 && (g.cost == null || c > g.cost)) g.cost = c; // show the highest color cost — the safe number to price from
                        const l = Number(p.retail_price) || 0; if (l > g.list) g.list = l;
                        if (!g.img && p.image_front_url) g.img = p.image_front_url;
                      }
                    }
                    if (!groups.length) return null;
                    const decoCost = (bulkDecos.length || (destLabel !== 'template' && isTeam)) ? 5 : 0;
                    const sharedPrice = (bPrice !== '' && bPrice != null && Number(bPrice) > 0) ? Number(bPrice) : null;
                    return (
                      <div style={{ border: '1px solid #e8ebf0', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead><tr style={{ background: '#f8fafc' }}>
                            {['Item', 'Cost', 'Deco est.', 'Price', 'Margin'].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '7px 10px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: '#64748b' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {groups.map((g) => {
                              const auto = (destLabel === 'template' ? null : price45(g.cost, decoCost)) ?? g.list;
                              const ov = bItemPrices[g.key];
                              const price = (ov !== undefined && ov !== '' && Number(ov) > 0) ? Number(ov) : (sharedPrice ?? auto);
                              const margin = price > 0 && g.cost != null ? Math.round((1 - (g.cost + decoCost) / price) * 100) : null;
                              return (
                                <tr key={g.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '6px 10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                      <div style={{ width: 30, height: 30, borderRadius: 6, background: '#f1f5f9', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{g.img ? <img src={g.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👕'}</div>
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{g.name}</div>
                                        {g.colors > 1 && <div style={{ fontSize: 10, color: '#94a3b8' }}>{g.colors} colors · one card</div>}
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', color: '#475569', whiteSpace: 'nowrap' }}>{g.cost != null ? money(g.cost) : '—'}</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', color: '#475569', whiteSpace: 'nowrap' }}>{decoCost ? '~' + money(decoCost) : '—'}</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                                    <input className="form-input" type="number" step="0.01" min={0} value={ov ?? ''} placeholder={String(price)} onChange={(e) => setBItemPrices((m) => ({ ...m, [g.key]: e.target.value }))} style={{ width: 78, fontSize: 12, textAlign: 'right', padding: '4px 8px' }} />
                                  </td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{margin != null ? <b style={{ color: margin >= 45 ? '#166534' : '#b45309' }}>{margin}%</b> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div style={{ padding: '6px 10px', fontSize: 10.5, color: '#94a3b8', borderTop: '1px solid #f1f5f9' }}>Blank price = the shared price above (or the ~45%-margin default). Colors of a style share one card &amp; price.</div>
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

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="btn btn-primary" onClick={() => { setBulkOpen(false); if (onPickMany) onPickMany(selProducts, bulkDecos, { price: bPrice, fundraise: bFund, takes_number: bNumber, takes_name: bName, name_upcharge: bNameUp, category: bCategory.trim(), kit_name: bKit.trim(), required: bRequired, options: cleanItemOptions(bOptions), itemPrices: bItemPrices }); setSelected(new Set()); }}>{`Add ${selProducts.length} to ${destLabel} →`}</button>
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
const _hexLum = (hex) => { const m = String(hex || '').replace('#', '').match(/.{2}/g); if (!m) return 255; const [r, g, b] = m.map((x) => parseInt(x, 16)); return 0.299 * r + 0.587 * g + 0.114 * b; };
const logoThumbBg = (art, thumbUrl) => {
  const wls = Array.isArray(art && art.web_logos) ? art.web_logos : [];
  const forUrl = thumbUrl ? wls.filter((w) => w && w.url === thumbUrl) : [];
  const src = forUrl.length ? forUrl : wls;
  const labels = [...new Set(src.map((w) => ((w && w.color_way) || '').trim()).filter(Boolean))];
  // Only paint the garment color behind the cutout when it's DARK enough to keep a white/light
  // logo from washing out. For light, white, or unknown garment colors (garmentHex falls back to
  // a near-white gray) painting it just makes a TRANSPARENT PNG look like it has a solid white
  // background — so fall back to the transparency checker, which shows the cutout is clean.
  const dark = labels.map(garmentHex).filter((h) => _hexLum(h) < 140);
  if (!dark.length) return LOGO_THUMB_CHECKER;
  return dark.length === 1 ? dark[0] : ('linear-gradient(135deg, ' + dark[0] + ' 0 50%, ' + dark[1] + ' 50% 100%)');
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
function WebLogoSlot({ art, onAttach, onSaveForCw, compact }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState('');
  const [staged, setStaged] = useState(null); // uploaded url awaiting a color-way choice
  const [newCw, setNewCw] = useState('');
  const ref = useRef();
  const has = !!(art?.web_logo_url || (Array.isArray(art?.web_logos) && art.web_logos.some((w) => w && w.url)));
  const colorWays = Array.isArray(art?.color_ways) ? art.color_ways.filter((c) => c && String(c.garment_color || '').trim()) : [];
  const close = () => { setOpen(false); setStaged(null); setNewCw(''); setErr(''); };
  const pick = async (file) => {
    if (!file || !onAttach) return;
    const ok = file.type?.startsWith('image/') || /\.(svg|png)$/i.test(file.name || '');
    if (!ok) { setErr('That file isn’t an image — attach a transparent PNG or SVG.'); return; }
    setErr(''); setBusy(true);
    try {
      const url = await cloudUpload(file, 'nsa-store-art');
      // If per-color-way saving is available, ask which one; else attach as default.
      if (onSaveForCw) setStaged(url);
      else { await onAttach(art, url); close(); }
    } catch (e) { /* cloudUpload surfaces errors via toast */ }
    setBusy(false);
  };
  const saveDefault = async () => { if (!staged) return; setBusy(true); try { await onAttach(art, staged); close(); } catch (e) { /* toast */ } setBusy(false); };
  const saveForCw = async (name) => { if (!staged) return; setBusy(true); try { await onSaveForCw(art, staged, name || ''); close(); } catch (e) { /* toast */ } setBusy(false); };
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setErr(''); setStaged(null); setNewCw(''); setOpen(true); }} disabled={busy}
        title={has ? 'Replace the web logo — the clean PNG/SVG used to place this art on garments' : 'Add a clean transparent PNG/SVG so this art can be placed & recolored on garments'}
        style={{ fontSize: compact ? 9.5 : 10.5, padding: compact ? '2px 6px' : '3px 8px', fontWeight: 800, borderRadius: 6, lineHeight: 1.3, cursor: busy ? 'wait' : 'pointer', border: has ? '1px solid #166534' : '1px dashed #2563eb', background: has ? '#ecfdf5' : '#eff6ff', color: has ? '#166534' : '#1d4ed8', whiteSpace: 'nowrap' }}>
        {busy ? '…' : has ? 'web ✓' : '+ web logo'}
      </button>
      <input ref={ref} type="file" accept="image/*,.svg,.png" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pick(f); e.target.value = ''; }} />
      {open && (
        <div onClick={(e) => { e.stopPropagation(); if (!busy) close(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: 420, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{staged ? 'Which color way?' : has ? 'Replace web logo' : 'Add a web logo'}</div>
              <button onClick={() => !busy && close()} style={{ border: 'none', background: 'none', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            {!staged ? (
              <>
                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12 }}>A clean transparent <b>PNG</b> or <b>SVG</b> — the web-ready cutout used to place &amp; recolor <b>{art?.name || 'this logo'}</b> on garments.</div>
                <div
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!dragOver) setDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); const f = e.dataTransfer?.files && e.dataTransfer.files[0]; if (f) pick(f); }}
                  onClick={() => { if (!busy && ref.current) ref.current.click(); }}
                  style={{ border: '2px dashed ' + (dragOver ? '#2563eb' : '#cbd5e1'), background: dragOver ? '#eff6ff' : '#f8fafc', borderRadius: 12, padding: '30px 16px', textAlign: 'center', cursor: busy ? 'wait' : 'pointer', transition: 'border-color .12s, background .12s' }}>
                  {busy ? <div style={{ fontWeight: 700, color: '#1d4ed8' }}>Uploading…</div>
                    : (<>
                      <div style={{ fontSize: 26, marginBottom: 6 }}>⬆️</div>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: '#334155' }}>Drag &amp; drop your file here</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>or <span style={{ color: '#2563eb', fontWeight: 700 }}>browse</span> — PNG or SVG</div>
                    </>)}
                </div>
                {err && <div style={{ marginTop: 10, fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>{err}</div>}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <img src={staged} alt="" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 8, border: '1px solid #eef2f7', background: '#f8fafc' }} />
                  <div style={{ fontSize: 12, color: '#64748b' }}>Which garment color is this cutout for? Pick a color way, or save it for every garment.</div>
                </div>
                {colorWays.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: '#94a3b8' }}>Existing color ways</div>
                    {colorWays.map((cw, ci) => <button key={cw.id || ci} disabled={busy} onClick={() => saveForCw(cw.garment_color || ('Color way ' + (ci + 1)))} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600, color: '#1e293b' }}><span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#64748b', borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>CW {ci + 1}</span>{cw.garment_color || ('Color way ' + (ci + 1))}</button>)}
                  </div>
                )}
                <div style={{ paddingTop: 12, borderTop: '1px solid #eef2f7' }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, color: '#94a3b8', marginBottom: 6 }}>Or create a new color way</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={newCw} onChange={(e) => setNewCw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newCw.trim()) saveForCw(newCw.trim()); }} placeholder="e.g. Royal, White" style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }} />
                    <button className="btn btn-primary" disabled={busy || !newCw.trim()} onClick={() => saveForCw(newCw.trim())}>Create &amp; save</button>
                  </div>
                  <button disabled={busy} onClick={saveDefault} style={{ marginTop: 10, fontSize: 11.5, fontWeight: 700, color: '#475569', background: 'none', border: 'none', cursor: busy ? 'wait' : 'pointer', padding: 0 }}>or save as the “all garments” default →</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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

// ── New art folder modal ── the webstore twin of the customer page's "New Art" flow: one
// folder = the logo's web cutouts (each color way, labels editable) + its production files
// (.ai/.eps/.dst/.pdf), created in one action. Files picked in either section are sorted by
// TYPE (a raw .ai is never usable as a web logo), and drag-dropped files land presorted.
const _isWebArtFile = (f) => (((f && f.type) || '').startsWith('image/')) && !/\.(ai|eps|pdf|dst)$/i.test((f && f.name) || '');
const _cleanFileName = (n) => String(n || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
// Art types offered when creating a folder — the three in-house decoration methods reps use
// most. Drives the record's deco_type (badge + pricing) and whether the color-ways editor
// asks for ink vs thread colors.
const _ART_TYPES = [['screen_print', 'Screen Print'], ['embroidery', 'Embroidery'], ['dtf', 'DTF']];
// Load a File into an <img> and hand back the element plus a revoke() for its object URL —
// shared by the knock-out-white and vectorize helpers. The File is a local object URL, so the
// canvas is never tainted and getImageData/toDataURL keep working.
const _fileToImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(url) });
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
  img.src = url;
});
// Make near-white pixels transparent — for reps who upload a JPG with a white box behind the
// logo (mirrors QuickMockBuilder's knockoutWhite). Returns a fresh transparent PNG File; the
// original is left untouched if anything fails.
async function _knockoutWhiteFile(file) {
  const { img, revoke } = await _fileToImage(file);
  try {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error('empty image');
    // Bound the work — a web cutout is placed small on garments and never needs >2000px; a
    // rep's full-res phone JPG would otherwise be 12M+ pixels to flood-fill.
    const scale = Math.min(1, 2000 / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    knockoutWhiteBackground(id.data, w, h); // edge flood-fill — see src/lib/imageKnockout.js
    ctx.putImageData(id, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Could not process image');
    return new File([blob], (_cleanFileName(file.name || 'logo').replace(/\s+/g, '-') || 'logo') + '-knockout.png', { type: 'image/png' });
  } finally { revoke(); }
}
// Vectorize a raster logo into a clean, print-ready SVG via the staff-authed Vectorizer.AI
// proxy — the same engine as the sales tools. NOTE: paid API (~$0.10/image). Returns an .svg File.
async function _vectorizeFile(file) {
  const { img, revoke } = await _fileToImage(file);
  try {
    const maxDim = 1500, scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/png');
    if (out.length > 3.5 * 1024 * 1024) { for (const q of [0.9, 0.8, 0.7, 0.6]) { out = c.toDataURL('image/jpeg', q); if (out.length < 3.5 * 1024 * 1024) break; } }
    const resp = await authFetch('/.netlify/functions/vectorizer-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: out.split(',')[1], mode: 'production', outputFormat: 'svg', maxColors: 0 }) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error || !data.svg) throw new Error(data.error || 'Vectorizer error');
    return new File([data.svg], (_cleanFileName(file.name || 'logo').replace(/\s+/g, '-') || 'logo') + '.svg', { type: 'image/svg+xml' });
  } finally { revoke(); }
}
function NewArtFolderModal({ seed, busy, onCreate, onClose }) {
  const mk = (f) => ({ file: f, preview: _isWebArtFile(f) ? URL.createObjectURL(f) : null, label: '', cwId: null });
  const [webs, setWebs] = useState(() => (seed || []).filter(_isWebArtFile).map(mk));
  const [prods, setProds] = useState(() => (seed || []).filter((f) => !_isWebArtFile(f)).map(mk));
  const [name, setName] = useState('');
  const [decoType, setDecoType] = useState('screen_print');
  const [colorWays, setColorWays] = useState([]);
  const [rowBusy, setRowBusy] = useState({}); // web-row index -> 'knock' | 'vec' while processing
  const [rowErr, setRowErr] = useState('');
  const [hoverZone, setHoverZone] = useState(null); // 'web' | 'prod' — which drop target is under the cursor
  const webRef = useRef(); const prodRef = useRef();
  // Revoke every thumbnail object-URL on close (ref mirror so late-added files are included).
  const allRef = useRef([]); allRef.current = [...webs, ...prods];
  useEffect(() => () => { allRef.current.forEach((x) => x.preview && URL.revokeObjectURL(x.preview)); }, []);
  // Folder name + color-way labels suggest themselves from the filenames' common prefix
  // ("eagles logo white/black" → folder "eagles logo", CWs "white"/"black") — all editable.
  const names = [...webs, ...prods].map((x) => _cleanFileName(x.file.name));
  let _pre = names[0] || '';
  for (const n of names.slice(1)) { let i = 0; while (i < _pre.length && n[i] === _pre[i]) i++; _pre = _pre.slice(0, i); }
  _pre = _pre.replace(/[\s_-]+$/, '');
  const suggested = (_pre.length >= 3 ? _pre : names[0]) || 'Store logo';
  const cwSuggestion = (i) => (_cleanFileName(webs[i].file.name).slice(_pre.length).trim() || 'CW ' + (i + 1));
  const addFiles = (list) => {
    const fs = Array.from(list || []).filter(Boolean);
    if (!fs.length) return;
    setWebs((w) => [...w, ...fs.filter(_isWebArtFile).map(mk)]);
    setProds((p) => [...p, ...fs.filter((f) => !_isWebArtFile(f)).map(mk)]);
  };
  const drop = (fn) => (arr, i) => fn(arr.filter((_, j) => j !== i));
  // A web logo IS a color way, so naming one builds its card below instead of making the rep
  // enter the same list twice. The row remembers the card it made (cwId) — re-typing renames
  // that card rather than piling up duplicates, a card already named the same is adopted, and
  // clearing the name drops the card only while it holds no ink colors worth keeping.
  const _hasInk = (cw) => (cw.inks || []).some((x) => x && x.trim());
  const _sameName = (cw, t) => (cw.garment_color || '').trim().toLowerCase() === t.toLowerCase();
  const setWebLabel = (i, label) => {
    const t = label.trim();
    const owned = colorWays.find((c) => c.id === webs[i].cwId) || null;
    // A card two logos share isn't this row's to rename — unlink and let the rules below re-home it.
    const mine = owned && webs.some((w, j) => j !== i && w.cwId === owned.id) ? null : owned;
    const twin = t ? colorWays.find((c) => c !== mine && _sameName(c, t)) : null;
    let cwId = mine ? mine.id : null, next = colorWays;
    if (twin) { cwId = twin.id; if (mine && !_hasInk(mine)) next = colorWays.filter((c) => c !== mine); }
    else if (mine) {
      if (!t && !_hasInk(mine)) { cwId = null; next = colorWays.filter((c) => c !== mine); }
      else next = colorWays.map((c) => (c === mine ? { ...c, garment_color: label } : c));
    } else if (t) {
      cwId = 'cw' + Date.now() + '-' + i;
      next = [...colorWays, { id: cwId, garment_color: label, inks: [''] }];
    }
    if (next !== colorWays) setColorWays(next);
    setWebs((arr) => arr.map((x, j) => (j === i ? { ...x, label, cwId } : x)));
  };
  // Backstop for a logo left on its filename suggestion — it still lands with a color way.
  const withCwsFor = (cws, labels) => labels.reduce((acc, l) => {
    const t = String(l || '').trim();
    return !t || acc.some((c) => _sameName(c, t)) ? acc : [...acc, { id: 'cw' + Date.now() + '-x' + acc.length, garment_color: t, inks: [''] }];
  }, cws);
  // Swap a web row's file in place (after knock-out-white / vectorize), revoking the stale
  // preview so the new cutout is what gets uploaded on Create.
  const replaceWeb = (i, newFile) => setWebs((arr) => arr.map((x, j) => {
    if (j !== i) return x;
    if (x.preview) URL.revokeObjectURL(x.preview);
    return { ...x, file: newFile, preview: _isWebArtFile(newFile) ? URL.createObjectURL(newFile) : null };
  }));
  const runRow = (i, kind, fn) => async () => {
    if (busy || rowBusy[i]) return;
    setRowErr(''); setRowBusy((m) => ({ ...m, [i]: kind }));
    try { replaceWeb(i, await fn(webs[i].file)); }
    catch (e) { setRowErr((kind === 'vec' ? 'Vectorize failed: ' : 'Could not knock out white: ') + (e.message || e)); }
    setRowBusy((m) => { const n = { ...m }; delete n[i]; return n; });
  };
  // Drag-and-drop is the primary way in — each section is a real drop target that lights up
  // on hover. Files always sort by TYPE (a .ai dropped on the web zone still lands in
  // production), so the labels guide without trapping a mis-drop. "browse" is the fallback.
  const dropProps = (key) => ({
    onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); if (hoverZone !== key) setHoverZone(key); },
    onDragLeave: (e) => { e.preventDefault(); e.stopPropagation(); setHoverZone((z) => (z === key ? null : z)); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); setHoverZone(null); addFiles(e.dataTransfer.files); },
  });
  const zoneStyle = (active) => ({ border: '1.5px dashed ' + (active ? '#2563eb' : '#d7dbe2'), borderRadius: 10, padding: 10, background: active ? '#eff6ff' : '#fafbfc', transition: 'background .12s, border-color .12s' });
  const browseLink = { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: 0, textDecoration: 'underline' };
  const create = () => {
    if (busy || (!webs.length && !prods.length)) return;
    const finalWebs = webs.map((w, i) => ({ file: w.file, label: w.label.trim() || (webs.length > 1 ? cwSuggestion(i) : '') }));
    onCreate({
      name: name.trim() || suggested,
      decoType,
      colorWays: withCwsFor(colorWays, finalWebs.map((w) => w.label)),
      webs: finalWebs,
      prods: prods.map((p) => ({ file: p.file })),
    });
  };
  const rowSt = { display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 7px', borderRadius: 8, background: '#fff', border: '1px solid #eef0f3' };
  const prodRowSt = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 8, background: '#fff', border: '1px solid #eef0f3' };
  const miniBtn = { fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6, lineHeight: 1.3, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', whiteSpace: 'nowrap', cursor: 'pointer' };
  const secTitle = { fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: '#475569', marginBottom: 6 };
  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>🎨 New art folder</h2>
          <button onClick={() => !busy && onClose()} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6A7180', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>One folder holds everything production needs for this logo: the web cutouts (one per color way) and the production files. Saved to the customer's art library <i>and</i> this store. PNG‑only is fine — the artist adds production files to the folder later.</div>
          <div style={{ marginBottom: 12 }}>
            <div style={secTitle}>Folder name</div>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} style={{ width: '100%' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={secTitle}>Art type</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {_ART_TYPES.map(([v, lbl]) => (
                <button key={v} type="button" disabled={busy} onClick={() => setDecoType(v)}
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', border: '1.5px solid ' + (decoType === v ? '#2563eb' : '#d7dbe2'), background: decoType === v ? '#eff6ff' : '#fff', color: decoType === v ? '#1d4ed8' : '#475569' }}>{lbl}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={secTitle}>Web logos — one per color way <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' }}>(PNG, SVG · placeable on garments)</span></div>
            <div style={zoneStyle(hoverZone === 'web')} {...dropProps('web')}>
              {webs.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {webs.map((w, i) => (
                  <div key={i} style={rowSt}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div title="Transparent areas show as a checker" style={{ width: 34, height: 34, borderRadius: 6, background: w.preview ? 'repeating-conic-gradient(#cbd5e1 0 25%, #f8fafc 0 50%) 50% / 10px 10px' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>{w.preview ? <img src={w.preview} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : '🖼'}</div>
                      <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{w.file.name}</span>
                      {i === 0 && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#166534', background: '#dcfce7', borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }} title="Also used as the default cutout for all garments">Default</span>}
                      <input className="form-input" value={w.label} disabled={busy} onChange={(e) => setWebLabel(i, e.target.value)} placeholder={webs.length > 1 ? `Color way: ${cwSuggestion(i)}` : 'Color way (optional)'} style={{ width: 150, fontSize: 12 }} title="Name this color way — its card appears below, ready for ink colors" />
                      <button onClick={() => !busy && drop(setWebs)(webs, i)} title="Remove" style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }}>×</button>
                    </div>
                    {_isWebArtFile(w.file) && <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 42, flexWrap: 'wrap' }}>
                      <button type="button" disabled={busy || !!rowBusy[i]} onClick={runRow(i, 'knock', _knockoutWhiteFile)} title="Make the white background transparent — for reps who upload a JPG" style={{ ...miniBtn, opacity: (busy || rowBusy[i]) ? 0.5 : 1 }}>{rowBusy[i] === 'knock' ? '…' : '⬜ Knock out white'}</button>
                      <button type="button" disabled={busy || !!rowBusy[i]} onClick={runRow(i, 'vec', _vectorizeFile)} title="Vectorize to a clean, print-ready SVG (paid ~$0.10/image)" style={{ ...miniBtn, opacity: (busy || rowBusy[i]) ? 0.5 : 1 }}>{rowBusy[i] === 'vec' ? 'Vectorizing…' : '✒ Vectorize'}</button>
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>clean up a JPG / low-res logo</span>
                    </div>}
                  </div>
                ))}
              </div>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: webs.length ? '2px 0' : '20px 0', color: '#6A7180', fontSize: 12.5, fontWeight: 600, pointerEvents: 'none' }}>
                <span style={{ pointerEvents: 'auto' }}>{webs.length ? '📎 Drag more logos here' : '🖼 Drag logos here'}</span>
                <span>·</span>
                <button style={{ ...browseLink, pointerEvents: 'auto' }} disabled={busy} onClick={() => webRef.current && webRef.current.click()}>browse</button>
              </div>
              <input ref={webRef} type="file" multiple accept="image/*,.svg,.png" style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {rowErr && <div style={{ fontSize: 11.5, color: '#b91c1c', fontWeight: 600, marginTop: 6 }}>{rowErr}</div>}
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={secTitle}>Colors in each color way <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' }}>({decoType === 'embroidery' ? 'thread' : 'ink'} colors · optional)</span></div>
            <ColorWaysEditor colorWays={colorWays} onChange={setColorWays} decoType={decoType} pantoneColors={[]} threadColors={[]} suppressWarning />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={secTitle}>Production files <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: '#94a3b8' }}>(.ai, .eps, .dst, .pdf — for the artist / production)</span></div>
            <div style={zoneStyle(hoverZone === 'prod')} {...dropProps('prod')}>
              {prods.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {prods.map((p, i) => (
                  <div key={i} style={prodRowSt}>
                    <span style={{ fontSize: 15 }}>📄</span>
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{p.file.name}</span>
                    <button onClick={() => !busy && drop(setProds)(prods, i)} title="Remove" style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: prods.length ? '2px 0' : '20px 0', color: '#6A7180', fontSize: 12.5, fontWeight: 600, pointerEvents: 'none' }}>
                <span style={{ pointerEvents: 'auto' }}>{prods.length ? '📎 Drag more files here' : '📄 Drag production files here'}</span>
                <span>·</span>
                <button style={{ ...browseLink, pointerEvents: 'auto' }} disabled={busy} onClick={() => prodRef.current && prodRef.current.click()}>browse</button>
              </div>
              <input ref={prodRef} type="file" multiple accept=".ai,.eps,.pdf,.dst" style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: '#9AA1AC', marginRight: 'auto' }}>Drag files onto a section — or anywhere in this window; they sort by type.</span>
            <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || (!webs.length && !prods.length)} onClick={create}>{busy ? 'Uploading…' : '⬆ Create art folder'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArtTab({ catalog, stockByWp, decorationMode = 'in_house', libraryArt, storeArt = [], onSaveStoreArt, onSaveLogo, onSaveArtFolder, onAttachWebLogo, onApplyLogoBulk, onSetItemDecorations, onSaveArtVariant, onSaveRepWebLogo, placementMemory = {}, onSavePlacementMemory, canMock, onOpenMockBuilder }) {
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
  const boxRefs = useRef({}); // styleKey -> the card's stage element (for drag math)
  const dragRef = useRef(null); // { itemId, styleKey, mode:'move'|'resize', scope:'style'|'item'|'backStyle', box, grab }
  // Picks (and placements) are specific to the active logo — a variant pick holds that
  // logo's cutout URL — so switching logos starts a clean staging slate. Selection is kept.
  useEffect(() => { setPickByItem({}); setPlaceByStyle({}); setPlaceByItem({}); setNudgeItem(null); setBackByStyle({}); setFlipped(new Set()); setPresetTouched(false); setDone(''); }, [activeId]);
  // Upload NEW artwork here via the "New art folder" modal: web PNG/SVGs are the logo's
  // color-way cutouts (first = default), .ai/.eps/.dst/.pdf are production files — one
  // record saved to the customer's art library AND this store's set. That folder is what
  // production works from later; no more loose single PNGs.
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderSeed, setFolderSeed] = useState(null); // File[] dropped before the modal opened
  const openFolderWith = (fileList) => { setFolderSeed(Array.from(fileList || []).filter(Boolean)); setFolderOpen(true); };
  const createArtFolder = async ({ name, decoType, colorWays, webs, prods }) => {
    if (!onSaveArtFolder || (!webs.length && !prods.length)) return;
    setUpBusy(true);
    try {
      const clean = (n) => String(n || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const [webFiles, prodFiles] = await Promise.all([
        Promise.all(webs.map(async (w) => ({ url: await cloudUpload(w.file, 'nsa-store-art'), name: clean(w.file.name) || 'Logo', cwLabel: w.label }))),
        Promise.all(prods.map(async (p) => ({ url: await cloudUpload(p.file, 'nsa-production'), name: p.file.name || 'Production file' })))
      ]);
      const rec = await onSaveArtFolder({ name, webFiles, prodFiles, decoType, colorWays });
      if (rec) setActiveId(rec.id);
      setFolderOpen(false); setFolderSeed(null);
    } catch (x) { /* cloudUpload surfaces error via toast */ }
    setUpBusy(false);
  };
  const folderModal = folderOpen && <NewArtFolderModal seed={folderSeed} busy={upBusy} onCreate={createArtFolder} onClose={() => { if (!upBusy) { setFolderOpen(false); setFolderSeed(null); } }} />;

  const inStore = (id) => (storeArt || []).some((a) => a.id === id);
  // Curate the store's art set. Adding a logo also makes it the ACTIVE one to place, so
  // "tap a logo" and "place it" are one gesture (no separate activate step the rep can
  // miss). Removing the active logo hands active off to another logo in the set, so the
  // panel never strands the rep with styles selected and nothing left to apply.
  const toggleStoreArt = async (a) => {
    const cur = storeArt || [];
    if (inStore(a.id)) {
      // Removing the art from the store also strips it from every item it was placed on:
      // an orphaned decoration would otherwise keep the logo on the garment (storefront +
      // order handoff) with no tile left to manage it. Build one entry per affected item
      // (all color rows carry the shared decorations) and clear it via the bulk apply.
      const affected = (catalog || [])
        .filter((it) => (Array.isArray(it.decorations) ? it.decorations : []).some((d) => d && d.art_id === a.id))
        .map((it) => ({ id: it.id, decorations: it.decorations.filter((d) => !(d && d.art_id === a.id)) }));
      if (affected.length && onApplyLogoBulk) {
        if (!window.confirm(`Remove "${a.name || 'this logo'}" from the store? It's on ${affected.length} item${affected.length === 1 ? '' : 's'} and will be taken off ${affected.length === 1 ? 'it' : 'them'} too.`)) return;
        await onApplyLogoBulk(affected);
      }
      const next = cur.filter((x) => x.id !== a.id);
      onSaveStoreArt && onSaveStoreArt(next);
      if (activeId === a.id) setActiveId(next[0]?.id || null);
    } else {
      onSaveStoreArt && onSaveStoreArt([...cur, a]);
      setActiveId(a.id);
    }
  };
  // Tap a library logo to place it: pull it into the store set if it isn't there yet, and
  // make it the active logo. Never removes (removal is the explicit × on the tile).
  const pickArt = (a) => {
    if (!inStore(a.id)) { const cur = storeArt || []; onSaveStoreArt && onSaveStoreArt([...cur, a]); }
    setActiveId(a.id);
  };
  // The store's art set is a snapshot; web logos / color ways added on the customer's art
  // record AFTER the art joined the store only exist on the live library copy. Render and
  // Autocolor from the hydrated view (reads only — saves still write the raw store set).
  const storeArtLive = hydrateStoreArt(storeArt, libraryArt);
  const activeArt = storeArtLive.find((a) => a.id === activeId) || libraryArt.find((a) => a.id === activeId) || null;
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
      // Use the RAW garment photo with object-fit:contain (below) — the SAME frame the
      // per-item placement editor and the storefront now use. All three must agree, or a
      // logo dragged here lands somewhere else on the live store. (Do NOT normGarment here:
      // its trim+pad reframes the photo and the storefront no longer does that.)
      g.items.push({ id: it.id, sku: it.sku, img: it.image_url || st.image_front_url, backImg: st.image_back_url || '', color: st.color || '', decorations: it.decorations || [], styleKey: key });
    }
  }
  const allItems = groups.flatMap((g) => g.items);
  const itemById = (id) => allItems.find((it) => it.id === id) || null;
  const selectedGroups = groups.filter((g) => selected.has(g.key));
  const includedItems = selectedGroups.flatMap((g) => g.items);
  // One label for both Apply buttons that names WHY it's disabled instead of showing a
  // dead "Apply to N styles" — the two things a rep can be missing are a logo and styles.
  const applyLabel = applying ? 'Applying…' : !activeArt ? 'Pick a logo first' : !activeUrl ? 'Add a web logo first' : selectedGroups.length ? `Apply to ${selectedGroups.length} style${selectedGroups.length === 1 ? '' : 's'}` : 'Select styles to apply';
  const applyReady = !applying && !!activeUrl && !!selectedGroups.length;
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
            // cw_pick: the rep SAW this exact cutout on the card (Autocolor or a manual chip) —
            // rendering must honor it instead of re-running the garment-color auto-match.
            const d = { art_id: activeArt.id, source_url, orig_url: activeUrl, placement: pl.placement, x: pl.x, y: pl.y, w: pl.w, side, art_url: r.url, color_label: r.label, cw_pick: true };
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
      // Success → deselect everything (styles AND the art) but KEEP the panel and its
      // garment grid open, so the rep picks the next logo above and applies again without
      // re-opening anything. onApplyLogoBulk already flashed the confirmation.
      if (n > 0) { clearSel(); setActiveId(null); setDone(''); }
      else setDone('Error: nothing was applied — please retry.');
    } catch (e) { setDone('Error: ' + (e.message || e)); }
    setApplying(false);
  };

  // Take the ACTIVE logo back off a style — strips every decoration whose art_id is this
  // logo from each of the style's colors (both sides), leaving other logos and any
  // number/name personalization intact.
  const removeArtFromStyle = async (g) => {
    if (!activeArt || applying) return;
    const entries = (g.items || [])
      .filter((it) => (it.decorations || []).some((d) => d && d.art_id === activeArt.id))
      .map((it) => ({ id: it.id, decorations: (Array.isArray(it.decorations) ? it.decorations : []).filter((d) => !(d && d.art_id === activeArt.id)) }));
    if (!entries.length) return;
    setApplying(true); setDone('');
    try { const n = await onApplyLogoBulk(entries); setDone(n > 0 ? `Removed ${activeArt.name || 'logo'} from ${g.name}.` : 'Error: could not remove — please retry.'); }
    catch (e) { setDone('Error: ' + (e.message || e)); }
    setApplying(false);
  };

  if (!libraryArt.length && !(storeArt || []).length) {
    return (
      <div className="card">
        {folderModal}
        <div
          onClick={() => !upBusy && setFolderOpen(true)}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files && e.dataTransfer.files.length) openFolderWith(e.dataTransfer.files); }}
          style={{ margin: 16, padding: '40px 24px', textAlign: 'center', border: '2px dashed ' + (dragOver ? '#2563eb' : '#cbd5e1'), borderRadius: 14, background: dragOver ? '#eff6ff' : '#fafbfc', cursor: upBusy ? 'wait' : 'pointer' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🎨</div>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#191919', marginBottom: 6 }}>Add artwork to this store</div>
          <div style={{ fontSize: 13, color: '#64748b', maxWidth: 460, margin: '0 auto 16px', lineHeight: 1.55 }}>
            Drag your art files here — several at once become <b>one art folder</b>: web PNG/SVGs (each color way of the logo) plus production files (.ai, .eps, .dst, .pdf). Saved to this team's art library <i>and</i> this store — then place, recolor, and apply to your items right here. PNG‑only is fine too; the artist adds production files to the folder later.
          </div>
          <button onClick={(e) => { e.stopPropagation(); setFolderOpen(true); }} disabled={upBusy} className="btn btn-primary">{upBusy ? 'Uploading…' : '⬆ New art folder'}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {folderModal}
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
              <button onClick={() => setFolderOpen(true)} disabled={upBusy} className="btn btn-sm btn-secondary" title="Create ONE art folder for this logo — web PNGs per color way + .ai/.eps/.dst production files — saved to the customer's art library">{upBusy ? 'Uploading…' : '⬆ New art folder'}</button>
              <button onClick={() => setAddOpen((v) => !v)} className="btn btn-sm btn-secondary">{addOpen ? 'Done' : '+ Add from library'}</button>
            </>}
            <button onClick={() => setPickOpen((v) => !v)} className="btn btn-sm btn-secondary" title={pickOpen ? 'Collapse this section' : 'Expand'}>{pickOpen ? '▲ Collapse' : `▼ Logos (${storeArt.length})`}</button>
          </div>
        </div>
        {pickOpen && (<>
        {storeArt.length === 0 && !addOpen && <div style={{ fontSize: 13, color: '#64748b', padding: '4px 2px 8px' }}>No art chosen for this store yet — click <b>+ Add from library</b> to pick which logos belong on it.</div>}
        {storeArt.length > 0 && <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {storeArtLive.map((a) => {
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
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}><WebLogoSlot art={a} onAttach={onAttachWebLogo} onSaveForCw={onSaveRepWebLogo} compact /></div>
              <button onClick={() => toggleStoreArt(a)} title="Remove from this store" style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#b91c1c', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', lineHeight: '20px', textAlign: 'center', padding: 0 }}>×</button>
            </div>
          ); })}
        </div>}
        {addOpen && <div style={{ marginTop: 10, border: '1px solid #eef2f7', borderRadius: 10, background: '#f8fafc', padding: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Customer's full art library — tap a logo to place it (it joins this store); the <b style={{ color: '#b91c1c' }}>×</b> removes it. ({(storeArt || []).length} in store):</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(94px,1fr))', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {libraryArt.map((a) => { const u = artThumbUrl(a); const sel2 = inStore(a.id); const on2 = a.id === activeId; return (
              <div key={a.id} style={{ position: 'relative' }}>
                <button onClick={() => pickArt(a)} title={on2 ? `${a.name || 'Logo'} — active; pick styles below to apply it` : `Place ${a.name || 'this logo'} — tap, then pick styles below`} style={{ position: 'relative', width: '100%', border: on2 ? '2px solid #4f46e5' : sel2 ? '2px solid #166534' : '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: 6, cursor: 'pointer' }}>
                  <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: u ? logoThumbBg(a, u) : '#f8fafc', borderRadius: 6, overflow: 'hidden', boxShadow: u ? 'inset 0 0 0 1px rgba(0,0,0,.06)' : 'none' }}>
                    {u ? <img src={u} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 700, textAlign: 'center', padding: '0 3px' }}>{(a.files || [])[0] ? 'AI — add web logo' : 'Add web logo'}</span>}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Logo'}</div>
                  {decoBadge(a.deco_type) && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 3 }}><DecoBadge deco={a.deco_type} /></div>}
                  {on2 && <span style={{ position: 'absolute', top: -6, left: -6, fontSize: 9, fontWeight: 800, color: '#fff', background: '#4f46e5', borderRadius: 6, padding: '1px 5px', lineHeight: 1.4 }}>Active</span>}
                  {sel2 && !on2 && <span style={{ position: 'absolute', top: -6, left: -6, width: 18, height: 18, borderRadius: '50%', background: '#166534', color: '#fff', fontSize: 11, fontWeight: 800, lineHeight: '18px', textAlign: 'center' }}>✓</span>}
                </button>
                {sel2 && <button onClick={(e) => { e.stopPropagation(); toggleStoreArt(a); }} title="Remove from this store" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: '#b91c1c', color: '#fff', fontSize: 12, fontWeight: 800, lineHeight: '18px', textAlign: 'center', border: 'none', cursor: 'pointer', padding: 0 }}>×</button>}
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 3 }}><WebLogoSlot art={a} onAttach={onAttachWebLogo} onSaveForCw={onSaveRepWebLogo} compact /></div>
              </div>
            ); })}
          </div>
        </div>}
        {!activeUrl && activeArt && <div style={{ marginTop: 10, fontSize: 12.5, color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>This logo has no web-ready image (likely .ai / mockup only). Attach a clean transparent PNG or SVG to place &amp; recolor it: <WebLogoSlot art={activeArt} onAttach={onAttachWebLogo} onSaveForCw={onSaveRepWebLogo} /></div>}
        </>)}
      </div></div>

      {/* 2 · Bulk apply — opt-in. After bringing art in, the rep chooses to bulk-apply
          a logo: pick a starting placement, select items, Autocolor + drag to fine-tune,
          then apply & review them together. */}
      {(activeArt || bulkOpen) && (!bulkOpen ? (
        <button onClick={() => activeUrl && setBulkOpen(true)} disabled={!activeUrl}
          style={{ width: '100%', textAlign: 'left', cursor: activeUrl ? 'pointer' : 'not-allowed', border: '1px solid #c7d2fe', background: activeUrl ? '#eef2ff' : '#f1f5f9', color: '#3730a3', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span><span style={{ fontSize: 15, fontWeight: 800 }}>Place “{activeArt.name || 'this logo'}” on items →</span><br /><span style={{ fontSize: 12.5, color: activeUrl ? '#4f46e5' : '#94a3b8' }}>{activeUrl ? 'Pick the garments, Autocolor the right logo per color, drag to fine-tune, then apply.' : 'Attach a web logo above first.'}</span></span>
        </button>
      ) : (
        <div className="card"><div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, position: 'sticky', top: 0, background: '#fff', zIndex: 4, paddingBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{activeArt ? <>Place <span style={{ color: '#4f46e5' }}>{activeArt.name || 'logo'}</span> on garments</> : <span style={{ color: '#b45309' }}>Pick a logo above to place it →</span>}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-sm btn-primary" disabled={!applyReady} onClick={() => apply()}>{applyLabel}{applyReady ? ' →' : ''}</button>
              <button onClick={() => setBulkOpen(false)} className="btn btn-sm btn-secondary">✕ Close</button>
            </div>
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
            const has = !!activeArt && g.items.some((it) => (it.decorations || []).some((d) => d && d.art_id === activeArt.id));
            const nudged = !!placeByItem[item.id];
            const navBtn = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: '50%', border: '1px solid #e2e8f0', background: 'rgba(255,255,255,.94)', color: '#334155', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.14)', padding: 0, zIndex: 3, lineHeight: 1 };
            return (
            <div key={g.key} onClick={() => { if (!selG) toggleStyle(g.key); }} title={selG ? '' : 'Tap to select this style'} style={{ border: selG ? '2px solid #4f46e5' : '1px solid #e2e8f0', borderRadius: 12, padding: 8, background: '#fff', cursor: selG ? 'default' : 'pointer', boxShadow: selG ? '0 2px 10px rgba(79,70,229,.10)' : 'none' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={g.name}>{g.name}</div>
              {/* WYSIWYG: raw photo + objectFit:contain in a 4:5 box — the SAME frame the
                  per-item art editor and the storefront (Storefront.js) use — so a logo placed
                  here lands on the same spot on the garment the shopper sees. */}
              <div ref={(el) => { if (el) boxRefs.current[g.key] = el; else delete boxRefs.current[g.key]; }} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}
                style={{ position: 'relative', aspectRatio: '4 / 5', background: '#fff', border: '1px solid #f1f5f9', borderRadius: 9, overflow: 'hidden', touchAction: selG ? 'none' : 'auto' }}>
                {bgImg ? <img src={bgImg} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 11 }}>No {sideNow} image</div>}
                {/* logos already on the shown color+side (other than the one we're placing) —
                    resolved per color (cw_by_color / web-logo variant), never the raw art_url,
                    which may be a different color's cutout. */}
                {(item.decorations || []).filter((d) => d && !d.baked && (d.side || 'front') === sideNow && !isPerso(d) && !(selG && activeArt && d.art_id === activeArt.id)).map((d, di) => { const dp = ART_PLACEMENTS.find((x) => x.id === d.placement) || place; const dx = d.x != null ? d.x : dp.x; const dy = d.y != null ? d.y : dp.y; const dw = d.w != null ? d.w : dp.w; const wl = (storeArtLive.find((a) => a.id === d.art_id) || libraryArt.find((a) => a.id === d.art_id) || {}).web_logos; const u = decoUrlForColor(d, item.color, wl); return u ? <img key={'ad' + di} src={u} alt="" draggable={false} style={{ position: 'absolute', left: `${dx}%`, top: `${dy}%`, width: `${dw}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} /> : null; })}
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
                {!selG && has && <button onClick={(e) => { e.stopPropagation(); removeArtFromStyle(g); }} title={`Remove ${activeArt.name || 'this logo'} from ${g.name}`} style={{ position: 'absolute', top: 6, right: 6, background: '#166534', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', zIndex: 3, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>Applied <span style={{ fontSize: 11, lineHeight: 1, opacity: 0.85 }} aria-label="remove">✕</span></button>}
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
              {selG && activeArt && <div style={{ marginTop: 7 }} onClick={(e) => e.stopPropagation()}>
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
                  {has && <button onClick={() => removeArtFromStyle(g)} disabled={applying} title={`Remove ${activeArt.name || 'this logo'} from ${g.name}`} style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '2px 7px', cursor: applying ? 'wait' : 'pointer' }}>✕ Remove logo</button>}
                </div>
              </div>}
            </div>
          ); })}
          </div>

          {/* Sticky apply bar */}
          <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e6e8ec', padding: '12px 4px', marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {done && <span style={{ fontSize: 12.5, color: done.startsWith('Error') ? '#b91c1c' : '#166534', fontWeight: 700 }}>{done}</span>}
            <span style={{ fontSize: 12.5, color: '#64748b' }}>{selectedGroups.length} style{selectedGroups.length === 1 ? '' : 's'} · {includedItems.length} garment{includedItems.length === 1 ? '' : 's'}{(() => { const b = selectedGroups.filter((g2) => backByStyle[g2.key]).length; return b ? ` · ${b} w/ back` : ''; })()}{activeArt ? ` · ${activeArt.name}` : ''}</span>
            <button className="btn btn-secondary" disabled={applying || !activeArt || !selectedGroups.length} onClick={() => apply({ linkOnly: true })} title="Bypass mockups: link this art to the selected styles for production (art, placement & method) without putting a logo on the image — for OMG stores whose product photos already show the decoration.">{applying ? '…' : `Bypass mocks · link art${selectedGroups.length ? ` to ${selectedGroups.length}` : ''}`}</button>
            <button className="btn btn-primary" disabled={!applyReady} onClick={() => apply()}>{applyLabel}</button>
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
  const revenue = orders.reduce((a, o) => a + orderNetCollected(o), 0);
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
    grossColl: orders.reduce((a, o) => a + originalOrderTotal(o), 0), // immutable amount billed
    refunds: sumF('refunded_amt'),
    ccFees: sumF('cc_fee'),
    labelCost: sumF('label_cost'),
  };
  acct.netColl = acct.grossColl - acct.refunds;
  acct.netAfterFees = acct.netColl - acct.ccFees - acct.labelCost;
  const cardColl = paid.reduce((a, o) => a + originalOrderTotal(o), 0);
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
  // Cost per unit — what staff paid per transfer (total spend ÷ qty bought). Feeds
  // create_club_sales_order's so_item_decorations.cost_each for GP (migration 00204).
  // Blank = unset (not the same as $0); only writes when the value actually changed.
  const CostCell = ({ t }) => <input defaultValue={t.unit_cost != null ? t.unit_cost : ''} type="number" step="0.01" min="0" placeholder="—" key={t.unit_cost} onBlur={(e) => { const raw = e.target.value; const v = raw === '' ? null : Number(raw) || 0; if (v !== (t.unit_cost != null ? t.unit_cost : null)) onUpdateTransfer(t.id, { unit_cost: v }); }} style={{ width: 72, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />;
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
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}><th style={th}>Design transfer</th><th style={th}>On hand</th><th style={th}>Incoming</th><th style={th}>ETA</th><th style={th}></th><th style={th}>On order</th><th style={th}>In process</th><th style={th}>Available</th><th style={th} title="Cost per unit (what you paid, total spend ÷ qty) — feeds club-store GP">Cost/unit</th><th style={th}></th></tr></thead>
            <tbody>
              {designs.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{t.label}</div><div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{t.code}</div></td>
                  <td style={td}><NumCell t={t} field="on_hand" /></td><td style={td}><NumCell t={t} field="incoming" /></td><td style={td}><EtaCell t={t} /></td><td style={td}><Recv t={t} /></td>
                  <td style={td}><OnOrder t={t} /></td><td style={td}><InProc t={t} /></td><td style={td}><Avail t={t} /></td>
                  <td style={td}><CostCell t={t} /></td>
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
    const linked = bySo[so.id] || [];
    const orderById = {}; linked.forEach((w) => { orderById[w.id] = w; });
    const active = activeWebstoreLines(linked.flatMap((w) => itemsByOrder[w.id] || []), orderById);
    const mapped = mapLinesToSoItems(active, so.items || []).lines.map(materializeMappedLine);
    const mappedByOrder = {}; mapped.forEach((i) => { (mappedByOrder[i.order_id] = mappedByOrder[i.order_id] || []).push(i); });
    const bOrders = linked.map((w) => ({ ...w, items: mappedByOrder[w.id] || [] }));
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
  // Club stores: every order converts to its OWN Sales Order automatically (no
  // staff batch step), so there is no single so_id to pull transfers against.
  // Group every converted-but-unpulled order instead — combined garment size
  // counts (this memo) + combined transfer needs (batchTransfers below, now
  // array-capable), pulled in one action. Computed unconditionally (before the
  // loading/error early-returns) to keep this hook's call order stable.
  const clubUnpulled = store.org_type === 'club'
    ? (orders || []).filter((o) => isLiveWebstoreOrder(o) && o.so_id && !o.transfers_pulled)
    : [];
  const clubSoIds = clubUnpulled.map((o) => o.so_id);
  const clubGarmentSizes = useMemo(() => {
    if (!clubUnpulled.length) return [];
    const ids = new Set(clubUnpulled.map((o) => o.id));
    const by = {};
    (orderItems || []).forEach((i) => {
      if (i.is_bundle_parent || !ids.has(i.order_id)) return;
      const key = (i.sku || i.product_id || i.name || 'item') + '|' + (i.size || 'OS');
      if (!by[key]) by[key] = { label: i.name || i.sku || 'Item', size: i.size || 'OS', qty: 0 };
      by[key].qty += i.qty || 1;
    });
    return Object.values(by).sort((a, b) => a.label.localeCompare(b.label) || a.size.localeCompare(b.size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubSoIds.join(','), orderItems]);
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
                  <td style={td}>{t.soName || i.name || i.sku || '—'}</td>
                  <td style={td}>{t.sku ? <span style={{ fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }} title="SKU from the linked Sales Order">{t.sku}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={td}>{t.size || i.size || '—'}</td>
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
    const linked = orders.filter((o) => o.so_id === soId && isLiveWebstoreOrder(o));
    const orderById = {}; linked.forEach((o) => { orderById[o.id] = o; });
    const active = annotateEffSkus(activeWebstoreLines(orderItems.filter((i) => orderById[i.order_id]), orderById), skuMap);
    const so = (sos || []).find((o) => o.id === soId);
    const current = so ? mapLinesToSoItems(active, so.items || []).lines.map(materializeMappedLine) : active;
    const partsById = {}; current.forEach((i) => { (partsById[i.id] = partsById[i.id] || []).push(i); });
    Object.values(partsById).forEach((parts) => { let shipped = Number(parts[0]?.shipped_qty) || 0; const sourceShipped = shipped; parts.forEach((p) => { p._sourceShippedQty = sourceShipped; p.shipped_qty = Math.min(Number(p.qty) || 0, shipped); shipped = Math.max(0, shipped - p.shipped_qty); }); });
    const byOrder = {}; current.forEach((i) => { (byOrder[i.order_id] = byOrder[i.order_id] || []).push(i); });
    return linked.map((o) => ({ order: o, items: byOrder[o.id] || [] }));
  };
  const printPacking = (soId, soLabel) => printHtml(buildPackingLists(store, soLabel, batchGroups(soId)));
  const homeGroups = (soId) => batchGroups(soId).filter((g) => (g.order.ship_method || store.delivery_mode) !== 'deliver_club' && g.order.ship_address);
  // product_id -> image, so ShipStation orders (and the ship email) carry thumbnails.
  const imageByPid = {};
  Object.values(productStock || {}).forEach((s) => { if (s.product_id && s.image_front_url) imageByPid[s.product_id] = s.image_front_url; });
  (catalog || []).forEach((c) => { if (c.product_id && c.image_url) imageByPid[c.product_id] = c.image_url; });
  // Bagging Station ship gate (BAGGING_STATION_PLAN.md): a batch with open
  // packer-declared shorts must not ship until each short is found, pulled,
  // backordered, or refunded (resolved at /bagging-station). Override requires
  // a typed reason. Terminal resolutions also stamp missing_qty, so the ship
  // plan below already excludes that qty even after an override.
  const openBagShorts = (soId) => {
    const ids = new Set(orders.filter((o) => o.so_id === soId).map((o) => o.id));
    return orderItems.filter((i) => ids.has(i.order_id) && i.short_status === 'open').length;
  };
  const bagShortGate = (soId) => {
    const n = openBagShorts(soId);
    if (!n) return true;
    const reason = window.prompt(`${n} open bagging short${n === 1 ? '' : 's'} on this batch — resolve them at the Bagging Station (found / pulled / backorder / refund) before shipping.\n\nTo ship anyway, type a reason:`, '');
    if (!reason || !reason.trim()) return false;
    console.warn('[bagging] ship gate overridden for', soId, '—', reason.trim());
    return true;
  };
  const sendToShipStation = async (soId) => {
    if (!bagShortGate(soId)) return;
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
    if (!bagShortGate(soId)) return;
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
      const plan = lines.map((i) => {
        const remaining = (Number(i.qty) || 0) - (Number(i.shipped_qty) || 0);
        const alreadyMoved = /^(backordered|refunded)$/i.test(i.short_status || '');
        return { item: i, qty: Math.max(0, remaining - (alreadyMoved ? 0 : (Number(i.missing_qty) || 0))) };
      }).filter((x) => x.qty > 0);
      if (!plan.length) { held++; continue; }
      const addrErr = validateShipAddress(o.ship_address);
      if (addrErr) { errs.push({ order: who, msg: addrErr }); continue; }
      const shipItems = plan.map((x) => ({ ...x.item, qty: x.qty }));
      try {
        const { labelData, trackingNumber, carrier, shipmentId, cost } = await createWebstoreLabel(o, shipItems, store, weightByPid, imageByPid);
        if (labelData) labels.push(labelData);
        const shippedById = {}; const targetById = {}; const lineById = {};
        lines.forEach((i) => { targetById[i.id] = (targetById[i.id] || 0) + (Number(i.qty) || 0); lineById[i.id] = i; });
        plan.forEach((x) => { shippedById[x.item.id] = (shippedById[x.item.id] || 0) + x.qty; });
        for (const [id, add] of Object.entries(shippedById)) { const i = lineById[id]; const sq = (Number(i._sourceShippedQty) || 0) + add; const done = sq >= (targetById[id] || 0); try { await supabase.from('webstore_order_items').update({ shipped_qty: sq, ...(done ? { line_status: 'shipped' } : {}) }).eq('id', id); } catch {} lines.filter((l) => l.id === id).forEach((l) => { l.shipped_qty = sq; l._sourceShippedQty = sq; if (done) l.line_status = 'shipped'; }); }
        const allShipped = Object.keys(targetById).every((id) => (Number(lineById[id].shipped_qty) || 0) >= targetById[id]);
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
  // Transfers needed for one SO — or several (club stores' Group Pull passes every
  // converted-but-unpulled order's so_id as an array; each club order is its own SO,
  // so there is no single soId to key off). By default counts only the orders whose
  // transfers haven't been pulled yet (so re-pulling won't double-deduct).
  const batchTransfers = (soId, onlyUnpulled = true) => {
    const soIds = Array.isArray(soId) ? new Set(soId) : new Set([soId]);
    const linked = orders.filter((o) => soIds.has(o.so_id) && (!onlyUnpulled || !o.transfers_pulled));
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
  const clubTransfers = store.org_type === 'club' ? batchTransfers(clubSoIds, true) : { designs: [], numbers: [], byCode: {} };
  const clubDoPull = () => {
    const totalXfer = Object.values(clubTransfers.byCode).reduce((a, n) => a + n, 0);
    if (!window.confirm(`Pull transfers for ${clubUnpulled.length} converted order${clubUnpulled.length === 1 ? '' : 's'}? This deducts ${totalXfer} transfer unit${totalXfer === 1 ? '' : 's'} from On hand and moves them to In process.`)) return;
    onPullTransfers && onPullTransfers(clubSoIds, clubTransfers.byCode);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {store.org_type === 'club' && clubUnpulled.length > 0 && (
        <div className="card"><div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Group pull — {clubUnpulled.length} converted order{clubUnpulled.length === 1 ? '' : 's'} awaiting pull</div>
            {onPullTransfers && <button onClick={clubDoPull} style={{ marginLeft: 'auto', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Pull all transfers</button>}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Every order converted to its own Sales Order that hasn't had transfers pulled yet, combined into one group — same as a batch, but automatic.</div>
          {clubGarmentSizes.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginBottom: 6 }}>Garments</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {clubGarmentSizes.map((g) => <span key={g.label + g.size} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#eff6ff', color: '#1e40af' }}>{g.label} · {g.size}: {g.qty}</span>)}
              </div>
            </div>
          )}
          {(clubTransfers.designs.length > 0 || clubTransfers.numbers.length > 0) && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginBottom: 6 }}>Transfers to pull</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {clubTransfers.designs.map((d) => <span key={d.code} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#ede9fe', color: '#6d28d9' }}>{d.label}: {d.qty}</span>)}
                {clubTransfers.numbers.map((n) => <span key={n.code} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#dcfce7', color: '#166534' }}>{n.label}: {n.qty}</span>)}
              </div>
            </div>
          )}
        </div></div>
      )}
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
        const { rows: items, error: fiErr } = await fetchOrderItemRows(supabase, live.map((o) => o.id));
        if (fiErr) throw fiErr;
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

// Per-line production lifecycle for the order detail's Status column. Mirrors the
// line_status stages that already drive the order-level badge and the parent
// tracking page; a line reads 'Shipped' once shipped_qty covers its quantity.
const WS_LINE_STAGE = {
  pending: { label: 'Waiting', tone: 'gray' },
  on_order: { label: 'On order', tone: 'amber' },
  received: { label: 'Received', tone: 'blue' },
  in_production: { label: 'In deco', tone: 'violet' },
  bagging: { label: 'Bagging', tone: 'slate' },
  shipped: { label: 'Shipped', tone: 'green' },
  complete: { label: 'Complete', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};
const wsLineFullyShipped = (i) => (Number(i.shipped_qty) || 0) >= (Number(i.qty) || 0) || i.line_status === 'shipped';
const wsLineStage = (i) => WS_LINE_STAGE[wsLineFullyShipped(i) ? 'shipped' : (i.line_status || 'pending')] || WS_LINE_STAGE.pending;

function OrdersTab({ orders, orderItems, nameByPid = {}, numbersEnabled, onBatch, onAvailabilityReport, onPlayerReport, onStockReport, onProductReport, onExportCsv, availSizes = {}, onSaveOrderEdits, onRefundOrder, cu, store, soBatch = {}, onOpenSO, focusOrderId = null, msgTagIds = [] }) {
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
  const [expanded, setExpanded] = useState(focusOrderId || null);
  const [, setTick] = useState(0);
  // Arriving from a digest "View" link: auto-open that order (via the initial `expanded`
  // above) and scroll it into view once its row has rendered — orders may still be loading
  // when this tab first mounts, so wait for the row ref, then focus exactly once.
  const focusRef = useRef(null);
  const _didFocus = useRef(false);
  useEffect(() => {
    if (focusOrderId && !_didFocus.current && focusRef.current) { _didFocus.current = true; focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }, [focusOrderId, orders.length]);
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
  // Expected arrival for a line held short — surfaced on the coach tracking page's
  // "Backordered · ETA …" badge. Blank clears it.
  const setItemBackEta = async (item, v) => {
    const d = v || null;
    item.backorder_eta = d;
    setTick((t) => t + 1);
    try { await supabase.from('webstore_order_items').update({ backorder_eta: d }).eq('id', item.id); } catch {}
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
  // Match the actual batch/report eligibility rule exactly. Refunded/cancelled
  // orders used to inflate this badge (live: SJM Volleyball showed 6 when only
  // 2 paid orders could be batched), even though gatherBatch/onBatch correctly
  // refused those rows after the button was clicked.
  const unbatchedCount = orders.filter((o) => !o.so_id && !o.backorder_of && isLiveWebstoreOrder(o)).length;
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
      const hay = `${o.buyer_name} ${o.buyer_email} ${players.join(' ')} ${numbers.join(' ')} ${o.order_number || ''}`.toLowerCase();
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
        {onProductReport && (
          <button className="btn btn-secondary" onClick={onProductReport} title="Download the Silver Screen Domestic fulfillment template using active orders and current sales-order items">
            🏷️ Silver Screen XLSX
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
        {store.org_type === 'club'
          ? <span style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', alignSelf: 'center' }} title="Club orders convert to their own Sales Order automatically the moment they're paid — no staff batching step.">Club orders convert automatically — see the Batches tab to pull transfers.</span>
          : <button className="btn btn-primary" disabled={!unbatchedCount} onClick={onBatch} title={unbatchedCount ? 'Pull the open orders into a batch (a Sales Order) — the store stays open' : 'No unbatched orders'} style={!unbatchedCount ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
              Create Batch ({unbatchedCount})
            </button>}
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
              // Individual orders are entirely one player (shown in the header row), so the
              // per-line Player column is redundant — only bulk orders mix players per line.
              const showPlayer = o.order_kind === 'bulk';
              const shortTotal = lineItems.reduce((a, i) => a + (Number(i.missing_qty) || 0), 0);
              const shippedLines = lineItems.filter((i) => i.line_status === 'shipped').length;
              return (
              <React.Fragment key={o.id}>
              <tr ref={o.id === focusOrderId ? focusRef : undefined} style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer', background: isOpen ? '#eff6ff' : '#fff' }} onClick={() => setExpanded(isOpen ? null : o.id)}>
                <td style={{ ...td, width: 22, color: '#94a3b8' }}>{isOpen ? '▾' : '▸'}</td>
                <td style={td}><div style={{ fontWeight: 600 }}>{o.buyer_name || '—'}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{players.join(', ') || o.buyer_email}</div>{o.order_number && <div style={{ fontSize: 10.5, color: '#94a3b8', fontFamily: 'monospace' }}>#{o.order_number}</div>}</td>
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
                      <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>{['Item', 'Size', ...(showPlayer ? ['Player'] : []), 'Qty', 'Status', 'Short / missing'].map((h) => <th key={h} style={{ ...th, fontSize: 10.5 }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {lineItems.map((i) => {
                          const nm = nameByPid[i.product_id] || i.name || '';
                          // Show the product name up top; color + SKU beneath. When no name
                          // resolves, the SKU takes the top line so we don't repeat it.
                          const sub = [i.color, nm ? i.sku : null].filter(Boolean).join(' · ');
                          return (
                          <tr key={i.id} style={{ borderTop: '1px solid #dbeafe' }}>
                            <td style={td}><div style={{ fontWeight: 600 }}>{nm || i.sku || '—'}</div>{sub && <div style={{ fontSize: 11, color: '#64748b' }}>{sub}</div>}{(i.add_on_selections || []).map((o) => <div key={o.id || o.label} style={{ fontSize: 11, color: '#475569' }}>{o.label}: {o.kind === 'addon' ? 'Yes' : o.value}</div>)}</td>
                            <td style={td}>{i.size || '—'}</td>
                            {showPlayer && <td style={td}>{[i.player_number && '#' + i.player_number, i.player_name].filter(Boolean).join(' · ') || '—'}</td>}
                            <td style={td}>{i.qty}</td>
                            <td style={td}><Chip label={wsLineStage(i).label} tone={wsLineStage(i).tone} />{!wsLineFullyShipped(i) && (Number(i.shipped_qty) || 0) > 0 && <div style={{ fontSize: 10.5, color: '#1d4ed8', fontWeight: 700, marginTop: 2 }}>{i.shipped_qty}/{i.qty} shipped</div>}</td>
                            <td style={td}>
                              <input type="number" min={0} max={i.qty} value={Number(i.missing_qty) || 0} onChange={(e) => setItemMissing(i, e.target.value)} style={{ width: 64, padding: '5px 8px', borderRadius: 6, border: '1px solid ' + (Number(i.missing_qty) > 0 ? '#fde68a' : '#e2e8f0'), background: Number(i.missing_qty) > 0 ? '#fffbeb' : '#fff', fontSize: 13 }} />
                              {Number(i.missing_qty) > 0 && <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 10.5, color: '#94a3b8' }}>ETA</span><input type="date" value={i.backorder_eta || ''} onChange={(e) => setItemBackEta(i, e.target.value)} title="Expected arrival — shown to the coach" style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }} /></div>}
                            </td>
                          </tr>
                          );
                        })}
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
      {editId && (() => { const o = orders.find((x) => x.id === editId); if (!o) return null; return <OrderManageModal order={o} items={itemsByOrder[o.id] || []} availSizes={availSizes} nameByPid={nameByPid} storeName={store && store.name} onSave={onSaveOrderEdits} onRefund={onRefundOrder} onClose={() => setEditId(null)} />; })()}
    </>
  );
}

// Edit an order's line items (size/qty/remove) and issue refunds.
export function OrderManageModal({ order, items, availSizes = {}, nameByPid = {}, storeName = '', onSave, onRefund, onClose }) {
  const editable = items.filter((i) => !i.is_bundle_parent);
  const initRows = editable.map((i) => {
    const removed = /^(cancelled|canceled)$/i.test(String(i.line_status || '')) || Number(i.qty) <= 0;
    return { id: i.id, sku: i.sku, name: nameByPid[i.product_id] || i.name, color: i.color, size: i.size || '', qty: Math.max(0, Number(i.qty) || 0), unit_price: i.unit_price, unit_fundraise: i.unit_fundraise, product_id: i.product_id, player_number: i.player_number, player_name: i.player_name, cancelled_qty: Math.max(0, Number(i.cancelled_qty) || 0), refunded_qty: Math.max(0, Number(i.refunded_qty) || 0), line_status: i.line_status, _removed: removed, _initialRemoved: removed };
  });
  const pendingFrom = (list) => (list || []).map((i) => ({
    item_id: i.item_id || i.id,
    qty: Math.max(0, Number(i.qty != null && i.item_id ? i.qty : (Number(i.cancelled_qty) || 0) - (Number(i.refunded_qty) || 0)) || 0),
    sku: i.sku || '', name: i.name || '', color: i.color || '', size: i.size || '',
    player_name: i.player_name || '', player_number: i.player_number || '',
    unit_price: Number(i.unit_price) || 0, unit_fundraise: Number(i.unit_fundraise) || 0,
  })).filter((i) => i.item_id && i.qty > 0);
  const [rows, setRows] = useState(initRows);
  const [refundAmt, setRefundAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Amount a completed save left owed back to the buyer. Held separately from the
  // live suggestion so the post-save resync can't wipe it before it's refunded.
  const [savedOwed, setSavedOwed] = useState(0);
  const [pendingRefundItems, setPendingRefundItems] = useState(() => pendingFrom(initRows));
  const [selectedRefundItems, setSelectedRefundItems] = useState(() => Object.fromEntries(pendingFrom(initRows).map((i) => [i.item_id, i.qty])));
  const [refundHistory, setRefundHistory] = useState({ refunds: [], items: [] });
  const [composeOpen, setComposeOpen] = useState(false);
  const [refundMsg, setRefundMsg] = useState(null); // null = still the generated default
  const upd = (id, k, v) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const billedTotal = Number(order.original_total != null ? order.original_total : order.total) || 0;
  const remaining = Math.max(0, billedTotal - (Number(order.refunded_amt) || 0));
  const fullyRefunded = Number(order.refunded_amt) > 0 && remaining <= 0.005;

  // The coupon discount scales with the merchandise pot it was a percentage of, so a
  // qty/removal edit shrinks it proportionally — matching saveOrderEdits, which persists
  // the same scaled value. Subtracting the original full dollars over-refunded/over-reduced
  // a shrunken order. oldPot is the order's stored subtotal + fundraise at checkout.
  const _oldPot = (Number(order.subtotal) || 0) + (Number(order.fundraise_amt) || 0);
  const scaledDiscount = (newPot) => _oldPot > 0 ? Math.round((Number(order.discount_amt) || 0) / _oldPot * newPot * 100) / 100 : (Number(order.discount_amt) || 0);

  // Only recompute total when the user has actually made a change — bundle
  // components have unit_price:0 (price lives on the parent row which is
  // excluded), so computing from scratch gives a wrong $0 on load.
  const hasChanges = rows.some((r, i) => r._removed !== initRows[i]?._initialRemoved || r.size !== initRows[i]?.size || Number(r.qty) !== Number(initRows[i]?.qty));
  // Bundle parents hold the package price (components are $0) and aren't editable, so
  // seed the recompute with their value — otherwise the New total drops every package.
  const bundleBaseSub = items.filter((i) => i.is_bundle_parent).reduce((a, i) => a + (Number(i.unit_price) || 0) * (Number(i.qty) || 1), 0);
  const bundleBaseFund = items.filter((i) => i.is_bundle_parent).reduce((a, i) => a + (Number(i.unit_fundraise) || 0) * (Number(i.qty) || 1), 0);
  const newSubtotal = bundleBaseSub + rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_price) || 0) * (Number(r.qty) || 1), 0);
  const newFund = bundleBaseFund + rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_fundraise) || 0) * (Number(r.qty) || 1), 0);
  // The new total has to be the number saveOrderEdits will actually WRITE, or the
  // preview and the refund suggestion below are both wrong. It previously stopped at
  // goods + shipping − discount, omitting the processing fee and the sales tax that
  // saveOrderEdits rescales and persists: on a $333 order edited to $261 it showed a
  // "New total" of $261.00 against a real new total of $294.28. Mirror that function
  // exactly — fee and tax re-derived from THIS order's own stored ratios.
  const _round2 = (n) => Math.round(n * 100) / 100;
  const _oldSub = Number(order.subtotal) || 0;
  const _scaleFromSub = (v) => _round2(_oldSub > 0 ? (Number(v) || 0) / _oldSub * newSubtotal : (Number(v) || 0));
  const newProcessing = _scaleFromSub(order.processing_fee);
  const newTax = _scaleFromSub(order.tax);
  const newPreTax = _round2(Math.max(0, newSubtotal + newFund + (Number(order.shipping_fee) || 0) + newProcessing - scaledDiscount(newSubtotal + newFund)));
  const newTotal = _round2(newPreTax + newTax);
  // What the buyer is owed back: what they were charged, less what they'd now owe.
  // The old formula subtracted the ORIGINAL tax from the old total without adding back
  // the fee and tax still owed on the items kept, so it was wrong in BOTH directions
  // depending on the order — over by $7.47 on #1010542 ($88.65 offered against $81.18
  // owed), but under by $25.81 when every line is removed, and under on a coupon order.
  const owed = _round2(Math.max(0, (Number(order.total) || 0) - newTotal));

  // Keep the refund box in step with the item edits — but never clear an amount that a
  // just-completed save left standing.
  useEffect(() => {
    if (savedOwed > 0) return;
    setRefundAmt(hasChanges && owed > 0.005 ? owed.toFixed(2) : '');
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync the editable rows whenever the saved order comes back from the reload, so
  // the panel can stay open after a save (below) instead of closing to resync.
  const itemsSig = editable.map((i) => `${i.id}:${i.size || ''}:${Number(i.qty) || 0}:${i.line_status || ''}:${Number(i.cancelled_qty) || 0}:${Number(i.refunded_qty) || 0}`).join('|');
  useEffect(() => {
    setRows(initRows);
    const pending = pendingFrom(initRows);
    setPendingRefundItems(pending);
    setSelectedRefundItems(Object.fromEntries(pending.map((i) => [i.item_id, i.qty])));
  }, [itemsSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the durable linkage, not just the aggregate dollars on the order row.
  // Older refunds legitimately appear as "order-level" because their item rows
  // were deleted before this ledger existed and cannot be reconstructed safely.
  useEffect(() => {
    let live = true;
    (async () => {
      const [rr, ri] = await Promise.all([
        supabase.from('webstore_order_refunds').select('id,amount,kind,reason,created_at').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('webstore_order_refund_items').select('refund_id,order_item_id,qty,amount,sku_snapshot,name_snapshot,color_snapshot,size_snapshot,player_name_snapshot,player_number_snapshot').eq('order_id', order.id),
      ]);
      if (live) setRefundHistory({ refunds: rr.data || [], items: ri.data || [] });
    })();
    return () => { live = false; };
  }, [order.id]);

  // Saving used to close the panel, which discarded the refund the rep was mid-way
  // through issuing — the items came off the order, the total dropped, and the money
  // owed was never sent (and afterwards nothing on screen recorded that it was owed).
  // Saving the item adjustment and moving money stay separate, deliberate actions.
  // When a save leaves money owed, go straight to the review step so the rep cannot
  // miss the refund or waste a click reopening it. The final Send & refund button is
  // still the only action that actually moves money.
  const save = async () => {
    setBusy(true);
    const r = await onSave(order, rows);
    setBusy(false);
    if (!r || !r.ok) return;
    const _owed = Number(r.owed != null ? r.owed : owed) || 0;
    const pending = pendingFrom(r.pending_items || []);
    setPendingRefundItems(pending);
    setSelectedRefundItems(Object.fromEntries(pending.map((i) => [i.item_id, i.qty])));
    // Accumulate across successive saves. A rep who trims the order, saves, then trims
    // again before refunding is owed the sum — overwriting here would drop the first
    // round's money on the floor, which is the exact bug this whole change is about.
    if (_owed > 0.005) {
      setSavedOwed((prev) => { const t = _round2(prev + _owed); setRefundAmt(t.toFixed(2)); return t; });
      setComposeOpen(true);
    }
    setJustSaved(true); setTimeout(() => setJustSaved(false), 2500);
  };
  // Refunding goes through the compose step below — same shape as sending an invoice.
  // Send is what processes the refund, so the money and the email leave together and a
  // refund the customer was never told about isn't reachable from this screen.
  const _firstName = String(order.buyer_name || '').trim().split(/\s+/)[0] || 'there';
  const defaultRefundMsg = `Hi ${_firstName} — we've refunded ${money(Number(refundAmt) || 0)} on your order.`;
  const refundMsgValue = refundMsg == null ? defaultRefundMsg : refundMsg; // null = untouched, so it tracks the amount
  const refund = async () => {
    setBusy(true);
    const allocations = pendingRefundItems
      .map((i) => ({ item_id: i.item_id, qty: Math.min(i.qty, Math.max(0, Number(selectedRefundItems[i.item_id]) || 0)) }))
      .filter((i) => i.qty > 0);
    const r = await onRefund(order, Number(refundAmt), (refundMsgValue || '').trim(), allocations);
    setBusy(false);
    if (r && r.ok) { setRefundAmt(''); setSavedOwed(0); setRefundMsg(null); setComposeOpen(false); onClose(); }
  };

  const sectionLabel = { fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', marginBottom: 10 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 580, width: '100%', marginTop: 24, borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef1f5', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0b1220' }}>{order.buyer_name || order.buyer_email}</div>
            {order.order_number && <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>Order #{order.order_number}</div>}
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {order.payment_mode === 'paid' ? <span style={{ color: '#166534', fontWeight: 700 }}>Paid {money(billedTotal)}</span> : <span style={{ color: '#1e40af', fontWeight: 700 }}>Team tab {money(billedTotal)}</span>}
              {Math.abs(billedTotal - (Number(order.total) || 0)) > 0.005 && <span style={{ color: '#64748b' }}> · current items {money(order.total)}</span>}
              {Number(order.discount_amt) > 0 && <span style={{ color: '#16a34a' }}> · {order.coupon_code} −{money(order.discount_amt)}</span>}
              {Number(order.refunded_amt) > 0 && <span style={{ color: '#b45309' }}> · {money(order.refunded_amt)} refunded</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '18px 20px' }}>
          {order.so_id && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>⚠️ Batched into SO <b>{order.so_id}</b> — adjust that SO too if needed.</div>}
          {fullyRefunded && <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: 12, padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>Fully refunded — item history is locked.</div>}

          {/* Items */}
          <div style={sectionLabel}>Items</div>
          <div style={{ background: '#f8fafc', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
            {rows.map((r, idx) => {
              // Always include the size this line was actually bought in, even if the rep
              // has since taken it off the store — otherwise the dropdown renders blank
              // and saving any other edit on the row would silently clear the size.
              const offered = availSizes[r.product_id] || [];
              const sizes = (r.size && !offered.includes(r.size)) ? [...offered, r.size] : offered;
              // Product name up top, color + SKU beneath — same convention as the
              // expanded order row. The SKU alone wasn't enough to tell items apart.
              const sub = [r.color, r.name && r.name !== r.sku ? r.sku : null].filter(Boolean).join(' · ');
              // A refunded cancellation is final: restoring it would put the garment
              // back on reports without charging the buyer again. The database trigger
              // below this UI is the authoritative backstop; this keeps the safe path
              // obvious and removes an action that can never legitimately succeed.
              const refundLocked = r._removed && Number(r.refunded_qty) > 0;
              const editLocked = fullyRefunded || r._removed;
              const maxActiveQty = Number(r.refunded_qty) > 0
                ? Math.max(0, Number(r.qty) + Number(r.cancelled_qty) - Number(r.refunded_qty))
                : undefined;
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: idx < rows.length - 1 ? '1px solid #eef1f5' : 'none', opacity: r._removed ? 0.4 : 1, background: r._removed ? '#fff5f5' : 'transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0b1220' }}>{r.name || r.sku || 'Item'}</div>
                    {sub && <div style={{ fontSize: 11, color: '#64748b' }}>{sub}</div>}
                    {(r.player_number || r.player_name) && <div style={{ fontSize: 11, color: '#94a3b8' }}>{[r.player_number && '#' + r.player_number, r.player_name].filter(Boolean).join(' · ')}</div>}
                  </div>
                  {sizes.length > 0
                    ? <select value={r.size} disabled={editLocked} onChange={(e) => upd(r.id, 'size', e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, background: '#fff' }}><option value="">size</option>{sizes.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    : <input value={r.size} disabled={editLocked} onChange={(e) => upd(r.id, 'size', e.target.value)} placeholder="size" style={{ width: 70, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />}
                  <input type="number" min={1} max={maxActiveQty} value={r.qty} disabled={editLocked} onChange={(e) => upd(r.id, 'qty', e.target.value)} style={{ width: 52, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, textAlign: 'center' }} />
                  <button disabled={fullyRefunded || refundLocked} onClick={() => setRows((all) => all.map((x) => x.id === r.id ? { ...x, _removed: !x._removed, qty: x._removed && Number(x.qty) <= 0 ? 1 : x.qty } : x))} style={{ background: 'none', border: 'none', color: fullyRefunded || refundLocked ? '#94a3b8' : r._removed ? '#2563eb' : '#b91c1c', cursor: fullyRefunded || refundLocked ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{fullyRefunded || refundLocked ? 'refunded' : r._removed ? 'undo' : 'remove'}</button>
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

          <button className="btn btn-primary" disabled={busy || !hasChanges || fullyRefunded} onClick={save}>{busy ? 'Saving…' : justSaved ? 'Saved ✓' : hasChanges && owed > 0.005 ? 'Save & review refund' : 'Save item changes'}</button>
          {hasChanges && owed > 0.005 && <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 7 }}>Saves the order, then opens the refund review. Nothing is refunded until you confirm.</div>}

          {/* Refund controls remain available for stand-alone/manual refunds. Item
              reductions open the same review automatically after a successful save. */}
          <div style={{ borderTop: '1px solid #eef1f5', marginTop: 20, paddingTop: 18 }}>
            <div style={sectionLabel}>Refund</div>
            {savedOwed > 0.005 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                <span>Items saved. <b>{money(savedOwed)}</b> is still owed back — issue the refund below.</span>
              </div>
            )}
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
              {order.stripe_pi_id ? "Refunds the buyer's card via Stripe." : 'Team-tab order — records a credit/adjustment (no card to refund).'}
              {Number(order.refunded_amt) > 0 && <> Already refunded <b>{money(order.refunded_amt)}</b>; <b>{money(remaining)}</b> remaining.</>}
            </div>
            {pendingRefundItems.length > 0 && (
              <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Tie this refund to</div>
                {pendingRefundItems.map((i) => {
                  const checked = (Number(selectedRefundItems[i.item_id]) || 0) > 0;
                  const label = [i.name || i.sku || 'Item', i.sku && i.name ? i.sku : null, i.color, i.size && `size ${i.size}`, i.player_name].filter(Boolean).join(' · ');
                  return <label key={i.item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#334155', padding: '3px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={(e) => setSelectedRefundItems((m) => ({ ...m, [i.item_id]: e.target.checked ? i.qty : 0 }))} />
                    <span style={{ flex: 1 }}>{label}</span><b>×{i.qty}</b>
                  </label>;
                })}
                {!Object.values(selectedRefundItems).some((q) => Number(q) > 0) && <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 5 }}>No item selected — this will be recorded as an order-level refund.</div>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                <span style={{ padding: '0 10px', color: '#94a3b8', fontSize: 15, borderRight: '1px solid #e2e8f0', height: '100%', display: 'grid', placeItems: 'center' }}>$</span>
                <input type="number" min={0} step="0.01" value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} placeholder={remaining.toFixed(2)} style={{ width: 110, padding: '9px 10px', border: 'none', fontSize: 14, outline: 'none' }} />
              </div>
              <button className="btn btn-sm btn-secondary" disabled={remaining <= 0.005} onClick={() => setRefundAmt(remaining.toFixed(2))}>Full ({money(remaining)})</button>
              <button className="btn btn-primary" disabled={busy || !(Number(refundAmt) > 0)} onClick={() => setComposeOpen(true)} style={{ background: '#b91c1c', borderColor: '#b91c1c' }}>{order.stripe_pi_id ? 'Refund to card…' : 'Record credit…'}</button>
            </div>
            {order.buyer_email
              ? <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 8 }}>You'll review the email to {order.buyer_email} before anything is charged back.</div>
              : <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 8 }}>No email on file for this buyer — the refund will process without one.</div>}
            {refundHistory.refunds.length > 0 && (
              <div style={{ marginTop: 14, borderTop: '1px solid #eef1f5', paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Refund history</div>
                {refundHistory.refunds.map((h) => {
                  const linked = refundHistory.items.filter((i) => i.refund_id === h.id);
                  return <div key={h.id} style={{ fontSize: 11.5, color: '#475569', padding: '4px 0' }}>
                    <b>{money(h.amount)}</b> · {h.created_at ? new Date(h.created_at).toLocaleDateString() : h.kind}
                    <div style={{ color: linked.length ? '#1d4ed8' : '#94a3b8', marginTop: 1 }}>
                      {linked.length ? linked.map((i) => `${i.name_snapshot || i.sku_snapshot || 'Item'}${i.size_snapshot ? ` (${i.size_snapshot})` : ''} ×${i.qty}`).join(', ') : 'Order-level / legacy refund — no item link'}
                    </div>
                  </div>;
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compose step — Send is what actually processes the refund, so the money and
          the note to the family always go together. Same flow as sending an invoice. */}
      {composeOpen && (
        <div onClick={() => !busy && setComposeOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflow: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 540, width: '100%', marginTop: 40, borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef1f5' }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#0b1220' }}>{order.stripe_pi_id ? 'Refund' : 'Record credit'} {money(Number(refundAmt) || 0)}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                {order.buyer_email
                  ? <>Sending to <b>{order.buyer_email}</b> · Order #{order.order_number}</>
                  : <>No email on file · Order #{order.order_number}</>}
              </div>
            </div>
            <div style={{ padding: '18px 20px' }}>
              {order.buyer_email && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', marginBottom: 6 }}>Subject</div>
                  <div style={{ fontSize: 13, color: '#334155', background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 8, padding: '9px 12px', marginBottom: 14 }}>
                    {money(Number(refundAmt) || 0)} refunded on your {storeName || 'team store'} order #{order.order_number}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8', marginBottom: 6 }}>Message</div>
                  <textarea value={refundMsgValue} onChange={(e) => setRefundMsg(e.target.value)} rows={4}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13.5, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: '#94a3b8', marginTop: 6, marginBottom: 14 }}>
                    <span>The amounts, the {order.stripe_pi_id ? 'when-to-expect-it note' : 'team-account note'} and the order link are added automatically.</span>
                    {refundMsg != null && <button type="button" onClick={() => setRefundMsg(null)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', padding: 0 }}>Reset</button>}
                  </div>
                </>
              )}
              <div style={{ background: '#fff5f5', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, marginBottom: 16 }}>
                Sending {order.stripe_pi_id ? `returns ${money(Number(refundAmt) || 0)} to the buyer's card` : `records a ${money(Number(refundAmt) || 0)} credit`}. This can't be undone.
                {pendingRefundItems.some((i) => Number(selectedRefundItems[i.item_id]) > 0) && <div style={{ marginTop: 5, fontWeight: 700 }}>The refund ledger will retain the selected SKU, size, player, and quantity.</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" disabled={busy} onClick={() => setComposeOpen(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={busy || !(Number(refundAmt) > 0)} onClick={refund} style={{ background: '#b91c1c', borderColor: '#b91c1c' }}>
                  {busy ? 'Sending…' : order.buyer_email ? `Send & refund ${money(Number(refundAmt) || 0)}` : `Refund ${money(Number(refundAmt) || 0)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
    ['Open → Close', `${ptDateInput(s.open_at) || '—'} → ${s.close_at ? `${ptDateInput(s.close_at)} ${ptTimeLabel(s.close_at)} PT` : '—'}`],
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
