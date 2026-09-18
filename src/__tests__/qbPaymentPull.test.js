import {loadQBPaymentPullSources,planQBPaymentPull} from '../qbPaymentPull';
import {qbLinkKey} from '../qbLinkLedger';

const original={id:966,amount:2050,ref:'EFT',method:'check',date:'09/18/2026'};
const receipt={realm_id:'r1',map_key:'qbPaymentMap',source_id:'payment:966',qbo_id:'18687',active:true,
  verified_at:'2026-09-18T17:17:48Z',evidence:{api_readback:true,invoice_id:'INV-64011',qbo_invoice_id:'18671',amount:2050,date:'2026-09-18'}};
const base={invoice:{id:'INV-64011',qb_invoice_id:'18671',paid:0,payments:[]},savedPayments:[original],
  links:{'payment:966':receipt},applied:[{id:'18687',amount:2050,date:'2026-09-18'}],qbPaid:2050};

test.each([2050,387])('recognizes the verified original $%s even when the tab has no payment row',amount=>{
  const source={...original,amount};
  const plan=planQBPaymentPull({...base,savedPayments:[source],qbPaid:amount,
    applied:[{...base.applied[0],amount}],links:{'payment:966':{...receipt,evidence:{...receipt.evidence,amount}}}});
  expect(plan).toEqual({payments:[source],fresh:[]});
});

test('keeps the original and imports only a genuinely new QBO application',()=>{
  const fresh={id:'20000',amount:50,date:'2026-09-19'};
  const plan=planQBPaymentPull({...base,applied:[...base.applied,fresh],qbPaid:2100});
  expect(plan.payments).toEqual([original,{amount:50,method:'qb_sync',ref:'QBO Payment #20000',date:'2026-09-19'}]);
  expect(plan.fresh).toHaveLength(1);
  expect(planQBPaymentPull({...base,savedPayments:plan.payments,applied:[...base.applied,fresh],qbPaid:2100}).fresh).toEqual([]);
});

test.each([
  {invoice_id:'INV-OTHER'}, {qbo_invoice_id:'999'}, {amount:2051}, {date:'2026-09-17'}, {api_readback:false},
])('rejects mismatched receipt evidence %j',change=>{
  expect(()=>planQBPaymentPull({...base,links:{'payment:966':{...receipt,evidence:{...receipt.evidence,...change}}}})).toThrow();
});

test('rejects an already duplicated echo instead of silently deleting payment history',()=>{
  const echo={amount:2050,ref:'QBO Payment #18687',method:'qb_sync',date:'2026-09-18'};
  expect(()=>planQBPaymentPull({...base,savedPayments:[original,echo]})).toThrow(/duplicate payment echo/);
});

test('blocks changes to a known local payment',()=>{
  expect(()=>planQBPaymentPull({...base,invoice:{...base.invoice,payments:[{...original,amount:2100}]}})).toThrow(/changed/);
});

test('does not mistake a coincidentally equal amount and date for payment identity',()=>{
  expect(()=>planQBPaymentPull({...base,links:{}})).toThrow(/would not match/);
});

test('blocks credits, incomplete applications and malformed amounts',()=>{
  expect(()=>planQBPaymentPull({...base,qbPaid:2100})).toThrow(/applications/);
  expect(()=>planQBPaymentPull({...base,applied:[{...base.applied[0],amount:'bad'}]})).toThrow(/Invalid payment amount/);
});

function client({rows=[original],count=rows.length,readError=null,linkError=null,link=receipt}={}) {
  return {from:jest.fn(table=>({select:()=>table==='invoice_payments'
    ?{eq:()=>({order:()=>({limit:async()=>({data:rows,count,error:readError})})})}
    :{in:async()=>({data:link?[{id:qbLinkKey('r1','qbPaymentMap','payment:966'),value:JSON.stringify(link)}]:[],error:linkError})}}))};
}

test('loads saved IDs and the exact durable receipt without trusting cached config',async()=>{
  const db=client();
  expect(await loadQBPaymentPullSources(db,'INV-64011','r1')).toEqual({payments:[original],links:{'payment:966':receipt}});
});

test.each([
  {count:1001}, {readError:{message:'timeout'}}, {linkError:{message:'timeout'}},
  {link:{...receipt,realm_id:'other'}}, {link:{...receipt,source_id:'payment:999'}},
])('fails closed when sources or receipts cannot be verified %j',async options=>{
  await expect(loadQBPaymentPullSources(client(options),'INV-64011','r1')).rejects.toThrow();
});

test('tombstoned links cannot authorize skipping a QBO payment',async()=>{
  const sources=await loadQBPaymentPullSources(client({link:{...receipt,active:false}}),'INV-64011','r1');
  expect(sources.links).toEqual({});
  expect(()=>planQBPaymentPull({...base,links:sources.links})).toThrow();
});
