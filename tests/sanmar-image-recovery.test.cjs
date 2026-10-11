const {test}=require('node:test');
const assert=require('node:assert/strict');
const {extractGarmentImages}=require('../netlify/functions/_background-workers/sanmar-flat-images-background')._internal;
const {createSanMarImageRecovery}=require('../netlify/functions/_sanmarImageRecovery');
const media=(color,tag,size)=>JSON.stringify({url:`//cdnp.sanmar.com/${color}-${tag}-${size}.jpg`,mediaCode:`10415_${color}-5-CN9402${tag}_${size}`});
test('discovers current high resolution flat photos, keeping the exact color and front side',()=>{
 const html=[media('TeamRoyal','FlatFront','1200W'),media('TeamRoyal','FlatBack','1200W'),media('TeamRoyal','ModelFront','1200W'),media('TeamBlack','FlatFront','1200W'),media('TeamRoyal','FlatFront','624Wx724H')].join(',');
 assert.deepEqual(extractGarmentImages(html,'10415',['teamroyal']),{front:'https://cdnp.sanmar.com/TeamRoyal-FlatFront-1200W.jpg',back:'https://cdnp.sanmar.com/TeamRoyal-FlatBack-1200W.jpg'});
 assert.equal(extractGarmentImages(html,'10415',['teamnavy']).front,null);
 assert.equal(extractGarmentImages(media('TeamRoyal','FormFront','624Wx724H'),'10415',['teamroyal']).front,'https://cdnp.sanmar.com/TeamRoyal-FormFront-624Wx724H.jpg');
});
test('does not substitute model shots for garment-only photos',()=>{
 assert.equal(extractGarmentImages(media('TeamRoyal','ModelFront','1200W'),'10415',['teamroyal']).front,null);
});
test('broken links recover by exact product identity with one discovery per style',async()=>{
 const members=['TeamRoyal','TeamBlack'].map(color=>({product_id:color,supplier_sku:`CN9402-${color}`,color,supplier_image_url:`https://cdnm.sanmar.com/old-${color}.jpg`}));
 let calls=0;
 const recover=createSanMarImageRecovery(members,async url=>({sourceUrl:url}),{coveoConfig:async()=>({}),scrapeStyle:async(c,style,products)=>{
 calls++;assert.equal(style,'CN9402');assert.equal(products.length,2);return {TeamRoyal:{front:'https://cdnp.sanmar.com/current-royal.jpg'}};
 }});
 assert.equal((await recover(members[0])).sourceUrl,'https://cdnp.sanmar.com/current-royal.jpg');
 assert.equal(await recover(members[1]),null);assert.equal(calls,1);
 assert.equal(await recover({...members[0],supplier_image_url:'https://other.example/photo.jpg'}),null);
});
test('discovered placeholders and failed images remain failures, never usable recovery',async()=>{
 const m={product_id:'p',sku:'ST100-Black',color:'Black',supplier_image_url:'https://cdnm.sanmar.com/old.jpg'};
 const recover=createSanMarImageRecovery([m],async()=>{throw Error('Supplier photo is unavailable')},{coveoConfig:async()=>({}),scrapeStyle:async()=>({p:{front:'https://cdnp.sanmar.com/placeholder.jpg'}})});
 await assert.rejects(recover(m),/unavailable/);
});

test('shared placeholder URLs recover separately by color and reuse only matching logo combinations',async()=>{
 const {loadSupplierImages}=require('../netlify/functions/_sanmarImageRecovery');
 const members=[['royal','Royal'],['black','Black'],['royal','Royal']].map(([product_id,color],i)=>({product_id,color,webstore_product_id:String(i),supplier_image_url:'https://cdnm.sanmar.com/placeholder.jpg'}));
 let fetches=0;const recovered=[];
 const result=await loadSupplierImages(members,async()=>{fetches++;throw Error('placeholder');},async m=>{recovered.push(m.product_id);return {sourceUrl:`https://cdnp.sanmar.com/${m.product_id}.jpg`};});
 assert.equal(fetches,1);assert.deepEqual(recovered,['royal','black']);
 assert.deepEqual(result.members.map(m=>m.supplier_image_url),['https://cdnp.sanmar.com/royal.jpg','https://cdnp.sanmar.com/black.jpg','https://cdnp.sanmar.com/royal.jpg']);
 assert.equal(result.skipped.length,0);assert.equal(result.fetched.size,2);
 assert.ok(members.every(m=>m.supplier_image_url.endsWith('placeholder.jpg')),'catalog snapshot stays unchanged');
});
test('missing URLs do not reuse another color and recovery errors skip only affected combinations',async()=>{
 const {loadSupplierImages}=require('../netlify/functions/_sanmarImageRecovery');
 const members=['royal','black'].map(product_id=>({product_id,color:product_id,webstore_product_id:product_id}));
 const result=await loadSupplierImages(members,async()=>{throw Error('should not fetch missing URL');},async m=>{if(m.product_id==='black')throw Error('supplier 403');return {sourceUrl:'https://cdnp.sanmar.com/royal.jpg'};});
 assert.equal(result.members.length,1);assert.equal(result.members[0].product_id,'royal');
 assert.match(result.skipped[0].error,/supplier 403/);assert.equal(result.skipped[0].webstore_product_id,'black');
});
