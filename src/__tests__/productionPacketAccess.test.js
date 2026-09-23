jest.mock('../../netlify/functions/_shared',()=>({verifyUser:jest.fn(),getSupabaseAdmin:jest.fn()}));
const {verifyUser,getSupabaseAdmin}=require('../../netlify/functions/_shared');
const {handler,_internals:{authorize,revisionFor,all}}=require('../../netlify/functions/store-production-packet');
const { _internals: { compactImageUrl } }=require('../../netlify/functions/store-production-pdf');
const queryResult=data=>{const q={};['select','eq','maybeSingle','single'].forEach(k=>q[k]=jest.fn(()=>q));q.then=(resolve)=>Promise.resolve({data,error:null}).then(resolve);return {from:jest.fn(()=>q)};};
afterEach(()=>jest.clearAllMocks());
test('staff view requires verified active staff',async()=>{verifyUser.mockResolvedValue({ok:false,status:401,error:'Sign in'});const r=await handler({httpMethod:'POST',body:'{"store_id":"s"}'});expect(r.statusCode).toBe(401);});
test.each([{revoked_at:'today',expires_at:'2999-01-01'}, {expires_at:'2000-01-01'}, null])('expired/revoked/missing link cannot read data',async link=>{getSupabaseAdmin.mockReturnValue(queryResult(link));await expect(authorize({}, {token:'a'.repeat(64)})).rejects.toMatchObject({status:403});});
test('share link cannot override its store or SO scope',async()=>{getSupabaseAdmin.mockReturnValue(queryResult({id:'link',store_id:'safe',so_id:'SO-1',expires_at:'2999-01-01'}));const ctx=await authorize({}, {token:'a'.repeat(64),store_id:'other',scope_so_id:'SO-2'});expect(ctx.storeId).toBe('safe');expect(ctx.soId).toBe('SO-1');expect(ctx.staff).toBe(false);});
test('decorator cannot issue packets or create links',async()=>{getSupabaseAdmin.mockReturnValue(queryResult({store_id:'safe',expires_at:'2999-01-01'}));const r=await handler({httpMethod:'POST',body:JSON.stringify({token:'a'.repeat(64),action:'issue'})});expect(r.statusCode).toBe(403);});
test('SO-scoped recipient cannot read whole-store revision',async()=>{const admin=queryResult({store_id:'safe',so_id:null,snapshot:{secret:'other SO'}});await expect(revisionFor({admin,storeId:'safe',soId:'SO-1'},'rev')).rejects.toMatchObject({status:404});});
test('loads beyond the first 500 players',async()=>{const q=jest.fn(()=>({range:jest.fn((start)=>Promise.resolve({data:Array.from({length:start===0?500:7},(_,i)=>({id:start+i})),error:null}))}));expect(await all(q)).toHaveLength(507);});
test('invalid token does not query source tables',async()=>{await expect(authorize({}, {token:'bad'})).rejects.toMatchObject({status:403});expect(getSupabaseAdmin).not.toHaveBeenCalled();});
test('PDF images use bounded print-size supplier URLs',()=>{
 expect(compactImageUrl('https://b2bprod-res.cloudinary.com/images/w_2000,h_2000,c_pad,f_auto,q_auto/a/item.png')).toContain('/images/w_800,h_800,c_pad,f_auto,q_auto/');
 expect(compactImageUrl('https://res.cloudinary.com/acct/image/upload/v1/art.png')).toContain('/image/upload/f_auto,q_auto,c_limit,w_800,h_800/');
 expect(compactImageUrl('https://images.salsify.com/image/upload/s--sig--/c_pad,w_2000,h_2000,f_auto,q_auto/id.png')).toContain('/image/upload/c_pad,w_800,h_800,f_auto,q_auto/');
});
