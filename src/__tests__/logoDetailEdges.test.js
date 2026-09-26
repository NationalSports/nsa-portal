/** @jest-environment node */
import React from 'react';
jest.mock('../utils',()=>({fileDisplayName:f=>f.name||f.url||'',_isImgUrl:()=>true,_cloudinaryPdfThumb:()=>null,openFile:jest.fn(),fileUpload:jest.fn()}));
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveLogoColorWay, logoDetailUrl, jobMissingLogoDetails, removeLogoDetail, logoDetailLibraryUpdate, setLogoDetail } from '../lib/logoDetail';
import JobGarmentMocks from '../JobGarmentMocks';
import { logoFileProblem } from '../GarmentMockCard';

const art={id:'a',name:'Logo',color_ways:[{id:'navy',garment_color:'Navy'},{id:'white',garment_color:'White'}],web_logos:[{url:'navy.png',color_way_id:'navy',color_way:'Navy'}]};
test('missing link resolves only an exact unique garment color, not the first image',()=>{
 expect(resolveLogoColorWay(art,null,' White ')).toBe('white');
 expect(logoDetailUrl(art,null)).toBe('');
 expect(resolveLogoColorWay(art,null,'Custom')).toBeUndefined();
 expect(resolveLogoColorWay(art,'stale','Navy')).toBeUndefined();
 expect(resolveLogoColorWay({...art,color_ways:[...art.color_ways,{id:'n2',garment_color:'Navy'}]},null,'Navy')).toBeUndefined();
 expect(resolveLogoColorWay(art,null,'Navy/White','B')).toBe('white');
});
test('approval remains blocked for missing or ambiguous colorway logos',()=>{
 const order={art_files:[art],items:[{sku:'P',color:'White',decorations:[{kind:'art',art_file_id:'a'}]}]};
 const job={art_file_id:'a',items:[{item_idx:0,deco_idxs:[0]}]};
 expect(jobMissingLogoDetails(job,order)).toEqual(['Logo (White)']);
 order.items[0].color='Custom';
 expect(jobMissingLogoDetails(job,order)[0]).toContain('choose color way');
 expect(()=>setLogoDetail([art],'a',undefined,'wrong.png')).toThrow(/Choose/);
});
test('removing a shared URL from one colorway preserves the others',()=>{
 const a={...art,web_logos:[{url:'same.png',color_way_id:'navy'},{url:'same.png',color_way_id:'white'}]};
 const next=removeLogoDetail([a],'a','same.png','navy')[0];
 expect(next.web_logos).toEqual([{url:'same.png',color_way_id:'white'}]);
 expect(next._artDeletes?.web_logos||[]).not.toContain('same.png');
});
test('stable design identity wins over names and rejects ambiguous legacy matches',()=>{
 const lib={id:'lib',design_id:'one',name:'Logo',deco_type:'embroidery'};
 const order={id:'order',design_id:'two',name:'Logo',deco_type:'embroidery'};
 expect(logoDetailLibraryUpdate([lib],[order],{artId:'order',url:'wrong.png'})).toBeNull();
 expect(logoDetailLibraryUpdate([lib],[{...order,design_id:'one',name:'Renamed'}],{artId:'order',url:'right.png'})[0].web_logo_url).toBe('right.png');
 expect(()=>logoDetailLibraryUpdate([{...lib,design_id:null},{...lib,id:'lib2',design_id:null}],[{...order,design_id:null}],{artId:'order',url:'wrong.png'})).toThrow(/Multiple/);
});
test('library deletion maps the selected colorway without removing another using that URL',()=>{
 const lib={...art,id:'lib',color_ways:[{id:'ln',garment_color:'Navy'},{id:'lw',garment_color:'White'}],web_logos:[{url:'same.png',color_way_id:'ln'},{url:'same.png',color_way_id:'lw'}]};
 const next=logoDetailLibraryUpdate([lib],[art],{artId:'a',colorWayId:'navy',removeUrl:'same.png'});
 expect(next[0].web_logos).toEqual([{url:'same.png',color_way_id:'lw'}]);
});
test('grouping never hides extra designs; safe groups offer separate mock',()=>{
 const a={...art,mock_links:{'B|Navy':'A|Navy'}};
 const items=['A','B'].map(sku=>({sku,color:'Navy',sizes:{M:1},decorations:[{kind:'art',art_file_id:'a',position:'Front'}]}));
 const job={art_file_id:'a',items:[{item_idx:0,deco_idxs:[0]},{item_idx:1,deco_idxs:[0]}]};
 let order={items,art_files:[a,{id:'b',name:'Back only on B'}]};
 const save=jest.fn(()=>true);
 const html=renderToStaticMarkup(<JobGarmentMocks job={job} order={order} getOrder={()=>order} onSave={save}/>);
 expect(html).toContain('Separate mock: B · Navy');
 items[1].decorations.push({kind:'art',art_file_id:'b',position:'Back'});
 job.items[1].deco_idxs.push(1);
 const extra=renderToStaticMarkup(<JobGarmentMocks job={job} order={order} getOrder={()=>order} onSave={save}/>);
 expect(extra).toContain('Back only on B mock');
 expect(extra).toContain('Give it its own mock');
});
test.each(['svg','webp','jpg','pdf'])('refuses %s consistently with PNG-only guidance',async ext=>{
 expect(await logoFileProblem({name:'logo.'+ext})).toMatch(/PNG/);
});
test('rejects oversized and unreadable PNGs rather than accepting unverifiable images',async()=>{
 expect(await logoFileProblem({name:'logo.png',size:11*1024*1024,type:'image/png'})).toMatch(/10 MB/);
 global.document={};
 try { expect(await logoFileProblem({name:'logo.png',type:'image/png'})).toMatch(/Could not read/); }
 finally { delete global.document; }
});
