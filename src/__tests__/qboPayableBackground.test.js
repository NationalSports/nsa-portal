const mockFinish=jest.fn(async()=>{}),mockClaim=jest.fn(async()=>true);
jest.mock('../../netlify/functions/_shared',()=>({verifyQBOUser:async()=>({ok:true,userId:'staff'}),getSupabaseAdmin:()=>({})}));
jest.mock('../../netlify/functions/_qb',()=>({}));
jest.mock('../../netlify/functions/_qboReviewConfig',()=>({reviewEnabled:()=>true}));
jest.mock('../../netlify/functions/_qboPayableReviewStore',()=>({payableReviewStore:()=>({claim:mockClaim,finish:mockFinish})}));
jest.mock('../../netlify/functions/_qboPayableSnapshotStore',()=>({snapshotStore:()=>({})}));
jest.mock('../../netlify/functions/_qboPayableSnapshot',()=>({...jest.requireActual('../../netlify/functions/_qboPayableSnapshot'),acquireSnapshot:async()=>{throw new Error('snapshot_store_failed')}}));
const {handler}=require('../../netlify/functions/qbo-payable-review-background');
beforeEach(()=>{jest.clearAllMocks();process.env.QBO_REVIEW_REALM_ID='123';mockClaim.mockResolvedValue(true)});
test('a recorded failure returns normally so Netlify cannot restart a full scan',async()=>{
  const result=await handler({httpMethod:'POST',body:'{}'});
  expect(result.statusCode).toBe(200);expect(JSON.parse(result.body).status).toBe('failed');
  expect(mockFinish).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({status:'failed',error_code:'payable_review_checkpoint_snapshot_snapshot_store_failed'}));
});
test('an overlapping request stays busy without touching the failed run',async()=>{
  mockClaim.mockResolvedValue(false);
  const result=await handler({httpMethod:'POST',body:'{}'});
  expect(JSON.parse(result.body).status).toBe('busy');expect(mockFinish).not.toHaveBeenCalled();
});
