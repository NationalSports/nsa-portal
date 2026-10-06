jest.mock('../../netlify/functions/_emailRouter', () => ({sendPortalEmail:jest.fn(),loadEmailRegistry:jest.fn(async()=>({}))}));
const {validateManifest,manifestCsv,batchPayload,sendBatch,recordAllSchoolDtfForSo,sourceFingerprint} = require('../../netlify/functions/_allSchoolDtf');
const crypto = require('crypto');
const bytes = Buffer.from('exact illustrator production file');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const sourceItem = {id:'source1',qty:4,size:'M',sku:'A1',player_name:'STEVE',player_number:'12'};
const manifest = {so_id:'SO-1',job_id:'J-1',supplier_id:'Astra Sport',source_items:[{id:sourceItem.id,fingerprint:sourceFingerprint(sourceItem)}],qty:4,art_name:'Mascot',width_in:8,height_in:10,placement:'Front',artwork:{bucket:'all-school-art',path:'private/art.ai',name:'mascot.ai',sha256:sha},garments:[{sku:'A1',size:'M',qty:4,names:['STEVE'],numbers:['12']}]};
const batch = {id:'batch-1',status:'queued',supplier_snapshot:{email:'configured@example.com'},manifest:[manifest]};
function storageAdmin(file=bytes) {return {from:table=>{const q={select:()=>q,eq:()=>q,in:async()=>({data:table==='webstore_order_items'?[sourceItem]:table==='so_jobs'?[{so_id:'SO-1',id:'J-1',art_status:'art_complete',dtf_prints_status:'needed'},{so_id:'SO-1',id:'J-2',art_status:'art_complete',dtf_prints_status:'needed'}]:[{so_id:'SO-1',status:'batched'}]})};return q;},storage:{from:jest.fn(()=>({download:jest.fn(async()=>({data:{arrayBuffer:async()=>file}}))}))}};}
function sendAdmin(claimed=true) {
 const admin = storageAdmin(); admin.updates=[];
 admin.from=jest.fn(table=>{let value;const q={update:v=>{value=v;admin.updates.push({table,value:v});return q;},eq:()=>q,in:async()=>({data:table==='webstore_order_items'?[sourceItem]:table==='so_jobs'?[{so_id:'SO-1',id:'J-1',art_status:'art_complete',dtf_prints_status:'needed'},{so_id:'SO-1',id:'J-2',art_status:'art_complete',dtf_prints_status:'needed'}]:[{so_id:'SO-1',status:'batched'}]}),select:()=>value ? Promise.resolve({data:claimed?[{id:'batch-1'}]:[]}) : q,then:resolve=>resolve({data:[],error:null})};return q;});
 return admin;
}
test('requires production ai, saved fingerprint, dimensions, supplier and placement',()=>{
 expect(validateManifest(manifest)).toEqual([]);
 expect(validateManifest({...manifest,width_in:0,artwork:{path:'mock.png'}}).length).toBeGreaterThanOrEqual(3);
});
test('CSV contains exact size roster and neutralizes spreadsheet formulas',()=>{
 const csv=manifestCsv([{...manifest,art_name:'=IMPORTDATA("bad")'}]);
 expect(csv).toContain("'=IMPORTDATA");expect(csv).toContain('STEVE');expect(csv).toContain('12');expect(csv).toContain(sha);
});
test('attaches one exact ai per unique saved artwork + manifest without downloading twice',async()=>{
 const admin=storageAdmin();
 const payload=await batchPayload(admin,{...batch,manifest:[manifest,{...manifest,job_id:'J-2'}]});
 expect(payload.attachment).toHaveLength(2);
 expect(payload.attachment[1].content).toBe(bytes.toString('base64'));
 expect(admin.storage.from).toHaveBeenCalledTimes(1);
});
test('changed production artwork blocks the send before the durable claim',async()=>{
 const admin=sendAdmin();admin.storage=storageAdmin(Buffer.from('changed')).storage;
 const send=jest.fn(); const r=await sendBatch(admin,batch,{enabled:true,send});
 expect(r.sent).toBe(false);expect(r.error).toMatch(/changed/);expect(send).not.toHaveBeenCalled();expect(admin.updates.filter(u=>u.value.status==='sending')).toHaveLength(0);
});
test('concurrent loser never sends after claim returns no rows',async()=>{
 const admin=sendAdmin(false);const send=jest.fn();
 expect(await sendBatch(admin,batch,{enabled:true,send})).toMatchObject({sent:false,reason:'Already claimed'});
 expect(send).not.toHaveBeenCalled();
});
test('uncertain provider response retains unknown status and is never retryable',async()=>{
 const admin=sendAdmin();const send=jest.fn(async()=>({status:502,uncertain:true,error:'timeout'}));
 expect(await sendBatch(admin,batch,{enabled:true,send})).toMatchObject({sent:false,status:'unknown'});
 expect(admin.updates[1].value.status).toBe('unknown');
 await sendBatch(admin,{...batch,status:'unknown'},{enabled:true,send});expect(send).toHaveBeenCalledTimes(1);
});
test('an accepted response with no receipt is unknown, never blocked/retryable',async()=>{
 const admin=sendAdmin();const r=await sendBatch(admin,batch,{enabled:true,send:async()=>({status:201})});
 expect(r.status).toBe('unknown');
});
test('saving provider receipt failure preserves claim and reports uncertainty',async()=>{
 const admin=sendAdmin(); const old=admin.from;
 admin.from=table=>{const q=old(table);if(table==='all_school_dtf_batches')q.then=resolve=>resolve({error:{message:'db offline'}});return q;};
 const r=await sendBatch(admin,batch,{enabled:true,send:async()=>({status:201,messageId:'actual'})});
 expect(r).toMatchObject({sent:false,uncertain:true});expect(admin.updates[0].value.status).toBe('sending');
});
test('global opt in protects default build configuration',async()=>{
 const admin=sendAdmin();const send=jest.fn();await sendBatch(admin,batch,{enabled:false,send});
 expect(send).not.toHaveBeenCalled();expect(admin.updates.filter(u=>u.value.status==='sending')).toHaveLength(0);
});
function recorder({reserved=3,template=false,numbers=false}={}) {
 const cfg={code:'MASCOT',label:'Paid art',supplier_id:'Astra Sport',width_in:8,height_in:10,production_file:manifest.artwork};
 const data={
  webstore_orders:[{id:'o1',store_id:'s1',so_id:'SO-1',status:'batched'}],webstores:{id:'s1',org_type:'all_school',all_school_settings:{}},
  so_jobs:[{id:'J-1',art_status:'art_complete',total_units:5,deco_type:'dtf',items:[{item_idx:0}],positions:'Front'}],
  so_items:[{id:'i1',item_index:0,sku:'A1',sizes:{M:5},source_webstore_item_ids:['source1'],recipe_snapshot:{transfer_inventory:[cfg],personalization_template:template?{...cfg,font:'Varsity',print_color:'White',uppercase:true}:null}}],
  so_item_decorations:[{so_item_id:'i1',type:'dtf',transfer_code:'MASCOT'}],
  all_school_dtf_requests:[],all_school_decoration_allocations:[{order_item_id:'source1',transfer_code:'MASCOT',required_qty:5,reserved_qty:reserved,status:'reserved'}],
  job_stage_events:[{job_id:'J-1',payload:{logo_ref:template?'name:wp1':'xfer:MASCOT'}}],
  webstore_order_items:[{id:'source1',sku:'A1',size:'M',qty:5,player_name:'Steve',player_number:'12'}]
 };
 if(numbers) { data.job_stage_events[0].payload.logo_ref='numbers:wp1'; data.so_items[0].recipe_snapshot.personalization_template.number_template={...cfg,width_in:6,height_in:8,placement:'Back',font:'Number Font',print_color:'Gold'}; }
 const admin=storageAdmin();admin.writes=[];
 admin.from=table=>{let single=false;const q={select:()=>q,eq:()=>q,in:()=>q,limit:()=>q,maybeSingle:()=>{single=true;return q;},upsert:v=>{admin.writes.push(v);return q;},then:resolve=>resolve({data:single?data[table]:data[table],error:null})};return q;};
 return admin;
}
test('stocked designs order only authoritative allocation shortfall and freeze paid art',async()=>{
 const admin=recorder();await recordAllSchoolDtfForSo(admin,'SO-1');
 expect(admin.writes).toHaveLength(1);expect(admin.writes[0].qty).toBe(2);
 expect(admin.writes[0].manifest.garments[0].qty).toBe(2);expect(admin.writes[0].manifest.art_name).toBe('Paid art');expect(admin.writes[0].manifest.artwork.sha256).toBe(sha);
});
test('fully reserved decoration stock never creates a supplier request',async()=>{
 const admin=recorder({reserved:5});await recordAllSchoolDtfForSo(admin,'SO-1');expect(admin.writes).toHaveLength(0);
});
test('personalization is full quantity and names reference the original exact base template',async()=>{
 const admin=recorder({reserved:5,template:true});await recordAllSchoolDtfForSo(admin,'SO-1');
 expect(admin.writes[0].qty).toBe(5);expect(admin.writes[0].manifest.garments[0].names).toEqual(['STEVE','STEVE','STEVE','STEVE','STEVE']);
 expect(admin.writes[0].manifest.artwork_role).toContain('Base .ai template');
});
test('custom numbers use their separate frozen specification without name dimensions',async()=>{
 const admin=recorder({template:true,numbers:true});await recordAllSchoolDtfForSo(admin,'SO-1');
 expect(admin.writes[0].manifest).toMatchObject({width_in:6,height_in:8,font:'Number Font',print_color:'Gold',placement:'Back'});
 expect(admin.writes[0].manifest.garments[0]).toMatchObject({numbers:['12','12','12','12','12'],names:[]});
});
test('cancelled source order prevents supplier send before claim',async()=>{
 const admin=sendAdmin();const original=admin.from;
 admin.from=table=>{const q=original(table);if(table==='webstore_orders')q.in=async()=>({data:[{so_id:'SO-1',status:'cancelled'}]});return q;};
 const send=jest.fn();const r=await sendBatch(admin,batch,{enabled:true,send});
 expect(r.error).toMatch(/cancelled/);expect(send).not.toHaveBeenCalled();expect(admin.updates.filter(u=>u.value.status==='sending')).toHaveLength(0);
});
test('partial cancellation or changed garment quantities blocks frozen batch before sending',async()=>{
 for (const change of [{qty:3},{line_status:'refunded'},{player_name:'CHANGED'},{production_recipe:{changed:true}}]) {
  const admin=sendAdmin();const original=admin.from;
  admin.from=table=>{const q=original(table);if(table==='webstore_order_items')q.in=async()=>({data:[{...sourceItem,...change}]});return q;};
  const send=jest.fn();const result=await sendBatch(admin,batch,{enabled:true,send});
  expect(result.error).toMatch(/changed/);expect(send).not.toHaveBeenCalled();expect(admin.updates.filter(u=>u.value.status==='sending')).toHaveLength(0);
 }
});
test('changed shortfall or print readiness prevents an obsolete supplier order',async()=>{
 for (const mode of ['allocation','received']) {
  const admin=sendAdmin();const original=admin.from;
  admin.from=table=>{const q=original(table);if(table==='all_school_decoration_allocations')q.in=async()=>({data:[{id:7,required_qty:5,reserved_qty:5,status:'reserved'}]});if(mode==='received'&&table==='so_jobs')q.in=async()=>({data:[{so_id:'SO-1',id:'J-1',art_status:'art_complete',dtf_prints_status:'received'}]});return q;};
  const send=jest.fn();const result=await sendBatch(admin,{...batch,manifest:[{...manifest,transfer_code:'MASCOT',allocation_shortfalls:[{id:7,qty:2}]}]},{enabled:true,send});
  expect(result.error).toMatch(/changed|already/);expect(send).not.toHaveBeenCalled();expect(admin.updates.filter(u=>u.value.status==='sending')).toHaveLength(0);
 }
});
test('production setup approval is checked again immediately before supplier send',async()=>{
 const admin=sendAdmin();const original=admin.from;
 admin.from=table=>{const q=original(table);if(table==='so_jobs')q.in=async()=>({data:[{so_id:'SO-1',id:'J-1',art_status:'needs_art',dtf_prints_status:'needed'}]});return q;};
 const send=jest.fn();const result=await sendBatch(admin,batch,{enabled:true,send});
 expect(result.error).toMatch(/unapproved/);expect(send).not.toHaveBeenCalled();expect(admin.updates[0].value.status).toBe('blocked');
});
