import {createQBSyncEngine} from '../qbSyncEngine';
import {QB_ACCOUNT_MAPPING_DEFAULTS, QB_ACCOUNT_SPECS} from '../qbAccountMappings';
import {buildQBInventoryValuation, buildQBInventoryValuationEntry, verifyQBInventoryValuationReadback} from '../qbInventoryValuation';

const accountRows=Object.values(QB_ACCOUNT_SPECS).map((spec,index)=>({
  Id:String(index+1),AcctNum:spec.number,Name:spec.name,FullyQualifiedName:spec.name,AccountType:spec.types[0],Active:true,CurrentBalance:0,
}));
const accountId=number=>String(Object.values(QB_ACCOUNT_SPECS).findIndex(spec=>spec.number===number)+1);
const ASSET=accountId(QB_ACCOUNT_MAPPING_DEFAULTS.inventory_asset_account), COGS=accountId(QB_ACCOUNT_MAPPING_DEFAULTS.cogs_account);

// Live shape: product_inventory quantities arrive on products as _inv {size: qty}.
const products=[
  {id:'P1',sku:'ST350',name:'Competitor Tee',nsa_cost:5.5,_inv:{S:10,M:20,L:0}},
  {id:'P2',sku:'PC78H',name:'Core Fleece Hoodie',nsa_cost:12,size_costs:{'2XL':14},_inv:{L:3,'2XL':2}},
  {id:'P3',sku:'NOCOST',name:'Unpriced',nsa_cost:0,_inv:{M:7}},
  {id:'P4',sku:'NEG',name:'Damaged count',nsa_cost:4,_inv:{S:-2,M:1}},
  {id:'P5',sku:'GONE',name:'Deleted',nsa_cost:9,deleted_at:'2026-01-01',_inv:{M:50}},
];

describe('inventory valuation arithmetic', () => {
  test('values stock at size cost, then catalog cost, and reports what it cannot value', () => {
    const valuation=buildQBInventoryValuation(products,{asOf:'2026-09-07'});
    expect(valuation).toEqual(expect.objectContaining({asOf:'2026-09-07',products:3,units:36,value:233,unpricedUnits:7}));
    // 30 × 5.50 = 165; 3 × 12 + 2 × 14 = 64; NEG M 1 × 4 = 4 → 233
    expect(valuation.rows.map(row=>[row.sku,row.units,row.value])).toEqual([['ST350',30,165],['PC78H',5,64],['NEG',1,4]]);
    expect(valuation.unpriced).toEqual([{productId:'P3',sku:'NOCOST',name:'Unpriced',units:7}]);
    expect(valuation.negative).toEqual([{sku:'NEG',size:'S',quantity:-2}]);
  });

  test('debits the asset when the portal holds more than QBO shows, credits it when less, and posts nothing when equal', () => {
    const valuation=buildQBInventoryValuation(products,{asOf:'2026-09-07'});
    const refs={inventoryAssetRef:{value:ASSET},cogsRef:{value:COGS}};
    const up=buildQBInventoryValuationEntry({valuation,currentBalance:100,...refs});
    expect(up).toEqual(expect.objectContaining({DocNumber:'INV-VAL-2026-09-07',TxnDate:'2026-09-07',_delta:133}));
    expect(up.Line.map(line=>[line.JournalEntryLineDetail.PostingType,line.JournalEntryLineDetail.AccountRef.value,line.Amount])).toEqual([['Debit',ASSET,133],['Credit',COGS,133]]);
    expect(up.Line[0].Description).toMatch(/36 units across 3 products valued at \$233\.00 \(QBO balance before: \$100\.00\); 7 units excluded for missing cost/);
    const down=buildQBInventoryValuationEntry({valuation,currentBalance:300,...refs});
    expect(down.Line.map(line=>[line.JournalEntryLineDetail.PostingType,line.JournalEntryLineDetail.AccountRef.value,line.Amount])).toEqual([['Debit',COGS,67],['Credit',ASSET,67]]);
    expect(buildQBInventoryValuationEntry({valuation,currentBalance:233.004,...refs})).toBeNull();
    expect(()=>buildQBInventoryValuationEntry({valuation,currentBalance:0,inventoryAssetRef:{value:ASSET}})).toThrow(/accounts are required/);
  });

  test('read-back verification is order-independent and rejects any changed line', () => {
    const payload={DocNumber:'INV-VAL-2026-09-07',TxnDate:'2026-09-07',Line:[
      {DetailType:'JournalEntryLineDetail',Amount:133,JournalEntryLineDetail:{PostingType:'Debit',AccountRef:{value:ASSET}}},
      {DetailType:'JournalEntryLineDetail',Amount:133,JournalEntryLineDetail:{PostingType:'Credit',AccountRef:{value:COGS}}}]};
    const good={Id:'JE-1',DocNumber:'INV-VAL-2026-09-07',TxnDate:'2026-09-07',Line:[payload.Line[1],payload.Line[0]]};
    expect(verifyQBInventoryValuationReadback(good,payload)).toBe(good);
    expect(()=>verifyQBInventoryValuationReadback({...good,DocNumber:'OTHER'},payload)).toThrow(/document number/);
    expect(()=>verifyQBInventoryValuationReadback({...good,TxnDate:'2026-09-08'},payload)).toThrow(/date/);
    expect(()=>verifyQBInventoryValuationReadback({...good,Line:[payload.Line[0],{...payload.Line[1],Amount:132}]},payload)).toThrow(/differ/);
    expect(()=>verifyQBInventoryValuationReadback(null,payload)).toThrow(/not returned/);
  });
});

describe('inventory valuation engine', () => {
  const makeEngine=({qbApi,prod=products})=>{
    let config={realm_id:'9341',preflight:{status:'success',realm_id:'9341'},mapping:{...QB_ACCOUNT_MAPPING_DEFAULTS},
      custQBMap:{},prodQBMap:{},qbSOMap:{},qbPOMap:{},syncLog:[]};
    const setQBConfig=jest.fn(updater=>{config=typeof updater==='function'?updater(config):updater});
    const persistQbLink=jest.fn(async()=>({}));
    const engine=createQBSyncEngine({persistQbLink,cust:[],sos:[],invs:[],prod,vend:[],invPOs:[],submittedBatches:[],qbApi,qbConfig:config,nf:jest.fn(),dP:jest.fn(),
      setQBConfig,setQbSyncing:jest.fn(),setInvs:jest.fn(),setInvPOs:jest.fn(),setSOs:jest.fn(),setSubmittedBatches:jest.fn(),setVend:jest.fn()});
    return{engine,persistQbLink,getConfig:()=>config};
  };
  const api=({balance=100,existing=[],readback}={})=>{
    let sent=null;
    const fn=jest.fn(async(action,{query,journalentry}={})=>{
      if(action==='query'&&query.includes('FROM Account WHERE Id'))return{QueryResponse:{Account:[{...accountRows[Number(ASSET)-1],CurrentBalance:balance}]}};
      if(action==='query'&&query.includes('FROM Account'))return{QueryResponse:{Account:accountRows}};
      if(action==='query'&&query.includes("FROM JournalEntry WHERE DocNumber"))return{QueryResponse:{JournalEntry:existing}};
      if(action==='upsert_journalentry'){sent=journalentry;return{JournalEntry:{Id:'JE-9',...journalentry}}}
      if(action==='query'&&query.includes("FROM JournalEntry WHERE Id = 'JE-9'"))return{QueryResponse:{JournalEntry:[readback||{Id:'JE-9',...sent}]}};
      throw new Error('Unexpected QBO call: '+action+' '+query);
    });
    fn.sent=()=>sent;
    return fn;
  };

  test('review reports the value and adjustment without writing', async() => {
    const qbApi=api();
    const{engine,persistQbLink}=makeEngine({qbApi});
    const result=await engine.syncInventoryValuation({approved:false,asOf:'2026-09-07'});
    expect(result).toEqual(expect.objectContaining({status:'needs_confirmation',docNumber:'INV-VAL-2026-09-07',value:233,units:36,products:3,currentBalance:100,delta:133,unpricedUnits:7,unpricedCount:1}));
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_journalentry')).toHaveLength(0);
    expect(persistQbLink).not.toHaveBeenCalled();
  });

  test('posts exactly one balanced entry, reads it back, and records a durable receipt', async() => {
    const qbApi=api();
    const{engine,persistQbLink,getConfig}=makeEngine({qbApi});
    const result=await engine.syncInventoryValuation({approved:true,asOf:'2026-09-07',expectedDelta:133});
    expect(result).toEqual(expect.objectContaining({status:'success',qboId:'JE-9',delta:133}));
    expect(qbApi.sent()).toEqual(expect.objectContaining({DocNumber:'INV-VAL-2026-09-07',TxnDate:'2026-09-07'}));
    expect(qbApi.sent()._delta).toBeUndefined();
    expect(qbApi.sent().Line.map(line=>[line.JournalEntryLineDetail.PostingType,line.JournalEntryLineDetail.AccountRef.value,line.Amount])).toEqual([['Debit',ASSET,133],['Credit',COGS,133]]);
    expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'qbInventoryValuationMap',sourceIds:['INV-VAL-2026-09-07'],qboId:'JE-9',
      evidence:expect.objectContaining({value:233,balance_before:100,delta:133,unpriced_units:7,api_readback:true})}));
    expect(getConfig().lastInventoryValuation).toEqual(expect.objectContaining({status:'posted',qboId:'JE-9',value:233}));
  });

  test('does not save a receipt when the read-back differs from the reviewed entry', async() => {
    const qbApi=api({readback:{Id:'JE-9',DocNumber:'INV-VAL-2026-09-07',TxnDate:'2026-09-07',Line:[
      {DetailType:'JournalEntryLineDetail',Amount:133,JournalEntryLineDetail:{PostingType:'Debit',AccountRef:{value:ASSET}}},
      {DetailType:'JournalEntryLineDetail',Amount:133,JournalEntryLineDetail:{PostingType:'Credit',AccountRef:{value:'999'}}}]}});
    const{engine,persistQbLink}=makeEngine({qbApi});
    const result=await engine.syncInventoryValuation({approved:true,asOf:'2026-09-07',expectedDelta:133});
    expect(result).toEqual(expect.objectContaining({status:'blocked',error:expect.stringMatching(/differ/)}));
    expect(persistQbLink).not.toHaveBeenCalled();
  });

  test('refuses a second entry for the same day and a post whose adjustment moved since review', async() => {
    const dup=api({existing:[{Id:'JE-1',DocNumber:'INV-VAL-2026-09-07'}]});
    const first=makeEngine({qbApi:dup});
    expect(await first.engine.syncInventoryValuation({approved:true,asOf:'2026-09-07',expectedDelta:133})).toEqual(expect.objectContaining({status:'blocked',error:expect.stringMatching(/already holds journal entry INV-VAL-2026-09-07 \(#JE-1\)/)}));
    expect(dup.mock.calls.filter(([action])=>action==='upsert_journalentry')).toHaveLength(0);
    const moved=api();
    const second=makeEngine({qbApi:moved});
    expect(await second.engine.syncInventoryValuation({approved:true,asOf:'2026-09-07',expectedDelta:120})).toEqual(expect.objectContaining({status:'blocked',error:expect.stringMatching(/changed since it was reviewed/)}));
    expect(moved.mock.calls.filter(([action])=>action==='upsert_journalentry')).toHaveLength(0);
  });

  test('reports unchanged and posts nothing when QBO already matches the portal value', async() => {
    const qbApi=api({balance:233});
    const{engine,persistQbLink,getConfig}=makeEngine({qbApi});
    expect(await engine.syncInventoryValuation({approved:true,asOf:'2026-09-07'})).toEqual(expect.objectContaining({status:'unchanged',delta:0}));
    expect(qbApi.mock.calls.filter(([action])=>action==='upsert_journalentry')).toHaveLength(0);
    expect(persistQbLink).not.toHaveBeenCalled();
    expect(getConfig().lastInventoryValuation.status).toBe('unchanged');
  });
});
