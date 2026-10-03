const { createClient } = require('@supabase/supabase-js');
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
const { handler } = require('../../netlify/functions/art-request-portal');
function setup(results) {
  const db = { rpc: jest.fn().mockResolvedValue({data:{status:'approved'},error:null}), from: jest.fn(() => {
    const result=results.shift();const q={then:fn=>Promise.resolve(result).then(fn)};
    ['select','eq','in','maybeSingle','neq','order','range'].forEach(k=>q[k]=jest.fn(()=>q));return q;
  })};
  createClient.mockReturnValue(db);return db;
}
const invoke = body => handler({httpMethod:'POST',body:JSON.stringify(body)});
beforeEach(()=>{process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';});
test('unknown portal cannot list proofs',async()=>{
  const db=setup([{data:[],error:null}]);expect((await invoke({alphaTag:'wrong',action:'list'})).statusCode).toBe(403);expect(db.rpc).not.toHaveBeenCalled();
});
test('cross-customer proof is denied before the decision RPC',async()=>{
  const db=setup([{data:[{id:'c1'}]},{data:[]},{data:null}]);
  expect((await invoke({alphaTag:'QA',action:'decide',id:'other',version:1,decision:'approve',comment:''})).statusCode).toBe(403);expect(db.rpc).not.toHaveBeenCalled();
});
test('list strips staff identity from shared proof history',async()=>{
  setup([{data:[{id:'c1'}]},{data:[]},{data:[{id:'r1',portal_proofs:[{version:1,status:'pending',files:[],shared_by:'private-auth-id'}]}]}]);
  const result=await invoke({alphaTag:'QA',action:'list'});expect(result.statusCode).toBe(200);expect(result.body).not.toContain('private-auth-id');
});
test('valid decision uses server-checked portal and reviewed version',async()=>{
  const db=setup([{data:[{id:'c1'}]},{data:[]},{data:{id:'r1'}}]);
  expect((await invoke({alphaTag:'QA',action:'decide',id:'r1',version:3,decision:'approve',comment:''})).statusCode).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith('decide_standalone_art_proof',{p_id:'r1',p_alpha_tag:'QA',p_version:3,p_decision:'approve',p_comment:''});
});

test('malformed JSON values receive 400 rather than crashing',async()=>{
  for(const value of [null,[],true,42]) expect((await invoke(value)).statusCode).toBe(400);
});
test('decision response never exposes staff identity',async()=>{
  const db=setup([{data:[{id:'c1'}]},{data:[]},{data:{id:'r1'}}]);
  db.rpc.mockResolvedValue({data:{version:1,status:'approved',shared_by:'private-staff-id'}});
  const res=await invoke({alphaTag:'QA',action:'decide',id:'r1',version:1,decision:'approve',comment:''});
  expect(res.statusCode).toBe(200);expect(res.body).not.toContain('private-staff-id');
});
