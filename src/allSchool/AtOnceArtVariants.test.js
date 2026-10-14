import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import AtOnceArtVariants from './AtOnceArtVariants';
import {supabase} from '../lib/supabase';
import {uploadProductionArtwork} from './productionArtwork';
jest.mock('../lib/supabase',()=>({supabase:{from:jest.fn()}}));
jest.mock('./productionArtwork',()=>({uploadProductionArtwork:jest.fn()}));
const file={bucket:'all-school-art',path:'black.ai',name:'black.ai',sha256:'a'.repeat(64)};
const art={id:'crest',name:'Crest',deco_type:'dtf',web_logos:[{url:'black.png',color_way:'Black shirt'}],prod_files:[file]};
const row={id:'wp',color:'Black',decorations:[{art_id:'crest',type:'dtf'}]};
const props={store:{id:'store',org_type:'all_school',customer_id:'customer'},catalog:[row],artwork:[art]};
function database({stale=false,existing=null}={}){
 const writes=[];
 supabase.from.mockImplementation(table=>{let action,value;const q={select:()=>q,eq:()=>q,single:()=>q,maybeSingle:()=>q,insert:v=>{action='insert';value=v;return q;},update:v=>{action='update';value=v;return q;},then:resolve=>{if(action)writes.push({table,action,value});return resolve({data:action?(stale&&table==='customers'?[]:[{id:'saved'}]):table==='customers'?{art_files:[art]}:existing,error:null});}};return q;});return writes;
}
beforeEach(()=>{jest.clearAllMocks();Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> 'new-version'}});});
function fill(){
 fireEvent.click(screen.getByRole('button',{name:'Set up DTF version'}));
 fireEvent.change(screen.getByLabelText('Matching Weblogo'),{target:{value:'black.png'}});
 fireEvent.change(screen.getByLabelText('Print width (in)'),{target:{value:'10'}});
 fireEvent.change(screen.getByLabelText('Print height (in)'),{target:{value:'8'}});
 fireEvent.change(screen.getByLabelText('Saved production file'),{target:{value:'black.ai'}});
}
test('only 24/7 DTF use shows color setup; unused folders and chenille do not',()=>{
 const {rerender}=render(<AtOnceArtVariants {...props} store={{org_type:'team'}}/>);expect(screen.queryByText(/24\/7 Weblogos/)).toBeNull();
 rerender(<AtOnceArtVariants {...props} catalog={[]}/>);expect(screen.queryByRole('button',{name:'Set up DTF version'})).toBeNull();
 rerender(<AtOnceArtVariants {...props} catalog={[{...row,decorations:[{art_id:'crest',transfer_code:'chenille'}]}]} transfers={[{code:'chenille',decoration_type:'chenille'}]}/>);expect(screen.queryByRole('button',{name:'Set up DTF version'})).toBeNull();
});
test('requires review, saves the art-folder version and zero-stock inventory, then links the matching garment',async()=>{
 const writes=database(),onSaved=jest.fn();render(<AtOnceArtVariants {...props} onSaved={onSaved}/>);fill();
 fireEvent.click(screen.getByRole('button',{name:'Save art-folder variant & inventory'}));expect(supabase.from.mock.calls.filter(([t])=>t!=='art_ids')).toHaveLength(0);// Art ID display lookup is read-only
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save art-folder variant & inventory'}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(1));
 const stock=writes.find(w=>w.table==='webstore_transfers').value;expect(stock).toMatchObject({code:'dtf-crest-new-version',on_hand:0,image_url:'black.png',decoration_type:'dtf'});
 expect(stock.production_file.at_once_variant).toMatchObject({garment_color:'Black',knockout_color:'black'});
 const folder=writes.find(w=>w.table==='customers').value.art_files[0];expect(folder.prod_files).toHaveLength(1);expect(folder.dtf_variants[0].reviewed).toBe(true);
 expect(writes.find(w=>w.table==='webstore_products').value.decorations[0]).toMatchObject({transfer_code:stock.code,art_url:'black.png',dtf_variant_id:'new-version'});
});
test('choosing a saved file replaces a pending upload and resets review',async()=>{
 database();const onSaved=jest.fn();render(<AtOnceArtVariants {...props} onSaved={onSaved}/>);fill();
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.change(screen.getByLabelText('Upload DTF knockout .ai to this art folder'),{target:{files:[new File(['art'],'other.ai')]}});expect(screen.getByRole('checkbox').checked).toBe(false);
 fireEvent.change(screen.getByLabelText('Saved production file'),{target:{value:'black.ai'}});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save art-folder variant & inventory'}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalled());expect(uploadProductionArtwork).not.toHaveBeenCalled();
});
test('concurrent art-folder edits prevent garment assignment',async()=>{
 const writes=database({stale:true});render(<AtOnceArtVariants {...props}/>);fill();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save art-folder variant & inventory'}));
 await screen.findByText(/Art folder changed while saving/);expect(writes.some(w=>w.table==='webstore_products')).toBe(false);
});
test('an existing inventory code with a different file cannot be silently reused',async()=>{
 const writes=database({existing:{decoration_type:'dtf',production_file:{...file,path:'wrong.ai'},width_in:10,height_in:8}});render(<AtOnceArtVariants {...props}/>);fill();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save art-folder variant & inventory'}));
 await screen.findByText(/different production details/);expect(writes).toHaveLength(0);
});

test('saving a version numbers it with a permanent Art ID and shows it',async()=>{
 database();
 const base=supabase.from.getMockImplementation();
 let assigned=false;
 supabase.from.mockImplementation(table=>{
  if(table==='art_ids')return {select:()=>({in:async()=>({data:[{art_number:42,customer_id:'customer',art_id:'crest'}],error:null})})};
  if(table==='art_id_versions')return {select:()=>({in:async()=>({data:assigned?[{art_number:42,variant_no:1,revision_no:1,revision_key:'new-version'}]:[],error:null})})};
  return base(table);
 });
 supabase.rpc=jest.fn(async()=>{assigned=true;return {data:'ART-000042-V01-R01',error:null};});
 const onSaved=jest.fn();render(<AtOnceArtVariants {...props} onSaved={onSaved}/>);
 expect(await screen.findByText('ART-000042')).toBeTruthy();
 fill();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save art-folder variant & inventory'}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(1));
 expect(supabase.rpc).toHaveBeenCalledWith('assign_art_code',{p_customer_id:'customer',p_art_id:'crest',p_variant_key:'Black',p_revision_key:'new-version'});
 delete supabase.rpc;
});
