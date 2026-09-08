const { verifyPayment } = require('./stripe-verification');
const { selectAllRows } = require('./_stripeReconciliation');

// Keep open findings until their actual payment has been rechecked. A partial
// scan or an API outage must never resolve an incident by omission.
async function monitorInvoicePayments(admin, client, { deadlineAt, now = Date.now } = {}) {
  const previous = await selectAllRows(() => admin.from('stripe_reconciliation_incidents')
    .select('incident_key,category,severity,summary,record_type,record_id,details', {count:'exact'})
    .eq('category', 'stripe_invoice_payment').is('resolved_at', null).order('incident_key'), {label:'open Stripe invoice incidents'});
  const findings = new Map(previous.map(row => [row.incident_key, row]));
  const checked = new Set();
  const deadline = deadlineAt || now() + 7000;
  const ensureTime = () => { if (now() >= deadline) throw new Error('scan_incomplete'); };
  async function check(intents) {
    const candidates = intents.filter(pi => !checked.has(pi.id) && (findings.has(`stripe:invoice:${pi.id}`)
      || (pi.livemode && pi.status === 'succeeded' && pi.metadata?.invoice_id)));
    if (!candidates.length) return;
    ensureTime();
    const refs = candidates.map(pi => `Stripe ${pi.id}`);
    const ids = [...new Set(candidates.flatMap(pi => String(pi.metadata?.invoice_id || '').split(/[\s,]+/).filter(Boolean)))];
    const [payments, invoices] = await Promise.all([
      selectAllRows(() => admin.from('invoice_payments').select('id,invoice_id,amount,ref', {count:'exact'}).in('ref',refs).order('id'), {label:'Stripe invoice payments'}),
      ids.length ? selectAllRows(() => admin.from('invoices').select('id', {count:'exact'}).in('id',ids).order('id'), {label:'Stripe invoices'}) : [],
    ]);
    for (const pi of candidates) {
      checked.add(pi.id);
      const result = verifyPayment(pi, payments, invoices);
      const key = `stripe:invoice:${pi.id}`;
      if (result.verified) findings.delete(key);
      else findings.set(key, {incident_key:key, category:'stripe_invoice_payment', severity:'warning',
        summary:'A captured Stripe invoice payment needs review.', record_type:'stripe_invoice', record_id:pi.id,
        details:{invoice_ids:result.invoice_ids, captured_cents:result.captured_cents, recorded_cents:result.recorded_cents,
          currency:result.currency, reasons:result.reasons, checked_at:new Date(now()).toISOString()}});
    }
  }
  try {
    ensureTime();
    const balance = await client.balance.retrieve();
    if (balance.livemode !== true) {
      return {findings:[...findings.values(), {incident_key:'stripe:invoice-monitor-incomplete', category:'stripe_invoice_monitor', severity:'critical',
        summary:'The automatic Stripe invoice monitor is connected to test mode.', record_type:'stripe_invoice_monitor', record_id:'nightly',
        details:{reasons:['Configure the production Stripe connection before relying on payment verification. Existing unresolved findings have been retained.']}}], checked:0, complete:false};
    }
    // Check current activity before older open incidents. A one-hour grace gives
    // portal finalization and webhook retries time to record the audit rows.
    const end = Math.floor(now()/1000) - 3600;
    let cursor;
    for (let pageNumber = 0; ; pageNumber++) {
      ensureTime();
      if (pageNumber >= 10) throw new Error('scan_incomplete');
      const page = await client.paymentIntents.list({limit:100, created:{gte:end-7*86400,lt:end},
        expand:['data.latest_charge'], ...(cursor ? {starting_after:cursor} : {})});
      await check(page.data);
      if (!page.has_more) break;
      const next = page.data[page.data.length-1]?.id;
      if (!next || next === cursor) throw new Error('scan_incomplete');
      cursor = next;
    }
    // Recheck unresolved incidents even after they age out of the lookback.
    for (const incident of previous) {
      if (checked.has(incident.record_id)) continue;
      ensureTime();
      await check([await client.paymentIntents.retrieve(incident.record_id, {expand:['latest_charge']})]);
    }
    return { findings:[...findings.values()], checked:checked.size, complete:true };
  } catch (_) {
    return { findings:[...findings.values(), {incident_key:'stripe:invoice-monitor-incomplete', category:'stripe_invoice_monitor', severity:'critical',
      summary:'Automatic Stripe invoice verification could not finish.', record_type:'stripe_invoice_monitor', record_id:'nightly',
      details:{reasons:['Check Stripe read permissions, API availability and scan volume. Existing unresolved findings have been retained.']}}],
      checked:checked.size, complete:false };
  }
}
module.exports = { monitorInvoicePayments };
