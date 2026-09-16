import {createQBSyncEngine} from '../qbSyncEngine';

// INV-63433 / QBO #1084: a batch was cut off after QuickBooks created the
// invoice but before the link was saved. A retry must link the exact existing
// record and must never rebuild or otherwise update it.
const mapping={income_account:'40000',discount_account:'40200',ar_account:'11000',tax_ca_account:'25200'};
const accounts=[
  {Id:'10',AcctNum:'40000',Name:'Sales',AccountType:'Income',Active:true},
  {Id:'11',AcctNum:'40200',Name:'Discounts',AccountType:'Income',Active:true},
  {Id:'12',AcctNum:'11000',Name:'Accounts Receivable (A/R)',AccountType:'Accounts Receivable',Active:true},
  {Id:'90',AcctNum:'25200',Name:'Sales Tax Payables:CA',AccountType:'Other Current Liability',Active:true},
];
const inv={id:'INV-63433',customer_id:'C1',total:3232.4,tax:302.4,tax_rate:0.105,shipping:50,paid:0,status:'open',date:'2026-08-31',
  line_items:[{qty:1,rate:2880,amount:2880,desc:'Uniforms'}]};
const taxLine={DetailType:'SalesItemLineDetail',Amount:302.4,SalesItemLineDetail:{ItemRef:{value:'8'},TaxCodeRef:{value:'NON'}}};
const lumpLine={DetailType:'SalesItemLineDetail',Amount:3232.4,SalesItemLineDetail:{ItemRef:{value:'7'},TaxCodeRef:{value:'NON'}}};

function setup({existingLines,rebuildResponse,existingTermRef={value:'T30',name:'Net 30'},existingDueDate}={}){
  let config={realm_id:'r1',preflight:{status:'success',realm_id:'r1'},mapping,initialMigrationApproved:true,custQBMap:{C1:'55'},syncLog:[]};
  const upserts=[];
  let storedLines=existingLines;
  const qbApi=jest.fn(async(action,args={})=>{
    if(action==='query'){
      const q=args.query||'';
      if(q.includes('FROM Account'))return{QueryResponse:{Account:accounts}};
      if(q.includes('FROM Preferences'))return{QueryResponse:{Preferences:[{TaxPrefs:{UsingSalesTax:true,PartnerTaxEnabled:true}}]}};
      if(q.includes('FROM TaxCode'))return{QueryResponse:{TaxCode:[]}};
      if(q.includes('FROM Item')&&q.includes('Sales Tax'))return{QueryResponse:{Item:[{Id:'8',Name:'NSA Portal Sales Tax — CA',Type:'Service',Active:true,IncomeAccountRef:{value:'90'}}]}};
      if(q.includes('FROM Item'))return{QueryResponse:{Item:[{Id:'7',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:'10'}}]}};
      if(q.includes("FROM Customer WHERE Id = '55'"))return{QueryResponse:{Customer:[{Id:'55',SalesTermRef:{value:'T30',name:'Net 30'}}]}};
      if(q.includes('FROM Invoice')&&q.includes('DocNumber'))return{QueryResponse:{Invoice:[{Id:'1084',DocNumber:'NS-INV-63433',CustomerRef:{value:'55'},TotalAmt:3232.4,TxnDate:'2026-08-31'}]}};
      if(q.includes('FROM Invoice')&&q.includes("Id = '1084'"))return{QueryResponse:{Invoice:[{Id:'1084',DocNumber:'INV-63433',SyncToken:'2',CustomerRef:{value:'55'},TotalAmt:3232.4,TxnDate:'2026-08-31',...(existingTermRef?{SalesTermRef:existingTermRef}:{}),...(existingDueDate?{DueDate:existingDueDate}:{}),TxnTaxDetail:{TotalTax:0},Line:storedLines}]}};
      return{QueryResponse:{}};
    }
    if(action==='upsert_invoice'){
      upserts.push(args.invoice);
      if(!args.invoice.Id)return{Fault:{Error:[{code:'6140',Detail:'Duplicate Document Number Error'}]}};
      const response=rebuildResponse||{Invoice:{Id:'1084',TotalAmt:3232.4,TxnTaxDetail:{TotalTax:0},Line:args.invoice.Line}};
      storedLines=response?.Invoice?.Line||storedLines;
      return response;
    }
    throw new Error('Unexpected '+action);
  });
  const setInvs=jest.fn();
  const engine=createQBSyncEngine({cust:[{id:'C1',name:'Cantwell-Sacred Heart Football',shipping_state:'CA'}],sos:[],invs:[inv],prod:[],vend:[],qbApi,qbConfig:config,
    acquireInvoiceSyncClaim:jest.fn(async()=>true),releaseInvoiceSyncClaim:jest.fn(async()=>true),
    persistQbLink:jest.fn(async()=>{}),nf:jest.fn(),setQbSyncing:jest.fn(),setInvs,setQBConfig:fn=>{config=fn(config);}});
  return{engine,upserts,setInvs,log:()=>(config.syncLog||[]).find(l=>l.type==='invoices')||{details:[]}};
}

const reviewedOptions={approved:true,approvedInvoiceIds:['INV-63433'],expectedRows:[{invoiceId:'INV-63433',documentNumber:'INV-63433',customerId:'C1',qboCustomerId:'55',date:'2026-08-31',total:3232.4,paid:0,tax:302.4}]};

test('an existing exact NS-prefixed match is linked without rebuilding its lines',async()=>{
  const run=setup({existingLines:[lumpLine]});
  await run.engine.syncInvoices({}, {}, reviewedOptions);
  expect(run.upserts).toHaveLength(0);
  const details=run.log().details.join(' | ');
  expect(details).toMatch(/exact existing invoice verified \(QB #1084\); QBO unchanged/);
  expect(details).toMatch(/INV-63433 linked to existing QB Invoice #1084/);
  expect(run.setInvs).toHaveBeenCalledTimes(1);
});

test('an existing exact match that already carries the tax line is linked without a write',async()=>{
  const run=setup({existingLines:[{DetailType:'SalesItemLineDetail',Amount:2880,SalesItemLineDetail:{ItemRef:{value:'7'}}},{DetailType:'SalesItemLineDetail',Amount:50,SalesItemLineDetail:{ItemRef:{value:'7'}}},taxLine]});
  await run.engine.syncInvoices({}, {}, reviewedOptions);
  expect(run.upserts).toHaveLength(0);
  expect(run.log().details.join(' | ')).toMatch(/QBO unchanged/);
  expect(run.setInvs).toHaveBeenCalledTimes(1);
});

test('an exact four-field match does not require QBO terms to be changed',async()=>{
  const run=setup({existingLines:[{DetailType:'SalesItemLineDetail',Amount:2880,SalesItemLineDetail:{ItemRef:{value:'7'}}},{DetailType:'SalesItemLineDetail',Amount:50,SalesItemLineDetail:{ItemRef:{value:'7'}}},taxLine],existingTermRef:null,existingDueDate:'2026-09-30'});
  await run.engine.syncInvoices({}, {}, reviewedOptions);
  expect(run.upserts).toHaveLength(0);
  expect(run.log().details.join(' | ')).toMatch(/QBO unchanged/);
  expect(run.setInvs).toHaveBeenCalledTimes(1);
});

test('an exact match is never automatically rebuilt even when its line shape differs',async()=>{
  const run=setup({existingLines:[lumpLine],rebuildResponse:{Invoice:{Id:'1084',TotalAmt:3232.4,TxnTaxDetail:{TotalTax:0},Line:[lumpLine]}}});
  await run.engine.syncInvoices({}, {}, reviewedOptions);
  expect(run.upserts).toHaveLength(0);
  expect(run.setInvs).toHaveBeenCalledTimes(1);
});
