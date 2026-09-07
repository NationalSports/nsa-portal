jest.mock('@supabase/supabase-js',()=>{
 const state={rpc:jest.fn().mockResolvedValue({data:{saved:true,current_memo:'memo'},error:null}),from:jest.fn()};
 const client={rpc:(...args)=>state.rpc(...args),from:(...args)=>state.from(...args),auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'staff'},expires_at:Date.now()/1000+3600}}})}};
 return {createClient:()=>client,__state:state};
});
const env={...process.env};
beforeEach(()=>{jest.resetModules();process.env.REACT_APP_SUPABASE_URL='https://memo-test.supabase.co';process.env.REACT_APP_SUPABASE_ANON_KEY='test';localStorage.clear();localStorage.setItem('nsa_user',JSON.stringify({id:'staff'}));});
afterEach(()=>{process.env={...env};localStorage.clear();});
const command=()=>({id:'SO-MEMO',ownerId:'staff',memo:'memo',expectedMemo:'old',requestId:'00000000-0000-4000-8000-000000000001'});
test('memo adapter sends one narrow RPC and never enters full-document writes or outbox',async()=>{
 const engine=require('../lib/dbEngine'),state=require('@supabase/supabase-js').__state;
 await engine._dbSaveMemoCommand({...command(),items:[{sku:'MUST NOT SEND'}],_version:7});
 expect(state.rpc).toHaveBeenCalledWith('save_sales_order_memo',{p_so_id:'SO-MEMO',p_expected_memo:'old',p_memo:'memo',p_request_id:command().requestId});
 expect(state.from).not.toHaveBeenCalled();expect(engine._outboxList()).toEqual([]);expect(engine._dbOwnVersions['SO-MEMO']).toBeUndefined();
});
test('queued memo is immutable and cannot be dispatched under a different signed-in owner',async()=>{
 const engine=require('../lib/dbEngine'),state=require('@supabase/supabase-js').__state;let release;
 const blocker=engine._queuedEntitySave('SO-MEMO',null,()=>new Promise(r=>{release=r;}));
 const c=command();const queued=engine._dbSaveMemoCommand(c);c.memo='mutated';release(true);await blocker;await queued;
 expect(state.rpc.mock.calls[0][1].p_memo).toBe('memo');
 localStorage.setItem('nsa_user',JSON.stringify({id:'different-staff'}));await expect(engine._dbSaveMemoCommand(command())).rejects.toThrow('original editor');expect(state.rpc).toHaveBeenCalledTimes(1);
});
test('changing owner between network attempts stops retries without borrowing the new session',async()=>{
 const engine=require('../lib/dbEngine'),state=require('@supabase/supabase-js').__state;
 state.rpc.mockImplementationOnce(async()=>{localStorage.setItem('nsa_user',JSON.stringify({id:'different-staff'}));return {error:{message:'Failed to fetch'}};});
 await expect(engine._dbSaveMemoCommand(command())).rejects.toThrow('signed-in editor changed');expect(state.rpc).toHaveBeenCalledTimes(1);
});
