const {handler} = require('../../netlify/functions/unapply-invoice-payment');
const {verifyUser,getSupabaseAdmin} = require('../../netlify/functions/_shared');
jest.mock('../../netlify/functions/_shared',()=>({verifyUser:jest.fn(),getSupabaseAdmin:jest.fn()}));
const actor='00000000-0000-0000-0000-000000000040';
const command={invoiceId:'INV-1',paymentRef:'58415',payment:{amount:100,method:'check',date:'10/06/2026'},reason:'Wrong invoice',confirmed:true};
const event=body=>({httpMethod:'POST',body:JSON.stringify(body)});
let rpc;
beforeEach(()=>{jest.clearAllMocks();verifyUser.mockResolvedValue({ok:true,teamMemberId:actor});rpc=jest.fn().mockResolvedValue({data:{invoice:{id:'INV-1',paid:0},payments:[],qbo_review_required:true},error:null});getSupabaseAdmin.mockReturnValue({rpc});});
test('uses verified identity and returns the authoritative invoice/hold',async()=>{
 const r=await handler(event({...command,actorId:'forged'}));expect(r.statusCode).toBe(200);
 expect(rpc).toHaveBeenCalledWith('unapply_invoice_payment',expect.objectContaining({p_actor_id:actor,p_expected_payment:{amount:100,method:'check',date:'10/06/2026',receipt_id:null}}));
 expect(JSON.parse(r.body).qbo_review_required).toBe(true);
});
test('blocks other staff before any DB command',async()=>{verifyUser.mockResolvedValue({ok:true,teamMemberId:'sales-rep'});expect((await handler(event(command))).statusCode).toBe(403);expect(rpc).not.toHaveBeenCalled();});
test('requires confirmation and a reason',async()=>{expect((await handler(event({...command,confirmed:false}))).statusCode).toBe(400);expect((await handler(event({...command,reason:''}))).statusCode).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test('surfaces stale/sync conflict instead of claiming success',async()=>{rpc.mockResolvedValue({error:{message:'QuickBooks sync is running. Retry after it finishes.'}});const r=await handler(event(command));expect(r.statusCode).toBe(409);expect(JSON.parse(r.body).error).toMatch(/sync is running/);});
test('missing readback is not success',async()=>{rpc.mockResolvedValue({data:{},error:null});expect((await handler(event(command))).statusCode).toBe(502);});
