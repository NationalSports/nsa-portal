let mockVerify=jest.fn(),mockCreate=jest.fn();
jest.mock('../../netlify/functions/_shared',()=>({corsHeaders:()=>({}),verifyUser:(...a)=>mockVerify(...a),getSupabaseAdmin:()=>({})}));
jest.mock('@anthropic-ai/sdk',()=>function(){return {messages:{create:(...a)=>mockCreate(...a)}};});
const portal=require('../../netlify/functions/portal-assistant');
const teamshop=require('../../netlify/functions/teamshop-assistant');
const {AI_CONSENT}=require('../lib/aiConsent.shared');
beforeEach(()=>{process.env.ANTHROPIC_API_KEY='test';mockVerify=jest.fn().mockResolvedValue({ok:true,role:'rep'});mockCreate=jest.fn().mockResolvedValue({content:[{type:'text',text:'Hello'}],stop_reason:'end_turn'});});
afterEach(()=>{delete process.env.ANTHROPIC_API_KEY;});
const event=consent=>({httpMethod:'POST',headers:{},body:JSON.stringify({messages:[{role:'user',text:'hello'}],ai_consent:consent,user:{role:'admin'}})});
test.each([undefined,{...AI_CONSENT,accepted:false},{...AI_CONSENT,version:'stale'}])('both endpoints block missing, declined or stale consent',async consent=>{
 for(const fn of [portal,teamshop])expect((await fn.handler(event(consent))).statusCode).toBe(403);
 expect(mockCreate).not.toHaveBeenCalled();
});
test('internal AI requires verified staff, even with consent',async()=>{
 mockVerify.mockResolvedValue({ok:false,status:401,error:'Invalid token'});
 expect((await portal.handler(event(AI_CONSENT))).statusCode).toBe(401);expect(mockCreate).not.toHaveBeenCalled();
});
test('verified staff with current consent can use AI',async()=>{
 const response=await portal.handler(event(AI_CONSENT));expect(response.statusCode).toBe(200);expect(mockCreate).toHaveBeenCalled();
 const args=mockCreate.mock.calls[0][0];expect(args.tools.some(t=>t.name==='adjust_inventory')).toBe(false);
});
