import {createQBSyncEngine} from '../qbSyncEngine';
import {QB_LINK_MAPS} from '../qbLinkLedger';

const mapping={income_account:'40000',discount_account:'40200',ar_account:'11000',payment_deposit_account:'11010'};
const accounts=[
  {Id:'10',AcctNum:'40000',Name:'Sales',AccountType:'Income',Active:true},
  {Id:'11',AcctNum:'40200',Name:'Discounts',AccountType:'Income',Active:true},
  {Id:'12',AcctNum:'11000',Name:'Accounts Receivable (A/R)',AccountType:'Accounts Receivable',Active:true},
  {Id:'13',AcctNum:'11010',Name:'Undeposited Funds',AccountType:'Other Current Asset',Active:true},
];
// Portal says $100 paid; QBO shows the invoice fully open.
function setup({paymentResponse,existingPayments=[],readback,invoicePaid=100,qbBalance=100,custMap={C1:'55'}}={}){
  const invs=[{id:'INV1',display_id:'INV-1',customer_id:'C1',total:100,paid:invoicePaid,qb_invoice_id:'900'}];
  let config={realm_id:'r1',preflight:{status:'success',realm_id:'r1'},mapping,initialMigrationApproved:true,
    custQBMap:custMap,syncLog:[]};
  let sent=null;
  const qbApi=jest.fn(async(action,args={})=>{
    if(action==='query'){
      const q=args.query||'';
      if(q.includes('FROM Account'))return{QueryResponse:{Account:accounts}};
      if(q.includes("FROM Item"))return{QueryResponse:{Item:[{Id:'7',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:'10'}}]}};
      if(q.includes('FROM Invoice'))return{QueryResponse:{Invoice:[{Id:'900',DocNumber:'INV-1',Balance:qbBalance,TotalAmt:100,SyncToken:'0'}]}};
      if(q.includes('FROM Payment')&&q.includes('WHERE Id'))return{QueryResponse:{Payment:readback===undefined?[{Id:'77',TotalAmt:100,CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},Line:[{Amount:100,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]:readback}};
      if(q.includes('FROM Payment'))return{QueryResponse:{Payment:existingPayments}};
      return{QueryResponse:{}};
    }
    if(action==='upsert_payment'){sent=args.payment;return paymentResponse===undefined?{Payment:{Id:'77'}}:paymentResponse}
    if(action==='upsert_item')return{Item:{Id:'7'}};
    throw new Error('Unexpected '+action);
  });
  const persistQbLink=jest.fn(async()=>{});
  const engine=createQBSyncEngine({cust:[{id:'C1',name:'Club'}],sos:[],invs,prod:[],vend:[],qbApi,qbConfig:config,
    persistQbLink,nf:jest.fn(),setQbSyncing:jest.fn(),setInvs:jest.fn(),setQBConfig:fn=>{config=fn(config);}});
  return {engine,qbApi,persistQbLink,sent:()=>sent,config:()=>config};
}
const lastLog=run=>(run.config().syncLog||[]).find(l=>l.type==='paid_sync')||{details:[]};

test('the payment map is a durable link map',()=>{expect(QB_LINK_MAPS).toContain('qbPaymentMap')});

test('a verified push saves a receipt and reports the QBO payment id',async()=>{
  const run=setup();
  await run.engine.syncPaidFromQB();
  expect(run.sent()).toMatchObject({TotalAmt:100,CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},PrivateNote:'Portal invoice INV-1'});
  const receipt=run.persistQbLink.mock.calls[0][0];
  expect(receipt).toMatchObject({mapKey:'qbPaymentMap',sourceIds:['INV1:77'],qboId:'77'});
  expect(receipt.evidence).toMatchObject({result:'created',amount:100,api_readback:true,deposit_account:'13'});
  expect(lastLog(run).details.join(' ')).toMatch(/pushed and verified \$100\.00 payment → QBO Payment #77/);
});

test('a QBO fault is reported as blocked, never as a successful push',async()=>{
  // The old code discarded the response entirely and logged this as money sent.
  const run=setup({paymentResponse:{Fault:{Error:[{Detail:'QBO rejected the payment'}]}}});
  await run.engine.syncPaidFromQB();
  expect(run.persistQbLink).not.toHaveBeenCalled();
  const details=lastLog(run).details.join(' ');
  expect(details).toMatch(/payment BLOCKED: QBO rejected the payment/);
  expect(details).not.toMatch(/pushed/);
});

test('money QBO already records against the invoice is never sent twice',async()=>{
  const run=setup({existingPayments:[{Id:'70',Line:[{Amount:100,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]});
  await run.engine.syncPaidFromQB();
  expect(run.qbApi.mock.calls.some(([a])=>a==='upsert_payment')).toBe(false);
  expect(lastLog(run).details.join(' ')).toMatch(/QBO already records \$100\.00 against this invoice/);
});

test('a partial existing payment only tops up the remainder',async()=>{
  const run=setup({existingPayments:[{Id:'70',Line:[{Amount:40,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}],
    readback:[{Id:'77',TotalAmt:60,CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},Line:[{Amount:60,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]});
  await run.engine.syncPaidFromQB();
  expect(run.sent().TotalAmt).toBe(60);
  expect(run.persistQbLink.mock.calls[0][0].evidence).toMatchObject({amount:60,already_applied:40});
});

test('payments linked to a different invoice do not count as already applied',async()=>{
  const run=setup({existingPayments:[{Id:'70',Line:[{Amount:100,LinkedTxn:[{TxnType:'Invoice',TxnId:'999'}]}]}]});
  await run.engine.syncPaidFromQB();
  expect(run.sent().TotalAmt).toBe(100);
});

test.each([
  ['a missing read-back',[]],
  ['a wrong amount',[{Id:'77',TotalAmt:5,CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},Line:[{Amount:5,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]],
  ['a wrong deposit account',[{Id:'77',TotalAmt:100,CustomerRef:{value:'55'},DepositToAccountRef:{value:'99'},Line:[{Amount:100,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]],
  ['no link to the invoice',[{Id:'77',TotalAmt:100,CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},Line:[{Amount:100,LinkedTxn:[]}]}]],
])('%s blocks the record and saves no receipt',async(_label,readback)=>{
  const run=setup({readback});
  await run.engine.syncPaidFromQB();
  expect(run.persistQbLink).not.toHaveBeenCalled();
  expect(lastLog(run).details.join(' ')).toMatch(/payment BLOCKED/);
});

test('an unlinked customer is skipped without sending anything',async()=>{
  const run=setup({custMap:{}});
  await run.engine.syncPaidFromQB();
  expect(run.qbApi.mock.calls.some(([a])=>a==='upsert_payment')).toBe(false);
  expect(run.persistQbLink).not.toHaveBeenCalled();
  expect(lastLog(run).details.join(' ')).toMatch(/skipped push: customer not synced to QB/);
});

test('when QBO is ahead of the Portal nothing is pushed',async()=>{
  const run=setup({invoicePaid:0,qbBalance:0});
  await run.engine.syncPaidFromQB();
  expect(run.qbApi.mock.calls.some(([a])=>a==='upsert_payment')).toBe(false);
});
