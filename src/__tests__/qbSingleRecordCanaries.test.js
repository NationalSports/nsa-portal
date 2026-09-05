import { billReferencesPortalPO, buildQBBillPOReplacement, createQBSyncEngine, findQbPOBillCandidates, qbLinkedTransactions } from '../qbSyncEngine';
import { indexQBNonInventoryItems, QB_ACCOUNT_MAPPING_DEFAULTS, QB_ACCOUNT_SPECS } from '../qbAccountMappings';

const accountRows = Object.values(QB_ACCOUNT_SPECS).map((spec,index)=>({
  Id:String(index+1),Name:spec.name,FullyQualifiedName:spec.name,AcctNum:spec.number,
  AccountType:spec.types[0],Active:true,
}));
const accountId = number => String(Object.values(QB_ACCOUNT_SPECS).findIndex(spec=>spec.number===number)+1);

const makeEngine = ({qbApi,cust=[],sos=[],invs=[],prod=[],vend=[]}) => {
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
    dP:jest.fn(()=>({sell:0})),...setters,
  });
  return{engine,setters,persistQbLink,getConfig:()=>config};
};

const accountResponse = {QueryResponse:{Account:accountRows}};
const portalSalesItem = {Id:'SALES-ITEM',Name:'NSA Portal Sales',Type:'Service',Active:true,IncomeAccountRef:{value:accountId('40000')}};

describe('QuickBooks one-record canaries', () => {
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

  test('creates one PO without creating a vendor or item and verifies read-back', async() => {
    const so={id:'SO-1',items:[{product_id:'P1',sku:'SKU-1',name:'Test Jersey',brand:'Acme',nsa_cost:5,sizes:{S:2},po_lines:[{po_id:'PO-1',created_at:'2026-09-01',S:2,unit_cost:5}]}]};
    const readback={Id:'PO-QB',DocNumber:'PO-1',VendorRef:{value:'V-QB'},TotalAmt:10,TxnDate:'2026-09-01'};
    const qbApi=jest.fn(async(action,{query,purchase_order}={})=>{
      if(action==='query'&&query.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme',CompanyName:'Acme'}]}};
      if(action==='query'&&query.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order')return{PurchaseOrder:{Id:'PO-QB',...purchase_order}};
      if(action==='query'&&query.includes("FROM PurchaseOrder WHERE Id = 'PO-QB'"))return{QueryResponse:{PurchaseOrder:[readback]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine({qbApi,sos:[so],prod:[{id:'P1',sku:'SKU-1'}],vend:[{id:'V1',name:'Acme'}]});
    getConfig().prodQBMap.P1='I-1';
    await expect(engine.syncPurchaseOrders({}, {canaryPOId:'PO-1'})).resolves.toEqual({status:'success',synced:1});
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_purchase_order')).toHaveLength(1);
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_vendor'||action==='upsert_item')).toHaveLength(0);
    expect(getConfig().qbPOMap['PO-1']).toBe('PO-QB');
  });

  test('uses the saved PO line cost rounded to cents instead of a changed catalog cost', async() => {
    const so={id:'SO-1',items:[{product_id:'P1',sku:'SKU-1',name:'Test Jersey',brand:'Acme',nsa_cost:99.999,sizes:{S:1},po_lines:[{po_id:'PO-1',created_at:'2026-09-01',S:1,unit_cost:37.115}]}]};
    let sentPO;
    const qbApi=jest.fn(async(action,{query,purchase_order}={})=>{
      if(action==='query'&&query.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme',CompanyName:'Acme'}]}};
      if(action==='query'&&query.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(action==='query'&&query.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order'){sentPO=purchase_order;return{PurchaseOrder:{Id:'PO-QB',...purchase_order}}}
      if(action==='query'&&query.includes("FROM PurchaseOrder WHERE Id = 'PO-QB'"))return{QueryResponse:{PurchaseOrder:[{Id:'PO-QB',DocNumber:'PO-1',VendorRef:{value:'V-QB'},TotalAmt:37.12,TxnDate:'2026-09-01'}]}};
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

  test('runs only approved eligible POs and persists each verified batch record', async()=>{
    const makeItem=(id,sku,poId)=>({product_id:id,sku,name:sku,brand:'Acme',po_lines:[{po_id:poId,created_at:'2026-09-01',S:1,unit_cost:5}]});
    const sos=[{id:'SO-1',items:[makeItem('P1','SKU-1','PO-1'),makeItem('P2','SKU-2','PO-2'),makeItem('P3','SKU-3','PO-BLOCKED')]}];
    let next=0;
    const qbApi=jest.fn(async(action,{query,purchase_order}={})=>{
      if(query?.includes('FROM Vendor STARTPOSITION'))return{QueryResponse:{Vendor:[{Id:'V-QB',DisplayName:'Acme',CompanyName:'Acme'}]}};
      if(query?.includes('FROM PurchaseOrder STARTPOSITION'))return{QueryResponse:{PurchaseOrder:[]}};
      if(query?.includes('FROM Account'))return accountResponse;
      if(action==='upsert_purchase_order')return{PurchaseOrder:{Id:'NEW-'+(++next),...purchase_order}};
      if(query?.includes("FROM PurchaseOrder WHERE Id = 'NEW-")){
        const id=query.match(/Id = '([^']+)'/)[1],index=Number(id.split('-')[1])-1,poId=['PO-1','PO-2'][index];
        return{QueryResponse:{PurchaseOrder:[{Id:id,DocNumber:poId,VendorRef:{value:'V-QB'},TotalAmt:5,TxnDate:'2026-09-01'}]}};
      }
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig,persistQbLink}=makeEngine({qbApi,sos,prod:[{id:'P1',sku:'SKU-1'},{id:'P2',sku:'SKU-2'},{id:'P3',sku:'SKU-3'}],vend:[{id:'V1',name:'Acme'}]});
    getConfig().initialMigrationApproved=true;getConfig().prodQBMap={P1:'I-1',P2:'I-2'};
    await expect(engine.syncPurchaseOrders({}, {approved:true})).resolves.toEqual({status:'success',synced:2});
    expect(persistQbLink).toHaveBeenCalledTimes(2);
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_vendor')).toHaveLength(0);
    expect(getConfig().qbPOMap).toEqual({'PO-1':'NEW-1','PO-2':'NEW-2'});
    expect(getConfig().syncLog[0].details[0]).toContain('1 blocked before batch');
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
