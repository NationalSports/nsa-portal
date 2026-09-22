jest.mock('../../netlify/functions/_qboDeployContext.json',()=>({context:'unknown'}));
const deployment=require('../../netlify/functions/_qboDeployContext.json');
const {reviewEnabled}=require('../../netlify/functions/_qboReviewConfig');
const {writeDeployContext}=require('../../scripts/write-qbo-deploy-context');
const configured={QBO_SERVER_REVIEW_ENABLED:'true',QBO_REVIEW_REALM_ID:'123'};
test('production works without runtime CONTEXT',()=>{
  deployment.context='production'; expect(reviewEnabled(configured)).toBe(true);
});
test.each(['unknown','deploy-preview','branch-deploy','dev',undefined])('%s cannot run even with production runtime environment',context=>{
  deployment.context=context; expect(reviewEnabled({...configured,CONTEXT:'production'})).toBe(false);
});
test('production still requires explicit opt-in and valid realm',()=>{
  deployment.context='production';
  expect(reviewEnabled({...configured,QBO_SERVER_REVIEW_ENABLED:'false'})).toBe(false);
  expect(reviewEnabled({...configured,QBO_REVIEW_REALM_ID:''})).toBe(false);
});
test.each(['production','deploy-preview','branch-deploy','dev'])('build stamps only %s, not credentials',context=>{
  const write=jest.fn(); writeDeployContext({CONTEXT:context,SECRET:'do-not-copy'},write);
  expect(write.mock.calls[0][1]).toBe(JSON.stringify({context})+'\n');
});
test('missing context overwrites a prior stamp with unknown',()=>{
  const write=jest.fn(); writeDeployContext({},write);
  expect(write.mock.calls[0][1]).toBe('{"context":"unknown"}\n');
});
test('stamp write failure is fatal',()=>{
  expect(()=>writeDeployContext({CONTEXT:'production'},()=>{throw Error('write failed');})).toThrow('write failed');
});
