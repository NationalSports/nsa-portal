const {artworkSetup,isAtOnceStore,variantCode}=require('./atOnceArtwork.shared');
const {productionRecipe}=require('../../netlify/functions/webstore-checkout');
const file=color=>({bucket:'all-school-art',path:color+'.ai',name:color+'.ai',sha256:(color==='black'?'a':'b').repeat(64)});
const variants=['black','white'].map(color=>({id:color,garment_color:color,knockout_color:color+' removed',reviewed:true,web_logo_url:color+'.png',production_file:file(color),width_in:10,height_in:8}));
const art={id:'crest',name:'School crest',deco_type:'dtf',web_logos:variants.map(v=>({url:v.web_logo_url,color_way:v.garment_color})),dtf_variants:variants};
const stock=variants.map(v=>({code:variantCode(art.id,v),kind:'design',decoration_type:'dtf',production_file:v.production_file,width_in:10,height_in:8,application_method:'heat_press',on_hand:3}));
const item=color=>({id:'wp-'+color,product_id:'p-'+color,sku:'SHIRT',color,image_url:'mock.png',decorations:[{art_id:'crest',type:'dtf',placement:'full_front'}]});
test.each(['club','all_school'])('%s is native 24/7, OMG is excluded',org_type=>{expect(isAtOnceStore({org_type})).toBe(true);expect(isAtOnceStore({org_type,source:'omg'})).toBe(false);});
test.each(['team',null,'webstore'])('%s does not acquire 24/7 requirements',org_type=>expect(isAtOnceStore({org_type})).toBe(false));
test('black and white garments resolve to distinct files, previews and inventory',()=>{
 for(const color of ['black','white']){
  const result=artworkSetup(item(color),stock,[art]);expect(result.error).toBe('');
  expect(result.item.transfer_codes).toEqual(['dtf-crest-'+color]);
  expect(result.item.decorations[0]).toMatchObject({art_url:color+'.png',dtf_variant_id:color,knockout_color:color+' removed'});
 }
});
test('case/spacing normalization is exact, not fuzzy color guessing',()=>{expect(artworkSetup(item(' BLACK '),stock,[art]).error).toBe('');expect(artworkSetup(item('Black Heather'),stock,[art]).error).toMatch(/variant/);});
test('mockup images do not satisfy mandatory Weblogos',()=>expect(artworkSetup(item('black'),stock,[{...art,web_logos:[],preview_url:'mock.png'}]).error).toMatch(/Weblogo/));
test('missing or ambiguous garment variants block',()=>{expect(artworkSetup(item('red'),stock,[art]).error).toMatch(/variant/);expect(artworkSetup(item('black'),stock,[{...art,dtf_variants:[variants[0],variants[0]]}]).error).toMatch(/one DTF/);});
test('wrong-color inventory cannot substitute for the right stock',()=>expect(artworkSetup(item('black'),[stock[1]],[art]).error).toMatch(/inventory/));
test('modified production file or dimensions block',()=>{expect(artworkSetup(item('black'),[{...stock[0],production_file:file('white')}],[art]).error).toMatch(/inventory/);expect(artworkSetup(item('black'),[{...stock[0],width_in:11}],[art]).error).toMatch(/inventory/);});
test('unreviewed, missing files and non-folder previews block',()=>{
 for(const patch of [{reviewed:false},{reviewed:'true'},{production_file:null},{knockout_color:''},{web_logo_url:'other.png'}])expect(artworkSetup(item('black'),stock,[{...art,dtf_variants:[{...variants[0],...patch}]}]).error).not.toBe('');
});
test.each(['twill','chenille'])('%s requires Weblogo but not a DTF variant',method=>{
 const folder={...art,deco_type:method,dtf_variants:[]};const garment={...item('black'),decorations:[{art_id:'crest',type:method,transfer_code:'material-stock'}]};
 const material=[{code:'material-stock',kind:'design',decoration_type:method}];
 const r=artworkSetup(garment,material,[folder]);expect(r.error).toBe('');expect(r.item.transfer_codes).not.toContain('dtf-crest-black');
 expect(artworkSetup(garment,material,[{...folder,web_logos:[]}]).error).toMatch(/Weblogo/);
});
test('a DTF library logo used as chenille uses its explicitly selected material stock',()=>{const i=item('black');i.decorations[0].transfer_code='chenille';expect(artworkSetup(i,[{code:'chenille',decoration_type:'chenille'}],[{...art,dtf_variants:[]}]).error).toBe('');});
test.each(['club','all_school'])('%s checkout freezes exact per-color art and stock in the recipe',org_type=>{
 const r=productionRecipe(item('black'),stock,[art],{org_type});expect(r.setup_error).toBeNull();expect(r.version).toBe(2);expect(r.transfer_inventory).toHaveLength(1);expect(r.transfer_inventory[0].production_file).toEqual(file('black'));
 const saved=JSON.parse(JSON.stringify(r));art.dtf_variants[0].web_logo_url='changed.png';expect(saved.decorations[0].art_url).toBe('black.png');art.dtf_variants[0].web_logo_url='black.png';
});
test('loose stock codes cannot bypass logo folder requirements',()=>expect(artworkSetup({...item('black'),decorations:[],transfer_codes:[stock[0].code]},stock,[art]).error).toMatch(/art folder/));

test('unused art folders do not acquire DTF requirements',()=>expect(artworkSetup({...item('black'),decorations:[]},[],[{id:'unused',deco_type:'dtf'}]).error).toBe(''));
test.each(['twill','chenille'])('%s frozen recipe preserves its own material and inventory',method=>{
 const row={...item('black'),transfer_codes:['material'],decorations:[{art_id:'crest',type:method,transfer_code:'material',art_url:'black.png'}]};
 const material={code:'material',kind:'design',decoration_type:method,application_method:'heat_press'};
 const recipe=productionRecipe(row,[material],[{...art,dtf_variants:[]}],{org_type:'all_school'});
 expect(recipe.setup_error).toBeNull();expect(recipe.decorations[0].type).toBe(method);expect(recipe.transfer_codes).toEqual(['material']);
});
function checkoutDb({folder=art,orgColor='black'}={}) {
 const tables={webstore_products:[{...item('wrong catalog display color'),id:'wp',active:true,kind:'single',retail_price:20,sizes_offered:['M']}],products:[{id:'p-wrong catalog display color',color:orgColor}],customers:[{art_files:[folder]}],webstore_transfers:stock};
 return {from:table=>{const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,then:resolve=>resolve({data:tables[table] || [],error:null})};return q;}};
}
test.each(['club','all_school'])('%s prices the authoritative garment color, not the shopper-supplied color',async org_type=>{
 const {priceCart}=require('../../netlify/functions/webstore-checkout');
 const result=await priceCart(checkoutDb(),{id:'store',customer_id:'customer',org_type},[{webstore_product_id:'wp',size:'M',qty:1,color:'white'}]);
 expect(result.error).toBeUndefined();expect(result.lines[0].color).toBe('black');expect(result.lines[0].production_recipe.transfer_codes).toEqual(['dtf-crest-black']);
});
test.each(['club','all_school'])('%s checkout blocks missing Weblogo/variant before payment',async org_type=>{
 const {priceCart}=require('../../netlify/functions/webstore-checkout');
 const result=await priceCart(checkoutDb({folder:{...art,web_logos:[]}}),{id:'store',customer_id:'customer',org_type},[{webstore_product_id:'wp',size:'M',qty:1}]);
 expect(result.error).toMatch(/Weblogo/);
});
test.each([{org_type:'team'},{org_type:'club',source:'omg'}])('regular and OMG checkout does not require DTF variants: %j',async store=>{
 const {priceCart}=require('../../netlify/functions/webstore-checkout');
 const result=await priceCart(checkoutDb({folder:{...art,web_logos:[]}}),{id:'store',customer_id:'customer',...store},[{webstore_product_id:'wp',size:'M',qty:1}]);
 expect(result.error).toBeUndefined();expect(result.lines[0].production_recipe).toBeUndefined();
});
