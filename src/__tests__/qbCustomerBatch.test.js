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
