import fs from 'fs';
import path from 'path';
import { indexFirstById } from '../lib/rowLookup';
import { changedGroups, markLoaded, loadedVersion, _resetDataVersionsForTest } from '../lib/dataVersions';
const source=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');

test('index retains strict ID matching, first duplicate, object identity and order',()=>{
  const rows=[{id:'1'},{id:1},{id:'1'},{id:undefined},{id:null},{id:NaN}];
  const index=indexFirstById(rows);
  for(const key of ['1',1,undefined,null,NaN,'missing'])expect(index.get(key)).toBe(rows.find(row=>row.id===key));
  expect(indexFirstById().size).toBe(0);
});
function refreshHarness(protectedIds=new Set()){
  const snap={current:{sos:[]}};
  // _newerLocalWins is shared with the per-order refreshes, so it sits at component scope; _mergeProtected stays inside reloadAll.
  const nlwStart=source.indexOf('  const _newerLocalWins=');
  const nlw=source.slice(nlwStart,source.indexOf('\n',nlwStart)+1);
  const start=source.indexOf('        const _mergeProtected=');
  const end=source.indexOf('        // Realtime reload is a blunt',start);
  const merge=Function('indexFirstById','_dbSnap','_hasProtected','_shouldProtect','_jsonEq',nlw+source.slice(start,end)+'return _mergeProtected;')(
    indexFirstById,snap,protectedIds.size>0,id=>protectedIds.has(id),(a,b)=>JSON.stringify(a)===JSON.stringify(b));
  return {snap,merge};
}
test('refresh preserves pending/failed local records and newer versions, including latest state at apply time',()=>{
  const {snap,merge}=refreshHarness(new Set(['pending','failed']));
  const local=[{id:'pending',memo:'unsaved'},{id:'failed',memo:'recover me'},{id:'newer',_version:8,memo:'just saved'}];
  snap.current.sos=local;
  const incoming=[{id:'pending',memo:'old'},{id:'failed',memo:'old'},{id:'newer',_version:7},{id:'added',_version:1}];
  const result=merge(incoming,'sos');
  expect(result.snap.slice(0,3)).toEqual(local);
  const latest=local.map(row=>row.id==='pending'?{...row,memo:'typed during refresh'}:row);
  expect(result.apply(latest)[0]).toBe(latest[0]);
  expect(result.apply(latest)[2]).toBe(local[2]);
  expect(result.apply(latest)[3]).toBe(incoming[3]);
});
test('refresh accepts newer server versions, preserves server deletions and avoids no-op rerenders',()=>{
  const {snap,merge}=refreshHarness();
  const local=[{id:'keep',_version:1},{id:'deleted',_version:1}];snap.current.sos=local;
  const incoming=[{id:'keep',_version:2}];
  expect(merge(incoming,'sos').apply(local)).toEqual(incoming);
  expect(merge(incoming,'sos').apply(incoming)).toBe(incoming);
});
function diffHarness({ready=true,loaded=ready,saveResult=true,active=false}={}){
  const snap={current:{rows:[]}},pending=new Set(),save=jest.fn(()=>Promise.resolve(saveResult));
  const body=source.match(/  const _diffSave=([^\n]+)/)[1];
  const diff=Function('indexFirstById','_authErrorDetected','_initialLoadDone','_dbLoadSuccess','_diffSaveSkipLogged','_dbSnap','_dbSavePendingIds','_diffCmp','_bgSyncInc','_bgSyncDec','_hasActiveDocumentSave','_isDocumentConflictCooling','return '+body)(
    indexFirstById,false,{current:ready},{current:loaded},new Set(['rows']),snap,pending,row=>row.value,()=>{},()=>{},()=>active,()=>false);
  return {snap,pending,save,run:rows=>diff(rows,'rows',save)};
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('diff-save uses linear ID lookups and writes nothing on a 20,000-row unchanged refresh',()=>{
  let reads=0;const rows=Array.from({length:20000},(_,i)=>({get id(){reads++;return 'row-'+i},value:i}));
  const h=diffHarness();h.snap.current.rows=rows;h.run([...rows]);
  expect(h.save).not.toHaveBeenCalled();expect(h.pending.size).toBe(0);
  expect(reads).toBeLessThanOrEqual(60000);
});
test('diff-save sends only changed records with their original baseline',async()=>{
  const h=diffHarness();const old={id:'a',value:1},same={id:'b',value:1};h.snap.current.rows=[old,same];
  const edited={id:'a',value:2};h.run([edited,same]);await settle();
  expect(h.save).toHaveBeenCalledTimes(1);expect(h.save).toHaveBeenCalledWith(edited,old);
  expect(h.pending.size).toBe(0);
});
test('failed save restores its baseline and remains pending; active saves stay pending',async()=>{
  const h=diffHarness({saveResult:false});const old={id:'a',value:1};h.snap.current.rows=[old];
  h.run([{id:'a',value:2}]);await settle();expect(h.snap.current.rows[0]).toBe(old);expect(h.pending.has('a')).toBe(true);
  const active=diffHarness({active:true});active.run([{id:'a',value:2}]);await settle();expect(active.pending.has('a')).toBe(true);
});
test('failed older save never rolls back a newer edit',async()=>{
  const h=diffHarness({saveResult:false});h.snap.current.rows=[{id:'a',value:1}];
  h.run([{id:'a',value:2}]);const newer={id:'a',value:3};h.snap.current.rows=[newer];
  await settle();expect(h.snap.current.rows[0]).toBe(newer);
});
test('incomplete initial load still blocks writes and retains changed drafts as pending',()=>{
  const h=diffHarness({ready:true,loaded:false});h.run([{id:'a',value:2}]);
  expect(h.save).not.toHaveBeenCalled();expect(h.snap.current.rows).toEqual([]);expect(h.pending.has('a')).toBe(true);
});


// The poll's decision logic (what to read), with every read mocked. `fullSync` makes it a 30-minute full sync.
function pollHarness({custCount=1,versions=null,changes=null,orders=null,fullSync=false}={}){
  _resetDataVersionsForTest();
  const start=source.indexOf('    const runPoll=async()=>{');
  const end=source.indexOf('    schedulePoll();\n    // Expose an early-trigger',start);
  const load=jest.fn(),schedule=jest.fn(),fetchDataVersions=jest.fn(async()=>versions);
  const changesSince=jest.fn(async()=>changes),ordersByIds=jest.fn(async()=>orders),apply=jest.fn();
  const run=Function('_dbLoad','schedulePoll','document','_custCount','fetchDataVersions','changedGroups','markLoaded','loadedVersion','supabase','_dbLoadSalesOrderChangesSince','_dbLoadSalesOrdersByIds','_applySalesOrderRows','_SO_DELTA_MAX',`
    let cancelled=false,pollRunning=false,_pollConsecutiveFailures=0;
    const _dbReady={current:true},_dbSavingCount=0,_lastFullSyncAt=${fullSync?0:'Date.now()'},_FULL_SYNC_MS=1800000;
    const _getPollInterval=()=>300000;
    ${source.slice(start,end)}
    return runPoll;
  `)(load,schedule,{hidden:false},{current:custCount},fetchDataVersions,changedGroups,markLoaded,loadedVersion,null,changesSince,ordersByIds,apply,25);
  return {run,load,schedule,fetchDataVersions,changesSince,ordersByIds,apply};
}
const GROUPS=['estimates','sales_orders','invoices','messages','app_state'];
const V={estimates:1,sales_orders:5,invoices:2,messages:9,app_state:3};
const onlyOf=call=>call&&call.only?[...call.only]:undefined;
test('navigation cannot overlap an in-flight poll; polling resumes after completion',async()=>{
  const h=pollHarness();let finish;
  h.load.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const first=h.run();await h.run();await h.run();
  expect(h.load).toHaveBeenCalledTimes(1);
  finish(null);await first;expect(h.schedule).toHaveBeenCalledTimes(1);
  h.load.mockResolvedValue(null);await h.run();expect(h.load).toHaveBeenCalledTimes(2);
});
test('a rejected poll releases the guard and schedules recovery',async()=>{
  const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
  try{
    const h=pollHarness();h.load.mockRejectedValue(new Error('offline'));
    await h.run();await h.run();expect(h.load).toHaveBeenCalledTimes(2);expect(h.schedule).toHaveBeenCalledTimes(2);
  }finally{warn.mockRestore()}
});
test('an empty customer list is refetched before the core load, so a skipped poll cannot block the heal',async()=>{
  const h=pollHarness({custCount:0});h.load.mockResolvedValue(null);
  await h.run();
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(onlyOf(h.load.mock.calls[0][0])).toEqual(['customers']);
  expect(h.load.mock.calls[1][0].only).toBeUndefined();
});
test('a core poll is skipped when nothing it loads has changed since the last load',async()=>{
  const quiet=pollHarness({versions:V});markLoaded(V,GROUPS);
  await quiet.run();
  expect(quiet.fetchDataVersions).toHaveBeenCalledTimes(1);
  expect(quiet.load).not.toHaveBeenCalled();expect(quiet.changesSince).not.toHaveBeenCalled();expect(quiet.schedule).toHaveBeenCalledTimes(1);
});
test('a core poll downloads only the groups that moved, as a core load',async()=>{
  const h=pollHarness({versions:{...V,messages:10,app_state:4}});markLoaded(V,GROUPS);h.load.mockResolvedValue(null);
  await h.run();
  expect(h.load).toHaveBeenCalledTimes(1);
  expect(h.load.mock.calls[0][0].coreOnly).toBe(true);
  expect(onlyOf(h.load.mock.calls[0][0])).toEqual(['messages','app_state']);
  expect(h.changesSince).not.toHaveBeenCalled();
});
test('only orders moved and the database names them: those orders are fetched by id and no group is downloaded',async()=>{
  const rows=[{id:'SO-1',_version:3},{id:'SO-2',_version:1}];
  const h=pollHarness({versions:{...V,sales_orders:6},changes:{ids:['SO-1','SO-2']},orders:{sales_orders:rows,missing:[]}});markLoaded(V,GROUPS);
  await h.run();
  expect(h.changesSince).toHaveBeenCalledWith(5,25);
  expect(h.ordersByIds).toHaveBeenCalledWith(['SO-1','SO-2'],[],{maxOrders:25});
  expect(h.apply).toHaveBeenCalledWith(rows);
  expect(h.load).not.toHaveBeenCalled();expect(h.schedule).toHaveBeenCalledTimes(1);
  // The cursor advanced: the next poll with the same counters reads nothing at all.
  expect(loadedVersion('sales_orders')).toBe(6);
  await h.run();
  expect(h.changesSince).toHaveBeenCalledTimes(1);expect(h.load).not.toHaveBeenCalled();
});
test('orders plus another group: the orders come by id, the other group alone is downloaded',async()=>{
  const rows=[{id:'SO-7'}];
  const h=pollHarness({versions:{...V,sales_orders:6,messages:10},changes:{ids:['SO-7']},orders:{sales_orders:rows,missing:[]}});markLoaded(V,GROUPS);h.load.mockResolvedValue(null);
  await h.run();
  expect(h.apply).toHaveBeenCalledWith(rows);
  expect(onlyOf(h.load.mock.calls[0][0])).toEqual(['messages']);
  expect(h.load.mock.calls[0][0].coreOnly).toBe(true);
});
test('a moved counter with no orders named (a rolled-back save) downloads nothing and still advances the cursor',async()=>{
  const h=pollHarness({versions:{...V,sales_orders:6},changes:{ids:[]}});markLoaded(V,GROUPS);
  await h.run();
  expect(h.ordersByIds).not.toHaveBeenCalled();expect(h.apply).not.toHaveBeenCalled();expect(h.load).not.toHaveBeenCalled();
  expect(loadedVersion('sales_orders')).toBe(6);
});
test('the whole order group is downloaded as before when the lookup is unavailable, names too many orders, or names a deleted one',async()=>{
  for(const [changes,orders] of [[null,null],[{tooMany:true},null],[{ids:['SO-9']},{sales_orders:[],missing:['SO-9']}],[{ids:['SO-9']},null]]){
    const h=pollHarness({versions:{...V,sales_orders:6},changes,orders});markLoaded(V,GROUPS);h.load.mockResolvedValue(null);
    await h.run();
    expect(h.apply).not.toHaveBeenCalled();
    expect(onlyOf(h.load.mock.calls[0][0])).toEqual(['sales_orders']);
    // A failed group load leaves the cursor where it was, so the next poll tries again.
    expect(loadedVersion('sales_orders')).toBe(5);
  }
});
test('a tab that has never recorded a counter for orders downloads the group (no cursor to read from)',async()=>{
  const h=pollHarness({versions:{...V,sales_orders:6},changes:{ids:['SO-1']}});h.load.mockResolvedValue(null);
  await h.run();
  expect(h.changesSince).not.toHaveBeenCalled();
  expect(onlyOf(h.load.mock.calls[0][0])).toEqual(GROUPS);
});
test('without counters (RPC missing or failing) every poll loads exactly as before',async()=>{
  const h=pollHarness({versions:null});h.load.mockResolvedValue(null);
  await h.run();expect(h.load).toHaveBeenCalledTimes(1);
  expect(h.load.mock.calls[0][0]).toEqual({coreOnly:true});expect(h.changesSince).not.toHaveBeenCalled();
});
test('a full sync loads everything, counters or not',async()=>{
  const h=pollHarness({versions:V,fullSync:true});markLoaded(V,GROUPS);h.load.mockResolvedValue(null);
  await h.run();
  expect(h.load.mock.calls[0][0]).toEqual({coreOnly:false});expect(h.changesSince).not.toHaveBeenCalled();
});

// The poll's apply step, with the loaded data supplied: groups a poll did not download must keep both
// their state and their diff baseline (a replaced baseline would re-save every row of the group).
function pollApplyHarness({versions,d}){
  _resetDataVersionsForTest();
  const start=source.indexOf('    const runPoll=async()=>{');
  const end=source.indexOf('    schedulePoll();\n    // Expose an early-trigger',start);
  const snap={current:{ests:[{id:'E1'}],sos:[{id:'S1'}],invs:[{id:'I1'}],msgs:[{id:'M1'}],cust:[{id:'C1'}],prod:[],vend:[],team:[],omg:[],issues:[],assignedTodos:[]}};
  const set={};const setter=k=>{set[k]=jest.fn();return set[k]};
  const overrides={
    _dbLoad:jest.fn(async()=>d),schedulePoll:jest.fn(),document:{hidden:false},_custCount:{current:1},
    fetchDataVersions:async()=>versions,changedGroups,markLoaded,loadedVersion,supabase:null,
    _dbLoadSalesOrderChangesSince:async()=>null,_dbLoadSalesOrdersByIds:async()=>null,_applySalesOrderRows:jest.fn(),_SO_DELTA_MAX:25,
    _dbSnap:snap,indexFirstById,_dbSaveFailedIds:new Set(),_dbSavePendingIds:new Set(),_recentlyPulledSOs:new Set(),
    _dbLoadSuccess:{current:true},_histInvsCount:{current:1},_mergeAssignedTodos:(a)=>a,
    setEsts:setter('ests'),setSOs:setter('sos'),setInvs:setter('invs'),setMsgs:setter('msgs'),setCust:setter('cust'),setProd:setter('prod'),
    setIssues:setter('issues'),setOmgStores:setter('omg'),setAssignedTodos:setter('todos'),setDbError:jest.fn(),
  };
  // Every other identifier the poll touches on these paths is a global (JSON, Date, Set…); anything
  // unexpected throws a ReferenceError the poll reports as "Poll failed", which the tests assert against.
  const scope=new Proxy(overrides,{has:(t,k)=>typeof k==='string'&&k in t,get:(t,k)=>t[k]});
  const run=Function('scope',`with(scope){
    let cancelled=false,pollRunning=false,_pollConsecutiveFailures=0;
    const _dbReady={current:true},_dbSavingCount=0,_lastFullSyncAt=Date.now(),_FULL_SYNC_MS=1800000;
    const _getPollInterval=()=>300000;
    ${source.slice(start,end)}
    return runPoll;
  }`)(scope);
  return {run,snap,set,overrides};
}
const coreLoad=(groups)=>({hasData:true,_coreOnly:true,_decoTimedOut:false,_parentTimedOut:false,_badGroups:[],appState:{},
  estimates:groups.includes('estimates')?[{id:'E2'}]:[],sales_orders:groups.includes('sales_orders')?[{id:'S2'}]:[],
  invoices:groups.includes('invoices')?[{id:'I2'}]:[],messages:groups.includes('messages')?[{id:'M2'}]:[],customers:[],products:[],issues:[]});
test('a poll that downloaded only messages applies messages and leaves the other groups\' state and baseline untouched',async()=>{
  const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
  try{
    const h=pollApplyHarness({versions:{...V,messages:10},d:coreLoad(['messages'])});markLoaded(V,GROUPS);
    const before={...h.snap.current};
    await h.run();
    expect(warn).not.toHaveBeenCalled();
    expect([...h.overrides._dbLoad.mock.calls[0][0].only]).toEqual(['messages']);
    expect(h.set.msgs).toHaveBeenCalledTimes(1);
    for(const k of ['ests','sos','invs'])expect(h.set[k]).not.toHaveBeenCalled();
    for(const k of ['ests','sos','invs','cust'])expect(h.snap.current[k]).toBe(before[k]);
    expect(h.snap.current.msgs).toEqual([{id:'M2'}]);
    expect(loadedVersion('messages')).toBe(10);
  }finally{warn.mockRestore()}
});
test('a core poll without counters still applies and re-baselines every core group',async()=>{
  const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
  try{
    const h=pollApplyHarness({versions:null,d:coreLoad(GROUPS)});
    await h.run();
    expect(warn).not.toHaveBeenCalled();
    expect(h.overrides._dbLoad.mock.calls[0][0]).toEqual({coreOnly:true});
    for(const k of ['ests','sos','invs','msgs'])expect(h.set[k]).toHaveBeenCalledTimes(1);
    expect(h.snap.current.ests).toEqual([{id:'E2'}]);expect(h.snap.current.sos).toEqual([{id:'S2'}]);
    expect(h.snap.current.invs).toEqual([{id:'I2'}]);expect(h.snap.current.msgs).toEqual([{id:'M2'}]);
    expect(h.snap.current.cust).toEqual([{id:'C1'}]);// cold groups keep their baseline on a core poll, as before
  }finally{warn.mockRestore()}
});
