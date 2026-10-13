import {atOnceRoute} from '../../supabase/functions/qbo-sales-background/atOnce';
import {buildInvoiceLines, classifyInvoiceDuplicate} from '../../supabase/functions/qbo-sales-background/logic';

const invoice={id:'INV-1',so_id:'1010042',customer_id:'school-A',total:61,paid:61,tax:4,shipping:5};
const source={id:'checkout-A',order_number:1010042,org_type:'club',customer_id:'school-A',status:'batched',total:61,tax:4,shipping:5,stripe_pi_id:'pi_test',refunded_amt:0};
const snapshot={at_once_sources:{'1010042':[source]},payments:[{id:1,invoice_id:'INV-1',amount:61,ref:'Stripe pi_test'}]};
test.each(['club','all_school'])('%s routes to At-Once without changing customer attribution',org_type=>{
 const before=JSON.stringify(invoice);
 expect(atOnceRoute(invoice,{...snapshot,at_once_sources:{'1010042':[{...source,org_type}]}})).toEqual({atOnce:true,orderNumber:'1010042',orderId:'checkout-A'});
 expect(JSON.stringify(invoice)).toBe(before);
});
test('ordinary sales and OMG have no native source evidence; numbering is irrelevant',()=>{
 expect(atOnceRoute(invoice,{...snapshot,at_once_sources:{}})).toEqual({atOnce:false});
});
test.each([
 ['unpaid',{status:'pending'}],['refund',{refunded_amt:1}],['wrong customer',{customer_id:'school-B'}],
 ['missing payment',{stripe_pi_id:null}],['checkout mismatch',{total:60}],['wrong tax',{tax:0}],['wrong shipping',{shipping:0}]
])('holds %s',(_,change)=>expect(atOnceRoute(invoice,{...snapshot,at_once_sources:{'1010042':[{...source,...change}]}}).reason).toBeTruthy());
test('holds missing or ambiguous immutable payment evidence',()=>{
 expect(atOnceRoute(invoice,{...snapshot,payments:[]}).reason).toBe('at_once_payment_evidence_mismatch');
 expect(atOnceRoute(invoice,{...snapshot,payments:[...snapshot.payments,...snapshot.payments]}).reason).toBe('at_once_payment_evidence_mismatch');
 expect(atOnceRoute(invoice,{...snapshot,at_once_sources:{'1010042':[source,source]}}).reason).toBe('at_once_ambiguous_checkout');
});
test('24/7 revenue and tax use separate items and reconcile to collected amount',()=>{
 const lines=buildInvoiceLines({invoice,description:'24/7',salesItemId:'at-once-item',taxItemId:'tax-item',plan:{tax:4,shipping:5,state:'CA'},discountAccountId:'discount'});
 expect(lines.reduce((n,l)=>n+l.Amount,0)).toBe(61);
 expect(lines.filter(l=>l.SalesItemLineDetail.ItemRef.value==='at-once-item').reduce((n,l)=>n+l.Amount,0)).toBe(57);
 expect(lines.find(l=>l.SalesItemLineDetail.ItemRef.value==='tax-item').Amount).toBe(4);
});
test('retry links the same shared-customer invoice; historical customer mismatches cannot duplicate it',()=>{
 const qbo={Id:'qbo-1',DocNumber:'INV-1',TxnDate:'2026-10-12',TotalAmt:61,CustomerRef:{value:'shared'}};
 const candidate={documentNumber:'INV-1',date:'2026-10-12',total:61,qboCustomerId:'shared'};
 expect(classifyInvoiceDuplicate(candidate,[qbo])).toMatchObject({disposition:'link_existing',qboId:'qbo-1'});
 expect(classifyInvoiceDuplicate(candidate,[{...qbo,CustomerRef:{value:'old-school'}}])).toMatchObject({disposition:'manual_review'});
});
