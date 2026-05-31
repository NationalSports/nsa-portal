/* eslint-disable */
// Embeddable "Parent Order Portal" section for ONE OMG store, rendered inside
// the existing OMG Stores detail (App.js → rOMG). Unifies the parent-tracking
// flow into the OMG store you're already viewing — no separate page.
//
// Scoped to a single sale code, it:
//   1. Imports the OMG *player report* → per-order tracking rows (reusing the
//      webstore order rails; see migration 034 + omg-player-report-ingest.js).
//   2. Parses the packing-slip PDF in-browser for buyer email + ship-to and
//      enriches the orders (the player report has no contact info).
//   3. Sends each parent a private "order is being processed" link.
//   4. Lets the warehouse drive status, flag shortages, and push to ShipStation.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase';
import { shipStationCall } from './vendorApis';

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Lazy-load pdf.js from CDN (kept out of the bundle; only needed here).
let _pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); } catch (e) { reject(e); } };
    s.onerror = () => reject(new Error('Failed to load PDF reader'));
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const STATE_ZIP_RE = /\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;

// Normalize a name to a set of word tokens for loose matching across the two
// docs. Handles "Last, First" vs "First Last" by ignoring order, and strips
// punctuation/middle initials so "Vincent L Carpino" ≈ "Carpino, Vincent".
const nameTokens = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z\s,]/g, ' ').split(/[\s,]+/).filter((t) => t.length > 1));
// Two names "match" if they share at least 2 tokens, or share 1 token when one
// side only has a single usable token.
function namesMatch(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  let common = 0; ta.forEach((t) => { if (tb.has(t)) common++; });
  return common >= 2 || (common >= 1 && (ta.size === 1 || tb.size === 1));
}

// NSA's own contact block ("Dealer Info") sits at the bottom of every packing
// slip — never capture it as a parent's contact.
const DEALER_EMAIL_RE = /@nationalsportsapparel\.com$/i;
const DEALER_PHONE_DIGITS = '7142798777';
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

// From one packing-slip page's text lines, pull a contact record. The admin
// reviews/edits everything before saving, so heuristics are fine.
function parsePage(lines) {
  const text = lines.join('\n');
  // Pick the first email/phone that isn't NSA's dealer footer.
  const email = (text.match(new RegExp(EMAIL_RE.source, 'ig')) || []).find((e) => !DEALER_EMAIL_RE.test(e)) || '';
  const phone = (text.match(new RegExp(PHONE_RE.source, 'g')) || []).find((p) => onlyDigits(p) !== DEALER_PHONE_DIGITS) || '';
  let orderNumber = '';
  const omLabeled = text.match(/Order\s*#?\s*[:\-]?\s*(\d{6,})/i);
  if (omLabeled) orderNumber = omLabeled[1];
  else { const m = text.match(/\b(\d{8,10})\b/); if (m) orderNumber = m[1]; }

  let address = null, name = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(STATE_ZIP_RE);
    if (m) {
      const cityState = lines[i].trim();
      const street = (lines[i - 1] || '').trim();
      const maybeName = (lines[i - 2] || '').trim();
      const cityMatch = cityState.match(/^(.*?),?\s*[A-Z]{2}\s+\d{5}/);
      address = {
        name: /\d/.test(maybeName) ? '' : maybeName,
        street1: street,
        city: cityMatch ? cityMatch[1].replace(/,$/, '').trim() : '',
        state: m[1], zip: m[2], country: 'US',
      };
      if (address.name) name = address.name;
      break;
    }
  }
  if (!name) { const cd = text.match(/Customer Details\s*\n\s*([^\n]+)/i); if (cd) name = cd[1].trim(); }
  return { orderNumber, email, phone, name, address };
}

// Extract line items from a slip page using the column x-positions in the
// "Item / Details / Color / Size / Options / Qty" header row. Product names
// wrap across several rows, so we bucket every text fragment into its nearest
// column and split items on the "Item N of M" marker. Best-effort by design —
// the order is still created even if this returns nothing.
function extractItems(raw) {
  if (!raw.length) return [];
  const rowsMap = {};
  raw.forEach((it) => { const y = Math.round(it.y); (rowsMap[y] = rowsMap[y] || []).push(it); });
  const ys = Object.keys(rowsMap).map(Number).sort((a, b) => b - a); // top → bottom

  // Find the header row and each column's x anchor.
  let headerY = null, cols = null;
  for (const y of ys) {
    const cells = rowsMap[y];
    const t = cells.map((c) => c.s).join(' ').toLowerCase();
    if (t.includes('color') && t.includes('size') && (t.includes('qty') || t.includes('quantity'))) {
      headerY = y;
      const findX = (label) => { const c = cells.find((cc) => cc.s.trim().toLowerCase().startsWith(label)); return c ? c.x : null; };
      cols = { details: findX('details') ?? findX('item'), color: findX('color'), size: findX('size'), options: findX('options'), qty: (findX('qty') ?? findX('quantity')) };
      break;
    }
  }
  if (!cols || cols.color == null || cols.size == null || cols.qty == null) return [];
  const anchors = [['details', cols.details], ['color', cols.color], ['size', cols.size], ['options', cols.options], ['qty', cols.qty]]
    .filter((a) => a[1] != null).sort((a, b) => a[1] - b[1]);
  const colOf = (x) => { let best = anchors[0][0], bd = Infinity; for (const [n, ax] of anchors) { const d = Math.abs(x - ax); if (d < bd) { bd = d; best = n; } } return best; };

  const items = [];
  let cur = null;
  const flush = () => { if (cur && (cur.product || cur.color)) items.push(cur); cur = null; };
  for (const y of ys) {
    if (y >= headerY) continue; // skip header and everything above it
    const cells = rowsMap[y].slice().sort((a, b) => a.x - b.x);
    const rowText = cells.map((c) => c.s).join(' ');
    if (/dealer info|returns\s*&|disclaimer|page \d+ of/i.test(rowText)) break; // footer
    const bucket = { details: [], color: [], size: [], options: [], qty: [] };
    cells.forEach((c) => { const s = c.s.trim(); if (s) bucket[colOf(c.x)].push(s); });
    if (!cur) cur = { product: '', color: '', size: '', qty: 0 };
    if (bucket.details.length) cur.product = (cur.product ? cur.product + ' ' : '') + bucket.details.join(' ');
    if (bucket.color.length) cur.color = (cur.color ? cur.color + ' ' : '') + bucket.color.join(' ');
    if (bucket.size.length && !cur.size) cur.size = bucket.size.join(' ');
    if (bucket.qty.length) { const n = parseInt(bucket.qty.join('').replace(/\D/g, ''), 10); if (n) cur.qty = n; }
    if (/item\s+\d+\s+of\s+\d+/i.test(rowText)) flush();
  }
  flush();
  return items.map((it) => ({ product: it.product.replace(/\s+/g, ' ').trim(), color: it.color.replace(/\s+/g, ' ').trim(), size: (it.size || '').trim(), qty: it.qty || 1 }))
    .filter((it) => it.product || it.color);
}

async function parsePackingSlip(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const contacts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const raw = content.items.map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str })).filter((o) => o.s);
    const byRow = {};
    raw.forEach((it) => { const y = Math.round(it.y); (byRow[y] = byRow[y] || []).push(it); });
    const lines = Object.keys(byRow).map(Number).sort((a, b) => b - a)
      .map((y) => byRow[y].sort((a, b) => a.x - b.x).map((o) => o.s).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const c = parsePage(lines);
    c.items = extractItems(raw);
    if (c.orderNumber || c.email) contacts.push(c);
  }
  return contacts;
}

// ─────────────────────────────────────────────────────────────────────
// Embedded section. Props:
//   saleCode   — OMG sale code (e.g. "WVD87"); identifies the shadow store
//   storeName  — display name (for ingest fallback)
// ─────────────────────────────────────────────────────────────────────
export default function OmgOrderPortal({ saleCode, storeName, onStatus }) {
  const [store, setStore] = useState(null);       // shadow webstore row (null until first import)
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);           // {kind,text}
  const [reportUrl, setReportUrl] = useState('');
  const [draftContacts, setDraftContacts] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [confirmSend, setConfirmSend] = useState(null); // { resend, testEmail } when the preview modal is open
  const [pickIds, setPickIds] = useState(null);         // Set of order ids selected in the confirm modal (null = all)
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const flash = (text, kind = 'ok') => { setMsg({ text, kind }); setTimeout(() => setMsg(null), 6000); };

  const loadOrders = useCallback(async (st) => {
    if (!st) { setOrders([]); return; }
    const { data: ords } = await supabase.from('webstore_orders').select('*').eq('store_id', st.id).order('omg_order_number');
    const ids = (ords || []).map((o) => o.id);
    let itemsByOrder = {};
    if (ids.length) {
      const { data: its } = await supabase.from('webstore_order_items').select('*').in('order_id', ids);
      (its || []).forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
    }
    setOrders((ords || []).map((o) => ({ ...o, items: (itemsByOrder[o.id] || []).filter((i) => !i.is_bundle_parent) })));
  }, []);

  // Find the shadow store for this sale code (may not exist until first import).
  const loadStore = useCallback(async () => {
    if (!saleCode) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('webstores').select('*').eq('omg_sale_code', saleCode).maybeSingle();
    if (error && !/no rows/i.test(error.message || '')) { flash('Could not load orders: ' + error.message, 'err'); }
    setStore(data || null);
    await loadOrders(data || null);
    setLoading(false);
  }, [saleCode, loadOrders]);
  useEffect(() => { loadStore(); }, [loadStore]);

  // 1) Import the player report → orders.
  const ingestReport = async () => {
    if (!reportUrl.trim()) { flash('Paste the player report link first.', 'err'); return; }
    setBusy('ingest');
    try {
      const r = await fetch('/.netlify/functions/omg-player-report-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportUrl: reportUrl.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Ingest failed');
      if (d.store && d.store.saleCode && saleCode && String(d.store.saleCode).toUpperCase() !== String(saleCode).toUpperCase()) {
        flash(`Heads up: that report is for sale ${d.store.saleCode}, not ${saleCode}. Imported anyway.`, 'err');
      } else {
        flash(`Imported ${d.ordersUpserted} orders (${d.itemsInserted} items).`);
      }
      await loadStore();
    } catch (e) { flash(e.message, 'err'); } finally { setBusy(''); }
  };

  // 2) Parse the packing slip → editable review grid.
  const handleFile = async (file) => {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) { flash('Please choose a PDF packing slip.', 'err'); return; }
    setBusy('parse');
    try {
      const contacts = await parsePackingSlip(file);
      if (!contacts.length) throw new Error('No orders found in that PDF.');
      // The slip's multi-column layout makes the buyer name unreliable to parse,
      // but each order already carries the authoritative name from the player
      // report. Backfill any blank parsed name from the matched order.
      const byNum = {}; orders.forEach((o) => { byNum[String(o.omg_order_number)] = o; });
      const filled = contacts.map((c) => {
        if (c.name && c.name.trim()) return c;
        const o = byNum[String(c.orderNumber || '').trim()];
        return o ? { ...c, name: o.buyer_name || o.player_name || '' } : c;
      });
      setDraftContacts(filled);
      flash(`Parsed ${filled.length} packing slip${filled.length === 1 ? '' : 's'} — review below, then save.`);
    } catch (err) { flash(err.message, 'err'); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  const onPickFile = (e) => handleFile(e.target.files && e.target.files[0]);
  const onDrop = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); };

  // 3) Save the parsed slip → create/update orders (incl. line items) from it.
  //    The packing slip is the primary importer now: it creates the shadow
  //    store and the orders itself, so the player report link is optional.
  const saveContacts = async () => {
    if (!draftContacts) return;
    setBusy('enrich');
    try {
      const r = await fetch('/.netlify/functions/omg-packing-slip-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleCode, storeName, orders: draftContacts }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Import failed');
      const parts = [];
      if (d.created) parts.push(`${d.created} created`);
      if (d.updated) parts.push(`${d.updated} updated`);
      if (d.itemsWritten) parts.push(`${d.itemsWritten} items`);
      flash(`Imported from packing slip: ${parts.join(' · ') || 'done'}.`);
      setDraftContacts(null);
      await loadStore();
    } catch (e) { flash(e.message, 'err'); } finally { setBusy(''); }
  };

  // Who would actually receive an email for a given send (mirrors the server's
  // filter): real send → orders with an email not yet notified (or all, if
  // resend); test send → every order (routed to the test address).
  const recipientsFor = (resend, isTest) => orders.filter((o) => isTest ? true : (o.buyer_email && (resend || !o.processing_email_sent)));

  // 4) Send "order is being processed" emails.
  //    testEmail set → every email routes to that address (real parents are
  //    never contacted, orders aren't marked sent) so you can rehearse safely.
  const sendEmails = async (resend = false, testEmail = '', orderIds = null) => {
    if (!store) return;
    setBusy(testEmail ? 'test' : 'notify');
    try {
      const r = await fetch('/.netlify/functions/omg-order-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: store.id, resend, ...(testEmail ? { testEmail } : {}), ...(orderIds && orderIds.length ? { orderIds } : {}) }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Send failed');
      // Surface Brevo's actual error so a silent non-delivery is visible.
      if (d.failed > 0 && d.sent === 0) {
        flash(`Email failed for all ${d.failed}: ${d.firstError || 'unknown error'}. (Check BREVO_API_KEY and that the sender domain is verified in Brevo.)`, 'err');
      } else if (d.failed > 0) {
        flash(`Sent ${d.sent}, but ${d.failed} failed: ${d.firstError || 'unknown error'}.`, 'err');
      } else if (testEmail) {
        flash(d.sent ? `Sent ${d.sent} TEST email(s) to ${testEmail} — no real parents emailed.` : (d.note || 'Nothing to test.'));
      } else {
        flash(d.sent ? `Sent ${d.sent} processing email(s).` : (d.note || 'Nothing to send.'));
      }
      await loadOrders(store);
    } catch (e) { flash(e.message, 'err'); } finally { setBusy(''); }
  };

  // ── Warehouse fulfillment (OMG shadow orders have no linked SO, so the
  // sync trigger never fires — drive line_status directly). ──
  const setLineStatus = async (orderId, ls) => {
    setBusy('status-' + orderId);
    const { error } = await supabase.from('webstore_order_items').update({ line_status: ls }).eq('order_id', orderId);
    setBusy('');
    if (error) { flash('Could not update status: ' + error.message, 'err'); return; }
    if (ls === 'shipped' || ls === 'complete') await supabase.from('webstore_orders').update({ shipped_at: new Date().toISOString() }).eq('id', orderId);
    setOrders((os) => os.map((o) => o.id === orderId ? { ...o, items: o.items.map((i) => ({ ...i, line_status: ls })) } : o));
    flash(`Order marked ${ls.replace(/_/g, ' ')}.`);
  };
  const setItemMissing = async (orderId, itemId, missingQty) => {
    const q = Math.max(0, Number(missingQty) || 0);
    const { error } = await supabase.from('webstore_order_items').update({ missing_qty: q }).eq('id', itemId);
    if (error) { flash('Could not flag item: ' + error.message, 'err'); return; }
    setOrders((os) => os.map((o) => o.id === orderId ? { ...o, items: o.items.map((i) => i.id === itemId ? { ...i, missing_qty: q } : i) } : o));
  };
  const advanceAll = async (ls) => {
    if (!store || !orders.length) return;
    setBusy('advance');
    const ids = orders.map((o) => o.id);
    const { error } = await supabase.from('webstore_order_items').update({ line_status: ls }).in('order_id', ids);
    if (!error && (ls === 'shipped' || ls === 'complete')) await supabase.from('webstore_orders').update({ shipped_at: new Date().toISOString() }).in('id', ids);
    setBusy('');
    if (error) { flash('Bulk update failed: ' + error.message, 'err'); return; }
    await loadOrders(store);
    flash(`All ${ids.length} orders marked ${ls.replace(/_/g, ' ')}.`);
  };

  // Push to ShipStation using the 'WS-<id>' convention so the existing
  // shipstation-webhook records the shipment and emails the parent on ship.
  const ssPayload = (o) => {
    const a = o.ship_address || {};
    return {
      orderNumber: 'WS-' + o.id, orderKey: 'ws-' + o.id, orderDate: o.created_at || new Date().toISOString(), orderStatus: 'awaiting_shipment',
      customerUsername: storeName || saleCode, customerEmail: o.buyer_email || '', billTo: { name: o.buyer_name || a.name || 'Customer' },
      shipTo: { name: a.name || o.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: o.buyer_phone || '', residential: true },
      items: o.items.map((i) => ({ sku: i.sku || '', name: [i.name || i.sku, i.size && ('Size ' + i.size), i.player_name].filter(Boolean).join(' · '), quantity: i.qty || 1, unitPrice: Number(i.unit_price) || 0, imageUrl: i.image_url || undefined, options: [i.size && { name: 'Size', value: i.size }, i.color && { name: 'Color', value: i.color }].filter(Boolean) })),
      amountPaid: Number(o.total) || 0,
      advancedOptions: { source: 'NSA OMG', customField1: storeName || '', customField2: saleCode || '', ...(store && store.shipstation_store_id ? { storeId: Number(store.shipstation_store_id) || undefined } : {}) },
    };
  };
  const pushToShipStation = async (o) => {
    const a = o.ship_address || {};
    if (!a.street1 || !a.city || !a.zip) { flash('Add a shipping address first (upload the packing slip).', 'err'); return; }
    setBusy('ss-' + o.id);
    try {
      const ss = await shipStationCall('/orders/createorder', { method: 'POST', body: JSON.stringify(ssPayload(o)) });
      if (!ss || !ss.orderId) throw new Error('ShipStation did not accept the order.');
      flash(`Order ${o.omg_order_number} sent to ShipStation — buy the label there; the parent is emailed on ship.`);
    } catch (e) { flash('ShipStation: ' + e.message, 'err'); } finally { setBusy(''); }
  };
  const pushAllToShipStation = async () => {
    const ready = orders.filter((o) => o.ship_address && o.ship_address.street1 && o.ship_address.zip);
    if (!ready.length) { flash('No orders have a shipping address yet — upload the packing slip first.', 'err'); return; }
    setBusy('ss-all');
    let ok = 0, fail = 0;
    for (const o of ready) { try { await shipStationCall('/orders/createorder', { method: 'POST', body: JSON.stringify(ssPayload(o)) }); ok++; } catch { fail++; } }
    setBusy('');
    flash(`Pushed ${ok} order(s) to ShipStation${fail ? `, ${fail} failed` : ''}.`, fail ? 'err' : 'ok');
  };

  const updateDraft = (idx, field, value) => setDraftContacts((cs) => cs.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  // Map order number → its parsed-slip draft index, so the orders table itself
  // becomes the review surface (one section instead of a separate grid).
  const draftIdxByNum = draftContacts ? Object.fromEntries(draftContacts.map((c, i) => [String(c.orderNumber || '').trim(), i])) : null;
  const trackUrl = (o) => `${window.location.origin}/shop/order/${o.status_token}`;
  const withEmail = orders.filter((o) => o.buyer_email).length;
  const withAddress = orders.filter((o) => o.ship_address && o.ship_address.street1).length;
  const notified = orders.filter((o) => o.processing_email_sent).length;
  // Most recent send time across all notified orders (for the success UI).
  const lastSentAt = orders.reduce((max, o) => (o.processing_email_sent_at && (!max || o.processing_email_sent_at > max)) ? o.processing_email_sent_at : max, null);

  // Report completion up to the parent (App) so it can gate the Create Sales
  // Order button. Recomputes whenever the order set changes.
  useEffect(() => {
    if (onStatus) onStatus({ saleCode, orders: orders.length, withEmail, withAddress, notified });
  }, [onStatus, saleCode, orders.length, withEmail, withAddress, notified]);

  return (
    <div id="omg-parent-portal" className="card" style={{ marginTop: 16, scrollMarginTop: 80 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>📦 Parent Order Portal{orders.length ? ` — ${orders.length} orders` : ''}</h2>
        {orders.length > 0 && <span style={{ fontSize: 11.5, color: '#64748b' }}>{withEmail} with email · {withAddress} with address · {notified} emailed</span>}
      </div>

      <div style={{ padding: '12px 16px' }}>
        {msg && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, background: msg.kind === 'err' ? '#fef2f2' : '#f0fdf4', color: msg.kind === 'err' ? '#991b1b' : '#166534', border: `1px solid ${msg.kind === 'err' ? '#fecaca' : '#bbf7d0'}` }}>{msg.text}</div>}

        {/* The three things to have ready — always visible, top of the section. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          {/* 1 — Player report */}
          <StepCard n={1} title="Player report" done={orders.length > 0} hint={orders.length ? `${orders.length} orders imported` : 'Paste the link & import'}>
            <input type="text" value={reportUrl} onChange={(e) => setReportUrl(e.target.value)} placeholder="report.ordermygear.com/… (player report)" style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, boxSizing: 'border-box', marginBottom: 6 }} />
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={ingestReport} disabled={busy === 'ingest'}>{busy === 'ingest' ? 'Importing…' : orders.length ? 'Re-import' : 'Import orders'}</button>
          </StepCard>

          {/* 2 — Packing slip */}
          <StepCard n={2} title="Packing slip PDF" done={withEmail > 0} hint={withEmail ? `${withEmail} have email · ${withAddress} have address` : 'Upload for parent emails'}>
            <label
              onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, width: '100%', minHeight: 64, padding: '10px 12px', borderRadius: 8, border: `1.5px dashed ${dragging ? '#2563eb' : '#cbd5e1'}`, background: dragging ? '#eff6ff' : '#f8fafc', color: dragging ? '#1e40af' : '#475569', textAlign: 'center', cursor: busy === 'parse' ? 'wait' : 'pointer', boxSizing: 'border-box', transition: 'all .12s' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{busy === 'parse' ? 'Reading PDF…' : dragging ? 'Drop the PDF here' : '📄 Upload packing slip'}</span>
              {busy !== 'parse' && <span style={{ fontSize: 11, color: '#94a3b8' }}>drag &amp; drop, or click to browse</span>}
              <input ref={fileRef} type="file" accept="application/pdf" onChange={onPickFile} style={{ display: 'none' }} disabled={busy === 'parse'} />
            </label>
          </StepCard>

          {/* 3 — Notify parents */}
          <StepCard n={3} title="Email parents" done={notified > 0 && notified >= withEmail && withEmail > 0} hint={notified ? `${notified} of ${withEmail} emailed${lastSentAt ? ' · last ' + new Date(lastSentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}` : 'Send the tracking link'}>
            <button style={{ ...primaryBtn, width: '100%', opacity: withEmail ? 1 : 0.5 }} onClick={() => setConfirmSend({ resend: false, testEmail: '' })} disabled={busy === 'notify' || !withEmail || !orders.length}>{busy === 'notify' ? 'Sending…' : (notified > 0 ? '✉️ Send to remaining' : '✉️ Send processing emails')}</button>
            {notified > 0 && <div style={{ marginTop: 6, fontSize: 11, color: '#166534', fontWeight: 700 }}>✓ {notified} sent{lastSentAt ? ` · ${new Date(lastSentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</div>}
          </StepCard>
        </div>

        {/* Test mode — rehearse the parent experience without emailing real parents. */}
        {orders.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e' }}>🧪 Test mode</span>
            <span style={{ fontSize: 12, color: '#92400e' }}>Send every parent email to one address instead of the real buyers:</span>
            <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@nationalsportsapparel.com" style={{ flex: '1 1 220px', minWidth: 180, padding: '7px 9px', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box' }} />
            <button style={{ ...secondaryBtn, borderColor: '#f59e0b', color: '#92400e' }} onClick={() => setConfirmSend({ resend: true, testEmail: testEmail.trim() })} disabled={busy === 'test' || !/.+@.+\..+/.test(testEmail.trim())}>{busy === 'test' ? 'Sending test…' : 'Send test emails to me'}</button>
            <span style={{ width: '100%', fontSize: 11, color: '#b45309' }}>Real parents are never contacted in test mode, and orders aren’t marked as emailed.</span>
          </div>
        )}

        {/* Pre-send preview — pick which recipients to email (default all). */}
        {confirmSend && (() => {
          const isTest = !!confirmSend.testEmail;
          const recips = recipientsFor(confirmSend.resend, isTest);
          const noEmail = isTest ? [] : orders.filter((o) => !o.buyer_email);
          const sel = pickIds || new Set(recips.map((o) => o.id)); // null = all selected
          const chosen = recips.filter((o) => sel.has(o.id));
          const toggle = (id) => { const next = new Set(sel); next.has(id) ? next.delete(id) : next.add(id); setPickIds(next); };
          const allOn = chosen.length === recips.length, noneOn = chosen.length === 0;
          return (
            <div onClick={() => { setConfirmSend(null); setPickIds(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(660px, 96vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef1f5' }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>{isTest ? '🧪 Confirm TEST send' : '✉️ Confirm — send processing emails'}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                    {isTest
                      ? <>The <b>{chosen.length}</b> selected email{chosen.length === 1 ? '' : 's'} will go to <b>{confirmSend.testEmail}</b> — no real parents are contacted.</>
                      : <><b>{chosen.length}</b> of {recips.length} {recips.length === 1 ? 'parent' : 'parents'} will be emailed their private tracking link.{confirmSend.resend ? ' (Includes already-emailed orders.)' : ''}</>}
                  </div>
                </div>
                <div style={{ overflowY: 'auto', padding: '4px 20px' }}>
                  {!recips.length ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No one to email. Upload the packing slip to add parent emails first.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                        <th style={{ ...th, fontSize: 10.5, width: 34 }}><input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = !allOn && !noneOn; }} onChange={() => setPickIds(allOn ? new Set() : new Set(recips.map((o) => o.id)))} title="Select all" /></th>
                        {['Order #', 'Parent', isTest ? 'Routes to' : 'Email', 'Status'].map((h) => <th key={h} style={{ ...th, fontSize: 10.5 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {recips.map((o) => (
                          <tr key={o.id} style={{ borderTop: '1px solid #f1f5f9', background: sel.has(o.id) ? '#fff' : '#f8fafc', opacity: sel.has(o.id) ? 1 : 0.55, cursor: 'pointer' }} onClick={() => toggle(o.id)}>
                            <td style={td}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} onClick={(e) => e.stopPropagation()} /></td>
                            <td style={td}>{o.omg_order_number}</td>
                            <td style={td}>{o.buyer_name || '—'}</td>
                            <td style={td}>{isTest ? confirmSend.testEmail : o.buyer_email}</td>
                            <td style={td}>{o.processing_email_sent ? <span style={{ color: '#16a34a', fontSize: 12 }}>emailed{o.processing_email_sent_at ? ' ' + new Date(o.processing_email_sent_at).toLocaleDateString() : ''}</span> : <span style={{ color: '#64748b', fontSize: 12 }}>new</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {noEmail.length > 0 && (
                    <div style={{ margin: '12px 0', padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12.5 }}>
                      ⚠️ {noEmail.length} order{noEmail.length > 1 ? 's have' : ' has'} no email and will be skipped: {noEmail.slice(0, 8).map((o) => o.omg_order_number).join(', ')}{noEmail.length > 8 ? '…' : ''}. Upload the packing slip to fill these in.
                    </div>
                  )}
                </div>
                <div style={{ padding: '14px 20px', borderTop: '1px solid #eef1f5', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setConfirmSend(null); setPickIds(null); }} style={secondaryBtn}>Cancel</button>
                  <button onClick={() => { const cs = confirmSend; const ids = chosen.map((o) => o.id); setConfirmSend(null); setPickIds(null); sendEmails(cs.resend, cs.testEmail, ids); }} disabled={!chosen.length} style={{ ...primaryBtn, opacity: chosen.length ? 1 : 0.5, ...(isTest ? { background: '#d97706' } : {}) }}>
                    {isTest ? `Send ${chosen.length} test email${chosen.length === 1 ? '' : 's'}` : `Send to ${chosen.length} parent${chosen.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* The packing slip creates orders on its own — no player report needed first. */}
        {draftContacts && !orders.length && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, fontSize: 12.5, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>
            Saving will create {draftContacts.length} order{draftContacts.length === 1 ? '' : 's'} from this packing slip (name, email, address &amp; items). The player report link is only needed if the slip’s line items don’t come through.
          </div>
        )}

        {loading ? (
          <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>Loading…</div>
        ) : !orders.length && !draftContacts ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8 }}>
            No parent orders yet. Import the player report (Step 1) to create trackable orders with private status links.
          </div>
        ) : (
          <>
            {/* When a packing slip is parsed, the orders table below becomes the
                review surface — a single section. This is just the banner + Save bar. */}
            {draftContacts && (() => {
              const byNum = {}; orders.forEach((o) => { byNum[String(o.omg_order_number)] = o; });
              const slipNums = new Set(draftContacts.map((c) => String(c.orderNumber || '').trim()).filter(Boolean));
              const noMatch = draftContacts.filter((c) => { const n = String(c.orderNumber || '').trim(); return !n || !byNum[n]; });
              const nameMismatch = draftContacts.filter((c) => { const o = byNum[String(c.orderNumber || '').trim()]; return o && c.name && !namesMatch(c.name, o.buyer_name || o.player_name); });
              const ordersNoSlip = orders.filter((o) => !slipNums.has(String(o.omg_order_number)));
              const ok = draftContacts.length - noMatch.length - nameMismatch.length;
              const allGood = !noMatch.length && !nameMismatch.length && !ordersNoSlip.length;
              return (
                <div style={{ border: '1px solid #bfdbfe', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '9px 12px', background: '#eff6ff', color: '#1e40af', fontWeight: 700, fontSize: 12.5 }}>Reviewing {draftContacts.length} packing slip{draftContacts.length === 1 ? '' : 's'} — edit emails/addresses inline in the table below, then save.</div>
                  <div style={{ padding: '10px 12px', background: allGood ? '#f0fdf4' : '#fffbeb' }}>
                    {allGood ? <div style={{ fontSize: 12.5, fontWeight: 700, color: '#166534' }}>✓ All {draftContacts.length} slips match a player order by number and name.</div>
                      : <div style={{ fontSize: 12.5, color: '#92400e' }}>
                          <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ Cross-check found differences:</div>
                          <div>✓ {ok} match cleanly{noMatch.length ? ` · ${noMatch.length} slip${noMatch.length > 1 ? 's' : ''} with no matching order #` : ''}{nameMismatch.length ? ` · ${nameMismatch.length} name mismatch${nameMismatch.length > 1 ? 'es' : ''}` : ''}{ordersNoSlip.length ? ` · ${ordersNoSlip.length} order${ordersNoSlip.length > 1 ? 's' : ''} with no slip` : ''}</div>
                        </div>}
                  </div>
                  <div style={{ padding: 12, display: 'flex', gap: 8, borderTop: '1px solid #eef1f5' }}>
                    <button onClick={saveContacts} disabled={busy === 'enrich'} style={primaryBtn}>{busy === 'enrich' ? 'Saving…' : `Save ${draftContacts.length} contact${draftContacts.length === 1 ? '' : 's'}`}</button>
                    <button onClick={() => setDraftContacts(null)} style={secondaryBtn}>Cancel</button>
                  </div>
                </div>
              );
            })()}

            {orders.length > 0 && <>
            {/* Fulfillment toolbar — hidden during review to keep focus on saving */}
            {!draftContacts && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', background: '#f8fafc', borderRadius: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>Move all:</span>
              {[['pending', 'Received'], ['in_production', 'In production'], ['shipped', 'Shipped'], ['complete', 'Complete']].map(([ls, label]) => (
                <button key={ls} onClick={() => advanceAll(ls)} disabled={busy === 'advance'} style={stageBtn(ls)}>{label}</button>
              ))}
              <span style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 4px' }} />
              <button onClick={pushAllToShipStation} disabled={busy === 'ss-all' || !withAddress} style={{ ...secondaryBtn, opacity: withAddress ? 1 : 0.5 }}>{busy === 'ss-all' ? 'Pushing…' : `🚚 Push ${withAddress} to ShipStation`}</button>
            </div>}

            {/* Orders table (expandable) — doubles as the contact-review surface */}
            <div style={{ overflowX: 'auto', border: '1px solid #eef1f5', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                  {['', 'Order #', 'Player', draftContacts ? 'Email' : '✉', 'Items', 'Status', 'Total', 'Link'].map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {orders.map((o) => {
                    const st = o.items[0] ? o.items[0].line_status : 'pending';
                    const isOpen = expanded === o.id;
                    const missing = o.items.reduce((a, i) => a + (Number(i.missing_qty) || 0), 0);
                    const di = draftIdxByNum ? draftIdxByNum[String(o.omg_order_number)] : null;
                    return (
                      <React.Fragment key={o.id}>
                        <tr style={{ borderTop: '1px solid #f1f5f9', background: isOpen ? '#f8fafc' : '#fff', cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : o.id)}>
                          <td style={{ ...td, width: 24, color: '#94a3b8' }}>{isOpen ? '▾' : '▸'}</td>
                          <td style={td}>{o.omg_order_number}</td>
                          <td style={td}>{o.buyer_name || '—'}</td>
                          {di != null
                            ? <td style={td} onClick={(e) => e.stopPropagation()}><input value={(draftContacts[di].email) || ''} onChange={(e) => updateDraft(di, 'email', e.target.value)} placeholder="email…" style={{ ...cell, minWidth: 150, ...(draftContacts[di].email ? {} : { background: '#fff7ed', borderColor: '#fdba74' }) }} /></td>
                            : <td style={{ ...td, textAlign: 'center' }} title={o.buyer_email || 'No email — expand to add'}>{o.buyer_email
                                ? <span style={{ color: o.processing_email_sent ? '#166534' : '#16a34a', fontSize: 14 }}>{o.processing_email_sent ? '✓' : '●'}</span>
                                : <span style={{ color: '#dc2626', fontSize: 14 }} title="No email">⚠</span>}</td>}
                          <td style={td}>{o.items.length}{missing > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> · {missing} short</span>}</td>
                          <td style={td}><StatusPill s={st} /></td>
                          <td style={td}>{money(o.total)}</td>
                          <td style={td} onClick={(e) => e.stopPropagation()}>
                            {o.status_token ? (
                              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(trackUrl(o)); flash('Tracking link copied.'); }} style={{ ...linkBtn, color: '#2563eb', fontWeight: 700 }} title={trackUrl(o)}>🔗 Copy</button>
                                <a href={trackUrl(o)} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, color: '#2563eb', fontWeight: 700, textDecoration: 'none' }} title={trackUrl(o)}>Open ↗</a>
                              </span>
                            ) : <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr style={{ background: '#f8fafc' }}>
                            <td colSpan={8} style={{ padding: '4px 16px 16px' }} onClick={(e) => e.stopPropagation()}>
                              {/* Contact + ship-to. During review (di set) these are
                                  editable from the parsed slip; otherwise read-only. */}
                              {di != null ? (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 0 6px', alignItems: 'center' }}>
                                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Phone</span>
                                  <input value={draftContacts[di].phone || ''} onChange={(e) => updateDraft(di, 'phone', e.target.value)} placeholder="phone" style={{ ...cell, width: 130 }} />
                                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Street</span>
                                  <input value={(draftContacts[di].address && draftContacts[di].address.street1) || ''} onChange={(e) => updateDraft(di, 'address', { ...(draftContacts[di].address || {}), street1: e.target.value })} placeholder="street" style={{ ...cell, minWidth: 160 }} />
                                  <input value={(draftContacts[di].address && draftContacts[di].address.city) || ''} onChange={(e) => updateDraft(di, 'address', { ...(draftContacts[di].address || {}), city: e.target.value })} placeholder="city" style={{ ...cell, width: 120 }} />
                                  <input value={(draftContacts[di].address && draftContacts[di].address.state) || ''} onChange={(e) => updateDraft(di, 'address', { ...(draftContacts[di].address || {}), state: e.target.value })} placeholder="ST" style={{ ...cell, width: 48 }} />
                                  <input value={(draftContacts[di].address && draftContacts[di].address.zip) || ''} onChange={(e) => updateDraft(di, 'address', { ...(draftContacts[di].address || {}), zip: e.target.value })} placeholder="zip" style={{ ...cell, width: 80 }} />
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '10px 0 4px', fontSize: 12.5 }}>
                                  <div><span style={{ color: '#94a3b8' }}>Email </span>{o.buyer_email ? <b>{o.buyer_email}{o.processing_email_sent ? ' ✓ emailed' : ''}</b> : <span style={{ color: '#dc2626', fontWeight: 700 }}>missing — upload the packing slip to add</span>}</div>
                                  {o.buyer_phone && <div><span style={{ color: '#94a3b8' }}>Phone </span>{o.buyer_phone}</div>}
                                  {o.ship_address && o.ship_address.street1 && <div><span style={{ color: '#94a3b8' }}>Ship to </span>{[o.ship_address.street1, o.ship_address.city, o.ship_address.state, o.ship_address.zip].filter(Boolean).join(', ')}</div>}
                                </div>
                              )}
                              {!draftContacts && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0 10px' }}>
                                <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>Set status:</span>
                                {[['pending', 'Received'], ['in_production', 'In production'], ['shipped', 'Shipped'], ['complete', 'Complete']].map(([ls, label]) => (
                                  <button key={ls} onClick={() => setLineStatus(o.id, ls)} disabled={busy === 'status-' + o.id} style={{ ...stageBtn(ls), opacity: st === ls ? 1 : 0.72, outline: st === ls ? '2px solid #0f172a' : 'none' }}>{label}</button>
                                ))}
                                <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 2px' }} />
                                <button onClick={() => pushToShipStation(o)} disabled={busy === 'ss-' + o.id} style={{ ...secondaryBtn, padding: '7px 13px', fontSize: 12.5 }}>{busy === 'ss-' + o.id ? 'Pushing…' : '🚚 ShipStation'}</button>
                              </div>}
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 4 }}>
                                <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                                  {['Item', 'Color', 'Size', 'Qty', 'Short / missing'].map((h) => <th key={h} style={{ ...th, fontSize: 10.5 }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                  {o.items.map((i) => (
                                    <tr key={i.id} style={{ borderTop: '1px solid #eef1f5' }}>
                                      <td style={td}>{i.name || i.sku || '—'}</td>
                                      <td style={td}>{i.color || '—'}</td>
                                      <td style={td}>{i.size || '—'}</td>
                                      <td style={td}>{i.qty}</td>
                                      <td style={td}><input type="number" min={0} max={i.qty} value={Number(i.missing_qty) || 0} onChange={(e) => setItemMissing(o.id, i.id, e.target.value)} style={{ ...cell, width: 64, ...(Number(i.missing_qty) > 0 ? { background: '#fffbeb', borderColor: '#fde68a' } : {}) }} /></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div style={{ marginTop: 8, fontSize: 11.5, color: '#94a3b8' }}>Anything marked short shows a “delayed” notice on the parent’s tracking page.</div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {notified > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>Already-emailed parents won’t be re-sent. <button onClick={() => sendEmails(true)} disabled={busy === 'notify'} style={{ ...linkBtn, color: '#2563eb' }}>Force re-send all</button></div>}
            </>}
          </>
        )}
      </div>
    </div>
  );
}

// One of the three "have these ready" cards at the top. Shows a numbered badge
// that turns into a green check once the step is satisfied.
function StepCard({ n, title, hint, done, children }) {
  return (
    <div style={{ border: `1px solid ${done ? '#bbf7d0' : '#e5e9f0'}`, background: done ? '#f0fdf4' : '#fff', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 22, height: 22, flex: '0 0 22px', borderRadius: '50%', background: done ? '#16a34a' : '#2563eb', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{done ? '✓' : n}</span>
        <span style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>{title}</span>
      </div>
      <div style={{ marginTop: 'auto' }}>{children}</div>
      <div style={{ fontSize: 11, color: done ? '#166534' : '#94a3b8', marginTop: 6 }}>{hint}</div>
    </div>
  );
}

function StatusPill({ s }) {
  const map = {
    pending: ['Received', '#eef2ff', '#3730a3'], in_production: ['In production', '#fef3c7', '#92400e'],
    shipped: ['Shipped', '#dbeafe', '#1e40af'], complete: ['Complete', '#dcfce7', '#166534'], cancelled: ['Cancelled', '#fee2e2', '#991b1b'],
  };
  const [label, bg, fg] = map[s] || map.pending;
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: bg, color: fg }}>{label}</span>;
}

const cell = { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12.5, boxSizing: 'border-box', fontFamily: 'inherit' };
const th = { padding: '9px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', verticalAlign: 'middle' };
const primaryBtn = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const secondaryBtn = { padding: '9px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' };
const linkBtn = { background: 'none', border: 'none', color: '#64748b', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: '2px 6px' };
function stageBtn(ls) {
  const c = { pending: ['#eef2ff', '#3730a3'], in_production: ['#fef3c7', '#92400e'], shipped: ['#dbeafe', '#1e40af'], complete: ['#dcfce7', '#166534'] }[ls] || ['#f1f5f9', '#475569'];
  return { padding: '7px 13px', borderRadius: 8, border: 'none', background: c[0], color: c[1], fontWeight: 700, fontSize: 12.5, cursor: 'pointer' };
}
