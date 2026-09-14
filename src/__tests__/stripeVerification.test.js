/** @jest-environment node */
jest.mock('stripe', () => jest.fn());
jest.mock('../../netlify/functions/_shared', () => ({corsHeaders:()=>({}), verifyQBOUser:jest.fn(), getSupabaseAdmin:jest.fn()}));
jest.mock('../../netlify/functions/_stripeReconciliation', () => ({selectAllRows:jest.fn()}));
const stripe = require('stripe');
const {verifyQBOUser,getSupabaseAdmin} = require('../../netlify/functions/_shared');
const {selectAllRows} = require('../../netlify/functions/_stripeReconciliation');
const {handler,verifyPayment} = require('../../netlify/functions/stripe-verification');
const pi = {id:'pi_123',metadata:{invoice_id:'INV1 INV2'},livemode:true,status:'succeeded',currency:'usd',amount_received:3000,latest_charge:{amount_refunded:0,disputed:false}};
const records = [{invoice_id:'INV1',ref:'Stripe pi_123',amount:10},{invoice_id:'INV2',ref:'Stripe pi_123',amount:20}];
// Settled summaries: the payment rows above (10 + 20) are actually applied to these invoices.
// Selecting id alone here is what let an unapplied payment read as verified — see the
// "still shows an open balance" cases below.
const invoices = [{id:'INV1',total:10,paid:10,status:'paid'},{id:'INV2',total:20,paid:20,status:'paid'}];
const event = body => ({httpMethod:'POST',headers:{},body:JSON.stringify(body)});
beforeEach(()=>{jest.clearAllMocks();process.env.STRIPE_SECRET_KEY='test';verifyQBOUser.mockResolvedValue({ok:true});});
afterAll(()=>{delete process.env.STRIPE_SECRET_KEY;});
test('matches split invoice payment without exposing raw Stripe secrets',()=>{
  const result=verifyPayment({...pi,client_secret:'private'},records,invoices);
  expect(result.verified).toBe(true);expect(result.client_secret).toBeUndefined();
});
test.each([
  ['refund',{latest_charge:{amount_refunded:100}},records,invoices],
  ['dispute',{latest_charge:{disputed:true}},records,invoices],
  ['test mode',{livemode:false},records,invoices],
  ['pending',{status:'processing'},records,invoices],
  ['foreign currency',{currency:'eur'},records,invoices],
  ['no charge',{latest_charge:null},records,invoices],
  ['amount mismatch',{amount_received:3001},records,invoices],
  ['missing payment',{},records.slice(0,1),invoices],
  ['duplicate payment',{},[...records,records[0]],invoices],
  ['missing invoice',{},records,[]],
  ['wrong invoice',{},[...records,{invoice_id:'INV3',ref:'Stripe pi_123',amount:1}],invoices],
  ['no metadata',{metadata:{}},[],[]],
])('%s cannot be verified',(_,overrides,rows,inv)=>expect(verifyPayment({...pi,...overrides},rows,inv).verified).toBe(false));
test('role denial occurs before Stripe or database access',async()=>{
 verifyQBOUser.mockResolvedValue({ok:false,status:403,error:'Forbidden'});
 expect((await handler(event({action:'connection'}))).statusCode).toBe(403);
 expect(stripe).not.toHaveBeenCalled();expect(getSupabaseAdmin).not.toHaveBeenCalled();
});
test('account check returns only allowlisted connection fields',async()=>{
 stripe.mockReturnValue({accounts:{retrieve:async()=>({id:'acct_1',business_profile:{name:'NSA'},external_accounts:{secret:'private'}})},balance:{retrieve:async()=>({livemode:true,available:[{amount:100,currency:'usd',source_types:{card:100}}],pending:[]})}});
 const result=JSON.parse((await handler(event({action:'connection'}))).body);
 expect(result.account_id).toBe('acct_1');expect(result.available).toEqual([{amount:100,currency:'usd'}]);expect(result.external_accounts).toBeUndefined();
});
test('passes date boundaries and cursor; keeps incomplete pages explicit',async()=>{
 const list=jest.fn().mockResolvedValue({data:[pi],has_more:true});stripe.mockReturnValue({paymentIntents:{list}});
 selectAllRows.mockResolvedValueOnce(records).mockResolvedValueOnce(invoices);
 const response=await handler(event({action:'payments',from:'2024-01-01',to:'2024-01-02',starting_after:'pi_previous'}));
 expect(response.statusCode).toBe(200);expect(list).toHaveBeenCalledWith(expect.objectContaining({created:{gte:1704067200,lt:1704240000},starting_after:'pi_previous',limit:25}));
 expect(JSON.parse(response.body)).toMatchObject({has_more:true,next_cursor:'pi_123',payments:[{verified:true}]});
});
test('database failure never yields a verified result',async()=>{
 stripe.mockReturnValue({paymentIntents:{list:async()=>({data:[pi],has_more:false})}});
 selectAllRows.mockRejectedValue(new Error('private database error'));
 const response=await handler(event({action:'payments',from:'2024-01-01',to:'2024-01-02'}));
 expect(response.statusCode).toBe(502);expect(response.body).not.toContain('private database error');
});
test.each(['2024-02-30','garbage'])('rejects invalid date %s',async from=>{
 expect((await handler(event({action:'payments',from,to:'2024-03-01'}))).statusCode).toBe(400);
});

// ── Captured but unapplied: the INV-63359 / INV-63664 failure ──────────────────────────────
// A staff tab that loaded before the portal card payment saves the invoice summary back to
// paid=0/status=open. The immutable invoice_payments row survives (dbEngine restores it), so a
// check that looks only at the payment row calls this healthy, so nothing raised an incident
// while both invoices sat in AR reading "open" to the rep and to accounting.
describe('captured payment that is no longer applied to the invoice', () => {
  const openInvoices = [{id:'INV1',total:10,paid:0,status:'open'},{id:'INV2',total:20,paid:20,status:'paid'}];
  test('is not verified, and names the invoice still carrying a balance', () => {
    const result = verifyPayment(pi, records, openInvoices);
    expect(result.verified).toBe(false);
    expect(result.reasons).toContain('INV1: captured payment is not applied — invoice still shows an open balance');
    // The settled half of the split payment must not be reported.
    expect(result.reasons.join(' ')).not.toContain('INV2:');
  });
  test('a partially applied summary still counts as an open balance', () => {
    expect(verifyPayment(pi, records, [{id:'INV1',total:10,paid:4,status:'partial'},openInvoices[1]]).verified).toBe(false);
  });
  test('a voided invoice is a deliberate staff decision, not an unapplied payment', () => {
    expect(verifyPayment(pi, records, [{id:'INV1',total:10,paid:0,status:'void'},openInvoices[1]]).verified).toBe(true);
  });
  test('sub-cent float drift never reads as an outstanding balance', () => {
    expect(verifyPayment(pi, records, [{id:'INV1',total:10,paid:9.999999,status:'paid'},openInvoices[1]]).verified).toBe(true);
  });
});

// The check above is silently dead if a caller selects `id` alone: Number(undefined)||0 makes
// every invoice read as a $0 balance. Both call sites must request the settlement columns.
test('both call sites select the columns the applied-payment check depends on', () => {
  const { INVOICE_SETTLEMENT_COLS } = require('../../netlify/functions/stripe-verification');
  expect(INVOICE_SETTLEMENT_COLS.split(',')).toEqual(expect.arrayContaining(['id','total','paid','status']));
  const fs = require('fs'), path = require('path');
  ['stripe-verification.js','_stripeInvoiceMonitor.js'].forEach(file => {
    const src = fs.readFileSync(path.join(__dirname,'../../netlify/functions',file),'utf8');
    const invoiceSelect = src.match(/from\('invoices'\)\s*\.select\(([^,)]+)/);
    expect(invoiceSelect && invoiceSelect[1].trim()).toBe('INVOICE_SETTLEMENT_COLS');
  });
});
