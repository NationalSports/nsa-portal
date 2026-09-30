// deno test supabase/functions/qbo-sales-background/receipts.test.ts
// Drives writeReceiptPayment against an in-memory QBO so the money paths are exercised, not
// just the planning math: create, raise-to-target, crash recovery, and every refusal.
import { writeReceiptPayment } from './receipts.ts';
import { planReceiptPayment } from './logic.js';

function eq(a: unknown, b: unknown, msg = '') { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg}\n  expected ${y}\n  got      ${x}`); }
async function rejects(p: Promise<unknown>, code: string) { try { await p; } catch (e) { eq((e as any).code, code, 'error code'); return; } throw new Error('expected rejection ' + code); }

function fakeQbo({ invoices, payments = [] as any[], breakReadback = false }: any) {
  const pays = new Map(payments.map((p: any) => [String(p.Id), structuredClone(p)]));
  const invs = new Map(invoices.map((i: any) => [String(i.Id), structuredClone(i)]));
  const posts: any[] = []; let next = 900;
  const recompute = (p: any) => { const applied = (p.Line || []).reduce((s: number, l: any) => s + l.Amount, 0); p.UnappliedAmt = Math.round((p.TotalAmt - applied) * 100) / 100; };
  return {
    posts, pays,
    async query(_q: string) { return { QueryResponse: { Payment: [...pays.values()].map(p => ({ Id: p.Id, PrivateNote: p.PrivateNote, CustomerRef: p.CustomerRef })) } }; },
    async request(path: string, init?: any) {
      if (init?.method === 'POST' && path === '/payment') {
        const body = JSON.parse(init.body); posts.push(body);
        if (body.sparse) { const p = pays.get(String(body.Id))!; p.Line = body.Line; p.SyncToken = String(Number(p.SyncToken) + 1); recompute(p); return { Payment: p }; }
        const p = { ...body, Id: String(next++), SyncToken: '0' }; recompute(p); pays.set(p.Id, p); return { Payment: p };
      }
      const [, kind, id] = path.split('/');
      if (kind === 'payment') { const p = structuredClone(pays.get(id)); if (p && breakReadback) p.UnappliedAmt = 1; return { Payment: p }; }
      if (kind === 'invoice') return { Invoice: invs.get(id) };
      throw new Error('unexpected ' + path);
    },
  };
}
function fakeAdmin() { const stamps: any[] = []; return { stamps, from: () => ({ update: (v: any) => ({ eq: (_c: string, id: string) => ({ select: async () => { stamps.push([id, v]); return { data: [{ id }], error: null }; } }) }) }) }; }

const receipt = { id: 'RCPT-ABC', customer_id: 'C1', amount: 2000, method: 'check', ref: '4471', received_date: '09/29/2026', ns_applications: [{ invoice_id: 'INV60331', amount: 300 }], created_at: '2026-09-29T00:00:00Z' };
const invoices = [{ Id: '11', CustomerRef: { value: 'Q1' }, Balance: 1000 }, { Id: '12', CustomerRef: { value: 'Q1' }, Balance: 500 }];
const snap = (rows: any[], extra: any = {}) => planReceiptPayment({
  receipt, rows,
  invoicesById: new Map([['INV-1', { id: 'INV-1', status: 'partial' }], ['INV-2', { id: 'INV-2', status: 'open' }]]),
  effectiveInvoiceMap: new Map([['INV-1', '11'], ['INV-2', '12']]),
  qboInvoiceById: new Map(invoices.map(i => [i.Id, i])),
  effectiveCustomerMap: new Map([['C1', 'Q1']]), now: Date.parse('2026-09-30T00:00:00Z'), ...extra,
});
const ctx = (qbo: any, admin: any, plan: any, links: any[]) => ({ admin, qbo, receipt, plan, depositId: 'D1', runId: 'run', sourceId: 'receipt:RCPT-ABC', persist: async (...a: any[]) => { links.push(a.slice(0, 3)); } });

Deno.test('creates ONE payment for the whole check: lines per invoice, rest unapplied, NetSuite share named', async () => {
  const plan = snap([{ id: 1, invoice_id: 'INV-1', amount: 1000 }, { id: 2, invoice_id: 'INV-2', amount: 500 }]);
  eq(plan.action, 'create'); eq(plan.unapplied, 500);
  const qbo = fakeQbo({ invoices }), admin = fakeAdmin(), links: any[] = [];
  const out = await writeReceiptPayment(ctx(qbo, admin, plan, links));
  eq(out.result, 'created'); eq(qbo.posts.length, 1);
  const p = qbo.posts[0];
  eq([p.TotalAmt, p.TxnDate, p.PaymentRefNum, p.DepositToAccountRef.value], [2000, '2026-09-29', '4471', 'D1']);
  eq(p.Line.map((l: any) => [l.LinkedTxn[0].TxnId, l.Amount]), [['11', 1000], ['12', 500]]);
  if (!p.PrivateNote.includes('[RCPT-ABC]') || !p.PrivateNote.includes('INV60331')) throw new Error('memo missing marker or NetSuite note');
  eq(links, [['qbReceiptMap', 'receipt:RCPT-ABC', out.paymentId], ['qbPaymentMap', 'payment:1', out.paymentId], ['qbPaymentMap', 'payment:2', out.paymentId]]);
  eq(admin.stamps, [['RCPT-ABC', { qb_payment_id: out.paymentId }]]);
});

Deno.test('leftover applied later raises the SAME payment instead of creating a second one', async () => {
  const existing = { Id: '77', SyncToken: '3', CustomerRef: { value: 'Q1' }, TotalAmt: 2000, TxnDate: '2026-09-29', DepositToAccountRef: { value: 'D1' }, PrivateNote: 'Portal received payment [RCPT-ABC]', Line: [{ Amount: 1000, LinkedTxn: [{ TxnId: '11', TxnType: 'Invoice' }] }], UnappliedAmt: 1000 };
  const plan = snap([{ id: 1, invoice_id: 'INV-1', amount: 1000 }, { id: 3, invoice_id: 'INV-2', amount: 400 }], { receiptLinks: { 'receipt:RCPT-ABC': { qbo_id: '77' } }, paymentLinks: { 'payment:1': { qbo_id: '77' } } });
  eq(plan.action, 'update');
  const qbo = fakeQbo({ invoices, payments: [existing] }), links: any[] = [];
  const out = await writeReceiptPayment(ctx(qbo, fakeAdmin(), plan, links));
  eq([out.result, out.paymentId, qbo.posts.length], ['updated', '77', 1]);
  eq([qbo.posts[0].sparse, qbo.posts[0].SyncToken, qbo.posts[0].TotalAmt], [true, '3', 2000]);
  eq(qbo.pays.get('77').UnappliedAmt, 600);
});

Deno.test('a run that died after creating in QBO converges: found by memo marker, nothing posted twice', async () => {
  const created = { Id: '55', SyncToken: '0', CustomerRef: { value: 'Q1' }, TotalAmt: 2000, TxnDate: '2026-09-29', DepositToAccountRef: { value: 'D1' }, PrivateNote: 'Portal received payment [RCPT-ABC] check', Line: [{ Amount: 1000, LinkedTxn: [{ TxnId: '11', TxnType: 'Invoice' }] }], UnappliedAmt: 1000 };
  const plan = snap([{ id: 1, invoice_id: 'INV-1', amount: 1000 }]);
  eq(plan.action, 'create');
  const qbo = fakeQbo({ invoices, payments: [created] }), links: any[] = [];
  const out = await writeReceiptPayment(ctx(qbo, fakeAdmin(), plan, links));
  eq([out.result, out.paymentId, qbo.posts.length], ['linked', '55', 0]);
  eq(links.length, 2);
});

Deno.test('refuses when someone applied more in QBO than the Portal says', async () => {
  const edited = { Id: '77', SyncToken: '1', CustomerRef: { value: 'Q1' }, TotalAmt: 2000, TxnDate: '2026-09-29', DepositToAccountRef: { value: 'D1' }, PrivateNote: '[RCPT-ABC]', Line: [{ Amount: 1200, LinkedTxn: [{ TxnId: '11', TxnType: 'Invoice' }] }], UnappliedAmt: 800 };
  const plan = snap([{ id: 1, invoice_id: 'INV-1', amount: 1000 }], { receiptLinks: { 'receipt:RCPT-ABC': { qbo_id: '77' } } });
  const qbo = fakeQbo({ invoices, payments: [edited] });
  await rejects(writeReceiptPayment(ctx(qbo, fakeAdmin(), plan, [])), 'receipt_payment_qbo_edited');
  eq(qbo.posts.length, 0);
});

Deno.test('refuses a line bigger than the invoice balance in QBO', async () => {
  const plan = snap([{ id: 1, invoice_id: 'INV-1', amount: 1000 }]);
  const qbo = fakeQbo({ invoices: [{ Id: '11', CustomerRef: { value: 'Q1' }, Balance: 600 }, invoices[1]] });
  await rejects(writeReceiptPayment(ctx(qbo, fakeAdmin(), plan, [])), 'payment_amount_conflict');
  eq(qbo.posts.length, 0);
});

Deno.test('a failed read-back saves no Portal links', async () => {
  const plan = snap([{ id: 1, invoice_id: 'INV-1', amount: 1000 }]);
  const qbo = fakeQbo({ invoices, breakReadback: true }), links: any[] = [], admin = fakeAdmin();
  await rejects(writeReceiptPayment(ctx(qbo, admin, plan, links)), 'receipt_payment_readback_failed');
  eq([links.length, admin.stamps.length], [0, 0]);
});
