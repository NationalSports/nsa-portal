/* eslint-disable */
// Receive Payments — record a check (or ACH/Zelle/…) once, split it across a customer's open
// invoices, and leave anything extra on the account to apply later. Also the history of every
// payment received and exactly how it was applied, searchable by customer, check # or invoice.
// Access: identity allowlist (src/lib/receivePaymentsAccess.js).
import React, { useEffect, useMemo, useState } from 'react';
import { useAppData } from './AppContext';
import { supabase } from './lib/supabase';
import { applyHistoricalInvoicePayment } from './lib/historicalInvoiceAr';
import { invoicePaymentStatus } from './lib/invoiceDetail';
import {
  allocationErrors, applicationRef, autoAllocate, cents, customerFamilyIds, dateMs, isoToPaymentDate,
  newReceiptId, openInvoicesFor, receiptSummary,
} from './lib/paymentReceipts';

const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const th = { padding: '7px 10px', textAlign: 'left', fontSize: 11, color: '#64748b', fontWeight: 700, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' };
const td = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function ReceivePaymentsPage() {
  const { cust, invs, setInvs, histInvs, setHistInvs, nf, cu, PAY_METHODS, setPg, setViewInvoice } = useAppData();
  const [receipts, setReceipts] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // loading | ok | error
  const [loadErr, setLoadErr] = useState('');
  const [q, setQ] = useState('');
  const [onlyUnapplied, setOnlyUnapplied] = useState(false);
  const [open, setOpen] = useState({}); // receipt id → expanded
  const [modal, setModal] = useState(null); // {mode:'new'} | {mode:'apply', receipt}
  const [saving, setSaving] = useState(false);

  const methods = (PAY_METHODS || []).filter(m => m.id !== 'cc'); // card payments carry a per-invoice fee — keep on the invoice Pay button
  const methodLabel = id => (PAY_METHODS || []).find(m => m.id === id)?.label || id || '—';
  const custById = useMemo(() => new Map((cust || []).map(c => [String(c.id), c])), [cust]);
  const custName = id => { const c = custById.get(String(id)); return c ? (c.name || c.alpha_tag || c.id) : (id || 'Unknown'); };

  const load = async () => {
    setLoadState('loading');
    const { data, error } = await supabase.from('payment_receipts').select('*').order('created_at', { ascending: false }).limit(2000);
    if (error) { setLoadErr(error.message); setLoadState('error'); return; }
    setReceipts(data || []); setLoadState('ok');
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => receipts.map(r => ({ r, ...receiptSummary(r, invs) })), [receipts, invs]);

  const monthStart = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); })();
  const stats = useMemo(() => {
    const month = rows.filter(x => dateMs(x.r.received_date) >= monthStart);
    const unapplied = rows.filter(x => x.unapplied > 0.005);
    return {
      monthAmt: month.reduce((a, x) => a + Number(x.r.amount || 0), 0), monthN: month.length,
      unappliedAmt: unapplied.reduce((a, x) => a + x.unapplied, 0), unappliedCust: new Set(unapplied.map(x => x.r.customer_id)).size,
    };
  }, [rows]);

  // Money sitting on accounts: unapplied payments per customer, plus existing account credits.
  const onAccount = useMemo(() => {
    const m = new Map();
    rows.forEach(x => { if (x.unapplied > 0.005) { const k = String(x.r.customer_id); const e = m.get(k) || { id: k, unapplied: 0, n: 0 }; e.unapplied = cents(e.unapplied + x.unapplied); e.n++; m.set(k, e); } });
    return [...m.values()].map(e => {
      const c = custById.get(e.id);
      const credits = (c?.credits || []).reduce((a, cr) => a + Math.max(0, (Number(cr.amount) || 0) - (Number(cr.used) || 0)), 0);
      return { ...e, credits: cents(credits) };
    }).sort((a, b) => b.unapplied - a.unapplied);
  }, [rows, custById]);

  const ql = q.trim().toLowerCase();
  const matches = x => {
    if (onlyUnapplied && !(x.unapplied > 0.005)) return false;
    if (!ql) return true;
    const c = custById.get(String(x.r.customer_id));
    const hay = [x.r.id, x.r.ref, x.r.memo, x.r.method, c?.name, c?.alpha_tag, String(x.r.amount), Number(x.r.amount || 0).toFixed(2), ...x.applications.map(a => a.invoice_id)]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(ql);
  };
  const shown = rows.filter(matches);

  // Payments recorded before this page existed (one invoice at a time) — grouped back into
  // checks by customer + method + reference + date, so a search still finds them.
  const earlier = useMemo(() => {
    const g = new Map();
    (invs || []).forEach(inv => (inv.payments || []).forEach(p => {
      if (!p || p.receipt_id || !(Number(p.amount) > 0)) return;
      const k = [inv.customer_id, p.method, String(p.ref || '').trim(), p.date].join('|');
      const e = g.get(k) || { key: k, customer_id: inv.customer_id, method: p.method, ref: p.ref, date: p.date, amount: 0, apps: [] };
      e.amount = cents(e.amount + Number(p.amount)); e.apps.push({ invoice_id: inv.id, amount: cents(p.amount) });
      g.set(k, e);
    }));
    return [...g.values()].sort((a, b) => dateMs(b.date) - dateMs(a.date));
  }, [invs]);
  const earlierShown = ql ? earlier.filter(e => {
    const c = custById.get(String(e.customer_id));
    return [e.ref, e.method, c?.name, c?.alpha_tag, e.amount.toFixed(2), ...e.apps.map(a => a.invoice_id)].filter(Boolean).join(' ').toLowerCase().includes(ql);
  }).slice(0, 100) : [];

  const openInvoice = id => {
    const inv = (invs || []).find(i => i.id === id) || (histInvs || []).find(i => i.id === id);
    if (!inv) { nf('Invoice ' + id + ' not found', 'error'); return; }
    setViewInvoice(inv); setPg('invoices');
  };

  // ── Save: record a new receipt and/or apply money from one ──
  const save = async ({ mode, receipt, customer, amount, method, ref, dateIso, memo, alloc, openRows }) => {
    const rid = mode === 'apply' ? receipt.id : newReceiptId();
    const payDate = mode === 'apply' ? isoToPaymentDate(todayIso()) : isoToPaymentDate(dateIso);
    const label = (mode === 'apply' ? receipt.ref : ref) ? ((mode === 'apply' ? methodLabel(receipt.method) : methodLabel(method)) + ' #' + String(mode === 'apply' ? receipt.ref : ref).replace(/^#/, '')) : methodLabel(mode === 'apply' ? receipt.method : method);
    const byKey = new Map(openRows.map(r => [r.key, r]));
    const picks = Object.entries(alloc).map(([k, v]) => ({ row: byKey.get(k), amount: cents(v) })).filter(p => p.row && p.amount > 0);
    const portal = picks.filter(p => !p.row._hist), ns = picks.filter(p => p.row._hist);
    const who = cu?.name || cu?.email || '';
    const nsPlanned = ns.map(p => ({ invoice_id: p.row.id, netsuite_internal_id: p.row.inv.netsuite_internal_id, amount: p.amount, date: payDate, by: who }));
    setSaving(true);
    try {
      // 1) The receipt row first — if this fails nothing else is touched.
      let rec;
      if (mode === 'new') {
        const row = { id: rid, customer_id: customer.id, amount: cents(amount), method, ref: String(ref || '').trim() || null, received_date: payDate, memo: String(memo || '').trim() || null, ns_applications: nsPlanned, created_by: who };
        const { data, error } = await supabase.from('payment_receipts').insert(row).select().single();
        if (error) { nf('Payment NOT saved — ' + error.message, 'error'); return false; }
        rec = data;
      } else {
        const next = [...(receipt.ns_applications || []), ...nsPlanned];
        if (nsPlanned.length) {
          const { data, error } = await supabase.from('payment_receipts').update({ ns_applications: next, updated_at: new Date().toISOString() }).eq('id', rid).select().single();
          if (error) { nf('Nothing applied — ' + error.message, 'error'); return false; }
          rec = data;
        } else rec = receipt;
      }
      // 2) NetSuite invoices: lower each open balance. A failure is backed out of the receipt so
      //    that money reads as unapplied again rather than applied to an invoice that didn't move.
      const nsFailed = [];
      for (const p of ns) {
        const fresh = (histInvs || []).find(h => h.netsuite_internal_id === p.row.inv.netsuite_internal_id) || p.row.inv;
        const res = applyHistoricalInvoicePayment(fresh, p.amount);
        const { error } = res.applied > 0 && fresh.netsuite_internal_id
          ? await supabase.from('customer_invoices').update({ status: res.status, open_balance: res.open_balance }).eq('netsuite_internal_id', fresh.netsuite_internal_id)
          : { error: { message: 'no open balance' } };
        if (error) { nsFailed.push(p.row.id); continue; }
        setHistInvs(prev => prev.map(h => h.netsuite_internal_id === fresh.netsuite_internal_id ? { ...h, status: res.status, open_balance: res.open_balance } : h));
      }
      if (nsFailed.length) {
        const kept = (rec.ns_applications || []).filter(a => !(nsPlanned.some(n => n.invoice_id === a.invoice_id && n.date === a.date && n.amount === a.amount) && nsFailed.includes(a.invoice_id)));
        const { data } = await supabase.from('payment_receipts').update({ ns_applications: kept, updated_at: new Date().toISOString() }).eq('id', rid).select().single();
        if (data) rec = data;
        nf('Could not apply to ' + nsFailed.join(', ') + ' — that amount stays unapplied on the payment', 'error');
      }
      // 3) Portal invoices: an ordinary payment on each, tagged with the receipt. The normal
      //    invoice save persists it (and the hourly QBO sync posts it) like any other payment.
      if (portal.length) {
        const amtById = new Map(portal.map(p => [p.row.id, p.amount]));
        setInvs(prev => prev.map(inv => {
          const a = amtById.get(inv.id);
          if (!a) return inv;
          const payment = { amount: a, method: mode === 'apply' ? receipt.method : method, ref: applicationRef(label, rid, (inv.payments || []).map(x => x.ref)), date: payDate, cc_fee: 0, receipt_id: rid };
          const paid = cents((Number(inv.paid) || 0) + a);
          return { ...inv, paid, status: invoicePaymentStatus(Number(inv.total) || 0, paid, inv.status), payments: [...(inv.payments || []), payment] };
        }));
      }
      setReceipts(prev => mode === 'new' ? [rec, ...prev] : prev.map(r => r.id === rid ? rec : r));
      const appliedN = portal.length + ns.length - nsFailed.length;
      const appliedAmt = cents(picks.filter(p => !nsFailed.includes(p.row.id)).reduce((a, p) => a + p.amount, 0));
      const left = mode === 'new' ? cents(Number(amount) - appliedAmt) : null;
      nf((mode === 'new' ? money(amount) + ' received' : 'Applied') + (appliedN ? ' — ' + money(appliedAmt) + ' to ' + appliedN + ' invoice' + (appliedN === 1 ? '' : 's') : '') + (left > 0.005 ? ' · ' + money(left) + ' left on the account' : ''));
      setOpen(o => ({ ...o, [rid]: true }));
      return true;
    } catch (e) {
      nf('Payment save failed — ' + (e.message || e), 'error');
      return false;
    } finally { setSaving(false); }
  };

  const deleteReceipt = async x => {
    if (x.applications.length) return;
    if (!window.confirm('Delete this ' + money(x.r.amount) + ' payment? Nothing has been applied from it.')) return;
    const { error } = await supabase.from('payment_receipts').delete().eq('id', x.r.id);
    if (error) { nf('Could not delete — ' + error.message, 'error'); return; }
    setReceipts(prev => prev.filter(r => r.id !== x.r.id)); nf('Payment deleted');
  };

  const stat = (label, value, sub, color) => <div className="card" style={{ flex: '1 1 180px', marginBottom: 0 }}><div className="card-body" style={{ padding: '12px 16px' }}>
    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color: color || '#1e293b', marginTop: 2 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div>}
  </div></div>;

  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
      <div>
        <h2 style={{ margin: 0 }}>Receive Payments</h2>
        <div style={{ fontSize: 12, color: '#64748b' }}>Record a check once, split it across invoices, and keep anything extra on the customer's account.</div>
      </div>
      <button className="btn btn-primary" style={{ marginLeft: 'auto', background: '#166534', fontWeight: 700 }} disabled={loadState !== 'ok'} onClick={() => setModal({ mode: 'new' })}>💰 Receive a Payment</button>
    </div>

    {loadState === 'error' && <div className="card" style={{ borderColor: '#fecaca' }}><div className="card-body" style={{ color: '#b91c1c', fontSize: 12 }}>
      Couldn't load received payments ({loadErr}). If this says the table doesn't exist, the database update for this page hasn't been applied yet.
      <button className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
    </div></div>}

    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      {stat('Received this month', money(stats.monthAmt), stats.monthN + ' payment' + (stats.monthN === 1 ? '' : 's'))}
      {stat('Unapplied on accounts', money(stats.unappliedAmt), stats.unappliedCust + ' customer' + (stats.unappliedCust === 1 ? '' : 's'), stats.unappliedAmt > 0.005 ? '#b45309' : undefined)}
    </div>

    {onAccount.length > 0 && <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-header"><h2 style={{ margin: 0, fontSize: 14 }}>Money on account</h2></div>
      <div className="card-body" style={{ padding: 0 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Customer</th><th style={{ ...th, ...num }}>Unapplied payments</th><th style={{ ...th, ...num }} title="Credit memos, fundraiser dollars and other account credits — applied from an order">Other account credits</th><th style={th}></th></tr></thead>
        <tbody>{onAccount.map(e => <tr key={e.id}>
          <td style={td}><button className="btn btn-sm" style={{ background: 'none', border: 'none', padding: 0, color: '#1e40af', fontWeight: 700, cursor: 'pointer' }} onClick={() => { setQ(custName(e.id)); setOnlyUnapplied(true); }}>{custName(e.id)}</button> <span style={{ color: '#94a3b8', fontSize: 11 }}>({e.n} payment{e.n === 1 ? '' : 's'})</span></td>
          <td style={{ ...td, ...num, fontWeight: 700, color: '#b45309' }}>{money(e.unapplied)}</td>
          <td style={{ ...td, ...num, color: '#64748b' }}>{e.credits > 0 ? money(e.credits) : '—'}</td>
          <td style={{ ...td, textAlign: 'right' }}><button className="btn btn-sm btn-secondary" onClick={() => { setQ(custName(e.id)); setOnlyUnapplied(true); }}>Show</button></td>
        </tr>)}</tbody>
      </table></div>
    </div>}

    <div className="card">
      <div className="card-header" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>Payments received</h2>
        <input className="form-input" style={{ flex: '1 1 260px', maxWidth: 420, fontSize: 12 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, check #, invoice # or amount…" />
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><input type="checkbox" checked={onlyUnapplied} onChange={e => setOnlyUnapplied(e.target.checked)} /> Only with money left to apply</label>
        {(q || onlyUnapplied) && <button className="btn btn-sm btn-secondary" onClick={() => { setQ(''); setOnlyUnapplied(false); }}>Clear</button>}
      </div>
      <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
        {loadState === 'loading' ? <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading…</div>
          : !shown.length ? <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{rows.length ? 'No payments match.' : 'No payments recorded here yet — use “Receive a Payment”.'}</div>
          : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Received</th><th style={th}>Customer</th><th style={th}>Method</th><th style={{ ...th, ...num }}>Amount</th><th style={{ ...th, ...num }}>Applied</th><th style={{ ...th, ...num }}>Unapplied</th><th style={th}></th></tr></thead>
            <tbody>{shown.map(x => <React.Fragment key={x.r.id}>
              <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(o => ({ ...o, [x.r.id]: !o[x.r.id] }))}>
                <td style={td}>{open[x.r.id] ? '▾' : '▸'} {x.r.received_date}</td>
                <td style={{ ...td, fontWeight: 600 }}>{custName(x.r.customer_id)}</td>
                <td style={td}>{methodLabel(x.r.method)}{x.r.ref ? ' #' + String(x.r.ref).replace(/^#/, '') : ''}</td>
                <td style={{ ...td, ...num, fontWeight: 700 }}>{money(x.r.amount)}</td>
                <td style={{ ...td, ...num, color: '#166534' }}>{money(x.applied)}<div style={{ fontSize: 10, color: '#94a3b8' }}>{x.applications.length} invoice{x.applications.length === 1 ? '' : 's'}</div></td>
                <td style={{ ...td, ...num, fontWeight: 700, color: x.unapplied > 0.005 ? '#b45309' : '#cbd5e1' }}>{x.unapplied > 0.005 ? money(x.unapplied) : '—'}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  {x.unapplied > 0.005 && <button className="btn btn-sm" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', fontWeight: 700 }} onClick={() => setModal({ mode: 'apply', receipt: x.r })}>Apply {money(x.unapplied)}</button>}
                  {!x.applications.length && <button className="btn btn-sm btn-secondary" style={{ marginLeft: 6, color: '#b91c1c' }} title="Delete — only possible while nothing has been applied" onClick={() => deleteReceipt(x)}>Delete</button>}
                </td>
              </tr>
              {open[x.r.id] && <tr><td colSpan={7} style={{ background: '#f8fafc', padding: '8px 12px 12px 30px', borderBottom: '1px solid #e2e8f0' }}>
                {x.r.memo && <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>Note: {x.r.memo}</div>}
                {!x.applications.length ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Not applied to any invoice yet — the full amount is on the account.</div>
                  : <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
                    <thead><tr><th style={th}>Invoice</th><th style={{ ...th, ...num }}>Applied</th><th style={th}>Date applied</th></tr></thead>
                    <tbody>{x.applications.map((a, i) => <tr key={i}>
                      <td style={td}><button className="btn btn-sm" style={{ background: 'none', border: 'none', padding: 0, color: '#1e40af', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }} onClick={() => openInvoice(a.invoice_id)}>{a.invoice_id}</button>{a._hist && <span style={{ marginLeft: 4, fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#e2e8f0', color: '#475569', fontWeight: 700 }}>NS</span>}</td>
                      <td style={{ ...td, ...num }}>{money(a.amount)}</td>
                      <td style={td}>{a.date || '—'}</td>
                    </tr>)}</tbody>
                  </table>}
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>Recorded {x.r.created_at ? new Date(x.r.created_at).toLocaleString() : ''}{x.r.created_by ? ' by ' + x.r.created_by : ''} · {x.r.id}</div>
              </td></tr>}
            </React.Fragment>)}</tbody>
          </table>}
      </div>
    </div>

    {ql && <div className="card" style={{ marginTop: 14 }}>
      <div className="card-header"><h2 style={{ margin: 0, fontSize: 14 }}>Earlier payments <span style={{ fontWeight: 400, fontSize: 11, color: '#64748b' }}>— recorded one invoice at a time, before this page</span></h2></div>
      <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
        {!earlierShown.length ? <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No earlier payments match.</div>
          : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Customer</th><th style={th}>Method / reference</th><th style={{ ...th, ...num }}>Amount</th><th style={th}>Invoices</th></tr></thead>
            <tbody>{earlierShown.map(e => <tr key={e.key}>
              <td style={td}>{e.date || '—'}</td>
              <td style={td}>{custName(e.customer_id)}</td>
              <td style={td}>{methodLabel(e.method)}{e.ref ? ' · ' + e.ref : ''}</td>
              <td style={{ ...td, ...num, fontWeight: 600 }}>{money(e.amount)}</td>
              <td style={td}>{e.apps.map((a, i) => <span key={i} style={{ marginRight: 8 }}><button className="btn btn-sm" style={{ background: 'none', border: 'none', padding: 0, color: '#1e40af', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => openInvoice(a.invoice_id)}>{a.invoice_id}</button> {money(a.amount)}</span>)}</td>
            </tr>)}</tbody>
          </table>}
        <div style={{ fontSize: 10, color: '#94a3b8', padding: '6px 10px' }}>Payments on NetSuite-imported invoices recorded before this page only lowered the balance and aren't listed here.</div>
      </div>
    </div>}

    {modal && <ReceiveModal modal={modal} saving={saving} onClose={() => setModal(null)} onSave={async args => { if (await save(args)) setModal(null); }}
      cust={cust} invs={invs} histInvs={histInvs} methods={methods} methodLabel={methodLabel} summaryFor={r => receiptSummary(r, invs)} />}
  </div>;
}

function ReceiveModal({ modal, saving, onClose, onSave, cust, invs, histInvs, methods, methodLabel, summaryFor }) {
  const applying = modal.mode === 'apply';
  const receipt = modal.receipt;
  const [customer, setCustomer] = useState(() => applying ? (cust || []).find(c => String(c.id) === String(receipt.customer_id)) || { id: receipt.customer_id, name: receipt.customer_id } : null);
  const [custQ, setCustQ] = useState('');
  const [family, setFamily] = useState(true);
  const [amount, setAmount] = useState(applying ? summaryFor(receipt).unapplied : '');
  const [method, setMethod] = useState('check');
  const [ref, setRef] = useState('');
  const [dateIso, setDateIso] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [alloc, setAlloc] = useState({});
  const [touched, setTouched] = useState(false); // once they edit a line, stop auto-filling

  const available = applying ? summaryFor(receipt).unapplied : cents(amount);
  const custIds = customer ? (family ? customerFamilyIds(customer, cust) : [String(customer.id)]) : [];
  const openRows = useMemo(() => openInvoicesFor(custIds, invs, histInvs), [custIds.join(','), invs, histInvs]);
  const multiAccount = new Set(openRows.map(r => String(r.customer_id))).size > 1;

  useEffect(() => { if (!touched) setAlloc(autoAllocate(available, openRows)); }, [available, openRows, touched]);

  const custMatches = custQ.trim().length >= 2 ? (cust || []).filter(c => [c.name, c.alpha_tag].filter(Boolean).join(' ').toLowerCase().includes(custQ.trim().toLowerCase())).slice(0, 8) : [];
  const appliedTotal = cents(Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0));
  const left = cents(available - appliedTotal);
  const errs = allocationErrors(available, alloc, openRows);
  const canSave = !saving && customer && available > 0 && !errs.length && (applying ? appliedTotal > 0 : true);
  const nameOf = id => { const c = (cust || []).find(x => String(x.id) === String(id)); return c ? (c.name || c.alpha_tag) : id; };

  return <div className="modal-overlay" onClick={onClose}><div className="modal" style={{ maxWidth: 760, width: '96vw' }} onClick={e => e.stopPropagation()}>
    <div className="modal-header"><h2>{applying ? 'Apply unapplied payment' : 'Receive a Payment'}</h2><button className="modal-close" onClick={onClose}>×</button></div>
    <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
      {applying ? <div style={{ padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
        <strong>{nameOf(receipt.customer_id)}</strong> · {methodLabel(receipt.method)}{receipt.ref ? ' #' + receipt.ref : ''} received {receipt.received_date} for {money(receipt.amount)} — <strong>{money(available)}</strong> left to apply.
      </div> : <>
        <div style={{ marginBottom: 10 }}>
          <label className="form-label">Customer</label>
          {customer ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{customer.name || customer.alpha_tag}</strong>
            <button className="btn btn-sm btn-secondary" onClick={() => { setCustomer(null); setAlloc({}); setTouched(false); }}>Change</button>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', cursor: 'pointer' }}><input type="checkbox" checked={family} onChange={e => { setFamily(e.target.checked); setTouched(false); }} /> Include sub-accounts</label>
          </div> : <div style={{ position: 'relative' }}>
            <input className="form-input" autoFocus value={custQ} onChange={e => setCustQ(e.target.value)} placeholder="Type a customer name or alpha tag…" />
            {custMatches.length > 0 && <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 8px 20px rgba(0,0,0,.08)' }}>
              {custMatches.map(c => <div key={c.id} style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => { setCustomer(c); setCustQ(''); setTouched(false); }}>
                <strong>{c.name}</strong>{c.alpha_tag ? <span style={{ color: '#94a3b8' }}> · {c.alpha_tag}</span> : null}{c.parent_id ? <span style={{ color: '#94a3b8' }}> · sub-account</span> : null}
              </div>)}
            </div>}
          </div>}
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="form-label">Method</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{methods.map(m => <button key={m.id} className={`btn btn-sm ${method === m.id ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 11 }} onClick={() => setMethod(m.id)}>{m.icon} {m.label}</button>)}</div>
        </div>
        <div className="form-row form-row-2" style={{ marginBottom: 10 }}>
          <div><label className="form-label">Amount received</label><input className="form-input" type="number" min="0" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setTouched(false); }} placeholder="0.00" /></div>
          <div><label className="form-label">{method === 'check' ? 'Check #' : 'Reference'}</label><input className="form-input" value={ref} onChange={e => setRef(e.target.value)} placeholder={method === 'check' ? '4471' : 'Reference…'} /></div>
        </div>
        <div className="form-row form-row-2" style={{ marginBottom: 12 }}>
          <div><label className="form-label">Date received</label><input className="form-input" type="date" value={dateIso} onChange={e => setDateIso(e.target.value)} /></div>
          <div><label className="form-label">Note (optional)</label><input className="form-input" value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. overpayment — use toward spring order" /></div>
        </div>
      </>}

      {customer && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 6px' }}>
          <strong style={{ fontSize: 12 }}>Open invoices</strong>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>oldest first</span>
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => { setTouched(false); setAlloc(autoAllocate(available, openRows)); }}>Fill oldest first</button>
          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11 }} onClick={() => { setTouched(true); setAlloc({}); }}>Clear</button>
        </div>
        {!openRows.length ? <div style={{ fontSize: 12, color: '#64748b', padding: 10, background: '#f8fafc', borderRadius: 6 }}>No open invoices — {applying ? 'nothing to apply this to yet.' : 'the full amount will stay on the account as unapplied.'}</div>
          : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={{ ...th, width: 28 }}></th><th style={th}>Invoice</th>{multiAccount && <th style={th}>Account</th>}<th style={th}>Date</th><th style={{ ...th, ...num }}>Balance</th><th style={{ ...th, ...num, width: 130 }}>Apply</th></tr></thead>
            <tbody>{openRows.map(r => {
              const v = alloc[r.key];
              const on = Number(v) > 0;
              return <tr key={r.key} style={{ background: on ? '#f0fdf4' : undefined }}>
                <td style={td}><input type="checkbox" checked={on} onChange={e => { setTouched(true); setAlloc(a => { const n = { ...a }; if (e.target.checked) { const used = Object.entries(n).reduce((s, [k, x]) => s + (k === r.key ? 0 : Number(x) || 0), 0); const amt = cents(Math.max(0, Math.min(r.balance, available - used))); if (amt > 0) n[r.key] = amt; } else delete n[r.key]; return n; }); }} /></td>
                <td style={{ ...td, fontWeight: 700 }}>{r.id}{r._hist && <span style={{ marginLeft: 4, fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#e2e8f0', color: '#475569', fontWeight: 700 }}>NS</span>}{r.memo && <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>{String(r.memo).slice(0, 60)}</div>}</td>
                {multiAccount && <td style={{ ...td, fontSize: 11 }}>{nameOf(r.customer_id)}</td>}
                <td style={td}>{r.date || '—'}</td>
                <td style={{ ...td, ...num }}>{money(r.balance)}</td>
                <td style={{ ...td, ...num }}><input className="form-input" type="number" min="0" step="0.01" style={{ width: 110, textAlign: 'right', padding: '3px 6px', fontSize: 12 }} value={v ?? ''} onChange={e => { setTouched(true); const val = e.target.value; setAlloc(a => { const n = { ...a }; if (val === '' || Number(val) <= 0) delete n[r.key]; else n[r.key] = val; return n; }); }} placeholder="0.00" /></td>
              </tr>;
            })}</tbody>
          </table>}
        <div style={{ display: 'flex', gap: 18, justifyContent: 'flex-end', marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
          <span>{applying ? 'Available' : 'Received'}: <strong>{money(available)}</strong></span>
          <span>Applied: <strong style={{ color: '#166534' }}>{money(appliedTotal)}</strong></span>
          <span>Left on account: <strong style={{ color: left > 0.005 ? '#b45309' : '#64748b' }}>{money(Math.max(0, left))}</strong></span>
        </div>
        {left > 0.005 && !errs.length && available > 0 && <div style={{ marginTop: 6, fontSize: 11, color: '#92400e', textAlign: 'right' }}>{money(left)} will stay on {customer.name || 'the account'} as an unapplied payment you can apply later.</div>}
        {errs.length > 0 && <div style={{ marginTop: 8, padding: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11, color: '#b91c1c' }}>{errs.map((e, i) => <div key={i}>{e}</div>)}</div>}
      </>}
    </div>
    <div className="modal-footer">
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" style={{ background: '#166534' }} disabled={!canSave}
        onClick={() => onSave({ mode: modal.mode, receipt, customer, amount: applying ? receipt.amount : amount, method, ref, dateIso, memo, alloc, openRows })}>
        {saving ? 'Saving…' : applying ? 'Apply ' + money(appliedTotal) : 'Save payment · ' + money(available)}
      </button>
    </div>
  </div></div>;
}
