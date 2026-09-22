import fs from 'fs';
import path from 'path';
import { indexFirstById } from '../lib/rowLookup';
const source=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');

test('index retains strict ID matching, first duplicate, object identity and order',()=>{
  const rows=[{id:'1'},{id:1},{id:'1'},{id:undefined},{id:null},{id:NaN}];
  const index=indexFirstById(rows);
  for(const key of ['1',1,undefined,null,NaN,'missing'])expect(index.get(key)).toBe(rows.find(row=>row.id===key));
  expect(indexFirstById().size).toBe(0);
});
function refreshHarness(protectedIds=new Set()){
  const snap={current:{sos:[]}};
  const start=source.indexOf('        const _newerLocalWins=');
  const end=source.indexOf('        // Realtime reload is a blunt',start);
  const merge=Function('indexFirstById','_dbSnap','_hasProtected','_shouldProtect','_jsonEq',source.slice(start,end)+'return _mergeProtected;')(
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

function pollHarness(){
  const start=source.indexOf('    const runPoll=async()=>{');
  const end=source.indexOf('    schedulePoll();\n    // Expose an early-trigger',start);
  const load=jest.fn(),schedule=jest.fn();
  const run=Function('_dbLoad','schedulePoll','document',`
    let cancelled=false,pollRunning=false,_pollConsecutiveFailures=0;
    const _dbReady={current:true},_dbSavingCount=0,_lastFullSyncAt=Date.now(),_FULL_SYNC_MS=1800000;
    const _getPollInterval=()=>300000;
    ${source.slice(start,end)}
    return runPoll;
  `)(load,schedule,{hidden:false});
  return {run,load,schedule};
}
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
