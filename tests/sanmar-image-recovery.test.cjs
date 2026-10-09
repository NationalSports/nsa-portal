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
