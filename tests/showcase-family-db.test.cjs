const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require(process.env.SHOWCASE_PGLITE_PATH || '@electric-sql/pglite');
const {runFamilyJob,familyInputs}=require('../netlify/functions/_showcaseFamily');
const {groupShowcaseItems}=require('../src/lib/showcaseFamilies');
const store='11111111-1111-4111-8111-111111111111';
const request='22222222-2222-4222-8222-222222222222';
const request2='33333333-3333-4333-8333-333333333333';
const ids=Array.from({length:15},(_,i)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(i+1).padStart(12,'0')}`);
async function setup(decorated=false) {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table webstores(id uuid primary key);create table products(id text primary key);
 create table webstore_products(id uuid primary key,store_id uuid,product_id text,active boolean,kind text);`);
 const schema=fs.readFileSync('supabase/migrations/20260725025339_showcase_presentation_mode.sql','utf8');
 const table=schema.slice(schema.indexOf('create table if not exists public.webstore_showcase_assets'),schema.indexOf('create index if not exists'));
 await db.exec('create table team_members(id text primary key);'+table.replace("'failed'))","'failed','canceled'))"));
 await db.exec(fs.readFileSync('supabase/migrations/20261008144347_showcase_family_jobs.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261008151549_showcase_decoration_details.sql','utf8'));
 await db.query('insert into webstores values($1)',[store]);
 const members=ids.map((id,i)=>({webstore_product_id:id,product_id:'p'+i,name:'Nike Pullover Hoodie',sku:`HOOD-Color${Math.floor(i/3)}`,color:`Color${Math.floor(i/3)}`,brand:'Nike',standard_image_url:'supplier'+Math.floor(i/3),supplier_image_url:'supplier'+Math.floor(i/3),decorations:decorated?[{art_url:'logo.png',x:50,y:40,w:30,placement:'full_front'}]:[],settings:{decoration_type:'auto',revision_notes:''}}));
 for(const m of members){await db.query('insert into products values($1)',[m.product_id]);await db.query('insert into webstore_products values($1,$2,$3,true,\'product\')',[m.webstore_product_id,store,m.product_id]);}
 await db.exec(fs.readFileSync('supabase/migrations/20261009054310_showcase_source_repair.sql','utf8'));
 const group=groupShowcaseItems(members)[0];
 const inputs=familyInputs(group,[]);
 const queue=async(req=request,newBase=false)=>(await db.query('select queue_showcase_family($1,$2,$3,$4,$5) as result',[store,group.key,req,inputs,newBase])).rows[0].result;
 const move=async(action,payload={},req=request)=>(await db.query('select transition_showcase_family($1,$2,$3,$4,$5) as result',[store,group.key,req,action,payload])).rows[0].result;
 return {db,members,group,inputs,queue,move};
}
test('atomic family lifecycle: duplicate claim, cancellation, retries, cache and approved preservation',async()=>{
 const {db,members,inputs,queue,move}=await setup();
 try{
  await queue();
  await db.query("update webstore_showcase_assets set approved_showcase_image_url='old-approved',approved_detail_images='[{\"url\":\"old-detail\"}]' where webstore_product_id=$1",[ids[0]]);
  await assert.rejects(queue(),/already queued/);
  assert.ok(await move('claim'));
  assert.equal(await move('claim'),null);
  await move('cache',{signature:inputs.master_signature,url:'master',model:'test'});
  await move('cancel');
  assert.equal(await move('finish',{outputs:members.map((m)=>({webstore_product_id:m.webstore_product_id,url:'new',qa:{}}))}),null);
  assert.equal((await db.query("select count(*)::int as n from webstore_showcase_assets where status='canceled'")).rows[0].n,15);
  await queue(request2);
  const next=await move('claim',{},request2);assert.equal(next.master.url,'master');
  await assert.rejects(move('finish',{outputs:[{webstore_product_id:ids[0],url:'bad'}]},request2),/Incomplete/);
  assert.equal((await db.query("select count(*)::int as n from webstore_showcase_assets where status='generating'")).rows[0].n,15);
  await move('finish',{outputs:members.map((m)=>({webstore_product_id:m.webstore_product_id,url:'new',qa:{human_review_required:true}}))},request2);
  const rows=(await db.query('select * from webstore_showcase_assets order by webstore_product_id')).rows;
  assert.deepEqual(rows[0].approved_detail_images,[{url:'old-detail'}]);assert.equal(rows[0].approved_showcase_image_url,'old-approved');assert.equal(rows[0].showcase_image_url,'new');
  assert.ok(rows.every((r)=>r.status==='review'&&r.approval_status==='pending'));
  await queue(request,true);assert.equal((await move('claim')).master,null);
  const permissions=(await db.query("select has_function_privilege('anon','queue_showcase_family(uuid,text,uuid,jsonb,boolean)','execute') as anon,has_function_privilege('authenticated','transition_showcase_family(uuid,text,uuid,text,jsonb)','execute') as auth")).rows[0];
  assert.deepEqual(permissions,{anon:false,auth:false});
 }finally{await db.close();}
});
test('worker renders 15 combinations with one master generation, then reuses it',async()=>{
 const {db,members,group,queue}=await setup(true);
 let generated=0,uploaded=0;
 const admin={rpc:async(name,args)=>{
  try{const {rows}=await db.query(`select ${name}($1,$2,$3,$4,$5) as result`,[args.p_store,args.p_key,args.p_request,args.p_action,args.p_payload]);return {data:rows[0].result};}catch(error){return {error};}
 },storage:{from:()=>({upload:async()=>{uploaded++;return {};},getPublicUrl:(p)=>({data:{publicUrl:'https://storage/'+p}})})},from:()=>{throw new Error('Email disabled in fixture');}};
 const deps={getCatalog:async()=>members,fetchImage:async()=>({bytes:Buffer.from('image'),contentType:'image/png'}),
  generate:async()=>{generated++;return {bytes:Buffer.from('master'),contentType:'image/png',model:'test'};},
  analyze:async({analysisPrompt,images})=>analysisPrompt.startsWith('Verify artwork placement')?{model:'visual-check',analysis:{supported:true,reason:'Fixture guides align'}}:(analysisPrompt.startsWith('Inspect') || (assert.ok(images.slice(1).every(image=>image.contentType==='image/png')), assert.ok(Object.values(JSON.parse(analysisPrompt.split('PLACEMENTS=')[1])).every(p=>!('placement' in p))), assert.ok(Object.keys(JSON.parse(analysisPrompt.split('PLACEMENTS=')[1])).every(id=>/^p[0-9]+$/.test(id)))), {model:'analysis',analysis:analysisPrompt.startsWith('Inspect')?{supported:true,colors:Array.from({length:images.length},(_,index)=>({index,patches:[],texture:'solid'}))}:{supported:true,protected_regions:[],logo_occluders:[],logo_strands:[],torso_anchors:Object.fromEntries(Object.keys(JSON.parse(analysisPrompt.split('PLACEMENTS=')[1])).map(id=>[id,{source:{neck:[.5,.3],hem:[.5,.9],left:[.2,.4],right:[.8,.4]},target:{neck:[.5,.2],hem:[.5,.9],left:[.25,.32],right:[.75,.32]}}])),placements:Object.fromEntries(Object.keys(JSON.parse(analysisPrompt.split('PLACEMENTS=')[1])).map(id=>[id,[[.3,.3],[.6,.3],[.6,.6],[.3,.6]]]))}}),
  render:{placementCheck:async bytes=>bytes,placementReference:async bytes=>bytes,validateArtwork:async()=>({}),applyArtwork:async()=>[[.3,.3],[.7,.3],[.7,.7],[.3,.7]],decorationDetail:async()=>Buffer.from('detail'),sampleFabric:async()=>({rgb:[20,40,60]}),prepareMaster:async()=>({}),recolor:()=>Buffer.from('render'),encode:async()=>Buffer.from('png')}};
 try{
  const leader=await queue();
  const asset={...leader,analysis:{family:{key:group.key}}};
  assert.equal((await runFamilyJob(admin,asset,'https://site',deps)).status,'review');assert.equal(generated,1);assert.equal(uploaded,31);
  const row=(await db.query('select qa_result,approved_detail_images from webstore_showcase_assets limit 1')).rows[0];
  assert.equal(row.qa_result.placement_check.model,'visual-check');assert.equal(Object.keys(row.qa_result.placement_quads).length,5);assert.equal(Object.keys(row.qa_result.torso_anchors).length,5);assert.ok(Object.values(row.qa_result.placement_quads).every(q=>(q[0][1]+q[2][1])/2<.33));assert.equal(row.qa_result.detail_images.length,1);assert.deepEqual(row.approved_detail_images,[]);
  await runFamilyJob(admin,asset,'https://site',deps);assert.equal(generated,1);
  const next=await queue(request2);
  await runFamilyJob(admin,{...next,analysis:asset.analysis},'https://site',deps);
  assert.equal(generated,1);assert.equal(uploaded,61);
  const retry=await queue('00000000-0000-4000-8000-000000000099');
  const rejectedDeps={...deps,analyze:async request=>request.analysisPrompt.startsWith('Inspect') ? deps.analyze(request) : {analysis:{supported:false,reason:'Cannot map the leg placement'}}};
  await assert.rejects(runFamilyJob(admin,{...retry,analysis:asset.analysis},'https://site',rejectedDeps),/Cannot map the leg placement/);
  const saved=(await db.query('select master,status from webstore_showcase_families')).rows[0];
  assert.equal(saved.status,'failed');assert.equal(saved.master.mapping_diagnostics.attempts.length,2);
  assert.ok(saved.master.url);assert.equal(generated,1);
  const recover=await queue('00000000-0000-4000-8000-000000000100');
  await runFamilyJob(admin,{...recover,analysis:asset.analysis},'https://site',deps);
  assert.equal(generated,1);
  const canonical=(await db.query('select master from webstore_showcase_families')).rows[0].master;
  const full=familyInputs(group,[]);
  const single=familyInputs(group,[],undefined,ids[5]);
  single.shared_master=canonical;single.master_signature=full.master_signature;single.source=full.source;
  const before=(await db.query('select * from webstore_showcase_assets where webstore_product_id<>$1 order by id',[ids[5]])).rows;
  const singleKey=group.key+':image:'+ids[5];
  const singleRequest='00000000-0000-4000-8000-000000000101';
  const queued=(await db.query('select queue_showcase_family($1,$2,$3,$4,false) result',[store,singleKey,singleRequest,single])).rows[0].result;
  await assert.rejects(queue('00000000-0000-4000-8000-000000000102'),/already queued/);
  const uploadsBefore=uploaded;
  await runFamilyJob(admin,{...queued,analysis:{family:{key:singleKey}}},'https://site',deps);
  assert.equal(uploaded-uploadsBefore,2);assert.equal(generated,1);
  assert.deepEqual((await db.query('select * from webstore_showcase_assets where webstore_product_id<>$1 order by id',[ids[5]])).rows,before);

  const missingRequest='00000000-0000-4000-8000-000000000103';
  const skippedLeader=await queue(missingRequest);
  const missingDeps={...deps,fetchImage:async url=>{if(url==='supplier1')throw new Error('Photo missing');return deps.fetchImage(url);}};
  await runFamilyJob(admin,{...skippedLeader,analysis:asset.analysis},'https://site',missingDeps);
  const partial=(await db.query('select status,error_details from webstore_showcase_assets')).rows;
  assert.equal(partial.filter(r=>r.status==='review').length,12);
  assert.equal(partial.filter(r=>r.status==='failed'&&r.error_details.startsWith('Skipped')).length,3);
  const recoveredLeader=await queue('00000000-0000-4000-8000-000000000105');
  await runFamilyJob(admin,{...recoveredLeader,analysis:asset.analysis},'https://site',{
    ...missingDeps,recoverImage:async()=>({...await deps.fetchImage('current1'),sourceUrl:'current1'})
  });
  assert.equal((await db.query("select count(*)::int n from webstore_showcase_assets where status='review'")).rows[0].n,15,'recovered references survive catalog validation and finish the batch');
  assert.equal(members[3].supplier_image_url,'supplier1','recovery must not mutate catalog identity');
  const missingSourceLeader=await queue('00000000-0000-4000-8000-000000000104',true);
  await runFamilyJob(admin,{...missingSourceLeader,analysis:asset.analysis},'https://site',{...deps,fetchImage:async url=>{if(url==='supplier0')throw new Error('Missing first color');return deps.fetchImage(url);}});
  assert.equal((await db.query("select count(*)::int n from webstore_showcase_assets where status='review'")).rows[0].n,12);

 }finally{await db.close();}
});
