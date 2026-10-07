const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalize,priceProduct,exactMatch,finish,stockFor,queueWork,PILOT}=require('../../netlify/functions/_repEmailWork');
const pricing=require('../../src/lib/decoPricing');
test('extraction discards invented prices/ids, invalid quantities and excessive lines',()=>{
 const d=normalize({lines:Array.from({length:30},()=>({name:'Sweats',product_id:'injected',unit_sell:1,quantity:-1,sizes:{S:3,M:-1,L:'infinity'},decoration:'Shield'}))});
 assert.equal(d.lines.length,12);assert.deepEqual(d.lines[0].sizes,{S:3});assert.equal(d.lines[0].quantity,null);assert.equal(d.lines[0].product_id,undefined);assert.equal(d.lines[0].unit_sell,undefined);
});
test('uses shared tier, markup and clearance rules rather than model pricing',()=>{
 const p={id:'a',brand:'Adidas',retail_price:60,nsa_cost:20,category:'Footwear',pricing_group:'lockerroom'};
 assert.equal(priceProduct(p,{adidas_ua_tier:'A'}).unit_sell,pricing.rQ(60*(1-pricing.auTierDisc('A','lockerroom','Footwear'))));
 assert.equal(priceProduct({id:'x',brand:'Gildan',nsa_cost:10,is_clearance:true,clearance_cost:5},{catalog_markup:2}).unit_sell,10);
 assert.equal(priceProduct({id:'x',brand:'Gildan',nsa_cost:0},{}).unit_sell,null);
});
test('ambiguous products, colors and descriptions never silently become matches',()=>{
 const p={id:'a',sku:'AB123',color:'Black',brand:'Adidas'};
 assert.equal(exactMatch({sku:'AB123',color:'Grey'},[p]),null);
 assert.equal(exactMatch({name:'Backpack'},[p]),null);
 assert.equal(exactMatch({sku:'AB123'},[p,{...p,id:'b'}]),null);
 assert.equal(exactMatch({sku:'ab123',color:'black'},[p]),p);
});
test('missing sizes and mismatched totals are visible; unknown stock is not zero',async()=>{
 const d=finish({questions:[],customer_name:'School',lines:[{quantity:15,sizes:{M:10},product:{id:'p'},pricing:{unit_sell:20},decoration:'Logo'}]});
 assert.ok(d.missing.some(s=>s.includes('sizes total 10')));assert.ok(d.missing.some(s=>s.includes('decoration')));
 const unknown=await stockFor({from:()=>{throw Error('Must not query wrong supplier')}},{id:'p',brand:'Gildan',inventory_source:'click'});
 assert.equal(unknown.state,'unknown');assert.equal(unknown.sizes,undefined);
});
function memoryDb(){const rows=[];return {rows,from:()=>{
 let mode='select',patch,filters=[],ignore=false;
 const q={upsert(v){mode='upsert';patch=v;ignore=true;return q},update(v){mode='update';patch=v;return q},select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},single:()=>run(true),maybeSingle:()=>run(false),then(a,b){return run().then(a,b)}};
 async function run(single){if(mode==='upsert'){if(!rows.some(r=>r.team_member_id===patch.team_member_id&&r.gmail_thread_id===patch.gmail_thread_id))rows.push({...patch,id:'work1',updated_at:new Date().toISOString()});return {data:null,error:null}}
 const found=rows.filter(r=>filters.every(f=>f(r)));if(mode==='update')found.forEach(r=>Object.assign(r,patch));return {data:single!==undefined?(found[0]?{...found[0]}:null):found,error:null};}return q;
}}}
test('thread followups reuse the same work, preserve estimate link, ignore older imports and mark dispatch failures',async()=>{
 const admin=memoryDb(),oldFetch=global.fetch,oldURL=process.env.URL,oldSecret=process.env.INTERNAL_FUNCTION_SECRET;
 process.env.URL='https://nsa-portal.netlify.app';process.env.INTERNAL_FUNCTION_SECRET='test-only';let dispatched=0;global.fetch=async()=>{dispatched++;return {ok:true,status:202}};
 try{
 const row={id:'m1',team_member_id:PILOT,gmail_message_id:'gm1',gmail_thread_id:'thread',received_at:'2026-10-01T12:00:00Z',customer_id:'c1',status:'new'},event={headers:{host:'nsa-portal.netlify.app'}};
 const first=await queueWork(admin,row,event);assert.equal(dispatched,1);admin.rows[0].status='ready';admin.rows[0].estimate_id='EST-1001';
 await queueWork(admin,row,event);assert.equal(dispatched,1);
 const next=await queueWork(admin,{...row,id:'m2',received_at:'2026-10-02T12:00:00Z'},event);assert.equal(admin.rows.length,1);assert.equal(next.estimate_id,'EST-1001');assert.notEqual(next.revision,first.revision);
 admin.rows[0].status='ready';await queueWork(admin,row,event);assert.equal(admin.rows[0].source_insight_id,'m2');
 global.fetch=async()=>{throw Error('dispatch failed')};await assert.rejects(queueWork(admin,{...row,id:'m3',received_at:'2026-10-03T12:00:00Z'},event));assert.equal(admin.rows[0].status,'failed');
 assert.equal(await queueWork(admin,{...row,team_member_id:'other'},event),null);
 }finally{global.fetch=oldFetch;if(oldURL===undefined)delete process.env.URL;else process.env.URL=oldURL;if(oldSecret===undefined)delete process.env.INTERNAL_FUNCTION_SECRET;else process.env.INTERNAL_FUNCTION_SECRET=oldSecret;}
});
const fs=require('node:fs'),vm=require('node:vm');
test('public preparation endpoint authenticates and scopes every email to its owner',async()=>{
 for(const config of [{ok:false,status:401,error:'Unauthorized'},{ok:true,teamMemberId:'other'},{ok:true,teamMemberId:PILOT}]){
  const filters=[];let queued=false;
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},maybeSingle:async()=>({data:null})};
  const exports={};vm.runInNewContext(fs.readFileSync(require.resolve('../../netlify/functions/rep-email-work'),'utf8'),{exports,Buffer,console,require:id=>id==='crypto'?require('crypto'):id==='./_shared'?{corsHeaders:()=>({}),verifyUser:async()=>({...config,admin:{from:()=>q}})}:{PILOT,queueWork:async()=>{queued=true}}});
  const response=await exports.handler({httpMethod:'POST',body:JSON.stringify({action:'prepare',insightId:'someone-elses-email'})});
  assert.equal(response.statusCode,config.ok?(config.teamMemberId===PILOT?404:403):401);assert.equal(queued,false);
  if(config.teamMemberId===PILOT)assert.ok(filters.some(([k,v])=>k==='team_member_id'&&v===PILOT));
 }
});
test('background preparation rejects an unsigned public request',async()=>{
 let processed=false;const exports={};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../netlify/functions/rep-email-work-background'),'utf8'),{exports,Buffer,process:{env:{INTERNAL_FUNCTION_SECRET:'server-only'}},require:id=>id==='crypto'?require('crypto'):id==='./_shared'?{getSupabaseAdmin:()=>({}),safeEqualStr:(a,b)=>a===b}:{processWork:async()=>{processed=true}}});
 const r=await exports.handler({httpMethod:'POST',headers:{},body:'{"id":"arbitrary"}'});assert.equal(r.statusCode,403);assert.equal(processed,false);
});

test('preparation saves with the work UUID, not the optional estimate revision',async()=>{
 for(const estimateRevision of [null,{snapshot:{customer:{name:'School'}}}]){
 const revision='12345678-1234-1234-1234-123456789abc',saved=[];
 const work={id:'work',revision,team_member_id:PILOT,source_insight_id:'email',customer_id:null,gmail_thread_id:'thread'};
 const admin={from(table){let patch,filters=[];const q={update(v){patch=v;return q},eq(k,v){filters.push([k,v]);return q},select(){return q},single:async()=>({data:table==='rep_email_insights'?{customer_id:null,status:'new'}:{}}),maybeSingle:async()=>({data:work}),then(resolve){saved.push({patch,filters});return Promise.resolve({}).then(resolve)}};return q;}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../netlify/functions/_repEmailWork'),'utf8'),{module,process:{env:{}},AbortSignal,fetch:async()=>({ok:true,json:async()=>({content:[{type:'text',text:'{"lines":[],"questions":[]}'}]})}),require:id=>id==='crypto'?require('crypto'):id==='./_repEmailRevision'?{normalizeRevision:()=>null,prepareRevision:async()=>estimateRevision,authored:x=>x}:id==='./_gmailAi'?{gmailFetch:async()=>({messages:[]})}:id==='./_repGoogle'?{accessTokenForLink:async()=> 'test'}:id==='./_shared'?{}:pricing});
 await module.exports.processWork(admin,'work',revision);
 assert.equal(saved.length,1);assert.equal(saved[0].patch.status,'ready');assert.ok(saved[0].filters.some(([key,value])=>key==='revision'&&value===revision));
 }
});
