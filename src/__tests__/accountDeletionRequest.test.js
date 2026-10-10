let mockCheck=jest.fn(),mockAdminCheck=jest.fn(),mockUpsert=jest.fn(),mockResult;
const mockSb={from:()=>({
 upsert:(...a)=>mockUpsert(...a),
 select:()=>({eq:()=>({maybeSingle:async()=>mockResult}),order:()=>({limit:async()=>({data:[],error:null})})})
})};
jest.mock('../../netlify/functions/_shared',()=>({corsHeaders:()=>({}),verifyUser:(...a)=>mockCheck(...a),verifyAdmin:(...a)=>mockAdminCheck(...a)}));
const fn=require('../../netlify/functions/account-deletion-request');
beforeEach(()=>{mockResult={data:{id:'request',status:'pending'},error:null};mockUpsert=jest.fn().mockResolvedValue({error:null});mockCheck=jest.fn().mockResolvedValue({ok:true,userId:'real-auth',teamMemberId:'real-staff',admin:mockSb});mockAdminCheck=jest.fn().mockResolvedValue({ok:false,status:403,error:'Admin required'});});
const event=body=>({httpMethod:'POST',headers:{},body:JSON.stringify(body)});
test('rejects unsigned staff before creating a request',async()=>{mockCheck.mockResolvedValue({ok:false,status:401,error:'Missing token'});expect((await fn.handler(event({confirm:'DELETE'}))).statusCode).toBe(401);expect(mockUpsert).not.toHaveBeenCalled();});
test('requires confirmation and derives identity from verified session',async()=>{
 expect((await fn.handler(event({}))).statusCode).toBe(400);
 const result=await fn.handler(event({confirm:'DELETE',auth_user_id:'someone-else',team_member_id:'another'}));expect(result.statusCode).toBe(200);
 expect(mockUpsert).toHaveBeenCalledWith({auth_user_id:'real-auth',team_member_id:'real-staff'},{onConflict:'auth_user_id',ignoreDuplicates:true});
 expect(JSON.parse(result.body).request.status).toBe('pending');
});
test('database failure never reports success',async()=>{mockUpsert.mockResolvedValue({error:{code:'42P01'}});expect((await fn.handler(event({confirm:'DELETE'}))).statusCode).toBe(503);});
test('request list is admin-only',async()=>{expect((await fn.handler({httpMethod:'GET',queryStringParameters:{list:'1'}})).statusCode).toBe(403);});
