import { createQBSyncEngine } from '../qbSyncEngine';
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
  const engine=createQBSyncEngine({
      persistQbLink:jest.fn(async()=>({})),
    cust,sos,invs,prod,vend,invPOs:[],submittedBatches:[],qbApi,qbConfig:config,nf:jest.fn(),
    dP:jest.fn(()=>({sell:0})),...setters,
  });
  return{engine,setters,getConfig:()=>config};
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
});
