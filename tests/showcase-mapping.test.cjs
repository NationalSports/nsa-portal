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
