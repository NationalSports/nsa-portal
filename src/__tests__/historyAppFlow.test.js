import fs from 'fs';
import path from 'path';
const src=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');
const loader=src.slice(src.indexOf('  const _loadHistory=()=>{'),src.indexOf('  React.useEffect(',src.indexOf('  const _loadHistory=()=>{')));
function setup(store){
  const revision={current:0};const status=jest.fn(),error=jest.fn(),so=jest.fn(),est=jest.fn();
  const run=Function('_historyLoading','_historyRevision','_historyStore','setHistoryStatus','setHistoryError','setSOHistory','setEstHistory',loader+'return _loadHistory;')({current:null},revision,store,status,error,so,est);
  return {run,revision,status,error,so,est};
}
test('backup history waits for queued writes and does not label a failed load complete',async()=>{
  const store={flush:jest.fn().mockRejectedValue(new Error('Offline')),loadAll:jest.fn()};
  const h=setup(store);await expect(h.run()).rejects.toThrow('Offline');
  expect(store.loadAll).not.toHaveBeenCalled();expect(h.so).not.toHaveBeenCalled();expect(h.status).toHaveBeenLastCalledWith('error');
});
test('a save during a history read retries before publishing recovery entries',async()=>{
  const data={so_history:{'SO-1':[{ts:'latest'}]},est_history:{}};
  const store={flush:jest.fn().mockResolvedValue(),loadAll:jest.fn()};const h=setup(store);
  store.loadAll.mockImplementationOnce(async()=>{h.revision.current++;return {so_history:{},est_history:{}}}).mockResolvedValueOnce(data);
  await expect(h.run()).resolves.toEqual(data);
  expect(store.flush).toHaveBeenCalledTimes(2);expect(h.so).toHaveBeenCalledTimes(1);expect(h.so).toHaveBeenCalledWith(data.so_history);
});
test('simultaneous backup actions share a complete history read',async()=>{
  const store={flush:jest.fn().mockResolvedValue(),loadAll:jest.fn().mockResolvedValue({so_history:{},est_history:{}})};
  const h=setup(store);await Promise.all([h.run(),h.run()]);expect(store.loadAll).toHaveBeenCalledTimes(1);
});
test('failed history export never creates a downloadable partial backup',async()=>{
  const start=src.indexOf('  const exportBackup=async()=>{');const end=src.indexOf('  const importBackup=',start);
  const getFullState=jest.fn();const nf=jest.fn();
  const run=Function('_loadHistory','getFullState','nf',src.slice(start,end)+'return exportBackup;')(()=>Promise.reject(new Error('History unavailable')),getFullState,nf);
  await run();expect(getFullState).not.toHaveBeenCalled();expect(nf).toHaveBeenCalledWith('Backup cancelled: History unavailable','error');
});
const engine=fs.readFileSync(path.join(__dirname,'..','lib','dbEngine.js'),'utf8');
const queryStart=engine.indexOf("      ()=>{\n        if(only&&!only.has('products')&&!only.has('app_state'))return _skip();");
const queryEnd=engine.indexOf("      _grp('customers'",queryStart);
const query=engine.slice(queryStart,queryEnd).trim().replace(/,$/,'');
test.each([[true,true],[true,false],[false,false]])('history blobs are excluded from actual app-state query (full=%s essential=%s)',(fullState,essential)=>{
  const safe=jest.fn();
  const run=Function('only','fullState','essential','_productsLoading','_safeQuery','_skip','_APPSTATE_INIT_ONLY_KEYS','return '+query)(null,fullState,essential,true,safe,jest.fn(),['so_history','est_history','qb_config']);
  run();expect(safe).toHaveBeenCalledWith('app_state',expect.objectContaining({not:expect.arrayContaining([['id','in','(so_history,est_history)']])}));
});
