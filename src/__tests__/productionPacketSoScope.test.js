jest.mock('../../netlify/functions/_shared',()=>({verifyUser:jest.fn(),getSupabaseAdmin:jest.fn()}));
const {verifyUser}=require('../../netlify/functions/_shared');
const {_internals:{authorize,revisionFor}}=require('../../netlify/functions/store-production-packet');
const {scopedSalesOrders,scopeRows,storeEq}=require('../../netlify/functions/_packetScope');
// Records every filter so a test can assert exactly how a query was scoped.
const recorder=data=>{const calls=[];const q={calls};['select','eq','is','maybeSingle','single','update','delete'].forEach(k=>q[k]=jest.fn((...a)=>{calls.push([k,...a]);return q;}));q.then=r=>Promise.resolve({data,error:null}).then(r);return {q,admin:{from:jest.fn(()=>q)}};};
afterEach(()=>jest.clearAllMocks());

test('staff packet for an SO with no webstore is scoped to that one order',async()=>{
 const {admin}=recorder({id:'SO-9',webstore_id:null,deleted_at:null});
 verifyUser.mockResolvedValue({ok:true,admin,teamMemberId:'u1'});
 const ctx=await authorize({}, {so_id:'SO-9'});
 expect(ctx).toMatchObject({storeId:null,soId:'SO-9',staff:true});
});

test('staff packet for a webstore SO still opens its store',async()=>{
 const {admin}=recorder({id:'SO-1',webstore_id:'store-1',deleted_at:null});
 verifyUser.mockResolvedValue({ok:true,admin,teamMemberId:'u1'});
 expect(await authorize({}, {so_id:'SO-1'})).toMatchObject({storeId:'store-1',soId:'SO-1'});
});

test('deleted or missing SO cannot open a packet',async()=>{
 const {admin}=recorder({id:'SO-9',webstore_id:null,deleted_at:'2026-09-01'});
 verifyUser.mockResolvedValue({ok:true,admin,teamMemberId:'u1'});
 await expect(authorize({}, {so_id:'SO-9'})).rejects.toMatchObject({status:404});
 await expect(authorize({}, {})).rejects.toMatchObject({status:400});
});

test('order-only scope never reaches store rows or webstore SOs',()=>{
 const ctx={storeId:null,soId:'SO-9'};
 const a=recorder([]);scopedSalesOrders({...ctx,admin:a.admin},'id');
 expect(a.q.calls).toEqual(expect.arrayContaining([['eq','id','SO-9'],['is','webstore_id',null]]));
 const b=recorder([]);scopeRows(b.q,ctx);expect(b.q.calls).toEqual([['is','store_id',null],['eq','so_id','SO-9']]);
 const c=recorder([]);storeEq(c.q,ctx);expect(c.q.calls).toEqual([['is','store_id',null]]);
 const d=recorder([]);scopeRows(d.q,{storeId:'s',soId:'SO-1'});expect(d.q.calls).toEqual([['eq','store_id','s']]);
});

test('order-only packet cannot read another scope\'s revision',async()=>{
 const {admin}=recorder({store_id:null,so_id:'SO-2',snapshot:{}});
 await expect(revisionFor({admin,storeId:null,soId:'SO-9'},'rev')).rejects.toMatchObject({status:404});
});
