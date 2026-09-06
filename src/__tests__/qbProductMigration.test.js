import {buildQBProductManifest,runQBProductMigration} from '../qbProductMigration';
const refs={income_account:{value:'sales'},purchases_account:{value:'purchases'}};
const item={Id:'10',Name:'SKU',Sku:'SKU',Active:true,Type:'NonInventory',IncomeAccountRef:refs.income_account,ExpenseAccountRef:refs.purchases_account};
test('groups normalized variants and blocks duplicate, inactive, type and routing conflicts',()=>{
  const products=[{id:'a',sku:'sku'},{id:'b',sku:' SKU '}];
  expect(buildQBProductManifest(products,[item],{},refs)[0]).toMatchObject({sku:'SKU',action:'link',sourceIds:['a','b'],qboId:'10'});
  for(const items of [[item,{...item,Id:'11'}],[{...item,Active:false}],[{...item,Type:'Inventory'}],[{...item,ExpenseAccountRef:{value:'wrong'}}]])expect(buildQBProductManifest(products,items,{},refs)[0].action).toBe('blocked');
  expect(buildQBProductManifest(products,[item],{a:'10',b:'11'},refs)[0].action).toBe('blocked');
});
function setup({failSave=false,stale=false}={}){
  const products=[{id:'a',sku:'SKU'},{id:'b',sku:' sku '},{id:'c',sku:'NEW'}];
  const items=[{...item}];
  let config={realm_id:'realm',prodQBMap:{},syncLog:[{type:'item_canary',status:'success',details:['CREATED: example','LINK ONLY example']}]};
  const manifest={realm:'realm',reviewedAt:new Date().toISOString(),rows:buildQBProductManifest(products,items,{},refs)};
  if(stale)items[0].ExpenseAccountRef={value:'wrong'};
  const qbApi=jest.fn(async(action,{item:payload}={})=>{
    if(action==='query')return{QueryResponse:{Item:items}};
    if(action==='upsert_item'){const saved={...payload,Id:'11',Active:true};items.push(saved);return{Item:saved};}
    throw new Error(action);
  });
  const persistQbLink=jest.fn(async()=>{if(failSave)throw new Error('receipt save failed');});
  const setQbSyncing=jest.fn();
  return{manifest,qbApi,persistQbLink,setQbSyncing,getConfig:()=>config,run:options=>runQBProductMigration({options,products,config,qbApi,requiredAccountRefs:async()=>refs,verifyReadback:async(_,id)=>items.find(i=>i.Id===id),persistQbLink,setQbSyncing,setQBConfig:fn=>{config=fn(config)},nf:jest.fn()})};
}
test('links all variants before creating a minimal noninventory item and saves every receipt',async()=>{
  const s=setup();const r=await s.run({approved:true,manifest:s.manifest});
  expect(r.counts).toMatchObject({linked:1,created:1,blocked:0});
  expect(s.getConfig().prodQBMap).toEqual({a:'10',b:'10',c:'11'});
  expect(s.persistQbLink.mock.calls[0][0]).toMatchObject({sourceIds:['a','b'],qboId:'10',evidence:{batch_id:r.id,no_inventory:true}});
  const writes=s.qbApi.mock.calls.filter(([action])=>action==='upsert_item');
  expect(writes).toHaveLength(1);expect(writes[0][1].item).toEqual({Name:'NEW',Sku:'NEW',Type:'NonInventory',IncomeAccountRef:refs.income_account,ExpenseAccountRef:refs.purchases_account});
  expect(s.setQbSyncing.mock.calls).toEqual([[true],[false]]);
});
test.each([{failSave:true},{stale:true}])('stops remaining SKU writes when verification or receipt fails: %j',async opts=>{
  const s=setup(opts);const r=await s.run({approved:true,manifest:s.manifest});
  expect(r.counts).toMatchObject({blocked:1,not_attempted:1});
  expect(s.qbApi.mock.calls.some(([a])=>a==='upsert_item')).toBe(false);
  expect(s.getConfig().prodQBMap).toEqual({});
});
test.each(['approval','realm','age','size'])('blocks invalid batch %s before API access',async kind=>{
  const s=setup(),manifest={...s.manifest};let approved=true;
  if(kind==='approval')approved=false;
  if(kind==='realm')manifest.realm='other';
  if(kind==='age')manifest.reviewedAt='2020-01-01';
  if(kind==='size')manifest.rows=Array.from({length:require('../qbAccountMappings').QB_MAX_REVIEWED_BATCH+1},(_,i)=>({...manifest.rows[0],sku:String(i)}));
  expect(await s.run({approved,manifest})).toEqual({status:'blocked'});expect(s.qbApi).not.toHaveBeenCalled();
});

describe('product batch readiness is visible before the click',()=>{
  const {qbProductBatchReadiness}=require('../qbProductMigration');
  const link={type:'item_canary',status:'success',details:['LINK ONLY — no QBO item was changed: KJ3320 → QBO Item #230']};
  const create={type:'item_canary',status:'success',details:['CREATED: 0000 → QBO Item #263']};

  test('the live state reads as link-proven but creation-missing',()=>{
    // 13 link-only canaries, zero creations: exactly the production config today.
    expect(qbProductBatchReadiness({syncLog:Array(13).fill(link)}))
      .toEqual({linked:true,created:false,ready:false});
  });
  test('both halves proven is ready',()=>{
    expect(qbProductBatchReadiness({syncLog:[link,create]})).toEqual({linked:true,created:true,ready:true});
  });
  test('durable receipts satisfy it once the log has aged the canaries out',()=>{
    expect(qbProductBatchReadiness({syncLog:[],prodLinkCanaryVerifiedAt:'2026-09-05T17:52:00.000Z',
      prodCreateCanaryVerifiedAt:'2026-09-05T15:08:19.145Z'})).toEqual({linked:true,created:true,ready:true});
  });
  test('a failed canary and an empty config prove nothing',()=>{
    expect(qbProductBatchReadiness({syncLog:[{...link,status:'error'},{...create,status:'error'}]}))
      .toEqual({linked:false,created:false,ready:false});
    expect(qbProductBatchReadiness({})).toEqual({linked:false,created:false,ready:false});
  });
});
