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
  if(kind==='oversize')manifest.rows=Array.from({length:21},(_,i)=>({...manifest.rows[0],sourceId:String(i)}));
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
