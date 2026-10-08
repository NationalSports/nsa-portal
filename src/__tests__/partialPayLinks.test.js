// Partial pay links: the server applies EXACTLY the amount staff requested, never the full balance,
// and every refusal leaves the invoice untouched. Drives reconcileInvoiceFromIntent (the shared path
// used by finalize_invoice and the Stripe webhook) against an in-memory database.


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
      select() { return b; }, overlaps() { return b; }, is() { return b; }, limit() { return b; }, order() { return b; },
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

// Settlement business cases run against real PostgreSQL in scripts/test-stripe-invoice-atomic.cjs.

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
