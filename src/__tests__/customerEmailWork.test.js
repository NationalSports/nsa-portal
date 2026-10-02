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
