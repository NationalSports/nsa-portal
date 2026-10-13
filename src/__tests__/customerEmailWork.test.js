import React from 'react';
import {createRoot} from 'react-dom/client';
import {act,Simulate} from 'react-dom/test-utils';
import CustomerEmailWork,{parseSizes} from '../CustomerEmailWork';
jest.mock('../components',()=>({ProductPicker:()=> <div>Product picker</div>}));
jest.mock('../vendorInventory',()=>({fetchVendorSizeInventory:jest.fn(),vendorInvSource:()=>''}));
beforeAll(()=>{global.IS_REACT_ACT_ENVIRONMENT=true});
test('size entry rejects duplicate sizes and invalid counts',()=>{
 expect(parseSizes('S:5, M:10')).toEqual({S:5,M:10});
 expect(()=>parseSizes('M:2, m:3')).toThrow();
 expect(()=>parseSizes('M:0')).toThrow();
 expect(()=>parseSizes('15 medium')).toThrow();
});
test('new background revisions preserve unsaved edits and save against original revision',async()=>{
 const node=document.createElement('div'),root=createRoot(node),call=jest.fn().mockResolvedValue({}),refresh=jest.fn();
 const row={id:'email',customer_id:'c'};
 const work={revision:'v1',status:'ready',customer_id:'c',source_insight_id:'email',prepared:{notes:'',missing:[],lines:[{name:'Hoodie',quantity:15,sizes:{},product:{id:'p'},pricing:{unit_sell:20},stock:{state:'unknown'}}]}};
 const render=w=>root.render(<CustomerEmailWork row={row} work={w} call={call} onRefresh={refresh} products={[]} vendors={[]}/>);
 act(()=>render(work));
 act(()=>node.querySelector('button').click());
 const input=node.querySelector('input[type="number"]');
 act(()=>Simulate.change(input,{target:{value:'20'}}));
 act(()=>render({...work,revision:'v2',prepared:{...work.prepared,lines:[{...work.prepared.lines[0],quantity:30}]}}));
 expect(node.querySelector('input[type="number"]').value).toBe('20');
 expect(node.textContent).toContain('Your edits are preserved');
 const save=[...node.querySelectorAll('button')].find(b=>b.textContent==='Save reviewed details');
 await act(async()=>save.click());
 expect(call).toHaveBeenCalledWith('rep-email-work',expect.objectContaining({action:'save',revision:'v1',lines:[expect.objectContaining({quantity:'20'})]}));
 act(()=>root.unmount());
});

test('finished background preparation populates fields without needing a page reload',()=>{
 const node=document.createElement('div'),root=createRoot(node);
 const base={revision:'same-job',customer_id:'c',source_insight_id:'email'};
 const render=w=>root.render(<CustomerEmailWork row={{id:'email',customer_id:'c'}} work={w} products={[]} vendors={[]}/>);
 act(()=>render({...base,status:'processing',prepared:{}}));
 act(()=>node.querySelector('button').click());
 act(()=>render({...base,status:'ready',prepared:{lines:[{name:'Backpack',quantity:15,sizes:{},product:null}],missing:[]}}));
 expect(node.textContent).toContain('1. Backpack');
 expect(node.querySelector('input[type="number"]').value).toBe('15');
 act(()=>root.unmount());
});

test('removal review shows shared-calculator totals and creates only after explicit review',async()=>{
 const node=document.createElement('div'),root=createRoot(node),call=jest.fn().mockResolvedValue({estimateId:'EST-REV'}),open=jest.fn();
 const backpack={id:1,name:'Adidas Defender 5 Backpack',sku:'5159394',color:'Black/Black',unit_sell:34.75,sizes:{OSFA:15}};
 const s={estimate:{id:'EST-2618',status:'open',shipping_type:'pct',shipping_value:5},customer:{tax_rate:0.09625},items:[backpack,{id:2,name:'Polo',unit_sell:32.5,sizes:{M:5}}],art:[{id:'art1',deco_type:'embroidery'}],decorations:[{estimate_item_id:2,kind:'art',art_file_id:'art1',sell_override:9}]};
 const work={revision:'v1',status:'ready',customer_id:'c',source_insight_id:'email',prepared:{lines:[],estimate_revision:{kind:'remove_items',state:'ready',estimate_id:'EST-2618',reason:'Review first',snapshot:s,removed:[backpack]}}};
 act(()=>root.render(<CustomerEmailWork row={{id:'email',customer_id:'c'}} work={work} call={call} onRefresh={async()=>{}} onOpenEstimate={open}/>));
 act(()=>node.querySelector('button').click());
 expect(node.textContent).toContain('Remove: Adidas Defender 5 Backpack');
 expect(node.textContent).toContain('$237.85');
 expect(node.textContent).not.toContain('Create draft estimate');
 expect(call).not.toHaveBeenCalled();
 await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Create reviewed revision draft').click());
 expect(call).toHaveBeenCalledWith('rep-email-work',{action:'create_revision',insightId:'email',revision:'v1'});
 expect(open).toHaveBeenCalledWith('EST-REV');
 expect(s.items).toHaveLength(2);
 act(()=>root.unmount());
});
test('converted and already removed proposals cannot create a revision or suggest a reply',()=>{
 for(const state of ['blocked','already_removed']){
  const node=document.createElement('div'),root=createRoot(node);
  const work={status:'ready',customer_id:'c',prepared:{estimate_revision:{state,estimate_id:'EST-2618',reason:'Review original'}}};
  act(()=>root.render(<CustomerEmailWork row={{id:'email',customer_id:'c'}} work={work}/>));
  act(()=>node.querySelector('button').click());
  expect(node.textContent).not.toContain('Create reviewed revision draft');
  expect(node.textContent).not.toContain('Create draft estimate');
  expect(node.textContent).not.toContain('Review suggested reply');
  act(()=>root.unmount());
 }
});
