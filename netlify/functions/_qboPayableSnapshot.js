// Read-only, sequential acquisition. Persisted pages are immutable and independently hashed.
const {createHash, randomUUID}=require('crypto');
const ENTITIES=['Vendor','Item','Account','PurchaseOrder','Bill','VendorCredit','BillPayment'];
const PAGE_SIZE=500, MAX_ROWS=20000;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fail=code=>{throw new Error(code)};
const transient=error=>[429,500,502,503,504].includes(error.status)||['ETIMEDOUT','ECONNRESET','EAI_AGAIN','ECONNREFUSED'].includes(error.code)||error.message==='QBO upstream request timed out';
async function retryRead(read,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),random=Math.random}={}){
  for(let attempt=0;;attempt++){
    try{return await read()}catch(error){
      if(!transient(error)||attempt===3)throw error;
      await sleep(Math.min(8000,500*2**attempt)+Math.floor(random()*250));
    }
  }
}
function validate(snapshot,realm){
  if(!snapshot||snapshot.realm!==realm||snapshot.version!==1||snapshot.status!=='complete')fail('snapshot_incomplete');
  for(const entity of ENTITIES){
    const data=snapshot.entities[entity];
    if(!data||!Array.isArray(data.rows)||data.rows.length!==data.count||data.contentHash!==hash(data.rows))fail('snapshot_corrupt');
    if(new Set(data.rows.map(row=>String(row.Id))).size!==data.count||data.rows.some(row=>!row.Id))fail('snapshot_corrupt');
  }
  if(snapshot.contentHash!==hash({portal:snapshot.portal,entities:snapshot.entities}))fail('snapshot_corrupt');
  return snapshot;
}
async function acquireSnapshot({store,read,realm,portalSnapshot,snapshotId,now=Date.now,retryOptions={}}){
  const started=now();
  let manifest=snapshotId?await store.load(snapshotId):null;
  if(snapshotId&&!manifest)fail('snapshot_not_found');
  if(manifest&&(manifest.realm!==realm||manifest.version!==1))fail('realm_changed');
  if(!manifest){
    manifest={id:randomUUID(),realm,version:1,status:'collecting',createdAt:new Date(now()).toISOString(),portal:await portalSnapshot(),entities:{}};
    await store.save(manifest);
  }
  const snapshot={...manifest,entities:{}};
  const request=async sql=>{
    if(now()-started>540000)fail('snapshot_time_budget');
    try{return await retryRead(()=>read(sql),retryOptions)}catch(error){
      manifest.lastFailure={entity:sql.match(/FROM (\w+)/)?.[1],startPosition:Number(sql.match(/STARTPOSITION (\d+)/)?.[1]||0),status:Number(error.status)||null,transient:transient(error),failedAt:new Date(now()).toISOString()};
      await store.save(manifest);throw error;
    }
  };
  const count=async entity=>{
    const result=await request(`SELECT COUNT(*) FROM ${entity}`);
    const value=result.totalCount;
    if(!Number.isInteger(value)||value<0||value>MAX_ROWS)fail('snapshot_count_invalid');
    return value;
  };
  for(const entity of ENTITIES){
    let meta=manifest.entities[entity];
    if(!meta){meta={count:await count(entity),pages:0,rows:0,complete:false};manifest.entities[entity]=meta;await store.save(manifest)}
    const rows=[];
    // Recover a page committed just before interruption without advancing the manifest.
    for(let index=0;index<Math.max(1,Math.ceil(meta.count/PAGE_SIZE));index++){
      let page=await store.page(manifest.id,entity,index);
      if(!page){
        if(manifest.status==='complete'||meta.complete)fail('snapshot_corrupt');
        const result=await request(`SELECT * FROM ${entity} ORDERBY Id STARTPOSITION ${index*PAGE_SIZE+1} MAXRESULTS ${PAGE_SIZE}`);
        const values=result[entity]||[];
        if(!Array.isArray(values)||values.length!==Math.min(PAGE_SIZE,meta.count-index*PAGE_SIZE))fail('snapshot_count_changed');
        page={rows:values,contentHash:hash(values),fetchedAt:new Date(now()).toISOString()};
        await store.savePage(manifest.id,entity,index,page);
      }
      if(page.contentHash!==hash(page.rows)||page.rows.length!==Math.min(PAGE_SIZE,meta.count-index*PAGE_SIZE))fail('snapshot_corrupt');
      rows.push(...page.rows);
      if(!meta.complete){meta.pages=index+1;meta.rows=rows.length;await store.save(manifest)}
    }
    if(!meta.complete){
      if(await count(entity)!==meta.count)fail('snapshot_count_changed');
      meta.complete=true;meta.contentHash=hash(rows);meta.fetchedAt=new Date(now()).toISOString();await store.save(manifest);
    }
    if(meta.contentHash!==hash(rows))fail('snapshot_corrupt');
    snapshot.entities[entity]={...meta,rows};
  }
  snapshot.status='complete';
  snapshot.contentHash=hash({portal:snapshot.portal,entities:snapshot.entities});
  if(manifest.status==='complete'&&manifest.contentHash!==snapshot.contentHash)fail('snapshot_corrupt');
  validate(snapshot,realm);
  if(manifest.status!=='complete'){
    manifest.status='complete';manifest.contentHash=snapshot.contentHash;manifest.completedAt=new Date(now()).toISOString();await store.save(manifest);
  }
  snapshot.completedAt=manifest.completedAt;
  return canonical(snapshot);
}
module.exports={ENTITIES,PAGE_SIZE,hash,retryRead,acquireSnapshot,validate};
