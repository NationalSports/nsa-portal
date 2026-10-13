/** @jest-environment node */
const { reconcileInvoiceFromIntent } = require('../../netlify/functions/_shared');
const pi = {id:'pi_test',livemode:true,currency:'usd',status:'succeeded',created:1791360000,amount:10000,amount_received:10000,metadata:{invoice_id:'INV-1'},payment_method_types:['us_bank_account']};
test('database write failure is propagated for webhook retry',async()=>{
 const admin={rpc:jest.fn().mockResolvedValue({error:{message:'unavailable'}})};
 await expect(reconcileInvoiceFromIntent(admin,pi)).rejects.toThrow('could not be saved');
});
test('processing ACH persists verified status without claiming it was paid',async()=>{
 const admin={rpc:jest.fn().mockResolvedValue({data:{status:'processing',reconciled:[]}})};
 const result=await reconcileInvoiceFromIntent(admin,{...pi,status:'processing',amount_received:0});
 expect(result.status).toBe('processing');
 expect(admin.rpc).toHaveBeenCalledWith('reconcile_stripe_invoice_payment',expect.objectContaining({p_intent:expect.objectContaining({method:'ach',received_cents:0,status:'processing'})}));
});
test('partial requests use the same atomic settlement boundary',async()=>{
 const admin={rpc:jest.fn().mockResolvedValue({data:{reconciled:['INV-1']}})};
 await reconcileInvoiceFromIntent(admin,{...pi,metadata:{invoice_id:'INV-1',pay_request_id:'request1',invoice_base_cents:'10000'}});
 expect(admin.rpc.mock.calls[0][1].p_intent).toEqual(expect.objectContaining({pay_request_id:'request1',base_cents:'10000'}));
});
test('never persists Stripe client secrets or bank details',async()=>{
 const admin={rpc:jest.fn().mockResolvedValue({data:{reconciled:[]}})};
 await reconcileInvoiceFromIntent(admin,{...pi,client_secret:'secret',latest_charge:{payment_method_details:{type:'us_bank_account',us_bank_account:{last4:'0000'}}}});
 expect(JSON.stringify(admin.rpc.mock.calls)).not.toMatch(/client_secret|last4|us_bank_account/);
});
test('refund and dispute evidence is passed to atomic guard',async()=>{
 const admin={rpc:jest.fn().mockResolvedValue({data:{error:'review'}})};
 await reconcileInvoiceFromIntent(admin,{...pi,latest_charge:{amount_refunded:10000,disputed:true}});
 expect(admin.rpc.mock.calls[0][1].p_intent).toEqual(expect.objectContaining({refunded_cents:10000,disputed:true}));
});
test('test-mode or foreign currency cannot affect live invoices',async()=>{
 const admin={rpc:jest.fn()};
 await expect(reconcileInvoiceFromIntent(admin,{...pi,livemode:false})).rejects.toThrow('live USD');
 await expect(reconcileInvoiceFromIntent(admin,{...pi,currency:'eur'})).rejects.toThrow('live USD');
 expect(admin.rpc).not.toHaveBeenCalled();
});
test('the rep is notified (NSA Connect) only when this call applied the payment',async()=>{
 const lookups=[];
 const from=(t)=>{lookups.push(t);const q={select:()=>q,in:()=>Promise.resolve({data:[]}),eq:()=>q,maybeSingle:async()=>({data:null})};return q;};
 const fresh={rpc:jest.fn().mockResolvedValue({data:{reconciled:['INV-1'],applied:100}}),from};
 await reconcileInvoiceFromIntent(fresh,pi);
 expect(lookups).toEqual(['invoices']);// pushPaymentReceived looked up the invoice to find its rep
 lookups.length=0;
 const replay={rpc:jest.fn().mockResolvedValue({data:{reconciled:['INV-1'],already:true}}),from};
 await reconcileInvoiceFromIntent(replay,pi);
 await reconcileInvoiceFromIntent({rpc:jest.fn().mockResolvedValue({data:{reconciled:['INV-1']}}),from},pi,{apply:false});
 expect(lookups).toEqual([]);
});
