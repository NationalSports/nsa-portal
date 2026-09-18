import { parseQBDateValue } from './qbAccountMappings';
import { qbLinkKey } from './qbLinkLedger';

const clean = value => String(value == null ? '' : value).trim();
const cents = value => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) throw new Error('Invalid payment amount');
  return Math.round(Number(value) * 100);
};
const sum = rows => rows.reduce((total, row) => total + cents(row.amount), 0);
const samePayment = (a, b) => cents(a.amount) === cents(b.amount)
  && parseQBDateValue(a.date) === parseQBDateValue(b.date) && clean(a.method) === clean(b.method);

// The tab may predate the EFT and the hourly writer's receipt. Always reread
// saved source IDs and their exact receipt keys before importing QBO payments.
export async function loadQBPaymentPullSources(client, invoiceId, realmId) {
  if (!client || !clean(invoiceId) || !clean(realmId)) throw new Error('Cannot verify saved portal payments');
  const result = await client.from('invoice_payments').select('*', {count:'exact'})
    .eq('invoice_id', invoiceId).order('id').limit(1000);
  if (result.error || !Array.isArray(result.data) || result.count !== result.data.length) {
    throw new Error('Could not completely read saved portal payments');
  }
  const payments = result.data;
  const keys = payments.map(row => qbLinkKey(realmId, 'qbPaymentMap', 'payment:' + row.id));
  const links = {};
  for (let start = 0; start < keys.length; start += 200) {
    const batch = keys.slice(start, start + 200);
    const read = await client.from('app_state').select('id,value').in('id', batch);
    if (read.error || !Array.isArray(read.data)) throw new Error('Could not read verified payment links');
    for (const entry of read.data) {
      const row = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
      if (!row || !batch.includes(entry.id) || entry.id !== qbLinkKey(realmId, 'qbPaymentMap', row.source_id)
        || row.realm_id !== realmId || row.map_key !== 'qbPaymentMap' || !row.verified_at) {
        throw new Error('Invalid payment link receipt');
      }
      if (row.active !== false) links[row.source_id] = row;
    }
  }
  return {payments, links};
}

export function planQBPaymentPull({invoice, savedPayments, links, applied, qbPaid}) {
  const paid = cents(qbPaid);
  if (sum(applied) !== paid) throw new Error('QBO payment applications do not match its paid balance');
  const payments = savedPayments.map(row => ({...row}));
  const byRef = new Map();
  for (const row of payments) {
    if (!clean(row.ref) || byRef.has(clean(row.ref))) throw new Error('Saved payment references need review');
    byRef.set(clean(row.ref), row);
  }
  // Keep unsaved local payments, but never silently replace a changed record.
  const localRefs = new Set();
  for (const row of invoice.payments || []) {
    const ref = clean(row.ref);
    if (!ref || localRefs.has(ref)) throw new Error('Local payment references need review');
    localRefs.add(ref);
    const saved = byRef.get(ref);
    if (saved && !samePayment(saved, row)) throw new Error('Portal payment changed; reload before pulling');
    if (!saved) {payments.push({...row}); byRef.set(ref, row);}
  }
  const fresh = [];
  const seen = new Set();
  for (const application of applied) {
    if (seen.has(application.id)) throw new Error('Duplicate QBO payment application');
    seen.add(application.id);
    const imported = byRef.get('QBO Payment #' + application.id);
    const originals = payments.filter(row => row.id != null
      && clean(links['payment:' + row.id]?.qbo_id) === application.id);
    if (imported && originals.some(row => row !== imported)) throw new Error('Portal already contains a duplicate payment echo');
    const represented = imported ? [imported] : originals;
    if (represented.length) {
      if (sum(represented) !== cents(application.amount)
        || represented.some(row => !parseQBDateValue(row.date) || parseQBDateValue(row.date) !== parseQBDateValue(application.date))) {
        throw new Error('Existing payment amount or date differs from QBO');
      }
      for (const row of originals) {
        const proof = links['payment:' + row.id].evidence;
        if (proof?.api_readback !== true || clean(proof.invoice_id) !== clean(invoice.id)
          || clean(proof.qbo_invoice_id) !== clean(invoice.qb_invoice_id)
          || cents(proof.amount) !== cents(row.amount) || parseQBDateValue(proof.date) !== parseQBDateValue(row.date)) {
          throw new Error('Payment receipt does not verify this invoice application');
        }
      }
    } else {
      fresh.push({amount:application.amount, method:'qb_sync', ref:'QBO Payment #' + application.id, date:application.date});
    }
  }
  const merged = [...payments, ...fresh];
  if (sum(merged) !== paid || cents(invoice.paid) > paid) {
    throw new Error('Portal payment rows would not match QBO paid total; review existing payments');
  }
  return {payments:merged, fresh};
}
