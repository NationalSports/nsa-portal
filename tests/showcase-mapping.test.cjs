const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeRegions}=require('../netlify/functions/_showcaseFamilyRender');
const {validatedMapping,masterPrompt,familyInputs}=require('../netlify/functions/_showcaseFamily');
const good=()=>({model:'test',analysis:{supported:true,protected_regions:[],logo_strands:[],logo_occluders:[],placements:{a:[[.3,.3],[.6,.3],[.6,.6],[.3,.6]]}}});
test('normalizes unambiguous point objects and numeric strings without guessing coordinate units',()=>{
 assert.deepEqual(normalizeRegions([[{x:'0.1',y:'.2'},{x:.2,y:.2},{x:.2,y:.3}]]),[[[.1,.2],[.2,.2],[.2,.3]]]);
 assert.equal(normalizeRegions([Array.from({length:48},(_,i)=>[.5+.1*Math.cos(i/48*2*Math.PI),.5+.1*Math.sin(i/48*2*Math.PI)])])[0].length,48);
 assert.throws(()=>normalizeRegions([[[10,20],[20,20],[20,30]]]),/coordinates/);
 assert.throws(()=>normalizeRegions([[[null,.2],[.2,.2],[.2,.3]]]),/coordinates/);
 assert.throws(()=>normalizeRegions([[[.1,.2,.3],[.2,.2],[.2,.3]]]),/exactly/);
});
test('malformed protected regions trigger one corrected analysis and retain the same images',async()=>{
 const requests=[];const images=[{bytes:Buffer.from('master')}];
 const result=await validatedMapping(async request=>{requests.push(request);const r=good();if(requests.length===1)r.analysis.protected_regions=[[[20,20],[30,20],[30,30]]];return r;},{images,analysisPrompt:'Map'}, {a:{}},async()=>{});
 assert.equal(requests.length,2);assert.equal(requests[1].images,images);assert.match(requests[1].analysisPrompt,/CORRECTION REQUIRED/);assert.equal(result.analysis.placements.a.length,4);
});
test('invalid placement also retries; repeated invalid output stops with actionable error',async()=>{
 let calls=0;
 await assert.rejects(validatedMapping(async()=>{calls++;const r=good();r.analysis.placements.a=[[.3,.3],[.2,.3],[.2,.6],[.3,.6]];return r;},{analysisPrompt:'Map'},{a:{}},async()=>{}),/saved base is retained/);
 assert.equal(calls,2);
});
test('hood-down athletic pose is fit aware and invalidates the old cached pose signature',()=>{
 assert.match(masterPrompt({name:'Mens hoodie'}),/hood MUST be DOWN/);
 assert.match(masterPrompt({name:'Mens hoodie'}),/moderately broad shoulders/);
 assert.match(masterPrompt({name:'Youth hoodie'}),/Child proportions/);
 assert.doesNotMatch(masterPrompt({name:'Youth hoodie'}),/Naturally strong adult male/);
 assert.match(masterPrompt({name:'Women hoodie'}),/athletic women/);
 const source={product_id:'p',webstore_product_id:'w',supplier_image_url:'url'};
 const input=familyInputs({items:[source]},[],{});
 const old=require('crypto').createHash('sha256').update(JSON.stringify(['showcase-family-v1','p','url'])).digest('hex');
 assert.notEqual(input.master_signature,old);
});
test('a false construction rejection is rechecked with product identity and all original references',async()=>{
 const requests=[];const images=[{bytes:Buffer.from('master')},{bytes:Buffer.from('supplier')}];
 const result=await validatedMapping(async request=>{requests.push(request);return requests.length===1?{analysis:{supported:false,reason:'men/unisex with no sleeve logo'}}:good();},{images,product:{name:"Nike Women's Sleeve Swoosh Hoodie",supplier_sku:'NKFD9889-Black'},analysisPrompt:'Map'}, {a:{}},async()=>{});
 assert.equal(requests.length,2);assert.equal(requests[1].images,images);
 assert.match(requests[0].analysisPrompt,/"fit":"women"/);
 assert.match(requests[1].analysisPrompt,/CORRECTION REQUIRED/);
 assert.match(requests[1].analysisPrompt,/genuine cut, pocket, seam or branding mismatch/);
 assert.equal(result.analysis.supported,true);
});
test('repeated rejection remains blocked, saves both diagnostic reasons and offers a saved-image retry',async()=>{
 let calls=0;
 await assert.rejects(validatedMapping(async()=>{calls++;return {analysis:{supported:false,reason:'green hoodie PLACEMENTS wrong pocket'}};},{analysisPrompt:'Map',product:{name:'Hoodie'}},{},async()=>{}),error=>{
   assert.match(error.message,/Automatic image review stopped/);assert.match(error.message,/Refresh images retries the saved image/);assert.equal(error.mappingDiagnostics.attempts.length,2);assert.equal(error.mappingDiagnostics.attempts[1].reason,'green hoodie PLACEMENTS wrong pocket');return true;
 });
 assert.equal(calls,2);
});
test('revision instructions reach the master prompt and invalidate the cached master',()=>{
 const source={product_id:'p',webstore_product_id:'w',supplier_image_url:'url'};
 const original=familyInputs({items:[source]},[],{});
 const revised=familyInputs({items:[source]},[],{revision_notes:'Soften lighting and keep the pose'});
 assert.notEqual(original.master_signature,revised.master_signature);
 assert.match(masterPrompt(revised.source),/Soften lighting and keep the pose/);
});
test('placement reference matches a contain-fitted 4:5 editor frame',async()=>{
 const sharp=require('sharp');const {placementReference}=require('../netlify/functions/_showcaseFamilyRender');
 const photo=await sharp({create:{width:100,height:200,channels:3,background:'#000000'}}).png().toBuffer();
 const {data,info}=await sharp(await placementReference(photo)).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,1000);assert.equal(info.height,1250);
 const pixel=(x,y)=>data[(y*info.width+x)*info.channels];
 assert.equal(pixel(100,625),255);assert.equal(pixel(500,625),0);assert.equal(pixel(900,625),255);
});
test('diffuse highlights preserve black fabric while retaining shaded folds',()=>{
 const {recolor}=require('../netlify/functions/_showcaseFamilyRender');
 const master={data:Buffer.from([20,90,30,255,30,180,55,255,40,250,60,255]),mask:[1,1,1],median:180,info:{width:3,height:1,channels:4}};
 const out=recolor(master,[24,24,24]);
 assert.ok(out[0]<24);assert.equal(out[4],24);assert.ok(out[8]>24 && out[8]<=31);
});

test('unambiguous numeric strings and object corners are normalized for mapped artwork',async()=>{
 const result=await validatedMapping(async()=>{const r=good();r.analysis.placements.a=[{x:'0.3',y:'0.3'},{x:'0.6',y:'0.3'},{x:'0.6',y:'0.6'},{x:'0.3',y:'0.6'}];return r;},{analysisPrompt:'Map'},{a:{}},async()=>{});
 assert.deepEqual(result.analysis.placements.a,good().analysis.placements.a);
});
test('missing placement keys retain the exact failed rule and never produce a review candidate',async()=>{
 await assert.rejects(validatedMapping(async()=>good(),{analysisPrompt:'Map'},{p1:{}},async()=>{}),error=>{
  assert.match(error.message,/Missing mapped artwork placement p1/);assert.equal(error.mappingDiagnostics.attempts.length,2);return true;
 });
});
