const {test}=require('node:test');
const assert=require('node:assert/strict');
const {familyInputs,catalogSignature}=require('../netlify/functions/_showcaseFamily');
const {colorSignature}=require('../netlify/functions/_showcaseColorDesign');
test('single-image inputs isolate the selected combination and retain the full catalog guard',()=>{
 const members=[{product_id:'a',webstore_product_id:'one',supplier_image_url:'other-photo'},{product_id:'b',webstore_product_id:'two',supplier_image_url:'selected-photo'}];
 const group={key:'family',items:members};const full=familyInputs(group,[]);const single=familyInputs(group,[],undefined,'two');
 assert.equal(single.members.length,1);assert.equal(single.source.supplier_image_url,'selected-photo');assert.equal(single.catalog_signature,full.catalog_signature);assert.equal(single.catalog_family_key,'family');
 assert.throws(()=>familyInputs(group,[],undefined,'not-in-store'),/not found/);
});
test('shared cache namespace stays stable while per-color pose/source changes invalidate reuse',()=>{
 const source={product_id:'p',webstore_product_id:'w',supplier_image_url:'url'};
 const original=familyInputs({key:'family',items:[source]},[],{});
 const revised=familyInputs({key:'family',items:[source]},[],{revision_notes:'Soften lighting and keep pose'});
 assert.equal(original.master_signature,revised.master_signature);
 assert.notEqual(colorSignature(original.source),colorSignature(revised.source));
 assert.notEqual(colorSignature(original.source),colorSignature({...original.source,supplier_image_url:'replacement'}));
});
test('catalog signatures detect source or decoration edits but ignore row order',()=>{
 const a={webstore_product_id:'a',product_id:'p',supplier_image_url:'photo',decorations:[]};
 const b={...a,webstore_product_id:'b'};
 assert.equal(catalogSignature([a,b]),catalogSignature([b,a]));
 assert.notEqual(catalogSignature([a,b]),catalogSignature([{...a,decorations:[{art_url:'new'}]},b]));
});
test('supplier placeholder redirects cannot be passed to image generation as real garments',async()=>{
 const {fetchRemoteImage}=require('../netlify/functions/_showcase');
 await assert.rejects(fetchRemoteImage('https://cdnm.sanmar.com/adminjsps/Image404ErrorHandler.jsp?u=bad'),/Supplier photo is unavailable/);
 await assert.rejects(fetchRemoteImage('https://marketing.sanmar.com/catalog/images/ImageNotAvailable.jpg'),/Supplier photo is unavailable/);
});
