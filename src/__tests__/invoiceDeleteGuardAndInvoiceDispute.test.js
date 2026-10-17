// 2026-10-17 accounting audit follow-ups, source-checked:
//  - an invoice that is already in QuickBooks cannot be deleted in the Portal (void instead);
//    28 deleted-then-reissued invoices ($188K) were still open in QuickBooks.
//  - a chargeback on an INVOICE card/ACH payment is recorded and alerts accounting; before,
//    only webstore orders were handled and an invoice dispute went unnoticed.
const fs = require('fs');
const path = require('path');
const APP = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const HOOK = fs.readFileSync(path.join(__dirname, '..', '..', 'netlify', 'functions', 'stripe-webhook.js'), 'utf8');

describe('invoices already in QuickBooks are voided, never deleted', () => {
  test('deleteInvoice refuses before any confirm when qb_invoice_id is set', () => {
    const m = APP.match(/const deleteInvoice = \(invId\) => \{[\s\S]*?\n  \};/);
    expect(m).not.toBeNull();
    const body = m[0];
    const guard = body.indexOf("if(inv.qb_invoice_id){");
    const confirm = body.indexOf("window.confirm('Delete invoice '");
    const dbDelete = body.indexOf('_dbDeleteInvoice(invId)');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(confirm);
    expect(guard).toBeLessThan(dbDelete);
    expect(body.slice(guard, confirm)).toMatch(/Use Void instead/);
    expect(body.slice(guard, confirm)).toMatch(/return;/);
  });

  test('deleting a sales order voids its unpaid QuickBooks-linked invoices instead of deleting them', () => {
    expect(APP).toMatch(/linkedInvs\.filter\(i=>i\.paid===0&&!i\.qb_invoice_id\)\.forEach\(i=>_dbDeleteInvoice\(i\.id\)\)/);
    expect(APP).not.toMatch(/linkedInvs\.filter\(i=>i\.paid===0\)\.forEach\(i=>_dbDeleteInvoice/);
    expect(APP).toMatch(/_qbLinkedIds\.has\(i\.id\)\?\{\.\.\.i,status:'void'/);
  });
});

describe('a chargeback on an invoice payment is recorded and alerts accounting', () => {
  test('the dispute branch looks up invoice_payment_intents when no webstore order matches', () => {
    const start = HOOK.indexOf("evt.type === 'charge.dispute.created'");
    const end = HOOK.indexOf("evt.type === 'payout.reconciliation_completed'");
    expect(start).toBeGreaterThan(0);
    const branch = HOOK.slice(start, end);
    expect(branch).toMatch(/from\('invoice_payment_intents'\)[\s\S]*\.eq\('id', piId\)/);
    expect(branch).toMatch(/update\(\{ review_reason \}\)/);
    expect(branch).toMatch(/alertStaffOfInvoiceDispute\(intent, dispute\)/);
    // idempotent on the dispute id: a redelivered webhook neither re-notes nor re-alerts
    expect(branch).toMatch(/includes\('dispute ' \+ dispute\.id\)/);
    // the webstore path is unchanged
    expect(branch).toMatch(/alertStaffOfDispute\(order, dispute\)/);
  });

  test('the invoice alert goes to accounting, names the invoices and the deadline', () => {
    const m = HOOK.match(/async function alertStaffOfInvoiceDispute\(intent, dispute\) \{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/accounting@nationalsportsapparel\.com,steve@nationalsportsapparel\.com/);
    expect(m[0]).toMatch(/invoice_ids/);
    expect(m[0]).toMatch(/evidence_details/);
    expect(m[0]).toMatch(/Chargeback on invoice payment/);
  });
});
