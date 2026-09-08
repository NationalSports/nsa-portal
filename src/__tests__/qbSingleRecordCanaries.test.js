import { QB_PO_ACCOUNT_LINE_DESCRIPTION_MAX, applyQBPurchaseOrderLiveReadiness, applyQBSalesOrderLiveReadiness, billReferencesPortalPO, buildQBBillPOReplacement, buildQBInvoicePreviewRows, buildQBPurchaseOrderPreviewRows, buildQBSalesOrderPreviewRows, createQBSyncEngine, findQbPOBillCandidates, qbLinkedTransactions, qbPOAccountLineDescription, qbPurchaseOrderSourceFingerprint, qbSalesOrderSourceFingerprint } from '../qbSyncEngine';
import { indexQBNonInventoryItems, QB_ACCOUNT_MAPPING_DEFAULTS, QB_ACCOUNT_SPECS } from '../qbAccountMappings';

const accountRows = Object.values(QB_ACCOUNT_SPECS).map((spec,index)=>({
  Id:String(index+1),Name:spec.name,FullyQualifiedName:spec.name,AcctNum:spec.number,
  AccountType:spec.types[0],Active:true,
}));
const accountId = number => String(Object.values(QB_ACCOUNT_SPECS).findIndex(spec=>spec.number===number)+1);

const makeEngine = ({qbApi,cust=[],sos=[],invs=[],prod=[],vend=[],dP=jest.fn(()=>({sell:0}))}) => {
  let config={
    realm_id:'9341',preflight:{status:'success',realm_id:'9341'},initialMigrationApproved:false,
    mapping:{...QB_ACCOUNT_MAPPING_DEFAULTS},custQBMap:{C1:'C-QB'},prodQBMap:{},qbSOMap:{},qbPOMap:{},syncLog:[],
  };
  const setters={
    setQBConfig:jest.fn(updater=>{config=typeof updater==='function'?updater(config):updater}),
    setQbSyncing:jest.fn(),setInvs:jest.fn(),setInvPOs:jest.fn(),setSOs:jest.fn(),
    setSubmittedBatches:jest.fn(),setVend:jest.fn(),
  };
  const persistQbLink=jest.fn(async()=>({}));
  const engine=createQBSyncEngine({
      persistQbLink,
    cust,sos,invs,prod,vend,invPOs:[],submittedBatches:[],qbApi,qbConfig:config,nf:jest.fn(),
    dP,...setters,
  });
  return{engine,setters,persistQbLink,getConfig:()=>config};
};

const accountResponse = {QueryResponse:{Account:accountRows}};
const portalSalesItem = {Id:'SALES-ITEM',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:accountId('40000')}};

describe('QuickBooks one-record canaries', () => {
  test('invoice review lists exact ready rows and blocks zero totals without writing', () => {
    const rows=buildQBInvoicePreviewRows([
      {id:'INV-10',customer_id:'C1',invoice_date:'2026-09-08',total:100,paid:25,tax:8},
      {id:'INV-11',customer_id:'C1',invoice_date:'2026-09-08',total:0,paid:0,tax:0},
      {id:'INV-12',customer_id:'C1',invoice_date:'2026-09-08',total:50,status:'void'},
    ],[{id:'C1',name:'Exact Customer'}],{C1:'Q1'});
    expect(rows).toEqual([
      expect.objectContaining({invoiceId:'INV-10',documentNumber:'INV-10',customer:'Exact Customer',qboCustomerId:'Q1',date:'2026-09-08',total:100,paid:25,tax:8,action:'ready'}),
      expect.objectContaining({invoiceId:'INV-11',action:'blocked',reason:'invoice total must be positive'}),
    ]);
  });

  test('bulk invoice writes require an explicitly approved exact review', async() => {
    const qbApi=jest.fn();
    const {engine,getConfig}=makeEngine({qbApi,cust:[{id:'C1',name:'Test Customer'}],invs:[{id:'INV-1',customer_id:'C1',invoice_date:'2026-09-08',total:100}]});
    getConfig().initialMigrationApproved=true;
    await expect(engine.syncInvoices()).resolves.toEqual({status:'blocked',synced:0});
    expect(qbApi).not.toHaveBeenCalled();
  });

  test('a reviewed invoice batch stops after the first write failure', async() => {
    const invoices=[
      {id:'INV-1',customer_id:'C1',invoice_date:'2026-09-08',total:100,paid:0,tax:0},
      {id:'INV-2',customer_id:'C1',invoice_date:'2026-09-08',total:200,paid:0,tax:0},
    ];
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='query'&&query.includes("FROM Customer WHERE Id = 'C-QB'"))return{QueryResponse:{Customer:[{Id:'C-QB',SalesTermRef:{value:'T30',name:'Net 30'}}]}};
      if(action==='upsert_invoice')throw new Error('transport stopped');
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const {engine,getConfig}=makeEngine({qbApi,cust:[{id:'C1',name:'Test Customer'}],invs:invoices});
    getConfig().initialMigrationApproved=true;
    const expectedRows=buildQBInvoicePreviewRows(invoices,[{id:'C1',name:'Test Customer'}],{C1:'C-QB'});
    await expect(engine.syncInvoices({}, {}, {approved:true,approvedInvoiceIds:['INV-1','INV-2'],expectedRows})).resolves.toEqual({status:'blocked',synced:0});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_invoice')).toHaveLength(1);
    expect(getConfig().lastInvoiceBatch.counts).toEqual({failed:1,not_attempted:1});
  });

  test('creates and reads back exactly one invoice with the QBO customer terms', async() => {
    const invoice={id:'INV-1',display_id:'INV-1',customer_id:'C1',so_id:'SO-1',invoice_date:'2026-09-01',total:100,paid:0,tax:0};
    const readback={Id:'900',DocNumber:'INV-1',CustomerRef:{value:'C-QB'},TotalAmt:100,TxnDate:'2026-09-01',SalesTermRef:{value:'T30',name:'Net 30'}};
    const qbApi=jest.fn(async(action,{query,invoice:payload}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='query'&&query.includes("FROM Customer WHERE Id = 'C-QB'"))return{QueryResponse:{Customer:[{Id:'C-QB',SalesTermRef:{value:'T30',name:'Net 30'}}]}};
      if(action==='upsert_invoice')return{Invoice:{Id:'900',...payload}};
      if(action==='query'&&query.includes("FROM Invoice WHERE Id = '900'"))return{QueryResponse:{Invoice:[readback]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,setters}=makeEngine({qbApi,cust:[{id:'C1',name:'Test Customer'}],invs:[invoice]});
    await expect(engine.syncInvoices({}, {}, {canaryInvoiceId:'INV-1'})).resolves.toEqual({status:'success',synced:1});
    expect(qbApi).toHaveBeenCalledWith('upsert_invoice',{invoice:expect.objectContaining({DocNumber:'INV-1',CustomerRef:{value:'C-QB'},SalesTermRef:{value:'T30',name:'Net 30'}})});
    const invoicePayload=qbApi.mock.calls.find(([action])=>action==='upsert_invoice')[1].invoice;
    expect(invoicePayload.ARAccountRef).toEqual({value:accountId('11000')});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_invoice')).toHaveLength(1);
    expect(setters.setInvs).toHaveBeenCalledTimes(1);
  });

  const taxableInvoice={id:'INV-63848',display_id:'INV-63848',customer_id:'C1',invoice_date:'2026-09-05',total:3083.2,tax:237.17,tax_rate:0.0875,shipping:135.53,paid:0};
  const taxCodeRows=[{Id:'TC-CA',Name:'CA Sales Tax',Active:true,SalesTaxRateList:{TaxRateDetail:[{TaxRateRef:{value:'TR-CA'}}]}}];
  const taxableQbApi=({readbackTax=237.17,partnerTax=false}={})=>{
    let sent;
    return jest.fn(async(action,{query,invoice:payload}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='query'&&query.includes("FROM Customer WHERE Id = 'C-QB'"))return{QueryResponse:{Customer:[{Id:'C-QB',SalesTermRef:{value:'T30',name:'Net 30'}}]}};
      if(action==='query'&&query.includes('FROM Preferences'))return{QueryResponse:{Preferences:[{TaxPrefs:{UsingSalesTax:true,PartnerTaxEnabled:partnerTax}}]}};
      if(action==='query'&&query.includes('FROM TaxCode'))return{QueryResponse:{TaxCode:taxCodeRows}};
      if(action==='upsert_invoice'){sent=payload;return{Invoice:{Id:'950',...payload,TotalAmt:3083.2}}}
      if(action==='query'&&query.includes("FROM Invoice WHERE Id = '950'"))return{QueryResponse:{Invoice:[{Id:'950',DocNumber:'INV-63848',CustomerRef:{value:'C-QB'},TotalAmt:3083.2,TxnDate:'2026-09-05',SalesTermRef:{value:'T30'},TxnTaxDetail:{...sent.TxnTaxDetail,TotalTax:readbackTax}}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
  };
  const taxableCustomer={id:'C1',name:'Exeter Boys Basketball',shipping_state:'CA'};

  test('posts one taxable invoice with the portal tax amount through the verified state tax code', async() => {
    const qbApi=taxableQbApi();
    const{engine,getConfig,setters}=makeEngine({qbApi,cust:[taxableCustomer],invs:[taxableInvoice]});
    getConfig().qbTaxRateMap={CA:'TR-CA'};
    await expect(engine.syncInvoices({}, {}, {canaryInvoiceId:'INV-63848'})).resolves.toEqual({status:'success',synced:1});
    const payload=qbApi.mock.calls.find(([action])=>action==='upsert_invoice')[1].invoice;
    expect(payload.TxnTaxDetail).toEqual({TxnTaxCodeRef:{value:'TC-CA'},TotalTax:237.17,
      TaxLine:[{Amount:237.17,DetailType:'TaxLineDetail',TaxLineDetail:{TaxRateRef:{value:'TR-CA'},PercentBased:false,NetAmountTaxable:2710.5}}]});
    expect(payload.Line.map(line=>[line.Amount,line.SalesItemLineDetail.TaxCodeRef.value])).toEqual([[2710.5,'TAX'],[135.53,'NON']]);
    expect(setters.setInvs).toHaveBeenCalledTimes(1);
  });

  test('blocks a taxable invoice before writing when the state has no verified tax rate', async() => {
    const qbApi=taxableQbApi();
    const{engine,setters}=makeEngine({qbApi,cust:[taxableCustomer],invs:[taxableInvoice]});
    await expect(engine.syncInvoices({}, {}, {canaryInvoiceId:'INV-63848'})).resolves.toEqual({status:'blocked',synced:0});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_invoice')).toHaveLength(0);
    expect(setters.setInvs).not.toHaveBeenCalled();
  });

  test('blocks taxable invoices before writing when Automated Sales Tax is on', async() => {
    const qbApi=taxableQbApi({partnerTax:true});
    const{engine,getConfig}=makeEngine({qbApi,cust:[taxableCustomer],invs:[taxableInvoice]});
    getConfig().qbTaxRateMap={CA:'TR-CA'};
    await expect(engine.syncInvoices({}, {}, {canaryInvoiceId:'INV-63848'})).resolves.toEqual({status:'blocked',synced:0});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_invoice')).toHaveLength(0);
  });

  test('does not save a taxable invoice link when QBO stored a different tax amount', async() => {
    const qbApi=taxableQbApi({readbackTax:250});
    const{engine,getConfig,setters}=makeEngine({qbApi,cust:[taxableCustomer],invs:[taxableInvoice]});
    getConfig().qbTaxRateMap={CA:'TR-CA'};
    await expect(engine.syncInvoices({}, {}, {canaryInvoiceId:'INV-63848'})).resolves.toEqual({status:'blocked',synced:0});
    expect(setters.setInvs).not.toHaveBeenCalled();
    expect(getConfig().syncLog[0].details.join(' ')).toMatch(/sales tax did not match/);
  });

  test('does not save an invoice link when QBO read-back does not match', async() => {
    const invoice={id:'INV-2',customer_id:'C1',invoice_date:'2026-09-01',total:100,paid:0,tax:0};
    const qbApi=jest.fn(async(action,{query,invoice:payload}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='query'&&query.includes("FROM Customer WHERE Id = 'C-QB'"))return{QueryResponse:{Customer:[{Id:'C-QB',SalesTermRef:{value:'T30',name:'Net 30'}}]}};
      if(action==='upsert_invoice')return{Invoice:{Id:'901',...payload}};
      if(action==='query'&&query.includes("FROM Invoice WHERE Id = '901'"))return{QueryResponse:{Invoice:[{Id:'901',DocNumber:'WRONG',CustomerRef:{value:'C-QB'},TotalAmt:100,SalesTermRef:{value:'T30'}}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,setters}=makeEngine({qbApi,cust:[{id:'C1',name:'Test Customer'}],invs:[invoice]});
    await expect(engine.syncInvoices({}, {}, {canaryInvoiceId:'INV-2'})).resolves.toEqual({status:'blocked',synced:0});
    expect(setters.setInvs).not.toHaveBeenCalled();
  });

  test('creates and reads back exactly one NonInventory SKU with approved accounts', async() => {
    const product={id:'P1',sku:'SKU-1',name:'Test Jersey',is_active:true,nsa_cost:12,retail_price:20};
    const readback={Id:'I-1',Name:'SKU-1',Sku:'SKU-1',Type:'NonInventory',IncomeAccountRef:{value:accountId('40000')},ExpenseAccountRef:{value:accountId('51300')}};
    const qbApi=jest.fn(async(action,{query,item}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes('FROM Item WHERE Active IN'))return{QueryResponse:{Item:[]}};
      if(action==='upsert_item')return{Item:{Id:'I-1',...item}};
      if(action==='query'&&query.includes("FROM Item WHERE Id = 'I-1'"))return{QueryResponse:{Item:[readback]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine({qbApi,prod:[product]});
    await engine.syncInventory({canaryProductId:'P1',allowCreate:true});
    expect(qbApi).toHaveBeenCalledWith('query',{query:'SELECT * FROM Item WHERE Active IN (true, false) STARTPOSITION 1 MAXRESULTS 1000'});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_item')).toHaveLength(1);
    const itemPayload=qbApi.mock.calls.find(([action])=>action==='upsert_item')[1].item;
    expect(itemPayload.IncomeAccountRef).toEqual({value:accountId('40000')});
    expect(itemPayload.ExpenseAccountRef).toEqual({value:accountId('51300')});
    expect(itemPayload.AssetAccountRef).toBeUndefined();
    expect(itemPayload).toEqual(expect.objectContaining({Type:'NonInventory'}));
    expect(itemPayload.TrackQtyOnHand).toBeUndefined();
    expect(itemPayload.QtyOnHand).toBeUndefined();
    expect(indexQBNonInventoryItems([{Id:'I-1',Active:true,...itemPayload}],['SKU-1'])).toEqual({
      'SKU-1':{value:'I-1',name:'SKU-1'},
    });
    expect(getConfig().prodQBMap.P1).toBe('I-1');
  });

  test('does not expose an unsupported QBO quantity-adjustment writer', () => {
    const qbApi=jest.fn();
    const{engine}=makeEngine({qbApi,prod:[{id:'P1',sku:'SKU-1',name:'Test Jersey',is_active:true,nsa_cost:12,_inv:{M:1}}]});
    expect(engine.syncInventoryAdjustmentCanary).toBeUndefined();
    expect(qbApi).not.toHaveBeenCalled();
  });

  test('unlinks exactly one inactive QBO item only after confirmation and API read-back', async() => {
    const product={id:'P1',sku:'SKU-1',name:'Test Jersey',is_active:true};
    const qbApi=jest.fn(async(action,{entity,id}={})=>{
      if(action==='read'&&entity==='item'&&id==='I-1')return{Item:{Id:'I-1',Sku:'SKU-1',Active:false}};
      throw new Error('Unexpected QBO call: '+action);
    });
    const{engine,getConfig}=makeEngine({qbApi,prod:[product]});
    getConfig().prodQBMap.P1='I-1';
    await expect(engine.clearInactiveProductLink('P1')).resolves.toEqual(expect.objectContaining({status:'needs_confirmation',sku:'SKU-1',itemId:'I-1'}));
    expect(getConfig().prodQBMap.P1).toBe('I-1');
    await expect(engine.clearInactiveProductLink('P1',{allowUnlink:true})).resolves.toEqual({status:'success',sku:'SKU-1',itemId:'I-1'});
    expect(getConfig().prodQBMap.P1).toBeUndefined();
    expect(getConfig().syncLog[0]).toEqual(expect.objectContaining({type:'item_link_cleanup',status:'success'}));
  });

  test('refuses to unlink a QBO item that is still active', async() => {
    const product={id:'P1',sku:'SKU-1',name:'Test Jersey',is_active:true};
    const qbApi=jest.fn(async(action,{entity,id}={})=>{
      if(action==='read'&&entity==='item'&&id==='I-1')return{Item:{Id:'I-1',Sku:'SKU-1',Active:true}};
      throw new Error('Unexpected QBO call: '+action);
    });
    const{engine,getConfig}=makeEngine({qbApi,prod:[product]});
    getConfig().prodQBMap.P1='I-1';
    await expect(engine.clearInactiveProductLink('P1',{allowUnlink:true})).resolves.toEqual({status:'blocked'});
    expect(getConfig().prodQBMap.P1).toBe('I-1');
  });

  test('creates and verifies the one required NSA Portal Sales service item', async() => {
    const readback={Id:'SALES-1',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:accountId('40000')}};
    const qbApi=jest.fn(async(action,{query,item}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[]}};
      if(action==='upsert_item')return{Item:{Id:'SALES-1',...item}};
      if(action==='query'&&query.includes("FROM Item WHERE Id = 'SALES-1'"))return{QueryResponse:{Item:[readback]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine({qbApi});
    await expect(engine.syncPortalSalesItemCanary()).resolves.toEqual({status:'success',itemId:'SALES-1'});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_item')).toHaveLength(1);
    expect(qbApi).toHaveBeenCalledWith('upsert_item',{item:expect.objectContaining({Name:'NSA Portal Sales',Type:'Service',IncomeAccountRef:expect.objectContaining({value:accountId('40000')})})});
    const portalSalesPayload=qbApi.mock.calls.find(([action])=>action==='upsert_item')[1].item;
    expect(portalSalesPayload.IncomeAccountRef).toEqual({value:accountId('40000')});
    expect(getConfig()._portalSalesItemId).toBe('SALES-1');
  });

  test('verifies an existing ready NSA Portal Sales item without writing it', async() => {
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='query'&&query.includes("FROM Item WHERE Id = 'SALES-ITEM'"))return{QueryResponse:{Item:[portalSalesItem]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine}=makeEngine({qbApi});
    await expect(engine.syncPortalSalesItemCanary()).resolves.toEqual({status:'success',itemId:'SALES-ITEM'});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_item')).toHaveLength(0);
  });

  test('repairs and verifies one inactive or misrouted NSA Portal Sales item', async() => {
    const existing={...portalSalesItem,Active:false,SyncToken:'3',IncomeAccountRef:{value:'WRONG-ACCOUNT'}};
    const readback={...portalSalesItem,Active:true,SyncToken:'4',IncomeAccountRef:{value:accountId('40000')}};
    const qbApi=jest.fn(async(action,{query,item}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[existing]}};
      if(action==='upsert_item')return{Item:{...item,Id:'SALES-ITEM'}};
      if(action==='query'&&query.includes("FROM Item WHERE Id = 'SALES-ITEM'"))return{QueryResponse:{Item:[readback]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine}=makeEngine({qbApi});
    await expect(engine.syncPortalSalesItemCanary()).resolves.toEqual({status:'success',itemId:'SALES-ITEM'});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_item')).toHaveLength(1);
    expect(qbApi).toHaveBeenCalledWith('upsert_item',{item:expect.objectContaining({Id:'SALES-ITEM',SyncToken:'3',sparse:true,Active:true,IncomeAccountRef:expect.objectContaining({value:accountId('40000')})})});
  });

  test('blocks duplicate NSA Portal Sales items without writing either one', async() => {
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem,{...portalSalesItem,Id:'SALES-ITEM-2'}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine}=makeEngine({qbApi});
    await expect(engine.syncPortalSalesItemCanary()).resolves.toEqual({status:'blocked'});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_item')).toHaveLength(0);
  });

  test('creates and reads back exactly one non-posting estimate', async() => {
    const so={id:'SO-1',customer_id:'C1',created_at:'2026-09-01',items:[{product_id:'P1',sku:'SKU-1',name:'Test Jersey',unit_sell:25,sizes:{S:2},decorations:[]}]};
    const readback={Id:'E-1',DocNumber:'SO-1',CustomerRef:{value:'C-QB'},TotalAmt:50,TxnDate:'2026-09-01'};
    const qbApi=jest.fn(async(action,{query,estimate}={})=>{
      if(action==='query'&&query.includes('FROM Estimate STARTPOSITION'))return{QueryResponse:{Estimate:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='upsert_estimate')return{Estimate:{Id:'E-1',...estimate}};
      if(action==='query'&&query.includes("FROM Estimate WHERE Id = 'E-1'"))return{QueryResponse:{Estimate:[readback]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine({qbApi,cust:[{id:'C1',name:'Test Customer'}],sos:[so],prod:[{id:'P1',sku:'SKU-1'}]});
    await expect(engine.syncSalesOrders({}, {}, {canarySOId:'SO-1'})).resolves.toEqual({status:'success',synced:1});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_estimate')).toHaveLength(1);
    expect(getConfig().qbSOMap['SO-1']).toBe('E-1');
  });

  test('sales-order review exposes ready and taxable-blocked Estimates without writing', () => {
    const base={customer_id:'C1',created_at:'2026-09-01',items:[{sku:'SKU-1',name:'Jersey',unit_sell:25,sizes:{S:2},decorations:[]}]};
    const rows=buildQBSalesOrderPreviewRows([{...base,id:'SO-1',tax_exempt:true},{...base,id:'SO-2',tax_rate:0.08}],
      [{id:'C1',name:'Test Customer',shipping_state:'CA'}],{C1:'C-QB'},{},jest.fn(()=>({sell:0})));
    expect(rows).toEqual([
      expect.objectContaining({salesOrderId:'SO-1',customer:'Test Customer',qboCustomerId:'C-QB',date:'2026-09-01',lineCount:1,tax:0,total:50,action:'ready'}),
      expect.objectContaining({salesOrderId:'SO-2',tax:4,taxState:'CA',total:54,action:'blocked',reason:'taxable Estimates await approved QBO tax-code mapping'}),
    ]);
  });

  test('sales-order review admits supported AST tax as an explicit state line', () => {
    const so={id:'SO-2',customer_id:'C1',created_at:'2026-09-01',tax_rate:0.08,items:[{sku:'SKU-1',name:'Jersey',unit_sell:25,sizes:{S:2},decorations:[]}]};
    const rows=buildQBSalesOrderPreviewRows([so],[{id:'C1',name:'Test Customer',shipping_state:'CA'}],{C1:'C-QB'},{},jest.fn(()=>({sell:0})),
      {partnerTaxEnabled:true,taxBlockReason:({taxState})=>taxState==='CA'?'':'unsupported'});
    expect(rows).toEqual([expect.objectContaining({salesOrderId:'SO-2',lineCount:2,salesSubtotal:50,taxRate:0.08,tax:4,taxState:'CA',total:54,action:'ready'})]);
  });

  test('bulk Estimate writes require an approved exact review and read back the approved row', async() => {
    const so={id:'SO-1',customer_id:'C1',created_at:'2026-09-01',tax_exempt:true,items:[{sku:'SKU-1',name:'Jersey',unit_sell:25,sizes:{S:2},decorations:[]}]};
    let sent;
    const qbApi=jest.fn(async(action,{query,estimate}={})=>{
      if(action==='query'&&query.includes('FROM Estimate STARTPOSITION'))return{QueryResponse:{Estimate:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='upsert_estimate'){sent=estimate;return{Estimate:{Id:'E-1',...estimate}}}
      if(action==='query'&&query.includes("FROM Estimate WHERE Id = 'E-1'"))return{QueryResponse:{Estimate:[{Id:'E-1',...sent,TotalAmt:50}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const {engine,getConfig,persistQbLink}=makeEngine({qbApi,cust:[{id:'C1',name:'Test Customer'}],sos:[so]});
    getConfig().initialMigrationApproved=true;
    await expect(engine.syncSalesOrders()).resolves.toEqual({status:'blocked',synced:0});
    expect(qbApi).not.toHaveBeenCalled();
    const expectedRows=buildQBSalesOrderPreviewRows([so],[{id:'C1',name:'Test Customer'}],{C1:'C-QB'},{},jest.fn(()=>({sell:0})));
    await expect(engine.syncSalesOrders({}, {}, {approved:true,approvedSOIds:['SO-1'],expectedRows})).resolves.toEqual({status:'success',synced:1});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_estimate')).toHaveLength(1);
    expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'qbSOMap',sourceIds:['SO-1'],qboId:'E-1',evidence:expect.objectContaining({api_readback:true})}));
  });

  test('live sales-order review removes conflicting QBO Estimate numbers before approval', () => {
    const rows=[
      {salesOrderId:'SO-NEW',customerId:'C1',customer:'Acme',qboCustomerId:'Q-C1',date:'2026-09-01',lineCount:1,salesSubtotal:10,shipping:0,taxRate:0,tax:0,taxState:'CA',total:10,action:'ready',reason:''},
      {salesOrderId:'SO-EXACT',customerId:'C1',customer:'Acme',qboCustomerId:'Q-C1',date:'2026-09-01',lineCount:1,salesSubtotal:20,shipping:0,taxRate:0,tax:0,taxState:'CA',total:20,action:'ready',reason:''},
      {salesOrderId:'SO-CONFLICT',customerId:'C1',customer:'Acme',qboCustomerId:'Q-C1',date:'2026-09-01',lineCount:1,salesSubtotal:30,shipping:0,taxRate:0,tax:0,taxState:'CA',total:30,action:'ready',reason:''},
    ];
    const reviewed=applyQBSalesOrderLiveReadiness(rows,[
      {Id:'E1',DocNumber:'SO-EXACT',CustomerRef:{value:'Q-C1'},TxnDate:'2026-09-01',TotalAmt:20},
      {Id:'E2',DocNumber:'SO-CONFLICT',CustomerRef:{value:'Q-C1'},TxnDate:'2026-09-01',TotalAmt:31},
    ]);
    expect(reviewed.map(row=>[row.salesOrderId,row.action,row.qboDisposition])).toEqual([
      ['SO-NEW','ready','create'],['SO-EXACT','ready','link_existing'],['SO-CONFLICT','blocked','blocked'],
    ]);
    expect(reviewed[2].reason).toMatch(/different customer, date, or total/);
    expect(qbSalesOrderSourceFingerprint(reviewed[1])).toEqual(qbSalesOrderSourceFingerprint(rows[1]));
  });

  test('reviewed AST Estimate carries Portal tax on the existing CA liability item and verifies it', async() => {
    const so={id:'SO-2',customer_id:'C1',created_at:'2026-09-01',tax_rate:0.08,items:[{sku:'SKU-1',name:'Jersey',unit_sell:25,sizes:{S:2},decorations:[]}]};
    const customer={id:'C1',name:'Test Customer',shipping_state:'CA'};
    const taxItem={Id:'TAX-CA',Name:'NSA Portal Sales Tax — CA',Type:'Service',Active:true,IncomeAccountRef:{value:accountId('25200')}};
    let sent;
    const qbApi=jest.fn(async(action,{query,estimate}={})=>{
      if(action==='query'&&query.includes('FROM Estimate STARTPOSITION'))return{QueryResponse:{Estimate:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='query'&&query.includes('NSA Portal Sales Tax — CA'))return{QueryResponse:{Item:[taxItem]}};
      if(action==='query'&&query.includes('FROM Preferences'))return{QueryResponse:{Preferences:[{TaxPrefs:{UsingSalesTax:true,PartnerTaxEnabled:true}}]}};
      if(action==='query'&&query.includes('FROM TaxCode STARTPOSITION'))return{QueryResponse:{TaxCode:[]}};
      if(action==='upsert_estimate'){sent=estimate;return{Estimate:{Id:'E-2',...estimate}}}
      if(action==='query'&&query.includes("FROM Estimate WHERE Id = 'E-2'"))return{QueryResponse:{Estimate:[{Id:'E-2',...sent,TotalAmt:54,TxnTaxDetail:{TotalTax:0}}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const {engine,getConfig,persistQbLink}=makeEngine({qbApi,cust:[customer],sos:[so]});
    getConfig().initialMigrationApproved=true;
    getConfig().taxPreflight={realm_id:'9341',partnerTaxEnabled:true};
    const reviewOptions={partnerTaxEnabled:true,taxBlockReason:()=>''};
    const expectedRows=buildQBSalesOrderPreviewRows([so],[customer],{C1:'C-QB'},{},jest.fn(()=>({sell:0})),reviewOptions);
    await expect(engine.syncSalesOrders({}, {}, {approved:true,approvedSOIds:['SO-2'],expectedRows})).resolves.toEqual({status:'success',synced:1});
    expect(sent.Line).toEqual([
      expect.objectContaining({Amount:50,SalesItemLineDetail:expect.objectContaining({TaxCodeRef:{value:'NON'}})}),
      expect.objectContaining({Amount:4,SalesItemLineDetail:expect.objectContaining({ItemRef:{value:'TAX-CA',name:'NSA Portal Sales Tax — CA'},TaxCodeRef:{value:'NON'}})}),
    ]);
    expect(sent.TxnTaxDetail).toBeUndefined();
    expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'qbSOMap',sourceIds:['SO-2'],evidence:expect.objectContaining({total:54,api_readback:true})}));
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_item')).toHaveLength(0);
  });

  test('adds an explicit rounding line so QBO preserves the exact Portal Estimate total', async() => {
    const so={id:'SO-ROUND',customer_id:'C1',created_at:'2026-09-01',tax_exempt:true,items:[
      {sku:'SKU-1',name:'Jersey',unit_sell:10,sizes:{S:3},decorations:[{kind:'art',position:'Front'}]},
      {sku:'SKU-2',name:'Short',unit_sell:10,sizes:{M:3},decorations:[{kind:'art',position:'Front'}]},
    ]};
    const customer={id:'C1',name:'Test Customer'};
    const dP=jest.fn(()=>({sell:0.335}));
    let sent;
    const qbApi=jest.fn(async(action,{query,estimate}={})=>{
      if(action==='query'&&query.includes('FROM Estimate STARTPOSITION'))return{QueryResponse:{Estimate:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='query'&&query.includes("FROM Item WHERE Name = 'NSA Portal Sales'"))return{QueryResponse:{Item:[portalSalesItem]}};
      if(action==='upsert_estimate'){sent=estimate;return{Estimate:{Id:'E-ROUND',...estimate}}}
      if(action==='query'&&query.includes("FROM Estimate WHERE Id = 'E-ROUND'"))return{QueryResponse:{Estimate:[{Id:'E-ROUND',...sent,TotalAmt:62.01}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const expectedRows=buildQBSalesOrderPreviewRows([so],[customer],{C1:'C-QB'},{},dP);
    expect(expectedRows[0]).toEqual(expect.objectContaining({salesSubtotal:62.01,total:62.01,lineCount:3}));
    const {engine,getConfig}=makeEngine({qbApi,cust:[customer],sos:[so],dP});
    getConfig().initialMigrationApproved=true;
    await expect(engine.syncSalesOrders({}, {}, {approved:true,approvedSOIds:['SO-ROUND'],expectedRows})).resolves.toEqual({status:'success',synced:1});
    expect(sent.Line).toEqual(expect.arrayContaining([
      expect.objectContaining({Amount:-0.01,Description:'Portal line-rounding adjustment'}),
    ]));
    expect(sent.Line.reduce((sum,line)=>sum+line.Amount,0)).toBeCloseTo(62.01,8);
  });

  test('creates one PO without creating a vendor or item and verifies read-back', async() => {
    const so={id:'SO-1',items:[{product_id:'P1',sku:'SKU-1',name:'Test Jersey',brand:'Acme',nsa_cost:5,sizes:{S:2},po_lines:[{po_id:'PO-1',created_at:'2026-09-01',S:2,unit_cost:5}]}]};
    let sentPO;
    const qbApi=jest.fn(async(action,{query,purchase_order}={})=>{
      if(action==='query'&&query.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme',CompanyName:'Acme'}]}};
      if(action==='query'&&query.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order'){sentPO=purchase_order;return{PurchaseOrder:{Id:'PO-QB',...purchase_order}}}
      if(action==='query'&&query.includes("FROM PurchaseOrder WHERE Id = 'PO-QB'"))return{QueryResponse:{PurchaseOrder:[{Id:'PO-QB',...sentPO,TotalAmt:10}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine({qbApi,sos:[so],prod:[{id:'P1',sku:'SKU-1'}],vend:[{id:'V1',name:'Acme'}]});
    getConfig().prodQBMap.P1='I-1';
    await expect(engine.syncPurchaseOrders({}, {canaryPOId:'PO-1'})).resolves.toEqual({status:'success',synced:1});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_purchase_order')).toHaveLength(1);
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_vendor'||action==='upsert_item')).toHaveLength(0);
    expect(getConfig().qbPOMap['PO-1']).toBe('PO-QB');
  });

  test('posts lines without a linked QBO item as one purchases-account line and verifies the read-back', async() => {
    const so={id:'SO-1',items:[
      {product_id:'P1',sku:'SKU-1',name:'Test Jersey',brand:'Acme',nsa_cost:5,sizes:{S:2},po_lines:[{po_id:'PO-1',created_at:'2026-09-01',S:2,unit_cost:5}]},
      {product_id:null,sku:'CUSTOM',name:'Sublimated uniforms',brand:'Acme',nsa_cost:30,is_custom:true,po_lines:[{po_id:'PO-1',created_at:'2026-09-01',L:2,unit_cost:30}]},
      {product_id:null,sku:'PC54',name:'Core Cotton Tee',brand:'Acme',nsa_cost:3.1,po_lines:[{po_id:'PO-1',created_at:'2026-09-01',M:3,unit_cost:3.1}]},
    ]};
    let sentPO;
    const qbApi=jest.fn(async(action,{query,purchase_order}={})=>{
      if(action==='query'&&query.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme',CompanyName:'Acme'}]}};
      if(action==='query'&&query.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order'){sentPO=purchase_order;return{PurchaseOrder:{Id:'PO-QB',...purchase_order}}}
      if(action==='query'&&query.includes("FROM PurchaseOrder WHERE Id = 'PO-QB'"))return{QueryResponse:{PurchaseOrder:[{Id:'PO-QB',...sentPO,TotalAmt:79.3}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig,persistQbLink}=makeEngine({qbApi,sos:[so],prod:[{id:'P1',sku:'SKU-1'}],vend:[{id:'V1',name:'Acme'}]});
    getConfig().prodQBMap.P1='I-1';
    await expect(engine.syncPurchaseOrders({}, {canaryPOId:'PO-1'})).resolves.toEqual({status:'success',synced:1});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_item')).toHaveLength(0);
    expect(sentPO.Line).toHaveLength(2);
    expect(sentPO.Line[0]).toEqual(expect.objectContaining({DetailType:'ItemBasedExpenseLineDetail',Amount:10,
      ItemBasedExpenseLineDetail:expect.objectContaining({ItemRef:{value:'I-1'},Qty:2})}));
    expect(sentPO.Line[1]).toEqual({DetailType:'AccountBasedExpenseLineDetail',Amount:69.3,
      Description:'Unlinked goods: CUSTOM Sublimated uniforms x2 @$30.00; PC54 Core Cotton Tee x3 @$3.10 (SO: SO-1)',
      AccountBasedExpenseLineDetail:{AccountRef:{value:accountId(QB_ACCOUNT_MAPPING_DEFAULTS.purchases_account)}}});
    expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'qbPOMap',sourceIds:['PO-1'],qboId:'PO-QB',
      evidence:expect.objectContaining({api_readback:true,total:79.3,line_count:2})}));
  });

  test('uses the saved PO line cost rounded to cents instead of a changed catalog cost', async() => {
    const so={id:'SO-1',items:[{product_id:'P1',sku:'SKU-1',name:'Test Jersey',brand:'Acme',nsa_cost:99.999,sizes:{S:1},po_lines:[{po_id:'PO-1',created_at:'2026-09-01',S:1,unit_cost:37.115}]}]};
    let sentPO;
    const qbApi=jest.fn(async(action,{query,purchase_order}={})=>{
      if(action==='query'&&query.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme',CompanyName:'Acme'}]}};
      if(action==='query'&&query.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order'){sentPO=purchase_order;return{PurchaseOrder:{Id:'PO-QB',...purchase_order}}}
      if(action==='query'&&query.includes("FROM PurchaseOrder WHERE Id = 'PO-QB'"))return{QueryResponse:{PurchaseOrder:[{Id:'PO-QB',...sentPO,TotalAmt:37.12}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine({qbApi,sos:[so],prod:[{id:'P1',sku:'SKU-1'}],vend:[{id:'V1',name:'Acme'}]});
    getConfig().prodQBMap.P1='I-1';
    await expect(engine.syncPurchaseOrders({}, {canaryPOId:'PO-1'})).resolves.toEqual({status:'success',synced:1});
    expect(sentPO.Line).toEqual([expect.objectContaining({
      Amount:37.12,
      ItemBasedExpenseLineDetail:expect.objectContaining({Qty:1,UnitPrice:37.12}),
    })]);
    expect(sentPO.TotalAmt).toBeUndefined();
  });

  test('records the QBO transport error instead of unknown when a PO write is rejected', async() => {
    const so={id:'SO-1',items:[{product_id:'P1',sku:'SKU-1',name:'Test Jersey',brand:'Acme',nsa_cost:5,sizes:{S:2},po_lines:[{po_id:'PO-1',created_at:'2026-08-31',S:2,unit_cost:5}]}]};
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(action==='query'&&query.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme',CompanyName:'Acme'}]}};
      if(action==='query'&&query.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order')return{__qbTransportError:true,status:400,error:'Transaction date is prior to start date for inventory item'};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine({qbApi,sos:[so],prod:[{id:'P1',sku:'SKU-1'}],vend:[{id:'V1',name:'Acme'}]});
    getConfig().prodQBMap.P1='I-1';
    await expect(engine.syncPurchaseOrders({}, {canaryPOId:'PO-1'})).resolves.toEqual({status:'blocked',synced:0});
    expect(getConfig().syncLog[0].details).toContain('PO-1 — FAILED: Transaction date is prior to start date for inventory item');
  });

  test('requires an exact approved PO list and verifies every batch line before saving a durable link', async() => {
    const so={id:'SO-1',items:[{product_id:'P1',sku:'SKU-1',name:'Test Jersey',brand:'Acme',nsa_cost:5,sizes:{S:2},po_lines:[{po_id:'PO-1',created_at:'2026-09-01',S:2,unit_cost:5}]}]};
    let sentPO;
    const qbApi=jest.fn(async(action,{query,purchase_order}={})=>{
      if(query?.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme'}]}};
      if(query?.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(query?.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order'){sentPO=purchase_order;return{PurchaseOrder:{Id:'PO-QB'}}}
      if(query?.includes("FROM PurchaseOrder WHERE Id = 'PO-QB'"))return{QueryResponse:{PurchaseOrder:[{Id:'PO-QB',...sentPO,TotalAmt:10}]}};
      throw new Error('Unexpected QBO call');
    });
    const{engine,getConfig,persistQbLink}=makeEngine({qbApi,sos:[so],prod:[{id:'P1',sku:'SKU-1'}],vend:[{id:'V1',name:'Acme'}]});
    getConfig().initialMigrationApproved=true;getConfig().prodQBMap.P1='I-1';
    await expect(engine.syncPurchaseOrders({},{})).resolves.toEqual({status:'blocked',synced:0});
    expect(qbApi).not.toHaveBeenCalled();
    const result=await engine.syncPurchaseOrders({}, {approved:true,approvedPOIds:['PO-1']});
    expect(result).toEqual(expect.objectContaining({status:'success',synced:1,report:expect.objectContaining({counts:{created:1}})}));
    expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'qbPOMap',sourceIds:['PO-1'],evidence:expect.objectContaining({api_readback:true,line_count:1})}));
    expect(getConfig().lastPurchaseOrderBatch.results[0]).toEqual(expect.objectContaining({poId:'PO-1',qboId:'PO-QB',result:'created'}));
  });

  test('live PO review removes QBO vendor and document conflicts before approval', () => {
    const rows=[
      {poId:'PO-NEW',vendor:'Acme',date:'2026-09-01',lineCount:1,skus:['SKU-1'],accountSkus:[],total:10,action:'ready',reason:''},
      {poId:'PO-EXACT',vendor:'Acme',date:'2026-09-01',lineCount:1,skus:['SKU-2'],accountSkus:[],total:20,action:'ready',reason:''},
      {poId:'PO-CONFLICT',vendor:'Acme',date:'2026-09-01',lineCount:1,skus:['SKU-3'],accountSkus:[],total:30,action:'ready',reason:''},
      {poId:'PO-NOVENDOR',vendor:'Missing',date:'2026-09-01',lineCount:1,skus:['SKU-4'],accountSkus:[],total:40,action:'ready',reason:''},
    ];
    const reviewed=applyQBPurchaseOrderLiveReadiness(rows,[{Id:'V1',DisplayName:'Acme',Active:true}],[
      {Id:'Q1',DocNumber:'PO-EXACT',VendorRef:{value:'V1'},TxnDate:'2026-09-01',TotalAmt:20},
      {Id:'Q2',DocNumber:'PO-CONFLICT',VendorRef:{value:'V1'},TxnDate:'2026-09-01',TotalAmt:31},
    ]);
    expect(reviewed.map(row=>[row.poId,row.action,row.qboDisposition])).toEqual([
      ['PO-NEW','ready','create'],['PO-EXACT','ready','link_existing'],['PO-CONFLICT','blocked','blocked'],['PO-NOVENDOR','blocked','blocked'],
    ]);
    expect(reviewed[2].reason).toMatch(/different vendor, date, or total/);
    expect(reviewed[3].reason).toMatch(/not linked or uniquely present/);
    expect(qbPurchaseOrderSourceFingerprint(reviewed[1])).toEqual(qbPurchaseOrderSourceFingerprint(rows[1]));
  });

  test('verifies reciprocal PO-to-existing-bill links and persists one durable receipt', async() => {
    const po={Id:'PO-QB',DocNumber:'PO-1',VendorRef:{value:'V-QB'},TotalAmt:10,TxnDate:'2026-09-01',LinkedTxn:[{TxnId:'B-1',TxnType:'Bill'}]};
    const bill={Id:'B-1',DocNumber:'BILL-1',VendorRef:{value:'V-QB'},TotalAmt:12,TxnDate:'2026-09-02',PrivateNote:'PO: PO-1 | Tracking: 123',Line:[{Id:'1',LinkedTxn:[{TxnId:'PO-QB',TxnType:'PurchaseOrder',TxnLineId:'1'}]}]};
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(action==='query'&&query.includes('FROM Bill STARTPOSITION'))return{QueryResponse:{Bill:[bill]}};
      if(action==='query'&&query.includes("FROM PurchaseOrder WHERE Id = 'PO-QB'"))return{QueryResponse:{PurchaseOrder:[po]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig,persistQbLink}=makeEngine({qbApi});
    getConfig().qbPOMap['PO-1']='PO-QB';
    await expect(engine.verifyPurchaseOrderBillLinks({canaryPOId:'PO-1',expectedBillId:'B-1'})).resolves.toEqual({status:'success',verified:1});
    expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'qbPOBillMap',sourceIds:['PO-1'],qboId:'B-1',evidence:expect.objectContaining({api_readback:true,purchase_order_id:'PO-QB',reciprocal_link:true})}));
    expect(getConfig().qbPOBillMap['PO-1']).toBe('B-1');
  });

  test('replaces matching bill lines with identical line-level PO links',()=>{
    const bill={Id:'417',SyncToken:'1',VendorRef:{value:'2384'},TotalAmt:85.69,Balance:85.69,Line:[
      {Id:'1',Description:'item 1',Amount:21,DetailType:'ItemBasedExpenseLineDetail',ItemBasedExpenseLineDetail:{ItemRef:{value:'262'},Qty:2,UnitPrice:10.5}},
      {Id:'2',Description:'item 2',Amount:48.75,DetailType:'ItemBasedExpenseLineDetail',ItemBasedExpenseLineDetail:{ItemRef:{value:'182'},Qty:2,UnitPrice:24.375}},
      {Id:'3',Description:'freight',Amount:15.94,DetailType:'AccountBasedExpenseLineDetail',AccountBasedExpenseLineDetail:{AccountRef:{value:'FREIGHT'}}},
    ]};
    const po={Id:'418',POStatus:'Open',Line:[
      {Id:'1',DetailType:'ItemBasedExpenseLineDetail',ItemBasedExpenseLineDetail:{ItemRef:{value:'262'},Qty:2}},
      {Id:'2',DetailType:'ItemBasedExpenseLineDetail',ItemBasedExpenseLineDetail:{ItemRef:{value:'182'},Qty:2}},
    ]};
    const update=buildQBBillPOReplacement({bill,purchaseOrder:po});
    expect(update.Line[0]).toEqual(expect.objectContaining({Description:'item 1',Amount:21,LinkedTxn:[{TxnId:'418',TxnType:'PurchaseOrder',TxnLineId:'1'}]}));
    expect(update.Line[0].Id).toBeUndefined();expect(update.Line[1].ItemBasedExpenseLineDetail.UnitPrice).toBe(24.375);
    expect(update.Line[2].Id).toBe('3');expect(update.Line.reduce((sum,line)=>sum+line.Amount,0)).toBe(85.69);
  });

  test('links one reviewed existing bill by API and verifies the unchanged bill plus reciprocal PO',async()=>{
    let bill={Id:'417',SyncToken:'1',DocNumber:'101',TxnDate:'2026-09-03',VendorRef:{value:'2384',name:'Agron'},APAccountRef:{value:'146'},PrivateNote:'PO: PO-1',TotalAmt:25,Balance:25,Line:[{Id:'5',Description:'SKU',Amount:25,DetailType:'ItemBasedExpenseLineDetail',ItemBasedExpenseLineDetail:{ItemRef:{value:'262'},Qty:2,UnitPrice:12.5}}]};
    let po={Id:'418',SyncToken:'0',DocNumber:'PO-1',TxnDate:'2026-09-02',VendorRef:{value:'2384',name:'Agron'},POStatus:'Open',TotalAmt:25,Line:[{Id:'1',Amount:25,DetailType:'ItemBasedExpenseLineDetail',ItemBasedExpenseLineDetail:{ItemRef:{value:'262'},Qty:2,UnitPrice:12.5}}]};
    const qbApi=jest.fn(async(action,{query,bill:payload}={})=>{
      if(action==='query'&&query.includes('FROM Bill STARTPOSITION'))return{QueryResponse:{Bill:[bill]}};
      if(action==='query'&&query.includes("FROM Bill WHERE Id = '417'"))return{QueryResponse:{Bill:[bill]}};
      if(action==='query'&&query.includes("FROM PurchaseOrder WHERE Id = '418'"))return{QueryResponse:{PurchaseOrder:[po]}};
      if(action==='upsert_bill'){
        bill={...bill,SyncToken:'2',Line:payload.Line,LinkedTxn:[{TxnId:'418',TxnType:'PurchaseOrder'}]};
        po={...po,SyncToken:'1',POStatus:'Closed',LinkedTxn:[{TxnId:'417',TxnType:'Bill'}]};
        return{Bill:bill};
      }
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig,persistQbLink}=makeEngine({qbApi});getConfig().qbPOMap['PO-1']='418';
    await expect(engine.linkPurchaseOrderBill({portalPOId:'PO-1',expectedBillId:'417',approved:true})).resolves.toEqual({status:'success',portalPOId:'PO-1',billId:'417'});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_bill')).toHaveLength(1);
    expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'qbPOBillMap',qboId:'417',evidence:expect.objectContaining({link_method:'api_bill_update',reciprocal_link:true})}));
    expect(getConfig().qbPOBillMap['PO-1']).toBe('417');
  });

  test.each([
    ['wrong reviewed bill', (po,bill)=>{bill.Id='OTHER'}, 'reviewed existing bill ID'],
    ['wrong PO number', (po)=>{po.DocNumber='PO-2'}, 'number differs'],
    ['wrong memo', (po,bill)=>{bill.PrivateNote='PO: PO-OTHER'}, 'exact portal PO reference'],
    ['another PO link', (po,bill)=>{bill.LinkedTxn.push({TxnId:'OTHER',TxnType:'PurchaseOrder'})}, 'different purchase order'],
    ['another bill link', (po)=>{po.LinkedTxn.push({TxnId:'OTHER',TxnType:'Bill'})}, 'different bill'],
    ['missing reciprocal link', (po)=>{po.LinkedTxn=[]}, 'does not contain the bill link'],
    ['wrong vendor', (po,bill)=>{bill.VendorRef.value='OTHER'}, 'vendors differ'],
    ['missing vendors', (po,bill)=>{delete po.VendorRef;delete bill.VendorRef}, 'vendors differ'],
  ])('does not certify %s', async(label,mutate,error)=>{
    const po={Id:'PO-QB',DocNumber:'PO-1',VendorRef:{value:'V-QB'},LinkedTxn:[{TxnId:'B-1',TxnType:'Bill'}]};
    const bill={Id:'B-1',VendorRef:{value:'V-QB'},PrivateNote:'PO: PO-1',LinkedTxn:[{TxnId:'PO-QB',TxnType:'PurchaseOrder'}]};
    mutate(po,bill);
    const qbApi=jest.fn(async(action,{query}={})=>({QueryResponse:query.includes('FROM Bill ')?{Bill:[bill]}:{PurchaseOrder:[po]}}));
    const {engine,getConfig,persistQbLink}=makeEngine({qbApi});getConfig().qbPOMap['PO-1']='PO-QB';
    await expect(engine.verifyPurchaseOrderBillLinks({canaryPOId:'PO-1',expectedBillId:'B-1'})).resolves.toEqual({status:'blocked',verified:0});
    expect(persistQbLink).not.toHaveBeenCalled();
    expect(getConfig().syncLog[0].details.join(' ')).toContain(error);
    expect(qbApi.mock.calls.every(([action])=>action==='query')).toBe(true);
  });

  test('does not certify an ambiguous match or a failed durable receipt', async()=>{
    const po={Id:'PO-QB',DocNumber:'PO-1',VendorRef:{value:'V-QB'},LinkedTxn:[{TxnId:'B-1',TxnType:'Bill'}]};
    const bill={Id:'B-1',VendorRef:{value:'V-QB'},PrivateNote:'PO: PO-1',LinkedTxn:[{TxnId:'PO-QB',TxnType:'PurchaseOrder'}]};
    let bills=[bill,{...bill,Id:'B-2'}];
    const qbApi=jest.fn(async(action,{query}={})=>({QueryResponse:query.includes('FROM Bill ')?{Bill:bills}:{PurchaseOrder:[po]}}));
    const {engine,getConfig,persistQbLink}=makeEngine({qbApi});getConfig().qbPOMap['PO-1']='PO-QB';
    await engine.verifyPurchaseOrderBillLinks({canaryPOId:'PO-1',expectedBillId:'B-1'});
    expect(persistQbLink).not.toHaveBeenCalled();
    bills=[bill];persistQbLink.mockRejectedValue(new Error('database read-back failed'));
    await expect(engine.verifyPurchaseOrderBillLinks({canaryPOId:'PO-1',expectedBillId:'B-1'})).resolves.toEqual({status:'blocked',verified:0});
    expect(getConfig().qbPOBillMap?.['PO-1']).toBeUndefined();
    expect(getConfig().lastPOBillVerification).toBeUndefined();
  });

  test('blocks a PO-to-bill receipt when API read-back is not reciprocal', async() => {
    const bill={Id:'B-1',VendorRef:{value:'V-QB'},PrivateNote:'PO: PO-1',Line:[]};
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(query.includes('FROM Bill STARTPOSITION'))return{QueryResponse:{Bill:[bill]}};
      if(query.includes('FROM PurchaseOrder WHERE'))return{QueryResponse:{PurchaseOrder:[{Id:'PO-QB',VendorRef:{value:'V-QB'},LinkedTxn:[]}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig,persistQbLink}=makeEngine({qbApi});
    getConfig().qbPOMap['PO-1']='PO-QB';
    await expect(engine.verifyPurchaseOrderBillLinks({canaryPOId:'PO-1',expectedBillId:'B-1'})).resolves.toEqual({status:'blocked',verified:0});
    expect(persistQbLink).not.toHaveBeenCalled();
  });
});

test('PO-to-bill matching uses exact memo references and line links',()=>{
  const lineLinked={Id:'1',Line:[{LinkedTxn:[{TxnId:'418',TxnType:'PurchaseOrder'}]}]};
  expect(qbLinkedTransactions(lineLinked)).toHaveLength(1);
  expect(billReferencesPortalPO({PrivateNote:'PO: PO 58971 SHHGS | Tracking: 123'},'PO 58971 SHHGS')).toBe(true);
  expect(billReferencesPortalPO({PrivateNote:'PO: PO 58971 SHHGS-OTHER'},'PO 58971 SHHGS')).toBe(false);
  expect(findQbPOBillCandidates([lineLinked], 'different', '418')).toEqual([lineLinked]);
});

test('purchase-order preview keeps POs with unlinked SKUs ready and lists the SKUs headed to the purchases account',()=>{
  const sos=[{id:'SO-1',items:[
    {product_id:'P1',sku:'READY',name:'Ready',brand:'Acme',nsa_cost:5,po_lines:[{po_id:'PO-1',created_at:'2026-09-01',S:2,unit_cost:5}]},
    {product_id:'P2',sku:'MISSING',name:'Missing',brand:'Acme',nsa_cost:4,po_lines:[{po_id:'PO-2',created_at:'2026-09-01',M:1,unit_cost:4}]},
    {product_id:null,sku:'CUSTOM',name:'Sublimated uniforms',brand:'Acme',nsa_cost:30,is_custom:true,po_lines:[{po_id:'PO-2',created_at:'2026-09-01',L:2,unit_cost:30}]},
  ]}];
  const rows=buildQBPurchaseOrderPreviewRows(sos,[{id:'P1',sku:'READY'},{id:'P2',sku:'MISSING'}],{P1:'I-1'},{});
  expect(rows.find(row=>row.poId==='PO-1')).toEqual(expect.objectContaining({action:'ready',total:10,accountSkus:[]}));
  expect(rows.find(row=>row.poId==='PO-2')).toEqual(expect.objectContaining({action:'ready',total:64,reason:'',accountSkus:['MISSING','CUSTOM']}));
});

test('purchase-order preview parks document numbers longer than QBO accepts',()=>{
  const poId='re_1305_162213557_fzqpgy';
  const rows=buildQBPurchaseOrderPreviewRows([{id:'SO-1',items:[
    {product_id:'P1',sku:'READY',name:'Ready',brand:'Acme',nsa_cost:5,po_lines:[{po_id:poId,created_at:'2026-09-01',S:2,unit_cost:5}]},
  ]}],[{id:'P1',sku:'READY'}],{P1:'I-1'},{});
  expect(rows).toEqual([expect.objectContaining({poId,action:'blocked',reason:'QBO purchase-order number exceeds the 21-character limit'})]);
});

test('purchase-order account line description names every unlinked line until the QBO cap, then counts the rest',()=>{
  expect(qbPOAccountLineDescription(['CUSTOM Sublimated uniforms x2 @$30.00','PC54 Core Cotton Tee x12 @$3.10'],['SO-1','SO-2']))
    .toBe('Unlinked goods: CUSTOM Sublimated uniforms x2 @$30.00; PC54 Core Cotton Tee x12 @$3.10 (SO: SO-1, SO-2)');
  const parts=Array.from({length:60},(_,index)=>'SKU'+index+' Some long product name x1 @$1.00');
  const description=qbPOAccountLineDescription(parts,['SO-9']);
  expect(description.length).toBeLessThanOrEqual(QB_PO_ACCOUNT_LINE_DESCRIPTION_MAX);
  expect(description).toMatch(/; \+\d+ more lines \(SO: SO-9\)$/);
  expect(description.startsWith('Unlinked goods: SKU0 Some long product name x1 @$1.00; SKU1 ')).toBe(true);
});
