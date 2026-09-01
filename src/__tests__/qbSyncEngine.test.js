import { createQBSyncEngine, findExactQBCustomerMatches, groupPortalPurchaseOrders, portalCustomerDisplayName, rotatingBatch } from '../qbSyncEngine';

describe('QuickBooks rotating batches', () => {
  test('moves past a permanently blocked first batch', () => {
    const records=Array.from({length:45},(_,i)=>i+1);
    const first=rotatingBatch(records,0,20);
    const second=rotatingBatch(records,first.nextOffset,20);
    const third=rotatingBatch(records,second.nextOffset,20);
    expect(first.items).toEqual(Array.from({length:20},(_,i)=>i+1));
    expect(second.items).toEqual(Array.from({length:20},(_,i)=>i+21));
    expect(third.items.slice(0,5)).toEqual([41,42,43,44,45]);
  });

  test('wraps safely when successful records disappear between runs', () => {
    const first=rotatingBatch(Array.from({length:30},(_,i)=>i+1),0,20);
    const remaining=Array.from({length:10},(_,i)=>i+21);
    const second=rotatingBatch(remaining,first.nextOffset,20);
    expect(second.items).toEqual(remaining);
    expect(second.nextOffset).toBe(0);
  });

  test('handles invalid cursors without dropping records', () => {
    expect(rotatingBatch(['a','b','c'],Number.NaN,2)).toEqual({items:['a','b'],nextOffset:2});
    expect(rotatingBatch([],99,20)).toEqual({items:[],nextOffset:0});
  });
});

describe('QuickBooks purchase-order grouping', () => {
  const so=(id,poLines)=>({id,items:[{sku:'SKU-'+id,name:'Item '+id,brand:'Champro',po_lines:poLines}]});

  test('shows one preview/posting group for a PO spread across several source lines', () => {
    const groups=groupPortalPurchaseOrders([
      so('SO-1',[{po_id:'PO 5550',S:2,created_at:'2026-09-01'}]),
      so('SO-2',[{po_id:'PO 5550',M:3,created_at:'2026-09-01'}]),
    ],{});
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({poId:'PO 5550',vendor:'Champro',accountKey:'purchases_account',invalidReason:''});
    expect(groups[0].entries).toHaveLength(2);
  });

  test('blocks a shared PO number that mixes vendors', () => {
    const groups=groupPortalPurchaseOrders([
      so('SO-1',[{po_id:'PO MIXED',S:1,vendor:'Champro'}]),
      {...so('SO-2',[{po_id:'PO MIXED',M:1,vendor:'Adidas'}]),items:[{sku:'SKU-2',name:'Item 2',brand:'Adidas',po_lines:[{po_id:'PO MIXED',M:1}]}]},
    ],{});
    expect(groups[0].invalidReason).toBe('mixed vendors share this PO number');
  });

  test('blocks a shared PO number that mixes product and decoration routing', () => {
    const groups=groupPortalPurchaseOrders([
      so('SO-1',[{po_id:'PO MIXED',S:1}]),
      so('SO-2',[{po_id:'PO MIXED',M:1,po_type:'outside_deco',deco_vendor:'Champro'}]),
    ],{});
    expect(groups[0].invalidReason).toBe('merchandise and outside-decoration lines share this PO number');
  });
});

describe('QuickBooks one-customer canary', () => {
  const portalCustomer={id:'C1',name:'West Valley College Baseball',alpha_tag:'WVCBS',is_active:true,payment_terms:'net30'};
  const makeEngine=qbApi=>{
    let config={realm_id:'9341',preflight:{status:'success',realm_id:'9341'},custQBMap:{},syncLog:[]};
    const setQBConfig=jest.fn(updater=>{config=typeof updater==='function'?updater(config):updater});
    const engine=createQBSyncEngine({
      cust:[portalCustomer],sos:[],invs:[],prod:[],vend:[],invPOs:[],submittedBatches:[],qbApi,qbConfig:config,nf:jest.fn(),dP:jest.fn(),
      setQBConfig,setQbSyncing:jest.fn(),setInvs:jest.fn(),setInvPOs:jest.fn(),setSOs:jest.fn(),setSubmittedBatches:jest.fn(),setVend:jest.fn(),
    });
    return{engine,getConfig:()=>config,setQBConfig};
  };

  test('matches names exactly after case and spacing normalization, without fuzzy guessing', () => {
    const matches=findExactQBCustomerMatches(portalCustomer,[
      {Id:'10',DisplayName:'  WEST VALLEY COLLEGE BASEBALL   (WVCBS) ',Active:true},
      {Id:'11',DisplayName:'West Valley College Baseball Alumni',Active:true},
      {Id:'12',CompanyName:'West Valley College Baseball',Active:false},
    ]);
    expect(matches.map(row=>row.Id)).toEqual(['10']);
  });

  test('trims hidden customer whitespace for the selector label and sorting key', () => {
    expect(portalCustomerDisplayName({name:' Del Lago Academy ',alpha_tag:' DLA '})).toBe('Del Lago Academy (DLA)');
  });

  test('links and reads back one exact existing customer without a QBO write', async() => {
    const existing={Id:'123',DisplayName:'West Valley College Baseball (WVCBS)',CompanyName:'West Valley College Baseball',Active:true,SyncToken:'2',SalesTermRef:{value:'3',name:'Net 30'}};
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(action==='query'&&query.includes('STARTPOSITION'))return{QueryResponse:{Customer:[existing]}};
      if(action==='query'&&query.includes("WHERE Id = '123'"))return{QueryResponse:{Customer:[existing]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine(qbApi);
    const result=await engine.syncCustomerCanary('C1');
    expect(result).toMatchObject({status:'success',created:false,qbId:'123'});
    expect(qbApi).not.toHaveBeenCalledWith('upsert_customer',expect.anything());
    expect(getConfig().custQBMap.C1).toBe('123');
  });

  test('requires a second explicitly approved call before creating one customer', async() => {
    const created={Id:'456',DisplayName:'West Valley College Baseball (WVCBS)',CompanyName:'West Valley College Baseball',Active:true};
    const qbApi=jest.fn(async(action,{query}={})=>{
      if(action==='query'&&query.includes('STARTPOSITION'))return{QueryResponse:{Customer:[]}};
      if(action==='upsert_customer')return{Customer:created};
      if(action==='query'&&query.includes("WHERE Id = '456'"))return{QueryResponse:{Customer:[created]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    const{engine,getConfig}=makeEngine(qbApi);
    await expect(engine.syncCustomerCanary('C1')).resolves.toMatchObject({status:'needs_confirmation'});
    expect(qbApi).not.toHaveBeenCalledWith('upsert_customer',expect.anything());
    await expect(engine.syncCustomerCanary('C1',{allowCreate:true})).resolves.toMatchObject({status:'success',created:true,qbId:'456'});
    expect(qbApi).toHaveBeenCalledTimes(4);
    expect(getConfig().custQBMap.C1).toBe('456');
  });

  test('blocks ambiguous exact matches without linking or writing', async() => {
    const qbApi=jest.fn(async()=>({QueryResponse:{Customer:[
      {Id:'700',DisplayName:'West Valley College Baseball',Active:true},
      {Id:'701',DisplayName:'West Valley College Baseball (WVCBS)',Active:true},
    ]}}));
    const{engine,getConfig}=makeEngine(qbApi);
    await expect(engine.syncCustomerCanary('C1')).resolves.toMatchObject({status:'blocked'});
    expect(qbApi).toHaveBeenCalledTimes(1);
    expect(getConfig().custQBMap.C1).toBeUndefined();
  });
});
