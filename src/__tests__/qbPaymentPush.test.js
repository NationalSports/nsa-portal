import {buildPortalPaymentPushRows,createQBSyncEngine} from '../qbSyncEngine';
import {QB_LINK_MAPS} from '../qbLinkLedger';

const mapping={income_account:'40000',discount_account:'40200',ar_account:'11000',payment_deposit_account:'11010'};
const accounts=[
  {Id:'10',AcctNum:'40000',Name:'Sales',AccountType:'Income',Active:true},
  {Id:'11',AcctNum:'40200',Name:'Discounts',AccountType:'Income',Active:true},
  {Id:'12',AcctNum:'11000',Name:'Accounts Receivable (A/R)',AccountType:'Accounts Receivable',Active:true},
  {Id:'13',AcctNum:'11010',Name:'Undeposited Funds',AccountType:'Other Current Asset',Active:true},
];
// Portal says $100 paid; QBO shows the invoice fully open.
function setup({paymentResponse,existingPayments=[],readback,invoicePaid=100,qbBalance=100,custMap={C1:'55'},payments}={}){
  const invs=[{id:'INV1',display_id:'INV-1',customer_id:'C1',total:100,paid:invoicePaid,qb_invoice_id:'900',date:'2026-06-01',...(payments?{payments}:{})}];
  let config={realm_id:'r1',preflight:{status:'success',realm_id:'r1'},mapping,initialMigrationApproved:true,
    custQBMap:custMap,syncLog:[]};
  let sent=null;
  const qbApi=jest.fn(async(action,args={})=>{
    if(action==='query'){
      const q=args.query||'';
      if(q.includes('FROM Account'))return{QueryResponse:{Account:accounts}};
      if(q.includes("FROM Item"))return{QueryResponse:{Item:[{Id:'7',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:'10'}}]}};
      if(q.includes('FROM Invoice'))return{QueryResponse:{Invoice:[{Id:'900',DocNumber:'INV-1',Balance:qbBalance,TotalAmt:100,SyncToken:'0'}]}};
      if(q.includes('FROM Payment')&&q.includes('WHERE Id'))return{QueryResponse:{Payment:readback===undefined?[{Id:'77',TotalAmt:sent?.TotalAmt??100,TxnDate:sent?.TxnDate,CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},Line:[{Amount:sent?.TotalAmt??100,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]:readback}};
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
  const run=setup({payments:[{amount:100,ref:'Check 1',date:'2026-06-15'}]});
  await run.engine.syncPaidFromQB();
  expect(run.sent()).toMatchObject({TotalAmt:100,CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},PrivateNote:'Portal invoice INV-1'});
  const receipt=run.persistQbLink.mock.calls[0][0];
  expect(receipt).toMatchObject({mapKey:'qbPaymentMap',sourceIds:['INV1:77'],qboId:'77'});
  expect(receipt.evidence).toMatchObject({result:'created',amount:100,api_readback:true,deposit_account:'13'});
  expect(lastLog(run).details.join(' ')).toMatch(/pushed and verified \$100\.00 payment dated 2026-06-15 → QBO Payment #77/);
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
    readback:[{Id:'77',TotalAmt:60,TxnDate:'2026-07-01',CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},Line:[{Amount:60,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]});
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

// Checks are entered in QBO, so the pull direction carries most customer money.
// The date it records is a commission input: CommissionsPage rates a line at 15%
// rather than 30% once days-to-pay passes 90, and freezes it on first render.
describe('pulling QBO payments into the Portal',()=>{
  const {qbPaymentsAppliedToInvoice}=require('../qbSyncEngine');
  function pullSetup({qboPayments,existingRows=[]}={}){
    const invs=[{id:'INV1',display_id:'INV-1',customer_id:'C1',total:100,paid:0,qb_invoice_id:'900',
      date:'2026-05-01',payments:existingRows}];
    let config={realm_id:'r1',preflight:{status:'success',realm_id:'r1'},mapping,initialMigrationApproved:true,
      custQBMap:{C1:'55'},syncLog:[]};
    let saved=null;
    const qbApi=jest.fn(async(action,args={})=>{
      if(action==='query'){
        const q=args.query||'';
        if(q.includes('FROM Account'))return{QueryResponse:{Account:accounts}};
        if(q.includes('FROM Item'))return{QueryResponse:{Item:[{Id:'7',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:'10'}}]}};
        if(q.includes('FROM Invoice'))return{QueryResponse:{Invoice:[{Id:'900',DocNumber:'INV-1',Balance:0,TotalAmt:100,SyncToken:'0'}]}};
        if(q.includes('FROM Payment'))return{QueryResponse:{Payment:qboPayments}};
        return{QueryResponse:{}};
      }
      if(action==='upsert_item')return{Item:{Id:'7'}};
      throw new Error('Unexpected '+action);
    });
    const engine=createQBSyncEngine({cust:[{id:'C1',name:'Club'}],sos:[],invs,prod:[],vend:[],qbApi,qbConfig:config,
      persistQbLink:jest.fn(async()=>{}),nf:jest.fn(),setQbSyncing:jest.fn(),
      setInvs:fn=>{saved=fn(invs)[0]},setQBConfig:fn=>{config=fn(config);}});
    return {engine,saved:()=>saved,log:()=>(config.syncLog||[]).find(l=>l.type==='paid_sync')||{details:[]}};
  }
  const check=(id,date,amount)=>({Id:id,TxnDate:date,Line:[{Amount:amount,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]});

  test('the real QBO payment date is recorded, not today',async()=>{
    const run=pullSetup({qboPayments:[check('70','2026-05-20',100)]});
    await run.engine.syncPaidFromQB();
    expect(run.saved().payments).toEqual([{amount:100,method:'qb_sync',ref:'QBO Payment #70',date:'2026-05-20'}]);
    expect(run.saved()).toMatchObject({paid:100,status:'paid'});
    // 19 days, well inside the 90-day window that halves the rep's rate.
    const days=Math.round((new Date(2026,4,20)-new Date(2026,4,1))/86400000);
    expect(days).toBe(19);
  });

  test('a payment already recorded is not appended twice',async()=>{
    const run=pullSetup({qboPayments:[check('70','2026-05-20',100)],
      existingRows:[{amount:100,method:'qb_sync',ref:'QBO Payment #70',date:'2026-05-20'}]});
    await run.engine.syncPaidFromQB();
    expect(run.saved().payments).toHaveLength(1);
  });

  test('a payment with no usable date blocks rather than guessing one',async()=>{
    const run=pullSetup({qboPayments:[check('70','',100)]});
    await run.engine.syncPaidFromQB();
    expect(run.saved()).toBeNull();
    expect(run.log().details.join(' ')).toMatch(/has no usable date, and a guessed date would change the rep commission rate/);
  });

  test('a paid balance with no payment referencing the invoice blocks',async()=>{
    const run=pullSetup({qboPayments:[{Id:'71',TxnDate:'2026-05-20',Line:[{Amount:100,LinkedTxn:[{TxnType:'Invoice',TxnId:'999'}]}]}]});
    await run.engine.syncPaidFromQB();
    expect(run.saved()).toBeNull();
    expect(run.log().details.join(' ')).toMatch(/no payment record references this invoice/);
  });

  test('several checks against one invoice each keep their own date and amount',async()=>{
    const run=pullSetup({qboPayments:[check('70','2026-05-10',40),check('71','2026-05-25',60)]});
    await run.engine.syncPaidFromQB();
    expect(run.saved().payments).toEqual([
      {amount:40,method:'qb_sync',ref:'QBO Payment #70',date:'2026-05-10'},
      {amount:60,method:'qb_sync',ref:'QBO Payment #71',date:'2026-05-25'},
    ]);
  });

  test('the shared helper sums only lines applied to the invoice',()=>{
    expect(qbPaymentsAppliedToInvoice([
      {Id:'1',TxnDate:'2026-01-01',Line:[{Amount:10,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]},{Amount:5,LinkedTxn:[{TxnType:'Invoice',TxnId:'901'}]}]},
      {Id:'2',TxnDate:'2026-01-02',Line:[{Amount:7,LinkedTxn:[{TxnType:'Invoice',TxnId:'901'}]}]},
    ],'900')).toEqual([{id:'1',date:'2026-01-01',amount:10}]);
    expect(qbPaymentsAppliedToInvoice([{Id:'1',Line:[]}],'')).toEqual([]);
  });
});

describe('correcting a stale QBO total on a taxable invoice',()=>{
  // QB #196 case: the invoice was posted as one lump line before tax posting
  // existed, then edited in the Portal. The rebuild must carry the tax line.
  const taxMapping={...mapping,tax_ca_account:'25200'};
  const taxAccounts=[...accounts,{Id:'90',AcctNum:'25200',Name:'Sales Tax Payables:CA',AccountType:'Other Current Liability',Active:true}];
  function setupStale({partnerTax=true,invoiceResponse}={}){
    const inv={id:'INV1001',display_id:'INV-1001',customer_id:'C1',total:17134.06,tax:1203.61,tax_rate:0.0775,shipping:400,paid:17134.06,qb_invoice_id:'196',
      line_items:[{qty:1,rate:15530.45,amount:15530.45,desc:'Uniforms'}]};
    let config={realm_id:'r1',preflight:{status:'success',realm_id:'r1'},mapping:taxMapping,initialMigrationApproved:true,custQBMap:{C1:'55'},syncLog:[]};
    let sent=null;
    const qbApi=jest.fn(async(action,args={})=>{
      if(action==='query'){
        const q=args.query||'';
        if(q.includes('FROM Account'))return{QueryResponse:{Account:taxAccounts}};
        if(q.includes('FROM Preferences'))return{QueryResponse:{Preferences:[{TaxPrefs:{UsingSalesTax:true,PartnerTaxEnabled:partnerTax}}]}};
        if(q.includes('FROM TaxCode'))return{QueryResponse:{TaxCode:[]}};
        if(q.includes("FROM Item")&&q.includes('Sales Tax'))return{QueryResponse:{Item:[{Id:'8',Name:'NSA Portal Sales Tax — CA',Type:'Service',Active:true,IncomeAccountRef:{value:'90'}}]}};
        if(q.includes("FROM Item"))return{QueryResponse:{Item:[{Id:'7',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:'10'}}]}};
        if(q.includes('FROM Invoice'))return{QueryResponse:{Invoice:[{Id:'196',DocNumber:'INV-1001',Balance:16929.76,TotalAmt:16929.76,SyncToken:'3'}]}};
        return{QueryResponse:{}};
      }
      if(action==='upsert_invoice'){
        sent=args.invoice;
        if(invoiceResponse)return invoiceResponse;
        return{Invoice:{Id:'196',TotalAmt:17134.06,TxnTaxDetail:{TotalTax:0},Line:sent.Line}};
      }
      throw new Error('Unexpected '+action);
    });
    const engine=createQBSyncEngine({cust:[{id:'C1',name:'Orange Lutheran Football',shipping_state:'CA'}],sos:[],invs:[inv],prod:[],vend:[],qbApi,qbConfig:config,
      persistQbLink:jest.fn(async()=>{}),nf:jest.fn(),setQbSyncing:jest.fn(),setInvs:jest.fn(),setQBConfig:fn=>{config=fn(config);}});
    return{engine,qbApi,sent:()=>sent,config:()=>config};
  }

  test('the rebuilt invoice carries sales, shipping and a tax line on the CA liability item',async()=>{
    const run=setupStale();
    await run.engine.syncPaidFromQB();
    const sent=run.sent();
    expect(sent).toMatchObject({Id:'196',SyncToken:'3',sparse:true});
    expect(sent.TxnTaxDetail).toBeUndefined();
    const amounts=sent.Line.map(l=>l.Amount);
    expect(amounts).toEqual([15530.45,400,1203.61]);
    expect(sent.Line.every(l=>l.SalesItemLineDetail.TaxCodeRef.value==='NON')).toBe(true);
    expect(sent.Line[2].SalesItemLineDetail.ItemRef).toEqual({value:'8',name:'NSA Portal Sales Tax — CA'});
    expect(lastLog(run).details.join(' ')).toMatch(/QB total corrected \$16929\.76 → \$17134\.06 · tax \$1203\.61 → NSA Portal Sales Tax — CA/);
    // No payment is sent on the correction run; paid is re-checked next run.
    expect(run.qbApi.mock.calls.some(([a])=>a==='upsert_payment')).toBe(false);
  });

  test('a stored total that does not match the Portal is reported, not counted as corrected',async()=>{
    const run=setupStale({invoiceResponse:{Invoice:{Id:'196',TotalAmt:16929.76,TxnTaxDetail:{TotalTax:0},Line:[]}}});
    await run.engine.syncPaidFromQB();
    const log=lastLog(run);
    expect(log.status).toBe('error');
    expect(log.details.join(' ')).toMatch(/total correction VERIFY FAILED: QBO Invoice #196 stored total \$16929\.76/);
    expect(log.details.join(' ')).not.toMatch(/corrected \$/);
  });

  test('a QBO fault on the rebuild is surfaced with its detail',async()=>{
    const run=setupStale({invoiceResponse:{Fault:{Error:[{Detail:'Stale SyncToken',code:'5010'}]}}});
    await run.engine.syncPaidFromQB();
    expect(lastLog(run).details.join(' ')).toMatch(/total correction FAILED: Stale SyncToken \[code 5010\]/);
  });
});

describe('voided Portal invoices',()=>{
  test('a voided invoice that reached QBO is reported and never paid or corrected',async()=>{
    const invs=[{id:'INV2',display_id:'INV-2',customer_id:'C1',total:930,paid:930,status:'void',qb_invoice_id:'559'}];
    let config={realm_id:'r1',preflight:{status:'success',realm_id:'r1'},mapping,initialMigrationApproved:true,custQBMap:{C1:'55'},syncLog:[]};
    const qbApi=jest.fn(async(action,args={})=>{
      if(action==='query'){
        const q=args.query||'';
        if(q.includes('FROM Account'))return{QueryResponse:{Account:accounts}};
        if(q.includes('FROM Item'))return{QueryResponse:{Item:[{Id:'7',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:'10'}}]}};
        return{QueryResponse:{}};
      }
      throw new Error('Unexpected '+action);
    });
    const engine=createQBSyncEngine({cust:[{id:'C1',name:'Club'}],sos:[],invs,prod:[],vend:[],qbApi,qbConfig:config,
      persistQbLink:jest.fn(async()=>{}),nf:jest.fn(),setQbSyncing:jest.fn(),setInvs:jest.fn(),setQBConfig:fn=>{config=fn(config);}});
    await engine.syncPaidFromQB();
    const log=(config.syncLog||[]).find(l=>l.type==='paid_sync');
    expect(log.details.join(' ')).toMatch(/INV-2 — VOID in the Portal but posted as QBO Invoice #559; void it in QuickBooks, nothing was sent/);
    expect(log.status).toBe('partial');
    expect(qbApi.mock.calls.some(([a])=>a==='upsert_payment'||a==='upsert_invoice')).toBe(false);
  });
});

// QuickBooks is being populated for the first time, so the day a payment is
// dated is the day cash shows as received.
describe('payment dates on push',()=>{
  test('a Portal payment row posts on the day it was recorded, with its reference',async()=>{
    const run=setup({payments:[{amount:100,method:'check',ref:'Check 4471',date:'07/18/2026'}]});
    await run.engine.syncPaidFromQB();
    expect(run.sent()).toMatchObject({TotalAmt:100,TxnDate:'2026-07-18',PaymentRefNum:'Check 4471'});
    expect(run.persistQbLink.mock.calls[0][0].evidence).toMatchObject({amount:100,date:'2026-07-18'});
    expect(lastLog(run).details.join(' ')).toMatch(/pushed and verified \$100\.00 payment dated 2026-07-18 → QBO Payment #77/);
  });
  test('an invoice marked paid with no payment rows is dated 30 days after the invoice',async()=>{
    const run=setup();
    await run.engine.syncPaidFromQB();
    expect(run.sent()).toMatchObject({TotalAmt:100,TxnDate:'2026-07-01'});
    expect(run.sent().PaymentRefNum).toBeUndefined();
    expect(run.sent().PrivateNote).toMatch(/dated 30 days after the invoice/);
  });
  test('a read-back with a different date is a blocked push, not a success',async()=>{
    const run=setup({readback:[{Id:'77',TotalAmt:100,TxnDate:'2026-09-07',CustomerRef:{value:'55'},DepositToAccountRef:{value:'13'},Line:[{Amount:100,LinkedTxn:[{TxnType:'Invoice',TxnId:'900'}]}]}]});
    await run.engine.syncPaidFromQB();
    expect(run.persistQbLink).not.toHaveBeenCalled();
    expect(lastLog(run).details.join(' ')).toMatch(/payment BLOCKED: payment date did not match on read-back \(2026-09-07 vs 2026-07-01\)/);
  });
  test('a Portal payment row without a usable date blocks rather than guessing',async()=>{
    const run=setup({payments:[{amount:100,ref:'Check 1',date:''}]});
    await run.engine.syncPaidFromQB();
    expect(run.qbApi.mock.calls.some(([a])=>a==='upsert_payment')).toBe(false);
    expect(lastLog(run).details.join(' ')).toMatch(/payment BLOCKED: portal payment "Check 1" of \$100\.00 has no usable date/);
  });
  describe('buildPortalPaymentPushRows',()=>{
    test('several rows post separately in date order and skip what QBO already records',()=>{
      const rows=buildPortalPaymentPushRows({invoice:{paid:300,payments:[
        {amount:100,ref:'B',date:'2026-08-01'},{amount:150,ref:'A',date:'2026-07-01'},{amount:50,ref:'C',date:'2026-08-15'}]},alreadyApplied:150,cap:150});
      expect(rows).toEqual([{amount:100,date:'2026-08-01',ref:'B',note:''},{amount:50,date:'2026-08-15',ref:'C',note:''}]);
    });
    test('a partly recorded row sends only its remainder',()=>{
      const rows=buildPortalPaymentPushRows({invoice:{paid:100,payments:[{amount:100,ref:'A',date:'2026-07-01'}]},alreadyApplied:40,cap:60});
      expect(rows).toEqual([{amount:60,date:'2026-07-01',ref:'A',note:''}]);
    });
    test('the total sent never exceeds the cap',()=>{
      const rows=buildPortalPaymentPushRows({invoice:{paid:100,payments:[{amount:100,ref:'A',date:'2026-07-01'}]},alreadyApplied:0,cap:75});
      expect(rows).toEqual([{amount:75,date:'2026-07-01',ref:'A',note:''}]);
    });
    test('the derived date is never in the future',()=>{
      const rows=buildPortalPaymentPushRows({invoice:{paid:100,date:'2026-08-20'},cap:100,today:'2026-09-07'});
      expect(rows[0].date).toBe('2026-09-07');
      expect(buildPortalPaymentPushRows({invoice:{paid:100,date:'2026-07-31'},cap:100,today:'2026-09-07'})[0].date).toBe('2026-08-30');
    });
    test('no invoice date and no rows is an error, not a guessed date',()=>{
      expect(()=>buildPortalPaymentPushRows({invoice:{paid:100},cap:100})).toThrow(/no date to derive a payment date/);
    });
  });
});
