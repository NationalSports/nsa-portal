/* eslint-disable */
// Admin page: OMG Order Tracking & Parent Portal.
//
// Turns an OMG *player report* into per-order tracking rows (reusing the
// webstore order rails — see migration 034 + omg-player-report-ingest.js),
// enriches them with buyer email/address parsed from the packing-slip PDF in
// the browser, and sends each parent a private "order is being processed" link
// to the public status page (/shop/order/<token>).
//
// Mounted lazily from App.js (pg==='omg_tracking'). Self-contained: talks to
// Supabase directly and to the three omg-* Netlify functions.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase';

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

// Best-effort: from one packing-slip page's text lines, pull a contact record.
// The admin reviews/edits everything before it's saved, so heuristics are fine.
function parsePage(lines) {
  const text = lines.join('\n');
  const email = (text.match(EMAIL_RE) || [])[0] || '';
  const phone = (text.match(PHONE_RE) || [])[0] || '';
  // Order #: the long order number near an "Order" label, else first 8-10 digit run.
  let orderNumber = '';
  const omLabeled = text.match(/Order\s*#?\s*[:\-]?\s*(\d{6,})/i);
  if (omLabeled) orderNumber = omLabeled[1];
  else { const m = text.match(/\b(\d{8,10})\b/); if (m) orderNumber = m[1]; }

  // Name + address: look at the "Bill To" / "Ship To" / "Customer Details" area.
  // Grab the line with STATE ZIP and the two lines above it as the address.
  let address = null, name = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(STATE_ZIP_RE);
    if (m) {
      const cityState = lines[i].trim();                       // "Laguna Niguel, CA 92677"
      const street = (lines[i - 1] || '').trim();              // "60 Oakcliff Dr"
      const maybeName = (lines[i - 2] || '').trim();           // "Vincent L Carpino"
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
  // Fallback name: the "Customer Details" first non-label line.
  if (!name) {
    const cd = text.match(/Customer Details\s*\n\s*([^\n]+)/i);
    if (cd) name = cd[1].trim();
  }
  return { orderNumber, email, phone, name, address };
}

async function parsePackingSlip(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const contacts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text items into visual lines by their y-position.
    const byRow = {};
    content.items.forEach((it) => {
      const y = Math.round(it.transform[5]);
      (byRow[y] = byRow[y] || []).push({ x: it.transform[4], s: it.str });
    });
    const lines = Object.keys(byRow).map(Number).sort((a, b) => b - a)
      .map((y) => byRow[y].sort((a, b) => a.x - b.x).map((o) => o.s).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const c = parsePage(lines);
    if (c.orderNumber || c.email) contacts.push(c);
  }
  return contacts;
}

export default function OmgOrderTracking() {
  const [stores, setStores] = useState([]);
  const [sel, setSel] = useState(null);          // selected shadow store
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);          // {kind,text}
  const [reportUrl, setReportUrl] = useState('');
  const [draftContacts, setDraftContacts] = useState(null); // parsed, editable
  const fileRef = useRef(null);

  const flash = (text, kind = 'ok') => { setMsg({ text, kind }); setTimeout(() => setMsg(null), 6000); };

  const loadStores = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('webstores').select('*').eq('source', 'omg').order('updated_at', { ascending: false });
    if (error) { flash('Could not load OMG stores: ' + error.message, 'err'); setLoading(false); return; }
    setStores(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { loadStores(); }, [loadStores]);

  const loadOrders = useCallback(async (store) => {
    setSel(store); setOrders([]); setDraftContacts(null);
    if (!store) return;
    const { data: ords } = await supabase.from('webstore_orders').select('*').eq('store_id', store.id).order('omg_order_number');
    const ids = (ords || []).map((o) => o.id);
    let itemsByOrder = {};
    if (ids.length) {
      const { data: its } = await supabase.from('webstore_order_items').select('*').in('order_id', ids);
      (its || []).forEach((i) => { (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i); });
    }
    setOrders((ords || []).map((o) => ({ ...o, items: (itemsByOrder[o.id] || []).filter((i) => !i.is_bundle_parent) })));
  }, []);

  // 1) Ingest a player report → orders.
  const ingestReport = async () => {
    if (!reportUrl.trim()) { flash('Paste a player report link first.', 'err'); return; }
    setBusy('ingest');
    try {
      const r = await fetch('/.netlify/functions/omg-player-report-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportUrl: reportUrl.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Ingest failed');
      flash(`Imported ${d.ordersUpserted} orders (${d.itemsInserted} items) for ${d.store.name}.`);
      setReportUrl('');
      await loadStores();
      // Auto-select the store we just ingested.
      const { data } = await supabase.from('webstores').select('*').eq('id', d.store.id).maybeSingle();
      if (data) await loadOrders(data);
    } catch (e) { flash(e.message, 'err'); } finally { setBusy(''); }
  };

  // 2) Parse the packing slip in the browser → editable review grid.
  const onPickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy('parse');
    try {
      const contacts = await parsePackingSlip(file);
      if (!contacts.length) throw new Error('No orders found in that PDF.');
      setDraftContacts(contacts);
      flash(`Parsed ${contacts.length} packing slip${contacts.length === 1 ? '' : 's'} — review below, then save.`);
    } catch (err) { flash(err.message, 'err'); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  // 3) Save reviewed contacts → enrich orders.
  const saveContacts = async () => {
    if (!sel || !draftContacts) return;
    setBusy('enrich');
    try {
      const r = await fetch('/.netlify/functions/omg-order-enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: sel.id, contacts: draftContacts }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Enrich failed');
      flash(`Saved contacts for ${d.matched} order(s).${d.unmatched && d.unmatched.length ? ` ${d.unmatched.length} order # didn't match.` : ''}`);
      setDraftContacts(null);
      await loadOrders(sel);
    } catch (e) { flash(e.message, 'err'); } finally { setBusy(''); }
  };

  // 4) Send "order is being processed" emails.
  const sendEmails = async (resend = false) => {
    if (!sel) return;
    setBusy('notify');
    try {
      const r = await fetch('/.netlify/functions/omg-order-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: sel.id, resend }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Send failed');
      flash(d.sent ? `Sent ${d.sent} processing email(s).` : (d.note || 'Nothing to send.'));
      await loadOrders(sel);
    } catch (e) { flash(e.message, 'err'); } finally { setBusy(''); }
  };

  const updateDraft = (idx, field, value) => setDraftContacts((cs) => cs.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  const trackUrl = (o) => `${window.location.origin}/shop/order/${o.status_token}`;

  const withEmail = orders.filter((o) => o.buyer_email).length;
  const notified = orders.filter((o) => o.processing_email_sent).length;

  return (
    <div style={{ maxWidth: 1080 }}>
      {msg && <div style={{ position: 'sticky', top: 8, zIndex: 5, marginBottom: 12, padding: '11px 16px', borderRadius: 10, fontWeight: 600, fontSize: 13.5, background: msg.kind === 'err' ? '#fef2f2' : '#f0fdf4', color: msg.kind === 'err' ? '#991b1b' : '#166534', border: `1px solid ${msg.kind === 'err' ? '#fecaca' : '#bbf7d0'}` }}>{msg.text}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18, alignItems: 'start' }}>
        {/* ── Left: store list + ingest ── */}
        <div>
          <div className="card" style={card}>
            <div style={cardHead}>📥 Import player report</div>
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Paste the OMG <b>Player Report</b> share link. Each player’s order becomes a trackable order with a private status link.</div>
              <input value={reportUrl} onChange={(e) => setReportUrl(e.target.value)} placeholder="https://report.ordermygear.com/…" style={input} />
              <button onClick={ingestReport} disabled={busy === 'ingest'} style={{ ...primaryBtn, width: '100%', marginTop: 8 }}>{busy === 'ingest' ? 'Importing…' : 'Import orders'}</button>
            </div>
          </div>

          <div className="card" style={{ ...card, marginTop: 14 }}>
            <div style={cardHead}>🏪 OMG stores</div>
            {loading ? <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>Loading…</div>
              : !stores.length ? <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>No imported stores yet.</div>
                : stores.map((s) => (
                  <button key={s.id} onClick={() => loadOrders(s)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderTop: '1px solid #f1f5f9', background: sel && sel.id === s.id ? '#eff6ff' : '#fff', cursor: 'pointer' }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a' }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: '#64748b' }}>Sale {s.omg_sale_code}</div>
                  </button>
                ))}
          </div>
        </div>

        {/* ── Right: selected store ── */}
        <div>
          {!sel ? (
            <div className="card" style={{ ...card, padding: 40, textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
              Select a store, or import a player report to begin.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{sel.name}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>Sale {sel.omg_sale_code} · {orders.length} orders · {withEmail} with email · {notified} emailed</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <label style={{ ...secondaryBtn, cursor: busy === 'parse' ? 'wait' : 'pointer' }}>
                    {busy === 'parse' ? 'Reading PDF…' : '📄 Upload packing slip'}
                    <input ref={fileRef} type="file" accept="application/pdf" onChange={onPickFile} style={{ display: 'none' }} disabled={busy === 'parse'} />
                  </label>
                  <button onClick={() => sendEmails(false)} disabled={busy === 'notify' || !withEmail} style={{ ...primaryBtn, opacity: !withEmail ? 0.5 : 1 }}>{busy === 'notify' ? 'Sending…' : '✉️ Send processing emails'}</button>
                </div>
              </div>

              {/* Review grid for parsed packing-slip contacts */}
              {draftContacts && (
                <div className="card" style={{ ...card, marginBottom: 14, borderColor: '#bfdbfe' }}>
                  <div style={{ ...cardHead, background: '#eff6ff', color: '#1e40af' }}>Review parsed contacts ({draftContacts.length}) — edit anything, then save</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#64748b' }}>
                        {['Order #', 'Name', 'Email', 'Phone', 'Street', 'City', 'State', 'ZIP'].map((h) => <th key={h} style={th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {draftContacts.map((c, i) => (
                          <tr key={i}>
                            <td style={td}><input value={c.orderNumber || ''} onChange={(e) => updateDraft(i, 'orderNumber', e.target.value)} style={cell} /></td>
                            <td style={td}><input value={c.name || ''} onChange={(e) => updateDraft(i, 'name', e.target.value)} style={cell} /></td>
                            <td style={td}><input value={c.email || ''} onChange={(e) => updateDraft(i, 'email', e.target.value)} style={{ ...cell, minWidth: 170, ...(c.email ? {} : { background: '#fff7ed' }) }} /></td>
                            <td style={td}><input value={c.phone || ''} onChange={(e) => updateDraft(i, 'phone', e.target.value)} style={cell} /></td>
                            <td style={td}><input value={(c.address && c.address.street1) || ''} onChange={(e) => updateDraft(i, 'address', { ...(c.address || {}), street1: e.target.value })} style={{ ...cell, minWidth: 150 }} /></td>
                            <td style={td}><input value={(c.address && c.address.city) || ''} onChange={(e) => updateDraft(i, 'address', { ...(c.address || {}), city: e.target.value })} style={cell} /></td>
                            <td style={td}><input value={(c.address && c.address.state) || ''} onChange={(e) => updateDraft(i, 'address', { ...(c.address || {}), state: e.target.value })} style={{ ...cell, width: 50 }} /></td>
                            <td style={td}><input value={(c.address && c.address.zip) || ''} onChange={(e) => updateDraft(i, 'address', { ...(c.address || {}), zip: e.target.value })} style={{ ...cell, width: 80 }} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: 12, display: 'flex', gap: 8, borderTop: '1px solid #f1f5f9' }}>
                    <button onClick={saveContacts} disabled={busy === 'enrich'} style={primaryBtn}>{busy === 'enrich' ? 'Saving…' : 'Save contacts'}</button>
                    <button onClick={() => setDraftContacts(null)} style={secondaryBtn}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Orders table */}
              <div className="card" style={card}>
                <div style={cardHead}>Orders</div>
                {!orders.length ? <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>No orders yet — import the player report.</div> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#64748b' }}>
                        {['Order #', 'Player', 'Email', 'Items', 'Status', 'Total', 'Link'].map((h) => <th key={h} style={th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {orders.map((o) => {
                          const st = o.items[0] ? o.items[0].line_status : 'pending';
                          return (
                            <tr key={o.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                              <td style={td}>{o.omg_order_number}</td>
                              <td style={td}>{o.buyer_name || '—'}</td>
                              <td style={td}>{o.buyer_email
                                ? <span style={{ color: o.processing_email_sent ? '#166534' : '#0f172a' }}>{o.buyer_email}{o.processing_email_sent ? ' ✓' : ''}</span>
                                : <span style={{ color: '#b45309', fontWeight: 600 }}>missing</span>}</td>
                              <td style={td}>{o.items.length}</td>
                              <td style={td}><StatusPill s={st} /></td>
                              <td style={td}>{money(o.total)}</td>
                              <td style={td}>
                                <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(trackUrl(o)); flash('Link copied.'); }} style={linkBtn} title={trackUrl(o)}>Copy</button>
                                <a href={trackUrl(o)} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, textDecoration: 'none' }}>Open</a>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {notified > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>Already emailed parents won’t be re-sent. <button onClick={() => sendEmails(true)} disabled={busy === 'notify'} style={{ ...linkBtn, color: '#2563eb' }}>Force re-send all</button></div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ s }) {
  const map = {
    pending: ['Received', '#eef2ff', '#3730a3'],
    in_production: ['In production', '#fef3c7', '#92400e'],
    shipped: ['Shipped', '#dbeafe', '#1e40af'],
    complete: ['Complete', '#dcfce7', '#166534'],
    cancelled: ['Cancelled', '#fee2e2', '#991b1b'],
  };
  const [label, bg, fg] = map[s] || map.pending;
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: bg, color: fg }}>{label}</span>;
}

const card = { background: '#fff', border: '1px solid #e5e9f0', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,26,56,.04)' };
const cardHead = { padding: '11px 14px', fontWeight: 700, fontSize: 13, color: '#0f172a', background: '#f8fafc', borderBottom: '1px solid #eef1f5' };
const input = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' };
const cell = { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12.5, boxSizing: 'border-box', fontFamily: 'inherit' };
const th = { padding: '9px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', verticalAlign: 'middle' };
const primaryBtn = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const secondaryBtn = { padding: '9px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' };
const linkBtn = { background: 'none', border: 'none', color: '#64748b', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: '2px 6px' };
