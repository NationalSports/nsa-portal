/* eslint-disable */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase';
import { cloudUpload } from './utils';
import { shipStationCall } from './vendorApis';

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
function webstoreToShipStation(order, items, store) {
  const a = order.ship_address || {};
  return {
    orderNumber: 'WS-' + String(order.id).slice(0, 8), orderKey: 'ws-' + order.id,
    orderDate: order.created_at, orderStatus: 'awaiting_shipment',
    customerUsername: store.name, customerEmail: order.buyer_email || '',
    billTo: { name: order.buyer_name || a.name || 'Customer' },
    shipTo: { name: a.name || order.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: order.buyer_phone || '', residential: true },
    items: items.filter((i) => !i.is_bundle_parent).map((i) => ({
      sku: i.sku || '', name: [i.sku, i.size && ('Size ' + i.size), i.player_number && ('#' + i.player_number), i.player_name].filter(Boolean).join(' · '),
      quantity: i.qty || 1, unitPrice: Number(i.unit_price) || 0,
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
function ImageUpload({ value, fallback, onChange, label = 'Product image' }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const shown = value || fallback;
  const pick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return; }
    setBusy(true); setErr('');
    try { const url = await cloudUpload(file, 'nsa-webstores'); onChange(url); }
    catch (x) { setErr(x.message || 'Upload failed.'); }
    setBusy(false);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="form-label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#64748b' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 64, height: 64, borderRadius: 8, background: '#f1f5f9', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {shown ? <img src={shown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, color: '#cbd5e1' }}>none</span>}
        </div>
        <div>
          <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}</button>
          {value && <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 6, color: '#b91c1c' }} onClick={() => onChange(null)}>Remove</button>}
          {!value && fallback && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Using stock photo — upload to override.</div>}
          {err && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>{err}</div>}
        </div>
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

// Map products -> which transfers they consume, then tally usage from order lines.
function buildTransferMaps(catalog, bundleItems) {
  const designByPid = {}, numSetByPid = {}, takesNumByPid = {};
  (catalog || []).forEach((c) => { if (c.product_id) { if (c.transfer_code) designByPid[c.product_id] = c.transfer_code; if (c.takes_number) { takesNumByPid[c.product_id] = true; numSetByPid[c.product_id] = { size: c.num_transfer_size, color: c.num_transfer_color }; } } });
  (bundleItems || []).forEach((b) => { if (b.product_id) { if (b.transfer_code) designByPid[b.product_id] = b.transfer_code; if (b.takes_number) { takesNumByPid[b.product_id] = true; numSetByPid[b.product_id] = { size: b.num_transfer_size, color: b.num_transfer_color }; } } });
  return { designByPid, numSetByPid, takesNumByPid };
}
function transferUsage(lines, maps) {
  const used = {};
  (lines || []).forEach((i) => {
    if (i.is_bundle_parent) return;
    const units = i.qty || 1;
    const d = maps.designByPid[i.product_id];
    if (d) used[d] = (used[d] || 0) + units;
    if (maps.takesNumByPid[i.product_id] && i.player_number) {
      const set = maps.numSetByPid[i.product_id] || {};
      String(i.player_number).replace(/[^0-9]/g, '').split('').forEach((dg) => { const code = `${dg}|${set.size || ''}|${set.color || ''}`; used[code] = (used[code] || 0) + units; });
    }
  });
  return used;
}

function isMissingTable(err) {
  if (!err) return false;
  const m = (err.message || err.details || '').toLowerCase();
  return err.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache');
}

function Webstores({ cust = [], REPS = [], onCreateSO, onOpenSO }) {
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

  const loadStores = useCallback(async () => {
    setLoading(true); setErr(null); setNeedsMigration(false);
    const { data, error } = await supabase.from('webstores').select('*').order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) setNeedsMigration(true); else setErr(error.message);
      setStores([]);
    } else setStores(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  const loadDetail = useCallback(async (store) => {
    setDetailLoading(true);
    const sid = store.id;
    const [catRes, bundleRes, stockRes, ordRes, itemRes, rosterRes, claimRes, transferRes] = await Promise.all([
      supabase.from('webstore_products').select('*').eq('store_id', sid).order('sort_order'),
      supabase.from('webstore_bundle_items').select('*').order('sort_order'),
      supabase.from('webstore_storefront_products').select('webstore_product_id,product_id,size_stock,on_order_qty,earliest_eta,vendor_size_stock,vendor_on_hand,available_sizes,vendor_eta,name,color,category,image_front_url').eq('store_id', sid),
      supabase.from('webstore_orders').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
      supabase.from('webstore_order_items').select('*'),
      supabase.from('webstore_roster').select('*').eq('store_id', sid).order('player_name'),
      supabase.from('webstore_number_claims').select('*').eq('store_id', sid).order('player_number'),
      supabase.from('webstore_transfers').select('*').eq('store_id', sid).order('kind').order('code'),
    ]);
    const catalog = catRes.data || [];
    const catIds = new Set(catalog.map((c) => c.id));
    const orders = ordRes.data || [];
    const orderIds = new Set(orders.map((o) => o.id));
    const stockByWp = {}; (stockRes.data || []).forEach((s) => { stockByWp[s.webstore_product_id] = s; });
    setDetail({
      catalog,
      bundleItems: (bundleRes.data || []).filter((b) => catIds.has(b.bundle_id)),
      stockByWp,
      orders,
      orderItems: (itemRes.data || []).filter((i) => orderIds.has(i.order_id)),
      roster: rosterRes.data || [],
      claims: claimRes.data || [],
      transfers: transferRes.data || [],
    });
    setDetailLoading(false);
  }, []);

  const openStore = useCallback(async (store) => {
    setSel(store); setTab('catalog'); setDetail(null);
    await loadDetail(store);
  }, [loadDetail]);

  // ── writes ──────────────────────────────────────────────────────────
  const saveStore = useCallback(async (form, existingId) => {
    if (existingId) {
      const { data, error } = await supabase.from('webstores').update({ ...form, updated_at: new Date().toISOString() }).eq('id', existingId).select().single();
      if (error) return { error };
      setStores((prev) => prev.map((s) => (s.id === existingId ? data : s)));
      if (sel?.id === existingId) setSel(data);
      flash('Store saved'); return { data };
    }
    const { data, error } = await supabase.from('webstores').insert(form).select().single();
    if (error) return { error };
    setStores((prev) => [data, ...prev]);
    flash('Store created'); return { data };
  }, [sel, flash]);

  const addSingle = useCallback(async ({ product, price, fundraise, image_url, takes_number, takes_name, name_upcharge, transfer_code }) => {
    const row = { store_id: sel.id, kind: 'single', product_id: product.id, sku: product.sku, retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, image_url: image_url || null, takes_number: !!takes_number, takes_name: !!takes_name, name_upcharge: Number(name_upcharge) || 0, transfer_code: transfer_code || null, active: true, sort_order: (detail?.catalog?.length || 0) };
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

  const updateTransfer = useCallback(async (id, fields) => {
    const { error } = await supabase.from('webstore_transfers').update(fields).eq('id', id);
    if (error) { flash('Error: ' + error.message); return; }
    loadDetail(sel);
  }, [sel, flash, loadDetail]);

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

  const createBundle = useCallback(async ({ name, price, fundraise, image_url, components }) => {
    const { data: bundle, error } = await supabase.from('webstore_products').insert({ store_id: sel.id, kind: 'bundle', display_name: name, retail_price: price, fundraise_amount: Number(fundraise) || 0, image_url: image_url || null, active: true, sort_order: (detail?.catalog?.length || 0) }).select().single();
    if (error) { flash('Error: ' + error.message); return; }
    if (components.length) {
      const rows = components.map((c, i) => ({ bundle_id: bundle.id, product_id: c.product_id, sku: c.sku, qty: c.qty || 1, size_required: c.size_required !== false, takes_number: !!c.takes_number, takes_name: !!c.takes_name, name_upcharge: Number(c.name_upcharge) || 0, transfer_code: c.transfer_code || null, sort_order: i }));
      const { error: e2 } = await supabase.from('webstore_bundle_items').insert(rows);
      if (e2) { flash('Bundle created but items failed: ' + e2.message); loadDetail(sel); return; }
    }
    flash('Package created'); loadDetail(sel);
  }, [sel, detail, flash, loadDetail]);

  // Batch all not-yet-batched orders into one Sales Order via the app's normal
  // SO creation path (onCreateSO), then link each order back to the new SO id.
  const batchOrders = useCallback(async () => {
    if (!sel || !detail || !onCreateSO) return;
    const open = (detail.orders || []).filter((o) => !o.so_id);
    if (!open.length) { flash('No unbatched orders to send'); return; }
    if (!window.confirm(`Create a Sales Order from ${open.length} order${open.length === 1 ? '' : 's'}?`)) return;
    const openIds = new Set(open.map((o) => o.id));
    const lines = (detail.orderItems || []).filter((i) => openIds.has(i.order_id) && !i.is_bundle_parent);

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
        <StoreForm cust={cust} REPS={REPS} store={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={async (form) => { const r = await saveStore(form, editing === 'new' ? null : editing.id); if (r.error) return r; setEditing(null); return r; }} />
      ) : sel ? (
        <StoreDetail store={sel} detail={detail} loading={detailLoading} tab={tab} setTab={setTab}
          custName={custName} repName={repName}
          onBack={() => { setSel(null); setDetail(null); }}
          onEdit={() => setEditing(sel)} onOpenSO={onOpenSO}
          onAddSingle={addSingle} onCreateBundle={createBundle} onRemove={removeCatalogItem} onUpdateImage={updateImage} onBatch={batchOrders} onReorder={reorderItem} onUpdateItem={updateCatalogItem}
          onUpdateTransfer={updateTransfer} onAddTransfers={addTransfers} onRemoveTransfer={removeTransfer} />
      ) : (
        <ListView stores={stores} custName={custName} repName={repName} onOpen={openStore} onNew={() => setEditing('new')} />
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

function ListView({ stores, custName, repName, onOpen, onNew }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>{stores.length} store{stores.length === 1 ? '' : 's'}</div>
        <button className="btn btn-primary" onClick={onNew}>+ New Store</button>
      </div>
      {stores.length === 0 ? (
        <div className="card"><div className="card-body" style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          No webstores yet. Click <b>+ New Store</b> to create the first one.
        </div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
          {stores.map((s) => (
            <div key={s.id} className="card" style={{ cursor: 'pointer' }} onClick={() => onOpen(s)}>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{s.name}</div>
                  <StatusBadge status={s.status} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{custName(s.customer_id)} · Rep: {repName(s.rep_id)}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  <Chip label={s.payment_mode === 'either' ? 'Paid + Invoice' : s.payment_mode === 'unpaid' ? 'Invoice only' : 'Card only'} />
                  {s.number_enabled && <Chip label={s.number_unique ? 'Unique #s' : 'Numbers'} tone="blue" />}
                  <Chip label={'/shop/' + s.slug} tone="gray" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone = 'slate' }) {
  const tones = { slate: { bg: '#f1f5f9', fg: '#475569' }, green: { bg: '#dcfce7', fg: '#166534' }, blue: { bg: '#dbeafe', fg: '#1e40af' }, gray: { bg: '#f8fafc', fg: '#94a3b8' } };
  const t = tones[tone] || tones.slate;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: t.bg, color: t.fg, fontFamily: tone === 'gray' ? 'monospace' : 'inherit' }}>{label}</span>;
}

// Type-ahead club picker — the customer list is ~2k rows, so a dropdown is
// unusable. Filters the in-memory parents list as you type.
function CustomerPicker({ customers, value, onChange }) {
  const selected = customers.find((c) => c.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const matches = q.trim().length < 1 ? [] : customers.filter((c) => (c.name || '').toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  if (selected && !open) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="form-input" style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#f8fafc' }}>{selected.name}</div>
      <button className="btn btn-sm btn-secondary" onClick={() => { onChange(''); setQ(''); setOpen(true); }}>Change</button>
    </div>;
  }
  return (
    <div style={{ position: 'relative' }}>
      <input className="form-input" autoFocus={open} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="Search clubs by name…" onFocus={() => setOpen(true)} />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {matches.map((c) => <div key={c.id} onClick={() => { onChange(c.id); setOpen(false); setQ(''); }} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>{c.name}</div>)}
        </div>
      )}
      {open && q.trim().length >= 1 && matches.length === 0 && <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, padding: '8px 12px', fontSize: 12, color: '#94a3b8' }}>No matches.</div>}
    </div>
  );
}

// ── Store create / edit form ─────────────────────────────────────────
const BLANK = {
  name: '', slug: '', customer_id: '', rep_id: '', status: 'draft',
  open_at: '', close_at: '',
  payment_mode: 'paid', require_login: false,
  delivery_mode: 'ship_home',
  shipstation_store_id: '', shipstation_tag_id: '',
  director_name: '', director_email: '', director_phone: '',
  number_enabled: false, number_unique: true, number_min: 0, number_max: 99,
  so_creation: 'manual',
  fundraise_enabled: false, fundraise_show_parents: false,
  theme: 'classic', primary_color: '#0f172a', accent_color: '#2563eb', logo_url: '', banner_url: '', hero_blurb: '',
};
// Trim a timestamptz to the yyyy-mm-dd a <input type=date> expects.
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
function StoreForm({ store, cust, REPS, onCancel, onSave }) {
  const [f, setF] = useState(() => ({ ...BLANK, ...(store || {}), open_at: dateOnly(store?.open_at), close_at: dateOnly(store?.close_at) }));
  const [slugTouched, setSlugTouched] = useState(!!store);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setName = (v) => setF((p) => ({ ...p, name: v, slug: slugTouched ? p.slug : slugify(v) }));
  // Sales reps only (not all employees).
  const salesReps = (REPS || []).filter((r) => r.role === 'rep' && r.is_active !== false);

  const submit = async () => {
    setError('');
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
    payload.open_at = payload.open_at || null;
    payload.close_at = payload.close_at || null;
    const r = await onSave(payload);
    setBusy(false);
    if (r?.error) setError(r.error.message || 'Save failed.');
  };

  const parents = cust.filter((c) => !c.parent_id);
  return (
    <div style={{ maxWidth: 760 }}>
      <button className="btn btn-sm btn-secondary" onClick={onCancel} style={{ marginBottom: 12 }}>← Cancel</button>
      <h2 style={{ margin: '0 0 14px' }}>{store ? 'Edit store' : 'New store'}</h2>
      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <Section title="Basics">
        <Row label="Store name"><input className="form-input" value={f.name} onChange={(e) => setName(e.target.value)} placeholder="Tartan FC Team Store" /></Row>
        <Row label="URL slug"><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'monospace' }}>/shop/</span><input className="form-input" value={f.slug} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }} placeholder="tartan-fc" /></div></Row>
        <Row label="Club (customer)"><CustomerPicker customers={parents} value={f.customer_id} onChange={(id) => set('customer_id', id)} /></Row>
        <Row label="Rep"><select className="form-select" value={f.rep_id || ''} onChange={(e) => set('rep_id', e.target.value)}><option value="">—</option>{salesReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Row>
        <Row label="Status"><select className="form-select" value={f.status} onChange={(e) => set('status', e.target.value)}>{['draft', 'open', 'closed', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Row>
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label="Open date"><input className="form-input" type="date" value={f.open_at || ''} onChange={(e) => set('open_at', e.target.value)} /></Row>
          <Row label="Close date"><input className="form-input" type="date" value={f.close_at || ''} onChange={(e) => set('close_at', e.target.value)} /></Row>
        </div>
      </Section>

      <Section title="Club director (portal access)">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>The director/coach uses this email to access their store-tracking portal.</div>
        <Row label="Director name"><input className="form-input" value={f.director_name || ''} onChange={(e) => set('director_name', e.target.value)} /></Row>
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label="Director email"><input className="form-input" type="email" value={f.director_email || ''} onChange={(e) => set('director_email', e.target.value)} /></Row>
          <Row label="Director phone"><input className="form-input" value={f.director_phone || ''} onChange={(e) => set('director_phone', e.target.value)} /></Row>
        </div>
      </Section>

      <Section title="Ordering & payment">
        <Row label="Payment mode"><select className="form-select" value={f.payment_mode} onChange={(e) => set('payment_mode', e.target.value)}>
          <option value="paid">Card only (parents pay)</option><option value="unpaid">Invoice only (team tab)</option><option value="either">Both — card or team tab</option>
        </select></Row>
        <Row label="SO creation"><select className="form-select" value={f.so_creation} onChange={(e) => set('so_creation', e.target.value)}>{['manual', 'on_close', 'daily', 'weekly'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Row>
        <Toggle label="Require login (club members only)" checked={f.require_login} onChange={(v) => set('require_login', v)} />
      </Section>

      <Section title="Delivery">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Applies to the whole store (set by you, not chosen by shoppers).</div>
        <Row label="Delivery method"><select className="form-select" value={f.delivery_mode} onChange={(e) => set('delivery_mode', e.target.value)}>
          <option value="ship_home">Ship to home — collect each buyer's home address</option>
          <option value="deliver_club">Deliver to club — ships to the club's default address</option>
        </select></Row>
        <div style={{ display: 'flex', gap: 12 }}>
          <Row label="ShipStation Store ID (optional)"><input className="form-input" value={f.shipstation_store_id || ''} onChange={(e) => set('shipstation_store_id', e.target.value)} placeholder="e.g. 123456" /></Row>
          <Row label="ShipStation Tag ID (optional)"><input className="form-input" value={f.shipstation_tag_id || ''} onChange={(e) => set('shipstation_tag_id', e.target.value)} placeholder="team tag id" /></Row>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -4 }}>Ship-to-home orders pushed to ShipStation route into that Store and get tagged (create a tag named after the team in ShipStation, paste its id). The team name is also set as the order's customer.</div>
      </Section>

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

      <Section title="Fundraising">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Fundraising is set <b>per product/package</b> in the Catalog tab (price X + fundraising Y on top). By default families do <b>not</b> see the fundraising amount — turn this on only if you want it shown.</div>
        <Toggle label='Show families the "$X supports the team" breakdown (off by default)' checked={f.fundraise_show_parents} onChange={(v) => set('fundraise_show_parents', v)} />
      </Section>

      <Section title="Branding">
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>These control how the storefront looks — logo in the header, banner behind the hero, and your team colors throughout.</div>
        <Row label="Theme"><select className="form-select" value={f.theme} onChange={(e) => set('theme', e.target.value)}>{['classic', 'bold', 'minimal'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Row>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <ColorField label="Primary color" value={f.primary_color} onChange={(v) => set('primary_color', v)} fallback="#0b1f3a" />
          <ColorField label="Accent color" value={f.accent_color} onChange={(v) => set('accent_color', v)} fallback="#e11d2a" />
        </div>
        <ImageUpload value={f.logo_url || null} onChange={(url) => set('logo_url', url || '')} label="Main logo (header)" />
        <ImageUpload value={f.banner_url || null} onChange={(url) => set('banner_url', url || '')} label="Banner image (hero background)" />
        <Row label="Hero blurb"><textarea className="form-input" rows={2} value={f.hero_blurb || ''} onChange={(e) => set('hero_blurb', e.target.value)} placeholder="Welcome to the official Tartan FC team store — gear up for the season!" /></Row>
      </Section>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : store ? 'Save changes' : 'Create store'}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, fallback }) {
  const v = value || fallback;
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="form-label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#64748b' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 38, padding: 0, border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', background: 'none' }} />
        <input className="form-input" style={{ width: 120 }} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={fallback} />
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
    <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#475569', letterSpacing: 0.5, marginBottom: 12 }}>{title}</div>
    {children}
  </div></div>;
}
function Row({ label, children }) {
  return <div style={{ marginBottom: 12, flex: 1 }}><label className="form-label" style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#64748b' }}>{label}</label>{children}</div>;
}
function Toggle({ label, checked, onChange }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer', fontSize: 13 }}>
    <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />{label}
  </label>;
}

// ── Store detail (with catalog editing) ──────────────────────────────
function StoreDetail({ store: s, detail, loading, tab, setTab, custName, repName, onBack, onEdit, onOpenSO, onAddSingle, onCreateBundle, onRemove, onUpdateImage, onBatch, onReorder, onUpdateItem, onUpdateTransfer, onAddTransfers, onRemoveTransfer }) {
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
    { id: 'orders', label: `Orders (${orders.length})` },
    { id: 'batches', label: soSummary.length ? `Batches (${soSummary.length})` : 'Batches' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'roster', label: roster.length ? `Roster (${roster.length})` : 'Roster' },
    { id: 'settings', label: 'Settings' },
  ];
  // product_id -> stock (warehouse + Adidas) for the batch health check.
  const productStock = {};
  Object.values(stockByWp).forEach((s) => { if (s.product_id) productStock[s.product_id] = s; });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn btn-sm btn-secondary" onClick={onBack}>← Back to All Stores</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn-sm btn-secondary" href={'/shop/' + s.slug} target="_blank" rel="noopener noreferrer">↗ View storefront</a>
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
          {tab === 'catalog' && <CatalogTab catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} transfers={detail?.transfers || []} onAddSingle={onAddSingle} onCreateBundle={onCreateBundle} onRemove={onRemove} onUpdateImage={onUpdateImage} onReorder={onReorder} onUpdateItem={onUpdateItem} />}
          {tab === 'orders' && <OrdersTab orders={orders} orderItems={orderItems} numbersEnabled={s.number_enabled} onBatch={onBatch} />}
          {tab === 'batches' && <BatchesTab store={s} productStock={productStock} onOpenSO={onOpenSO} catalog={catalog} bundleItems={bundleItems} orders={orders} orderItems={orderItems} transfers={detail?.transfers || []} />}
          {tab === 'inventory' && <InventoryTab catalog={catalog} bundleItems={bundleItems} stockByWp={stockByWp} transfers={detail?.transfers || []} orders={orders} orderItems={orderItems} onUpdateTransfer={onUpdateTransfer} onAddTransfers={onAddTransfers} onRemoveTransfer={onRemoveTransfer} />}
          {tab === 'analytics' && <AnalyticsTab orders={orders} orderItems={orderItems} stockByWp={stockByWp} />}
          {tab === 'roster' && <RosterTab roster={roster} notOrdered={notOrdered} />}
          {tab === 'settings' && <SettingsTab store={s} />}
        </>
      )}
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
function CatalogTab({ catalog, bundleItems, stockByWp, transfers = [], onAddSingle, onCreateBundle, onRemove, onUpdateImage, onReorder, onUpdateItem }) {
  const [mode, setMode] = useState(null); // null | 'single' | 'bundle'
  const [pending, setPending] = useState(null); // picked product awaiting price + fundraise
  const [editId, setEditId] = useState(null); // catalog row being edited inline
  const designOptions = transfers.filter((t) => t.kind === 'design').map((t) => ({ code: t.code, label: t.label }));
  const numberSets = [...new Set(transfers.filter((t) => t.kind === 'number').map((t) => `${t.tsize || ''}|${t.color || ''}`))].map((k) => { const [size, color] = k.split('|'); return { size, color }; });
  const [expandAll, setExpandAll] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (id) => setOpenRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ordered = [...catalog].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-sm btn-primary" onClick={() => { setMode(mode === 'single' ? null : 'single'); setPending(null); }}>+ Add product</button>
        <button className="btn btn-sm btn-secondary" onClick={() => { setMode(mode === 'bundle' ? null : 'bundle'); setPending(null); }}>+ Create package</button>
        <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => { setExpandAll((v) => !v); setOpenRows(new Set()); }}>{expandAll ? 'Collapse all sizes' : 'Expand all sizes'}</button>
      </div>

      {mode === 'single' && !pending && <ProductSearch label="Add a product to this store" onPick={(p) => setPending(p)} onClose={() => setMode(null)} />}
      {mode === 'single' && pending && <SinglePriceEditor product={pending} designOptions={designOptions} numberSets={numberSets} onCancel={() => setPending(null)} onAdd={(opts) => { onAddSingle(opts); setMode(null); setPending(null); }} />}
      {mode === 'bundle' && <BundleBuilder storeItems={ordered.filter((c) => c.kind === 'single').map((c) => ({ product_id: c.product_id, sku: c.sku, name: c.display_name || stockByWp[c.id]?.name || c.sku }))} onCreate={(b) => { onCreateBundle(b); setMode(null); }} onClose={() => setMode(null)} />}

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
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
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
                    <td style={td}>{money(p.retail_price)}</td>
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
                  {editId === p.id && <tr><td colSpan={9} style={{ background: '#f8fafc', padding: 0 }}>
                    <CatalogItemEditor item={p} defaultName={stock?.name} designOptions={designOptions} numberSets={numberSets} onCancel={() => setEditId(null)} onSave={(fields) => { onUpdateItem(p.id, fields); setEditId(null); }} />
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

// Inline editor for an existing catalog item (single or bundle).
function CatalogItemEditor({ item, defaultName, designOptions = [], numberSets = [], onCancel, onSave }) {
  const isBundle = item.kind === 'bundle';
  const [name, setName] = useState(item.display_name || (isBundle ? '' : ''));
  const [price, setPrice] = useState(item.retail_price || 0);
  const [fundraise, setFundraise] = useState(item.fundraise_amount || 0);
  const [takesNumber, setTakesNumber] = useState(!!item.takes_number);
  const [takesName, setTakesName] = useState(!!item.takes_name);
  const [nameUp, setNameUp] = useState(item.name_upcharge || 0);
  const [transferCode, setTransferCode] = useState(item.transfer_code || '');
  const [numSize, setNumSize] = useState(item.num_transfer_size || null);
  const [numColor, setNumColor] = useState(item.num_transfer_color || null);
  const total = (Number(price) || 0) + (Number(fundraise) || 0);
  const save = () => {
    const fields = { retail_price: Number(price) || 0, fundraise_amount: Number(fundraise) || 0, display_name: name.trim() || null };
    if (!isBundle) {
      fields.takes_number = !!takesNumber; fields.takes_name = !!takesName; fields.name_upcharge = Number(nameUp) || 0;
      fields.transfer_code = transferCode || null;
      fields.num_transfer_size = takesNumber ? numSize : null;
      fields.num_transfer_color = takesNumber ? numColor : null;
    }
    onSave(fields);
  };
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Row label={isBundle ? 'Package name' : 'Display name (optional override)'}><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName || ''} /></Row>
        <Row label="Price (X)"><input className="form-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Row>
        <Row label="Fundraising (Y)"><input className="form-input" type="number" step="0.01" value={fundraise} onChange={(e) => setFundraise(e.target.value)} /></Row>
        <Row label="Shopper pays"><div className="form-input" style={{ background: '#fff', fontWeight: 700 }}>{money(total)}</div></Row>
      </div>
      {!isBundle && <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <Toggle label="Player adds a number" checked={takesNumber} onChange={setTakesNumber} />
        <Toggle label="Player adds a name" checked={takesName} onChange={setTakesName} />
        {takesName && <label style={{ fontSize: 13 }}>Name upcharge +$<input className="form-input" style={{ width: 80, display: 'inline-block', marginLeft: 4 }} type="number" step="0.01" min={0} value={nameUp} onChange={(e) => setNameUp(e.target.value)} /></label>}
      </div>}
      {!isBundle && <TransferFields designOptions={designOptions} numberSets={numberSets} transferCode={transferCode} setTransferCode={setTransferCode} numSize={numSize} setNumSize={setNumSize} numColor={numColor} setNumColor={setNumColor} showNumber={takesNumber} />}
      {isBundle && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>To change which items are in this package or their number/name options, remove and re-create the package.</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save}>Save changes</button>
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

// Shared transfer-inventory selectors (which transfers an item consumes).
function TransferFields({ designOptions = [], numberSets = [], transferCode, setTransferCode, numSize, setNumSize, numColor, setNumColor, showNumber }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 4 }}>
      <Row label="Logo transfer (deducts 1 per item)"><select className="form-select" value={transferCode || ''} onChange={(e) => setTransferCode(e.target.value)}><option value="">None</option>{designOptions.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</select></Row>
      {showNumber && <Row label="Number transfer set"><select className="form-select" value={(numSize || '') + '|' + (numColor || '')} onChange={(e) => { const [s, c] = e.target.value.split('|'); setNumSize(s || null); setNumColor(c || null); }}>
        <option value="|">None</option>
        {numberSets.map((s, i) => <option key={i} value={`${s.size}|${s.color}`}>{s.size} · {s.color}</option>)}
      </select></Row>}
    </div>
  );
}

// After a product is picked, set its base price (X), fundraising add-on (Y), image, personalization + transfers.
function SinglePriceEditor({ product, designOptions, numberSets, onAdd, onCancel }) {
  const [price, setPrice] = useState(product.retail_price || 0);
  const [fundraise, setFundraise] = useState(0);
  const [image, setImage] = useState(null);
  const [takesNumber, setTakesNumber] = useState(false);
  const [takesName, setTakesName] = useState(false);
  const [nameUpcharge, setNameUpcharge] = useState(0);
  const [transferCode, setTransferCode] = useState('');
  const [numSize, setNumSize] = useState(null);
  const [numColor, setNumColor] = useState(null);
  const total = (Number(price) || 0) + (Number(fundraise) || 0);
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{product.name}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>{[product.sku, product.color].filter(Boolean).join(' · ')}</div>
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
      <TransferFields designOptions={designOptions} numberSets={numberSets} transferCode={transferCode} setTransferCode={setTransferCode} numSize={numSize} setNumSize={setNumSize} numColor={numColor} setNumColor={setNumColor} showNumber={takesNumber} />
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button className="btn btn-primary" onClick={() => onAdd({ product, price, fundraise, image_url: image, takes_number: takesNumber, takes_name: takesName, name_upcharge: nameUpcharge, transfer_code: transferCode || null, num_transfer_size: takesNumber ? numSize : null, num_transfer_color: takesNumber ? numColor : null })}>Add to store</button>
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

function BundleBuilder({ storeItems = [], onCreate, onClose }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [fundraise, setFundraise] = useState('');
  const [image, setImage] = useState(null);
  const [components, setComponents] = useState([]);
  const [picking, setPicking] = useState(false);
  // ProductSearch returns {id,sku,name}; store items already carry {product_id,sku,name}.
  const addComp = (p) => { setComponents((c) => [...c, { product_id: p.product_id || p.id, sku: p.sku, name: p.name, qty: 1, size_required: true, takes_number: false, takes_name: false, name_upcharge: 0 }]); setPicking(false); };
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

// Store analytics — computed live from orders.
function AnalyticsTab({ orders, orderItems, stockByWp }) {
  if (!orders.length) return <Empty msg="No orders yet — analytics will appear once shoppers start ordering." />;
  const nameBySku = {}; Object.values(stockByWp).forEach((s) => { if (s.sku) nameBySku[s.sku] = s.name; });
  const revenue = orders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const fundraise = orders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);
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
        {[['Revenue', money(revenue)], ['Fundraising', money(fundraise), '#166534'], ['Orders', orders.length], ['Units', units], ['Avg order', money(revenue / orders.length)], ['Paid / Team tab', `${paid.length} / ${orders.length - paid.length}`]].map(([l, v, c]) => (
          <div key={l} className="card"><div style={{ padding: 14 }}><div style={{ fontSize: 22, fontWeight: 800, color: c || '#1e293b' }}>{v}</div><div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{l}</div></div></div>
        ))}
      </div>

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

  // Used per transfer = committed across all non-cancelled orders.
  const maps = buildTransferMaps(catalog, bundleItems);
  const activeOrderIds = new Set(orders.filter((o) => o.status !== 'cancelled').map((o) => o.id));
  const used = transferUsage(orderItems.filter((i) => activeOrderIds.has(i.order_id)), maps);

  const designs = transfers.filter((t) => t.kind === 'design');
  const numbers = transfers.filter((t) => t.kind === 'number');
  const sets = {}; numbers.forEach((t) => { const k = `${t.tsize || ''}|${t.color || ''}`; (sets[k] = sets[k] || []).push(t); });
  const ordered = [...catalog].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Remaining = in-house − used (committed by orders). "Incoming" shows on-order.
  const Remaining = ({ t }) => { const u = used[t.code] || 0; const r = (t.on_hand || 0) - u; return <span style={{ fontWeight: 700, color: r < 0 ? '#b91c1c' : r < 10 ? '#92400e' : '#166534' }}>{r}{r < 0 && (t.on_order || 0) > 0 ? ` (+${t.on_order} inbound)` : ''}</span>; };
  const NumCell = ({ t, field }) => <input defaultValue={t[field] || 0} type="number" key={t[field]} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== (t[field] || 0)) onUpdateTransfer(t.id, { [field]: v }); }} style={{ width: 70, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />;

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
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}><b>Used</b> = committed by orders placed (each order deducts as it comes in). <b>Remaining</b> = in-house − used. <b>On order</b> is tracked separately and shown as inbound.</div>

        {designs.length > 0 && <div className="card" style={{ marginBottom: 12 }}><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}><th style={th}>Design transfer</th><th style={th}>In‑house</th><th style={th}>On order</th><th style={th}>Used</th><th style={th}>Remaining</th><th style={th}></th></tr></thead>
            <tbody>
              {designs.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{t.label}</div><div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{t.code}</div></td>
                  <td style={td}><NumCell t={t} field="on_hand" /></td><td style={td}><NumCell t={t} field="on_order" /></td><td style={td}>{used[t.code] || 0}</td><td style={td}><Remaining t={t} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><button onClick={() => onRemoveTransfer(t.id)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>}

        {Object.entries(sets).map(([key, rows]) => {
          const [sz, col] = key.split('|');
          const sorted = [...rows].sort((a, b) => (a.digit || '').localeCompare(b.digit || ''));
          return (
            <div key={key} className="card" style={{ marginBottom: 12 }}><div style={{ padding: '10px 16px 0', fontWeight: 700, fontSize: 13 }}>Numbers · {sz || '?'} · {col || '?'}</div><div style={{ overflowX: 'auto', padding: '6px 0 4px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}><th style={th}>Digit</th><th style={th}>In‑house</th><th style={th}>On order</th><th style={th}>Used</th><th style={th}>Remaining</th></tr></thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr key={t.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ ...td, fontWeight: 700 }}>{t.digit}</td><td style={td}><NumCell t={t} field="on_hand" /></td><td style={td}><NumCell t={t} field="on_order" /></td><td style={td}>{used[t.code] || 0}</td><td style={td}><Remaining t={t} /></td>
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
  const [size, setSize] = useState('8in'); const [color, setColor] = useState(''); const [onHand, setOnHand] = useState(0);
  const create = () => {
    const rows = [];
    for (let d = 0; d <= 9; d++) rows.push({ code: `${d}|${size}|${color}`, label: `Number ${d} · ${size} · ${color}`, kind: 'number', digit: String(d), tsize: size, color, on_hand: Number(onHand) || 0 });
    onAdd(rows);
  };
  return (
    <div className="card" style={{ marginBottom: 12 }}><div style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <Row label="Size"><input className="form-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="8in" /></Row>
      <Row label="Color"><input className="form-input" value={color} onChange={(e) => setColor(e.target.value)} placeholder="White" /></Row>
      <Row label="On hand (each digit)"><input className="form-input" type="number" value={onHand} onChange={(e) => setOnHand(e.target.value)} /></Row>
      <button className="btn btn-primary" disabled={!size.trim() || !color.trim()} onClick={create}>Add 0–9</button>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
    </div></div>
  );
}

// Batches: the Sales Orders created from this store, with full fulfillment
// status — ordered qty, picked qty, and stock health per line item.
function BatchesTab({ store, productStock, onOpenSO, catalog = [], bundleItems = [], orders = [], orderItems = [], transfers = [] }) {
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
  const sendToShipStation = async (soId) => {
    const groups = batchGroups(soId).filter((g) => (g.order.ship_method || store.delivery_mode) !== 'deliver_club' && g.order.ship_address);
    if (!groups.length) { setSsMsg((m) => ({ ...m, [soId]: 'No ship-to-home orders with addresses.' })); return; }
    setSsMsg((m) => ({ ...m, [soId]: `Sending ${groups.length}…` }));
    let ok = 0, fail = 0;
    const tagId = Number(store.shipstation_tag_id) || null;
    for (const g of groups) {
      try {
        const res = await shipStationCall('/orders/createorder', { method: 'POST', body: JSON.stringify(webstoreToShipStation(g.order, g.items, store)) });
        if (tagId && res && res.orderId) { try { await shipStationCall('/orders/addtag', { method: 'POST', body: JSON.stringify({ orderId: res.orderId, tagId }) }); } catch {} }
        ok++;
      } catch { fail++; }
    }
    setSsMsg((m) => ({ ...m, [soId]: `Sent ${ok} to ShipStation${fail ? `, ${fail} failed` : ''}. Bulk-print labels in ShipStation.` }));
  };
  const maps = buildTransferMaps(catalog, bundleItems);
  const transferLabel = (code) => { const t = transfers.find((x) => x.code === code); if (t) return t.label; const [d, s, c] = code.split('|'); return s ? `#${d} · ${s} · ${c}` : code; };
  // Transfers needed for one SO = usage across the webstore orders linked to it.
  const batchTransfers = (soId) => {
    const linked = new Set(orders.filter((o) => o.so_id === soId).map((o) => o.id));
    const lines = orderItems.filter((i) => linked.has(i.order_id));
    const used = transferUsage(lines, maps);
    const designs = []; const numbers = [];
    Object.entries(used).forEach(([code, qty]) => { (code.includes('|') ? numbers : designs).push({ code, qty, label: transferLabel(code) }); });
    numbers.sort((a, b) => a.label.localeCompare(b.label));
    return { designs, numbers };
  };
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
                  {shipHome && <button className="btn btn-sm btn-secondary" onClick={() => sendToShipStation(o.id)}>📦 Send home orders to ShipStation</button>}
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
            {(() => { const bt = batchTransfers(o.id); const any = bt.designs.length || bt.numbers.length; if (!any) return null; return (
              <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginBottom: 6 }}>Transfers to pull for this batch</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {bt.designs.map((d) => <span key={d.code} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#ede9fe', color: '#6d28d9' }}>{d.label}: {d.qty}</span>)}
                  {bt.numbers.map((n) => <span key={n.code} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#dcfce7', color: '#166534' }}>{n.label}: {n.qty}</span>)}
                </div>
              </div>
            ); })()}
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

function OrdersTab({ orders, orderItems, numbersEnabled, onBatch }) {
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('all');   // all | pending | in_production | shipped | complete
  const [fPay, setFPay] = useState('all');         // all | paid | unpaid
  const [fBatch, setFBatch] = useState('all');     // all | unbatched | batched
  const itemsByOrder = {};
  orderItems.forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
  const enrich = (o) => {
    const items = itemsByOrder[o.id] || [];
    return { o, items, players: [...new Set(items.map((i) => i.player_name).filter(Boolean))], numbers: [...new Set(items.map((i) => i.player_number).filter(Boolean))], lineStatus: items[0]?.line_status || 'pending' };
  };
  const unbatchedCount = orders.filter((o) => !o.so_id).length;

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
            <th style={th}>Buyer / Player</th>{numbersEnabled && <th style={th}>#</th>}<th style={th}>Items</th><th style={th}>Kind</th><th style={th}>Paid?</th><th style={th}>Total</th><th style={th}>Status</th><th style={th}>SO</th>
          </tr></thead>
          <tbody>
            {filtered.map(({ o, items, players, numbers, lineStatus }) => (
              <tr key={o.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={td}><div style={{ fontWeight: 600 }}>{o.buyer_name || '—'}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{players.join(', ') || o.buyer_email}</div></td>
                {numbersEnabled && <td style={td}>{numbers.join(', ') || '—'}</td>}
                <td style={td}>{items.filter((i) => !i.is_bundle_parent).reduce((a, i) => a + (i.qty || 0), 0)}</td>
                <td style={td}>{o.order_kind === 'bulk' ? <Chip label="Bulk" tone="blue" /> : <Chip label="Individual" />}</td>
                <td style={td}>{o.payment_mode === 'paid' ? <Chip label="Paid" tone="green" /> : <Chip label="Team tab" />}</td>
                <td style={td}>{money(o.total)}</td>
                <td style={td}><Chip label={(lineStatus || 'pending').replace(/_/g, ' ')} tone={lineStatus === 'complete' ? 'green' : lineStatus === 'shipped' ? 'blue' : 'slate'} /></td>
                <td style={td}>{o.so_id ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1e40af' }}>{o.so_id}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
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
