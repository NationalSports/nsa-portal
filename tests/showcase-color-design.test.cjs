const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { renderColorDesigns,decoratedReference,colorKey,colorSignature,prompt } = require('../netlify/functions/_showcaseColorDesign');
const { generateWithOpenAI } = require('../netlify/functions/_showcase');
async function fixture() {
 const photo={bytes:await sharp({create:{width:80,height:100,channels:4,background:'#334455'}}).png().toBuffer(),contentType:'image/png'};
 const logo={bytes:await sharp({create:{width:20,height:8,channels:4,background:'#ffcc00'}}).png().toBuffer(),contentType:'image/png'};
 const members=['Black','Royal'].flatMap((color,c)=>Array.from({length:3},(_,d)=>({webstore_product_id:`${c}-${d}`,product_id:`p${c}`,name:'Women’s Pullover Hoodie',color,supplier_image_url:'photo'+c,settings:{decoration_type:'embroidery',revision_notes:''},decorations:[{art_url:'logo',placement:'full_front',x:50,y:43,w:30,side:'front'}]})));
 const calls=[],images=new Map(),saves=[];
 let cache;
 const opts={members,fetched:new Map([['photo0',photo],['photo1',photo]]),art:new Map([['logo',logo]]),storeArt:[],current:async()=>{},
 generate:async req=>{calls.push(req);return {...photo,model:'test',quality:req.quality,usage:{output_tokens:20}};},
 fetchImage:async url=>images.get(url),upload:async(bytes,path)=>{const url='stored/'+path;images.set(url,{bytes,contentType:'image/png'});return url;},cache:async value=>{cache=JSON.parse(JSON.stringify(value));saves.push(cache);}};
 return {opts,calls,images,saves,getCache:()=>cache};
}
test('each color gets one high-quality finished image; subsequent designs edit that same image at medium quality',async()=>{
 const f=await fixture();const r=await renderColorDesigns(f.opts);
 assert.equal(r.outputs.length,6);assert.equal(f.calls.length,6);
 assert.deepEqual(f.calls.map(c=>c.quality),['high','medium','medium','high','medium','medium']);
 assert.ok(f.calls.slice(1,3).every(c=>c.images[0].bytes.equals(f.images.get('stored/0-0-color-base').bytes)));
 assert.equal(Object.keys(f.getCache().color_bases).length,2);
 assert.ok(r.outputs.every(o=>o.qa.generation_usage.output_tokens===20 && o.qa.review_mode==='full_image'));
 assert.match(f.calls[1].editPrompt,/Replace ONLY customer\/team decoration/);
 assert.doesNotMatch(f.calls[0].editPrompt,/chroma green|sample RGB|landmark|centerline points/);
});
test('cached colors and a single selected combination use one edit and do not regenerate other colors',async()=>{
 const f=await fixture();await renderColorDesigns(f.opts);f.calls.length=0;
 const r=await renderColorDesigns({...f.opts,members:[f.opts.members[4]],cached:f.getCache()});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].quality,'medium');assert.equal(r.outputs[0].webstore_product_id,'1-1');
 assert.equal(Object.keys(f.getCache().color_bases).length,2);
});
test('pose instructions or a changed supplier photo invalidate only the affected color',async()=>{
 const f=await fixture();await renderColorDesigns(f.opts);f.calls.length=0;
 const member={...f.opts.members[0],settings:{...f.opts.members[0].settings,revision_notes:'Softer lighting'}};
 await renderColorDesigns({...f.opts,members:[member],cached:f.getCache()});
 assert.equal(f.calls[0].quality,'high');
 assert.notEqual(colorSignature(member),colorSignature(f.opts.members[0]));
 assert.notEqual(colorSignature({...member,supplier_image_url:'replacement'}),colorSignature(member));
 assert.notEqual(colorKey(member),colorKey(f.opts.members[3]));
});
test('a failed initial color image does not cause repeated paid attempts and other colors continue',async()=>{
 const f=await fixture();const original=f.opts.generate;
 f.opts.generate=async req=>{if(req.product.color==='Black'){f.calls.push(req);throw new Error('Provider unavailable');}return original(req);};
 const r=await renderColorDesigns(f.opts);
 assert.equal(f.calls.filter(c=>c.product.color==='Black').length,1);
 assert.equal(r.outputs.filter(o=>o.error).length,3);assert.equal(r.outputs.filter(o=>o.url).length,3);
});
test('an individual design edit failure keeps its seed and lets other designs continue',async()=>{
 const f=await fixture();const original=f.opts.generate;
 f.opts.generate=async req=>{if(req.product.webstore_product_id==='0-1')throw new Error('Edit failed');return original(req);};
 const r=await renderColorDesigns(f.opts);
 assert.equal(r.outputs.filter(o=>o.error).length,1);assert.equal(r.outputs.filter(o=>o.url).length,5);
 assert.ok(f.getCache().color_bases[colorKey(f.opts.members[0])]);
});
test('cancellation after a paid call prevents uploads and subsequent calls',async()=>{
 const f=await fixture();let canceled=false;
 const generate=f.opts.generate;
 await assert.rejects(renderColorDesigns({...f.opts,current:async()=>{if(canceled)throw new Error('Canceled');},generate:async req=>{const result=await generate(req);canceled=true;return result;}}),/Canceled/);
 assert.equal(f.calls.length,1);assert.equal(f.images.size,0);
});
test('decorated reference uses the exact saved frame and logo pixel colors without geometry analysis',async()=>{
 const f=await fixture();const image=await decoratedReference(f.opts.fetched.get('photo0'),f.opts.members[0],f.opts.art);
 const {data,info}=await sharp(image.bytes).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,1000);assert.equal(info.height,1250);
 const at=(x,y)=>Array.from(data.slice((y*1000+x)*info.channels,(y*1000+x)*info.channels+3));
 assert.deepEqual(at(500,538),[255,204,0]);assert.deepEqual(at(500,450),[51,68,85]);
 await assert.rejects(decoratedReference(f.opts.fetched.get('photo0'),{...f.opts.members[0],decorations:[{art_url:'logo',x:0,y:0,w:50}]},f.opts.art),/outside/);
 assert.match(prompt(f.opts.members[0],'color_base',[]),/Women|women/);
 assert.match(prompt(f.opts.members[0],'color_base',[]),/hood rests DOWN/);
});
test('OpenAI edit request sends the explicit quality and retains reported usage',async()=>{
 const f=await fixture();const oldFetch=global.fetch,oldKey=process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY='unit-test-key';
 try {
  const qualities=[];
  global.fetch=async(url,req)=>{qualities.push(req.body.get('quality'));assert.equal(req.body.getAll('image[]').length,1);return {ok:true,json:async()=>({data:[{b64_json:f.opts.fetched.get('photo0').bytes.toString('base64')}],usage:{input_tokens:100,output_tokens:200}})};};
  const args={product:{},decorations:[],images:[f.opts.fetched.get('photo0')],editPrompt:'test'};
  const r=await generateWithOpenAI({...args,quality:'medium'});await generateWithOpenAI(args);
  assert.deepEqual(qualities,['medium','high']);assert.equal(r.usage.output_tokens,200);
  await assert.rejects(generateWithOpenAI({...args,quality:'cheap'}),/quality/);
 } finally {global.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});

test('batch queue splits colors into bounded jobs while keeping the full catalog guard and one notification batch',async()=>{
 const {queueFamilies,catalogSignature}=require('../netlify/functions/_showcaseFamily');
 const f=await fixture();const catalog=f.opts.members.map(m=>({...m,sku:'HOOD-'+m.color,brand:'Nike',kind:'product'}));
 const queued=[],dispatched=[];let notified=0;
 const admin={rpc:async(name,args)=>{assert.equal(name,'queue_showcase_family');queued.push(args);return {data:{family_key:args.p_key,generation_request_id:args.p_request,store_id:args.p_store}};}};
 const result=await queueFamilies({admin,store:{id:'store',store_art:[]},catalog,assets:[],all:true,baseUrl:'preview',dispatch:async(url,q)=>{assert.equal(queued.length,2);dispatched.push(q);},markPending:async()=>{notified++;}});
 assert.equal(result.queued_count,2);assert.equal(notified,1);assert.equal(dispatched.length,2);
 assert.ok(queued.every(q=>q.p_inputs.members.length===3 && new Set(q.p_inputs.members.map(m=>m.color)).size===1));
 assert.ok(queued.every(q=>q.p_inputs.catalog_signature===catalogSignature(catalog)));
 assert.equal(new Set(queued.map(q=>q.p_inputs.notification_batch_id)).size,1);
 assert.notEqual(queued[0].p_key,queued[1].p_key);
});
