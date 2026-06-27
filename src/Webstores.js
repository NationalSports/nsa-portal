/* eslint-disable */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { cloudUpload, sendBrevoEmail, authFetch, invokeEdgeFn, printPdfLabels, estimateWeightOz, labelWeightLbs, validateShipAddress, computeOrderTracking } from './utils';
import { shipStationCall } from './vendorApis';
import { NSA, pantoneHex } from './constants';
import { CatalogKitStyles, KitScope, DISPLAY, BODY, FilterBtn, ShowMore } from './ui/catalogKit';
import { fetchStockMap, foldScale, foldedQty, foldedSoon, sizeRank } from './lib/storeInventory';
import { ART_PLACEMENTS, placementById } from './lib/artPlacements';
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
    const rows = items.filter((i) => !i.is_bundle_parent).map((i) => `<tr><td>${esc(i.sku || '')}</td><td>${esc(i.size || '')}</td><td>${esc(i.player_number || '')}</td><td>${esc(i.player_name || '')}</td><td style="text-align:center">${i.qty || 1}</td></tr>`).join('');
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
function buildAvailabilityReport(store, label, lines, stockByPid, orderById) {
  const keyOf = (pid, size) => pid + '|' + (size || 'OS');
  // Earliest orders claim stock first.
  const sorted = [...lines].sort((a, b) => {
    const ta = orderById[a.order_id]?.created_at || '', tb = orderById[b.order_id]?.created_at || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const remaining = {};   // product|size -> units left to allocate (Infinity if untracked)
  const itemAgg = {};     // product|size -> rollup row
  const orderShort = {};  // order_id -> { order, lines: [...] }
  let totalUnits = 0, shortUnits = 0, untrackedUnits = 0;

  sorted.forEach((i) => {
    const pid = i.product_id; const size = i.size || 'OS'; const need = i.qty || 1;
    totalUnits += need;
    if (!pid) { untrackedUnits += need; return; }
    const k = keyOf(pid, size);
    const st = stockByPid[pid];
    const wh = Number((st?.size_stock || {})[size]) || 0;
    const ven = Number((st?.vendor_size_stock || {})[size]) || 0;
    const tracked = !!st;
    if (remaining[k] === undefined) remaining[k] = tracked ? wh + ven : Infinity;
    if (!itemAgg[k]) itemAgg[k] = { name: st?.name || i.sku || pid, sku: i.sku || '', size, needed: 0, ours: wh, adidas: ven, filled: 0, tracked, onOrder: !!(st?.on_order_qty || st?.vendor_eta) };
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
      bucket.lines.push({ name: row.name, sku: i.sku || '', size, short, player: i.player_name || '', number: i.player_number || '' });
    }
  });

  const rows = Object.values(itemAgg);
  const shortRows = rows.filter((r) => r.filled < r.needed).sort((a, b) => (b.needed - b.filled) - (a.needed - a.filled));
  const okRows = rows.filter((r) => r.filled >= r.needed).sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size));
  const shortOrders = Object.values(orderShort).sort((a, b) => (a.order.created_at || '') < (b.order.created_at || '') ? -1 : 1);
  const ordersTotal = Object.keys(orderById).length;
  const availUnits = totalUnits - shortUnits;

  const chip = (n, l, danger) => `<div class="chip${danger ? ' bad' : ''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const itemRow = (r) => {
    const avail = r.tracked ? r.ours + r.adidas : '—';
    const sh = r.needed - r.filled;
    return `<tr${sh > 0 ? ' class="r"' : ''}><td>${esc(r.name)}${r.sku ? `<div class="sub">${esc(r.sku)}</div>` : ''}</td><td class="c">${esc(r.size)}</td><td class="c">${r.needed}</td><td class="c">${r.tracked ? r.ours : '—'}</td><td class="c">${r.tracked ? r.adidas : '—'}</td><td class="c">${avail}</td><td class="c b">${sh > 0 ? `<span class="neg">−${sh}</span>${r.onOrder ? ' <span class="oo">on order</span>' : ''}` : '✓'}</td></tr>`;
  };
  const itemTable = (list) => `<table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Need</th><th class="c">Ours</th><th class="c">Adidas</th><th class="c">Avail</th><th class="c">Short</th></tr></thead><tbody>${list.map(itemRow).join('')}</tbody></table>`;

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
    .sub{font-size:11px;color:#94a3b8}.neg{color:#b91c1c;font-weight:800}
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
    const p = players[key] || (players[key] = { label: nm || (o.buyer_name ? o.buyer_name + ' (buyer)' : 'Unassigned'), number: num, units: 0, items: [] });
    p.units += (i.qty || 1);
    p.items.push({ name: _itemName(i, stockByPid), sku: i.sku || '', size: i.size || '', qty: i.qty || 1, buyer: o.buyer_name || '' });
  });
  const list = Object.values(players).sort((a, b) => a.label.localeCompare(b.label));
  const notOrdered = (roster || []).filter((r) => !r.ordered);
  const totalUnits = list.reduce((a, p) => a + p.units, 0);
  const chip = (n, l) => `<div class="chip"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const block = (p) => {
    const rows = p.items.map((it) => `<tr><td>${esc(it.name)}${it.sku ? `<div class="sub">${esc(it.sku)}</div>` : ''}</td><td class="c">${esc(it.size)}</td><td class="c b">${it.qty}</td><td>${esc(it.buyer)}</td></tr>`).join('');
    return `<div class="ord"><div class="oh">${esc(p.label)}${p.number ? ` <span class="num">#${esc(p.number)}</span>` : ''}<span class="dt">${p.units} item${p.units === 1 ? '' : 's'}</span></div>
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
function aggStock(lines, stockByPid) {
  const agg = {};
  lines.forEach((i) => {
    const pid = i.product_id; const size = i.size || 'OS'; const need = i.qty || 1;
    const k = (pid || i.sku || 'x') + '|' + size;
    const st = pid ? stockByPid[pid] : null;
    if (!agg[k]) agg[k] = {
      name: (st && st.name) || i.name || i.sku || pid, sku: i.sku || '', size, need: 0,
      ours: Number(((st && st.size_stock) || {})[size]) || 0,
      vendor: Number(((st && st.vendor_size_stock) || {})[size]) || 0,
      tracked: !!st, onOrder: !!(st && (st.on_order_qty || st.vendor_eta)),
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
function buildStockReport(store, label, lines, stockByPid) {
  const rows = aggStock(lines, stockByPid);
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const needSrc = rows.filter((r) => r.poVendor > 0 || r.backorder > 0)
    .sort((a, b) => (b.backorder - a.backorder) || (b.poVendor - a.poVendor));
  const fillable = rows.filter((r) => r.tracked && r.need <= r.ours).sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size));
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
    .sub{font-size:11px;color:#94a3b8}.neg{color:#b91c1c;font-weight:800}
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
      sku: i.sku || '', name: [i.sku, i.size && ('Size ' + i.size), i.player_number && ('#' + i.player_number), i.player_name].filter(Boolean).join(' · '),
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

// Polished launch email: shop link + scannable QR + key info + the coach's portal.
function launchEmailHtml(store, portalUrl) {
  const url = _storefrontUrl(store);
  const primary = _hex(store.primary_color, '#0b1f3a');
  const accent = _hex(store.accent_color, '#e11d2a');
  const lead = store.org_type === 'club' ? 'Director' : 'Coach';
  const rows = [];
  if (_fmtDate(store.close_at)) rows.push(['Order by', _fmtDate(store.close_at)]); else rows.push(['Ordering', 'Open now']);
  if (_fmtDate(store.open_at)) rows.push(['Opened', _fmtDate(store.open_at)]);
  rows.push(['Delivery', _deliveryLabel(store)]);
  rows.push(['Production', 'About 4–5 weeks after the store closes']);
  const infoRows = rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:120px">${_esc(k)}</td><td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">${_esc(v)}</td></tr>`).join('');
  return `
  <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0f172a;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
    <div style="background:${primary};padding:26px 24px;color:#fff">
      ${store.logo_url ? `<img src="${_esc(store.logo_url)}" alt="" style="height:44px;margin-bottom:10px;border-radius:8px;background:#fff;padding:4px"/><br/>` : ''}
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85;font-weight:700">Official Team Store</div>
      <div style="font-size:24px;font-weight:800;margin-top:4px">${_esc(store.name)}</div>
    </div>
    <div style="padding:24px">
      <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Hi ${_esc(store.director_name || lead)},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 18px">Your team store is <b>live</b>. Everything in it is pre-approved, so families can order with confidence — just share the link or the code below.</p>
      <div style="text-align:center;margin:8px 0 18px"><a href="${url}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:13px 30px;border-radius:10px;font-weight:800;font-size:15px">Shop the store →</a></div>
      <div style="text-align:center;margin:0 0 18px">
        <img src="${_qrImg(url, 220)}" alt="QR code to the store" width="180" height="180" style="border:1px solid #e2e8f0;border-radius:12px"/>
        <div style="font-size:12px;color:#64748b;margin-top:6px">Scan to shop — or share this image with your families.</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">${_esc(url)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #eef2f7;border-bottom:1px solid #eef2f7;margin:6px 0 16px">${infoRows}</table>
      ${portalUrl ? `<p style="font-size:13px;line-height:1.6;color:#475569;margin:0 0 6px">Want to follow orders as they come in? Here's your private tracking portal:</p><p style="margin:0 0 16px"><a href="${_esc(portalUrl)}" style="color:#2563eb;font-size:13px">Open your ${_esc(lead.toLowerCase())} portal →</a></p>` : ''}
      <p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:14px 0 0">Thanks for building with National Sports Apparel.</p>
    </div>
  </div>`;
}

// A print-ready flyer (own window) with a big QR and team colors.
function flyerHtml(store) {
  const url = _storefrontUrl(store);
  const primary = _hex(store.primary_color, '#0b1f3a');
  const accent = _hex(store.accent_color, '#e11d2a');
  const close = _fmtDate(store.close_at);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${_esc(store.name)} — Flyer</title>
  <style>
    *{box-sizing:border-box} html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}
    .page{width:8.5in;min-height:11in;margin:0 auto;display:flex;flex-direction:column}
    .hero{background:${primary};color:#fff;padding:64px 56px 48px;text-align:center}
    .eyebrow{font-size:16px;letter-spacing:5px;text-transform:uppercase;font-weight:800;opacity:.85}
    .title{font-size:52px;font-weight:900;line-height:1.05;margin:14px 0 0;text-transform:uppercase}
    .body{flex:1;padding:48px 56px;text-align:center;color:#0f172a}
    .scan{font-size:30px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:${accent}}
    .qr{margin:22px auto;border:6px solid ${primary};border-radius:18px;display:inline-block;line-height:0}
    .url{font-size:20px;font-weight:700;margin-top:10px;word-break:break-all}
    .meta{font-size:18px;color:#475569;margin-top:24px;line-height:1.6}
    .foot{background:${accent};color:#fff;text-align:center;padding:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
    .btn{margin:18px;text-align:center} @media print{.btn{display:none}}
    @page{size:letter;margin:0}
  </style></head><body>
  <div class="btn"><button onclick="window.print()" style="padding:10px 22px;font-size:15px;font-weight:800;border:none;border-radius:8px;background:${primary};color:#fff;cursor:pointer">Print flyer</button></div>
  <div class="page">
    <div class="hero">
      ${store.logo_url ? `<img src="${_esc(store.logo_url)}" alt="" style="height:96px;margin-bottom:18px;background:#fff;border-radius:14px;padding:8px"/><br/>` : ''}
      <div class="eyebrow">Official Team Store</div>
      <div class="title">${_esc(store.name)}</div>
    </div>
    <div class="body">
      <div class="scan">Scan to shop</div>
      <div class="qr"><img src="${_qrImg(url, 520)}" alt="QR code" width="320" height="320"/></div>
      <div class="url">${_esc(url)}</div>
      <div class="meta">All gear is coach-approved.${close ? `<br/><b>Order by ${_esc(close)}.</b>` : ''}<br/>${_deliveryLabel(store)} about 4–5 weeks after the store closes.</div>
    </div>
    <div class="foot">National Sports Apparel</div>
  </div>
  </body></html>`;
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

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); }, []);

  const custName = useCallback((id) => cust.find((c) => c.id === id)?.name || '—', [cust]);
  const repName = useCallback((id) => REPS.find((r) => r.id === id)?.name || '—', [REPS]);

  // Read-only coach/director portal link for a store's club (keyed on alpha_tag).
  const coachPortalUrl = useCallback((store) => {
    const c = cust.find((x) => x.id === store?.customer_id);
    const tag = c?.alpha_tag || c?.name || '';
    return tag ? `${PUBLIC_SITE}/coach?portal=${encodeURIComponent(tag)}` : '';
  }, [cust]);

  // Send the polished launch email (shop link + QR + key info + tracking portal).
  const emailDirector = useCallback(async (store) => {
    const to = (store.director_email || store.coach_contact_email || '').trim();
    if (!to) { flash('Add a coach/director email in the store’s Settings first'); return; }
    const r = await sendBrevoEmail({ to: [{ email: to, name: store.director_name || '' }], subject: `Your team store is live: ${store.name}`, htmlContent: launchEmailHtml(store, coachPortalUrl(store)), senderName: 'National Sports Apparel', senderEmail: 'noreply@nationalsportsapparel.com' });
    if (r && r.error) flash('Email failed: ' + r.error);
    else flash('Launch email sent to ' + to);
  }, [coachPortalUrl, flash]);

  // Open the print-ready flyer in its own tab.
  const openFlyer = useCallback((store) => {
    const w = window.open('', '_blank');
    if (!w) { flash('Allow pop-ups to open the flyer.'); return; }
    w.document.write(flyerHtml(store)); w.document.close();
  }, [flash]);

  const loadStores = useCallback(async () => {
    setLoading(true); setErr(null); setNeedsMigration(false);
    const { data, error } = await supabase.from('webstores').select('*').eq('source', 'webstore').order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) setNeedsMigration(true); else setErr(error.message);
      setStores([]);
    } else {
      // Hide OMG pop-up shadow stores — they're created by the OMG ingest to track
      // those orders on the webstore rails and are managed on the OMG Stores page,
      // not here. (Filtered client-side to avoid PostgREST's null-vs-neq gotcha.)
      setStores((data || []).filter((s) => s.source !== 'omg' && !s.omg_sale_code));
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
  const saveWsSettings = useCallback(async (patch) => {
    const next = { id: 1, standard_categories: [], checkout_message: '', default_options: [], ...(wsSettings || {}), ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('webstore_settings').upsert(next, { onConflict: 'id' });
    if (error) { flash('Error: ' + error.message); return false; }
    setWsSettings(next); flash('Store defaults saved'); return true;
  }, [wsSettings, flash]);

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
    const imgBackByPid = {};
    if (pidList.length) {
      const { data: costRows } = await supabase.from('products').select('id,nsa_cost,is_clearance,clearance_cost,image_back_url').in('id', pidList);
      for (const cp of costRows || []) {
        const cc = (cp.is_clearance && cp.clearance_cost != null) ? Number(cp.clearance_cost) : Number(cp.nsa_cost);
        costByPid[cp.id] = Number.isFinite(cc) ? cc : null;
        if (cp.image_back_url) imgBackByPid[cp.id] = cp.image_back_url;
      }
    }
    const catIds = new Set(catalog.map((c) => c.id));
    const orders = ordRes.data || [];
    const orderIds = new Set(orders.map((o) => o.id));
    const stockByWp = {}; (stockRes.data || []).forEach((s) => { stockByWp[s.webstore_product_id] = s; });
    // The storefront snapshot doesn't carry back images — fall back to the master product's
    // image_back_url so the editor's Back tab (and mockups) show it without a manual upload.
    catalog.forEach((c) => { const back = c.product_id && imgBackByPid[c.product_id]; if (!back) return; const s = stockByWp[c.id]; if (s) { if (!s.image_back_url) s.image_back_url = back; } else { stockByWp[c.id] = { image_back_url: back }; } });
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
      await sendBrevoEmail({ to: [{ email: to, name: store.director_name || '' }], subject: `Your team store is live: ${store.name}`, htmlContent: launchEmailHtml(store, coachPortalUrl(store)), senderName: 'National Sports Apparel', senderEmail: 'noreply@nationalsportsapparel.com' });
      flash('Launched — coach emailed the store link + QR.');
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
    const { data, error } = await supabase.from('webstores').insert(form).select().single();
    if (error) return { error };
    setStores((prev) => [data, ...prev]);
    flash('Store created'); return { data };
  }, [sel, flash, stores, notifyCoachPublished]);

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
    else flash(status === 'open' ? 'Store launched — it’s live' : `Store ${status}`);
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
    if (!rows.length) { flash('All of this template’s items are already in the store'); return { added: 0 }; }
    return addManyFromList(rows);
  }, [detail, flash, addManyFromList]);

  // Apply a template AFTER the rep picks which colors of each style to bring in (template
  // color-picker). plan = [{ products:[{id,sku,retail_price}], price, fundraise, category,
  // kit_name, required }]; each group's picked colors fold into ONE multi-color card (shared
  // variant_group_id = the primary row's id). Colors already in the store are skipped.
  const applyTemplateColors = useCallback(async (plan) => {
    if (!sel?.id || !Array.isArray(plan)) return { added: 0 };
    const existing = new Set((detail?.catalog || []).map((c) => c.product_id).filter(Boolean));
    let base = (detail?.catalog?.length || 0);
    let added = 0;
    const defOpts = Array.isArray(wsSettings?.default_options) ? wsSettings.default_options : [];
    const mk = (p, grp, groupId) => ({ store_id: sel.id, kind: 'single', product_id: p.id, sku: p.sku,
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
    flash(added ? `Added ${added} item${added === 1 ? '' : 's'}` : 'Those colors are already in the store'); loadDetail(sel);
    return { added };
  }, [sel, detail, wsSettings, flash, loadDetail]);

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

  const updateCatalogItem = useCallback(async (id, fields) => {
    const { error } = await supabase.from('webstore_products').update(fields).eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    // Decorations (incl. per-color web-logo overrides) are a card-level concern: when a
    // multi-color card's art changes, push the same decorations to every color row in the
    // group so the storefront and order handoff render the right logo for each color.
    if (Object.prototype.hasOwnProperty.call(fields, 'decorations')) {
      const cat = detail?.catalog || [];
      const me = cat.find((c) => c.id === id);
      const groupKey = me ? (me.variant_group_id || me.id) : null;
      const groupIds = groupKey ? cat.filter((c) => (c.variant_group_id || c.id) === groupKey && c.id !== id).map((c) => c.id) : [];
      if (groupIds.length) await supabase.from('webstore_products').update({ decorations: fields.decorations }).in('id', groupIds);
    }
    flash('Item updated'); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

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
      // The baked mock becomes the item image; clear any overlay decoration so the
      // logo isn't stamped twice (baked + CSS overlay).
      if (item) { await supabase.from('webstore_products').update({ image_url: front.url, decorations: [] }).eq('id', item.id); applied++; }
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
      const di = wls.findIndex((w) => !((w.color_way || '').trim()));
      const web_logos = di >= 0 ? wls.map((w, i) => (i === di ? { ...w, url } : w)) : [{ url, color_way: '' }, ...wls];
      return { ...a, web_logo_url: url, web_logos };
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

  // Edit an order's line items (size/qty/remove), then recompute its totals.
  const saveOrderEdits = useCallback(async (order, edited) => {
    for (const it of edited) {
      if (it._removed) await supabase.from('webstore_order_items').delete().eq('id', it.id);
      else await supabase.from('webstore_order_items').update({ size: it.size || null, qty: Number(it.qty) || 1 }).eq('id', it.id);
    }
    const remaining = edited.filter((i) => !i._removed);
    const subtotal = remaining.reduce((a, i) => a + (Number(i.unit_price) || 0) * (Number(i.qty) || 1), 0);
    const fundraise = remaining.reduce((a, i) => a + (Number(i.unit_fundraise) || 0) * (Number(i.qty) || 1), 0);
    const total = Math.max(0, subtotal + fundraise - (Number(order.discount_amt) || 0)) + (Number(order.shipping_fee) || 0);
    const { error } = await supabase.from('webstore_orders').update({ subtotal, fundraise_amt: fundraise, total }).eq('id', order.id);
    if (error) { flash('Save failed: ' + error.message); return { error }; }
    flash('Order updated'); loadDetail(sel); return { ok: true };
  }, [sel, flash, loadDetail]);

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
      const { data: live, error: readErr } = await supabase.from('webstore_orders').select('refunded_amt,total,status,stripe_pi_id').eq('id', order.id).single();
      if (readErr) { flash('Refund blocked: could not verify order — ' + readErr.message); return { error: readErr.message }; }
      const already = Number(live.refunded_amt) || 0;
      const total = Number(live.total) || 0;
      if (already + cents / 100 > total + 0.005) {
        flash(`Refund blocked: ${money(cents / 100)} would exceed the order total (${money(already)} already refunded of ${money(total)})`);
        return { error: 'over_refund' };
      }
      if (live.stripe_pi_id) {
        try {
          const res = await authFetch('/.netlify/functions/stripe-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refund', payment_intent_id: live.stripe_pi_id, amount_cents: cents }) });
          const d = await res.json();
          if (d.error) { flash('Stripe refund failed: ' + d.error); return { error: d.error }; }
        } catch (e) { flash('Refund failed: ' + e.message); return { error: e.message }; }
      }
      const refunded = already + cents / 100;
      const status = refunded >= total - 0.005 ? 'refunded' : live.status;
      const { error } = await supabase.from('webstore_orders').update({ refunded_amt: refunded, status }).eq('id', order.id);
      if (error) { flash('Refund record failed: ' + error.message); return { error: error.message }; }
      flash(live.stripe_pi_id ? `Refunded ${money(cents / 100)} to card` : `Recorded ${money(cents / 100)} credit`);
      loadDetail(sel); return { ok: true };
    } finally { refundingRef.current = false; }
  }, [sel, flash, loadDetail]);

  const createBundle = useCallback(async ({ name, price, fundraise, image_url, components }) => {
    const { data: bundle, error } = await supabase.from('webstore_products').insert({ store_id: sel.id, kind: 'bundle', display_name: name, retail_price: price, fundraise_amount: Number(fundraise) || 0, image_url: image_url || null, active: true, sort_order: (detail?.catalog?.length || 0) }).select().single();
    if (error) { flash('Error: ' + error.message); return; }
    if (components.length) {
      const rows = components.map((c, i) => ({ bundle_id: bundle.id, product_id: c.product_id, sku: c.sku, qty: c.qty || 1, size_required: c.size_required !== false, takes_number: !!c.takes_number, takes_name: !!c.takes_name, name_upcharge: Number(c.name_upcharge) || 0, transfer_code: c.transfer_code || null, num_transfer_size: c.takes_number ? c.num_transfer_size : null, num_transfer_color: c.takes_number ? c.num_transfer_color : null, sort_order: i }));
      const { error: e2 } = await supabase.from('webstore_bundle_items').insert(rows);
      if (e2) { flash('Bundle created but items failed: ' + e2.message); loadDetail(sel); return; }
    }
    flash('Package created'); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  // Gather this store's unbatched orders + their stock picture (shared by the
  // availability report and the batch flow's inventory check).
  const gatherBatch = useCallback(() => {
    const open = (detail?.orders || []).filter((o) => !o.so_id && o.status !== 'pending_payment' && o.status !== 'cancelled');
    const openIds = new Set(open.map((o) => o.id));
    const lines = (detail?.orderItems || []).filter((i) => openIds.has(i.order_id) && !i.is_bundle_parent);
    const stockByPid = {};
    (detail?.catalog || []).forEach((c) => { if (c.product_id && detail.stockByWp?.[c.id]) stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    const orderById = {}; open.forEach((o) => { orderById[o.id] = o; });
    return { open, openIds, lines, stockByPid, orderById };
  }, [detail]);

  // Open the printable availability ("FAFO") report for the pending batch.
  const availabilityReport = useCallback(() => {
    if (!sel || !detail) return;
    const { open, lines, stockByPid, orderById } = gatherBatch();
    if (!open.length) { flash('No unbatched orders to report'); return; }
    buildAvailabilityReport(sel, `${open.length} order${open.length === 1 ? '' : 's'}`, lines, stockByPid, orderById);
  }, [sel, detail, gatherBatch, flash]);

  // All valid (non-cancelled, non-pending) orders — the whole-store picture for
  // the player + stock reports (not just the unbatched ones the FAFO report uses).
  const gatherAll = useCallback(() => {
    const valid = (detail?.orders || []).filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled');
    const ids = new Set(valid.map((o) => o.id));
    const lines = (detail?.orderItems || []).filter((i) => ids.has(i.order_id) && !i.is_bundle_parent);
    const stockByPid = {};
    (detail?.catalog || []).forEach((c) => { if (c.product_id && detail.stockByWp?.[c.id]) stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    const orderById = {}; valid.forEach((o) => { orderById[o.id] = o; });
    return { valid, lines, stockByPid, orderById, roster: detail?.roster || [] };
  }, [detail]);

  // Per-player roll-up (printable): every player and exactly what they ordered.
  const playerReport = useCallback(() => {
    if (!sel || !detail) return;
    const { valid, lines, orderById, roster, stockByPid } = gatherAll();
    if (!valid.length) { flash('No orders yet'); return; }
    buildPlayerReport(sel, lines, orderById, roster, stockByPid);
  }, [sel, detail, gatherAll, flash]);

  // Store-close stock report (printable): fill-from-stock vs order-from-Adidas
  // vs backorder, split by vendor.
  const stockReport = useCallback(() => {
    if (!sel || !detail) return;
    const { valid, lines, stockByPid } = gatherAll();
    if (!valid.length) { flash('No orders yet'); return; }
    buildStockReport(sel, `${valid.length} order${valid.length === 1 ? '' : 's'}`, lines, stockByPid);
  }, [sel, detail, gatherAll, flash]);

  // CSV exports: 'players' (per-player line items), 'stock' (shortage split),
  // 'orders' (every line item with order + payment detail).
  const exportCsv = useCallback((kind) => {
    if (!sel || !detail) return;
    const { lines, orderById, stockByPid } = gatherAll();
    if (!lines.length) { flash('No orders yet'); return; }
    const slug = (sel.slug || sel.name || 'store').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
    if (kind === 'players') {
      const header = ['Player', 'Number', 'Item', 'SKU', 'Size', 'Qty', 'Buyer', 'Buyer Email', 'Order Date'];
      const rows = lines.map((i) => { const o = orderById[i.order_id] || {}; return [i.player_name || '', i.player_number != null ? String(i.player_number) : '', _itemName(i, stockByPid), i.sku || '', i.size || '', i.qty || 1, o.buyer_name || '', o.buyer_email || '', _csvDate(o.created_at)]; });
      downloadCsv(`${slug}-players.csv`, header, rows);
    } else if (kind === 'stock') {
      const header = ['Item', 'SKU', 'Size', 'Need', 'Ours', 'Adidas', 'Fill from ours', 'PO from Adidas', 'Backorder', 'On order'];
      const rows = aggStock(lines, stockByPid)
        .sort((a, b) => (b.backorder - a.backorder) || (b.poVendor - a.poVendor) || a.name.localeCompare(b.name))
        .map((r) => [r.name, r.sku, r.size, r.need, r.tracked ? r.ours : '', r.tracked ? r.vendor : '', r.fillOurs, r.poVendor, r.backorder, r.onOrder ? 'yes' : '']);
      downloadCsv(`${slug}-stock.csv`, header, rows);
    } else {
      const header = ['Order', 'Date', 'Status', 'Payment', 'Buyer', 'Email', 'Player', 'Number', 'Item', 'SKU', 'Size', 'Qty', 'Unit Price'];
      const rows = lines.map((i) => { const o = orderById[i.order_id] || {}; return [o.id || '', _csvDate(o.created_at), o.status || '', o.payment_mode || '', o.buyer_name || '', o.buyer_email || '', i.player_name || '', i.player_number != null ? String(i.player_number) : '', _itemName(i, stockByPid), i.sku || '', i.size || '', i.qty || 1, Number(i.unit_price) || 0]; });
      downloadCsv(`${slug}-orders.csv`, header, rows);
    }
  }, [sel, detail, gatherAll, flash]);

  // Batch all not-yet-batched orders into one Sales Order via the app's normal
  // SO creation path (onCreateSO), then link each order back to the new SO id.
  const batchOrders = useCallback(async () => {
    if (!sel || !detail || !onCreateSO) return;
    const open = (detail.orders || []).filter((o) => !o.so_id && o.status !== 'pending_payment' && o.status !== 'cancelled' && o.status !== 'refunded');
    if (!open.length) { flash('No unbatched orders to send'); return; }
    const openIds = new Set(open.map((o) => o.id));
    const lines = (detail.orderItems || []).filter((i) => openIds.has(i.order_id) && !i.is_bundle_parent);

    // Inventory check: compare demand for this batch against our warehouse +
    // Adidas vendor stock and surface any shortfalls before creating the SO.
    const stockByPid = {};
    (detail.catalog || []).forEach((c) => { if (c.product_id && detail.stockByWp?.[c.id]) stockByPid[c.product_id] = detail.stockByWp[c.id]; });
    const demand = {};
    lines.forEach((i) => { if (!i.product_id) return; const k = i.product_id + '|' + (i.size || 'OS'); demand[k] = (demand[k] || 0) + (i.qty || 1); });
    const shortages = [];
    Object.entries(demand).forEach(([k, q]) => {
      const [pid, size] = k.split('|'); const st = stockByPid[pid]; if (!st) return;
      const wh = Number((st.size_stock || {})[size]) || 0;
      const ven = Number((st.vendor_size_stock || {})[size]) || 0;
      const avail = wh + ven;
      if (q > avail) shortages.push(`• ${st.name || pid} ${size}: need ${q}, have ${avail} (${wh} ours + ${ven} Adidas)${(st.on_order_qty || st.vendor_eta) ? ' — more on order' : ''}`);
    });
    const head = `Create a Sales Order from ${open.length} order${open.length === 1 ? '' : 's'}?`;
    const msg = shortages.length ? `${head}\n\n⚠️ Inventory shortfalls for this batch:\n${shortages.join('\n')}\n\nThese may need a PO or backorder. Use "Availability report" to see who's affected.\n\nCreate the Sales Order anyway?` : head;
    if (!window.confirm(msg)) return;

    // Which products collect a number / name (from catalog singles + bundle components).
    const personalize = {};
    (detail.catalog || []).forEach((c) => { if (c.product_id) personalize[c.product_id] = { num: !!c.takes_number, name: !!c.takes_name }; });
    (detail.bundleItems || []).forEach((b) => { if (b.product_id) { const e = personalize[b.product_id] || { num: false, name: false }; personalize[b.product_id] = { num: e.num || !!b.takes_number, name: e.name || !!b.takes_name }; } });

    // Aggregate by product + size; build parallel number/name rosters per size
    // (one entry per garment unit) so they attach as real deco lines.
    const byProduct = {};
    lines.forEach((i) => {
      const pid = i.product_id || i.sku || 'unknown';
      if (!byProduct[pid]) byProduct[pid] = { product_id: i.product_id || null, sku: i.sku || '', sizes: {}, numbers: {}, names: {} };
      const g = byProduct[pid]; const sz = i.size || 'OS'; const q = i.qty || 1;
      const pdef = personalize[i.product_id] || {};
      g.sizes[sz] = (g.sizes[sz] || 0) + q;
      for (let u = 0; u < q; u++) {
        if (pdef.num) (g.numbers[sz] = g.numbers[sz] || []).push(i.player_number ? String(i.player_number) : '');
        if (pdef.name) (g.names[sz] = g.names[sz] || []).push(i.player_name || '');
      }
    });
    const pids = [...new Set(lines.map((i) => i.product_id).filter(Boolean))];
    const pinfo = {};
    if (pids.length) {
      const { data } = await supabase.from('products').select('id,sku,name,brand,color,nsa_cost,retail_price').in('id', pids);
      (data || []).forEach((p) => { pinfo[p.id] = p; });
    }
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
    const addArtFile = (rec) => { if (rec && rec.id && !soArtFiles.has(rec.id)) soArtFiles.set(rec.id, rec); };
    const cleanArt = (a) => { const { _srcLabel, _srcCustId, ...rest } = a; return rest; };
    const soItems = Object.values(byProduct).map((g) => {
      const info = pinfo[g.product_id] || {};
      const pdef = personalize[g.product_id] || {};
      const decorations = [];
      // Numbers / names attach as deco lines with the actual values (roster/names
      // keyed by size), NOT as free-text production notes.
      if (pdef.num && hasVals(g.numbers)) decorations.push({ kind: 'numbers', position: 'Back', num_method: 'screen_print', num_size: '6"', two_color: false, sell_override: null, custom_font_art_id: null, roster: g.numbers });
      if (pdef.name && hasVals(g.names)) decorations.push({ kind: 'names', position: 'Back Center', sell_override: null, sell_each: 6, cost_each: 3, names: g.names });
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
        decorations.push({ kind: 'art', art_file_id: artId, position: posOf(d), type: (lib && lib.deco_type) || 'screen_print', web_url: decoUrlForColor(d, info.color) || d.art_url || '', placement: d.placement || '', side: d.side || 'front', color_label: d.color_label || 'original', sell_override: 0, sell_each: 0, cost_each: 0 });
      });
      // Bundle/kit components: carry the component's heat-transfer logo to the SO
      // as a $0 art deco (it's baked into the package price) so production sees
      // which transfer to apply. One shared art file per transfer code.
      (bundleXfersByPid[g.product_id] ? [...bundleXfersByPid[g.product_id]] : []).forEach((code) => {
        const xId = 'xfer_' + code;
        addArtFile({ id: xId, name: 'Transfer: ' + (xferLabel[code] || code), deco_type: 'heat_press', web_logo_url: '', files: [], mockup_files: [], color_ways: [], status: 'approved', uploaded: new Date().toLocaleDateString() });
        decorations.push({ kind: 'art', art_file_id: xId, position: 'Front', type: 'heat_press', transfer_code: code, placement: 'full_front', side: 'front', color_label: 'original', sell_override: 0, sell_each: 0, cost_each: 0 });
      });
      return { sku: g.sku || info.sku || '', name: info.name || g.sku || 'Item', brand: info.brand || '', color: info.color || '',
        product_id: g.product_id || null, nsa_cost: info.nsa_cost || 0, retail_price: info.retail_price || 0, unit_sell: info.retail_price || 0,
        sizes: g.sizes, available_sizes: Object.keys(g.sizes), no_deco: decorations.length === 0, decorations, pick_lines: [], po_lines: [] };
    });

    const units = soItems.reduce((a, i) => a + Object.values(i.sizes).reduce((b, v) => b + v, 0), 0);
    const notes = `Webstore: ${sel.name} (/shop/${sel.slug})\n${open.length} orders · ${units} units · delivery: ${sel.delivery_mode === 'deliver_club' ? 'deliver to club' : 'ship to home'}\nNames & numbers are on each item's deco lines.`;

    // await — onCreateSO now persists the SO and only resolves an id once it's
    // confirmed saved, so we never tag orders to an SO that doesn't exist yet.
    const soId = await onCreateSO({ customer_id: sel.customer_id, memo: `${sel.name} webstore — ${open.length} orders`, production_notes: notes, items: soItems, webstore_id: sel.id, art_files: [...soArtFiles.values()] });
    if (!soId) { flash('Could not create the Sales Order — orders were not batched. Please try again.'); return; }
    const { error } = await supabase.from('webstore_orders').update({ so_id: soId, status: 'batched' }).in('id', [...openIds]);
    if (error) flash(`SO ${soId} created, but linking failed: ${error.message}`);
    else flash(`Created ${soId} · linked ${open.length} orders`);
    loadDetail(sel);
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

      {editing ? (
        <StoreForm cust={cust} REPS={REPS} repCsr={repCsr} store={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={async (form) => { const r = await saveStore(form, editing === 'new' ? null : editing.id); if (r.error) return r; setEditing(null); return r; }} />
      ) : sel ? (
        <StoreDetail store={sel} detail={detail} loading={detailLoading} tab={tab} setTab={setTab} cu={cu}
          custName={custName} repName={repName} standardCategories={wsSettings?.standard_categories || []}
          onBack={() => { setSel(null); setDetail(null); }}
          onEdit={() => setEditing(sel)} onOpenSO={onOpenSO} onSetStatus={setStoreStatus}
          onAddSingle={addSingle} onAddColors={addColorsToItem} onAddFits={addFitsToItem} onCopyItem={copyToNewItem} onAddMany={addManyFromList} onApplyTemplate={applyTemplate} onApplyTemplateColors={applyTemplateColors} onPriceToMargin={priceAllToMargin} onCreateBundle={createBundle} onRemove={removeCatalogItem} onRemoveGroup={removeGroup} onUpdateImage={updateImage} onUpdateCost={updateProductCost} onBatch={batchOrders} onAvailabilityReport={availabilityReport} onPlayerReport={playerReport} onStockReport={stockReport} onExportCsv={exportCsv} onReorder={reorderItem} onMove={moveItem} onUpdateItem={updateCatalogItem}
          onUpdateTransfer={updateTransfer} onAddTransfers={addTransfers} onRemoveTransfer={removeTransfer} onPullTransfers={pullBatchTransfers}
          onCreateCoupons={createCoupons} onUpdateCoupon={updateCoupon} onRemoveCoupon={removeCoupon}
          onSaveOrderEdits={saveOrderEdits} onRefundOrder={refundOrder}
          onApplyLogo={applyLogoToItems} onSetItemDecorations={setItemDecorations} onSaveArtVariant={saveArtVariant} onSaveMocks={saveStoreMocks} onAddStoreLogo={addStoreLogo} onSaveStoreArt={saveStoreArt} onAttachWebLogo={attachArtPreview} onFlash={flash}
          portalUrl={coachPortalUrl(sel)} onEmailDirector={() => emailDirector(sel)} onFlyer={() => openFlyer(sel)} />
      ) : (
        <ListView stores={stores} custName={custName} repName={repName} onOpen={openStore} onNew={() => setEditing('new')} onDuplicate={duplicateStore} onToggleTemplate={toggleTemplate} onNewFromTemplate={(t) => duplicateStore(t, { suffix: '' })} onStoreDefaults={() => setShowDefaults(true)} />
      )}
    </>
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

function ListView({ stores, custName, repName, onOpen, onNew, onDuplicate, onToggleTemplate, onNewFromTemplate, onStoreDefaults }) {
  const templates = stores.filter((s) => s.is_template);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>{stores.length} store{stores.length === 1 ? '' : 's'}{templates.length > 0 ? ` · ${templates.length} template${templates.length === 1 ? '' : 's'}` : ''}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onNewFromTemplate && templates.length > 0 && (
            <select className="form-input" style={{ maxWidth: 230, fontSize: 13 }} value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) onNewFromTemplate(t); e.target.value = ''; }}>
              <option value="">+ New from template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {onStoreDefaults && <button className="btn btn-secondary" onClick={onStoreDefaults} title="Standard categories, checkout copy & default add-on options for all stores">⚙ Store defaults</button>}
          <button className="btn btn-primary" onClick={onNew}>+ New Store</button>
        </div>
      </div>
      {stores.length === 0 ? (
        <div className="card"><div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          No webstores yet. Click <b>+ New Store</b> to create the first one.
        </div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {stores.map((s) => {
            const fmt = (d) => { if (!d) return null; const x = new Date(d); return isNaN(x) ? null : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
            const window_ = fmt(s.open_at) || fmt(s.close_at) ? `${fmt(s.open_at) || 'now'} → ${fmt(s.close_at) || 'open'}` : 'No close date';
            const pay = s.payment_mode === 'either' ? 'Paid + Invoice' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only';
            const deliver = s.delivery_mode === 'deliver_club' ? 'Deliver to club' : 'Ship to home';
            const coachReview = s.created_via === 'coach' && s.status === 'draft';
            return (
              <div key={s.id} className="card" style={{ cursor: 'pointer', width: '100%', borderLeft: coachReview ? '3px solid #f59e0b' : undefined }} onClick={() => onOpen(s)}>
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 220, flex: '1 1 240px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 17, fontWeight: 800, color: '#1e293b' }}>{s.name}</span>
                      <StatusBadge status={s.status} />
                      {s.is_template && <Chip label="Template" tone="blue" />}
                      {s.created_via === 'coach' && <Chip label={coachReview ? '★ Coach submission — review' : 'Coach-built'} tone="amber" />}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)}</div>
                  </div>
                  <Quick label="Storefront"><a href={'/shop/' + s.slug} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'monospace', fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>/shop/{s.slug} ↗</a></Quick>
                  <Quick label="Payment">{pay}</Quick>
                  <Quick label="Delivery">{deliver}</Quick>
                  <Quick label="Numbers">{s.number_enabled ? (s.number_unique ? 'Unique #s' : 'On') : '—'}</Quick>
                  <Quick label="Sale window">{window_}</Quick>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {onToggleTemplate && <button className="btn btn-sm btn-secondary" title={s.is_template ? 'Remove from templates' : 'Save as a reusable template'} onClick={(e) => { e.stopPropagation(); onToggleTemplate(s); }}>{s.is_template ? '★ Template' : '☆ Template'}</button>}
                    {onDuplicate && <button className="btn btn-sm btn-secondary" title="Exact copy of this store as a new draft" onClick={(e) => { e.stopPropagation(); onDuplicate(s); }}>Duplicate</button>}
                    {onDuplicate && <button className="btn btn-sm btn-secondary" title="Copy this store for a new team, then open settings to swap the customer, colors & logo" onClick={(e) => { e.stopPropagation(); onDuplicate(s, { rebrand: true }); }}>Clone &amp; rebrand</button>}
                    <span style={{ color: '#cbd5e1', fontSize: 20 }}>›</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  size_upcharge_enabled: true,
  public_listed: true,
  decoration_mode: 'in_house',
  theme: 'classic', primary_color: '#0f172a', accent_color: '#2563eb', logo_url: '', banner_url: '', hero_blurb: '',
  featured_product_ids: null,
};
// Trim a timestamptz to the yyyy-mm-dd a <input type=date> expects.
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
function StoreForm({ store, cust, REPS, repCsr = [], onCancel, onSave }) {
  const [f, setF] = useState(() => ({ ...BLANK, ...(store || {}), open_at: dateOnly(store?.open_at), close_at: dateOnly(store?.close_at) }));
  const [slugTouched, setSlugTouched] = useState(!!store);
  // Once the name is hand-edited we stop auto-naming from the linked customer.
  const [nameTouched, setNameTouched] = useState(!!(store && store.name));
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
    supabase.from('webstore_storefront_products')
      .select('webstore_product_id,name,image_front_url,category,kind,sort_order')
      .eq('store_id', store.id).order('sort_order')
      .then(({ data }) => { if (live) setFeatProducts((data || []).filter((p) => p.kind !== 'bundle')); });
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
    if (uploading > 0) return setError('Hold on — an image is still uploading. It’ll just be a moment.');
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
          <div style={{ color: '#6A7180', fontSize: 13, marginTop: 4 }}>{store ? 'Update this store’s setup.' : 'Set it up here — add products and artwork after it’s created.'}</div>
        </div>
        <div style={{ display: 'inline-flex', background: '#eef0f3', borderRadius: 10, padding: 3 }} role="tablist" aria-label="Store type">
          {['team', 'club'].map((t) => (
            <button key={t} type="button" onClick={() => switchOrg(t)} style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', background: orgType === t ? '#fff' : 'transparent', color: orgType === t ? '#191919' : '#6A7180', boxShadow: orgType === t ? '0 1px 2px rgba(0,0,0,.10)' : 'none' }}>{t}</button>
          ))}
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
          <option value="deliver_club">{`Deliver to ${noun.toLowerCase()} — ships to the ${noun.toLowerCase()}’s default address`}</option>
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
                          </button>
                        );
                      })}
                    </div>
                  </>
              )}
            </div>
          );
        })()}
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

function StoreDetail({ store: s, detail, loading, tab, setTab, cu, custName, repName, standardCategories = [], onBack, onEdit, onOpenSO, onSetStatus, onAddSingle, onAddColors, onAddFits, onCopyItem, onAddMany, onApplyTemplate, onApplyTemplateColors, onPriceToMargin, onCreateBundle, onRemove, onRemoveGroup, onUpdateImage, onUpdateCost, onBatch, onAvailabilityReport, onPlayerReport, onStockReport, onExportCsv, onReorder, onMove, onUpdateItem, onUpdateTransfer, onAddTransfers, onRemoveTransfer, onPullTransfers, onCreateCoupons, onUpdateCoupon, onRemoveCoupon, onSaveOrderEdits, onRefundOrder, onApplyLogo, onSetItemDecorations, onSaveArtVariant, onSaveMocks, onAddStoreLogo, onSaveStoreArt, onAttachWebLogo, onFlash, portalUrl, onEmailDirector, onFlyer }) {
  const [portalCopied, setPortalCopied] = useState(false);
  const [showMock, setShowMock] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const copyPortal = () => { if (!portalUrl) return; navigator.clipboard?.writeText(portalUrl); setPortalCopied(true); setTimeout(() => setPortalCopied(false), 1800); };
  const orders = detail?.orders || [];
  const orderItems = detail?.orderItems || [];
  const catalog = detail?.catalog || [];
  const roster = detail?.roster || [];
  const bundleItems = detail?.bundleItems || [];
  const stockByWp = detail?.stockByWp || {};

  const totalSales = orders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const fundraiseTotal = orders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const playerCount = new Set(orderItems.map((i) => (i.player_name || '').trim().toLowerCase()).filter(Boolean)).size;
  const notOrdered = roster.filter((r) => !r.ordered);
  // Sales Orders created from this store's batches, with how many orders each covers.
  const soSummary = (() => {
    const m = {};
    orders.forEach((o) => { if (o.so_id) m[o.so_id] = (m[o.so_id] || 0) + 1; });
    return Object.entries(m).map(([id, count]) => ({ id, count }));
  })();

  // Primary tabs stay visible; the rest tuck into a "More ▾" menu. Store settings
  // live behind the header ⚙ Settings button (the rich editor), not a tab.
  const PRIMARY_TABS = [
    { id: 'catalog', label: `Catalog (${catalog.length})` },
    { id: 'orders', label: `Orders (${orders.length})` },
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
  const qmGarments = catalog.filter((c) => c.kind === 'single').map((c) => { const st = stockByWp[c.id] || {}; return { key: (c.sku || '') + '|' + (st.color || ''), sku: c.sku, color: st.color || '', name: c.display_name || st.name || c.sku, frontUrl: c.image_url || st.image_front_url || '', backUrl: st.image_back_url || '' }; });
  const qmLocations = _qmArt.map((a) => {
    const urls = [a.preview_url, ...((a.mockup_files || []).map(_qmU)), ...((a.files || []).map(_qmU))].filter(Boolean);
    const files = []; const seen = new Set();
    urls.forEach((u) => { if (!u || seen.has(u) || !_qmIsImg(u)) return; seen.add(u); files.push({ name: (u.split('/').pop() || 'art').split('?')[0], url: u, preview: { url: u } }); });
    return { artFileId: a.id, name: a.name || 'Logo', position: '', existingFiles: (a.files || []), files, preview: files[0] ? files[0].preview : null, garmentKeys: [] };
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
            (s.director_email || s.coach_contact_email)
              ? { label: 'Email store link', icon: '✉️', title: `Email the launch link + QR to ${s.director_email || s.coach_contact_email}`, onClick: onEmailDirector }
              : { label: 'Email store link', icon: '✉️', title: 'Add a coach/director email in Settings first', disabled: true },
          ]} />
          {onSetStatus && (s.status !== 'open'
            ? <button className="btn btn-sm" style={{ background: '#166534', color: '#fff', fontWeight: 700 }} onClick={() => setLaunchOpen(true)} title="Make this store live for shoppers">🚀 Launch store</button>
            : <button className="btn btn-sm btn-secondary" onClick={() => onSetStatus(s, 'closed')} title="Stop taking orders">Close store</button>)}
          <button className="btn btn-sm btn-primary" onClick={onEdit}>⚙ Settings</button>
        </div>
      </div>
      {launchOpen && <LaunchStoreModal store={s} onClose={() => setLaunchOpen(false)} onLaunch={(opts) => { onSetStatus(s, 'open', opts); setLaunchOpen(false); }} />}

      {(() => {
        const primary = s.primary_color || '#192853';
        const accent = s.accent_color || '#962C32';
        const stripes = 'repeating-linear-gradient(-55deg, transparent 0 22px, rgba(255,255,255,0.05) 22px 44px)';
        const BannerStat = ({ label, value }) => <div><div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 4 }}>{label}</div></div>;
        return (
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, marginBottom: 12, background: `linear-gradient(120deg, ${primary} 0%, ${shadeHex(primary, -24)} 100%)`, borderBottom: `3px solid ${accent}`, boxShadow: '0 2px 14px rgba(11,18,32,.14)' }}>
            <div aria-hidden style={{ position: 'absolute', inset: 0, background: stripes, pointerEvents: 'none' }} />
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 18px', color: '#fff' }}>
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
              <div style={{ display: 'flex', gap: 22, textAlign: 'right', flexShrink: 0 }}>
                <BannerStat label="Orders" value={orders.length} />
                <BannerStat label="Players" value={playerCount} />
                <BannerStat label="Sales" value={money(totalSales)} />
                {fundraiseTotal > 0 && <BannerStat label="Fundraising" value={money(fundraiseTotal)} />}
              </div>
            </div>
          </div>
        );
      })()}

      {soSummary.length > 0 && <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sales Orders created</span>
        {soSummary.map((so) => (
          <button key={so.id} onClick={() => onOpenSO && onOpenSO(so.id)} title="Open in Sales Orders"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>
            {so.id} <span style={{ fontFamily: 'inherit', fontWeight: 500, color: '#64748b' }}>· {so.count} order{so.count === 1 ? '' : 's'} ↗</span>
          </button>
        ))}
      </div></div>}

      {tab !== 'catalog' && <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>{tabsButtons}</div>}

      {loading && !detail ? <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}>Loading store details…</div> : (
        <>
          {tab === 'catalog' && <CatalogTab tabsNode={tabsButtons} catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} costByPid={detail?.costByPid || {}} transfers={detail?.transfers || []} isTeam={(s.org_type || 'team') !== 'club'} library={s.store_art || []} storeColors={detail?.storeColors || []} storeFund={{ enabled: !!s.fundraise_enabled, pct: Number(s.fundraise_pct) || 0, flat: Number(s.fundraise_flat) || 0, round: !!s.fundraise_round }} onApplyLogo={onApplyLogo} onSaveLogo={onAddStoreLogo} onAddSingle={onAddSingle} onAddColors={onAddColors} onAddFits={onAddFits} onCopyItem={onCopyItem} onAddMany={onAddMany} onApplyTemplate={onApplyTemplate} onApplyTemplateColors={onApplyTemplateColors} standardCategories={standardCategories} onPriceToMargin={onPriceToMargin} onCreateBundle={onCreateBundle} onRemove={onRemove} onRemoveGroup={onRemoveGroup} onUpdateImage={onUpdateImage} onUpdateCost={onUpdateCost} onReorder={onReorder} onMove={onMove} onUpdateItem={onUpdateItem} />}
          {tab === 'art' && <ArtTab catalog={catalog} stockByWp={stockByWp} decorationMode={s.decoration_mode || 'in_house'} libraryArt={detail?.libraryArt || []} storeArt={s.store_art || []} onSaveStoreArt={onSaveStoreArt} onSaveLogo={onAddStoreLogo} onAttachWebLogo={onAttachWebLogo} onApplyLogo={onApplyLogo} onSetItemDecorations={onSetItemDecorations} onSaveArtVariant={onSaveArtVariant} canMock={qmGarments.length > 0 && _qmArt.length > 0} onOpenMockBuilder={() => setShowMock(true)} />}
          {tab === 'orders' && <OrdersTab orders={orders} orderItems={orderItems} numbersEnabled={s.number_enabled} onBatch={onBatch} onAvailabilityReport={onAvailabilityReport} onPlayerReport={onPlayerReport} onStockReport={onStockReport} onExportCsv={onExportCsv} availSizes={availSizes} onSaveOrderEdits={onSaveOrderEdits} onRefundOrder={onRefundOrder} cu={cu} store={s} msgTagIds={[s.csr_id || s.rep_id].filter(Boolean)} />}
          {tab === 'batches' && <BatchesTab store={s} productStock={productStock} onOpenSO={onOpenSO} catalog={catalog} bundleItems={bundleItems} orders={orders} orderItems={orderItems} transfers={detail?.transfers || []} onPullTransfers={onPullTransfers} />}
          {tab === 'inventory' && <InventoryTab catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} transfers={detail?.transfers || []} orders={orders} orderItems={orderItems} onUpdateTransfer={onUpdateTransfer} onAddTransfers={onAddTransfers} onRemoveTransfer={onRemoveTransfer} />}
          {tab === 'coupons' && <CouponsTab store={s} coupons={detail?.coupons || []} orders={orders} onCreate={onCreateCoupons} onUpdate={onUpdateCoupon} onRemove={onRemoveCoupon} />}
          {tab === 'analytics' && <AnalyticsTab orders={orders} orderItems={orderItems} stockByWp={stockByWp} />}
          {tab === 'roster' && <RosterTab roster={roster} notOrdered={notOrdered} />}
          {tab === 'settings' && <SettingsTab store={s} />}
        </>
      )}
      {showMock && <QuickMockBuilder garments={qmGarments} locations={qmLocations} initialMocks={qmInitialMocks} initialScene={qmInitialScene} nf={(m) => onFlash && onFlash(m)}
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

function CatalogTab({ tabsNode, catalog, bundleItems, stockByWp, costByPid = {}, transfers = [], isTeam = false, library = [], storeColors = [], storeFund = {}, standardCategories = [], onApplyLogo, onSaveLogo, onAddSingle, onAddColors, onAddFits, onCopyItem, onAddMany, onApplyTemplate, onApplyTemplateColors, onPriceToMargin, onCreateBundle, onRemove, onRemoveGroup, onUpdateImage, onUpdateCost, onReorder, onMove, onUpdateItem }) {
  const [mode, setMode] = useState(null); // null | 'single' | 'bundle'
  const [pending, setPending] = useState(null); // picked product awaiting price + fundraise
  const [editId, setEditId] = useState(null); // catalog row being edited inline
  const [pendingOpenPid, setPendingOpenPid] = useState(null); // product just created — open its card once it lands
  const [newCats, setNewCats] = useState([]);  // categories added via "+ Category" but not yet holding items
  const [overCat, setOverCat] = useState(null); // category section being dragged over
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
    for (const [k, rows] of byKey) { const rep = rows.find((r) => r.id === k) || rows[0]; groups.push({ key: k, rep, rows }); }
    groups.sort((a, b) => (a.rep.sort_order || 0) - (b.rep.sort_order || 0));
  }
  const repsList = groups.map((g) => g.rep);
  const colorsForRep = (repId) => (groups.find((g) => g.rep.id === repId)?.rows) || [];
  // Up/down on a card moves the whole group (by its representative) past the next card.
  const moveRep = (i, dir) => { const p = repsList[i]; if (!p) return; if (dir === 'up' && i > 0) onMove(p, repsList[i - 1].id); else if (dir === 'down' && i < repsList.length - 1) onMove(p, repsList[i + 2] ? repsList[i + 2].id : null); };

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
  const renderRep = ({ rep: p, rows: colorRows }) => {
    const stock = stockByWp[p.id];
    const label = p.display_name || stock?.name || p.sku || '(unnamed)';
    const fund = Number(p.fundraise_amount) || 0;
    const effFund = p.kind === 'bundle' ? fund : effectiveFundraise(p.retail_price, fund, storeFund);
    const sel = editId === p.id;
    const margin = (p.kind !== 'bundle' && costByPid[p.product_id] != null) ? (Number(p.retail_price) || 0) - costByPid[p.product_id] : null;
    const nColors = colorRows.length;
    return (
      <div key={p.id} onClick={() => setEditId(p.id)}
        onDragOver={(e) => onRowDragOver(e, p)} onDrop={(e) => onRowDrop(e, p)} onDragEnd={() => { setDragId(null); setOverId(null); setOverCat(null); }}
        style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '9px 12px', cursor: 'pointer',
          borderLeft: sel ? '3px solid #191919' : '3px solid transparent',
          background: sel ? '#f1f5f9' : '#fff',
          borderTop: dragId && dragId !== p.id && overId === p.id && overPos === 'before' ? '2px solid #191919' : '1px solid #f4f6f9',
          borderBottom: dragId && dragId !== p.id && overId === p.id && overPos === 'after' ? '2px solid #191919' : undefined,
          opacity: dragId === p.id ? 0.4 : 1 }}>
        <span draggable onClick={(e) => e.stopPropagation()} onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; }} title="Drag to reorder, or onto a category" style={{ cursor: 'grab', color: '#cbd5e1', fontSize: 14, userSelect: 'none' }}>⠿</span>
        <div style={{ width: 42, height: 42, borderRadius: 7, background: '#f4f6f9', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {(p.image_url || stock?.image_front_url) ? <img src={p.image_url || stock?.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#cbd5e1' }}>—</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}{p.kind === 'bundle' ? <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 700 }}> · pkg</span> : null}{nColors > 1 ? <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 700 }}> · {nColors} {colorRows.some((c) => c.variant_label) ? 'fits' : 'colors'}</span> : null}</div>
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
          { label: 'Create a package', icon: '📦', onClick: () => { setMode('bundle'); setPending(null); } },
          { label: 'Build with AI', icon: '✨', onClick: () => { setMode('ai'); setPending(null); } },
        ]} />
        <MenuButton label="Tools" items={[
          { label: 'Price to margin', icon: '💲', onClick: () => { setMode('margin'); setPending(null); } },
          (view === 'table') && { label: expandAll ? 'Collapse all sizes' : 'Expand all sizes', icon: '↕', onClick: () => { setExpandAll((v) => !v); setOpenRows(new Set()); } },
        ]} />
        <div style={{ marginLeft: 'auto', display: 'inline-flex', background: '#eef0f3', borderRadius: 9, padding: 3 }} title="Switch how the catalog is laid out">
          {[['split', '▥ Side-by-side'], ['table', '☰ List + popup']].map(([v, lbl]) => (
            <button key={v} type="button" onClick={() => { if (v === 'table') setEditId(null); setView(v); }} style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 800, background: view === v ? '#fff' : 'transparent', color: view === v ? '#191919' : '#6A7180', boxShadow: view === v ? '0 1px 2px rgba(0,0,0,.10)' : 'none' }}>{lbl}</button>
          ))}
        </div>
      </div>

      {mode === 'single' && !pending && <ProductPicker label="Add products to this store" storeColors={storeColors} storeFund={storeFund} library={library} catalog={catalog} standardCategories={standardCategories} onSaveLogo={onSaveLogo} onPick={(p) => setPending(p)} onPickMany={async (prods, decorations, cfg = {}) => { const hasPrice = cfg.price !== undefined && cfg.price !== '' && cfg.price !== null; for (const pr of prods) await onAddSingle({ product: pr, price: hasPrice ? cfg.price : pr.retail_price, fundraise: cfg.fundraise || 0, image_url: null, takes_number: !!cfg.takes_number, takes_name: !!cfg.takes_name, name_upcharge: cfg.name_upcharge || 0, transfer_codes: [], num_transfer_sets: [], category: cfg.category || null, kit_name: cfg.kit_name || null, required: !!cfg.required, options: cfg.options || [], decorations: decorations || [] }); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'ai' && <AiStoreBuilder onAddProducts={async (prods) => { for (const pr of prods) await onAddSingle({ product: pr, price: pr.retail_price, fundraise: 0, image_url: null, takes_number: false, takes_name: false, name_upcharge: 0, transfer_codes: [], num_transfer_sets: [] }); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'import' && <SkuImporter existingPids={new Set((catalog || []).map((c) => c.product_id).filter(Boolean))} storeFund={storeFund} onAddMany={onAddMany} onClose={() => setMode(null)} />}
      {mode === 'template' && <TemplateGallery catalog={catalog} stockByWp={stockByWp} existingPids={new Set((catalog || []).map((c) => c.product_id).filter(Boolean))} onApply={async (tpl) => { await onApplyTemplate(tpl); setMode(null); }} onApplyColors={async (plan) => { await onApplyTemplateColors(plan); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'custom' && <CustomProductCreator library={library} catSuggestions={[...new Set([...(catalog || []).map((c) => c.category).filter(Boolean), 'Tees', 'Hoods', 'Crew', 'Polos', 'Shorts', 'Pants', 'Outerwear', 'Jersey', 'Hats', 'Bags', 'Socks'])]} onClose={() => setMode(null)} onCreated={async (product, alsoAdd, decorations) => { if (alsoAdd && onAddSingle) { await onAddSingle({ product, price: product.retail_price, fundraise: 0, image_url: product.image_front_url || null, takes_number: false, takes_name: false, name_upcharge: 0, transfer_codes: [], num_transfer_sets: [], decorations: decorations || [] }); setPendingOpenPid(product.id); } setMode(null); }} />}
      {mode === 'margin' && <PriceToMarginModal catalog={catalog} costByPid={costByPid} onApply={(pct) => { onPriceToMargin && onPriceToMargin(pct); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'single' && pending && <SinglePriceEditor product={pending} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} library={library} storeFund={storeFund} onSaveLogo={onSaveLogo} onCancel={() => setPending(null)} onAdd={async ({ products, ...rest }) => { for (let i = 0; i < (products || []).length; i++) await onAddSingle({ ...rest, product: products[i], image_url: i === 0 ? rest.image_url : null }); setMode(null); setPending(null); }} />}
      {mode === 'bundle' && <BundleBuilder designOptions={designOptions} numberSets={numberSets} storeItems={ordered.filter((c) => c.kind === 'single').map((c) => ({ product_id: c.product_id, sku: c.sku, name: c.display_name || stockByWp[c.id]?.name || c.sku }))} onCreate={(b) => { onCreateBundle(b); setMode(null); }} onClose={() => setMode(null)} />}

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
                <div key={sec.cat || '__unc'} onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverCat(sec.cat); } }} onDrop={(e) => { e.preventDefault(); dropToCat(sec.cat); }}
                  style={{ boxShadow: overCat === sec.cat && dragId ? 'inset 0 0 0 2px #93c5fd' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: overCat === sec.cat && dragId ? '#dbeafe' : '#f8fafc', borderBottom: '1px solid #eef0f3', borderTop: '1px solid #eef0f3', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: sec.cat ? '#334155' : '#94a3b8' }}>
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
                    <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{p.display_name || stock?.name || p.sku}{groupColors.length > 1 ? <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}> · {groupColors.length} {groupColors.some((c) => c.variant_label) ? 'fits' : 'colors'}</span> : null}</div>
                    {p.kind !== 'bundle' && <div style={{ display: 'flex', gap: 2 }}>
                      {[['details', '1 · Item setup'], ['art', '2 · Art & colors']].map(([k, lbl]) => { const on = paneTab === k; return (
                        <button key={k} type="button" onClick={() => setPaneTab(k)} style={{ background: 'none', border: 'none', borderBottom: '2px solid ' + (on ? '#191919' : 'transparent'), color: on ? '#191919' : '#94a3b8', fontWeight: 800, fontSize: 12.5, padding: '4px 10px', cursor: 'pointer' }}>{lbl}</button>
                      ); })}
                    </div>}
                    {onCopyItem && <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} title="Duplicate this item — image, price, art & options all copied" onClick={() => onCopyItem(p)}>⧉ Copy</button>}
                    <button className="btn btn-sm btn-secondary" style={{ marginLeft: onCopyItem ? 0 : 'auto', color: '#b91c1c' }} onClick={() => onRemoveGroup(groupColors.map((r) => r.id), p.display_name || stock?.name || p.sku)}>Remove</button>
                  </div>
                  <div style={{ padding: 14 }}>
                    {p.kind !== 'bundle' && paneTab === 'details' && onAddFits && <FitManager item={p} fits={groupColors} stockByWp={stockByWp} onAttach={async (pr) => { await onAddFits(p, [{ product: pr, label: '' }]); }} onLabel={(id, label) => onUpdateItem(id, { variant_label: label || null })} onRemoveFit={(id, nm) => onRemove(id, nm)} />}
                    <CatalogItemEditor key={p.id} item={p} groupColors={groupColors} page={paneTab} setPage={setPaneTab} defaultName={stock?.name} stockImg={stock?.image_front_url} stockBackImg={stock?.image_back_url} availableSizes={stock?.available_sizes || []} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} library={library} storeColors={storeColors} catalog={catalog} standardCategories={standardCategories} stockByWp={stockByWp} costByPid={costByPid} storeFund={storeFund} onApplyLogo={onApplyLogo} onAddSingle={onAddSingle} onAddColors={onAddColors} onCopyItem={onCopyItem} onRemoveColor={onRemove} onSaveLogo={onSaveLogo} onUpdateCost={onUpdateCost} onCancel={() => setEditId(null)} onSave={(fields) => { onUpdateItem(p.id, fields); }} />
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
                        <CatalogItemEditor key={p.id} item={p} groupColors={colorRows} defaultName={stock?.name} stockImg={stock?.image_front_url} stockBackImg={stock?.image_back_url} availableSizes={stock?.available_sizes || []} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} library={library} storeColors={storeColors} catalog={catalog} standardCategories={standardCategories} stockByWp={stockByWp} costByPid={costByPid} storeFund={storeFund} onApplyLogo={onApplyLogo} onAddSingle={onAddSingle} onAddColors={onAddColors} onCopyItem={onCopyItem} onRemoveColor={onRemove} onSaveLogo={onSaveLogo} onUpdateCost={onUpdateCost} onCancel={() => setEditId(null)} onSave={(fields) => { onUpdateItem(p.id, fields); }} />
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
    try { await onApply([...picked], { ...deco }); setPicked(new Set()); setOpen(false); }
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

function LogoPlacer({ imageUrl, decorations, onChange, library = [], onSaveLogo, backImageUrl, stockBackImg, onBackImageChange, storeColors = [], siblings = [], onApplyToItems, takesNumber = false, takesName = false }) {
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
  const frontUrl = imageUrl;
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
  const currentOnSide = current && sideOf(current) === side;
  const shown = decos.map((d, i) => ({ d, i })).filter(({ d }) => sideOf(d) === side);
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
          {decos.map((d, i) => (sideOf(d) === side ? (
            <div key={i}
              onPointerDown={(e) => { e.preventDefault(); setSel(i); drag.current = { i, mode: 'move' }; }}
              style={{ position: 'absolute', left: `${coord(d, 'x')}%`, top: `${coord(d, 'y')}%`, width: `${coord(d, 'w')}%`, transform: 'translate(-50%,-50%)', cursor: 'move', outline: i === sel ? '2px solid #2563eb' : 'none', outlineOffset: 1, touchAction: 'none' }}>
              <img src={d.art_url} alt="" draggable={false} style={{ display: 'block', width: '100%', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))' }} />
              {i === sel && <div onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setSel(i); drag.current = { i, mode: 'resize' }; }} title="Drag to resize" style={{ position: 'absolute', right: -8, bottom: -8, width: 16, height: 16, borderRadius: 4, background: '#2563eb', border: '2px solid #fff', cursor: 'nwse-resize', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />}
            </div>
          ) : null))}
          {side === 'back' && <PersoMock takesNumber={takesNumber} takesName={takesName} />}
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
function ItemSection({ title, hint, right, children, pad = 14 }) {
  return (
    <div style={{ border: '1px solid #e8ebf0', borderRadius: 12, padding: pad, marginBottom: 14, background: '#fff' }}>
      {(title || right) && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}{hint && <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#94a3b8', marginLeft: 8 }}>{hint}</span>}</div>
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
const decoUrlForColor = (deco, colorName) => {
  if (!deco) return '';
  const m = deco.cw_by_color; const k = colorKeyOf(colorName);
  return (m && k && m[k]) || deco.art_url || '';
};
// Read-only garment thumbnail with the placed FRONT logos composited at their saved
// placement — previews each color of a multi-color card with its art (and per-color web
// logo) applied. Mirrors the LogoPlacer hero-canvas math (x/y center %, w = width %).
function GarmentLogoPreview({ imageUrl, decorations = [], colorName }) {
  const front = (decorations || []).filter((d) => (d.side || 'front') !== 'back' && decoUrlForColor(d, colorName));
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '4/5', borderRadius: 6, overflow: 'hidden', background: '#f4f6f9' }}>
      {imageUrl && <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      {front.map((d, i) => { const p = placementById(d.placement); const x = d.x != null ? d.x : p.x, y = d.y != null ? d.y : p.y, w = d.w != null ? d.w : p.w; return (
        <img key={i} src={decoUrlForColor(d, colorName)} alt="" draggable={false} style={{ position: 'absolute', left: x + '%', top: y + '%', width: w + '%', transform: 'translate(-50%,-50%)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))' }} />
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
    <ItemSection title="Sizes / fits (alternate SKUs)" hint="· same jersey in another cut — each fit is its own SKU, shown as its own size row in the store"
      right={onAttach ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Add a fit'}</button> : null}>
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

function CatalogItemEditor({ item, groupColors = [], page: pageProp, setPage: setPageProp, defaultName, stockImg, stockBackImg, availableSizes = [], designOptions = [], numberSets = [], isTeam = false, library = [], storeColors = [], catalog = [], standardCategories = [], stockByWp = {}, costByPid = {}, storeFund = {}, onApplyLogo, onAddSingle, onAddColors, onCopyItem, onRemoveColor, onSaveLogo, onUpdateCost, onCancel, onSave }) {
  const isBundle = item.kind === 'bundle';
  // Other single items on this store, for "apply this logo to other items".
  const siblings = (catalog || []).filter((c) => c.kind === 'single' && c.id !== item.id).map((c) => ({ id: c.id, name: c.display_name || (stockByWp[c.id] && stockByWp[c.id].name) || c.sku, img: c.image_url || (stockByWp[c.id] && stockByWp[c.id].image_front_url) }));
  const [image, setImage] = useState(item.image_url || null);
  const [backImage, setBackImage] = useState(item.image_back_url || null);
  const [decorations, setDecorations] = useState(Array.isArray(item.decorations) ? item.decorations : []);
  // Per-color web-logo override: set/clear the web logo a given garment color uses for a
  // placed deco (so a black tee can wear the white logo, a white tee the dark one). Empty
  // url clears the override (falls back to the placed art).
  const setColorCw = (colorName, decoIndex, url) => {
    const k = colorKeyOf(colorName);
    setDecorations((ds) => ds.map((d, i) => {
      if (i !== decoIndex) return d;
      const m = { ...(d.cw_by_color || {}) };
      if (!url) delete m[k]; else m[k] = url;
      return { ...d, cw_by_color: m };
    }));
  };
  // Available web-logo color ways per placed deco (from the art library record), so each
  // color can pick a different one. Only decos whose art has 2+ web logos offer a choice.
  const decoCwChoices = decorations.map((d) => {
    const art = (library || []).find((a) => a.id === d.art_id);
    return (art && Array.isArray(art.web_logos)) ? art.web_logos.filter((w) => w && w.url) : [];
  });
  const [name, setName] = useState(item.display_name || defaultName || '');
  const [price, setPrice] = useState(item.retail_price || 0);
  const [fundraise, setFundraise] = useState(item.fundraise_amount || '');
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
  const [category, setCategory] = useState(item.category || stockByWp[item.id]?.category || '');
  const [required, setRequired] = useState(!!item.required);
  const [kitName, setKitName] = useState(item.kit_name || '');
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
  const toggleSize = (sz) => setOfferedSizes((cur) => cur.includes(sz) ? cur.filter((s) => s !== sz) : [...cur, sz]);
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
  const decoIncluded = !isBundle && (decorations.length > 0 || isTeam);
  const decoCost = decoIncluded ? 5 : 0;
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
  const setMainFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImgBusy(true);
    try { const url = await cloudUpload(file, 'nsa-webstores'); setImage(url); }
    catch (x) { /* cloudUpload surfaces error via toast */ }
    setImgBusy(false);
  };

  const save = () => {
    const cleanOptions = cleanItemOptions(options);
    const fields = { retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, display_name: (name.trim() && name.trim() !== (defaultName || '').trim()) ? name.trim() : null, weight_oz: weight === '' ? null : Number(weight) || 0, image_url: image || null, image_back_url: backImage || null, extra_image_urls: extraImages, category: category.trim() || null, required: !!required, kit_name: kitName.trim() || null, options: cleanOptions };
    if (!isBundle) {
      fields.takes_number = !!takesNumber; fields.takes_name = !!takesName; fields.name_upcharge = Number(nameUp) || 0;
      fields.transfer_codes = transferCodes.filter(Boolean);
      fields.num_transfer_sets = takesNumber ? numTransferSets.filter((s) => s && s !== '|') : [];
      fields.decorations = decorations;
      // null = every available size (default). Store a subset only when one is set.
      const _allOn = allSizes.length === 0 || offeredSizes.length === 0 || offeredSizes.length >= allSizes.length;
      fields.sizes_offered = _allOn ? null : allSizes.filter((s) => offeredSizes.includes(s));
    }
    onSave(fields);
    // Stay on the item after saving — just confirm briefly on the button.
    setJustSaved(true); setTimeout(() => setJustSaved(false), 1800);
  };

  const catListId = 'cat-suggest-' + item.id;
  const kitListId = 'kit-suggest-' + item.id;
  return (
    <div style={{ padding: 16, background: '#f6f7f9' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, position: 'sticky', top: 0, zIndex: 5, background: '#f6f7f9', paddingBottom: 12, borderBottom: '1px solid #e5e8ec' }}>
        {!isBundle && page === 'details' && <button type="button" className="btn btn-secondary" onClick={() => setPage('art')}>Next: Art &amp; colors →</button>}
        <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={onCancel}>{justSaved ? 'Close' : 'Cancel'}</button>
        <button className="btn btn-primary" disabled={imgBusy} onClick={save}>{imgBusy ? 'Uploading…' : justSaved ? 'Saved ✓' : 'Save changes'}</button>
      </div>
      {!isBundle && !setPageProp && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid #e5e8ec' }}>
          {[['details', '1 · Item setup'], ['art', '2 · Art & colors']].map(([k, lbl]) => { const on = page === k; return (
            <button key={k} type="button" onClick={() => setPage(k)} style={{ background: 'none', border: 'none', borderBottom: '3px solid ' + (on ? '#191919' : 'transparent'), color: on ? '#191919' : '#94a3b8', fontWeight: 800, fontSize: 13.5, padding: '8px 14px', marginBottom: -2, cursor: 'pointer' }}>{lbl}</button>
          ); })}
        </div>
      )}

      {(page === 'details' || isBundle) && <React.Fragment>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div>
        <ItemSection title="Basics" hint="· name shown in the catalog">
          <Row label={isBundle ? 'Package name' : 'Display name (optional override)'}><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName || ''} /></Row>
        </ItemSection>

        <ItemSection title="Pricing & margin">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Row label="Price"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 120 }} /></Row>
            <Row label="Fundraising"><input className="form-input" type="number" step="0.01" value={fundraise} onChange={(e) => setFundraise(e.target.value)} placeholder={storeFundAmt > 0 ? storeFundAmt.toFixed(2) + ' (auto)' : '0'} style={{ width: 130 }} /></Row>
            {onUpdateCost && !isBundle && <Row label="Cost (NSA)"><input className="form-input" type="number" step="0.01" min={0} value={costInput} onChange={(e) => setCostInput(e.target.value)} onBlur={saveCost} placeholder="0.00" style={{ width: 110 }} title="Base item cost — drives margin; saving updates the catalog product" /></Row>}
            <Row label="Shopper pays"><div className="form-input" style={{ background: '#f8fafc', fontWeight: 700, width: 110 }}>{money(total)}</div></Row>
          </div>
          {!isBundle && (effCost != null
            ? <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: '#64748b' }}>
                <span>Cost <b style={{ color: '#191919' }}>{money(trueCost)}</b>{decoIncluded ? <span style={{ color: '#94a3b8' }}> (incl. ~{money(decoCost)} deco)</span> : null}</span>
                <span style={{ color: marginPct != null && marginPct >= 45 ? '#166534' : '#b45309', fontWeight: 800 }}>{marginPct != null ? marginPct + '% margin' : '— margin'}</span>
                {target45 != null && marginPct !== 45 && <button type="button" onClick={() => setPrice(target45)} style={{ fontSize: 11.5, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>Set {money(target45)} (45%)</button>}
              </div>
            : <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>Add a cost to this product to see margin.</div>)}
          {!isBundle && storeFund?.enabled && (Number(fundraise) > 0
            ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>Overrides the store rule ({money(storeFundAmt)} default).</div>
            : storeFundAmt > 0 ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>Includes {money(storeFundAmt)} store fundraising — enter to override.</div> : null)}
        </ItemSection>

        {!isBundle && allSizes.length > 0 && (
          <ItemSection title="Sizes offered" hint="· tap to toggle (all on by default)">
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {allSizes.map((sz) => { const on = offeredSizes.includes(sz); return (
                <button key={sz} type="button" onClick={() => toggleSize(sz)} style={{ border: '1px solid ' + (on ? '#191919' : '#d1d5db'), background: on ? '#191919' : '#fff', color: on ? '#fff' : '#3A4150', borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 40 }}>{sz}</button>
              ); })}
            </div>
            {offeredSizes.length > 0 && offeredSizes.length < allSizes.length && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Storefront shows only: {allSizes.filter((s) => offeredSizes.includes(s)).join(', ')}</div>}
          </ItemSection>
        )}
        </div>
        <div>
        <ItemSection title="Store placement" hint="· section, kit & whether it’s required">
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Row label="Category / section on the store">
              <input className="form-input" list={catListId} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Spirit Wear, Coaches, Headwear" />
              <datalist id={catListId}>{categorySuggestions.map((c) => <option key={c} value={c} />)}</datalist>
            </Row>
            <Row label="Part of a kit / package">
              <input className="form-input" list={kitListId} value={kitName} onChange={(e) => setKitName(e.target.value)} placeholder="e.g. Mandatory Player Kit" />
              <datalist id={kitListId}>{kitSuggestions.map((c) => <option key={c} value={c} />)}</datalist>
            </Row>
            <div style={{ paddingBottom: 6 }}><Toggle label="Mandatory — every shopper must buy this" checked={required} onChange={setRequired} /></div>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Items sharing a kit name are bought together; mark the kit’s items Mandatory to require them at checkout.</div>
        </ItemSection>

        {!isBundle && (
          <ItemSection title="Add-on options" hint="· shopper-selected extras, e.g. embroidered name or collar color">
            <OptionsEditor value={options} onChange={setOptions} />
          </ItemSection>
        )}

        <ItemSection title="Shipping" hint="· used for ship-to-home rates">
          <Row label="Ship weight (oz)"><input className="form-input" type="number" step="0.1" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={`auto ~${estOz}`} style={{ width: 130 }} /></Row>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Blank = auto-estimate by item type (~{estOz} oz).</div>
        </ItemSection>
        </div>
      </div>

        {isBundle && <div style={{ fontSize: 12, color: '#94a3b8' }}>To change which items are in this package or their number/name options, remove and re-create the package.</div>}
      </React.Fragment>}

      {page === 'art' && !isBundle && <React.Fragment>
      <ItemSection title="Garment & decoration" hint="· drag a logo on, place it, recolor, then apply to other items">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: 10, border: '1px solid #e5e8ec', borderRadius: 10, background: '#fff' }}>
          <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', background: '#f1f5f9', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
            {(image || stockImg || item.image_url) ? <img src={image || stockImg || item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#94a3b8' }}>No photo</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Garment photo</div>
            <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{image ? 'Custom photo for this item' : 'Using the catalog stock photo'}</div>
          </div>
          <input ref={mainImgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const fl = (e.target.files || [])[0]; if (fl) setMainFile(fl); e.target.value = ''; }} />
          <button type="button" className="btn btn-sm btn-secondary" disabled={imgBusy} onClick={() => mainImgRef.current?.click()}>{imgBusy ? 'Uploading…' : 'Change photo'}</button>
          {image && <button type="button" className="btn btn-sm btn-secondary" disabled={imgBusy} onClick={() => setImage(null)}>Reset to stock</button>}
        </div>
        <LogoPlacer imageUrl={image || stockImg || item.image_url} backImageUrl={backImage} stockBackImg={stockBackImg} onBackImageChange={setBackImage} decorations={decorations} onChange={setDecorations} library={library} storeColors={storeColors} siblings={siblings} onApplyToItems={onApplyLogo} onSaveLogo={onSaveLogo} takesNumber={takesNumber} takesName={takesName} />
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
        {groupColors && groupColors.length > 0 && (
          <ItemSection title="Colors in this item" hint={`· each color previewed with the art — pick a web-logo color way per color`} right={onCopyItem ? <button type="button" className="btn btn-sm btn-secondary" onClick={() => onCopyItem(item)} title="Make a separate card from this item">⧉ Copy to a separate card</button> : null}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {groupColors.map((c) => { const cs = stockByWp[c.id]; const cName = cs?.color || c.sku; const cImg = c.image_url || cs?.image_front_url; const isPrimary = c.id === item.id; const ck = colorKeyOf(cName); return (
                <div key={c.id} style={{ position: 'relative', width: 116, border: '2px solid ' + (isPrimary ? '#191919' : '#e2e8f0'), borderRadius: 10, padding: 6, background: '#fff' }}>
                  <GarmentLogoPreview imageUrl={cImg} decorations={decorations} colorName={cName} />
                  <div style={{ fontSize: 10.5, color: '#191919', fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cName}{isPrimary ? ' (main)' : ''}</div>
                  {decorations.map((d, di) => { const choices = decoCwChoices[di]; if ((d.side || 'front') === 'back' || !choices || choices.length < 2) return null; const cur = (d.cw_by_color && d.cw_by_color[ck]) || ''; return (
                    <select key={di} value={cur} onChange={(e) => setColorCw(cName, di, e.target.value)} title="Which web-logo color way this garment color uses" style={{ width: '100%', marginTop: 4, fontSize: 10, border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 4px', background: '#fff', color: '#334155', cursor: 'pointer' }}>
                      <option value="">Logo {di + 1}: auto</option>
                      {choices.map((w, wi) => <option key={wi} value={w.url}>{w.color_way || 'All garments'}</option>)}
                    </select>
                  ); })}
                  {onRemoveColor && groupColors.length > 1 && <button type="button" title="Remove this color" onClick={() => onRemoveColor(c.id, cName)} style={{ position: 'absolute', top: -8, right: -8, background: '#fff', border: '1px solid #e2e8f0', color: '#b91c1c', borderRadius: '50%', width: 20, height: 20, fontSize: 12, lineHeight: '17px', fontWeight: 800, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }}>×</button>}
                </div>
              ); })}
            </div>
          </ItemSection>
        )}

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

        <ItemSection title="Additional images" hint="· extra angles / back views shown on the product page">
          <div onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); [...(e.dataTransfer.files || [])].forEach(addExtraFile); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, border: '1.5px dashed #d7dbe2', borderRadius: 10, background: '#fafbfc' }}>
            {extraImages.map((url, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                <button type="button" onClick={() => setExtraImages((p) => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0, textAlign: 'center' }}>×</button>
              </div>
            ))}
            <input ref={imgRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { [...(e.target.files || [])].forEach(addExtraFile); e.target.value = ''; }} />
            <button type="button" className="btn btn-sm btn-secondary" disabled={imgBusy} onClick={() => imgRef.current?.click()}>{imgBusy ? 'Uploading…' : '+ Drop or add images'}</button>
          </div>
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

// After a product is picked, set its base price (X), fundraising add-on (Y), image, personalization + transfers.
function SinglePriceEditor({ product, designOptions, numberSets, isTeam = false, library = [], storeFund = {}, onSaveLogo, onAdd, onCancel }) {
  const [price, setPrice] = useState(product.retail_price || 0);
  const [fundraise, setFundraise] = useState(0);
  const [image, setImage] = useState(null);
  const [decorations, setDecorations] = useState([]);
  const [takesNumber, setTakesNumber] = useState(false);
  const [takesName, setTakesName] = useState(false);
  const [nameUpcharge, setNameUpcharge] = useState(0);
  const [transferCodes, setTransferCodes] = useState([]);
  const [numTransferSets, setNumTransferSets] = useState([]);
  // Other colorways of this style (same product name) — add several at once at
  // one price. Grouping key is `name` (SKUs are unique per color in this catalog).
  const [siblings, setSiblings] = useState([]);
  const [extraColors, setExtraColors] = useState(() => new Set());
  useEffect(() => {
    if (!product?.name) { setSiblings([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('products')
        .select('id,sku,name,color,retail_price,image_front_url,available_sizes,category,brand')
        .eq('name', product.name).neq('id', product.id).order('color').limit(200);
      if (!cancelled) setSiblings(data || []);
    })();
    return () => { cancelled = true; };
  }, [product.id, product.name]);
  // Collapse to one swatch per distinct color, preferring a row that actually has
  // an image (the catalog has several SKUs per color, many without art); drop the
  // base item's own color so we don't offer to add it twice.
  const colorOptions = useMemo(() => {
    const base = (product.color || '').trim().toLowerCase();
    const map = new Map();
    for (const s of siblings) {
      const key = (s.color || '').trim().toLowerCase();
      if (!key || key === base) continue;
      const cur = map.get(key);
      if (!cur || (!cur.image_front_url && s.image_front_url)) map.set(key, s);
    }
    return [...map.values()].sort((a, b) => (a.color || '').localeCompare(b.color || ''));
  }, [siblings, product.color]);
  const toggleColor = (id) => setExtraColors((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedSiblings = colorOptions.filter((s) => extraColors.has(s.id));
  const storeFundAmt = storeFundAmount(price, storeFund);
  const total = (Number(price) || 0) + effectiveFundraise(price, fundraise, storeFund);
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{product.name}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>{[product.sku, product.color].filter(Boolean).join(' · ')}</div>
      {colorOptions.length > 0 && (
        <div style={{ margin: '0 0 12px', padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #eef2f7' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 7 }}>
            Also add other colors of this style <span style={{ fontWeight: 400, color: '#94a3b8' }}>· same price &amp; options apply to all</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {colorOptions.map((s) => {
              const on = extraColors.has(s.id);
              return (
                <button key={s.id} type="button" onClick={() => toggleColor(s.id)} title={s.color || s.sku}
                  style={{ position: 'relative', width: 66, border: '2px solid ' + (on ? '#191919' : '#e2e8f0'), background: '#fff', borderRadius: 10, padding: 4, cursor: 'pointer' }}>
                  <div style={{ width: '100%', height: 56, borderRadius: 6, overflow: 'hidden', background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {s.image_front_url ? <img src={s.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 9, color: '#cbd5e1', fontWeight: 700, padding: 2, textAlign: 'center' }}>{(s.color || s.sku || '').slice(0, 10)}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: on ? '#191919' : '#64748b', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.color || s.sku}</div>
                  {on && <div style={{ position: 'absolute', top: -7, right: -7, background: '#191919', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, lineHeight: '18px', fontWeight: 800, textAlign: 'center' }}>✓</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <ImageUpload value={image} fallback={product.image_front_url} onChange={setImage} />
      <LogoPlacer imageUrl={image || product.image_front_url} decorations={decorations} onChange={setDecorations} library={library} onSaveLogo={onSaveLogo} />
      <div style={{ display: 'flex', gap: 12 }}>
        <Row label="Price (X)"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Row>
        <Row label="Fundraising on top (Y)"><input className="form-input" type="number" step="0.01" value={fundraise} onChange={(e) => setFundraise(e.target.value)} placeholder={storeFundAmt > 0 ? String(storeFundAmt) : '0'} /></Row>
        <Row label="Shopper pays"><div className="form-input" style={{ background: '#f8fafc', fontWeight: 700 }}>{money(total)}</div></Row>
      </div>
      {storeFund?.enabled && (
        <div style={{ fontSize: 11.5, color: storeFundAmt > 0 ? '#166534' : '#94a3b8', marginTop: 4 }}>
          {Number(fundraise) > 0
            ? `Overrides the store rule (store default would add ${money(storeFundAmt)}).`
            : `Store fundraising adds ${Number(storeFund.flat) > 0 ? money(storeFund.flat) : (storeFund.pct || 0) + '%'}${storeFund.round ? ', rounded up' : ''} = ${money(storeFundAmt)} — included in “Shopper pays.”`}
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <Toggle label="Player adds a number" checked={takesNumber} onChange={setTakesNumber} />
        <Toggle label="Player adds a name" checked={takesName} onChange={setTakesName} />
        {takesName && <label style={{ fontSize: 13 }}>Name upcharge +$<input className="form-input" style={{ width: 80, display: 'inline-block', marginLeft: 4 }} type="number" step="0.01" min={0} value={nameUpcharge} onChange={(e) => setNameUpcharge(e.target.value)} /></label>}
      </div>
      {isTeam
        ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Logo &amp; number transfers are a club-store option — team-store decoration is handled in production, so there’s nothing to stock here.</div>
        : <MultiTransferFields designOptions={designOptions} numberSets={numberSets} transferCodes={transferCodes} setTransferCodes={setTransferCodes} numTransferSets={numTransferSets} setNumTransferSets={setNumTransferSets} showNumber={takesNumber} />}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button className="btn btn-primary" onClick={() => onAdd({ products: [product, ...selectedSiblings], price, fundraise, image_url: image, takes_number: takesNumber, takes_name: takesName, name_upcharge: nameUpcharge, transfer_codes: isTeam ? [] : transferCodes.filter(Boolean), num_transfer_sets: isTeam ? [] : numTransferSets.filter((s) => s && s !== '|'), decorations })}>{selectedSiblings.length > 0 ? `Add ${selectedSiblings.length + 1} items` : 'Add to store'}</button>
        <button className="btn btn-secondary" onClick={onCancel}>Back</button>
      </div>
    </div></div>
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
      // Group template items by STYLE so every color of a garment folds into one card.
      // styleKey() strips any color baked into the name, so adidas-style "M FLEECE HOOD
      // ROYBLU/WHITE" siblings group instead of each showing as its own "1 of 1 colors".
      const styleMap = new Map();
      const savedByKey = new Map();
      items.forEach((it) => { const p = bySku.get(String(it.sku || '').trim().toUpperCase()); if (!p) return;
        const key = styleKey(p.name);
        if (!styleMap.has(key)) { styleMap.set(key, { name: key, image: p.image_front_url, meta: { price: it.price, fundraise: it.fundraise || 0, category: it.category || null, kit: it.kit || null, required: !!it.required }, defaults: new Set() }); savedByKey.set(key, []); }
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
      const built = keys.map((key) => {
        const s = styleMap.get(key);
        // Dedupe colors (blank color → key by SKU so caps/jerseys don't collapse).
        const colMap = new Map();
        (byKey.get(key) || []).forEach((p) => { const ck = (p.color || '').trim().toLowerCase() || ('sku:' + String(p.sku || '').toLowerCase()); if (!colMap.has(ck) || (!colMap.get(ck).image_front_url && p.image_front_url)) colMap.set(ck, p); });
        const colors = [...colMap.values()].sort((a, b) => (a.color || a.sku || '').localeCompare(b.color || b.sku || ''));
        const picked = new Set(colors.filter((c) => s.defaults.has(String(c.sku || '').trim().toUpperCase())).map((c) => c.id));
        return { name: s.name, image: s.image, meta: s.meta, colors, picked };
      });
      if (!cancelled) { setRows(built); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tpl]);
  const toggle = (ri, id) => setRows((rs) => rs.map((r, i) => { if (i !== ri) return r; const p = new Set(r.picked); p.has(id) ? p.delete(id) : p.add(id); return { ...r, picked: p }; }));
  const setAll = (ri, on) => setRows((rs) => rs.map((r, i) => i === ri ? { ...r, picked: on ? new Set(r.colors.filter((c) => !existingPids.has(c.id)).map((c) => c.id)) : new Set() } : r));
  const totalPicked = rows.reduce((a, r) => a + [...r.picked].filter((id) => !existingPids.has(id)).length, 0);
  const confirm = async () => {
    setBusy(true);
    const plan = rows.map((r) => ({ products: r.colors.filter((c) => r.picked.has(c.id)), price: r.meta.price, fundraise: r.meta.fundraise, category: forcedCategory || r.meta.category, kit_name: r.meta.kit, required: r.meta.required })).filter((g) => g.products.length);
    await onConfirm(plan);
    setBusy(false);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 760, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>Pick colors — {tpl?.name}</div><div style={{ fontSize: 11.5, color: '#64748b' }}>Choose the colors of each item to add. No decoration carries over.</div></div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16, maxHeight: '64vh', overflowY: 'auto' }}>
          {loading ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 16, textAlign: 'center' }}>Loading colors…</div>
            : rows.length === 0 ? <div style={{ color: '#9AA1AC', fontSize: 13, padding: 16, textAlign: 'center' }}>None of this template's items resolve to live products.</div>
            : rows.map((r, ri) => (
              <div key={r.name} style={{ border: '1px solid #e8ebf0', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  {r.image ? <img src={r.image} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6, border: '1px solid #eef2f7', background: '#fff' }} /> : null}
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: '#191919' }}>{r.name}</div><div style={{ fontSize: 11, color: '#64748b' }}>{[...r.picked].filter((id) => !existingPids.has(id)).length} of {r.colors.length} colors</div></div>
                  <button type="button" onClick={() => setAll(ri, true)} style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer' }}>All</button>
                  <button type="button" onClick={() => setAll(ri, false)} style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {r.colors.map((c) => { const inStore = existingPids.has(c.id); const on = r.picked.has(c.id); return (
                    <button key={c.id} type="button" disabled={inStore} onClick={() => toggle(ri, c.id)} title={inStore ? (c.color || c.sku) + ' — already in store' : (c.color || c.sku)} style={{ position: 'relative', width: 80, border: '2px solid ' + (inStore ? '#e2e8f0' : on ? '#191919' : '#e2e8f0'), background: '#fff', borderRadius: 9, padding: 4, cursor: inStore ? 'not-allowed' : 'pointer', opacity: inStore ? 0.45 : 1 }}>
                      <div style={{ width: '100%', height: 64, borderRadius: 5, overflow: 'hidden', background: '#f4f6f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.image_front_url ? <img src={c.image_front_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 8, color: '#cbd5e1', fontWeight: 700, padding: 2, textAlign: 'center' }}>{(c.color || c.sku || '').slice(0, 12)}</span>}</div>
                      <div style={{ fontSize: 9.5, color: on && !inStore ? '#191919' : '#64748b', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.color || c.sku}</div>
                      {on && !inStore && <div style={{ position: 'absolute', top: -7, right: -7, background: '#191919', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, lineHeight: '18px', fontWeight: 800, textAlign: 'center' }}>✓</div>}
                      {inStore && <div style={{ position: 'absolute', top: 2, right: 2, background: '#64748b', color: '#fff', borderRadius: 5, fontSize: 8, fontWeight: 700, padding: '1px 4px' }}>IN</div>}
                    </button>
                  ); })}
                </div>
              </div>
            ))}
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
  const [meta, setMeta] = useState({ name: '', sport: '', brand_focus: 'Mixed', gender: 'Unisex', note: '', kind: 'store', sourceCat: '', section: '' });
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
  const startFromStore = () => { setPendingItems(captureItems()); setMeta((m) => ({ ...m, name: '', kind: 'store', sourceCat: '', section: '' })); setView('form'); };
  // Save just one section/category of the current store as a bolt-on section template.
  const startSection = () => { setPendingItems(captureItems()); setMeta((m) => ({ ...m, name: '', kind: 'section', sourceCat: '', section: '' })); setView('form'); };
  const del = async (id) => { await supabase.from('store_templates').delete().eq('id', id); load(); };
  // Section templates can be limited to one captured category; full-store templates keep all.
  const pendingCats = [...new Set(pendingItems.map((i) => (i.category || '').trim()).filter(Boolean))].sort();
  const sectionItems = (meta.kind === 'section' && meta.sourceCat) ? pendingItems.filter((i) => (i.category || '').trim() === meta.sourceCat) : pendingItems;
  const saveTemplate = async () => {
    const isSection = meta.kind === 'section';
    const secName = isSection ? (meta.section || meta.sourceCat || '').trim() : null;
    const itemsToSave = sectionItems;
    if (!meta.name.trim() || !itemsToSave.length || (isSection && !secName)) return;
    setSaving(true);
    const { error } = await supabase.from('store_templates').insert({ name: meta.name.trim(), sport: meta.sport || null, brand_focus: meta.brand_focus || null, gender: meta.gender || null, note: meta.note || null, items: itemsToSave, kind: isSection ? 'section' : 'store', section: secName, created_by: myEmail || null });
    setSaving(false);
    if (!error) { setView('gallery'); setPendingItems([]); setMeta({ name: '', sport: '', brand_focus: 'Mixed', gender: 'Unisex', note: '', kind: 'store', sourceCat: '', section: '' }); load(); }
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
              <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>{sectionItems.length} item{sectionItems.length === 1 ? '' : 's'} captured. Name it so reps can find it.</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[['store', 'Full store', 'Bolt every item onto a store'], ['section', 'Section', 'A bolt-on section, e.g. Football Cleats']].map(([k, lbl, sub]) => { const on = meta.kind === k; return (
                  <button key={k} type="button" onClick={() => setMeta((m) => ({ ...m, kind: k }))} style={{ flex: 1, textAlign: 'left', border: '2px solid ' + (on ? '#191919' : '#e2e8f0'), background: on ? '#f8fafc' : '#fff', borderRadius: 10, padding: '8px 12px', cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#191919' }}>{lbl}</div>
                    <div style={{ fontSize: 10.5, color: '#64748b' }}>{sub}</div>
                  </button>
                ); })}
              </div>
              {meta.kind === 'section' && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, padding: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                  <Row label="Limit to section (optional)"><select className="form-input" value={meta.sourceCat} onChange={(e) => setMeta((m) => ({ ...m, sourceCat: e.target.value, section: m.section || e.target.value }))}><option value="">All captured items</option>{pendingCats.map((c) => <option key={c} value={c}>{c}</option>)}</select></Row>
                  <Row label="Section name (lands here)"><input className="form-input" value={meta.section} onChange={(e) => setMeta({ ...meta, section: e.target.value })} placeholder="e.g. Football Cleats" /></Row>
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Row label="Template name"><input className="form-input" autoFocus value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder={meta.kind === 'section' ? 'e.g. Adidas Football Cleats' : 'e.g. Varsity Baseball — Adidas'} /></Row>
                <Row label="Sport"><input className="form-input" list="tpl-sports" value={meta.sport} onChange={(e) => setMeta({ ...meta, sport: e.target.value })} placeholder="Baseball" /><datalist id="tpl-sports">{TEMPLATE_SPORTS.map((s) => <option key={s} value={s} />)}</datalist></Row>
                <Row label="Brand focus"><select className="form-input" value={meta.brand_focus} onChange={(e) => setMeta({ ...meta, brand_focus: e.target.value })}>{['Mixed', 'Adidas', 'Non-branded'].map((b) => <option key={b} value={b}>{b}</option>)}</select></Row>
                <Row label="Gender"><select className="form-input" value={meta.gender} onChange={(e) => setMeta({ ...meta, gender: e.target.value })}>{['Unisex', "Men's", "Women's", 'Youth'].map((g) => <option key={g} value={g}>{g}</option>)}</select></Row>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="btn btn-primary" disabled={!meta.name.trim() || !sectionItems.length || (meta.kind === 'section' && !(meta.section || meta.sourceCat).trim()) || saving} onClick={saveTemplate}>{saving ? 'Saving…' : 'Save template'}</button>
                <button className="btn btn-secondary" onClick={() => setView('gallery')}>Cancel</button>
              </div>
            </div>
          )}

          {view === 'gallery' && (
            <div>
              {isCurator && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', alignSelf: 'center' }}>Curator:</span>
                  <button className="btn btn-sm btn-secondary" disabled={!(catalog || []).some((c) => c.kind === 'single')} onClick={startFromStore}>＋ Save full store as template</button>
                  <button className="btn btn-sm btn-secondary" disabled={!(catalog || []).some((c) => c.kind === 'single')} onClick={startSection}>＋ Save a section as template</button>
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
                          {t.kind === 'section' ? chip('Section', '#ecfdf5', '#047857') : chip('Full store', '#eff6ff', '#1d4ed8')}
                          {t.sport && chip(t.sport, '#eff6ff', '#1d4ed8')}
                          {t.brand_focus && chip(t.brand_focus)}
                          {t.gender && chip(t.gender)}
                        </div>
                        <div style={{ fontSize: 12, color: '#6A7180' }}>{itemsOf(t).length} item{itemsOf(t).length === 1 ? '' : 's'}{t.kind === 'section' && t.section ? ` · → ${t.section}` : ''}</div>
                        <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', paddingTop: 6 }}>
                          <button className="btn btn-sm btn-primary" onClick={() => setPicking(t)} style={{ flex: 1 }}>{t.kind === 'section' ? 'Add section →' : 'Add to store →'}</button>
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

  const presetLabel = SIZE_PRESETS.find((p) => p.sizes.length === sizes.length && p.sizes.every((s, i) => s === sizes[i]))?.label || 'Custom';
  // Keep the size list ordered smallest → largest no matter what order they're typed in.
  const sortSizes = (arr) => [...arr].sort((a, b) => sizeRank(a) - sizeRank(b));
  const addSize = () => { const s = newSize.trim().toUpperCase(); if (s && !sizes.includes(s)) setSizes(sortSizes([...sizes, s])); setNewSize(''); };
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
              <Row label="Sizing type"><select className="form-input" value={presetLabel} onChange={(e) => { const p = SIZE_PRESETS.find((x) => x.label === e.target.value); if (p) setSizes(p.sizes); }} style={{ width: 190 }}>{SIZE_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}{presetLabel === 'Custom' && <option value="Custom">Custom</option>}</select></Row>
              <Row label="Cost (NSA)"><input className="form-input" type="number" step="0.01" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" style={{ width: 110 }} /></Row>
              <Row label="Retail price"><input className="form-input" type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" style={{ width: 110 }} /></Row>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {sizes.map((s) => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f1f5f9', borderRadius: 7, padding: '3px 8px', fontSize: 12, fontWeight: 700 }}>{s}<button type="button" onClick={() => setSizes(sizes.filter((x) => x !== s))} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button></span>)}
              <input className="form-input" style={{ width: 90 }} placeholder="+ size" value={newSize} onChange={(e) => setNewSize(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } }} />
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
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>{reusable ? 'Recurring item — kept in the catalog so you can drop it into other stores later.' : 'Just for this store — it won’t clutter the shared catalog or product search.'}</div>
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
function SkuImporter({ existingPids, storeFund = {}, onAddMany, onClose }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const pickField = (obj, keys) => { for (const k of Object.keys(obj)) { if (keys.includes(norm(k))) { const v = obj[k]; if (v !== '' && v != null) return v; } } return ''; };

  const downloadTemplate = () => {
    const csv = 'SKU,Price,Fundraising,Category,Kit,Mandatory\nJX4452,30,,Spirit Wear,,no\nA595,45,5,Coaches,,no\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'store-import-template.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const parseFile = async (file) => {
    if (!file) return;
    setErr(''); setDone(null); setBusy(true); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const parsed = raw.map((r) => ({
        sku: String(pickField(r, ['sku', 'style', 'style #', 'item', 'item #', 'item number', 'product', 'product sku', 'number'])).trim(),
        price: pickField(r, ['price', 'retail', 'retail price', 'x']),
        fundraise: pickField(r, ['fundraise', 'fundraising', 'fundraiser', 'y']),
        category: String(pickField(r, ['category', 'section', 'group'])).trim(),
        kit: String(pickField(r, ['kit', 'package', 'bundle'])).trim(),
        mandatory: ['yes', 'y', 'true', '1', 'x', 'required'].includes(norm(pickField(r, ['mandatory', 'required']))),
      })).filter((r) => r.sku);
      if (!parsed.length) { setErr('No SKUs found — make sure a column is headed “SKU”.'); setRows([]); setBusy(false); return; }
      const skus = [...new Set(parsed.map((r) => r.sku))];
      const variants = [...new Set(skus.flatMap((s) => [s, s.toUpperCase(), s.toLowerCase()]))];
      const found = [];
      for (let i = 0; i < variants.length; i += 150) {
        const { data } = await supabase.from('products').select('id,sku,name,color,retail_price,image_front_url').in('sku', variants.slice(i, i + 150));
        if (data) found.push(...data);
      }
      const byKey = new Map();
      found.forEach((p) => { const k = String(p.sku || '').trim().toUpperCase(); if (!byKey.has(k)) byKey.set(k, p); });
      const seen = new Set();
      const preview = parsed.map((r) => {
        const product = byKey.get(r.sku.toUpperCase()) || null;
        let status = 'new';
        if (!product) status = 'notfound';
        else if (existingPids && existingPids.has(product.id)) status = 'dup';
        else if (seen.has(product.id)) status = 'dupfile';
        if (product && status === 'new') seen.add(product.id);
        return { ...r, product, status };
      });
      setRows(preview);
    } catch (e) { setErr('Could not read that file: ' + (e.message || e)); setRows([]); }
    setBusy(false);
  };

  const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const addable = rows.filter((r) => r.status === 'new');

  const doImport = async () => {
    if (!addable.length || !onAddMany) return;
    setAdding(true);
    const res = await onAddMany(addable.map((r) => ({
      product: r.product,
      price: (r.price !== '' && r.price != null) ? r.price : r.product.retail_price,
      fundraise: r.fundraise || 0,
      category: r.category || null,
      kit_name: r.kit || null,
      required: r.mandatory,
    })));
    setAdding(false);
    if (res && !res.error) setDone({ added: res.added });
  };

  const statusChip = (s) => {
    const m = { new: ['Will add', '#166534', '#dcfce7'], dup: ['Already in store', '#92400e', '#fef3c7'], dupfile: ['Duplicate row', '#92400e', '#fef3c7'], notfound: ['SKU not found', '#b91c1c', '#fee2e2'] }[s] || ['—', '#64748b', '#f1f5f9'];
    return <span style={{ fontSize: 11, fontWeight: 700, color: m[1], background: m[2], borderRadius: 6, padding: '2px 8px' }}>{m[0]}</span>;
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 760, margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Import a product list</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '20px 10px' }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Imported {done.added} item{done.added === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 13, color: '#6A7180', marginBottom: 16 }}>They’re in the catalog now — set art, colors and any per-item overrides next.</div>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: '#6A7180', marginBottom: 12 }}>
                Drop an <b>Excel</b> (.xlsx) or <b>Google Sheets / CSV</b> export of the SKUs to add. Only a <b>SKU</b> column is required; optional: Price, Fundraising, Category, Kit, Mandatory. Blank price uses each item’s list price{storeFund?.enabled ? '; blank fundraising uses the store rule' : ''}.
                <button type="button" onClick={downloadTemplate} style={{ marginLeft: 6, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}>Download template ↓</button>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!over) setOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); parseFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current && fileRef.current.click()}
                style={{ border: `1.5px dashed ${over ? '#2563eb' : '#cbd5e1'}`, borderRadius: 12, padding: '22px 16px', textAlign: 'center', background: over ? '#eff4ff' : '#fafbfc', cursor: 'pointer' }}>
                <div style={{ fontWeight: 700, color: '#3A4150', fontSize: 14 }}>{busy ? 'Reading…' : fileName ? `${fileName} — drop another to replace` : 'Drop your spreadsheet here, or click to browse'}</div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>.xlsx · .xls · .csv</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={(e) => { parseFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </div>

              {err && <div style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600, marginTop: 10 }}>{err}</div>}

              {rows.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                    <span style={{ color: '#166534' }}>{counts.new || 0} to add</span>
                    {counts.dup ? <span style={{ color: '#92400e' }}>{counts.dup} already in store</span> : null}
                    {counts.dupfile ? <span style={{ color: '#92400e' }}>{counts.dupfile} duplicate row{counts.dupfile === 1 ? '' : 's'}</span> : null}
                    {counts.notfound ? <span style={{ color: '#b91c1c' }}>{counts.notfound} not found</span> : null}
                  </div>
                  <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #eef0f3', borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase', position: 'sticky', top: 0, background: '#f8fafc' }}>
                        <th style={{ padding: '7px 10px' }}>SKU</th><th style={{ padding: '7px 10px' }}>Product</th><th style={{ padding: '7px 10px' }}>Price</th><th style={{ padding: '7px 10px' }}>Status</th>
                      </tr></thead>
                      <tbody>
                        {rows.slice(0, 200).map((r, i) => (
                          <tr key={i} style={{ borderTop: '1px solid #f1f5f9', opacity: r.status === 'new' ? 1 : 0.7 }}>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.sku}</td>
                            <td style={{ padding: '6px 10px' }}>{r.product ? [r.product.name, r.product.color].filter(Boolean).join(' · ') : <span style={{ color: '#b91c1c' }}>—</span>}</td>
                            <td style={{ padding: '6px 10px' }}>{r.product ? money((r.price !== '' && r.price != null) ? r.price : r.product.retail_price) : '—'}</td>
                            <td style={{ padding: '6px 10px' }}>{statusChip(r.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 200 && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Showing first 200 of {rows.length} rows.</div>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="btn btn-primary" disabled={!addable.length || adding} onClick={doImport} style={{ opacity: (!addable.length || adding) ? 0.5 : 1 }}>{adding ? 'Adding…' : `Add ${addable.length} item${addable.length === 1 ? '' : 's'} to store`}</button>
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

function ProductPicker({ label, onPick, onPickMany, onClose, storeColors = [], storeFund = {}, library = [], catalog = [], standardCategories = [], onSaveLogo, initialFilter = {} }) {
  // Section options for the bulk-add category dropdown: the store's own sections plus the
  // global standard categories (Store defaults). First one is the default selection.
  const storeSections = useMemo(() => [...new Set([...(catalog || []).map((c) => c.category), ...(standardCategories || [])].filter(Boolean))].sort(), [catalog, standardCategories]);
  const [q, setQ] = useState(initialFilter.q || '');
  const [brandSel, setBrandSel] = useState(initialFilter.brand || null);
  const [catSel, setCatSel] = useState(initialFilter.category || null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(300);
  const [inStockOnly, setInStockOnly] = useState(true); // school stores default to fulfillable
  const colorWords = useMemo(() => storeColorWords(storeColors), [storeColors]);
  const [colorOnly, setColorOnly] = useState(colorWords.length > 0); // default to the school's colors
  useEffect(() => { setColorOnly(colorWords.length > 0); }, [colorWords.length]);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
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
      // Hide retired products (archived) so the store builder can't add what the catalog
      // live-look already hides, while still including legacy rows whose is_active is null.
      let query = supabase.from('products').select('id,sku,name,brand,color,category,retail_price,nsa_cost,available_sizes,image_front_url')
        .or('is_active.is.null,is_active.eq.true').or('is_archived.is.null,is_archived.eq.false');
      if (favOnly) {
        // Favorites view — load every colorway of each starred STYLE (across all categories)
        // so the rep's + team's picks always show, regardless of color/stock filters.
        if (!favNames.length) { if (!cancelled) { setResults([]); setSearching(false); } return; }
        query = query.in('name', favNames);
        if (q.trim().length >= 2) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
        if (brandSel) query = query.eq('brand', brandSel);
        if (catSel) query = query.in('category', CAT_MAP[catSel] || [catSel]);
      } else {
        if (q.trim().length >= 2) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
        if (brandSel) query = query.eq('brand', brandSel);
        if (catSel) query = query.in('category', CAT_MAP[catSel] || [catSel]);
        // Narrow to the school's colors in the QUERY (not just client-side) so a 3k-item
        // category like Tees doesn't bury the school's colors past the row limit.
        // School colors only narrow when BROWSING; a typed search overrides them so a
        // specific SKU/name is found regardless of color (and skips ~15 color ilikes).
        if (colorOnly && colorWords.length && q.trim().length < 2) query = query.or(colorWords.map((w) => `color.ilike.%${w}%`).join(','));
      }
      const { data } = await query.order('name').order('color').limit(favOnly ? 500 : limit);
      const rows = data || [];
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
  const matched = results.filter((r) =>
    (isSearch || !colorOnly || productMatchesColors(r.color, colorWords)) &&
    // The catalog tags some jerseys as Tees — keep the Tees view to actual tees.
    !(catSel === 'Tees' && /jersey/i.test(r.name || '')));
  // Collapse colorways → one card per STYLE (name), so the grid isn't the same short in six
  // colors. The rep prefers an image + in-stock; other colorways are added later from the
  // item editor's "Other colors of this garment".
  const styleKey = (r) => (r.name || r.sku || r.id || '').trim().toLowerCase();
  const colorCountByStyle = matched.reduce((m, r) => { const k = styleKey(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const dedupeByStyle = (rows) => {
    const map = new Map();
    // A favorited colorway wins the card so the star shows on the rep; then image, then stock.
    const score = (x) => (favUnion.has(favStyleKey(x)) ? 8 : 0) + (x.image_front_url ? 2 : 0) + (wellStocked(x) ? 1 : 0);
    for (const r of rows) { const k = styleKey(r); const cur = map.get(k); if (!cur || score(r) > score(cur)) map.set(k, r); }
    return [...map.values()];
  };
  let styles = dedupeByStyle(inStockOnly ? matched.filter(wellStocked) : matched);
  if (favOnly) styles = styles.filter((p) => favUnion.has(favStyleKey(p)));
  // Favorites first (stable within each group), then everything else.
  styles = [...styles.filter((p) => favUnion.has(favStyleKey(p))), ...styles.filter((p) => !favUnion.has(favStyleKey(p)))];
  const allStyleN = new Set(matched.map(styleKey)).size;
  const inStockStyleN = new Set(matched.filter(wellStocked).map(styleKey)).size;
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selProducts = styles.filter((p) => selected.has(p.id));

  const togBtn = (on, onClick, children, c = '#166534', bg = '#dcfce7') => (
    <button type="button" onClick={onClick} aria-pressed={on} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', borderRadius: 999, padding: '4px 13px 4px 8px', fontSize: 12.5, fontWeight: 700, border: '1px solid ' + (on ? c : '#d1d5db'), background: on ? bg : '#fff', color: on ? c : '#3A4150' }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', background: on ? c : '#cbd5e1' }}>{on ? '✓' : ''}</span>{children}
    </button>
  );

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <CatalogKitStyles />
      <KitScope style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.01em' }}>{label || 'Add products'}</div>
          {onClose && <button className="ai-iconbtn" onClick={onClose} aria-label="Close picker">✕ Close</button>}
        </div>

        <input className="ai-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or SKU — or pick a category below to browse…" aria-label="Search products" />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
          {BROWSE_CATS.map((c) => <FilterBtn key={c} on={catSel === c} onClick={() => setCatSel(catSel === c ? null : c)}>{c}</FilterBtn>)}
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
              {styles.map((p) => <PickerCard key={p.id} p={p} selected={selected.has(p.id)} moreColors={(colorCountByStyle[styleKey(p)] || 1) - 1} fav={favUnion.has(favStyleKey(p))} team={favTeam.has(favStyleKey(p))} canFav={!!myEmail} curate={curate} onToggleFav={() => toggleFav(p)} onToggle={() => toggleSel(p.id)} onDetails={onPick ? () => onPick(p) : null} />)}
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
          <button className="btn btn-primary" onClick={() => { setBulkDecos([]); setBulkTab('setup'); setBCategory((c) => c || storeSections[0] || ''); setBCatNew(storeSections.length === 0); setBPrice((p) => p || (selProducts.length === 1 ? String(selProducts[0].retail_price ?? '') : '')); setBulkOpen(true); }}>Add {selProducts.length} to store →</button>
          <button className="btn btn-secondary" onClick={() => setSelected(new Set())}>Clear</button>
          <span style={{ fontSize: 11.5, color: '#9AA1AC' }}>Adds at list price — tweak fundraising / personalization per item after.</span>
        </div>
      )}
      {bulkOpen && (
        <div onClick={() => setBulkOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 760, margin: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3' }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Add {selProducts.length} item{selProducts.length === 1 ? '' : 's'} to the store</div>
              <button onClick={() => setBulkOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '2px solid #e5e8ec' }}>
                {[['setup', '1 · Item setup'], ['art', '2 · Art & logo']].map(([k, lbl]) => { const on = bulkTab === k; return (
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
                <button className="btn btn-primary" onClick={() => { setBulkOpen(false); if (onPickMany) onPickMany(selProducts, bulkDecos, { price: bPrice, fundraise: bFund, takes_number: bNumber, takes_name: bName, name_upcharge: bNameUp, category: bCategory.trim(), kit_name: bKit.trim(), required: bRequired, options: cleanItemOptions(bOptions) }); }}>{bulkDecos.length ? `Add ${selProducts.length} with logo →` : `Add ${selProducts.length} to store →`}</button>
                {bulkTab === 'setup'
                  ? <button className="btn btn-secondary" onClick={() => setBulkTab('art')}>Next: Art &amp; logo →</button>
                  : <button className="btn btn-secondary" onClick={() => setBulkTab('setup')}>← Back to setup</button>}
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
// "Details" opens the per-item editor for price/fundraising/personalization.
function PickerCard({ p, selected, moreColors = 0, fav = false, team = false, canFav = false, curate = false, onToggleFav, onToggle, onDetails }) {
  const [imgErr, setImgErr] = useState(false);
  const st = p._stock || { units: 0, sizes: [], incoming: false };
  const out = (st.units || 0) <= 0;
  // Prefer the live in-stock sizes; fall back to the catalog's listed sizes.
  const sizes = st.sizes && st.sizes.length ? st.sizes : (Array.isArray(p.available_sizes) ? p.available_sizes : []);
  return (
    <div className="ai-card" onClick={onToggle} role="button" aria-pressed={selected} style={{ position: 'relative', cursor: 'pointer', outline: selected ? '2px solid #2563eb' : 'none', outlineOffset: -1 }}>
      <div onClick={(e) => { e.stopPropagation(); onToggle(); }} style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, width: 24, height: 24, borderRadius: 7, border: '2px solid ' + (selected ? '#2563eb' : '#cbd5e1'), background: selected ? '#2563eb' : 'rgba(255,255,255,.92)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800 }}>{selected ? '✓' : ''}</div>
      {canFav && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleFav && onToggleFav(); }} title={fav ? (team ? 'Shared team favorite' : 'Your favorite') : (curate ? 'Add to the shared list' : 'Add to your favorites')}
          style={{ position: 'absolute', top: 8, left: 40, zIndex: 2, width: 26, height: 26, borderRadius: 7, border: 'none', background: 'rgba(255,255,255,.92)', cursor: 'pointer', fontSize: 16, lineHeight: '26px', padding: 0, color: fav ? '#f59e0b' : '#b6bcc6', boxShadow: '0 1px 3px rgba(0,0,0,.12)' }}>{fav ? '★' : '☆'}</button>
      )}
      <div style={{ position: 'relative', background: '#fff', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F0F1F4', width: '100%' }}>
        {p.image_front_url && !imgErr
          ? <img src={p.image_front_url} alt={p.name || ''} loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain', opacity: out ? 0.5 : 1 }} />
          : <div style={{ color: '#A8AEB8', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>No image</div>}
        {p.retail_price != null && (
          <span style={{ position: 'absolute', top: 10, right: 10, background: '#191919', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700 }}>{money(p.retail_price)}</span>
        )}
        {out && <span style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(185,28,28,.95)', color: '#fff', borderRadius: 5, padding: '2px 8px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' }}>{st.incoming ? 'Incoming' : 'Out of stock'}</span>}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, width: '100%' }}>
        <div>
          {p.brand && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A7180' }}>{p.brand}</div>}
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, lineHeight: 1.15, textTransform: 'uppercase' }}>{p.name || p.sku}</div>
          {team && <span style={{ fontSize: 10, fontWeight: 800, color: '#7c3aed', background: '#ede9fe', borderRadius: 5, padding: '1px 6px', marginTop: 3, display: 'inline-block' }}>★ Team pick</span>}
          <div style={{ fontSize: 12, color: '#6A7180', marginTop: 3 }}>{[p.category, p.color].filter(Boolean).join(' · ') || ' '}</div>
          {p.sku && <div style={{ fontSize: 11.5, color: '#9AA1AC', fontFamily: 'monospace', marginTop: 2 }}>{p.sku}</div>}
          {moreColors > 0 && <div style={{ fontSize: 11, color: '#6A7180', marginTop: 3, fontWeight: 600 }}>+{moreColors} more color{moreColors === 1 ? '' : 's'} · add later</div>}
        </div>
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
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} style={{ flex: 1, border: 'none', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.03em', background: selected ? '#dbeafe' : '#191919', color: selected ? '#1d4ed8' : '#fff' }}>{selected ? '✓ Selected' : 'Select'}</button>
          {onDetails && <button type="button" onClick={(e) => { e.stopPropagation(); onDetails(); }} title="Set price, fundraising & options" style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: '#3A4150' }}>Details →</button>}
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
  return (wl.find((w) => !((w.color_way || '').trim())) || wl[0]).url;
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
const DARK_WORDS = ['black', 'navy', 'royal', 'forest', 'maroon', 'charcoal', 'graphite', 'purple', 'brown', 'hunter', 'dark', 'midnight', 'kelly'];
const guessDark = (name) => { const s = (name || '').toLowerCase(); return DARK_WORDS.some((w) => s.includes(w)); };
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

function ArtTab({ catalog, stockByWp, decorationMode = 'in_house', libraryArt, storeArt = [], onSaveStoreArt, onSaveLogo, onAttachWebLogo, onApplyLogo, onSetItemDecorations, onSaveArtVariant, canMock, onOpenMockBuilder }) {
  const singles = (catalog || []).filter((c) => c.kind === 'single');
  const [activeId, setActiveId] = useState(storeArt[0]?.id || null);
  const [placement, setPlacement] = useState('left_chest');
  const [selected, setSelected] = useState(() => new Set()); // items chosen for bulk apply — none by default
  const [bulkOpen, setBulkOpen] = useState(false); // bulk apply is an opt-in next step, not the default view
  const [colorByItem, setColorByItem] = useState({}); // item id -> 'original' | 'white' | 'black'
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(true); // collapse the logo-picker section
  const [upBusy, setUpBusy] = useState(false);
  const fileRef = useRef();
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
  const place = ART_PLACEMENTS.find((p) => p.id === placement) || ART_PLACEMENTS[0];

  // Group store items into styles, each with its colorways.
  const groups = [];
  { const m = new Map();
    for (const it of singles) {
      const st = stockByWp[it.id] || {};
      const key = (it.display_name || st.name || it.sku || '').toUpperCase();
      let g = m.get(key);
      if (!g) { g = { key, name: it.display_name || st.name || it.sku, items: [] }; m.set(key, g); groups.push(g); }
      g.items.push({ id: it.id, sku: it.sku, img: it.image_url || st.image_front_url, color: st.color || '', decorations: it.decorations || [] });
    }
  }
  const choiceOf = (item) => colorByItem[item.id] || (guessDark(item.color) ? 'white' : 'original');
  const setChoice = (id, c) => setColorByItem((m) => ({ ...m, [id]: c }));
  const toggleItem = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const includedItems = singles.filter((it) => selected.has(it.id));
  const selectAll = () => setSelected(new Set(singles.map((it) => it.id)));
  const clearSel = () => setSelected(new Set());

  const apply = async () => {
    if (!activeArt || !activeUrl) return;
    setApplying(true); setDone('');
    try {
      const custId = activeArt._srcCustId;
      // Group the included items by their color choice so each recolor uploads once.
      const byChoice = { original: [], white: [], black: [] };
      for (const it of includedItems) byChoice[choiceOf(it)]?.push(it.id);
      const variantCache = {}; // choice -> art_url
      for (const choice of ['original', 'white', 'black']) {
        const ids = byChoice[choice]; if (!ids.length) continue;
        let artUrl = activeUrl;
        if (choice !== 'original') {
          const hex = choice === 'white' ? '#ffffff' : '#000000';
          const blob = await recolorToBlob(activeUrl, hex);
          const ext = isSvg(activeUrl) ? 'svg' : 'png';
          const file = new File([blob], `${(activeArt.name || 'logo').replace(/\s+/g, '-')}-${choice}.${ext}`, { type: blob.type });
          artUrl = await cloudUpload(file, 'nsa-store-art');
          variantCache[choice] = artUrl;
          // Save the recolored logo back to the library for reuse on future mocks.
          if (custId && onSaveArtVariant) await onSaveArtVariant(custId, activeArt.id, { label: choice === 'white' ? 'White' : 'Black', color: hex, art_url: artUrl, source: activeUrl });
        }
        await onApplyLogo(ids, { art_id: activeArt.id, art_url: artUrl, source_url: artSourceUrl(activeArt), placement, color_label: choice });
      }
      setDone(`Applied to ${includedItems.length} item${includedItems.length === 1 ? '' : 's'}.`);
    } catch (e) { setDone('Error: ' + (e.message || e)); }
    setApplying(false);
  };

  if (!libraryArt.length) {
    return <div className="card"><div style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
      No art in this team's library yet. Add artwork to the customer's art library (it's shared with order artwork), then it'll show here to apply to the store.
    </div></div>;
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
          {storeArt.map((a) => { const u = artThumbUrl(a); const on = a.id === activeId; return (
            <div key={a.id} style={{ position: 'relative', flex: '0 0 auto', width: 96 }}>
              <button onClick={() => setActiveId(a.id)} title={a.name} style={{ width: 96, border: on ? '2px solid #191919' : '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: 6, cursor: 'pointer' }}>
                <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 6, overflow: 'hidden' }}>
                  {u ? <img src={u} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} /> : <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textAlign: 'center', padding: '0 4px' }}>{(a.files || [])[0] ? 'AI only — add a web logo' : 'Add a web logo'}</span>}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Logo'}</div>
              </button>
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
                  <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 6, overflow: 'hidden' }}>
                    {u ? <img src={u} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 700, textAlign: 'center', padding: '0 3px' }}>{(a.files || [])[0] ? 'AI — add web logo' : 'Add web logo'}</span>}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Logo'}</div>
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
          a logo: pick placement, select which items, then apply & review them together. */}
      {activeArt && (!bulkOpen ? (
        <button onClick={() => activeUrl && setBulkOpen(true)} disabled={!activeUrl}
          style={{ width: '100%', textAlign: 'left', cursor: activeUrl ? 'pointer' : 'not-allowed', border: '1px solid #c7d2fe', background: activeUrl ? '#eef2ff' : '#f1f5f9', color: '#3730a3', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span><span style={{ fontSize: 15, fontWeight: 800 }}>Bulk-apply “{activeArt.name || 'this logo'}” to items →</span><br /><span style={{ fontSize: 12.5, color: activeUrl ? '#4f46e5' : '#94a3b8' }}>{activeUrl ? 'Optional next step — pick the items to put this logo on, recolor per garment, then apply.' : 'Attach a web logo above first.'}</span></span>
        </button>
      ) : (
        <div className="card"><div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Bulk-apply <span style={{ color: '#4f46e5' }}>{activeArt.name || 'logo'}</span></div>
            <button onClick={() => setBulkOpen(false)} className="btn btn-sm btn-secondary">✕ Close</button>
          </div>

          {/* Placement */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5 }}>1 · Placement</span>
            {ART_PLACEMENTS.map((p) => (
              <button key={p.id} onClick={() => setPlacement(p.id)} style={{ borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: placement === p.id ? '1px solid #191919' : '1px solid #d1d5db', background: placement === p.id ? '#191919' : '#fff', color: placement === p.id ? '#fff' : '#3A4150' }}>{p.label}</button>
            ))}
          </div>

          {/* Select items — none chosen by default; tap to pick, then review them together */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5 }}>2 · Select items <span style={{ fontWeight: 600, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>· tap the garments to apply this logo to ({includedItems.length} selected)</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={selectAll} className="btn btn-sm btn-secondary">Select all</button>
              <button onClick={clearSel} className="btn btn-sm btn-secondary" disabled={!includedItems.length}>Clear</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(124px,1fr))', gap: 14, alignItems: 'start' }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={g.name}>{g.name}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map((item) => { const ch = choiceOf(item); const sel3 = selected.has(item.id); const has = (item.decorations || []).some((d) => d.placement === placement); return (
                  <div key={item.id} onClick={() => toggleItem(item.id)} title={sel3 ? 'Tap to deselect' : 'Tap to select'} style={{ border: sel3 ? '2px solid #4f46e5' : '1px solid #e2e8f0', borderRadius: 10, padding: 6, background: '#fff', cursor: 'pointer' }}>
                    <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#fff', border: '1px solid #f1f5f9', borderRadius: 8, overflow: 'hidden' }}>
                      {item.img ? <img src={item.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 10 }}>No image</div>}
                      {(item.decorations || []).filter((d) => d && d.art_url && (d.side || 'front') === 'front').map((d, di) => { const pl = ART_PLACEMENTS.find((x) => x.id === d.placement) || place; const dx = d.x != null ? d.x : pl.x; const dy = d.y != null ? d.y : pl.y; const dw = d.w != null ? d.w : pl.w; return <img key={'ad' + di} src={d.art_url} alt="" style={{ position: 'absolute', left: `${dx}%`, top: `${dy}%`, width: `${dw}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} />; })}
                      {activeUrl && sel3 && <img src={activeUrl} alt="" style={{ position: 'absolute', left: `${place.x}%`, top: `${place.y}%`, width: `${place.w}%`, transform: 'translate(-50%,-50%)', filter: cssTint(ch), pointerEvents: 'none', opacity: 0.95 }} />}
                      <span style={{ position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 6, background: sel3 ? '#4f46e5' : 'rgba(255,255,255,.92)', border: sel3 ? 'none' : '1px solid #cbd5e1', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.18)' }}>{sel3 ? '✓' : ''}</span>
                      {has && <span style={{ position: 'absolute', top: 6, right: 6, background: '#166534', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5, textTransform: 'uppercase' }}>Applied</span>}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.color || '—'}</div>
                    {sel3 && <div style={{ display: 'flex', gap: 4, marginTop: 5 }} onClick={(e) => e.stopPropagation()}>
                      {[['original', 'Orig'], ['white', 'White'], ['black', 'Black']].map(([c, lbl]) => (
                        <button key={c} onClick={() => setChoice(item.id, c)} title={`Recolor: ${lbl}`} style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 6, cursor: 'pointer', border: ch === c ? '1px solid #191919' : '1px solid #d1d5db', background: ch === c ? '#191919' : '#fff', color: ch === c ? '#fff' : '#475569' }}>{lbl}</button>
                      ))}
                    </div>}
                  </div>
                ); })}
              </div>
            </div>
          ))}
          </div>

          {/* Sticky apply bar */}
          <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e6e8ec', padding: '12px 4px', marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {done && <span style={{ fontSize: 12.5, color: done.startsWith('Error') ? '#b91c1c' : '#166534', fontWeight: 700 }}>{done}</span>}
            <span style={{ fontSize: 12.5, color: '#64748b' }}>{includedItems.length} item{includedItems.length === 1 ? '' : 's'} · {place.label}{activeArt ? ` · ${activeArt.name}` : ''}</span>
            <button className="btn btn-primary" disabled={applying || !activeUrl || !includedItems.length} onClick={apply}>{applying ? 'Applying…' : includedItems.length ? `Apply to ${includedItems.length} item${includedItems.length === 1 ? '' : 's'}` : 'Select items to apply'}</button>
          </div>
        </div></div>
      ))}
    </div>
  );
}

function BundleBuilder({ storeItems = [], designOptions = [], numberSets = [], onCreate, onClose }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [fundraise, setFundraise] = useState('');
  const [image, setImage] = useState(null);
  const [components, setComponents] = useState([]);
  const [picking, setPicking] = useState(false);
  // ProductSearch returns {id,sku,name}; store items already carry {product_id,sku,name}.
  const addComp = (p) => { setComponents((c) => [...c, { product_id: p.product_id || p.id, sku: p.sku, name: p.name, qty: 1, size_required: true, takes_number: false, takes_name: false, name_upcharge: 0, transfer_code: '', num_transfer_size: null, num_transfer_color: null }]); setPicking(false); };
  const addedKeys = new Set(components.map((c) => c.product_id));
  const upd = (i, k, v) => setComponents((c) => c.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  const rm = (i) => setComponents((c) => c.filter((_, idx) => idx !== i));
  const valid = name.trim() && Number(price) > 0 && components.length > 0;
  const total = (Number(price) || 0) + (Number(fundraise) || 0);
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><div style={{ fontWeight: 700 }}>Create a package</div><button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>×</button></div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
        <Row label="Package name"><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Player Kit" /></Row>
        <Row label="Package price (X)"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="120.00" /></Row>
        <Row label="Fundraising on top (Y)"><input className="form-input" type="number" step="0.01" value={fundraise} onChange={(e) => setFundraise(e.target.value)} placeholder="0.00" /></Row>
        <Row label="Shopper pays"><div className="form-input" style={{ background: '#f8fafc', fontWeight: 700 }}>{money(total)}</div></Row>
      </div>
      <ImageUpload value={image} onChange={setImage} label="Package image" />
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Items in this package</div>
      {components.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}><b>{c.name}</b> <span style={{ color: '#94a3b8' }}>{c.sku}</span></div>
          <label style={{ fontSize: 12 }}>Qty <input type="number" min={1} value={c.qty} onChange={(e) => upd(i, 'qty', Number(e.target.value) || 1)} style={{ width: 50, marginLeft: 4 }} /></label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={c.size_required} onChange={(e) => upd(i, 'size_required', e.target.checked)} />needs size</label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={c.takes_number} onChange={(e) => upd(i, 'takes_number', e.target.checked)} />add number</label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={c.takes_name} onChange={(e) => upd(i, 'takes_name', e.target.checked)} />add name</label>
          {c.takes_name && <label style={{ fontSize: 12 }}>name +$<input type="number" step="0.01" min={0} value={c.name_upcharge} onChange={(e) => upd(i, 'name_upcharge', Number(e.target.value) || 0)} style={{ width: 60, marginLeft: 2 }} /></label>}
          <button onClick={() => rm(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer' }}>remove</button>
          <div style={{ flexBasis: '100%', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <label style={{ fontSize: 12 }}>Logo transfer <select value={c.transfer_code || ''} onChange={(e) => upd(i, 'transfer_code', e.target.value)} style={{ marginLeft: 4, fontSize: 12 }}><option value="">None</option>{designOptions.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</select></label>
            {c.takes_number && <label style={{ fontSize: 12 }}>Number set <select value={(c.num_transfer_size || '') + '|' + (c.num_transfer_color || '')} onChange={(e) => { const [s, cl] = e.target.value.split('|'); upd(i, 'num_transfer_size', s || null); upd(i, 'num_transfer_color', cl || null); }} style={{ marginLeft: 4, fontSize: 12 }}><option value="|">None</option>{numberSets.map((s, si) => <option key={si} value={`${s.size}|${s.color}`}>{s.size} · {s.color}</option>)}</select></label>}
          </div>
        </div>
      ))}
      {storeItems.length > 0 && <div style={{ margin: '10px 0' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>Add from items already in this store:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {storeItems.map((it) => {
            const added = addedKeys.has(it.product_id);
            return <button key={it.product_id} disabled={added} onClick={() => addComp(it)}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: added ? '#f1f5f9' : '#fff', color: added ? '#94a3b8' : '#1e40af', cursor: added ? 'default' : 'pointer' }}>
              {added ? '✓ ' : '+ '}{it.name}</button>;
          })}
        </div>
      </div>}
      {picking ? <ProductSearch label="Or search all products" onPick={addComp} onClose={() => setPicking(false)} /> :
        <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => setPicking(true)}>+ Search all products</button>}
      <div style={{ marginTop: 14 }}><button className="btn btn-primary" disabled={!valid} onClick={() => onCreate({ name: name.trim(), price: Number(price), fundraise: Number(fundraise) || 0, image_url: image, components })}>Create package</button></div>
    </div></div>
  );
}

// Coupons / scholarship codes. Bulk-generate single-use % codes for coaches,
// or free-shipping promos. Redemption count is tracked per code.
function CouponsTab({ store, coupons = [], orders = [], onCreate, onUpdate, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('percent');
  const [value, setValue] = useState(100);
  const [count, setCount] = useState(10);
  const [single, setSingle] = useState(true);
  const [coverShip, setCoverShip] = useState(true);
  const [prefix, setPrefix] = useState('');
  const [label, setLabel] = useState('');
  const [expires, setExpires] = useState('');
  const [generated, setGenerated] = useState(null); // codes from the last batch

  // Live redemption count = orders that used the code (more reliable than a counter).
  const usedByCode = {};
  orders.forEach((o) => { if (o.coupon_code && o.status !== 'cancelled' && o.status !== 'pending_payment') { const k = o.coupon_code.toUpperCase(); usedByCode[k] = (usedByCode[k] || 0) + 1; } });

  const submit = async () => {
    const r = await onCreate({ kind, value, count, single, prefix, batch_label: label, expires_at: expires || null, cover_shipping: coverShip });
    if (r && r.data) { setGenerated(r.data.map((c) => c.code)); setAdding(false); }
  };
  const copyAll = () => { if (generated) navigator.clipboard?.writeText(generated.join('\n')); };

  const sorted = [...coupons].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>Codes apply a discount at checkout. Single-use codes (one order each) are ideal for comping a player — the discounted order still gets batched and invoiced to the program.</div>
        <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { setAdding((v) => !v); setGenerated(null); }}>+ Create codes</button>
      </div>

      {adding && <div className="card"><div style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Row label="Type"><select className="form-select" value={kind} onChange={(e) => setKind(e.target.value)}><option value="percent">Percent off</option><option value="free_shipping">Free shipping</option></select></Row>
        {kind === 'percent' && <Row label="Percent off"><input className="form-input" type="number" min={1} max={100} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 90 }} /></Row>}
        <Row label="How many codes"><input className="form-input" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 90 }} /></Row>
        <Row label="Code prefix (optional)"><input className="form-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="SCHOL" style={{ width: 120 }} /></Row>
        <Row label="Batch label (optional)"><input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2026 scholarships" /></Row>
        <Row label="Expires (optional)"><input className="form-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Row>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}><input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} /> Single-use (one order per code)</label>
        {kind === 'percent' && <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}><input type="checkbox" checked={coverShip} onChange={(e) => setCoverShip(e.target.checked)} /> Also discount shipping</label>}
        <button className="btn btn-primary" onClick={submit}>Generate</button>
        <button className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
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
function AnalyticsTab({ orders: allOrders, orderItems, stockByWp }) {
  // Exclude abandoned pre-payment carts and cancellations from analytics.
  const orders = allOrders.filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled');
  if (!orders.length) return <Empty msg="No orders yet — analytics will appear once shoppers start ordering." />;
  const nameBySku = {}; Object.values(stockByWp).forEach((s) => { if (s.sku) nameBySku[s.sku] = s.name; });
  const revenue = orders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const fundraise = orders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const shipCollected = orders.reduce((a, o) => a + (Number(o.shipping_fee) || 0), 0);
  const shipCost = orders.reduce((a, o) => a + (Number(o.label_cost) || 0), 0);
  const shipNet = shipCollected - shipCost;
  const fundPaid = orders.filter((o) => o.status === 'paid').reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
  const fundPending = fundraise - fundPaid;
  const paid = orders.filter((o) => o.payment_mode === 'paid');
  const lines = orderItems.filter((i) => !i.is_bundle_parent);
  const units = lines.reduce((a, i) => a + (i.qty || 1), 0);

  const bySku = {}; lines.forEach((i) => { const k = i.sku || i.product_id || '?'; bySku[k] = (bySku[k] || 0) + (i.qty || 1); });
  const topSellers = Object.entries(bySku).map(([sku, q]) => ({ sku, q, name: nameBySku[sku] || sku })).sort((a, b) => b.q - a.q).slice(0, 8);
  const bySize = {}; lines.forEach((i) => { if (i.size) bySize[i.size] = (bySize[i.size] || 0) + (i.qty || 1); });
  const SZ = ['YXS', 'YS', 'YM', 'YL', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
  const sizeRows = Object.entries(bySize).sort((a, b) => { const ia = SZ.indexOf(a[0]), ib = SZ.indexOf(b[0]); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
  const byDay = {}; orders.forEach((o) => { const d = (o.created_at || '').slice(0, 10); if (d) byDay[d] = (byDay[d] || 0) + 1; });
  const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const maxSeller = Math.max(1, ...topSellers.map((s) => s.q));
  const maxDay = Math.max(1, ...days.map((d) => d[1]));

  const Bar = ({ frac, color }) => <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: Math.round(frac * 100) + '%', height: '100%', background: color }} /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        {[['Revenue', money(revenue)], ['Fundraising', money(fundraise), '#166534'], ['Orders', orders.length], ['Units', units], ['Avg order', money(revenue / orders.length)], ['Paid / Team tab', `${paid.length} / ${orders.length - paid.length}`],
          ...(shipCollected || shipCost ? [['Shipping collected', money(shipCollected)], ['Label cost (actual)', money(shipCost), '#b45309'], ['Shipping net', money(shipNet), shipNet >= 0 ? '#166534' : '#b91c1c']] : [])].map(([l, v, c]) => (
          <div key={l} className="card"><div style={{ padding: 14 }}><div style={{ fontSize: 22, fontWeight: 800, color: c || '#1e293b' }}>{v}</div><div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{l}</div></div></div>
        ))}
      </div>

      {fundraise > 0 && <div className="card" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}><div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#15803d', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Club fundraising payout</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#166534' }}>{money(fundPaid)}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>collected & owed to the club{fundPending > 0.005 ? ` · ${money(fundPending)} pending on unpaid/team-tab orders` : ''}</div>
        </div>
        <button className="btn btn-secondary" onClick={() => printPayout(store, { fundPaid, fundPending, orders: orders.length })}>🖨️ Print payout statement</button>
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
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Size breakdown</div>
          {sizeRows.length === 0 ? <div style={{ fontSize: 13, color: '#94a3b8' }}>No sized items.</div> : sizeRows.map(([sz, q]) => { const m = Math.max(...sizeRows.map((r) => r[1])); return <div key={sz} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13 }}><div style={{ width: 44, fontWeight: 700 }}>{sz}</div><Bar frac={q / m} color="#7c3aed" /><div style={{ width: 36, textAlign: 'right', fontWeight: 700 }}>{q}</div></div>; })}
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
function BatchesTab({ store, productStock, onOpenSO, catalog = [], bundleItems = [], orders = [], orderItems = [], transfers = [], onPullTransfers }) {
  const [sos, setSos] = useState(null);
  const [err, setErr] = useState('');
  const [ssMsg, setSsMsg] = useState({}); // soId -> status message
  const [ssErr, setSsErr] = useState({}); // soId -> [{order, msg}] from the last run
  const shipHome = store.delivery_mode !== 'deliver_club';
  const [trackMode, setTrackMode] = useState('batch'); // 'batch' (per-SO) | 'all' (overall store)
  // In-house on-hand by product → {size: qty}, for the "In Inv" column.
  const invProducts = useMemo(() => Object.values(productStock || {}).map((s) => ({ id: s.product_id, _inv: s.size_stock || {} })).filter((p) => p.id), [productStock]);
  // Per-customer-line incoming tracking, FIFO-allocated WITHIN each batch (SO),
  // then merged so the overall view can show every batch at once.
  const trackByLine = useMemo(() => {
    const merged = {};
    (sos || []).forEach((o) => {
      const bOrders = (orders || []).filter((w) => w.so_id === o.id).map((w) => ({ ...w, items: (orderItems || []).filter((i) => i.order_id === w.id) }));
      Object.assign(merged, computeOrderTracking({ orders: bOrders, so: { items: o.items }, products: invProducts, includeIF: true }));
    });
    return merged;
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
  // Webstore orders + items belonging to one batched SO.
  const batchGroups = (soId) => {
    const linked = orders.filter((o) => o.so_id === soId);
    return linked.map((o) => ({ order: o, items: orderItems.filter((i) => i.order_id === o.id) }));
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
      const { data: orders, error } = await supabase.from('sales_orders').select('id,status,created_at,memo,production_notes,_shipping_status,_tracking_number').eq('webstore_id', store.id).order('created_at', { ascending: false });
      if (error) { setErr(error.message); setSos([]); return; }
      const ids = (orders || []).map((o) => o.id);
      if (!ids.length) { setSos([]); return; }
      const { data: items } = await supabase.from('so_items').select('id,so_id,sku,name,product_id,sizes').in('so_id', ids);
      const itemIds = (items || []).map((i) => i.id);
      let picks = [], decos = [], jobs = [], pos = [];
      if (itemIds.length) {
        const [plRes, decoRes, poRes] = await Promise.all([
          supabase.from('so_item_pick_lines').select('so_item_id,sizes,status').in('so_item_id', itemIds),
          supabase.from('so_item_decorations').select('so_item_id,kind,position,type,num_method,deco_type,art_file_id').in('so_item_id', itemIds),
          supabase.from('so_item_po_lines').select('so_item_id,billed,received,sizes,status').in('so_item_id', itemIds),
        ]);
        picks = plRes.data || []; decos = decoRes.data || []; pos = poRes.data || [];
      }
      const { data: jobRes } = await supabase.from('so_jobs').select('so_id,art_name,deco_type,positions,art_status,prod_status,total_units,fulfilled_units').in('so_id', ids);
      jobs = jobRes || [];
      const pickedByItem = {};
      picks.forEach((p) => { if ((p.status || '') === 'pulled') { const t = sumSizes(p.sizes); pickedByItem[p.so_item_id] = (pickedByItem[p.so_item_id] || 0) + t; } });
      const decosByItem = {};
      decos.forEach((d) => { (decosByItem[d.so_item_id] = decosByItem[d.so_item_id] || []).push(d); });
      // Attach PO + pick lines per item so the per-customer tracking grid can
      // read Billed/Received (PO lines) and on-IF (pick lines).
      const picksByItem = {}; picks.forEach((p) => { (picksByItem[p.so_item_id] = picksByItem[p.so_item_id] || []).push(p); });
      const posByItem = {}; pos.forEach((p) => { (posByItem[p.so_item_id] = posByItem[p.so_item_id] || []).push(p); });
      setSos((orders || []).map((o) => ({ ...o, items: (items || []).filter((i) => i.so_id === o.id).map((it) => ({ ...it, po_lines: posByItem[it.id] || [], pick_lines: picksByItem[it.id] || [] })), pickedByItem, decosByItem, jobs: jobs.filter((j) => j.so_id === o.id) })));
    })();
  }, [store.id]);

  if (sos === null) return <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}>Loading batches…</div>;
  if (err) return <Empty msg={'Could not load batches: ' + err} />;
  if (!sos.length) return <Empty msg="No Sales Orders batched from this store yet. Use Orders → Create Sales Order." />;

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

  const allWOrders = (orders || []).filter((w) => sos.some((o) => o.id === w.so_id)).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const tBtn = (mode, label) => <button onClick={() => setTrackMode(mode)} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid ' + (trackMode === mode ? '#0f172a' : '#e2e8f0'), background: trackMode === mode ? '#0f172a' : '#fff', color: trackMode === mode ? '#fff' : '#334155', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{label}</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>Tracking view:</span>
        {tBtn('batch', '📦 By batch')}
        {tBtn('all', '🏬 All orders (overall)')}
      </div>
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
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: '#1e40af', cursor: 'pointer' }} onClick={() => onOpenSO && onOpenSO(o.id)}>{o.id} ↗</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{o.memo}</div>
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
              {renderTrackTable((orders || []).filter((w) => w.so_id === o.id).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))))}
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

function DecoStat({ label, value }) {
  const v = (value || 'pending').replace(/_/g, ' ');
  const done = /complete|approved|done|art_complete/i.test(value || '');
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 5, background: done ? '#dcfce7' : '#f1f5f9', color: done ? '#166534' : '#475569' }}>{label}: {v}</span>;
}

function OrdersTab({ orders, orderItems, numbersEnabled, onBatch, onAvailabilityReport, onPlayerReport, onStockReport, onExportCsv, availSizes = {}, onSaveOrderEdits, onRefundOrder, cu, store, msgTagIds = [] }) {
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
  const enrich = (o) => {
    const items = itemsByOrder[o.id] || [];
    return { o, items, players: [...new Set(items.map((i) => i.player_name).filter(Boolean))], numbers: [...new Set(items.map((i) => i.player_number).filter(Boolean))], lineStatus: items[0]?.line_status || 'pending' };
  };
  const unbatchedCount = orders.filter((o) => !o.so_id && o.status !== 'pending_payment' && o.status !== 'cancelled').length;

  const filtered = orders.map(enrich).filter(({ o, players, numbers, lineStatus }) => {
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

  if (!orders.length) return <Empty msg="No orders placed in this store yet." />;
  const sel = { padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, background: '#fff' };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" style={{ flex: 1, minWidth: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, parent, email, number…" />
        <select style={sel} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>{['all', 'pending', 'in_production', 'shipped', 'complete'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}</select>
        <select style={sel} value={fPay} onChange={(e) => setFPay(e.target.value)}><option value="all">All payment</option><option value="paid">Paid</option><option value="unpaid">Team tab</option></select>
        <select style={sel} value={fBatch} onChange={(e) => setFBatch(e.target.value)}><option value="all">All</option><option value="unbatched">Not batched</option><option value="batched">Batched</option></select>
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
        <button className="btn btn-primary" disabled={!unbatchedCount} onClick={onBatch} title={unbatchedCount ? '' : 'No unbatched orders'} style={!unbatchedCount ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
          Create Sales Order ({unbatchedCount})
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Showing {filtered.length} of {orders.length} orders.</div>
      <div className="card"><div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={{ ...th, width: 22 }}></th><th style={th}>Buyer / Player</th>{numbersEnabled && <th style={th}>#</th>}<th style={th}>Items</th><th style={th}>Kind</th><th style={th}>Paid?</th><th style={th}>Total</th><th style={th}>Status</th><th style={th}>SO</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {filtered.map(({ o, items, players, numbers, lineStatus }) => {
              const isOpen = expanded === o.id;
              const lineItems = items.filter((i) => !i.is_bundle_parent);
              const shortTotal = lineItems.reduce((a, i) => a + (Number(i.missing_qty) || 0), 0);
              const shippedLines = lineItems.filter((i) => i.line_status === 'shipped').length;
              return (
              <React.Fragment key={o.id}>
              <tr style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: isOpen ? '#f8fafc' : '#fff' }} onClick={() => setExpanded(isOpen ? null : o.id)}>
                <td style={{ ...td, width: 22, color: '#94a3b8' }}>{isOpen ? '▾' : '▸'}</td>
                <td style={td}><div style={{ fontWeight: 600 }}>{o.buyer_name || '—'}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{players.join(', ') || o.buyer_email}</div></td>
                {numbersEnabled && <td style={td}>{numbers.join(', ') || '—'}</td>}
                <td style={td}>{lineItems.reduce((a, i) => a + (i.qty || 0), 0)}{shippedLines > 0 && <span style={{ color: '#166534', fontWeight: 700 }}> · {shippedLines} shipped</span>}{shortTotal > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> · {shortTotal} short</span>}</td>
                <td style={td}>{o.order_kind === 'bulk' ? <Chip label="Bulk" tone="blue" /> : <Chip label="Individual" />}</td>
                <td style={td}>{o.payment_mode === 'paid' ? <Chip label="Paid" tone="green" /> : <Chip label="Team tab" />}{Number(o.refunded_amt) > 0 && <div style={{ fontSize: 10, color: '#b45309' }}>−{money(o.refunded_amt)} refunded</div>}{Number(o.discount_amt) > 0 && <div style={{ fontSize: 10, color: '#16a34a' }}>{o.coupon_code} −{money(o.discount_amt)}</div>}</td>
                <td style={td}>{money(o.total)}</td>
                <td style={td}><Chip label={(o.status === 'refunded' ? 'refunded' : lineStatus || 'pending').replace(/_/g, ' ')} tone={o.status === 'refunded' ? 'gray' : lineStatus === 'complete' ? 'green' : lineStatus === 'shipped' ? 'blue' : 'slate'} /></td>
                <td style={td}>{o.so_id ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1e40af' }}>{o.so_id}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>{(onSaveOrderEdits || onRefundOrder) && <button className="btn btn-sm btn-secondary" onClick={() => setEditId(o.id)}>Manage</button>}</td>
              </tr>
              {isOpen && (
                <tr style={{ background: '#f8fafc' }}>
                  <td colSpan={colCount} style={{ padding: '4px 16px 16px' }} onClick={(e) => e.stopPropagation()}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 4 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>{['Item', 'Size', 'Player', 'Qty', 'Ship', 'Short / missing'].map((h) => <th key={h} style={{ ...th, fontSize: 10.5 }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {lineItems.map((i) => (
                          <tr key={i.id} style={{ borderTop: '1px solid #eef1f5' }}>
                            <td style={td}>{i.sku || i.name || '—'}</td>
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
  const [rows, setRows] = useState(() => editable.map((i) => ({ id: i.id, sku: i.sku, size: i.size || '', qty: i.qty || 1, unit_price: i.unit_price, unit_fundraise: i.unit_fundraise, product_id: i.product_id, player_number: i.player_number, player_name: i.player_name, _removed: false })));
  const [refundAmt, setRefundAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (id, k, v) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const remaining = (Number(order.total) || 0) - (Number(order.refunded_amt) || 0);
  const newSubtotal = rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_price) || 0) * (Number(r.qty) || 1), 0);
  const newFund = rows.filter((r) => !r._removed).reduce((a, r) => a + (Number(r.unit_fundraise) || 0) * (Number(r.qty) || 1), 0);
  const newTotal = Math.max(0, newSubtotal + newFund - (Number(order.discount_amt) || 0)) + (Number(order.shipping_fee) || 0);

  const save = async () => { setBusy(true); const r = await onSave(order, rows); setBusy(false); if (r && r.ok) onClose(); };
  const refund = async () => { setBusy(true); const r = await onRefund(order, Number(refundAmt)); setBusy(false); if (r && r.ok) { setRefundAmt(''); onClose(); } };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 620, width: '100%', marginTop: 24 }}>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Manage order — {order.buyer_name || order.buyer_email}</h3>
            <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
          </div>
          {order.so_id && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, padding: '8px 12px', borderRadius: 8, margin: '8px 0 14px' }}>⚠️ This order is already batched into Sales Order <b>{order.so_id}</b>. Edits here won't automatically update that production order — adjust the SO too if needed.</div>}

          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', margin: '10px 0 6px' }}>Items</div>
          {rows.map((r) => {
            const sizes = availSizes[r.product_id] || [];
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9', opacity: r._removed ? 0.4 : 1 }}>
                <div style={{ flex: 1, fontSize: 13 }}><div style={{ fontWeight: 600 }}>{r.sku || 'Item'}</div>{(r.player_number || r.player_name) && <div style={{ fontSize: 11, color: '#94a3b8' }}>{[r.player_number && '#' + r.player_number, r.player_name].filter(Boolean).join(' · ')}</div>}</div>
                {sizes.length > 0
                  ? <select value={r.size} disabled={r._removed} onChange={(e) => upd(r.id, 'size', e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }}><option value="">size</option>{sizes.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                  : <input value={r.size} disabled={r._removed} onChange={(e) => upd(r.id, 'size', e.target.value)} placeholder="size" style={{ width: 64, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />}
                <input type="number" min={1} value={r.qty} disabled={r._removed} onChange={(e) => upd(r.id, 'qty', e.target.value)} style={{ width: 56, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
                <button onClick={() => upd(r.id, '_removed', !r._removed)} style={{ background: 'none', border: 'none', color: r._removed ? '#2563eb' : '#b91c1c', cursor: 'pointer', fontSize: 12 }}>{r._removed ? 'undo' : 'remove'}</button>
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 14 }}>
            <span style={{ color: '#64748b' }}>New total {Number(order.discount_amt) > 0 ? `(after ${money(order.discount_amt)} discount)` : ''}</span>
            <span style={{ fontWeight: 800 }}>{money(newTotal)} {newTotal !== (Number(order.total) || 0) && <span style={{ color: '#94a3b8', fontWeight: 400, textDecoration: 'line-through' }}>{money(order.total)}</span>}</span>
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={save} style={{ marginTop: 12 }}>Save item changes</button>

          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', margin: '22px 0 6px', borderTop: '1px solid #eef1f5', paddingTop: 16 }}>Refund</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            {order.stripe_pi_id ? 'Refunds the buyer’s card via Stripe.' : 'Team-tab order — records a credit/adjustment (no card to refund).'}
            {Number(order.refunded_amt) > 0 && <> Already refunded {money(order.refunded_amt)}; up to <b>{money(remaining)}</b> remaining.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#64748b' }}>$</span>
            <input type="number" min={0} step="0.01" value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} placeholder={remaining.toFixed(2)} style={{ width: 120, padding: '8px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 14 }} />
            <button className="btn btn-sm btn-secondary" onClick={() => setRefundAmt(remaining.toFixed(2))}>Full ({money(remaining)})</button>
            <button className="btn btn-primary" disabled={busy || !(Number(refundAmt) > 0)} onClick={refund} style={{ background: '#b91c1c', borderColor: '#b91c1c' }}>{order.stripe_pi_id ? 'Refund to card' : 'Record credit'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RosterTab({ roster, notOrdered }) {
  if (!roster.length) return <Empty msg="No roster uploaded. Upload one (coming in a later step) to track who hasn't ordered." />;
  return (
    <>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>{notOrdered.length} of {roster.length} players have not ordered yet.</div>
      <div className="card"><div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Player</th><th style={th}>#</th><th style={th}>Parent email</th><th style={th}>Ordered?</th>
          </tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}>{r.player_name}</td><td style={td}>{r.player_number || '—'}</td><td style={td}>{r.parent_email || '—'}</td>
                <td style={td}>{r.ordered ? <Chip label="Ordered" tone="green" /> : <Chip label="Not yet" tone="gray" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}

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
