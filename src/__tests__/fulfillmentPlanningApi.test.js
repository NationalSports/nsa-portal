jest.mock('../../netlify/functions/_shared',()=>({corsHeaders:()=>({}),verifyUser:jest.fn()}));
jest.mock('../../netlify/functions/_fulfillmentTiming',()=>({loadTimingContext:jest.fn(),clearTimingCache:jest.fn()}));
const {verifyUser}=require('../../netlify/functions/_shared');
const {loadTimingContext,clearTimingCache}=require('../../netlify/functions/_fulfillmentTiming');
const {handler}=require('../../netlify/functions/fulfillment-planning');
beforeEach(()=>jest.clearAllMocks());
test('unauthorized callers cannot read planning or write arrival observations',async()=>{
 verifyUser.mockResolvedValue({ok:false,status:401,error:'Unauthorized'});
 for(const httpMethod of ['GET','POST'])expect((await handler({httpMethod})).statusCode).toBe(401);
 expect(loadTimingContext).not.toHaveBeenCalled();
});
test('arrival RPC only receives allowed fields, with server timestamps and idempotent request ID',async()=>{
 const rpc=jest.fn().mockResolvedValue({data:1});verifyUser.mockResolvedValue({ok:true,admin:{rpc}});
 const request_id='12345678-1234-1234-1234-123456789abc';
 const line={so_id:'SO',item_index:0,po_id:'PO',size:'M',qty:2};
 const result=await handler({httpMethod:'POST',body:JSON.stringify({action:'record_arrival',request_id,lines:[{...line,arrived_at:'2000-01-01',checked_in_at:'2000-01-02'}]})});
 expect(result.statusCode).toBe(200);
 expect(rpc).toHaveBeenCalledWith('record_fulfillment_arrivals',{p_request_id:request_id,p_lines:[line]});expect(clearTimingCache).toHaveBeenCalled();
});
test('planning response omits raw events and item or employee data',async()=>{
 verifyUser.mockResolvedValue({ok:true,admin:{}});
 loadTimingContext.mockResolvedValue({model:{methods:{}},plan:{jobs:{}},jobs:[{id:'a',so_id:'SO',deco_type:'Print',total_units:2,prod_status:'hold',items:[{private:'secret'}],employee:'secret'}],arrivals:[{secret:1}]});
 const r=await handler({httpMethod:'GET'});expect(r.statusCode).toBe(200);expect(r.body).not.toMatch(/secret|employee|arrivals/);expect(JSON.parse(r.body).plan[0].finish_date).toBeNull();
});
test('missing migration returns an unavailable response without inventing learned timing',async()=>{
 verifyUser.mockResolvedValue({ok:true,admin:{}});loadTimingContext.mockResolvedValue(null);
 expect((await handler({httpMethod:'GET'})).statusCode).toBe(503);
});
