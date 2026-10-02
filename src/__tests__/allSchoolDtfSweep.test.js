jest.mock('../../netlify/functions/_allSchoolDtf',()=>({REQUESTS:'all_school_dtf_requests',BATCHES:'all_school_dtf_batches',recordAllSchoolDtfForSo:jest.fn(),prepareStoreBatches:jest.fn(async()=>({batches:[]})),sendBatch:jest.fn()}));
const {recordAllSchoolDtfForSo,prepareStoreBatches}=require('../../netlify/functions/_allSchoolDtf');
const {sweepAllSchoolDtf}=require('../../netlify/functions/all-school-dtf');
beforeEach(()=>{jest.clearAllMocks();delete process.env.ALL_SCHOOL_DTF_SEND_ENABLED;recordAllSchoolDtfForSo.mockResolvedValue({recorded:0});});
function scanningAdmin(count=26){
 const ids=Array.from({length:count},(_,i)=>String(i+1).padStart(4,'0'));
 const state={id:'orders',last_order_id:null,upper_order_id:null};
 const admin={state,from:table=>{let upper=false,after=null,ceiling=null,limit=0,patch=null;const q={
 select:()=>q,eq:()=>q,in:()=>q,not:()=>q,lte:(key,id)=>{ceiling=id;return q;},gt:(key,id)=>{after=id;return q;},order:(key,opts)=>{upper=opts?.ascending===false;return q;},limit:n=>{limit=n;return q;},single:()=>q,maybeSingle:()=>q,update:p=>{patch=p;return q;},
 then:resolve=>{if(table==='all_school_dtf_scan_state'){if(patch)Object.assign(state,patch);return resolve({data:{...state}});}if(table==='webstores')return resolve({data:{all_school_settings:{dtf:{auto_send:true}}}});
 if(table==='webstore_orders'){if(upper)return resolve({data:ids.length?[{id:ids.at(-1)}]:[]});return resolve({data:ids.filter(id=>(!after||id>after)&&(!ceiling||id<=ceiling)).slice(0,limit).map(id=>({id,store_id:'s'+id,so_id:'SO-'+id}))});}
 return resolve({data:[]});}
 };return q;}};return admin;
}
test('bounded keyset scan progresses beyond old cap and resets only after its snapshot',async()=>{
 const admin=scanningAdmin();await sweepAllSchoolDtf(admin);
 expect(recordAllSchoolDtfForSo).toHaveBeenCalledTimes(25);expect(admin.state.last_order_id).toBe('0025');
 await sweepAllSchoolDtf(admin);expect(recordAllSchoolDtfForSo).toHaveBeenCalledTimes(26);
 expect(admin.state.upper_order_id).toBeNull();expect(admin.state.last_order_id).toBeNull();
});
test('one failing store does not stop other stores and will be revisited next scan cycle',async()=>{
 const admin=scanningAdmin(2);recordAllSchoolDtfForSo.mockImplementation(async(a,id)=>{if(id==='SO-0001')throw new Error('one store failed');return {recorded:0};});
 const r=await sweepAllSchoolDtf(admin);expect(r.results[0].error).toBe('one store failed');
 expect(recordAllSchoolDtfForSo).toHaveBeenCalledWith(admin,'SO-0002');expect(prepareStoreBatches).toHaveBeenCalledWith(admin,'s0002');
 await sweepAllSchoolDtf(admin);expect(recordAllSchoolDtfForSo).toHaveBeenCalledTimes(4);
});
