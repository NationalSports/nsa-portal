const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {sampleFabric,prepareMaster,recolor,applyArtwork,encode}=require('../netlify/functions/_showcaseFamilyRender');
const {groupShowcaseItems,baseStyle}=require('../src/lib/showcaseFamilies');
const png = (data,w=100,h=100)=>sharp(data,{raw:{width:w,height:h,channels:4}}).png().toBuffer();
async function fixture() {
  const data=Buffer.alloc(100*100*4,255);
  for(let y=10;y<90;y++) for(let x=25;x<75;x++) {
    const i=(y*100+x)*4; data[i]=20;data[i+1]=100+y;data[i+2]=40;
  }
  // Manufacturer mark: a white region in the cloth.
  for(let y=30;y<35;y++) for(let x=65;x<70;x++) for(let c=0;c<3;c++) data[(y*100+x)*4+c]=255;
  return {data,bytes:await png(data)};
}
test('seven supplier styles group legacy rows and separate vendors / similar names',()=>{
  const items=['NKHM8045','NKFD9863','NKDR1499','NKFD9889','CN9402','PC90','PC90H'].flatMap((style)=>['Jet Black','White','Game Royal'].flatMap((color)=>['a','b','c'].map((logo)=>({webstore_product_id:style+color+logo,brand:'Nike',sku:style+'-'+color.replaceAll(' ','-'),color,variant_group_id:logo,supplier_image_url:'blank',name:'Hoodie'}))));
  items.push({...items.find((i)=>i.sku==='PC90-White'),webstore_product_id:'legacy',variant_group_id:null});
  assert.equal(groupShowcaseItems(items).length,7);
  assert.equal(groupShowcaseItems([...items,{...items[0],vendor_id:'other',webstore_product_id:'another'}]).length,8);
  assert.equal(baseStyle({sku:'PC90H-JET-BLACK',color:'Jet Black'}),'pc90h');
  assert.equal(baseStyle({sku:'PC90H-BLACK',color:'Jet Black'}),'');
});
test('color sampling excludes background and uses supplier pixels, including white/black',async()=>{
  for(const rgb of [[12,18,24],[235,234,229],[25,70,151]]) {
    const data=Buffer.alloc(100*100*4,255);
    for(let y=20;y<80;y++) for(let x=20;x<80;x++) for(let c=0;c<3;c++) data[(y*100+x)*4+c]=rgb[c];
    assert.deepEqual((await sampleFabric(await png(data),[[.3,.3,.1,.1],[.6,.6,.1,.1]])).rgb,rgb);
  }
  await assert.rejects(sampleFabric((await fixture()).bytes,[[.99,.1,.1,.1],[.2,.2,.1,.1]]),/outside/);
});
test('color changes preserve geometry, background and manufacturer mark exactly',async()=>{
  const {data,bytes}=await fixture();
  const master=await prepareMaster(bytes,{protected_regions:[],logo_occluders:[]});
  const black=recolor(master,[15,18,20]), white=recolor(master,[230,230,230]);
  for(let i=0;i<master.mask.length;i++) if(!master.mask[i]) {
    assert.deepEqual(black.subarray(i*4,i*4+4),data.subarray(i*4,i*4+4));
    assert.deepEqual(white.subarray(i*4,i*4+4),data.subarray(i*4,i*4+4));
  }
  assert.notEqual(black[(20*100+40)*4],black[(80*100+40)*4]);
  assert.notEqual(white[(20*100+40)*4],white[(80*100+40)*4]);
  assert.equal((await sharp(await encode(white,master)).metadata()).width,100);
});
test('only logo pixels change between designs, and a drawstring occludes artwork',async()=>{
  const {bytes}=await fixture();
  const master=await prepareMaster(bytes,{protected_regions:[],logo_occluders:[[[.48,.1],[.52,.1],[.52,.8],[.48,.8]]]});
  const before=recolor(master,[20,60,140]), after=Buffer.from(before);
  const logo=Buffer.alloc(40*20*4,0);
  for(let y=1;y<19;y++)for(let x=1;x<39;x++){const i=(y*40+x)*4;logo[i]=240;logo[i+1]=190;logo[i+3]=255;}
  await applyArtwork(after,master,await png(logo,40,20),[[.3,.4],[.7,.4],[.7,.6],[.3,.6]],'tackle_twill');
  assert.deepEqual(after.subarray((50*100+50)*4,(50*100+50)*4+4),before.subarray((50*100+50)*4,(50*100+50)*4+4));
  assert.notDeepEqual(after.subarray((50*100+40)*4,(50*100+40)*4+4),before.subarray((50*100+40)*4,(50*100+40)*4+4));
  for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(x<30||x>=70||y<40||y>=60)assert.deepEqual(after.subarray((y*100+x)*4,(y*100+x)*4+4),before.subarray((y*100+x)*4,(y*100+x)*4+4));
});
test('non-chroma master is rejected rather than tinting white background',async()=>{
  const bytes=await sharp({create:{width:100,height:100,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(prepareMaster(bytes,{protected_regions:[],logo_occluders:[]}),/mask needs correction/);
});
