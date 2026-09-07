import {createSaveRetryCoordinator} from '../lib/saveRetryCoordinator';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
let coordinator;
beforeEach(()=>{coordinator=createSaveRetryCoordinator();});
const stage=(memo='typed edit',id='SO-1',owner='a')=>{
 const input={id,memo,items:[{sku:'TEE',sizes:{M:2}}],_version:3};
 const receipt=coordinator.begin(owner,'sales_orders',input);
 coordinator.finish(receipt,false);
 return {input,receipt};
};
const run=(save,extra={})=>coordinator.retry({owner:'a',ids:['SO-1'],canRetry:()=>true,save,...extra});
test('retry preserves original content and base even if a screen row or prior writer mutates',async()=>{
 const {input}=stage();input.memo='cloud refresh';input.items[0].sizes.M=0;input._version=99;
 const save=jest.fn(async(table,payload)=>{expect(payload).toMatchObject({memo:'typed edit',_version:3,items:[{sizes:{M:2}}]});payload.memo='writer mutation';return false;});
 await run(save);await run(save);expect(save).toHaveBeenCalledTimes(2);
});
test('timer, foreground and manual retries share a single in-flight batch',async()=>{
 stage();const wait=deferred();const save=jest.fn(()=>wait.promise);
 const a=run(save),b=run(save),c=run(save);expect(a).toBe(b);expect(b).toBe(c);expect(save).toHaveBeenCalledTimes(1);
 wait.resolve(true);expect(await a).toEqual({saved:1,failed:0,skipped:0});
});
test('late success cannot acknowledge a newer attempted edit',async()=>{
 const old=coordinator.begin('a','sales_orders',{id:'SO-1',memo:'old'});
 stage('new');coordinator.finish(old,true);
 const save=jest.fn(async()=>false);await run(save);expect(save.mock.calls[0][1].memo).toBe('new');
});
test('an in-flight ordinary save blocks retry, then confirmed success removes its snapshot',async()=>{
 const receipt=coordinator.begin('a','sales_orders',{id:'SO-1',memo:'saving'});const save=jest.fn();
 expect((await run(save)).skipped).toBe(1);expect(save).not.toHaveBeenCalled();
 coordinator.finish(receipt,true);const onMissing=jest.fn();await run(save,{onMissing});expect(onMissing).toHaveBeenCalledWith('SO-1');
});
test('owner changes and ambiguous IDs never dispatch another staff member’s edit',async()=>{
 stage();const save=jest.fn();await run(save,{owner:'b'});expect(save).not.toHaveBeenCalled();
 const other=coordinator.begin('a','estimates',{id:'SO-1',memo:'ambiguous legacy ID'});coordinator.finish(other,false);
 await run(save);expect(save).not.toHaveBeenCalled();
});
test('missing rows leave failure IDs intact instead of treating them as deletion',async()=>{
 const ids=new Set(['SO-missing']);const onMissing=jest.fn(),save=jest.fn();
 await run(save,{ids,onMissing});expect([...ids]).toEqual(['SO-missing']);expect(onMissing).toHaveBeenCalledWith('SO-missing');expect(save).not.toHaveBeenCalled();
});
test('session/eligibility is rechecked between sends and exceptions do not lose the next draft',async()=>{
 stage('one');stage('two','SO-2');let allowed=true;
 const save=jest.fn(async()=>{allowed=false;throw new Error('session expired');});const onError=jest.fn();
 const result=await run(save,{ids:['SO-1','SO-2'],canRetry:()=>allowed,onError});
 expect(result).toEqual({saved:0,failed:1,skipped:1});expect(onError).toHaveBeenCalled();
 const next=jest.fn(async()=>false);await run(next,{ids:['SO-2']});expect(next.mock.calls[0][1].memo).toBe('two');
});
test('a draft replaced while another ID is saving uses the newest attempt when its turn arrives',async()=>{
 stage('one');stage('old second','SO-2');const wait=deferred();
 const save=jest.fn().mockImplementationOnce(()=>wait.promise).mockResolvedValue(false);
 const batch=run(save,{ids:['SO-1','SO-2']});stage('new second','SO-2');wait.resolve(true);await batch;
 expect(save.mock.calls[1][1].memo).toBe('new second');
});
test('bounded retry batches rotate so missing or failing IDs cannot starve later drafts',async()=>{
 const ids=Array.from({length:12},(_,i)=>'SO-'+i);ids.forEach(id=>stage('pending',id));
 const save=jest.fn(async()=>false);
 await run(save,{ids});await run(save,{ids});
 expect(new Set(save.mock.calls.map(([,p])=>p.id))).toEqual(new Set(ids));
});
