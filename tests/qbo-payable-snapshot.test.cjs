const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ENTITIES,hash,retryRead,acquireSnapshot,validate}=require('../netlify/functions/_qboPayableSnapshot');
const {runPayableReview}=require('../netlify/functions/_qboPayableServerReview');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
  let manifest;const pages=new Map(),calls=[];
  const data=Object.fromEntries(ENTITIES.map(entity=>[entity,[]]));
  data.Vendor=Array.from({length:501},(_,i)=>({Id:String(i+1)}));
  const store={load:async()=>clone(manifest),save:async value=>{manifest=clone(value)},page:async(id,entity,page)=>pages.get(entity+page),savePage:async(id,entity,page,value)=>{pages.set(entity+page,clone(value))}};
  const read=async sql=>{calls.push(sql);const entity=sql.match(/FROM (\w+)/)[1];if(sql.includes('COUNT'))return{totalCount:data[entity].length};const start=Number(sql.match(/STARTPOSITION (\d+)/)[1]);return{[entity]:data[entity].slice(start-1,start+499)}};
  const portalSnapshot=async()=>({ledger:[],portalVendors:[],links:{},products:[],salesOrders:[],soItems:[],poLines:[],qbConfig:{}});
  return{store,read,data,calls,pages,portalSnapshot,realm:'123',retryOptions:{sleep:async()=>{}},get manifest(){return manifest}};
}
test('retries transient failures only, with bounded exponential backoff',async()=>{
  let calls=0;const delays=[];
  assert.equal(await retryRead(async()=>{if(++calls<4)throw Object.assign(new Error('transient'),{status:429});return 'ok'},{sleep:async ms=>delays.push(ms),random:()=>0}),'ok');
  assert.deepEqual(delays,[500,1000,2000]);
  calls=0;await assert.rejects(retryRead(async()=>{calls++;throw Object.assign(new Error('bad'),{status:400})}),/bad/);assert.equal(calls,1);
  calls=0;await assert.rejects(retryRead(async()=>{calls++;throw Object.assign(new Error('down'),{status:503})},{sleep:async()=>{}}),/down/);assert.equal(calls,4);
});
test('resumes from the failed page without repeating committed pages or Portal reads',async()=>{
  const f=fixture();let broken=true;
  const read=async sql=>{if(broken&&sql.includes('FROM Vendor ORDERBY Id STARTPOSITION 501'))throw Object.assign(new Error('down'),{status:503});return f.read(sql)};
  await assert.rejects(acquireSnapshot({...f,read}),/down/);
  assert.equal(f.manifest.status,'collecting');assert.equal(f.pages.size,1);
  broken=false;const snapshot=await acquireSnapshot({...f,read,snapshotId:f.manifest.id,portalSnapshot:async()=>assert.fail('Portal must stay frozen')});
  assert.equal(snapshot.status,'complete');assert.equal(snapshot.entities.Vendor.rows.length,501);
  assert.equal(f.calls.filter(sql=>sql.includes('FROM Vendor ORDERBY Id STARTPOSITION 1 ')).length,1);
  assert.equal(validate(snapshot,'123'),snapshot);
});
test('completed replay makes zero live calls and detects tampered persisted pages',async()=>{
  const f=fixture(),first=await acquireSnapshot(f);
  const second=await acquireSnapshot({...f,snapshotId:first.id,read:async()=>assert.fail('live call'),portalSnapshot:async()=>assert.fail('Portal read')});
  assert.equal(hash(first),hash(second));
  f.pages.get('Vendor0').rows[0].Id='tampered';
  await assert.rejects(acquireSnapshot({...f,snapshotId:first.id}),/snapshot_corrupt/);
});
test('incomplete snapshots, mismatched realm, and count drift fail closed',async()=>{
  assert.throws(()=>validate({status:'collecting'},'123'),/snapshot_incomplete/);
  const f=fixture();let counts=0;
  await assert.rejects(acquireSnapshot({...f,read:async sql=>sql==='SELECT COUNT(*) FROM Vendor'&&++counts===2?{totalCount:502}:f.read(sql)}),/snapshot_count_changed/);
  assert.equal(f.manifest.status,'collecting');
  await assert.rejects(acquireSnapshot({...f,realm:'456',snapshotId:f.manifest.id}),/realm_changed/);
});
test('duplicate IDs cannot complete a snapshot even when counts match',async()=>{
  const f=fixture();f.data.Vendor[500].Id='1';
  await assert.rejects(acquireSnapshot(f),/snapshot_corrupt/);assert.equal(f.manifest.status,'collecting');
});
test('same frozen inputs produce identical full review reports without live reads',async()=>{
  const f=fixture(),snapshot=await acquireSnapshot(f);
  const store={claim:async()=>true,finish:async()=>{},snapshot:async()=>assert.fail('live Portal read')};
  const args={store,realm:'123',requestedBy:'test',prepareSnapshot:async()=>snapshot,queryAll:async()=>assert.fail('live QBO read')};
  const first=await runPayableReview(args),second=await runPayableReview(args);
  assert.deepEqual(first.report,second.report);
  assert.equal(first.report.sourceHash,snapshot.contentHash);
  assert.equal(first.report.safeguards.qboWrites,0);assert.equal(first.report.safeguards.historicalPayablesProposed,0);
  await assert.rejects(runPayableReview({...args,prepareSnapshot:async()=>({...snapshot,status:'collecting'})}),/QBO payable review failed/);
});
test('hashes survive JSONB object key reordering',()=>{
  assert.equal(hash({z:{b:1,a:2},a:[{x:3,y:4}]}),hash({a:[{y:4,x:3}],z:{a:2,b:1}}));
});
test('persisted replay remains identical after database key reordering',async()=>{
  const f=fixture();const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverse(value[key])])):value;
  const originalSave=f.store.save,originalSavePage=f.store.savePage;
  f.store.save=value=>originalSave(reverse(value));
  f.store.savePage=(id,entity,page,value)=>originalSavePage(id,entity,page,reverse(value));
  const first=await acquireSnapshot(f),second=await acquireSnapshot({...f,snapshotId:first.id,read:async()=>assert.fail('live read')});
  assert.deepEqual(first,second);
});
test('a checkpoint write failure stops acquisition before another QBO page',async()=>{
  const f=fixture();f.store.savePage=async()=>{throw new Error('snapshot_store_failed')};
  await assert.rejects(acquireSnapshot(f),/snapshot_store_failed/);
  assert.equal(f.calls.length,2);assert.equal(f.manifest.status,'collecting');
});
test('a failed page records bounded diagnostic details without upstream data',async()=>{
  const f=fixture();await assert.rejects(acquireSnapshot({...f,read:async()=>{throw Object.assign(new Error('private upstream data'),{status:429})}}));
  assert.deepEqual(Object.keys(f.manifest.lastFailure).sort(),['entity','failedAt','startPosition','status','transient']);
  assert.equal(f.manifest.lastFailure.entity,'Vendor');assert.equal(f.manifest.lastFailure.status,429);
  assert.equal(JSON.stringify(f.manifest).includes('private upstream data'),false);
});
