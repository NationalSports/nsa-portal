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
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { shipStationCall } from './vendorApis';
import { authFetch, printPdfLabels, labelWeightLbs, validateShipAddress, computeOrderTracking } from './utils';
import { NSA } from './constants';

// Per-line incoming-stock status pill (computed from billed/received/need).
const TRACK_PILL = {
  shipped: { label: '✓ Shipped', color: '#166534', bg: '#dcfce7' },
  ready: { label: 'Ready', color: '#166534', bg: '#dcfce7' },
  partial: { label: 'Partial', color: '#92400e', bg: '#fef3c7' },
  incoming: { label: 'Incoming', color: '#1d4ed8', bg: '#dbeafe' },
  awaiting: { label: 'Awaiting', color: '#475569', bg: '#f1f5f9' },
  backordered: { label: 'Backordered', color: '#b91c1c', bg: '#fee2e2' },
};

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SS_CARRIERS = { fedex: { carrierCode: 'fedex', serviceCode: 'fedex_ground' }, ups: { carrierCode: 'ups', serviceCode: 'ups_ground' }, usps: { carrierCode: 'stamps_com', serviceCode: 'usps_priority_mail' } };
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

  // Strip the OMG "Store Code: XXXX" tag (and any trailing pickup code) that the
  // slip prints inside the address block — it isn't part of the street.
  const cleanStreet = (s) => String(s || '').replace(/\bStore\s*Code\b\s*:?\s*\S+/ig, '').replace(/\s{2,}/g, ' ').trim();
  let address = null, name = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(STATE_ZIP_RE);
    if (m) {
      const cityState = lines[i].trim();
      const rawStreet = (lines[i - 1] || '').trim();
      // PDF text extraction sometimes splits "1242 Barranca Pkwy" so the house
      // number and the street name land on separate lines (leaving street1 as a
      // bare number). When that happens, fold the line above into the street and
      // take the name from one line higher up.
      let street = rawStreet, nameIdx = i - 2;
      if (/^\d+[A-Za-z]?$/.test(rawStreet) && lines[i - 2] && !/\d/.test(lines[i - 2])) {
        street = (rawStreet + ' ' + lines[i - 2].trim()).trim();
        nameIdx = i - 3;
      }
      street = cleanStreet(street);
      const maybeName = (lines[nameIdx] || '').trim();
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
    // "Item N of M" separates line items — it's a marker, not a data row. Close
    // the current item and SKIP the row without bucketing it: otherwise the N/M
    // digits get assigned to the qty (and size) columns and concatenated, so the
    // 3rd of 3 items ends up with qty "33" instead of its real quantity.
    if (/item\s+\d+\s+of\s+\d+/i.test(rowText)) { flush(); continue; }
    const bucket = { details: [], color: [], size: [], options: [], qty: [] };
    cells.forEach((c) => { const s = c.s.trim(); if (s) bucket[colOf(c.x)].push(s); });
    if (!cur) cur = { product: '', color: '', size: '', qty: 0 };
    if (bucket.details.length) cur.product = (cur.product ? cur.product + ' ' : '') + bucket.details.join(' ');
    if (bucket.color.length) cur.color = (cur.color ? cur.color + ' ' : '') + bucket.color.join(' ');
    if (bucket.size.length && !cur.size) cur.size = bucket.size.join(' ');
    if (bucket.qty.length) { const n = parseInt(bucket.qty.join('').replace(/\D/g, ''), 10); if (n) cur.qty = n; }
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
export default function OmgOrderPortal({ saleCode, storeName, onStatus, soSync, deliveryMode, onOpenSO, cu, linkedSO, products, msgTagIds = [], focusOrderId, onFocusHandled }) {
  // Ship-to-school stores are bulk-delivered to the club; no per-player labels.
  const shipToSchool = deliveryMode === 'deliver_school';
  const [store, setStore] = useState(null);       // shadow webstore row (null until first import)
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);           // {kind,text}
  const [reportUrl, setReportUrl] = useState('');
  const [draftContacts, setDraftContacts] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [shipErrors, setShipErrors] = useState([]); // [{order, msg}] from the last label run
  const [selIds, setSelIds] = useState(new Set()); // orders selected for bulk label / packing-list
  const [editOrder, setEditOrder] = useState(null); // order whose line items are being edited
  const [msgDraft, setMsgDraft] = useState({}); // orderId -> compose text for the customer thread
  const [msgBusy, setMsgBusy] = useState(null); // orderId currently sending
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
    let itemsByOrder = {}, msgsByOrder = {};
    if (ids.length) {
      const [{ data: its }, { data: msgs }] = await Promise.all([
        supabase.from('webstore_order_items').select('*').in('order_id', ids),
        supabase.from('messages').select('id,text,ts,created_at,from_customer,read_by_staff,author,entity_id')
          .eq('entity_type', 'webstore_order').in('entity_id', ids.map(String)),
      ]);
      (its || []).forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
      // entity_id is stored as text; bucket the thread back onto its order.
      const byId = {}; (ords || []).forEach((o) => { byId[String(o.id)] = o.id; });
      (msgs || []).forEach((m) => { const oid = byId[String(m.entity_id)]; if (oid) (msgsByOrder[oid] = msgsByOrder[oid] || []).push(m); });
    }
    setOrders((ords || []).map((o) => ({
      ...o,
      items: (itemsByOrder[o.id] || []).filter((i) => !i.is_bundle_parent),
      messages: (msgsByOrder[o.id] || []).map((m) => ({ ...m, text: m.text || '', ts: m.created_at || m.ts })).sort((a, b) => new Date(a.ts) - new Date(b.ts)),
    })));
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
      const r = await authFetch('/.netlify/functions/omg-player-report-ingest', {
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
      const r = await authFetch('/.netlify/functions/omg-packing-slip-ingest', {
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
      const r = await authFetch('/.netlify/functions/omg-order-notify', {
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
  // ── Customer messaging (two-way, attached to the order) ──
  // Staff message → saved to the shared `messages` thread (entity_type
  // 'webstore_order') and the parent is emailed a link to read & reply. Customer
  // replies arrive via the public portal (webstore-checkout post_message) and
  // show up here + in the Messages center (tagged to the store's CSR/rep).
  const unreadReplies = (o) => (o.messages || []).filter((m) => m.from_customer && !m.read_by_staff).length;
  const sendOrderMessage = async (o) => {
    const text = (msgDraft[o.id] || '').trim();
    if (!text) return;
    setMsgBusy(o.id);
    const now = new Date();
    const row = {
      id: 'm' + now.getTime() + Math.random().toString(36).slice(2, 7),
      entity_type: 'webstore_order', entity_id: String(o.id), so_id: o.so_id || null,
      author_id: (cu && cu.id) || null, author: (cu && cu.name) || storeName || 'NSA Team',
      text, ts: now.toLocaleString(), dept: 'store', from_customer: false, read_by_staff: true, tagged_members: msgTagIds || [],
    };
    const { error } = await supabase.from('messages').insert(row);
    if (error) { setMsgBusy(null); flash('Could not send message: ' + error.message, 'err'); return; }
    setMsgDraft((d) => ({ ...d, [o.id]: '' }));
    setOrders((os) => os.map((x) => x.id === o.id ? { ...x, messages: [...(x.messages || []), row] } : x));
    // Also record the author's read in the shared message_reads table so this
    // sent message doesn't show as "unread" to them in the Messages inbox.
    if (cu && cu.id) { try { await supabase.from('message_reads').upsert([{ message_id: row.id, user_id: cu.id }], { onConflict: 'message_id,user_id' }); } catch {} }
    try {
      const r = await authFetch('/.netlify/functions/webstore-message-notify', { method: 'POST', body: JSON.stringify({ orderId: o.id, text }) });
      const j = await r.json().catch(() => ({}));
      if (j && j.success) flash('Message sent — the parent was emailed a link to read & reply.');
      else if (!o.buyer_email) flash('Message saved. No buyer email on file, so no notification was sent.', 'err');
      else flash('Message saved, but the email failed: ' + (j.error || 'unknown'), 'err');
    } catch (e) { flash('Message saved, but the email could not be sent.', 'err'); }
    setMsgBusy(null);
  };
  // Clear the "new reply" badge when staff opens an order's thread.
  const markThreadRead = async (o) => {
    const unread = (o.messages || []).filter((m) => m.from_customer && !m.read_by_staff);
    if (!unread.length) return;
    const idList = unread.map((m) => m.id);
    setOrders((os) => os.map((x) => x.id === o.id ? { ...x, messages: (x.messages || []).map((m) => idList.includes(m.id) ? { ...m, read_by_staff: true } : m) } : x));
    try { await supabase.from('messages').update({ read_by_staff: true }).in('id', idList); } catch {}
    // Mirror the read into message_reads so the Messages inbox / dashboard
    // unread badge clears too (the two surfaces track reads separately).
    if (cu && cu.id) { try { await supabase.from('message_reads').upsert(idList.map((id) => ({ message_id: id, user_id: cu.id })), { onConflict: 'message_id,user_id' }); } catch {} }
  };
  // Deep-link from the Messages inbox: expand the targeted order, clear its
  // unread badge, and scroll it into view once orders have loaded.
  useEffect(() => {
    if (!focusOrderId) return;
    const o = orders.find((x) => String(x.id) === String(focusOrderId));
    if (!o) return; // orders may still be loading; this re-runs when they arrive
    setExpanded(o.id);
    markThreadRead(o);
    setTimeout(() => { try { const el = document.getElementById('omg-order-' + o.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {} }, 150);
    onFocusHandled && onFocusHandled();
  }, [focusOrderId, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  // The 'Shipping' box shows how many of a line go out (defaults to full qty);
  // reducing it records the remainder as short (missing_qty = qty − shipping).
  const setItemShipping = (orderId, item, v) => {
    const qty = Number(item.qty) || 0;
    const ship = Math.max(0, Math.min(qty, Number(v) || 0));
    setItemMissing(orderId, item.id, qty - ship);
  };

  // ── Order selection for bulk actions (labels + packing lists) ──
  const toggleSelId = (id) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = orders.length > 0 && selIds.size >= orders.length;
  const toggleSelectAll = () => setSelIds((s) => (s.size >= orders.length ? new Set() : new Set(orders.map((o) => o.id))));
  const selectedPool = () => (selIds.size ? orders.filter((o) => selIds.has(o.id)) : orders);

  // Save line-item edits for one order (size/qty + removals). No money moves —
  // OMG handles parent refunds; removed lines simply won't ship.
  const saveOrderItems = async (orderId, rows, patch) => {
    try {
      for (const r of rows) {
        if (r._removed) { await supabase.from('webstore_order_items').delete().eq('id', r.id); continue; }
        await supabase.from('webstore_order_items').update({ size: r.size || null, qty: Math.max(1, Number(r.qty) || 1) }).eq('id', r.id);
      }
      if (patch && Object.keys(patch).length) await supabase.from('webstore_orders').update(patch).eq('id', orderId);
      await loadOrders(store);
      flash('Order updated.');
      return true;
    } catch (e) { flash('Could not save: ' + e.message, 'err'); return false; }
  };

  // Print packing slips for the chosen orders — every line, flagging the ones
  // held back (short / not shipping) for the packer's reference.
  const printOmgPacking = (subset) => {
    const list = subset || selectedPool();
    if (!list.length) { flash('No orders to print.', 'err'); return; }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const slips = list.map((o) => {
      const a = o.ship_address || {};
      const shipTo = shipToSchool ? 'Deliver to school' : [a.name || o.buyer_name, a.street1, a.street2, [a.city, a.state, a.zip].filter(Boolean).join(', ')].filter(Boolean).map(esc).join('<br>');
      const rows = o.items.filter((i) => !i.is_bundle_parent).map((i) => {
        const qty = Number(i.qty) || 0; const ship = Math.max(0, qty - (Number(i.missing_qty) || 0)); const held = ship < qty;
        return `<tr class="${held ? 'held' : ''}"><td>${esc(i.name || i.sku || '')}</td><td>${esc(i.color || '')}</td><td>${esc(i.size || '')}</td><td class="c">${qty}</td><td class="c b">${ship}</td><td>${held ? (ship === 0 ? '⛔ NOT SHIPPING' : (qty - ship) + ' short') : '✓'}</td></tr>`;
      }).join('');
      return `<div class="slip"><div class="hd"><div class="t">${esc(storeName || '')}</div><div class="s">Packing list · Order ${esc(o.omg_order_number || '')}</div></div>
        <div class="meta"><b>Player:</b> ${esc(o.buyer_name || '')}<br><b>Ship to:</b><br>${shipTo || '—'}</div>
        <table><thead><tr><th>Item</th><th>Color</th><th>Size</th><th>Qty</th><th>Shipping</th><th>INC</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="ft">Lines marked “short / not shipping” stay on the order and ship once back in stock.</div></div>`;
    }).join('');
    const html = `<!doctype html><html><head><title>Packing lists</title><style>
      *{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#0f172a}
      .slip{padding:24px;page-break-after:always}
      .hd{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #0f172a;padding-bottom:6px;margin-bottom:8px}
      .t{font-size:20px;font-weight:800}.s{font-size:12px;color:#64748b}
      .meta{font-size:12.5px;margin-bottom:10px;line-height:1.5}
      table{width:100%;border-collapse:collapse;font-size:12.5px}
      th{text-align:left;border-bottom:1px solid #cbd5e1;padding:5px 6px;font-size:10.5px;text-transform:uppercase;color:#64748b}
      td{padding:5px 6px;border-bottom:1px solid #eef1f5}.c{text-align:center}.b{font-weight:800}
      tr.held td{color:#b45309}
      .ft{margin-top:10px;font-size:10.5px;color:#94a3b8}
    </style></head><body>${slips || '<div class="slip">No orders.</div>'}</body></html>`;
    const w = window.open('', '_blank'); if (!w) { flash('Pop-up blocked — allow pop-ups to print.', 'err'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 350);
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

  // Status auto-syncs from the linked Sales Order in App.js (pushOmgStatusSync,
  // fired from savSO on every receiving/jobs change). The portal just reads the
  // result; no manual sync action here. soSync is used only to show SO state.

  // Push to ShipStation using the 'WS-<id>' convention so the existing
  // shipstation-webhook records the shipment and emails the parent on ship.
  const ssPayload = (o) => {
    const a = o.ship_address || {};
    return {
      orderNumber: 'WS-' + o.id, orderKey: 'ws-' + o.id, orderDate: o.created_at || new Date().toISOString(), orderStatus: 'awaiting_shipment',
      customerUsername: storeName || saleCode, customerEmail: o.buyer_email || '', billTo: { name: o.buyer_name || a.name || 'Customer' },
      shipTo: { name: a.name || o.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: o.buyer_phone || '', residential: true },
      items: o.items.map((i) => ({ lineItemKey: i.id, sku: i.sku || '', name: [i.name || i.sku, i.size && ('Size ' + i.size), i.player_name].filter(Boolean).join(' · '), quantity: i.qty || 1, unitPrice: Number(i.unit_price) || 0, imageUrl: i.image_url || undefined, options: [i.size && { name: 'Size', value: i.size }, i.color && { name: 'Color', value: i.color }].filter(Boolean) })),
      amountPaid: Number(o.total) || 0,
      advancedOptions: { source: 'NSA OMG', customField1: storeName || '', customField2: saleCode || '', ...(store && store.shipstation_store_id ? { storeId: Number(store.shipstation_store_id) || undefined } : {}) },
    };
  };
  // ── In-portal label creation (bulk shipping happens here, not in ShipStation).
  // Lines flagged short (missing_qty > 0) are held; already-shipped lines are
  // skipped so re-runs ship only what's newly in-hand and the order stays open
  // until everything goes out. Label cost is summed onto the related SO. ──
  // Units still to ship on a line = ordered − already shipped − short-right-now.
  const shipPlan = (o) => o.items.map((i) => {
    const remaining = (Number(i.qty) || 0) - (Number(i.shipped_qty) || 0);
    return { item: i, qty: Math.max(0, remaining - (Number(i.missing_qty) || 0)) };
  }).filter((x) => x.qty > 0);

  const createOmgLabel = async (o, plan) => {
    const a = o.ship_address || {};
    const shipItems = plan.map((x) => ({ ...x.item, qty: x.qty }));
    const ss = await shipStationCall('/orders/createorder', { method: 'POST', body: JSON.stringify(ssPayload({ ...o, items: shipItems })) });
    const orderId = ss && ss.orderId;
    if (!orderId) throw new Error('ShipStation order not created');
    if (store && Number(store.shipstation_tag_id)) { try { await shipStationCall('/orders/addtag', { method: 'POST', body: JSON.stringify({ orderId, tagId: Number(store.shipstation_tag_id) }) }); } catch {} }
    const cm = SS_CARRIERS[((store && store.shipstation_carrier) || 'fedex').toLowerCase()] || SS_CARRIERS.fedex;
    const payload = {
      orderId, carrierCode: cm.carrierCode, serviceCode: (store && store.shipstation_service) || cm.serviceCode,
      packageCode: 'package', confirmation: 'none', shipDate: new Date().toISOString().split('T')[0],
      weight: { value: labelWeightLbs(shipItems, store), units: 'pounds' },
      shipFrom: { name: NSA.name, company: NSA.name, street1: NSA.addr, city: NSA.city, state: NSA.state, postalCode: NSA.zip, country: 'US', phone: NSA.phone },
      shipTo: { name: a.name || o.buyer_name || '', street1: a.street1 || '', street2: a.street2 || '', city: a.city || '', state: a.state || '', postalCode: a.zip || '', country: a.country || 'US', phone: o.buyer_phone || '' },
      testLabel: false,
    };
    const res = await shipStationCall('/orders/createlabelfororder', { method: 'POST', body: JSON.stringify(payload) });
    return { labelData: res.labelData, trackingNumber: res.trackingNumber, carrier: cm.carrierCode, shipmentId: res.shipmentId || null, cost: res.shipmentCost != null ? Number(res.shipmentCost) + (Number(res.insuranceCost) || 0) : null };
  };

  // Set the related Sales Order's outbound shipping cost to the sum of every
  // order's label_cost in this store (idempotent — no incremental drift on
  // re-runs or voids). The webhook later overwrites this with the same sum once
  // ShipStation reports each shipment's actual billed cost. Prefer the exact SO
  // shown in the portal (soSync.soId); fall back to the newest SO linked by
  // omg_store_id (a store can have more than one if its SO was redone).
  const recomputeSOCost = async () => {
    if (!store) return;
    try {
      const { data: ords } = await supabase.from('webstore_orders').select('label_cost').eq('store_id', store.id);
      const total = (ords || []).reduce((a, o) => a + (Number(o.label_cost) || 0), 0);
      let so = null;
      if (soSync && soSync.soId) { const { data } = await supabase.from('sales_orders').select('id').eq('id', soSync.soId).maybeSingle(); so = data || null; }
      if (!so) { const { data } = await supabase.from('sales_orders').select('id').eq('omg_store_id', 'OMG-sale_' + saleCode).order('created_at', { ascending: false }).limit(1); so = (data && data[0]) || null; }
      if (!so) return;
      await supabase.from('sales_orders').update({ _shipping_cost: total, _shipstation_cost: total }).eq('id', so.id);
    } catch {}
  };

  const printOmgLabels = async (subset) => {
    if (shipToSchool) { flash('Ship-to-school store — bulk delivery, no per-player labels.', 'err'); return; }
    const pool = subset || orders;
    const selected = pool.length;
    const errors = [];
    const eligible = pool.filter((o) => {
      // Surface *why* a selected order is being skipped instead of silently
      // dropping it — otherwise "3 checked, 2 printed" looks like a lost label.
      if (!shipPlan(o).length) {
        const allShipped = o.items.every((i) => (Number(i.shipped_qty) || 0) >= (Number(i.qty) || 0));
        errors.push({ order: o.omg_order_number, msg: allShipped ? 'Already fully shipped — use Reprint for another copy' : 'Nothing to ship — every line is held short' });
        return false;
      }
      const err = validateShipAddress(o.ship_address);
      if (err) { errors.push({ order: o.omg_order_number, msg: err }); return false; } // skip undeliverable addresses
      return true;
    });
    if (!eligible.length) { setShipErrors(errors); flash(errors.length ? `Nothing printed — all ${selected} selected order${selected === 1 ? '' : 's'} were skipped (see the list below).` : 'Nothing ready to ship — everything is shipped or short.', 'err'); return; }
    setBusy('labels');
    const labels = []; let ok = 0, runCost = 0;
    for (const o of eligible) {
      const plan = shipPlan(o);
      try {
        const { labelData, trackingNumber, carrier, shipmentId, cost } = await createOmgLabel(o, plan);
        if (labelData) labels.push(labelData);
        runCost += Number(cost) || 0; ok++;
        // Optimistically advance each shipped line so a quick re-click won't
        // double-ship; the webhook later reconciles shipped_qty from the
        // recorded shipment, so this never double-counts.
        for (const x of plan) {
          const i = x.item; const sq = (Number(i.shipped_qty) || 0) + x.qty; const done = sq >= (Number(i.qty) || 0);
          await supabase.from('webstore_order_items').update({ shipped_qty: sq, ...(done ? { line_status: 'shipped' } : {}) }).eq('id', i.id);
          i.shipped_qty = sq; if (done) i.line_status = 'shipped';
        }
        const fullyShipped = o.items.every((i) => (Number(i.shipped_qty) || 0) >= (Number(i.qty) || 0));
        await supabase.from('webstore_orders').update({ tracking_number: trackingNumber || null, carrier: carrier || null, label_cost: cost != null ? cost : null, label_data: labelData || null, shipstation_shipment_id: shipmentId, ...(fullyShipped ? { shipped_at: new Date().toISOString() } : {}) }).eq('id', o.id);
      } catch (e) { errors.push({ order: o.omg_order_number, msg: (e && e.message) || 'Label failed' }); }
    }
    await recomputeSOCost();
    let printed = 0;
    if (labels.length) printed = await printPdfLabels(labels);
    await loadOrders(store);
    setShipErrors(errors);
    setBusy('');
    flash(`Printed ${printed || labels.length} of ${selected} selected label${selected === 1 ? '' : 's'}${errors.length ? ` · ${errors.length} skipped (below)` : ''}${runCost > 0 ? ` · ${money(runCost)} shipping` : ''}.`, errors.length ? 'err' : 'ok');
  };

  // Reprint the last saved label for one order — no re-buy.
  const reprintOmgLabel = async (o) => {
    if (!o.label_data) { flash('No saved label to reprint — create the label first.', 'err'); return; }
    try { await printPdfLabels([o.label_data]); } catch { flash('Could not open the label.', 'err'); }
  };

  // Void the last label in ShipStation and roll the order's shipping back.
  const voidOmgLabel = async (o) => {
    if (!o.shipstation_shipment_id) { flash('No ShipStation shipment on file to void.', 'err'); return; }
    if (!window.confirm(`Void the label for order ${o.omg_order_number}? This cancels it in ShipStation and reopens the order.`)) return;
    setBusy('void-' + o.id);
    try {
      const res = await shipStationCall('/shipments/voidlabel', { method: 'POST', body: JSON.stringify({ shipmentId: Number(o.shipstation_shipment_id) }) });
      if (res && res.approved === false) throw new Error(res.message || 'ShipStation declined the void.');
      // Roll back the shipped lines, drop the recorded shipments, and clear the
      // order's ship fields. (Voids the whole order's last shipment; multi-
      // shipment split-voids aren't tracked.)
      await supabase.from('webstore_order_items').update({ shipped_qty: 0, line_status: 'bagging' }).eq('order_id', o.id).eq('line_status', 'shipped');
      await supabase.from('webstore_shipments').delete().eq('order_id', o.id);
      await supabase.from('webstore_orders').update({ tracking_number: null, carrier: null, label_data: null, shipstation_shipment_id: null, label_cost: null, shipped_at: null }).eq('id', o.id);
      await recomputeSOCost();
      await loadOrders(store);
      flash(`Label voided for ${o.omg_order_number}.`);
    } catch (e) { flash('Void failed: ' + e.message, 'err'); } finally { setBusy(''); }
  };

  const updateDraft = (idx, field, value) => setDraftContacts((cs) => cs.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  // Map order number → its parsed-slip draft index, so the orders table itself
  // becomes the review surface (one section instead of a separate grid).
  const draftIdxByNum = draftContacts ? Object.fromEntries(draftContacts.map((c, i) => [String(c.orderNumber || '').trim(), i])) : null;
  // Always the public marketing URL (nationalsportsapparel.com 200-proxies /shop/*) so the
  // tracking link staff copy/send never exposes the raw nsa-portal.netlify.app app origin.
  const trackUrl = (o) => `https://nationalsportsapparel.com/shop/order/${o.status_token}`;
  const withEmail = orders.filter((o) => o.buyer_email).length;
  const withAddress = orders.filter((o) => o.ship_address && o.ship_address.street1).length;
  // Per-line incoming-stock tracking (Billed/Received/Need), FIFO-allocated to
  // the earliest orders first. OMG is made-to-order, so on-IF isn't counted.
  const tracking = useMemo(() => computeOrderTracking({ orders, so: linkedSO, products, includeIF: false }), [orders, linkedSO, products]);
  const hasSO = !!linkedSO;
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
        {shipErrors.length > 0 && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa' }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, color: '#9a3412', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>⚠️ {shipErrors.length} order{shipErrors.length === 1 ? '' : 's'} skipped<button onClick={() => setShipErrors([])} style={{ ...linkBtn, marginLeft: 'auto', color: '#9a3412' }}>Dismiss</button></div>
          {shipErrors.map((e, i) => <div key={i} style={{ fontSize: 12, color: '#7c2d12' }}><b>{e.order || '—'}</b> — {e.msg}</div>)}
        </div>}

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
              {/* Status auto-syncs from the linked SO as the warehouse receives &
                  produces (backordered SKU+sizes hold at on-order). The Move-all
                  buttons remain as manual overrides. */}
              {soSync && soSync.storeStage
                ? <span style={{ fontSize: 11.5, color: '#166534', fontWeight: 700 }}>🔄 Auto-syncing from SO {soSync.soId} · {soSync.soStatus.replace(/_/g, ' ')}</span>
                : <span style={{ fontSize: 11.5, color: '#94a3b8' }}>🔄 Status auto-syncs from the Sales Order during fulfillment</span>}
              {soSync && soSync.soId && onOpenSO && <button onClick={onOpenSO} style={{ ...linkBtn, color: '#2563eb', fontWeight: 700 }} title="Open the linked Sales Order">📋 Open SO {soSync.soId} →</button>}
              <span style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 4px' }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>Move all:</span>
              {[['pending', 'On order'], ['received', 'Received'], ['in_production', 'In production'], ['bagging', 'Bagging'], ['shipped', 'Shipped']].map(([ls, label]) => (
                <button key={ls} onClick={() => advanceAll(ls)} disabled={busy === 'advance'} style={stageBtn(ls)}>{label}</button>
              ))}
              <span style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 4px' }} />
              {!selIds.size && <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Check orders to print labels or packing lists</span>}
              <button onClick={() => printOmgPacking()} disabled={!selIds.size} style={{ ...secondaryBtn, opacity: selIds.size ? 1 : 0.5, cursor: selIds.size ? 'pointer' : 'not-allowed' }} title={selIds.size ? `Packing lists for ${selIds.size} selected` : 'Select orders first'}>🖨️ Packing lists{selIds.size ? ` (${selIds.size})` : ''}</button>
              {shipToSchool
                ? <span style={{ fontSize: 11.5, color: '#1e40af', fontWeight: 700 }}>🏫 Deliver to school — bulk delivery, no per-player shipping labels</span>
                : <>
                    <button onClick={() => printOmgLabels(selectedPool())} disabled={busy === 'labels' || !selIds.size} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#166534', color: '#fff', fontWeight: 700, fontSize: 13, cursor: selIds.size ? 'pointer' : 'not-allowed', opacity: selIds.size ? 1 : 0.5 }}>{busy === 'labels' ? 'Creating…' : `🏷️ Create & print ${selIds.size} label${selIds.size === 1 ? '' : 's'}`}</button>
                  </>}
            </div>}

            {/* Orders table (expandable) — doubles as the contact-review surface */}
            <div style={{ overflowX: 'auto', border: '1px solid #eef1f5', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                  <th style={th}><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} title="Select all" /></th>
                  {['', 'Order #', 'Player', draftContacts ? 'Email' : '✉', 'Items', 'Status', 'Total', 'Link'].map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {orders.map((o) => {
                    const st = orderStatus(o.items);
                    const isOpen = expanded === o.id;
                    const missing = o.items.reduce((a, i) => a + (Number(i.missing_qty) || 0), 0);
                    const di = draftIdxByNum ? draftIdxByNum[String(o.omg_order_number)] : null;
                    return (
                      <React.Fragment key={o.id}>
                        <tr id={'omg-order-' + o.id} style={{ borderTop: '1px solid #f1f5f9', background: isOpen ? '#e7ecf3' : '#fff', cursor: 'pointer' }} onClick={() => { const opening = !isOpen; setExpanded(isOpen ? null : o.id); if (opening) markThreadRead(o); }}>
                          <td style={td} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selIds.has(o.id)} onChange={() => toggleSelId(o.id)} /></td>
                          <td style={{ ...td, width: 24, color: '#94a3b8' }}>{isOpen ? '▾' : '▸'}</td>
                          <td style={td}>{o.omg_order_number}</td>
                          <td style={td}>{o.buyer_name || '—'}{unreadReplies(o) > 0 && <span title={`${unreadReplies(o)} new customer ${unreadReplies(o) === 1 ? 'reply' : 'replies'}`} style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10.5, fontWeight: 800 }}>💬 {unreadReplies(o)}</span>}</td>
                          {di != null
                            ? <td style={td} onClick={(e) => e.stopPropagation()}><input value={(draftContacts[di].email) || ''} onChange={(e) => updateDraft(di, 'email', e.target.value)} placeholder="email…" style={{ ...cell, minWidth: 150, ...(draftContacts[di].email ? {} : { background: '#fff7ed', borderColor: '#fdba74' }) }} /></td>
                            : <td style={{ ...td, textAlign: 'center' }} title={o.buyer_email || 'No email — expand to add'}>{o.buyer_email
                                ? <span style={{ color: o.processing_email_sent ? '#166534' : '#16a34a', fontSize: 14 }}>{o.processing_email_sent ? '✓' : '●'}</span>
                                : <span style={{ color: '#dc2626', fontSize: 14 }} title="No email">⚠</span>}</td>}
                          <td style={td}>{(() => { const shp = o.items.filter((i) => i.line_status === 'shipped').length; return <>{o.items.length}{shp > 0 && <span style={{ color: '#166534', fontWeight: 700 }}> · {shp} shipped</span>}{missing > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> · {missing} short</span>}</>; })()}</td>
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
                          <tr style={{ background: '#e7ecf3' }}>
                            <td colSpan={9} style={{ padding: '4px 16px 16px' }} onClick={(e) => e.stopPropagation()}>
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
                                  {(o.label_cost != null || o.tracking_number) && <div><span style={{ color: '#94a3b8' }}>Label </span><b>{o.label_cost != null ? money(o.label_cost) : '—'}</b>{o.carrier ? ' · ' + String(o.carrier).toUpperCase().replace('STAMPS_COM', 'USPS') : ''}{o.tracking_number ? ' · ' + o.tracking_number : ''}</div>}
                                </div>
                              )}
                              {!draftContacts && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0 10px' }}>
                                <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>Set status:</span>
                                {[['pending', 'On order'], ['received', 'Received'], ['in_production', 'In production'], ['bagging', 'Bagging'], ['shipped', 'Shipped']].map(([ls, label]) => (
                                  <button key={ls} onClick={() => setLineStatus(o.id, ls)} disabled={busy === 'status-' + o.id} style={{ ...stageBtn(ls), opacity: st === ls ? 1 : 0.72, outline: st === ls ? '2px solid #0f172a' : 'none' }}>{label}</button>
                                ))}
                                <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 2px' }} />
                                <button onClick={() => setEditOrder(o)} style={{ ...secondaryBtn, padding: '7px 13px', fontSize: 12.5 }}>✏️ Edit order</button>
                                {!shipToSchool && <>
                                  <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 2px' }} />
                                  <button onClick={() => printOmgLabels([o])} disabled={busy === 'labels'} style={{ padding: '7px 13px', borderRadius: 8, border: 'none', background: '#166534', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{busy === 'labels' ? 'Creating…' : '🏷️ Create & print label'}</button>
                                  {o.label_data && <button onClick={() => reprintOmgLabel(o)} style={{ ...secondaryBtn, padding: '7px 13px', fontSize: 12.5 }}>🔁 Reprint</button>}
                                  {o.shipstation_shipment_id && <button onClick={() => voidOmgLabel(o)} disabled={busy === 'void-' + o.id} style={{ ...secondaryBtn, padding: '7px 13px', fontSize: 12.5, color: '#b91c1c', borderColor: '#fecaca' }}>{busy === 'void-' + o.id ? 'Voiding…' : '✖ Void'}</button>}
                                </>}
                              </div>}
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 4 }}>
                                <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                                  {[['Item', ''], ['SKU', ''], ['Color', ''], ['Size', ''], ['Ordered', 'c'], ['Billed', 'c'], ['Received', 'c'], ['Need', 'c'], ['Status', 'c'], ['Shipping', 'c']].map(([h, al]) => <th key={h} style={{ ...th, fontSize: 10.5, textAlign: al === 'c' ? 'center' : 'left' }} title={h === 'Billed' ? 'Units the vendor has shipped (from uploaded bills)' : h === 'Received' ? 'Units received into the warehouse, allocated earliest-orders-first' : h === 'Need' ? 'Units still owed to this order' : h === 'SKU' ? 'SKU from the linked Sales Order' : undefined}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                  {o.items.map((i) => {
                                    const t = tracking[i.id] || { ordered: Number(i.qty) || 0, billed: 0, received: 0, need: Number(i.qty) || 0, status: 'awaiting' };
                                    const qty = Number(i.qty) || 0;
                                    const ctd = { ...td, textAlign: 'center' };
                                    const num = (n, strong) => <span style={{ color: n > 0 ? '#0f172a' : '#cbd5e1', fontWeight: strong ? 700 : 500 }}>{n}</span>;
                                    const pill = TRACK_PILL[t.status] || TRACK_PILL.backordered;
                                    const ship = Math.max(0, qty - (Number(i.missing_qty) || 0)); const short = ship < qty;
                                    return (
                                      <tr key={i.id} style={{ borderTop: '1px solid #eef1f5' }}>
                                        <td style={td}>{i.name || i.sku || '—'}</td>
                                        <td style={td}>{t.sku ? <span style={{ fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700, color: '#1e40af', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }} title="SKU from the linked Sales Order">{t.sku}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                                        <td style={td}>{i.color || '—'}</td>
                                        <td style={td}>{i.size || '—'}</td>
                                        <td style={ctd}>{num(qty, true)}</td>
                                        <td style={ctd}>{hasSO ? num(t.billed) : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                                        <td style={ctd}>{hasSO ? <span style={{ color: t.received >= qty && qty > 0 ? '#166534' : t.received > 0 ? '#0f172a' : '#cbd5e1', fontWeight: t.received > 0 ? 700 : 500 }}>{t.received}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                                        <td style={ctd}>{!hasSO ? <span style={{ color: '#cbd5e1' }}>—</span> : t.need > 0 ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '1px 8px', fontWeight: 800 }}>{t.need}</span> : <span style={{ color: '#16a34a', fontWeight: 800 }} title="Fully covered">✓</span>}</td>
                                        <td style={ctd}>{hasSO ? <span style={{ background: pill.bg, color: pill.color, borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{pill.label}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                                        <td style={ctd}><input type="number" min={0} max={qty} value={ship} onChange={(e) => setItemShipping(o.id, i, e.target.value)} title={short ? `${qty - ship} held short` : 'All shipping'} style={{ ...cell, width: 58, textAlign: 'center', ...(short ? { background: '#fffbeb', borderColor: '#fde68a' } : {}) }} /></td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              <div style={{ marginTop: 8, fontSize: 11.5, color: '#94a3b8' }}>{hasSO ? 'Billed = vendor shipped (from uploaded bills) · Received = in the warehouse, given to the earliest orders first · Need = still owed. ' : 'Incoming columns appear once this store’s Sales Order is created. '}“Shipping” starts full — lower it to hold items short (the parent sees a “delayed” notice).</div>

                              {/* Customer message thread — stays attached to the order; the
                                  parent reads & replies on their portal page. */}
                              <div style={{ marginTop: 14, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                                <div style={{ padding: '8px 12px', background: '#f1f5f9', fontWeight: 700, fontSize: 12, color: '#334155' }}>💬 Messages with {o.buyer_name || 'the parent'}</div>
                                <div style={{ padding: 12, maxHeight: 240, overflowY: 'auto', background: '#fff' }}>
                                  {(o.messages || []).length === 0
                                    ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No messages yet. Send one below — the parent gets an email with a link to read & reply.</div>
                                    : (o.messages || []).map((m) => (
                                        <div key={m.id} style={{ display: 'flex', justifyContent: m.from_customer ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
                                          <div style={{ maxWidth: '78%', padding: '7px 11px', borderRadius: 10, fontSize: 13, background: m.from_customer ? '#f1f5f9' : '#dcfce7', color: '#0f172a' }}>
                                            <div style={{ fontSize: 10.5, fontWeight: 700, color: m.from_customer ? '#475569' : '#166534', marginBottom: 2 }}>{m.from_customer ? (o.buyer_name || 'Customer') : (m.author || 'NSA')}<span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>{m.ts ? new Date(m.ts).toLocaleString() : ''}</span></div>
                                            <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                                          </div>
                                        </div>
                                      ))}
                                </div>
                                <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #eef1f5', background: '#fafbfc' }}>
                                  <input value={msgDraft[o.id] || ''} onChange={(e) => setMsgDraft((d) => ({ ...d, [o.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrderMessage(o); } }} placeholder={o.buyer_email ? 'Message the parent…' : 'No buyer email — add one in Edit order to notify them'} style={{ ...cell, flex: 1 }} />
                                  <button onClick={() => sendOrderMessage(o)} disabled={msgBusy === o.id || !(msgDraft[o.id] || '').trim()} style={{ ...primaryBtn, padding: '8px 16px', opacity: (msgBusy === o.id || !(msgDraft[o.id] || '').trim()) ? 0.5 : 1 }}>{msgBusy === o.id ? 'Sending…' : 'Send'}</button>
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
            </div>
            {notified > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>Already-emailed parents won’t be re-sent. <button onClick={() => sendEmails(true)} disabled={busy === 'notify'} style={{ ...linkBtn, color: '#2563eb' }}>Force re-send all</button></div>}
            </>}
          </>
        )}
        {editOrder && <OmgItemEditModal order={editOrder} onSave={saveOrderItems} onClose={() => setEditOrder(null)} />}
      </div>
    </div>
  );
}

// Edit an OMG order — fix the ship-to address and the line items (size/qty or
// remove). No money moves (OMG handles parent refunds); removed lines just
// won't ship.
function OmgItemEditModal({ order, onSave, onClose }) {
  const editable = (order.items || []).filter((i) => !i.is_bundle_parent);
  const [rows, setRows] = useState(() => editable.map((i) => ({ id: i.id, name: i.name || i.sku, sku: i.sku, color: i.color, size: i.size || '', qty: i.qty || 1, _removed: false })));
  const a0 = order.ship_address || {};
  const [addr, setAddr] = useState({ name: a0.name || order.buyer_name || '', street1: a0.street1 || '', street2: a0.street2 || '', city: a0.city || '', state: a0.state || '', zip: a0.zip || '', country: a0.country || 'US' });
  const [phone, setPhone] = useState(order.buyer_phone || '');
  const [busy, setBusy] = useState(false);
  const upd = (id, k, v) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const ua = (k, v) => setAddr((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setBusy(true);
    const patch = { ship_address: { ...a0, ...addr }, buyer_phone: phone || null };
    const ok = await onSave(order.id, rows, patch);
    setBusy(false); if (ok) onClose();
  };
  const fld = { padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 560, width: '100%', marginTop: 24, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>Edit order {order.omg_order_number}</h3>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b', margin: '6px 0 8px' }}>Ship to</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <input value={addr.name} onChange={(e) => ua('name', e.target.value)} placeholder="name" style={{ ...fld, flex: '1 1 160px' }} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="phone" style={{ ...fld, flex: '1 1 130px' }} />
          <input value={addr.street1} onChange={(e) => ua('street1', e.target.value)} placeholder="street" style={{ ...fld, flex: '1 1 100%' }} />
          <input value={addr.street2} onChange={(e) => ua('street2', e.target.value)} placeholder="apt / suite (optional)" style={{ ...fld, flex: '1 1 100%' }} />
          <input value={addr.city} onChange={(e) => ua('city', e.target.value)} placeholder="city" style={{ ...fld, flex: '2 1 140px' }} />
          <input value={addr.state} onChange={(e) => ua('state', e.target.value)} placeholder="ST" style={{ ...fld, flex: '0 1 60px' }} />
          <input value={addr.zip} onChange={(e) => ua('zip', e.target.value)} placeholder="zip" style={{ ...fld, flex: '0 1 90px' }} />
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b', marginBottom: 4 }}>Items</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Change a size or quantity, or remove a line. This changes what ships — it doesn’t move money (OMG handles parent refunds).</div>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9', opacity: r._removed ? 0.4 : 1 }}>
            <div style={{ flex: 1, fontSize: 13 }}><div style={{ fontWeight: 600 }}>{r.name || r.sku || 'Item'}</div>{r.color && <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.color}</div>}</div>
            <input value={r.size} disabled={r._removed} onChange={(e) => upd(r.id, 'size', e.target.value)} placeholder="size" style={{ width: 72, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
            <input type="number" min={1} value={r.qty} disabled={r._removed} onChange={(e) => upd(r.id, 'qty', e.target.value)} style={{ width: 60, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
            <button onClick={() => upd(r.id, '_removed', !r._removed)} style={{ background: 'none', border: 'none', color: r._removed ? '#2563eb' : '#b91c1c', cursor: 'pointer', fontSize: 12 }}>{r._removed ? 'undo' : 'remove'}</button>
          </div>
        ))}
        {!rows.length && <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '8px 0' }}>No editable line items.</div>}
        <button onClick={save} disabled={busy} style={{ marginTop: 14, padding: '9px 16px', borderRadius: 8, border: 'none', background: '#166534', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save changes'}</button>
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

// Warehouse pipeline. 'pending' is the initial "On order" state; 'shipped' is
// the final stage (set when ShipStation creates the label).
const OMG_STAGES = [
  ['pending', 'On order', '#f1f5f9', '#475569'],
  ['received', 'Received', '#eef2ff', '#3730a3'],
  ['in_production', 'In production', '#fef3c7', '#92400e'],
  ['bagging', 'Bagging', '#fae8ff', '#86198f'],
  ['shipped', 'Shipped', '#dcfce7', '#166534'],
];
const OMG_STAGE_COLORS = Object.fromEntries(OMG_STAGES.map(([k, , bg, fg]) => [k, [bg, fg]]));
const OMG_STAGE_ORDER = { pending: 0, received: 1, in_production: 2, bagging: 3, shipped: 4, complete: 4 };
// Roll up the per-item line_status into one order-level status. If SOME but not
// all items are shipped, the order is "partially shipped"; otherwise it's the
// least-advanced stage across the items.
function orderStatus(items) {
  const live = (items || []).filter((i) => i.line_status !== 'cancelled');
  if (!live.length) return 'pending';
  const idxs = live.map((i) => OMG_STAGE_ORDER[i.line_status] ?? 0);
  const shipped = idxs.filter((x) => x >= 4).length;
  if (shipped > 0 && shipped < live.length) return 'partial_shipped';
  return OMG_STAGES[Math.min(...idxs)][0];
}
function StatusPill({ s }) {
  const m = s === 'partial_shipped' ? ['partial_shipped', 'Partially shipped', '#fef9c3', '#854d0e']
    : OMG_STAGES.find((x) => x[0] === s) || (s === 'complete' ? OMG_STAGES[4] : s === 'cancelled' ? ['cancelled', 'Cancelled', '#fee2e2', '#991b1b'] : OMG_STAGES[0]);
  const [, label, bg, fg] = m;
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: bg, color: fg }}>{label}</span>;
}

const cell = { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12.5, boxSizing: 'border-box', fontFamily: 'inherit' };
const th = { padding: '9px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', verticalAlign: 'middle' };
const primaryBtn = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const secondaryBtn = { padding: '9px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' };
const linkBtn = { background: 'none', border: 'none', color: '#64748b', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: '2px 6px' };
function stageBtn(ls) {
  const c = OMG_STAGE_COLORS[ls] || ['#f1f5f9', '#475569'];
  return { padding: '7px 13px', borderRadius: 8, border: 'none', background: c[0], color: c[1], fontWeight: 700, fontSize: 12.5, cursor: 'pointer' };
}
