const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {saveSupplierPhoto}=require('../netlify/functions/_showcaseSource');
test('photo replacement is decoded, stored and scoped to one store and product color',async()=>{
 const filters=[];let uploaded;
 const admin={storage:{from:()=>({upload:async(path,bytes)=>{uploaded=bytes;return{};},getPublicUrl:()=>({data:{publicUrl:'https://storage/photo.png'}})})},from:table=>{assert.equal(table,'webstore_products');return{update:patch=>{assert.deepEqual(patch,{supplier_image_url:'https://storage/photo.png'});const q={eq:(key,value)=>{filters.push([key,value]);return q;},then:resolve=>resolve({})};return q;}};}};
 const bytes=await sharp({create:{width:200,height:250,channels:3,background:'blue'}}).jpeg().toBuffer();
 assert.equal(await saveSupplierPhoto(admin,'store',{product_id:'royal'},'data:image/jpeg;base64,'+bytes.toString('base64')),'https://storage/photo.png');
 assert.deepEqual(filters,[['store_id','store'],['product_id','royal']]);
 assert.equal((await sharp(uploaded).metadata()).format,'png');
});
test('invalid and undersized uploads never reach storage',async()=>{
 await assert.rejects(saveSupplierPhoto({},'store',{product_id:'p'},'https://example.com'),/Choose a PNG/);
 const bytes=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer();
 await assert.rejects(saveSupplierPhoto({},'store',{product_id:'p'},'data:image/png;base64,'+bytes.toString('base64')),/at least 200/);
});
