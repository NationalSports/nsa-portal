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
const invoices = [{id:'INV1'},{id:'INV2'}];
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
