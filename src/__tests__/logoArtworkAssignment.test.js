/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.mock('../utils',()=>({fileDisplayName:f=>f.name||f.url||'',_isImgUrl:()=>true,_cloudinaryPdfThumb:()=>null,openFile:jest.fn(),fileUpload:jest.fn()}));
import { assignLogoArtwork, setLogoDetail, jobMissingLogoDetails, resolveLogoColorWay, logoDetailUrl, logoColorWayOptions, logoDetailBackground } from '../lib/logoDetail';
import JobGarmentMocks from '../JobGarmentMocks';

const fixture=()=>({id:'SO-test',jobs:[{id:'j',art_status:'art_in_progress'}],art_files:[{id:'a',name:'Bulldog',color_ways:[{id:'black',garment_color:'Black',inks:['Royal','White','Grey','Black']}]}],items:['White/Grey','Royal/White'].map((color,i)=>({sku:'P'+i,color,sizes:{M:2},decorations:[{kind:'art',art_file_id:'a',position:'Left Chest'}]}))});
const job={art_file_id:'a',items:[{item_idx:0,deco_idxs:[0]},{item_idx:1,deco_idxs:[0]}]};
test('sharing Black-named artwork never changes White/Grey or Royal/White garment backgrounds',()=>{
 const original=fixture();
 const next=assignLogoArtwork(original,{artId:'a',colorWayId:'black',allGarments:true}).order;
 expect(next.items.map(i=>i.color)).toEqual(['White/Grey','Royal/White']);
 expect(logoDetailBackground(next.items[0].color,'Black')).toMatchObject({label:'White',bg:'#ffffff',source:'garment'});
 const royal=logoDetailBackground(next.items[1].color,'Black');
 expect(royal).toMatchObject({label:'Royal',source:'garment'});
 expect(royal.bg).not.toBe(logoDetailBackground('Black').bg);
 expect(next.art_files[0].color_ways[0].inks).toEqual(['Royal','White','Grey','Black']);
});
test('reversible backgrounds use each side; unknown sides do not borrow artwork or side A colors',()=>{
 expect(logoDetailBackground('Royal/White','Black','A').label).toBe('Royal');
 expect(logoDetailBackground('Royal/White','Black','B')).toMatchObject({label:'White',bg:'#ffffff'});
 expect(logoDetailBackground('Royal','Black','B')).toMatchObject({known:false,source:'unknown'});
 expect(logoDetailBackground('Mystery','Black')).toMatchObject({known:false,source:'unknown'});
});
test('shared mock keeps a detail tile for every distinct garment, even when backgrounds match',()=>{
 const order=assignLogoArtwork(fixture(),{artId:'a',colorWayId:'black',allGarments:true}).order;
 order.items[1].color='White/Grey';
 order.art_files[0].mock_links={'P1|White/Grey':'P0|White/Grey'};
 order.art_files=setLogoDetail(order.art_files,'a','black','shared.png');
 const html=renderToStaticMarkup(<JobGarmentMocks job={job} order={order} getOrder={()=>order} onSave={jest.fn()}/>);
 expect(html).toContain('Logo detail on each garment color');
 expect(html).toContain('P0 · White/Grey · Bulldog');
 expect(html).toContain('P1 · White/Grey · Bulldog');
});
test('SO-2445 case: explicit same artwork survives JSON reload and satisfies both logo requirements',()=>{
 const original=fixture();
 expect(resolveLogoColorWay(original.art_files[0],null,'White/Grey')).toBeUndefined();
 const {order}=assignLogoArtwork(original,{artId:'a',colorWayId:'black',allGarments:true});
 order.art_files=setLogoDetail(order.art_files,'a','black','bulldog.png');
 const reopened=JSON.parse(JSON.stringify(order));
 expect(reopened.items.map(i=>i.decorations[0].color_way_id)).toEqual(['black','black']);
 expect(jobMissingLogoDetails(job,reopened)).toEqual([]);
 expect(original.items[0].decorations[0].color_way_id).toBeUndefined();
 expect(reopened.jobs).toEqual(original.jobs); // No approval / completion shortcut.
});
test('single garment assignment leaves other garment and unrelated designs untouched',()=>{
 const original=fixture();original.items[0].decorations.push({kind:'art',art_file_id:'other'});
 const {order}=assignLogoArtwork(original,{artId:'a',colorWayId:'black',garmentKey:'P0|White/Grey'});
 expect(order.items[0].decorations[0].color_way_id).toBe('black');
 expect(order.items[1]).toEqual(original.items[1]);
 expect(order.items[0].decorations[1]).toEqual(original.items[0].decorations[1]);
});
test('bulk assignment refuses to overwrite a different assigned artwork version',()=>{
 const order=fixture();order.items[1].decorations[0].color_way_id='other';
 expect(()=>assignLogoArtwork(order,{artId:'a',colorWayId:'black',allGarments:true})).toThrow(/different artwork/);
 expect(order.items[0].decorations[0].color_way_id).toBeUndefined();
});
test('reversible B assignments never change A or non-reversible garments',()=>{
 const order=fixture();order.items[0].decorations[0].reversible=true;
 const next=assignLogoArtwork(order,{artId:'a',colorWayId:'black',side:'B',allGarments:true}).order;
 expect(next.items[0].decorations[0].color_way_id_b).toBe('black');
 expect(next.items[0].decorations[0].color_way_id).toBeUndefined();
 expect(next.items[1]).toEqual(order.items[1]);
});
test('new version requires its own logo, even when an old default exists',()=>{
 const order=fixture();order.art_files[0].web_logo_url='old-default.png';
 const next=assignLogoArtwork(order,{artId:'a',garmentKey:'P0|White/Grey',newVersion:{id:'new',label:'Light garments',inks:['Navy']}}).order;
 expect(logoDetailUrl(next.art_files[0],'new')).toBe('');
 expect(next.items[0].decorations[0].color_way_id).toBe('new');
 expect(logoDetailUrl(setLogoDetail(next.art_files,'a','new','new.png')[0],'new')).toBe('new.png');
 expect(order.art_files[0].color_ways).toHaveLength(1);
});
test('stale and duplicate choices fail before changing the order',()=>{
 expect(()=>assignLogoArtwork(fixture(),{artId:'a',colorWayId:'gone',allGarments:true})).toThrow(/no longer exists/);
 expect(()=>assignLogoArtwork(fixture(),{artId:'gone',colorWayId:'black',allGarments:true})).toThrow(/removed/);
 expect(()=>assignLogoArtwork(fixture(),{artId:'a',newVersion:{id:'x',label:'Black',inks:['White']},allGarments:true})).toThrow(/already exists/);
 expect(()=>assignLogoArtwork(fixture(),{artId:'a',colorWayId:'black',garmentKey:'gone'})).toThrow(/No matching/);
});
test('retrying a new version after an optimistic failed save does not duplicate it',()=>{
 const choice={artId:'a',garmentKey:'P0|White/Grey',newVersion:{id:'retry-id',label:'Light version',inks:['Navy']}};
 const draft=assignLogoArtwork(fixture(),choice).order;
 const retried=assignLogoArtwork(draft,choice).order;
 expect(retried.art_files[0].color_ways).toHaveLength(2);
 expect(retried.items[0].decorations[0].color_way_id).toBe('retry-id');
});
test.each(['waiting_approval','production_files_needed','art_complete'])('does not change artwork underneath %s approval',art_status=>{
 const order=fixture();order.jobs=[{...job,art_status}];
 expect(()=>assignLogoArtwork(order,{artId:'a',colorWayId:'black',allGarments:true})).toThrow(/Recall\/request changes/);
 expect(order.items[0].decorations[0].color_way_id).toBeUndefined();
});
test('picker identifies ink/thread colors and unresolved shared garments retain their controls',()=>{
 const order=fixture();order.art_files[0].mock_links={'P1|Royal/White':'P0|White/Grey'};
 const html=renderToStaticMarkup(<JobGarmentMocks job={job} order={order} getOrder={()=>order} onSaveOrder={jest.fn()} onSave={jest.fn()}/>);
 expect((html.match(/Save artwork choice/g)||[])).toHaveLength(2);
 expect(html).toContain('Same artwork for all garments');
 expect(html).toContain('Royal, White, Grey, Black');
 expect(logoColorWayOptions(order.art_files[0])[0].colors).toBe('Royal, White, Grey, Black');
});
