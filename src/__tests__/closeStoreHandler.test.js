jest.mock('../../netlify/functions/_shared',()=>({verifyUser:jest.fn(),getSupabaseAdmin:jest.fn()}));
const {verifyUser,getSupabaseAdmin}=require('../../netlify/functions/_shared');
const {handler}=require('../../netlify/functions/close-store');
const rpc=jest.fn();
const event=(extra={})=>({httpMethod:'POST',body:JSON.stringify({soId:'SO-1',version:3,costsRecorded:true,shipped:true,actorId:'forged',...extra})});
beforeEach(()=>{jest.clearAllMocks();verifyUser.mockResolvedValue({ok:true,teamMemberId:'verified'});getSupabaseAdmin.mockReturnValue({rpc});});
test('requires authentication and both explicit attestations',async()=>{
  verifyUser.mockResolvedValueOnce({ok:false,status:401});expect((await handler(event())).statusCode).toBe(401);
  expect((await handler(event({shipped:false}))).statusCode).toBe(400);
  expect((await handler(event({costsRecorded:false}))).statusCode).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
test('uses verified actor and only reports confirmed committed closeout',async()=>{
  rpc.mockResolvedValue({data:{ok:true,sales_order:{store_closed_at:'2026-10-11'},invoice:{id:'INV-1'},payments:[]}});
  expect((await handler(event())).statusCode).toBe(200);
  expect(rpc).toHaveBeenCalledWith('close_store',expect.objectContaining({p_actor_id:'verified',p_expected_version:3}));
  rpc.mockResolvedValue({error:{message:'Duplicate invoices'}});
  expect((await handler(event())).statusCode).toBe(409);
  rpc.mockResolvedValue({data:{ok:true}});expect((await handler(event())).statusCode).toBe(502);
});

test('rejects malformed input and handles authentication outages without posting money',async()=>{
  for(const body of ['null','{','[]','1',JSON.stringify({soId:123,version:1,costsRecorded:true,shipped:true})]){
    expect((await handler({httpMethod:'POST',body})).statusCode).toBe(400);
  }
  expect((await handler({httpMethod:'GET'})).statusCode).toBe(405);
  verifyUser.mockRejectedValueOnce(new Error('offline'));
  expect((await handler(event())).statusCode).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});
