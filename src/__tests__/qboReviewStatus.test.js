jest.mock('../../netlify/functions/_shared',()=>({verifyQBOUser:jest.fn(),getSupabaseAdmin:jest.fn()}));
jest.mock('../../netlify/functions/_qboDeployContext.json',()=>({context:'production'}));
const deployment=require('../../netlify/functions/_qboDeployContext.json');
const {verifyQBOUser,getSupabaseAdmin}=require('../../netlify/functions/_shared');
const {handler}=require('../../netlify/functions/qbo-review-status');
const env={...process.env};
beforeEach(()=>{
  jest.resetAllMocks(); deployment.context='production'; delete process.env.CONTEXT; process.env.QBO_SERVER_REVIEW_ENABLED='true'; process.env.QBO_REVIEW_REALM_ID='123';
  verifyQBOUser.mockResolvedValue({ok:true});
  const query={select:jest.fn(()=>query),eq:jest.fn(()=>query),order:jest.fn(()=>query),limit:jest.fn(async()=>({data:[],error:null}))};
  getSupabaseAdmin.mockReturnValue({from:()=>query});
});
afterAll(()=>{process.env=env;});
test('reports server configuration without secrets',async()=>{
  const result=await handler({httpMethod:'GET'});
  expect(JSON.parse(result.body)).toEqual({runs:[],enabled:true,realm:'123',mode:'read_only'});
  expect(result.headers['Cache-Control']).toBe('no-store');
});
test.each(['deploy-preview','dev'])('configuration is disabled in %s',async context=>{
  deployment.context=context;
  expect(JSON.parse((await handler({httpMethod:'GET'})).body).enabled).toBe(false);
});
test('unauthorized request never reads financial history',async()=>{
  verifyQBOUser.mockResolvedValue({ok:false,status:403});
  expect((await handler({httpMethod:'GET'})).statusCode).toBe(403);
  expect(getSupabaseAdmin).not.toHaveBeenCalled();
});
test('invalid realm cannot be enabled',async()=>{
  process.env.QBO_REVIEW_REALM_ID='';
  expect(JSON.parse((await handler({httpMethod:'GET'})).body).enabled).toBe(false);
});
