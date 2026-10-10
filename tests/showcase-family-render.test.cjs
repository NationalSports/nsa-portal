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

test('protected-brand polygon margins recolor instead of leaving a green halo',async()=>{
  const {bytes}=await fixture();
  const master=await prepareMaster(bytes,{protected_regions:[[[.62,.27],[.73,.27],[.73,.38],[.62,.38]]],logo_occluders:[]});
  const output=recolor(master,[20,60,140]);
  const brand=(32*100+67)*4, fabric=(36*100+67)*4;
  assert.deepEqual([...output.subarray(brand,brand+3)],[255,255,255]);
  assert.ok(output[fabric+2]>output[fabric+1], 'fabric next to the brand must be blue, not frozen green');
});

test('detail crop uses the exact finished pixels without inventing or upscaling texture',async()=>{
  const {decorationDetail}=require('../netlify/functions/_showcaseFamilyRender');
  const master=await prepareMaster((await fixture()).bytes,{protected_regions:[],logo_occluders:[]},600);
  const output=recolor(master,[20,60,140]);
  const bytes=await decorationDetail(output,master,[[.3,.3],[.7,.3],[.7,.7],[.3,.7]]);
  const detail=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
  assert.equal(detail.info.width,324);
  assert.equal(detail.info.height,324);
  for(let y=0;y<324;y++) assert.deepEqual(detail.data.subarray(y*324*4,(y+1)*324*4),output.subarray(((138+y)*600+138)*4,((138+y)*600+462)*4));
  await assert.rejects(decorationDetail(output,master,[[.3,.3],[.31,.3],[.31,.31],[.3,.31]]),/too small/);
});

test('royal, gold and neutral artwork retain source colors across fabric colors, shadows and finishes',async()=>{
 const master=await prepareMaster((await fixture()).bytes,{protected_regions:[],logo_occluders:[]});
 const palette=[[0,74,173],[255,196,0],[255,255,255],[0,0,0]];
 const logo=Buffer.alloc(40*40*4,0);
 for(let y=1;y<39;y++)for(let x=1;x<39;x++) {
   const rgb=palette[Math.floor(x/10)];const i=(y*40+x)*4;
   logo.set([...rgb,255],i);
 }
 const bytes=await png(logo,40,40);
 for(const finish of ['tackle_twill','embroidery','chenille','screen_print']) for(const fabric of [[10,10,10],[240,240,240],[0,74,173]]) {
   const output=recolor(master,fabric);
   await applyArtwork(output,master,bytes,[[.3,.4],[.7,.4],[.7,.8],[.3,.8]],finish);
   for(const y of [43,55,73]) for(const [index,x] of [35,45,55,65].entries())
     assert.deepEqual([...output.subarray((y*100+x)*4,(y*100+x)*4+3)],palette[index],`${finish}: artwork palette cannot change with garment color or shadow`);
 }
});

test('curved drawstring trace preserves logo beside the cord instead of cutting out its bounding box', async()=>{
 const {bytes}=await fixture();
 const master=await prepareMaster(bytes,{protected_regions:[],logo_occluders:[],logo_strands:[{points:[[.45,.3,.02],[.48,.4,.02],[.50,.5,.02],[.47,.6,.02],[.45,.7,.02]]}]});
 const before=recolor(master,[20,60,140]), output=Buffer.from(before);
 const logo=Buffer.alloc(40*40*4,0);
 for(let y=1;y<39;y++)for(let x=1;x<39;x++)logo.set([240,190,20,255],(y*40+x)*4);
 await applyArtwork(output,master,await png(logo,40,40),[[.3,.3],[.7,.3],[.7,.7],[.3,.7]],'tackle_twill',{finishRelief:true});
 const rgb=(buf,x,y)=>[...buf.subarray((y*100+x)*4,(y*100+x)*4+3)];
 const isLogo=(x,y)=>{const color=rgb(output,x,y);assert.ok(color[0]>210 && color[1]>165 && color[2]<45, 'source gold remains visible');};
 assert.deepEqual(rgb(output,50,50),rgb(before,50,50),'cord stays in front');
 isLogo(46,50);
 isLogo(54,50);
 isLogo(50,60);
 await assert.rejects(prepareMaster(bytes,{protected_regions:[],logo_occluders:[],logo_strands:[{points:[[.4,.3,.1],[.4,.4,.1],[.4,.5,.1]]}]}),/width .*at most 0.025/);
});

test('heather removes smooth lighting without manufacturing striped texture',async()=>{
  const data=Buffer.alloc(256*256*3);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++)for(let c=0;c<3;c++)data[(y*256+x)*3+c]=40+Math.floor(x/2)+Math.floor(y/8);
  const bytes=await sharp(data,{raw:{width:256,height:256,channels:3}}).png().toBuffer();
  const {grain}=await sampleFabric(bytes,[[.2,.2,.25,.25],[.5,.5,.25,.25]],'heather');
  assert.equal(grain.length,4096);
  assert.ok(Math.max(...grain.map(Math.abs))<=2,'smooth lighting must not become a repeating grain pattern');
});
test('heather retains real fine fabric variation at matching pixel coordinates',async()=>{
  const data=Buffer.alloc(256*256*3);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++)for(let c=0;c<3;c++)data[(y*256+x)*3+c]=80+((x*13+y*7)%19);
  const bytes=await sharp(data,{raw:{width:256,height:256,channels:3}}).png().toBuffer();
  const {grain}=await sampleFabric(bytes,[[.25,.25,.25,.25],[.5,.5,.25,.25]],'heather');
  const tile=await sharp(bytes).extract({left:64,top:64,width:64,height:64}).greyscale().raw().toBuffer();
  const blur=await sharp(tile,{raw:{width:64,height:64,channels:1}}).blur(2).raw().toBuffer();
  for(let i=0;i<4096;i++)assert.equal(grain[i],tile[i]-blur[i*3]);
  assert.ok(grain.some(v=>v>3)&&grain.some(v=>v< -3));
});

test('drawstring normalization accepts equivalent numbers without relaxing width protection',()=>{
 const {validateStrands}=require('../netlify/functions/_showcaseFamilyRender');
 const result=validateStrands([{points:[['0.4','0.2','0.01'],{x:.4,y:.3,width:.01},[.4,.4,.01]]}]);
 assert.deepEqual(result[0].points[0],[.4,.2,.01]);
 assert.deepEqual(result[0].points[1],[.4,.3,.01]);
 assert.throws(()=>validateStrands([{points:[[.4,.2,.1],[.4,.3,.1],[.4,.4,.1]]}]),/point 1: width 0.1/);
});

test('large heather patches retain light yarn instead of averaging into solid black',async()=>{
  const data=Buffer.alloc(512*512*3);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++)for(let c=0;c<3;c++)data[(y*512+x)*3+c]=((x*13+y*7)%11)<3?110:30;
  const bytes=await sharp(data,{raw:{width:512,height:512,channels:3}}).png().toBuffer();
  const sample=await sampleFabric(bytes,[[.1,.1,.25,.25],[.5,.5,.25,.25]],'solid','Black Heather');
  assert.equal(sample.texture,'heather');
  assert.ok(sample.rgb[0]>=39,'lighter yarn must contribute to the perceived base color');
  assert.ok(sample.grain.filter(v=>v>20).length>400,'fine bright yarn survives large supplier patches');
  const solid=await sampleFabric(bytes,[[.1,.1,.25,.25],[.5,.5,.25,.25]],'solid','Team Black');
  assert.equal(solid.grain,undefined,'black alone must not invent heather');
});
