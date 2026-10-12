jest.mock('../../netlify/functions/_shared', () => ({ corsHeaders:()=>({}), verifyUser:jest.fn() }));
jest.mock('../../netlify/functions/_gmailAi', () => ({ SALES_EMAIL:'sales@nationalsportsapparel.com', getAccessToken:jest.fn() }));
const {verifyUser}=require('../../netlify/functions/_shared');
const {getAccessToken}=require('../../netlify/functions/_gmailAi');
const {handler}=require('../../netlify/functions/gmail-ai-health');
beforeEach(()=>jest.resetAllMocks());
test('rejects unauthorized and other staff without touching Gmail',async()=>{
  verifyUser.mockResolvedValueOnce({ok:false,status:401,error:'Unauthorized'});
  expect((await handler({httpMethod:'GET'})).statusCode).toBe(401);
  verifyUser.mockResolvedValueOnce({ok:true,teamMemberId:'other-admin'});
  expect((await handler({httpMethod:'GET'})).statusCode).toBe(403);
  expect(getAccessToken).not.toHaveBeenCalled();
});
test('verifies the mailbox but never exposes tokens',async()=>{
  verifyUser.mockResolvedValue({ok:true,teamMemberId:'00000000-0000-0000-0000-000000000001'});
  getAccessToken.mockResolvedValue('secret-token');
  const r=await handler({httpMethod:'GET'});
  expect(JSON.parse(r.body).connected).toBe(true);
  expect(r.body).not.toContain('secret-token');
  expect(r.headers['Cache-Control']).toBe('no-store');
});
test('explains mismatched mailbox without disclosing upstream details',async()=>{
  verifyUser.mockResolvedValue({ok:true,teamMemberId:'00000000-0000-0000-0000-000000000001'});
  getAccessToken.mockRejectedValue(new Error('Gmail OAuth is authorized as private@example.com; expected sales'));
  const r=await handler({httpMethod:'GET'});
  expect(JSON.parse(r.body)).toMatchObject({connected:false,message:expect.stringContaining('different mailbox')});
  expect(r.body).not.toContain('private@example.com');
});
