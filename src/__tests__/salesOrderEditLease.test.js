import {createSalesOrderEditLease} from '../lib/salesOrderEditLease';
const owned={owned:true,generation:1,ttl_ms:120000};
let clock,client,lease;
beforeEach(()=>{clock=0;client={rpc:jest.fn().mockResolvedValue({data:owned})};lease=createSalesOrderEditLease({client,id:'SO-1',session:'tab-a',now:()=>clock});});
test('viewing does not claim or save; explicit acquisition pins session and generation',async()=>{
 expect(client.rpc).not.toHaveBeenCalled();expect(lease.stamp({id:'SO-1'})).toBeNull();
 await lease.acquire();expect(lease.stamp({id:'SO-1'})._editLease).toEqual({session:'tab-a',generation:1});
});
test('sleep expiry blocks synchronously before a throttled timer runs',async()=>{
 await lease.acquire();clock=120000;expect(lease.canSave()).toBe(false);expect(lease.state.phase).toBe('lost');
 await lease.renew();expect(client.rpc).toHaveBeenCalledTimes(1);
 await lease.acquire();expect(client.rpc).toHaveBeenCalledTimes(1);
});
test('renewal failure pauses instead of auto-reacquiring on reconnect',async()=>{
 await lease.acquire();client.rpc.mockRejectedValue(new Error('offline'));await lease.renew();
 expect(lease.canSave()).toBe(false);client.rpc.mockResolvedValue({data:owned});await lease.renew();
 expect(client.rpc).toHaveBeenCalledTimes(2);
});
test('takeover uses the generation shown to the user',async()=>{
 client.rpc.mockResolvedValueOnce({data:{owned:false,holder:'Steve',generation:3,can_takeover:true}});
 await lease.acquire();expect(lease.canSave()).toBe(false);await lease.acquire(true);
 expect(client.rpc.mock.calls[1][1]).toMatchObject({p_action:'takeover',p_generation:3});
});
test('changed takeover refreshes the generation and explains why the editor stayed view only',async()=>{
 client.rpc
  .mockResolvedValueOnce({data:{owned:false,holder:'Steve',generation:3,can_takeover:true}})
  .mockResolvedValueOnce({data:{owned:false,reason:'changed'}})
  .mockResolvedValueOnce({data:{owned:false,holder:'Steve',generation:4,can_takeover:true}})
  .mockResolvedValueOnce({data:{owned:true,generation:5,ttl_ms:120000}});
 await lease.acquire();
 await lease.acquire(true);
 expect(client.rpc.mock.calls.map(([,args])=>args.p_action)).toEqual(['acquire','takeover','status']);
 expect(lease.state).toMatchObject({phase:'view',generation:4,can_takeover:true});
 expect(lease.state.message).toMatch(/changed in another tab/i);
 await lease.acquire(true);
 expect(client.rpc.mock.calls[3][1]).toMatchObject({p_action:'takeover',p_generation:4});
 expect(lease.state.phase).toBe('editing');
});
test('late acquisition after closing releases the server claim',async()=>{
 let resolve;client.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
 const acquiring=lease.acquire();const closing=lease.close();resolve({data:owned});await Promise.all([acquiring,closing]);
 expect(lease.canSave()).toBe(false);expect(client.rpc.mock.calls.some(([,a])=>a.p_action==='release')).toBe(true);
});
test('round trip time is subtracted from the lease deadline',async()=>{
 client.rpc.mockImplementation(async()=>{clock=119000;return {data:owned}});await lease.acquire();expect(lease.canSave()).toBe(false);
});

test('a renewal response arriving after loss cannot unfreeze the old editor',async()=>{
 await lease.acquire();let resolve;client.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
 const renewing=lease.renew();lease.lose();resolve({data:owned});await renewing;
 expect(lease.state.phase).toBe('lost');expect(lease.canSave()).toBe(false);
});
test('closing waits for in-flight renewal, then releases without resurrecting ownership',async()=>{
 await lease.acquire();let resolve;client.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
 const renewing=lease.renew();const closing=lease.close();resolve({data:owned});await Promise.all([renewing,closing]);
 expect(client.rpc.mock.calls.map(([,a])=>a.p_action)).toEqual(['acquire','renew','release']);expect(lease.canSave()).toBe(false);
});
test('page close sends a fenced keepalive release after editing, without starting another claim',async()=>{
 const previousFetch=global.fetch;global.fetch=jest.fn().mockResolvedValue({ok:true});
 try{
  client.supabaseUrl='https://staging.example.supabase.co';client.supabaseKey='public-key';
  client.auth={onAuthStateChange:callback=>{
    callback('INITIAL_SESSION',{access_token:'test-access-token'});
    return {data:{subscription:{unsubscribe:jest.fn()}}};
  }};
  const pageLease=createSalesOrderEditLease({client,id:'SO-1',session:'tab-a',now:()=>clock});
  pageLease.closeOnPageHide();expect(global.fetch).not.toHaveBeenCalled();
  await pageLease.acquire();pageLease.closeOnPageHide();pageLease.closeOnPageHide();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url,request]=global.fetch.mock.calls[0];
  expect(url).toBe('https://staging.example.supabase.co/rest/v1/rpc/sales_order_edit_lease');
  expect(request).toMatchObject({method:'POST',keepalive:true,headers:{apikey:'public-key',Authorization:'Bearer test-access-token'}});
  expect(JSON.parse(request.body)).toEqual({p_so_id:'SO-1',p_session:'tab-a',p_action:'release',p_generation:1});
  expect(pageLease.canSave()).toBe(false);
  await pageLease.renew();expect(client.rpc).toHaveBeenCalledTimes(1);
 }finally{global.fetch=previousFetch}
});
