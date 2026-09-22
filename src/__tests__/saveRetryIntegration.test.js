// Exercise the actual persistence wrappers with cloud connectivity unavailable.
// No requests leave the test process.
jest.mock('@supabase/supabase-js',()=>({createClient:()=>null}));
import {_saveDocument,_outboxWrap,_outboxAdd,_outboxList,_dbSaveFailedIds,_retryFailedSaves,_rememberSaveRetry,_setSessionDead} from '../lib/dbEngine';
beforeEach(()=>{localStorage.clear();_dbSaveFailedIds.clear();_setSessionDead(false);});
afterEach(()=>{localStorage.clear();_dbSaveFailedIds.clear();});
test('a scoped manual retry never dispatches another rep’s snapshot',async()=>{
 const own={id:'SO-retry-own',memo:'mine'},other={id:'SO-retry-other',memo:'theirs'};
 _rememberSaveRetry('sales_orders',own);_rememberSaveRetry('sales_orders',other);
 _dbSaveFailedIds.add(own.id);_dbSaveFailedIds.add(other.id);
 await _retryFailedSaves({manual:true,ids:[own.id]});
 expect(_outboxList().map(entry=>entry.id)).toEqual([own.id]);
 expect(_dbSaveFailedIds.has(other.id)).toBe(true);
});
test('failed full-save retry restages the attempted content even if the source and legacy outbox were replaced',async()=>{
 const source={id:'SO-retry-original',memo:'my edit',items:[{sku:'TEE',sizes:{M:2}}],_version:3};
 await _saveDocument('sales_orders',source,async()=>false);
 source.memo='a refreshed screen row';source.items=[];
 _outboxAdd('sales_orders',{...source,memo:'another tab’s outbox snapshot'});
 _dbSaveFailedIds.add(source.id);
 await _retryFailedSaves({manual:true});
 expect(_outboxList()[0].payload).toMatchObject({memo:'my edit',items:[{sizes:{M:2}}],_version:3});
 expect(_dbSaveFailedIds.has(source.id)).toBe(true);
});
test('boot restoration registers the preserved payload, independent of subsequent state changes',async()=>{
 const source={id:'SO-retry-boot',memo:'recovered',items:[],_version:7,_obBaseVersion:4};
 _rememberSaveRetry('sales_orders',source);source.memo='changed after hydration';
 _dbSaveFailedIds.add(source.id);await _retryFailedSaves({manual:true});
 expect(_outboxList()[0].payload).toMatchObject({memo:'recovered',_obBaseVersion:4});
});
test('art-only success cannot substitute for the failed full document during retry',async()=>{
 const full={id:'SO-retry-art',memo:'unsaved full edit',items:[{sku:'TEE'}]};
 await _saveDocument('sales_orders',full,async()=>false);
 await _outboxWrap('sales_orders',{id:full.id,art_files:[]},Promise.resolve(true),true);
 _dbSaveFailedIds.add(full.id);await _retryFailedSaves({manual:true});
 expect(_outboxList()[0].payload.memo).toBe('unsaved full edit');
});
test('missing retry snapshots and dead sessions preserve the failure and durable copy',async()=>{
 const source={id:'SO-retry-missing',memo:'do not erase'};
 _outboxAdd('sales_orders',source);_dbSaveFailedIds.add(source.id);
 expect((await _retryFailedSaves({manual:true})).skipped).toBe(1);
 expect(_outboxList()[0].payload).toEqual(source);expect(_dbSaveFailedIds.has(source.id)).toBe(true);
 _rememberSaveRetry('sales_orders',source);_setSessionDead(true);
 expect((await _retryFailedSaves({manual:true})).skipped).toBe(1);
 expect(_outboxList()[0].payload).toEqual(source);
});
