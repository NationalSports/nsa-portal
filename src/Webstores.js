/* eslint-disable */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { cloudUpload, sendBrevoEmail, authFetch, invokeEdgeFn } from './utils';
import { shipStationCall } from './vendorApis';
import { NSA, pantoneHex } from './constants';
import { CatalogKitStyles, KitScope, DISPLAY, BODY, FilterBtn, ShowMore } from './ui/catalogKit';
import { fetchStockMap } from './lib/storeInventory';
import { ART_PLACEMENTS, placementById } from './lib/artPlacements';
import QuickMockBuilder from './QuickMockBuilder';

const SS_CARRIERS = { fedex: { carrierCode: 'fedex', serviceCode: 'fedex_ground' }, ups: { carrierCode: 'ups', serviceCode: 'ups_ground' }, usps: { carrierCode: 'stamps_com', serviceCode: 'usps_priority_mail' } };

// Create a ShipStation label (base64 PDF) for one ship-to-home webstore order.
// Order ship weight (lbs): sum per-item weights (catalog override or estimate);
// fall back to the store's flat weight if nothing resolves.
function labelWeightLbs(items, store, weightByPid = {}) {
  let oz = 0, any = false;
  (items || []).filter((i) => !i.is_bundle_parent).forEach((i) => {
    const w = (weightByPid && weightByPid[i.product_id]) || estimateWeightOz(i.sku || i.name);
    oz += w * (i.qty || 1); any = true;
  });
  if (any && oz > 0) return Math.max(0.1, Math.round(oz / 16 * 10) / 10);
  return Number(store.label_weight_lbs) || 1;
}

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
  return { labelData: res.labelData, trackingNumber: res.trackingNumber, carrier: cm.carrierCode, cost: res.shipmentCost != null ? Number(res.shipmentCost) + (Number(res.insuranceCost) || 0) : null };
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

// Render base64 PDF labels into one printable window.
function printLabels(labels) {
  const embeds = labels.map((b64) => `<div class="lp"><embed src="data:application/pdf;base64,${b64}" type="application/pdf" width="100%" height="100%"></div>`).join('');
  printHtml(`<!doctype html><html><head><title>Shipping labels</title><style>body{margin:0}.lp{width:100%;height:6in;page-break-after:always}</style></head><body>${embeds || 'No labels.'}</body></html>`);
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
        <div style={{ width: 60, height: 60, borderRadius: 10, background: '#fff', border: '1px solid #eef0f3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {shown ? <img src={shown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 700, textTransform: 'uppercase' }}>none</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3A4150' }}>{busy ? 'Uploading…' : over ? 'Drop the image' : value ? 'Replace image' : 'Drag an image here, or click to browse'}</div>
          {!value && fallback && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>Using stock photo — drop one to override.</div>}
          {err && <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 3 }}>{err}</div>}
        </div>
        {value && <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null); }} style={{ background: 'none', border: '1px solid #e2e6ec', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, color: '#b91c1c', cursor: 'pointer' }}>Remove</button>}
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
function estimateWeightOz(text) {
  const t = (text || '').toLowerCase();
  const rules = [
    [/back ?pack|duffel|duffle|equipment bag|gear bag/, 28],
    [/tote|sackpack|cinch|drawstring|bag/, 10],
    [/jacket|coat|parka|fleece|pullover|hoodie|hooded|sweatshirt|quarter ?zip|1\/4 ?zip|half ?zip|1\/2 ?zip/, 18],
    [/sweatpant|jogger|tearaway|pant|legging|tight/, 12],
    [/short/, 7],
    [/jersey|tank|singlet/, 5],
    [/tee|t-?shirt|shirt|polo|jersey top|top|warmup|warm-?up/, 6],
    [/beanie|hat|cap|visor/, 3],
    [/sock|glove|belt|headband|wristband|scrunchie/, 2],
    [/bottle|tumbler|mug/, 14],
    [/ball/, 16],
    [/blanket|towel/, 20],
  ];
  for (const [re, oz] of rules) if (re.test(t)) return oz;
  return 8; // generic garment default
}

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

function Webstores({ cust = [], REPS = [], repCsr = [], onCreateSO, onOpenSO }) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('catalog');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(null);   // null | 'new' | storeObj (settings edit)
  const [toast, setToast] = useState(null);

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); }, []);

  const custName = useCallback((id) => cust.find((c) => c.id === id)?.name || '—', [cust]);
  const repName = useCallback((id) => REPS.find((r) => r.id === id)?.name || '—', [REPS]);

  // Read-only coach/director portal link for a store's club (keyed on alpha_tag).
  const coachPortalUrl = useCallback((store) => {
    const c = cust.find((x) => x.id === store?.customer_id);
    const tag = c?.alpha_tag || c?.name || '';
    return tag ? `${window.location.origin}/?portal=${encodeURIComponent(tag)}` : '';
  }, [cust]);

  const emailDirector = useCallback(async (store) => {
    const url = coachPortalUrl(store);
    if (!url) { flash('No club alpha tag found for the portal link'); return; }
    if (!store.director_email) { flash('Add a Club Director email in Settings first'); return; }
    const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1e293b;max-width:600px">
      <p>Hi ${store.director_name || 'Coach'},</p>
      <p>Here's your live tracking portal for the <b>${store.name}</b> team store. You can watch orders come in and follow each one through production and shipping.</p>
      <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700">Open your team portal</a></p>
      <p style="font-size:12px;color:#64748b">Or paste this link into your browser:<br>${url}</p>
    </div>`;
    const r = await sendBrevoEmail({ to: [{ email: store.director_email, name: store.director_name || '' }], subject: `Your ${store.name} team portal`, htmlContent: html, senderName: 'National Sports Apparel', senderEmail: 'noreply@nationalsportsapparel.com' });
    if (r && r.error) flash('Email failed: ' + r.error);
    else flash('Portal link emailed to ' + store.director_email);
  }, [coachPortalUrl, flash]);

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

  const loadDetail = useCallback(async (store) => {
    setDetailLoading(true);
    const sid = store.id;
    const [catRes, bundleRes, stockRes, ordRes, itemRes, rosterRes, claimRes, transferRes, couponRes] = await Promise.all([
      supabase.from('webstore_products').select('*').eq('store_id', sid).order('sort_order'),
      supabase.from('webstore_bundle_items').select('*').order('sort_order'),
      supabase.from('webstore_storefront_products').select('webstore_product_id,product_id,size_stock,on_order_qty,earliest_eta,vendor_size_stock,vendor_on_hand,available_sizes,vendor_eta,name,color,category,image_front_url').eq('store_id', sid),
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
    if (pidList.length) {
      const { data: costRows } = await supabase.from('products').select('id,nsa_cost,is_clearance,clearance_cost').in('id', pidList);
      for (const cp of costRows || []) {
        const cc = (cp.is_clearance && cp.clearance_cost != null) ? Number(cp.clearance_cost) : Number(cp.nsa_cost);
        costByPid[cp.id] = Number.isFinite(cc) ? cc : null;
      }
    }
    const catIds = new Set(catalog.map((c) => c.id));
    const orders = ordRes.data || [];
    const orderIds = new Set(orders.map((o) => o.id));
    const stockByWp = {}; (stockRes.data || []).forEach((s) => { stockByWp[s.webstore_product_id] = s; });
    // Customer art LIBRARY (+ parent-customer cascade) — the source for the Art
    // panel. Staff-readable; applied art is denormalized onto items so the public
    // storefront never needs to read it.
    let libraryArt = [];
    if (store.customer_id) {
      const { data: cust } = await supabase.from('customers').select('id,parent_id,art_files,alpha_tag,name').eq('id', store.customer_id).maybeSingle();
      const own = (cust?.art_files || []).map((a) => ({ ...a, _src: 'library', _srcLabel: 'Team library', _srcCustId: cust.id }));
      let parentArt = [];
      if (cust?.parent_id) {
        const { data: par } = await supabase.from('customers').select('art_files,alpha_tag,name').eq('id', cust.parent_id).maybeSingle();
        parentArt = (par?.art_files || []).map((a) => ({ ...a, _src: 'parent', _srcLabel: (par?.alpha_tag || par?.name || 'Parent') + ' library', _srcCustId: cust.parent_id }));
      }
      libraryArt = [...own, ...parentArt].filter((a) => !a.archived);
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
    });
    setDetailLoading(false);
  }, []);

  const openStore = useCallback(async (store) => {
    setSel(store); setTab('catalog'); setDetail(null);
    await loadDetail(store);
  }, [loadDetail]);

  // ── writes ──────────────────────────────────────────────────────────
  // When a coach-built store is published (draft→open), email the coach the link.
  const notifyCoachPublished = useCallback(async (store) => {
    const to = (store.coach_contact_email || '').trim();
    if (!to) { flash('Published (no coach email on file to notify).'); return; }
    const safe = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const url = `${window.location.origin}/shop/${store.slug}`;
    try {
      await sendBrevoEmail({
        to: [{ email: to }],
        subject: `Your team store is live: ${store.name}`,
        htmlContent: `<p>Good news — your team store <b>${safe(store.name)}</b> is now live!</p>\n<p><a href="${url}">${url}</a></p>\n<p>Share that link with your team. Thanks for building with National Sports Apparel!</p>`,
      });
      flash('Published — coach notified by email.');
    } catch (e) { flash('Published (coach email failed: ' + (e.message || e) + ').'); }
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
  const setStoreStatus = useCallback(async (store, status) => {
    const { data, error } = await supabase.from('webstores').update({ status, updated_at: new Date().toISOString() }).eq('id', store.id).select().single();
    if (error) { flash('Could not update status: ' + error.message); return; }
    setStores((prev) => prev.map((s) => (s.id === store.id ? data : s)));
    if (sel?.id === store.id) setSel(data);
    if (store.status !== 'open' && status === 'open' && data.created_via === 'coach') notifyCoachPublished(data);
    flash(status === 'open' ? 'Store launched — it’s live' : `Store ${status}`);
  }, [sel, flash, notifyCoachPublished]);

  const duplicateStore = useCallback(async (src, opts = {}) => {
    if (!window.confirm(`Duplicate "${src.name}"? This copies the catalog, packages and transfer setup into a new draft store (no orders).`)) return;
    // Unique slug: <slug>-copy, then -copy-2, -copy-3…
    const taken = new Set(stores.map((s) => s.slug));
    let slug = slugify(src.name) + '-copy';
    if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
    const { id, created_at, updated_at, ...rest } = src;
    const payload = { ...rest, name: src.name + (opts.suffix != null ? opts.suffix : ' (Copy)'), slug, status: 'draft', open_at: null, close_at: null, is_template: false };
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

  const addSingle = useCallback(async ({ product, price, fundraise, image_url, takes_number, takes_name, name_upcharge, transfer_codes, num_transfer_sets }) => {
    const row = { store_id: sel.id, kind: 'single', product_id: product.id, sku: product.sku, retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, image_url: image_url || null, takes_number: !!takes_number, takes_name: !!takes_name, name_upcharge: Number(name_upcharge) || 0, transfer_codes: transfer_codes || [], num_transfer_sets: takes_number ? (num_transfer_sets || []) : [], active: true, sort_order: (detail?.catalog?.length || 0) };
    const { error } = await supabase.from('webstore_products').insert(row);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Added ' + (product.name || product.sku)); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  const updateImage = useCallback(async (id, url) => {
    const { error } = await supabase.from('webstore_products').update({ image_url: url || null }).eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    flash(url ? 'Image updated' : 'Image removed'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

  const updateCatalogItem = useCallback(async (id, fields) => {
    const { error } = await supabase.from('webstore_products').update(fields).eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    flash('Item updated'); loadDetail(sel);
  }, [sel, flash, loadDetail]);

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
      const next = existing.filter((d) => d.placement !== decoration.placement).concat([decoration]);
      await supabase.from('webstore_products').update({ decorations: next }).eq('id', id);
    }
    flash(`Logo applied to ${itemIds.length} item${itemIds.length === 1 ? '' : 's'}`); loadDetail(sel);
  }, [detail, sel, flash, loadDetail]);

  const setItemDecorations = useCallback(async (itemId, decorations) => {
    const { error } = await supabase.from('webstore_products').update({ decorations }).eq('id', itemId);
    if (error) { flash('Error: ' + error.message); return; }
    loadDetail(sel);
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

  // Batch all not-yet-batched orders into one Sales Order via the app's normal
  // SO creation path (onCreateSO), then link each order back to the new SO id.
  const batchOrders = useCallback(async () => {
    if (!sel || !detail || !onCreateSO) return;
    const open = (detail.orders || []).filter((o) => !o.so_id && o.status !== 'pending_payment' && o.status !== 'cancelled');
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
    const msg = shortages.length ? `${head}\n\n⚠️ Inventory shortfalls for this batch:\n${shortages.join('\n')}\n\nThese may need a PO or backorder. Create the Sales Order anyway?` : head;
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
    const soItems = Object.values(byProduct).map((g) => {
      const info = pinfo[g.product_id] || {};
      const pdef = personalize[g.product_id] || {};
      const decorations = [];
      // Numbers / names attach as deco lines with the actual values (roster/names
      // keyed by size), NOT as free-text production notes.
      if (pdef.num && hasVals(g.numbers)) decorations.push({ kind: 'numbers', position: 'Back', num_method: 'screen_print', num_size: '6"', two_color: false, sell_override: null, custom_font_art_id: null, roster: g.numbers });
      if (pdef.name && hasVals(g.names)) decorations.push({ kind: 'names', position: 'Back Center', sell_override: null, sell_each: 6, cost_each: 3, names: g.names });
      return { sku: g.sku || info.sku || '', name: info.name || g.sku || 'Item', brand: info.brand || '', color: info.color || '',
        product_id: g.product_id || null, nsa_cost: info.nsa_cost || 0, retail_price: info.retail_price || 0, unit_sell: info.retail_price || 0,
        sizes: g.sizes, available_sizes: Object.keys(g.sizes), no_deco: decorations.length === 0, decorations, pick_lines: [], po_lines: [] };
    });

    const units = soItems.reduce((a, i) => a + Object.values(i.sizes).reduce((b, v) => b + v, 0), 0);
    const notes = `Webstore: ${sel.name} (/shop/${sel.slug})\n${open.length} orders · ${units} units · delivery: ${sel.delivery_mode === 'deliver_club' ? 'deliver to club' : 'ship to home'}\nNames & numbers are on each item's deco lines.`;

    const soId = onCreateSO({ customer_id: sel.customer_id, memo: `${sel.name} webstore — ${open.length} orders`, production_notes: notes, items: soItems, webstore_id: sel.id });
    if (!soId) { flash('Could not create Sales Order'); return; }
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
  const moveItem = useCallback(async (item, beforeId) => {
    const list = [...(detail?.catalog || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const fromIdx = list.findIndex((x) => x.id === item.id);
    if (fromIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    let toIdx = beforeId == null ? list.length : list.findIndex((x) => x.id === beforeId);
    if (toIdx < 0) toIdx = list.length;
    list.splice(toIdx, 0, moved);
    for (let i = 0; i < list.length; i++) {
      if ((list[i].sort_order || 0) !== i) await supabase.from('webstore_products').update({ sort_order: i }).eq('id', list[i].id);
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

      {editing ? (
        <StoreForm cust={cust} REPS={REPS} repCsr={repCsr} store={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={async (form) => { const r = await saveStore(form, editing === 'new' ? null : editing.id); if (r.error) return r; setEditing(null); return r; }} />
      ) : sel ? (
        <StoreDetail store={sel} detail={detail} loading={detailLoading} tab={tab} setTab={setTab}
          custName={custName} repName={repName}
          onBack={() => { setSel(null); setDetail(null); }}
          onEdit={() => setEditing(sel)} onOpenSO={onOpenSO} onSetStatus={setStoreStatus}
          onAddSingle={addSingle} onCreateBundle={createBundle} onRemove={removeCatalogItem} onUpdateImage={updateImage} onBatch={batchOrders} onReorder={reorderItem} onMove={moveItem} onUpdateItem={updateCatalogItem}
          onUpdateTransfer={updateTransfer} onAddTransfers={addTransfers} onRemoveTransfer={removeTransfer} onPullTransfers={pullBatchTransfers}
          onCreateCoupons={createCoupons} onUpdateCoupon={updateCoupon} onRemoveCoupon={removeCoupon}
          onSaveOrderEdits={saveOrderEdits} onRefundOrder={refundOrder}
          onApplyLogo={applyLogoToItems} onSetItemDecorations={setItemDecorations} onSaveArtVariant={saveArtVariant} onSaveMocks={saveStoreMocks} onFlash={flash}
          portalUrl={coachPortalUrl(sel)} onEmailDirector={() => emailDirector(sel)} />
      ) : (
        <ListView stores={stores} custName={custName} repName={repName} onOpen={openStore} onNew={() => setEditing('new')} onDuplicate={duplicateStore} onToggleTemplate={toggleTemplate} onNewFromTemplate={(t) => duplicateStore(t, { suffix: '' })} />
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

function ListView({ stores, custName, repName, onOpen, onNew, onDuplicate, onToggleTemplate, onNewFromTemplate }) {
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
                    {onDuplicate && <button className="btn btn-sm btn-secondary" title="Duplicate this store" onClick={(e) => { e.stopPropagation(); onDuplicate(s); }}>Duplicate</button>}
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
  theme: 'classic', primary_color: '#0f172a', accent_color: '#2563eb', logo_url: '', banner_url: '', hero_blurb: '',
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
      </Section>

      <Section title="Ordering & payment">
        <Row label="Payment mode"><select className="form-select" value={f.payment_mode} onChange={(e) => set('payment_mode', e.target.value)}>
          <option value="paid">Card only (parents pay)</option><option value="unpaid">Invoice only (team tab)</option><option value="either">Both — card or team tab</option>
        </select></Row>
        <Row label="SO creation"><select className="form-select" value={f.so_creation} onChange={(e) => set('so_creation', e.target.value)}>{['manual', 'on_close', 'daily', 'weekly'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Row>
        <Toggle label={`Require login (${noun.toLowerCase()} members only)`} checked={f.require_login} onChange={(v) => set('require_login', v)} />
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
function StoreDetail({ store: s, detail, loading, tab, setTab, custName, repName, onBack, onEdit, onOpenSO, onSetStatus, onAddSingle, onCreateBundle, onRemove, onUpdateImage, onBatch, onReorder, onMove, onUpdateItem, onUpdateTransfer, onAddTransfers, onRemoveTransfer, onPullTransfers, onCreateCoupons, onUpdateCoupon, onRemoveCoupon, onSaveOrderEdits, onRefundOrder, onApplyLogo, onSetItemDecorations, onSaveArtVariant, onSaveMocks, onFlash, portalUrl, onEmailDirector }) {
  const [portalCopied, setPortalCopied] = useState(false);
  const [showMock, setShowMock] = useState(false);
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

  const TABS = [
    { id: 'catalog', label: `Catalog (${catalog.length})` },
    { id: 'art', label: 'Art & Logos' },
    { id: 'orders', label: `Orders (${orders.length})` },
    { id: 'batches', label: soSummary.length ? `Batches (${soSummary.length})` : 'Batches' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'coupons', label: (detail?.coupons || []).length ? `Coupons (${(detail.coupons || []).length})` : 'Coupons' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'roster', label: roster.length ? `Roster (${roster.length})` : 'Roster' },
    { id: 'settings', label: 'Settings' },
  ];
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
          {portalUrl && <button className="btn btn-sm btn-secondary" title={portalUrl} onClick={copyPortal}>{portalCopied ? '✓ Copied' : 'Copy coach portal link'}</button>}
          {portalUrl && <button className="btn btn-sm btn-secondary" title={s.director_email ? `Email ${s.director_email}` : 'Add a director email in Settings'} disabled={!s.director_email} onClick={onEmailDirector} style={!s.director_email ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>Email director</button>}
          {onSetStatus && (s.status !== 'open'
            ? <button className="btn btn-sm" style={{ background: '#166534', color: '#fff', fontWeight: 700 }} onClick={() => onSetStatus(s, 'open')} title="Make this store live for shoppers">🚀 Launch store</button>
            : <button className="btn btn-sm btn-secondary" onClick={() => onSetStatus(s, 'closed')} title="Stop taking orders">Close store</button>)}
          <button className="btn btn-sm btn-primary" onClick={onEdit}>Edit settings</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{s.name}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)} · <span style={{ fontFamily: 'monospace' }}>/shop/{s.slug}</span></div>
            <div style={{ marginTop: 6 }}><StatusBadge status={s.status} /></div>
          </div>
          <div style={{ display: 'flex', gap: 18, textAlign: 'right' }}>
            <Stat label="Orders" value={orders.length} />
            <Stat label="Players" value={playerCount} />
            <Stat label="Sales" value={money(totalSales)} />
            {fundraiseTotal > 0 && <Stat label="Fundraising" value={money(fundraiseTotal)} tone="#166534" />}
          </div>
        </div>
      </div></div>

      {soSummary.length > 0 && <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sales Orders created</span>
        {soSummary.map((so) => (
          <button key={so.id} onClick={() => onOpenSO && onOpenSO(so.id)} title="Open in Sales Orders"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>
            {so.id} <span style={{ fontFamily: 'inherit', fontWeight: 500, color: '#64748b' }}>· {so.count} order{so.count === 1 ? '' : 's'} ↗</span>
          </button>
        ))}
      </div></div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {loading ? <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}>Loading store details…</div> : (
        <>
          {tab === 'catalog' && <CatalogTab catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} costByPid={detail?.costByPid || {}} transfers={detail?.transfers || []} isTeam={(s.org_type || 'team') !== 'club'} library={detail?.libraryArt || []} onAddSingle={onAddSingle} onCreateBundle={onCreateBundle} onRemove={onRemove} onUpdateImage={onUpdateImage} onReorder={onReorder} onMove={onMove} onUpdateItem={onUpdateItem} />}
          {tab === 'art' && <ArtTab catalog={catalog} stockByWp={stockByWp} libraryArt={detail?.libraryArt || []} onApplyLogo={onApplyLogo} onSetItemDecorations={onSetItemDecorations} onSaveArtVariant={onSaveArtVariant} canMock={qmGarments.length > 0 && _qmArt.length > 0} onOpenMockBuilder={() => setShowMock(true)} />}
          {tab === 'orders' && <OrdersTab orders={orders} orderItems={orderItems} numbersEnabled={s.number_enabled} onBatch={onBatch} availSizes={availSizes} onSaveOrderEdits={onSaveOrderEdits} onRefundOrder={onRefundOrder} />}
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

// ── Catalog tab with editing ─────────────────────────────────────────
function CatalogTab({ catalog, bundleItems, stockByWp, costByPid = {}, transfers = [], isTeam = false, library = [], onAddSingle, onCreateBundle, onRemove, onUpdateImage, onReorder, onMove, onUpdateItem }) {
  const [mode, setMode] = useState(null); // null | 'single' | 'bundle'
  const [pending, setPending] = useState(null); // picked product awaiting price + fundraise
  const [editId, setEditId] = useState(null); // catalog row being edited inline
  const designOptions = transfers.filter((t) => t.kind === 'design').map((t) => ({ code: t.code, label: t.label }));
  const numberSets = [...new Set(transfers.filter((t) => t.kind === 'number').map((t) => `${t.tsize || ''}|${t.color || ''}`))].map((k) => { const [size, color] = k.split('|'); return { size, color }; });
  const [expandAll, setExpandAll] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (id) => setOpenRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ordered = [...catalog].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

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
    if (dragId !== p.id) {
      const tIdx = ordered.findIndex((x) => x.id === p.id);
      const beforeId = overPos === 'before' ? p.id : (ordered[tIdx + 1] ? ordered[tIdx + 1].id : null);
      if (beforeId !== dragId) {
        const dragged = ordered.find((x) => x.id === dragId);
        if (dragged) onMove(dragged, beforeId);
      }
    }
    setDragId(null); setOverId(null);
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-sm btn-primary" onClick={() => { setMode(mode === 'single' ? null : 'single'); setPending(null); }}>+ Add product</button>
        <button className="btn btn-sm btn-secondary" onClick={() => { setMode(mode === 'bundle' ? null : 'bundle'); setPending(null); }}>+ Create package</button>
        <button className="btn btn-sm btn-secondary" onClick={() => { setMode(mode === 'ai' ? null : 'ai'); setPending(null); }}>✨ Build with AI</button>
        <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => { setExpandAll((v) => !v); setOpenRows(new Set()); }}>{expandAll ? 'Collapse all sizes' : 'Expand all sizes'}</button>
      </div>

      {mode === 'single' && !pending && <ProductPicker label="Add products to this store" onPick={(p) => setPending(p)} onClose={() => setMode(null)} />}
      {mode === 'ai' && <AiStoreBuilder onAddProducts={async (prods) => { for (const pr of prods) await onAddSingle({ product: pr, price: pr.retail_price, fundraise: 0, image_url: null, takes_number: false, takes_name: false, name_upcharge: 0, transfer_codes: [], num_transfer_sets: [] }); setMode(null); }} onClose={() => setMode(null)} />}
      {mode === 'single' && pending && <SinglePriceEditor product={pending} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} onCancel={() => setPending(null)} onAdd={async ({ products, ...rest }) => { for (let i = 0; i < (products || []).length; i++) await onAddSingle({ ...rest, product: products[i], image_url: i === 0 ? rest.image_url : null }); setMode(null); setPending(null); }} />}
      {mode === 'bundle' && <BundleBuilder designOptions={designOptions} numberSets={numberSets} storeItems={ordered.filter((c) => c.kind === 'single').map((c) => ({ product_id: c.product_id, sku: c.sku, name: c.display_name || stockByWp[c.id]?.name || c.sku }))} onCreate={(b) => { onCreateBundle(b); setMode(null); }} onClose={() => setMode(null)} />}

      {catalog.length === 0 ? <Empty msg="No products in this store's catalog yet. Add one above." /> : (
        <div className="card"><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={th}>Order</th><th style={th}>Image</th><th style={th}>Product</th><th style={th}>Type</th><th style={th}>Price</th><th style={th}>Fundraising</th><th style={th}>Shopper pays</th><th style={th}>Stock / ETA</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {ordered.map((p, i) => {
                const stock = stockByWp[p.id];
                const st = stockText(stock);
                const comps = p.kind === 'bundle' ? bundleItems.filter((b) => b.bundle_id === p.id) : [];
                const label = p.display_name || stock?.name || p.sku || '(unnamed)';
                const fund = Number(p.fundraise_amount) || 0;
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
                      <button onClick={() => onReorder(p, 'up')} disabled={i === 0} title="Move up" style={arrowBtn(i === 0)}>▲</button>
                      <button onClick={() => onReorder(p, 'down')} disabled={i === ordered.length - 1} title="Move down" style={arrowBtn(i === ordered.length - 1)}>▼</button>
                    </td>
                    <td style={td}><RowImage row={p} stockImg={stock?.image_front_url} onUpdateImage={onUpdateImage} /></td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{[p.sku, stock?.color, stock?.category].filter(Boolean).join(' · ')}</div>
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
                    <td style={td}>{fund > 0 ? <span style={{ color: '#166534', fontWeight: 600 }}>+{money(fund)}</span> : '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{money((Number(p.retail_price) || 0) + fund)}</td>
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
                      <button className="btn btn-sm btn-secondary" style={{ color: '#b91c1c', marginLeft: 6 }} onClick={() => onRemove(p.id, label)}>Remove</button>
                    </td>
                  </tr>
                  {editId === p.id && <tr><td colSpan={9} style={{ padding: 0 }}>
                    <div onClick={() => setEditId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
                      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.3)', width: '100%', maxWidth: 760, margin: 'auto' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eef0f3', position: 'sticky', top: 0, background: '#fff', borderRadius: '14px 14px 0 0', zIndex: 1 }}>
                          <div style={{ fontWeight: 800, fontSize: 16 }}>{p.display_name || stock?.name || p.sku}</div>
                          <button onClick={() => setEditId(null)} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#6A7180' }}>×</button>
                        </div>
                        <CatalogItemEditor item={p} defaultName={stock?.name} stockImg={stock?.image_front_url} availableSizes={stock?.available_sizes || []} designOptions={designOptions} numberSets={numberSets} isTeam={isTeam} library={library} onCancel={() => setEditId(null)} onSave={(fields) => { onUpdateItem(p.id, fields); setEditId(null); }} />
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
function LogoPlacer({ imageUrl, decorations, onChange, library = [] }) {
  const boxRef = useRef();
  const [sel, setSel] = useState(0);
  const drag = useRef(null);
  const decos = Array.isArray(decorations) ? decorations : [];
  const coord = (d, k) => { const p = placementById(d.placement); return d[k] != null ? d[k] : p[k]; };
  const update = (i, patch) => onChange(decos.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const remove = (i) => { onChange(decos.filter((_, j) => j !== i)); setSel((s) => Math.max(0, s - (i <= s ? 1 : 0))); };
  const addLogo = (art) => {
    const url = artImgUrl(art); if (!url) return;
    const p = placementById('left_chest');
    onChange([...decos, { art_id: art.id, art_url: url, source_url: artSourceUrl(art), placement: 'left_chest', color_label: 'original', x: p.x, y: p.y, w: p.w }]);
    setSel(decos.length);
  };
  const onPtrMove = (e) => {
    if (drag.current == null || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    update(drag.current, {
      x: Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100))),
      y: Math.max(0, Math.min(100, Math.round(((e.clientY - r.top) / r.height) * 100))),
    });
  };
  const endDrag = () => { drag.current = null; };
  const current = decos[sel];
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Logo &amp; placement <span style={{ fontWeight: 400, color: '#94a3b8' }}>· drag the logo on the garment, pick a spot, or resize</span></div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div ref={boxRef} onPointerMove={onPtrMove} onPointerUp={endDrag} onPointerLeave={endDrag}
          style={{ position: 'relative', width: 220, aspectRatio: '4/5', background: '#f4f6f9', borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', flexShrink: 0, touchAction: 'none' }}>
          {imageUrl ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#cbd5e1', fontSize: 12 }}>no image</div>}
          {decos.map((d, i) => (
            <img key={i} src={d.art_url} alt="" draggable={false}
              onPointerDown={(e) => { e.preventDefault(); setSel(i); drag.current = i; }}
              style={{ position: 'absolute', left: `${coord(d, 'x')}%`, top: `${coord(d, 'y')}%`, width: `${coord(d, 'w')}%`, transform: 'translate(-50%,-50%)', cursor: 'move', outline: i === sel ? '2px solid #2563eb' : 'none', outlineOffset: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))' }} />
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 230 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{library.length ? 'Add a logo from the library:' : 'No logos in this store’s library yet — upload art in the Art & Logos tab.'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {library.map((a) => { const u = artImgUrl(a); if (!u) return null; return (
              <button key={a.id} type="button" onClick={() => addLogo(a)} title={a.name || 'Logo'} style={{ width: 48, height: 48, padding: 3, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}>
                <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </button>
            ); })}
          </div>
          {decos.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No logo placed yet — tap one above to drop it on the garment.</div> : (
            <div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {decos.map((d, i) => (
                  <button key={i} type="button" onClick={() => setSel(i)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid ' + (i === sel ? '#191919' : '#d1d5db'), background: i === sel ? '#191919' : '#fff', color: i === sel ? '#fff' : '#3A4150', borderRadius: 8, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
                    <img src={d.art_url} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} /> Logo {i + 1}
                    <span onClick={(e) => { e.stopPropagation(); remove(i); }} style={{ color: i === sel ? '#fca5a5' : '#b91c1c', fontWeight: 800 }}>×</span>
                  </button>
                ))}
              </div>
              {current && <div style={{ background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Placement</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {ART_PLACEMENTS.map((p) => (
                    <button key={p.id} type="button" onClick={() => update(sel, { placement: p.id, x: p.x, y: p.y, w: p.w })} style={{ border: '1px solid ' + (current.placement === p.id ? '#191919' : '#d1d5db'), background: current.placement === p.id ? '#191919' : '#fff', color: current.placement === p.id ? '#fff' : '#3A4150', borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{p.label}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Size — {Math.round(coord(current, 'w'))}% of garment</div>
                <input type="range" min={8} max={70} value={Math.round(coord(current, 'w'))} onChange={(e) => update(sel, { w: Number(e.target.value) })} style={{ width: '100%' }} />
              </div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Inline editor for an existing catalog item (single or bundle).
function CatalogItemEditor({ item, defaultName, stockImg, availableSizes = [], designOptions = [], numberSets = [], isTeam = false, library = [], onCancel, onSave }) {
  const isBundle = item.kind === 'bundle';
  const [image, setImage] = useState(item.image_url || null);
  const [decorations, setDecorations] = useState(Array.isArray(item.decorations) ? item.decorations : []);
  const [name, setName] = useState(item.display_name || '');
  const [price, setPrice] = useState(item.retail_price || 0);
  const [fundraise, setFundraise] = useState(item.fundraise_amount || 0);
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
  const imgRef = useRef();
  const estOz = estimateWeightOz(name || item.display_name || defaultName || item.sku);
  const [weight, setWeight] = useState(item.weight_oz != null ? item.weight_oz : '');
  // Per-store size selection: which of the product's available sizes this store
  // shows. Default = all on; saving a strict subset hides the rest on the storefront.
  const allSizes = Array.isArray(availableSizes) ? availableSizes : [];
  const [offeredSizes, setOfferedSizes] = useState(
    Array.isArray(item.sizes_offered) && item.sizes_offered.length ? item.sizes_offered : allSizes
  );
  const toggleSize = (sz) => setOfferedSizes((cur) => cur.includes(sz) ? cur.filter((s) => s !== sz) : [...cur, sz]);
  const total = (Number(price) || 0) + (Number(fundraise) || 0);

  const addExtraFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImgBusy(true);
    try { const url = await cloudUpload(file, 'nsa-webstores'); setExtraImages((p) => [...p, url]); }
    catch (x) { /* cloudUpload surfaces error via toast */ }
    setImgBusy(false);
  };

  const save = () => {
    const fields = { retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, display_name: name.trim() || null, weight_oz: weight === '' ? null : Number(weight) || 0, image_url: image || null, extra_image_urls: extraImages };
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
  };

  return (
    <div style={{ padding: 16 }}>
      {!isBundle && <ImageUpload value={image} fallback={stockImg || item.image_url} onChange={setImage} onBusy={setImgBusy} label="Main image" />}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Row label={isBundle ? 'Package name' : 'Display name (optional override)'}><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName || ''} /></Row>
        <Row label="Price (X)"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Row>
        <Row label="Fundraising (Y)"><input className="form-input" type="number" step="0.01" value={fundraise} onChange={(e) => setFundraise(e.target.value)} /></Row>
        <Row label="Shopper pays"><div className="form-input" style={{ background: '#fff', fontWeight: 700 }}>{money(total)}</div></Row>
        <Row label="Ship weight (oz)"><input className="form-input" type="number" step="0.1" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={`auto ~${estOz}`} style={{ width: 110 }} /></Row>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Leave weight blank to auto-estimate by item type (~{estOz} oz here). Shipping labels use the total order weight.</div>
      {!isBundle && allSizes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
            Sizes offered <span style={{ fontWeight: 400, color: '#94a3b8' }}>· tap to toggle (all on by default)</span>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {allSizes.map((sz) => {
              const on = offeredSizes.includes(sz);
              return (
                <button key={sz} type="button" onClick={() => toggleSize(sz)}
                  style={{ border: '1px solid ' + (on ? '#191919' : '#d1d5db'), background: on ? '#191919' : '#fff', color: on ? '#fff' : '#3A4150', borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 40 }}>
                  {sz}
                </button>
              );
            })}
          </div>
          {offeredSizes.length > 0 && offeredSizes.length < allSizes.length && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Storefront shows only: {allSizes.filter((s) => offeredSizes.includes(s)).join(', ')}</div>
          )}
        </div>
      )}
      {!isBundle && <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <Toggle label="Player adds a number" checked={takesNumber} onChange={setTakesNumber} />
        <Toggle label="Player adds a name" checked={takesName} onChange={setTakesName} />
        {takesName && <label style={{ fontSize: 13 }}>Name upcharge +$<input className="form-input" style={{ width: 80, display: 'inline-block', marginLeft: 4 }} type="number" step="0.01" min={0} value={nameUp} onChange={(e) => setNameUp(e.target.value)} /></label>}
      </div>}
      {!isBundle && isTeam && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Logo &amp; number transfers are a club-store option — team-store decoration is handled in production, so there’s nothing to stock here.</div>}
      {!isBundle && !isTeam && <MultiTransferFields designOptions={designOptions} numberSets={numberSets} transferCodes={transferCodes} setTransferCodes={setTransferCodes} numTransferSets={numTransferSets} setNumTransferSets={setNumTransferSets} showNumber={takesNumber} />}
      {isBundle && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>To change which items are in this package or their number/name options, remove and re-create the package.</div>}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Additional images <span style={{ fontWeight: 400, color: '#94a3b8' }}>· extra angles / back views shown on the product page</span></div>
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); [...(e.dataTransfer.files || [])].forEach(addExtraFile); }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, border: '1.5px dashed #d7dbe2', borderRadius: 10, background: '#fafbfc' }}>
          {extraImages.map((url, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
              <button type="button" onClick={() => setExtraImages((p) => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0, textAlign: 'center' }}>×</button>
            </div>
          ))}
          <input ref={imgRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { [...(e.target.files || [])].forEach(addExtraFile); e.target.value = ''; }} />
          <button type="button" className="btn btn-sm btn-secondary" disabled={imgBusy} onClick={() => imgRef.current?.click()}>{imgBusy ? 'Uploading…' : '+ Drop or add images'}</button>
        </div>
      </div>
      {!isBundle && <LogoPlacer imageUrl={image || stockImg || item.image_url} decorations={decorations} onChange={setDecorations} library={library} />}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="btn btn-primary" disabled={imgBusy} onClick={save}>{imgBusy ? 'Uploading…' : 'Save changes'}</button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
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
function SinglePriceEditor({ product, designOptions, numberSets, isTeam = false, onAdd, onCancel }) {
  const [price, setPrice] = useState(product.retail_price || 0);
  const [fundraise, setFundraise] = useState(0);
  const [image, setImage] = useState(null);
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
        .eq('name', product.name).neq('id', product.id).order('color').limit(40);
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
  const total = (Number(price) || 0) + (Number(fundraise) || 0);
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
      <div style={{ display: 'flex', gap: 12 }}>
        <Row label="Price (X)"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Row>
        <Row label="Fundraising on top (Y)"><input className="form-input" type="number" step="0.01" value={fundraise} onChange={(e) => setFundraise(e.target.value)} /></Row>
        <Row label="Shopper pays"><div className="form-input" style={{ background: '#f8fafc', fontWeight: 700 }}>{money(total)}</div></Row>
      </div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <Toggle label="Player adds a number" checked={takesNumber} onChange={setTakesNumber} />
        <Toggle label="Player adds a name" checked={takesName} onChange={setTakesName} />
        {takesName && <label style={{ fontSize: 13 }}>Name upcharge +$<input className="form-input" style={{ width: 80, display: 'inline-block', marginLeft: 4 }} type="number" step="0.01" min={0} value={nameUpcharge} onChange={(e) => setNameUpcharge(e.target.value)} /></label>}
      </div>
      {isTeam
        ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Logo &amp; number transfers are a club-store option — team-store decoration is handled in production, so there’s nothing to stock here.</div>
        : <MultiTransferFields designOptions={designOptions} numberSets={numberSets} transferCodes={transferCodes} setTransferCodes={setTransferCodes} numTransferSets={numTransferSets} setNumTransferSets={setNumTransferSets} showNumber={takesNumber} />}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button className="btn btn-primary" onClick={() => onAdd({ products: [product, ...selectedSiblings], price, fundraise, image_url: image, takes_number: takesNumber, takes_name: takesName, name_upcharge: nameUpcharge, transfer_codes: isTeam ? [] : transferCodes.filter(Boolean), num_transfer_sets: isTeam ? [] : numTransferSets.filter((s) => s && s !== '|') })}>{selectedSiblings.length > 0 ? `Add ${selectedSiblings.length + 1} items` : 'Add to store'}</button>
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
      const { data } = await supabase.from('products').select('id,sku,name,color,category,retail_price,image_front_url').or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(25);
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

// ── Catalog product picker — live-look card grid for adding items to a store ──
// Same visual language as the public catalog (/adidas live-look): a search box,
// brand/category quick-filter pills, and a responsive card grid. Picking a card
// hands off to SinglePriceEditor (price / fundraising / personalization),
// unchanged. State is a simple "filter spec" ({ q, brand, category }) so the
// future AI-brief and customer self-serve flows can drive the same engine.
function ProductPicker({ label, onPick, onClose, initialFilter = {} }) {
  const [q, setQ] = useState(initialFilter.q || '');
  const [brandSel, setBrandSel] = useState(initialFilter.brand || null);
  const [catSel, setCatSel] = useState(initialFilter.category || null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(48);
  const [inStockOnly, setInStockOnly] = useState(false); // default: show ALL colorways (out-of-stock just dims); toggle to hide

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('products')
        .select('id,sku,name,brand,color,category,retail_price,available_sizes,image_front_url')
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
        .limit(limit);
      const rows = data || [];
      // Annotate each hit with live availability (same source as the catalog
      // live-look) so the in-stock filter and the per-card badges agree.
      const stock = await fetchStockMap(rows);
      for (const r of rows) r._stock = stock.get(r.id) || { units: 0, sizes: [], sizeStock: {}, incoming: false };
      if (!cancelled) { setResults(rows); setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, limit]);

  // Quick-filter pills derived from the current result set.
  const brands = [...new Set(results.map((r) => r.brand).filter(Boolean))].sort();
  const cats = [...new Set(results.map((r) => r.category).filter(Boolean))].sort();
  const matched = results.filter((r) => (!brandSel || r.brand === brandSel) && (!catSel || r.category === catSel));
  const inStockN = matched.reduce((a, r) => a + ((r._stock?.units || 0) > 0 ? 1 : 0), 0);
  const shown = inStockOnly ? matched.filter((r) => (r._stock?.units || 0) > 0) : matched;
  const enough = q.trim().length >= 2;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <CatalogKitStyles />
      <KitScope style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.01em' }}>{label || 'Add products'}</div>
          {onClose && <button className="ai-iconbtn" onClick={onClose} aria-label="Close picker">✕ Close</button>}
        </div>

        <input className="ai-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search your catalog — name, style name, or SKU…" aria-label="Search products" />

        {enough && (
          <div style={{ marginTop: 12 }}>
            <InStockToggle on={inStockOnly} onToggle={() => setInStockOnly((v) => !v)} count={inStockN} total={matched.length} />
          </div>
        )}

        {enough && (brands.length > 1 || cats.length > 1) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
            {brands.length > 1 && brands.map((b) => (
              <FilterBtn key={'b-' + b} on={brandSel === b} onClick={() => setBrandSel(brandSel === b ? null : b)}>{b}</FilterBtn>
            ))}
            {brands.length > 1 && cats.length > 1 && <span style={{ width: 1, alignSelf: 'stretch', background: '#E2E5EA', margin: '0 3px' }} />}
            {cats.length > 1 && cats.map((c) => (
              <FilterBtn key={'c-' + c} on={catSel === c} onClick={() => setCatSel(catSel === c ? null : c)}>{c}</FilterBtn>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {!enough && (
            <div style={{ textAlign: 'center', color: '#9AA1AC', fontSize: 14, padding: '34px 10px', fontWeight: 600 }}>
              Search your catalog to add items — try a brand, a style name, or a SKU.
            </div>
          )}
          {enough && searching && results.length === 0 && (
            <div style={{ color: '#9AA1AC', fontSize: 13, padding: 8 }}>Searching…</div>
          )}
          {enough && !searching && shown.length === 0 && (
            <div style={{ color: '#9AA1AC', fontSize: 13, padding: 8 }}>
              {matched.length > 0 && inStockOnly
                ? 'No in-stock matches — turn off “In stock only” to see out-of-stock items.'
                : 'No matches. Try a different name or SKU.'}
            </div>
          )}
          {shown.length > 0 && (
            <div className="ai-grid">
              {shown.map((p) => <PickerCard key={p.id} p={p} onAdd={() => onPick(p)} />)}
            </div>
          )}
          {enough && !searching && results.length >= limit && (
            <ShowMore onClick={() => setLimit((n) => n + 48)}>Show more results</ShowMore>
          )}
        </div>
      </KitScope>
    </div>
  );
}

// One catalog item, in the live-look card style.
function PickerCard({ p, onAdd }) {
  const [imgErr, setImgErr] = useState(false);
  const st = p._stock || { units: 0, sizes: [], incoming: false };
  const out = (st.units || 0) <= 0;
  // Prefer the live in-stock sizes; fall back to the catalog's listed sizes.
  const sizes = st.sizes && st.sizes.length ? st.sizes : (Array.isArray(p.available_sizes) ? p.available_sizes : []);
  return (
    <button className="ai-card" onClick={onAdd} aria-label={`Add ${p.name || p.sku} to store`}>
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
          <div style={{ fontSize: 12, color: '#6A7180', marginTop: 3 }}>{[p.category, p.color].filter(Boolean).join(' · ') || ' '}</div>
          {p.sku && <div style={{ fontSize: 11.5, color: '#9AA1AC', fontFamily: 'monospace', marginTop: 2 }}>{p.sku}</div>}
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
        <div style={{ marginTop: 'auto', fontSize: 12.5, fontWeight: 800, color: '#191919', borderTop: '1px dashed #E6E8EC', paddingTop: 8, textTransform: 'uppercase', letterSpacing: '.03em' }}>
          Add to store →
        </div>
      </div>
    </button>
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
function AiStoreBuilder({ onAddProducts, onClose }) {
  const [brief, setBrief] = useState('');
  const [spec, setSpec] = useState(null);
  const [candidates, setCandidates] = useState([]); // color/keyword-filtered rows, each carrying live _stock
  const [inStockOnly, setInStockOnly] = useState(false);
  const [matches, setMatches] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  // Brand/category come back as exact catalog values (reliable .in filters);
  // colors/keywords are matched in-memory to dodge PostgREST wildcard quirks.
  // Each candidate is annotated with live availability (_stock) from the same
  // source as the catalog live-look, so the in-stock toggle and the per-card
  // stock badges agree on exactly what's orderable right now.
  const loadCandidates = async (s) => {
    let q = supabase.from('products').select('id,sku,name,brand,color,category,retail_price,available_sizes,image_front_url').limit(300);
    if (s.brands?.length) q = q.in('brand', s.brands);
    if (s.categories?.length) q = q.in('category', s.categories);
    const { data } = await q;
    let rows = data || [];
    const colors = (s.colors || []).map((c) => c.toLowerCase());
    const keywords = (s.keywords || []).map((k) => k.toLowerCase());
    if (colors.length || keywords.length) {
      rows = rows.filter((p) =>
        colors.some((c) => (p.color || '').toLowerCase().includes(c)) ||
        keywords.some((k) => (p.name || '').toLowerCase().includes(k)));
    }
    rows = rows.slice(0, 200); // bound the inventory lookup; the grid is capped at 120 below
    const stock = await fetchStockMap(rows);
    for (const r of rows) r._stock = stock.get(r.id) || { units: 0, sizes: [], sizeStock: {}, incoming: false };
    return rows;
  };

  // One place decides what's visible: the candidate pool narrowed by the in-stock
  // toggle, capped, with the selection (re)seeded to everything shown.
  const applyFilter = (cands, inStock) => {
    const visible = (inStock ? cands.filter((p) => (p._stock?.units || 0) > 0) : cands).slice(0, 120);
    setMatches(visible);
    setSel(new Set(visible.map((p) => p.id)));
  };

  const generate = async () => {
    if (!brief.trim()) return;
    setBusy(true); setErr(''); setSpec(null); setCandidates([]); setMatches([]); setSel(new Set());
    try {
      const d = await invokeEdgeFn(supabase, 'ai-store-builder', { brief: brief.trim() });
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
        <textarea className="ai-search" rows={2} value={brief} onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
          placeholder={'Describe the store — e.g. "Adidas-centric, in-stock black/white/royal, D4T black shorts and baseball cleats"'}
          style={{ resize: 'vertical', minHeight: 56, lineHeight: 1.4 }} aria-label="Store brief" />
        <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="ai-more" style={{ margin: 0 }} onClick={generate} disabled={busy || !brief.trim()}>{busy ? 'Reading the brief…' : 'Find items'}</button>
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
          <button className="btn btn-primary" disabled={adding} onClick={async () => { setAdding(true); await onAddProducts(chosen); setAdding(false); }}>{adding ? 'Adding…' : `Add ${chosen.length} item${chosen.length === 1 ? '' : 's'} to store`}</button>
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
const artImgUrl = (art) => {
  if (!art) return null;
  const cands = [art.preview_url, ...((art.mockup_files || []).map((f) => f?.url)), ...((art.files || []).map((f) => f?.url))].filter(Boolean);
  return cands.find((u) => /\.(png|svg|jpe?g|webp)(\?|$)/i.test(u)) || null;
};
const artSourceUrl = (art) => (art?.files || []).map((f) => f?.url).find(Boolean) || artImgUrl(art) || null;
const isSvg = (u) => /\.svg(\?|$)/i.test(u || '');
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

function ArtTab({ catalog, stockByWp, libraryArt, onApplyLogo, onSetItemDecorations, onSaveArtVariant, canMock, onOpenMockBuilder }) {
  const singles = (catalog || []).filter((c) => c.kind === 'single');
  const [activeId, setActiveId] = useState(libraryArt[0]?.id || null);
  const [placement, setPlacement] = useState('left_chest');
  const [excluded, setExcluded] = useState(() => new Set());
  const [colorByItem, setColorByItem] = useState({}); // item id -> 'original' | 'white' | 'black'
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState('');

  const activeArt = libraryArt.find((a) => a.id === activeId) || null;
  const activeUrl = artImgUrl(activeArt);
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
  const toggleItem = (id) => setExcluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const includedItems = singles.filter((it) => !excluded.has(it.id));

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
      <button onClick={onOpenMockBuilder} disabled={!canMock} title={canMock ? 'Open the full mock builder' : 'Needs library art and at least one store item'} style={{ width: '100%', textAlign: 'left', border: 'none', cursor: canMock ? 'pointer' : 'not-allowed', background: canMock ? 'linear-gradient(135deg,#7c3aed,#a78bfa)' : '#e2e8f0', color: '#fff', borderRadius: 12, padding: '14px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span><span style={{ fontSize: 16, fontWeight: 800 }}>🎨 Build mockups (full editor)</span><br /><span style={{ fontSize: 12.5, opacity: 0.92 }}>Place logos, eyedrop &amp; recolor, and apply to every garment color at once — saved to the art library and onto your store items.</span></span>
        <span style={{ fontSize: 13, fontWeight: 800, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)', borderRadius: 9, padding: '9px 15px', whiteSpace: 'nowrap' }}>Open →</span>
      </button>
      {/* Library picker + placement (quick decoration overlay path) */}
      <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5, marginBottom: 8 }}>1 · Pick a logo</div>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {libraryArt.map((a) => { const u = artImgUrl(a); const on = a.id === activeId; return (
            <button key={a.id} onClick={() => setActiveId(a.id)} title={a.name} style={{ flex: '0 0 auto', width: 96, border: on ? '2px solid #191919' : '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: 6, cursor: 'pointer' }}>
              <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 6, overflow: 'hidden' }}>
                {u ? <img src={u} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} /> : <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>{(a.files || [])[0] ? 'AI / no preview' : 'No art'}</span>}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Logo'}</div>
              <div style={{ fontSize: 9.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{a._srcLabel}</div>
            </button>
          ); })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5 }}>2 · Placement</span>
          {ART_PLACEMENTS.map((p) => (
            <button key={p.id} onClick={() => setPlacement(p.id)} style={{ borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: placement === p.id ? '1px solid #191919' : '1px solid #d1d5db', background: placement === p.id ? '#191919' : '#fff', color: placement === p.id ? '#fff' : '#3A4150' }}>{p.label}</button>
          ))}
        </div>
        {!activeUrl && activeArt && <div style={{ marginTop: 10, fontSize: 12.5, color: '#92400e', fontWeight: 600 }}>This logo has no PNG/SVG preview (likely .ai only). Add a PNG or SVG version to its library record to mock and recolor it.</div>}
      </div></div>

      {/* Colorway boards */}
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5, margin: '4px 2px 10px' }}>3 · Place on every colorway — recolor the logo per garment, then apply</div>
      {groups.map((g) => (
        <div key={g.key} className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{g.name} <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>· {g.items.length} color{g.items.length === 1 ? '' : 's'}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
            {g.items.map((item) => { const ch = choiceOf(item); const inc = !excluded.has(item.id); const has = (item.decorations || []).some((d) => d.placement === placement); return (
              <div key={item.id} style={{ border: inc ? '1px solid #e2e8f0' : '1px dashed #cbd5e1', borderRadius: 10, padding: 8, opacity: inc ? 1 : 0.5, background: '#fff' }}>
                <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#fff', border: '1px solid #f1f5f9', borderRadius: 8, overflow: 'hidden' }}>
                  {item.img ? <img src={item.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 10 }}>No image</div>}
                  {activeUrl && inc && <img src={activeUrl} alt="" style={{ position: 'absolute', left: `${place.x}%`, top: `${place.y}%`, width: `${place.w}%`, transform: 'translate(-50%,-50%)', filter: cssTint(ch), pointerEvents: 'none' }} />}
                  <button onClick={() => toggleItem(item.id)} title={inc ? 'Exclude' : 'Include'} style={{ position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer', background: inc ? '#191919' : 'rgba(255,255,255,.9)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}>{inc ? '✓' : ''}</button>
                  {has && <span style={{ position: 'absolute', top: 6, right: 6, background: '#166534', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5, textTransform: 'uppercase' }}>Applied</span>}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 6 }}>{item.color || '—'}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                  {[['original', 'Orig'], ['white', 'White'], ['black', 'Black']].map(([c, lbl]) => (
                    <button key={c} onClick={() => setChoice(item.id, c)} style={{ flex: 1, fontSize: 10.5, fontWeight: 700, padding: '4px 0', borderRadius: 6, cursor: 'pointer', border: ch === c ? '1px solid #191919' : '1px solid #d1d5db', background: ch === c ? '#191919' : '#fff', color: ch === c ? '#fff' : '#475569' }}>{lbl}</button>
                  ))}
                </div>
              </div>
            ); })}
          </div>
        </div></div>
      ))}

      {/* Sticky apply bar */}
      <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e6e8ec', padding: '12px 4px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {done && <span style={{ fontSize: 12.5, color: done.startsWith('Error') ? '#b91c1c' : '#166534', fontWeight: 700 }}>{done}</span>}
        <span style={{ fontSize: 12.5, color: '#64748b' }}>{includedItems.length} item{includedItems.length === 1 ? '' : 's'} · {place.label}{activeArt ? ` · ${activeArt.name}` : ''}</span>
        <button className="btn btn-primary" disabled={applying || !activeUrl || !includedItems.length} onClick={apply}>{applying ? 'Applying…' : `Apply logo to ${includedItems.length} item${includedItems.length === 1 ? '' : 's'}`}</button>
      </div>
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
  const shipHome = store.delivery_mode !== 'deliver_club';
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
    const labels = []; let fail = 0;
    for (const g of groups) {
      try {
        const { labelData, trackingNumber, carrier, cost } = await createWebstoreLabel(g.order, g.items, store, weightByPid, imageByPid);
        if (labelData) labels.push(labelData);
        if (trackingNumber || cost != null) { try { await supabase.from('webstore_orders').update({ tracking_number: trackingNumber, carrier, label_cost: cost }).eq('id', g.order.id); } catch {} }
      } catch { fail++; }
    }
    if (labels.length) printLabels(labels);
    setSsMsg((m) => ({ ...m, [soId]: `${labels.length} labels created${fail ? `, ${fail} failed` : ''}.` }));
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
      let picks = [], decos = [], jobs = [];
      if (itemIds.length) {
        const [plRes, decoRes] = await Promise.all([
          supabase.from('so_item_pick_lines').select('so_item_id,sizes,status').in('so_item_id', itemIds),
          supabase.from('so_item_decorations').select('so_item_id,kind,position,type,num_method,deco_type,art_file_id').in('so_item_id', itemIds),
        ]);
        picks = plRes.data || []; decos = decoRes.data || [];
      }
      const { data: jobRes } = await supabase.from('so_jobs').select('so_id,art_name,deco_type,positions,art_status,prod_status,total_units,fulfilled_units').in('so_id', ids);
      jobs = jobRes || [];
      const pickedByItem = {};
      picks.forEach((p) => { if ((p.status || '') === 'pulled') { const t = sumSizes(p.sizes); pickedByItem[p.so_item_id] = (pickedByItem[p.so_item_id] || 0) + t; } });
      const decosByItem = {};
      decos.forEach((d) => { (decosByItem[d.so_item_id] = decosByItem[d.so_item_id] || []).push(d); });
      setSos((orders || []).map((o) => ({ ...o, items: (items || []).filter((i) => i.so_id === o.id), pickedByItem, decosByItem, jobs: jobs.filter((j) => j.so_id === o.id) })));
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sos.map((o) => {
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
                  {shipHome && <button className="btn btn-sm btn-secondary" onClick={() => sendToShipStation(o.id)}>📦 Send to ShipStation</button>}
                  {shipHome && <button className="btn btn-sm btn-secondary" onClick={() => printShipLabels(o.id)}>🏷️ Create & print labels</button>}
                </div>
                {ssMsg[o.id] && <div style={{ fontSize: 11, color: '#1e40af', marginTop: 4 }}>{ssMsg[o.id]}</div>}
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

function OrdersTab({ orders, orderItems, numbersEnabled, onBatch, availSizes = {}, onSaveOrderEdits, onRefundOrder }) {
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('all');   // all | pending | in_production | shipped | complete
  const [fPay, setFPay] = useState('all');         // all | paid | unpaid
  const [fBatch, setFBatch] = useState('all');     // all | unbatched | batched
  const [editId, setEditId] = useState(null);
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
        <button className="btn btn-primary" disabled={!unbatchedCount} onClick={onBatch} title={unbatchedCount ? '' : 'No unbatched orders'} style={!unbatchedCount ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
          Create Sales Order ({unbatchedCount})
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Showing {filtered.length} of {orders.length} orders.</div>
      <div className="card"><div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={th}>Buyer / Player</th>{numbersEnabled && <th style={th}>#</th>}<th style={th}>Items</th><th style={th}>Kind</th><th style={th}>Paid?</th><th style={th}>Total</th><th style={th}>Status</th><th style={th}>SO</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {filtered.map(({ o, items, players, numbers, lineStatus }) => (
              <tr key={o.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}><div style={{ fontWeight: 600 }}>{o.buyer_name || '—'}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{players.join(', ') || o.buyer_email}</div></td>
                {numbersEnabled && <td style={td}>{numbers.join(', ') || '—'}</td>}
                <td style={td}>{items.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + (i.qty || 0), 0)}</td>
                <td style={td}>{o.order_kind === 'bulk' ? <Chip label="Bulk" tone="blue" /> : <Chip label="Individual" />}</td>
                <td style={td}>{o.payment_mode === 'paid' ? <Chip label="Paid" tone="green" /> : <Chip label="Team tab" />}{Number(o.refunded_amt) > 0 && <div style={{ fontSize: 10, color: '#b45309' }}>−{money(o.refunded_amt)} refunded</div>}{Number(o.discount_amt) > 0 && <div style={{ fontSize: 10, color: '#16a34a' }}>{o.coupon_code} −{money(o.discount_amt)}</div>}</td>
                <td style={td}>{money(o.total)}</td>
                <td style={td}><Chip label={(o.status === 'refunded' ? 'refunded' : lineStatus || 'pending').replace(/_/g, ' ')} tone={o.status === 'refunded' ? 'gray' : lineStatus === 'complete' ? 'green' : lineStatus === 'shipped' ? 'blue' : 'slate'} /></td>
                <td style={td}>{o.so_id ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1e40af' }}>{o.so_id}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                <td style={{ ...td, textAlign: 'right' }}>{(onSaveOrderEdits || onRefundOrder) && <button className="btn btn-sm btn-secondary" onClick={() => setEditId(o.id)}>Manage</button>}</td>
              </tr>
            ))}
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
