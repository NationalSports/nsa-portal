import {mergeQBSyncLogs, mergeDurableQBLinks, persistVerifiedQBLink, qbLinkKey, QB_LINK_MAPS} from '../qbLinkLedger';

function database() {
  const rows = new Map();
  const client = {from:jest.fn(() => {
    let changes, filters = [];
    const query = {
      select:() => query,
      eq:(key,value) => {filters.push([key,value]);return query;},
      maybeSingle:async() => ({data:[...rows.values()].find(row => filters.every(([k,v])=>row[k]===v)) || null}),
      upsert:async(row) => {if(!rows.has(row.id))rows.set(row.id,{...row});return {};},
      update:row => {changes=row;return query;},
      then:resolve => {
        const old = [...rows.values()].find(row => filters.every(([k,v])=>row[k]===v));
        if(old)rows.set(old.id,{...old,...changes});
        return Promise.resolve({}).then(resolve);
      },
    };
    return query;
  })};
  return {client,rows};
}
const record = (mapKey='custQBMap',extra={}) => ({realmId:'9341456492604246',mapKey,sourceIds:['source-1'],qboId:'2380',
  log:{ts:'2026-09-05T12:00:00Z',type:'canary',status:'success',details:['API read-back verified']},evidence:{api_readback:true},...extra});

test('all durable maps and their evidence survive replacement of qb_config and a fresh load',async()=>{
  const {client,rows}=database();
  for(const mapKey of QB_LINK_MAPS)await persistVerifiedQBLink(client,record(mapKey));
  const reloaded=mergeDurableQBLinks({realm_id:record().realmId,syncLog:[]},Object.fromEntries([...rows].map(([k,row])=>[k,row.value])));
  QB_LINK_MAPS.forEach(key=>expect(reloaded[key]).toEqual({'source-1':'2380'}));
  expect(reloaded.syncLog).toHaveLength(QB_LINK_MAPS.length);
  expect(reloaded.syncLog.every(log=>log.status==='success')).toBe(true);
  const otherRealm=mergeDurableQBLinks({realm_id:'other'},Object.fromEntries([...rows].map(([k,row])=>[k,row.value])));
  QB_LINK_MAPS.forEach(key=>expect(otherRealm[key]).toEqual({}));
});

test('conflicting IDs cannot overwrite a verified link',async()=>{
  const {client,rows}=database();
  await persistVerifiedQBLink(client,record());
  await expect(persistVerifiedQBLink(client,record('custQBMap',{qboId:'999'}))).rejects.toThrow('Conflicting');
  expect(JSON.parse([...rows.values()][0].value).qbo_id).toBe('2380');
});

test('database failure cannot produce a successful receipt',async()=>{
  const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({error:{message:'offline'}})})})})};
  await expect(persistVerifiedQBLink(client,record())).rejects.toThrow('offline');
  await expect(persistVerifiedQBLink(null,record())).rejects.toThrow('unavailable');
});

test('silent zero-row writes fail database read-back',async()=>{
  const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})}),upsert:async()=>({})})};
  await expect(persistVerifiedQBLink(client,record())).rejects.toThrow('database read-back');
});

test('variant links share an item, and cleanup tombstones survive stale configuration reloads',async()=>{
  const {client,rows}=database();
  const product=record('prodQBMap',{qboId:'183',sourceIds:['variant/a','variant_b']});
  await persistVerifiedQBLink(client,product);
  await persistVerifiedQBLink(client,{...product,active:false});
  const appState=Object.fromEntries([...rows].map(([k,row])=>[k,row.value]));
  const loaded=mergeDurableQBLinks({realm_id:product.realmId,prodQBMap:{'variant/a':'183',variant_b:'183'}},appState);
  expect(loaded.prodQBMap).toEqual({});
  await expect(persistVerifiedQBLink(client,product)).rejects.toThrow('stale retry');
  await persistVerifiedQBLink(client,{...product,qboId:'184'});
  expect(JSON.parse(rows.get(qbLinkKey(product.realmId,'prodQBMap','variant/a')).value).qbo_id).toBe('184');
});

test('source key encoding does not collapse punctuation into a collision',()=>{
  expect(qbLinkKey('realm','qbPOMap','PO/A')).not.toBe(qbLinkKey('realm','qbPOMap','PO_A'));
});


test('read-back-verified cleanup tombstones a legacy link without a prior receipt',async()=>{
  const {client,rows}=database();
  const product=record('prodQBMap',{qboId:'183',active:false});
  await persistVerifiedQBLink(client,product);
  const loaded=mergeDurableQBLinks({realm_id:product.realmId,prodQBMap:{'source-1':'183'}},
    Object.fromEntries([...rows].map(([k,row])=>[k,row.value])));
  expect(loaded.prodQBMap).toEqual({});
});


test('receipt and original success log appear once before and after reload', async()=>{
  const {client,rows}=database();
  const input=record();
  const saved=await persistVerifiedQBLink(client,input);
  const first=mergeDurableQBLinks({realm_id:input.realmId},saved);
  const immediate=mergeQBSyncLogs([input.log,...first.syncLog]);
  expect(immediate).toHaveLength(1);
  expect(immediate[0].id).toBeTruthy();
  const reloaded=mergeDurableQBLinks({realm_id:input.realmId,syncLog:[input.log,...first.syncLog]},
    Object.fromEntries([...rows].map(([k,row])=>[k,row.value])));
  expect(reloaded.syncLog).toEqual(immediate);
  expect(mergeQBSyncLogs([{...immediate[0],id:'other'},...immediate])).toHaveLength(2);
});


test('one-item summary and receipt display a single verified result',()=>{
  const event={ts:'2026-09-05T15:08:00Z',type:'item_canary',status:'success',details:['LINK ONLY 0000 #263','READ-BACK VERIFIED']};
  const receipt={...event,id:'receipt-263',verified_at:'2026-09-05T15:08:19Z'};
  const summary={...event,details:['1/1 item canary · 10369 remain unlinked',...event.details]};
  expect(mergeQBSyncLogs([summary,receipt])).toEqual([receipt]);
  expect(mergeQBSyncLogs([{...summary,status:'partial'},receipt])).toHaveLength(2);
});

describe('term-canary proof survives syncLog eviction',()=>{
  const {mergeDurableQBLinks}=require('../qbLinkLedger');
  const receipt=(overrides={})=>JSON.stringify({realm_id:'r1',map_key:'custQBMap',source_id:'C1',qbo_id:'486',
    verified_at:'2026-09-05T17:41:00.000Z',active:true,evidence:{result:'updated'},...overrides});
  const keyFor=(map,source)=>'_qb_link_v1_'+encodeURIComponent(JSON.stringify(['r1',map,source]));

  test('an updated-terms receipt records the proof even with no matching log entry',()=>{
    const merged=mergeDurableQBLinks({realm_id:'r1',syncLog:[]},{[keyFor('custQBMap','C1')]:receipt()});
    expect(merged.custTermCanaryVerifiedAt).toBe('2026-09-05T17:41:00.000Z');
    expect(merged.custQBMap.C1).toBe('486');
  });
  test('only a customer receipt that actually updated terms counts, and not a removed one',()=>{
    expect(mergeDurableQBLinks({realm_id:'r1'},{[keyFor('custQBMap','C1')]:receipt({evidence:{result:'linked'}})})
      .custTermCanaryVerifiedAt).toBeUndefined();
    expect(mergeDurableQBLinks({realm_id:'r1'},{[keyFor('custQBMap','C1')]:receipt({active:false})})
      .custTermCanaryVerifiedAt).toBeUndefined();
    expect(mergeDurableQBLinks({realm_id:'r1'},{[keyFor('prodQBMap','P1')]:receipt({map_key:'prodQBMap',source_id:'P1'})})
      .custTermCanaryVerifiedAt).toBeUndefined();
  });
  test('the most recent proof wins and a foreign realm contributes none',()=>{
    const merged=mergeDurableQBLinks({realm_id:'r1'},{
      [keyFor('custQBMap','C1')]:receipt(),
      [keyFor('custQBMap','C2')]:receipt({source_id:'C2',qbo_id:'487',verified_at:'2026-09-06T01:00:00.000Z'}),
    });
    expect(merged.custTermCanaryVerifiedAt).toBe('2026-09-06T01:00:00.000Z');
    expect(mergeDurableQBLinks({realm_id:'other'},{[keyFor('custQBMap','C1')]:receipt()})
      .custTermCanaryVerifiedAt).toBeUndefined();
  });
});
