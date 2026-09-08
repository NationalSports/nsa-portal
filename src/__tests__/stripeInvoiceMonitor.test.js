/** @jest-environment node */
jest.mock('../../netlify/functions/_stripeReconciliation',()=>({selectAllRows:jest.fn()}));
const {selectAllRows} = require('../../netlify/functions/_stripeReconciliation');
const {monitorInvoicePayments} = require('../../netlify/functions/_stripeInvoiceMonitor');
const pi = {id:'pi_one',livemode:true,status:'succeeded',metadata:{invoice_id:'INV1'},currency:'usd',amount_received:1000,latest_charge:{amount_refunded:0,disputed:false}};
const old = {incident_key:'stripe:invoice:pi_old',category:'stripe_invoice_payment',record_id:'pi_old',details:{}};
const payments=[{id:1,invoice_id:'INV1',ref:'Stripe pi_one',amount:10}];
const client=pages=>({balance:{retrieve:jest.fn().mockResolvedValue({livemode:true})},paymentIntents:{list:jest.fn().mockImplementation(async()=>pages.shift()),retrieve:jest.fn()}});
beforeEach(()=>jest.clearAllMocks());
test('healthy recent payments stay quiet and use one-hour grace',async()=>{
 selectAllRows.mockResolvedValueOnce([]).mockResolvedValueOnce(payments).mockResolvedValueOnce([{id:'INV1'}]);
 const api=client([{data:[pi],has_more:false}]);
 const result=await monitorInvoicePayments({},api,{now:()=>2000000000000});
 expect(result).toEqual({findings:[],checked:1,complete:true});
 expect(api.paymentIntents.list.mock.calls[0][0].created.lt).toBe(1999996400);
});
test('missing payment is actionable but abandoned/non-invoice payments are quiet',async()=>{
 selectAllRows.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'INV1'}]);
 const api=client([{data:[pi,{...pi,id:'pi_abandoned',status:'requires_payment_method'},{...pi,id:'pi_shop',metadata:{}}],has_more:false}]);
 const result=await monitorInvoicePayments({},api);
 expect(result.findings).toHaveLength(1);expect(result.findings[0].details.reasons).toContain('INV1: missing payment record');
});
test('walks all pages rather than calling a partial sample healthy',async()=>{
 selectAllRows.mockResolvedValueOnce([]);
 const api=client([{data:[{id:'pi_a',metadata:{}}],has_more:true},{data:[],has_more:false}]);
 const result=await monitorInvoicePayments({},api);
 expect(result.complete).toBe(true);expect(api.paymentIntents.list.mock.calls[1][0].starting_after).toBe('pi_a');
});
test('outage preserves unresolved findings and raises an incomplete-scan issue',async()=>{
 selectAllRows.mockResolvedValueOnce([old]);
 const api=client([]);api.paymentIntents.list.mockRejectedValue(new Error('API offline'));
 const result=await monitorInvoicePayments({},api);
 expect(result.complete).toBe(false);expect(result.findings).toContainEqual(old);
 expect(result.findings.some(f=>f.category==='stripe_invoice_monitor')).toBe(true);
});
test('expired work budget is not a healthy scan',async()=>{
 selectAllRows.mockResolvedValueOnce([old]);const api=client([]);
 const result=await monitorInvoicePayments({},api,{deadlineAt:1,now:()=>2});
 expect(result.complete).toBe(false);expect(result.findings).toContainEqual(old);expect(api.paymentIntents.list).not.toHaveBeenCalled();
});
test('resolved older incident is rechecked and cleared',async()=>{
 selectAllRows.mockResolvedValueOnce([old]).mockResolvedValueOnce([{...payments[0],ref:'Stripe pi_old'}]).mockResolvedValueOnce([{id:'INV1'}]);
 const api=client([{data:[],has_more:false}]);api.paymentIntents.retrieve.mockResolvedValue({...pi,id:'pi_old'});
 const result=await monitorInvoicePayments({},api);
 expect(api.paymentIntents.retrieve).toHaveBeenCalledWith('pi_old',{expand:['latest_charge']});expect(result.findings).toEqual([]);
});
test('failed incident database read stops sync rather than erasing unknown findings',async()=>{
 selectAllRows.mockRejectedValue(new Error('DB unavailable'));
 await expect(monitorInvoicePayments({},client([]))).rejects.toThrow('DB unavailable');
});

test('test-mode connection alerts rather than claiming there are no problems',async()=>{
 selectAllRows.mockResolvedValueOnce([]);const api=client([]);api.balance.retrieve.mockResolvedValue({livemode:false});
 const result=await monitorInvoicePayments({},api);expect(result.complete).toBe(false);expect(result.findings[0].summary).toMatch(/test mode/);expect(api.paymentIntents.list).not.toHaveBeenCalled();
});
