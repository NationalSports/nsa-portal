import {createQBSyncEngine} from '../qbSyncEngine';
import {QB_ACCOUNT_MAPPING_DEFAULTS,QB_ACCOUNT_SPECS} from '../qbAccountMappings';

const accounts=Object.values(QB_ACCOUNT_SPECS).map(spec=>({Id:spec.number,Name:spec.name,AcctNum:spec.number,AccountType:spec.types[0],Active:true}));
const customer={id:'C1',name:'Del Lago Academy',alpha_tag:'DLA',payment_terms:'net30'};
const qboCustomer={Id:'2380',DisplayName:'Del Lago Academy (DLA)',Active:true,SalesTermRef:{value:'30'}};
const customerApi=(readback=qboCustomer)=>jest.fn(async(action,{query}={})=>{
  if(action==='query'&&query.includes('FROM Term'))return {QueryResponse:{Term:[{Id:'30',Name:'Net 30',DueDays:30,Active:true}]}};
  if(action==='query'&&query.includes("WHERE Id = '2380'"))return {QueryResponse:{Customer:[readback]}};
  if(action==='query'&&query.includes('FROM Customer'))return {QueryResponse:{Customer:[qboCustomer]}};
  throw new Error('Unexpected QBO write or read: '+action);
});
function setup(extra={}){
  let config={realm_id:'9341456492604246',initialMigrationApproved:true,preflight:{status:'success',realm_id:'9341456492604246'},
    mapping:QB_ACCOUNT_MAPPING_DEFAULTS,custQBMap:{},prodQBMap:{},qbSOMap:{},qbPOMap:{},syncLog:[]};
  const persistQbLink=jest.fn(async()=>({}));
  const qbApi=customerApi();
  const engine=createQBSyncEngine({cust:[customer],sos:[],invs:[],prod:[],vend:[],invPOs:[],submittedBatches:[],qbApi,
    qbConfig:config,nf:jest.fn(),dP:()=>({sell:0}),setQbSyncing:jest.fn(),persistQbLink,
    setQBConfig:fn=>{config=fn(config);},...extra});
  return {engine,persistQbLink,qbApi,config:()=>config};
}

test('a verified customer is not reported linked when durable storage rejects the save',async()=>{
  const persistQbLink=jest.fn(async()=>{throw new Error('database unavailable');});
  const run=setup({persistQbLink});
  expect(await run.engine.syncCustomerCanary('C1')).toMatchObject({status:'blocked'});
  expect(run.config().custQBMap).toEqual({});
  expect(run.qbApi.mock.calls.every(([action])=>action==='query')).toBe(true);
});

test('inactive customer read-back never saves a success receipt',async()=>{
  const run=setup({qbApi:customerApi({...qboCustomer,Active:false})});
  expect(await run.engine.syncCustomerCanary('C1')).toMatchObject({status:'blocked'});
  expect(run.persistQbLink).not.toHaveBeenCalled();
});

test('retrying a customer is link-only and awaits a durable receipt each time',async()=>{
  const run=setup();
  for(let i=0;i<2;i++)expect(await run.engine.syncCustomerCanary('C1')).toMatchObject({status:'success',created:false,qbId:'2380'});
  expect(run.persistQbLink).toHaveBeenCalledTimes(2);
  expect(run.qbApi.mock.calls.every(([action])=>action==='query')).toBe(true);
});

test('existing SKU 0000 links all variants without rewriting the QBO item',async()=>{
  const item={Id:'183',Name:'0000',Sku:'0000',Type:'NonInventory',Active:true,IncomeAccountRef:{value:'40000'},ExpenseAccountRef:{value:'51300'}};
  const qbApi=jest.fn(async(action,{query}={})=>{
    if(action==='query'&&query.includes('FROM Account'))return {QueryResponse:{Account:accounts}};
    if(action==='query'&&query.includes('FROM Item'))return {QueryResponse:{Item:[item]}};
    throw new Error('Unexpected QBO write: '+action);
  });
  const run=setup({qbApi,prod:[{id:'P1',sku:'0000',name:'Test'},{id:'P2',sku:' 0000 ',name:'Variant'}]});
  await run.engine.syncInventory({canaryProductId:'P1'});
  expect(run.config().prodQBMap).toEqual({P1:'183',P2:'183'});
  expect(run.persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'prodQBMap',qboId:'183',sourceIds:['P1','P2']}));
  expect(qbApi.mock.calls.every(([action])=>action==='query')).toBe(true);
});

test('supplier-bill approval cannot unlock any migration batch or Sync Everything',async()=>{
  const run=setup();
  await run.engine.syncCustomers();await run.engine.syncInventory();await run.engine.syncSalesOrders();
  await run.engine.syncPurchaseOrders();await run.engine.syncAll();
  expect(run.qbApi).not.toHaveBeenCalled();
  expect(run.persistQbLink).not.toHaveBeenCalled();
});

test('missing durable saver blocks canaries before a QBO call',async()=>{
  const run=setup({persistQbLink:undefined});
  await run.engine.syncCustomerCanary('C1');
  await run.engine.syncInventory({canaryProductId:'P1'});
  await run.engine.syncSalesOrders({}, {}, {canarySOId:'SO-1'});
  await run.engine.syncPurchaseOrders({}, {canaryPOId:'PO-1'});
  expect(run.qbApi).not.toHaveBeenCalled();
});


test('a missing SKU match cannot create a replacement during link recovery',async()=>{
  const qbApi=jest.fn(async(action,{query}={})=>{
    if(action==='query'&&query.includes('FROM Account'))return {QueryResponse:{Account:accounts}};
    if(action==='query'&&query.includes('FROM Item'))return {QueryResponse:{Item:[]}};
    throw new Error('Unexpected QBO write: '+action);
  });
  const run=setup({qbApi,prod:[{id:'P1',sku:'0000',name:'Known historical item'}]});
  await run.engine.syncInventory({canaryProductId:'P1'});
  expect(run.config().prodQBMap).toEqual({});
  expect(run.persistQbLink).not.toHaveBeenCalled();
  expect(qbApi.mock.calls.every(([action])=>action==='query')).toBe(true);
  expect(run.config().syncLog[0].details.join(' ')).toMatch(/BLOCKED.*no active item matched/);
});
