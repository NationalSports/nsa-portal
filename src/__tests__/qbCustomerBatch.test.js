import {buildQBCustomerManifest,createQBSyncEngine} from '../qbSyncEngine';
const terms=[{Id:'8',Name:'Net 30',DueDays:30,Active:true}];
function setup({failSave=false,changeName=false}={}){
  const cust=[{id:'C1',name:'One',payment_terms:'net30'},{id:'C2',name:'Two',payment_terms:'net30'}];
  const qbo=[{Id:'11',DisplayName:'One',Active:true,SalesTermRef:{value:'8'}}];
  let config={realm_id:'realm',preflight:{status:'success',realm_id:'realm'},custQBMap:{canary1:'1',canary2:'2'},syncLog:[
    {type:'customer_canary',status:'success',details:['UPDATED ONE QBO CUSTOMER TERM: Net 30']}]};
  const manifest={realm:'realm',reviewedAt:new Date().toISOString(),rows:buildQBCustomerManifest(cust,qbo,terms,{})};
  if(changeName)qbo[0].DisplayName='Renamed';
  const qbApi=jest.fn(async(action,{query,customer}={})=>{
    if(action==='query'&&query.includes('FROM Term'))return {QueryResponse:{Term:terms}};
    if(action==='query'&&query.includes('FROM Customer')){
      const id=query.match(/WHERE Id = '(.*?)'/)?.[1];
      return {QueryResponse:{Customer:id?qbo.filter(q=>q.Id===id):qbo}};
    }
    if(action==='upsert_customer'){
      const saved={...customer,Id:customer.Id||'12',Active:true};qbo.push(saved);return {Customer:saved};
    }
    throw new Error('Unexpected '+action);
  });
  const persistQbLink=jest.fn(async()=>{if(failSave)throw new Error('Storage unavailable');});
  const setQbSyncing=jest.fn();
  const engine=createQBSyncEngine({cust,qbApi,qbConfig:config,persistQbLink,setQbSyncing,nf:jest.fn(),
    setQBConfig:fn=>{config=fn(config);},sos:[],invs:[],prod:[],vend:[]});
  return {engine,manifest,qbApi,persistQbLink,setQbSyncing,config:()=>config};
}
test('reviewed batch links and creates sequentially, persisting every verified result',async()=>{
  const run=setup();const report=await run.engine.syncCustomers({manifest:run.manifest,approved:true});
  expect(report.status).toBe('success');expect(report.counts).toMatchObject({linked:1,created:1,blocked:0});
  expect(run.qbApi.mock.calls.filter(([action])=>action==='upsert_customer')).toHaveLength(1);
  expect(run.persistQbLink).toHaveBeenCalledTimes(2);
  expect(run.persistQbLink.mock.calls[0][0].evidence.batch_id).toBe(report.id);
  expect(run.setQbSyncing.mock.calls).toEqual([[true],[false]]);
  expect(run.config().custQBMap).toMatchObject({C1:'11',C2:'12'});
});
test('failed storage stops remaining records and does not award a saved link',async()=>{
  const run=setup({failSave:true});const report=await run.engine.syncCustomers({manifest:run.manifest,approved:true});
  expect(report.counts).toMatchObject({blocked:1,not_attempted:1,created:0,linked:0});
  expect(run.qbApi.mock.calls.some(([action])=>action==='upsert_customer')).toBe(false);
  expect(run.config().custQBMap.C1).toBeUndefined();
});
test('a changed plan blocks before a write',async()=>{
  const run=setup({changeName:true});const report=await run.engine.syncCustomers({manifest:run.manifest,approved:true});
  expect(report.status).toBe('stopped');expect(run.qbApi.mock.calls.some(([action])=>action==='upsert_customer')).toBe(false);
});
test.each(['unapproved','oversize','stale','other_realm'])('rejects %s batches before QBO calls',async(kind)=>{
  const run=setup();const manifest={...run.manifest};let approved=true;
  if(kind==='unapproved')approved=false;
  if(kind==='oversize')manifest.rows=Array.from({length:require('../qbAccountMappings').QB_MAX_REVIEWED_BATCH+1},(_,i)=>({...manifest.rows[0],sourceId:String(i)}));
  if(kind==='stale')manifest.reviewedAt='2020-01-01';
  if(kind==='other_realm')manifest.realm='other';
  expect(await run.engine.syncCustomers({manifest,approved})).toMatchObject({status:'blocked'});
  expect(run.qbApi).not.toHaveBeenCalled();
});
describe('blank portal terms in the canary and batch',()=>{
  function setupBlank({qboTerm='8',blankTermsDefault=''}={}){
    const cust=[{id:'B1',name:'Blank',payment_terms:''},{id:'B2',name:'Missing',payment_terms:''}];
    const qbo=[{Id:'21',DisplayName:'Blank',Active:true,SyncToken:'0',SalesTermRef:{value:qboTerm,name:'Net 30'}}];
    let config={realm_id:'realm',preflight:{status:'success',realm_id:'realm'},custQBMap:{canary1:'1',canary2:'2'},syncLog:[
      {type:'customer_canary',status:'success',details:['UPDATED ONE QBO CUSTOMER TERM: Net 30']}]};
    const qbApi=jest.fn(async(action,{query,customer}={})=>{
      if(action==='query'&&query.includes('FROM Term'))return {QueryResponse:{Term:terms}};
      if(action==='query'&&query.includes('FROM Customer')){
        const id=query.match(/WHERE Id = '(.*?)'/)?.[1];
        return {QueryResponse:{Customer:id?qbo.filter(q=>q.Id===id):qbo}};
      }
      if(action==='upsert_customer'){const saved={...customer,Id:customer.Id||'22',Active:true};qbo.push(saved);return {Customer:saved};}
      throw new Error('Unexpected '+action);
    });
    const persistQbLink=jest.fn(async()=>{});
    const engine=createQBSyncEngine({cust,qbApi,qbConfig:config,persistQbLink,setQbSyncing:jest.fn(),nf:jest.fn(),
      setQBConfig:fn=>{config=fn(config);},sos:[],invs:[],prod:[],vend:[]});
    const rows=buildQBCustomerManifest(cust,qbo,terms,{},{blankTermsDefault});
    return {engine,qbApi,persistQbLink,rows,manifest:{realm:'realm',reviewedAt:new Date().toISOString(),rows,blankTermsDefault},config:()=>config};
  }
  test('canary links a blank-terms customer to its existing QBO record without any write',async()=>{
    const run=setupBlank();
    const result=await run.engine.syncCustomerCanary('B1');
    expect(result).toMatchObject({status:'success',created:false,termsUpdated:false,qbId:'21'});
    expect(run.qbApi.mock.calls.some(([action])=>action==='upsert_customer')).toBe(false);
    expect(run.persistQbLink.mock.calls[0][0].evidence).toMatchObject({result:'linked',term_id:'8',term_source:'qbo'});
  });
  test('canary blocks a blank-terms customer with no QBO match unless a default was chosen',async()=>{
    const run=setupBlank();
    expect(await run.engine.syncCustomerCanary('B2')).toMatchObject({status:'blocked',error:expect.stringMatching(/no default is assumed/)});
    expect(run.qbApi.mock.calls.some(([action])=>action==='upsert_customer')).toBe(false);
    const withDefault=setupBlank({blankTermsDefault:'net30'});
    expect(await withDefault.engine.syncCustomerCanary('B2',{blankTermsDefault:'net30'})).toMatchObject({status:'needs_confirmation'});
    const created=await withDefault.engine.syncCustomerCanary('B2',{blankTermsDefault:'net30',allowCreate:true});
    expect(created).toMatchObject({status:'success',created:true});
    expect(withDefault.qbApi.mock.calls.find(([action])=>action==='upsert_customer')[1].customer.SalesTermRef).toEqual({value:'8',name:'Net 30'});
    expect(withDefault.persistQbLink.mock.calls[0][0].evidence.term_source).toBe('default');
  });
  test('batch carries the reviewed default and rejects a plan reviewed under a different one',async()=>{
    const run=setupBlank({blankTermsDefault:'net30'});
    const report=await run.engine.syncCustomers({manifest:run.manifest,approved:true});
    expect(report.counts).toMatchObject({linked:1,created:1,blocked:0});
    expect(report.blankTermsDefault).toBe('net30');
    const changed=setupBlank({blankTermsDefault:'net30'});
    const stale=await changed.engine.syncCustomers({manifest:{...changed.manifest,blankTermsDefault:''},approved:true});
    expect(stale.counts.created).toBe(0);
    expect(changed.qbApi.mock.calls.some(([action])=>action==='upsert_customer')).toBe(false);
    expect(await run.engine.syncCustomers({manifest:{...run.manifest,blankTermsDefault:'whenever'},approved:true})).toMatchObject({status:'blocked'});
  });
});

describe('large reviewed batches',()=>{
  const {QB_MAX_REVIEWED_BATCH}=require('../qbAccountMappings');
  function setupMany(count){
    const cust=Array.from({length:count},(_,i)=>({id:'M'+i,name:'Club '+i,payment_terms:'net30'}));
    const qbo=[];
    let config={realm_id:'realm',preflight:{status:'success',realm_id:'realm'},custQBMap:{a:'1',b:'2'},syncLog:[
      {type:'customer_canary',status:'success',details:['UPDATED ONE QBO CUSTOMER TERM: Net 30']}]};
    let nextId=500, termReads=0, customerListReads=0;
    const qbApi=jest.fn(async(action,{query,customer}={})=>{
      if(action==='query'&&query.includes('FROM Term')){termReads++;return {QueryResponse:{Term:terms}};}
      if(action==='query'&&query.includes('FROM Customer')){
        const id=query.match(/WHERE Id = '(.*?)'/)?.[1];
        if(!id)customerListReads++;
        return {QueryResponse:{Customer:id?qbo.filter(q=>q.Id===id):qbo}};
      }
      if(action==='upsert_customer'){
        const saved={...customer,Id:customer.Id||String(nextId++),Active:true};qbo.push(saved);return {Customer:saved};
      }
      throw new Error('Unexpected '+action);
    });
    const engine=createQBSyncEngine({cust,qbApi,qbConfig:config,persistQbLink:jest.fn(async()=>{}),setQbSyncing:jest.fn(),nf:jest.fn(),
      setQBConfig:fn=>{config=fn(config);},sos:[],invs:[],prod:[],vend:[]});
    const rows=buildQBCustomerManifest(cust,qbo,terms,{});
    return {engine,qbApi,rows,reads:()=>({termReads,customerListReads}),
      manifest:{realm:'realm',reviewedAt:new Date().toISOString(),rows}};
  }

  test('a 100-record batch reads the QBO lists once, not once per record',async()=>{
    const run=setupMany(100);
    const report=await run.engine.syncCustomers({manifest:run.manifest,approved:true});
    expect(report.counts).toMatchObject({created:100,blocked:0,not_attempted:0});
    // One term read and one customer-list read for the whole run. The old per-record
    // reload made this 100 and 100, which is why the cap had to be 20.
    expect(run.reads()).toEqual({termReads:1,customerListReads:1});
  });

  test('each created customer is folded into the shared snapshot for later records',async()=>{
    const run=setupMany(3);
    await run.engine.syncCustomers({manifest:run.manifest,approved:true});
    const readBacks=run.qbApi.mock.calls.filter(([action,args])=>action==='query'&&/WHERE Id = /.test(args.query||''));
    expect(readBacks).toHaveLength(3);
    expect(new Set(run.qbApi.mock.calls.filter(([a])=>a==='upsert_customer').map(([,args])=>args.customer.DisplayName)).size).toBe(3);
  });

  test('the cap is the shared limit, and one over it is refused before any QBO call',async()=>{
    const run=setupMany(2);
    const oversize=Array.from({length:QB_MAX_REVIEWED_BATCH+1},(_,i)=>({...run.rows[0],sourceId:'X'+i}));
    expect(await run.engine.syncCustomers({manifest:{...run.manifest,rows:oversize},approved:true})).toMatchObject({status:'blocked'});
    expect(run.qbApi).not.toHaveBeenCalled();
  });

  test('a failure part way through still stops the run and reports the remainder',async()=>{
    const run=setupMany(5);
    run.qbApi.mockImplementationOnce(async()=>({QueryResponse:{Term:terms}}))
      .mockImplementationOnce(async()=>({QueryResponse:{Customer:[]}}))
      .mockImplementationOnce(async()=>({Fault:{Error:[{Detail:'QBO rejected the write'}]}}));
    const report=await run.engine.syncCustomers({manifest:run.manifest,approved:true});
    expect(report.status).toBe('stopped');
    expect(report.counts.blocked).toBe(1);
    expect(report.counts.not_attempted).toBe(4);
  });
});

// The engine and the Run button each decided batch-readiness for themselves and
// drifted: the engine learned to read the durable receipt while the button kept
// reading syncLog, which holds only the newest 100 events. The button was left
// permanently disabled on a control that was in fact satisfied.
describe('customer batch readiness is one shared decision',()=>{
  const {qbCustomerBatchReady}=require('../qbSyncEngine');
  const links={a:'1',b:'2'};
  const canaryLog={type:'customer_canary',status:'success',details:['UPDATED ONE QBO CUSTOMER TERM: Net 30']};

  test('the durable receipt alone is enough once the log has aged out',()=>{
    expect(qbCustomerBatchReady({custQBMap:links,syncLog:[],custTermCanaryVerifiedAt:'2026-09-05T17:41:00.000Z'})).toBe(true);
  });
  test('the log alone still works for a company that has not aged it out',()=>{
    expect(qbCustomerBatchReady({custQBMap:links,syncLog:[canaryLog]})).toBe(true);
  });
  test('neither source means not ready',()=>{
    expect(qbCustomerBatchReady({custQBMap:links,syncLog:[]})).toBe(false);
    expect(qbCustomerBatchReady({custQBMap:links,syncLog:[{...canaryLog,status:'error'}]})).toBe(false);
    expect(qbCustomerBatchReady({custQBMap:links,syncLog:[{...canaryLog,details:['LINK ONLY — no QBO customer was changed']}]})).toBe(false);
  });
  test('fewer than two saved links is never ready, whatever the canary says',()=>{
    expect(qbCustomerBatchReady({custQBMap:{a:'1'},custTermCanaryVerifiedAt:'2026-09-05T17:41:00.000Z'})).toBe(false);
    expect(qbCustomerBatchReady({})).toBe(false);
  });
  test('the engine gate agrees with the predicate on the live-shaped config',async()=>{
    // custQBMap has 43 entries and no customer_canary survives in syncLog: exactly the
    // production state in which the Run button was disabled but the engine would allow it.
    const aged={custQBMap:links,syncLog:[{type:'purchase_orders',status:'success',details:['…']}],
      custTermCanaryVerifiedAt:'2026-09-05T17:41:00.000Z'};
    expect(qbCustomerBatchReady(aged)).toBe(true);
    const run=setup();
    const report=await run.engine.syncCustomers({manifest:run.manifest,approved:true});
    expect(report.status).toBe('success');
  });
});
