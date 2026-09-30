// Partial pay links: the server applies EXACTLY the amount staff requested, never the full balance,
// and every refusal leaves the invoice untouched. Drives reconcileInvoiceFromIntent (the shared path
// used by finalize_invoice and the Stripe webhook) against an in-memory database.
const { reconcileInvoiceFromIntent } = require('../../netlify/functions/_shared');

function fakeAdmin(seed) {
  const db = JSON.parse(JSON.stringify(seed));
  const q = table => {
    const st = { op: 'select', filters: [], payload: null, single: false };
    const match = r => st.filters.every(([c, v]) => Array.isArray(v) ? v.map(String).includes(String(r[c])) : String(r[c]) === String(v));
    const run = () => {
      const rows = db[table] || (db[table] = []);
      if (st.op === 'insert') {
        if (table === 'invoice_payments' && rows.some(r => r.invoice_id === st.payload.invoice_id && r.ref === st.payload.ref)) return { error: { code: '23505', message: 'duplicate' } };
        rows.push({ ...st.payload }); return { data: [st.payload], error: null };
      }
      if (st.op === 'update') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, st.payload)); return { data: hit.map(r => ({ id: r.id })), error: null }; }
      const hit = rows.filter(match);
      return { data: st.single ? (hit[0] || null) : hit, error: null };
    };
    const b = {
      select() { return b; }, limit() { return b; }, order() { return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      in(c, v) { st.filters.push([c, v]); return b; }, neq() { return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  };
  return { db, from: q };
}

const seed = () => ({
  invoices: [{ id: 'INV-5', total: 5000, paid: 0, cc_fee: 0, status: 'open' }],
  invoice_pay_requests: [{ id: 'PR' + 'a'.repeat(36), invoice_id: 'INV-5', amount: 2000, status: 'open' }],
  invoice_payments: [],
});
const pi = (cents, extra = {}) => ({ id: 'pi_1', status: 'succeeded', amount: cents, amount_received: cents, metadata: { invoice_id: 'INV-5', pay_request_id: 'PR' + 'a'.repeat(36) }, ...extra });

test('bank payment of the requested $2,000 applies $2,000 and leaves $3,000 open', async () => {
  const admin = fakeAdmin(seed());
  const r = await reconcileInvoiceFromIntent(admin, pi(200000));
  expect(r).toMatchObject({ reconciled: ['INV-5'], partial: true, applied: 2000, fee: 0 });
  expect(admin.db.invoices[0]).toMatchObject({ total: 5000, paid: 2000, status: 'partial' });
  expect(admin.db.invoice_payments).toEqual([expect.objectContaining({ invoice_id: 'INV-5', amount: 2000, cc_fee: 0, ref: 'Stripe pi_1', method: 'cc' })]);
  expect(admin.db.invoice_pay_requests[0]).toMatchObject({ status: 'paid', payment_intent_id: 'pi_1' });
});

test('card payment carries its own 2.9% fee: fee folds into total, balance still $3,000', async () => {
  const admin = fakeAdmin(seed());
  await reconcileInvoiceFromIntent(admin, pi(205800));
  expect(admin.db.invoices[0]).toMatchObject({ total: 5058, paid: 2058, cc_fee: 58, status: 'partial' });
  expect(admin.db.invoices[0].total - admin.db.invoices[0].paid).toBe(3000);
});

test('the portal finalize and the webhook both firing apply it once', async () => {
  const admin = fakeAdmin(seed());
  await reconcileInvoiceFromIntent(admin, pi(200000));
  const again = await reconcileInvoiceFromIntent(admin, pi(200000));
  expect(again.reconciled).toEqual([]);
  expect(admin.db.invoices[0].paid).toBe(2000);
  expect(admin.db.invoice_payments).toHaveLength(1);
});

test('paying less than the request applies nothing', async () => {
  const admin = fakeAdmin(seed());
  const r = await reconcileInvoiceFromIntent(admin, pi(150000));
  expect(r.underpaid).toBe(true);
  expect(admin.db.invoices[0].paid).toBe(0);
  expect(admin.db.invoice_payments).toHaveLength(0);
});

test('a request bigger than what is still open applies nothing', async () => {
  const s = seed(); s.invoices[0].paid = 4000;
  const admin = fakeAdmin(s);
  const r = await reconcileInvoiceFromIntent(admin, pi(200000));
  expect(r.error).toBe('pay_request_exceeds_balance');
  expect(admin.db.invoices[0].paid).toBe(4000);
});

test('a request already paid by another payment is not applied a second time', async () => {
  const s = seed(); Object.assign(s.invoice_pay_requests[0], { status: 'paid', payment_intent_id: 'pi_other' });
  const admin = fakeAdmin(s);
  const r = await reconcileInvoiceFromIntent(admin, pi(200000));
  expect(r.error).toBe('pay_request_already_paid');
  expect(admin.db.invoices[0].paid).toBe(0);
});

test('an intent naming a different invoice than its request applies nothing', async () => {
  const admin = fakeAdmin(seed());
  const r = await reconcileInvoiceFromIntent(admin, pi(200000, { metadata: { invoice_id: 'INV-9', pay_request_id: 'PR' + 'a'.repeat(36) } }));
  expect(r.error).toBe('pay_request_invoice_mismatch');
  expect(admin.db.invoice_payments).toHaveLength(0);
});

test('without a pay request, the full-balance guard still refuses a partial payment', async () => {
  const admin = fakeAdmin(seed());
  const r = await reconcileInvoiceFromIntent(admin, { id: 'pi_2', status: 'succeeded', amount_received: 200000, metadata: { invoice_id: 'INV-5' } });
  expect(r.underpaid).toBe(true);
  expect(admin.db.invoices[0].paid).toBe(0);
});

// ── stripe-payment: a pay link can only ever charge its own amount ────────────────────────────
describe('stripe-payment with a pay link',()=>{
  const TOKEN='PR'+'b'.repeat(36);
  let mockCreated, mockAdminDb;
  beforeEach(()=>{
    jest.resetModules();
    process.env.STRIPE_SECRET_KEY='sk_test_x';
    mockCreated=[];
    mockAdminDb=fakeAdmin({invoices:[{id:'INV-5',total:5000,paid:0,status:'open',customer_id:'C1'}],invoice_pay_requests:[{id:TOKEN,invoice_id:'INV-5',amount:2000,status:'open',note:'1st installment'}]});
    jest.doMock('stripe',()=>()=>({paymentIntents:{
      create:async(p)=>{mockCreated.push(p);return{id:'pi_new',client_secret:'cs'};},
      list:async()=>({data:[],has_more:false}),
    }}));
    jest.doMock('../../netlify/functions/_shared',()=>({...jest.requireActual('../../netlify/functions/_shared'),getSupabaseAdmin:()=>mockAdminDb}));
  });
  const call=async body=>{const {handler}=require('../../netlify/functions/stripe-payment');const r=await handler({httpMethod:'POST',body:JSON.stringify(body)});return{status:r.statusCode,body:JSON.parse(r.body)};};

  test('the portal can read the request, but only what the payer needs',async()=>{
    const r=await call({action:'get_pay_request',pay_request_id:TOKEN});
    expect(r.body).toEqual({ok:true,pay_request_id:TOKEN,invoice_id:'INV-5',amount:2000,balance:5000,note:'1st installment'});
  });
  test('a made-up or cancelled link is refused',async()=>{
    expect((await call({action:'get_pay_request',pay_request_id:'PR'+'c'.repeat(36)})).body.ok).toBe(false);
    mockAdminDb.db.invoice_pay_requests[0].status='cancelled';
    expect((await call({action:'get_pay_request',pay_request_id:TOKEN})).body.ok).toBe(false);
  });
  test('charges the requested amount (card adds its fee) and tags the intent with the request',async()=>{
    const r=await call({action:'create_intent',pay_request_id:TOKEN,invoice_id:'INV-5',amount_cents:205800,method:'card'});
    expect(r.status).toBe(200);
    expect(mockCreated[0]).toMatchObject({amount:205800,metadata:{invoice_id:'INV-5',pay_request_id:TOKEN}});
  });
  test('refuses any other amount, or another invoice, on a pay link',async()=>{
    expect((await call({action:'create_intent',pay_request_id:TOKEN,invoice_id:'INV-5',amount_cents:500000,method:'card'})).status).toBe(400);
    expect((await call({action:'create_intent',pay_request_id:TOKEN,invoice_id:'INV-5',amount_cents:100000,method:'bank'})).status).toBe(400);
    expect((await call({action:'create_intent',pay_request_id:TOKEN,invoice_id:'INV-9',amount_cents:200000,method:'bank'})).status).toBe(400);
    expect(mockCreated).toHaveLength(0);
  });
});
