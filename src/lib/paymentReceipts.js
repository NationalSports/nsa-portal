// Received payments (payment_receipts) — the pure math behind the Receive Payments page.
//
// A receipt is one check/ACH/etc. Its applications are:
//   - portal invoices: ordinary invoice payments that carry receipt_id (they drive invoice
//     status, commissions and the QBO payment sync exactly like any other payment), and
//   - NetSuite-imported invoices: entries in receipt.ns_applications (those invoices have no
//     payment rows — paying one only lowers its open_balance).
// Unapplied = amount − applications. It is derived, never stored, so it cannot drift.
import { historicalInvoiceAr } from './historicalInvoiceAr';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const cents = v => Math.round(num(v) * 100) / 100;

// MM/DD/YYYY (the invoice payment date format) or ISO → epoch ms; unparseable → 0.
export function dateMs(d) {
  if (!d) return 0;
  const s = String(d).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return new Date(y, Number(m[1]) - 1, Number(m[2])).getTime(); }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

// ISO yyyy-mm-dd (date input) → MM/DD/YYYY.
export function isoToPaymentDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

// Every application of one receipt, newest data first-class: [{invoice_id, amount, date, ref, _hist}].
export function receiptApplications(receipt, invs) {
  if (!receipt) return [];
  const rows = [];
  (invs || []).forEach(inv => (inv.payments || []).forEach(p => {
    if (p && p.receipt_id === receipt.id) rows.push({ invoice_id: inv.id, customer_id: inv.customer_id, amount: cents(p.amount), date: p.date, ref: p.ref, _hist: false });
  }));
  (Array.isArray(receipt.ns_applications) ? receipt.ns_applications : []).forEach(a => {
    if (a && num(a.amount) > 0) rows.push({ invoice_id: a.invoice_id, amount: cents(a.amount), date: a.date, ref: null, _hist: true, netsuite_internal_id: a.netsuite_internal_id });
  });
  return rows;
}

export function receiptSummary(receipt, invs) {
  const applications = receiptApplications(receipt, invs);
  const applied = cents(applications.reduce((a, r) => a + r.amount, 0));
  const unapplied = cents(Math.max(0, num(receipt?.amount) - applied));
  return { applications, applied, unapplied };
}

// Open invoices a payment for these customers can go to, oldest first.
// Portal: total − paid. NetSuite: only rows with an authoritative open balance.
export function openInvoicesFor(customerIds, invs, histInvs) {
  const ids = new Set((customerIds || []).map(String));
  const rows = [];
  (invs || []).forEach(inv => {
    if (!ids.has(String(inv.customer_id))) return;
    const st = String(inv.status || '').toLowerCase();
    if (st === 'paid' || st === 'void') return;
    const bal = cents(num(inv.total) - num(inv.paid));
    if (bal <= 0.005) return;
    rows.push({ key: 'p:' + inv.id, id: inv.id, _hist: false, customer_id: inv.customer_id, date: inv.date, due_date: inv.due_date, total: cents(inv.total), balance: bal, memo: inv.memo || '', inv });
  });
  (histInvs || []).forEach(inv => {
    if (!ids.has(String(inv.customer_id))) return;
    const ar = historicalInvoiceAr(inv);
    if (!ar.collectible) return;
    rows.push({ key: 'h:' + (inv.netsuite_internal_id || inv.id), id: inv.id, _hist: true, customer_id: inv.customer_id, date: inv.date, due_date: null, total: cents(inv.total), balance: cents(ar.balance), memo: inv.memo || '', inv });
  });
  return rows.sort((a, b) => (dateMs(a.date) - dateMs(b.date)) || String(a.id).localeCompare(String(b.id)));
}

// Fill invoices oldest-first until the money runs out. Returns {key: amount}.
export function autoAllocate(amount, openRows) {
  let left = cents(amount);
  const out = {};
  for (const r of openRows || []) {
    if (left <= 0.005) break;
    const a = cents(Math.min(left, r.balance));
    if (a > 0) { out[r.key] = a; left = cents(left - a); }
  }
  return out;
}

// Validate a set of applications against the money available and each invoice's balance.
export function allocationErrors(available, allocations, openRows) {
  const errs = [];
  const byKey = new Map((openRows || []).map(r => [r.key, r]));
  let total = 0;
  Object.entries(allocations || {}).forEach(([key, v]) => {
    const a = cents(v);
    if (!(a > 0)) return;
    const r = byKey.get(key);
    if (!r) { errs.push('An invoice in this payment is no longer open — reopen the screen.'); return; }
    if (a > r.balance + 0.005) errs.push(`${r.id}: $${a.toFixed(2)} is more than its $${r.balance.toFixed(2)} balance`);
    total = cents(total + a);
  });
  if (total > cents(available) + 0.005) errs.push(`Applying $${total.toFixed(2)} but only $${cents(available).toFixed(2)} is available`);
  return errs;
}

// invoice_payments is unique on (invoice_id, ref), so every application needs a ref no other
// payment on that invoice already uses — a second application of the same check to the same
// invoice (applying leftover later) must never overwrite the first.
export function applicationRef(label, receiptId, existingRefs) {
  const base = (String(label || '').trim() ? String(label).trim() + ' · ' : '') + receiptId;
  const taken = new Set((existingRefs || []).map(String));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  return base + '-' + n;
}

export const newReceiptId = (now = Date.now()) => 'RCPT-' + now.toString(36).toUpperCase();

// A customer and every sub-account under it — a district check often pays several teams.
export function customerFamilyIds(customer, customers) {
  if (!customer) return [];
  const ids = [String(customer.id)];
  (customers || []).forEach(c => { if (c && c.parent_id && String(c.parent_id) === String(customer.id)) ids.push(String(c.id)); });
  return ids;
}
