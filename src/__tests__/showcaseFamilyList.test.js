import React from 'react';
import { render,screen,fireEvent } from '@testing-library/react';
import ShowcaseFamilyList from '../ui/ShowcaseFamilyList';
const items=Array.from({length:15},(_,i)=>({webstore_product_id:String(i),product_id:'p'+i,sku:'HOOD-Color'+Math.floor(i/3),brand:'Nike',name:'Club fleece',color:'Color'+Math.floor(i/3),variant_group_id:'design'+i%3,supplier_image_url:'supplier.png',standard_image_url:'before.png',asset:{status:'missing'}}));
test('15 combinations show one base card, generation targets the group, review expands combinations',()=>{
 const act=jest.fn();render(<ShowcaseFamilyList items={items} act={act}/>);
 expect(screen.getByText('Showcase · 1 base items')).toBeTruthy();
 expect(screen.getByText('5 colors · 3 designs · 15 combinations')).toBeTruthy();
 expect(screen.queryAllByText('Before / After')).toHaveLength(0);
 fireEvent.click(screen.getByText('Create images'));
 expect(act).toHaveBeenCalledWith('style:nike:hood','generate_family',{family_key:'style:nike:hood',new_master:false,showcase_settings:{decoration_type:'auto',revision_notes:''}});
 fireEvent.click(screen.getByText('Review combinations (15)'));
 expect(screen.getAllByText('Before / After')).toHaveLength(15);
});
test('running family disables new generation and cancellation targets entire item',()=>{
 const act=jest.fn();render(<ShowcaseFamilyList items={items.map(i=>({...i,asset:{status:'generating'}}))} act={act}/>);
 expect(screen.getByText('Creating images…').disabled).toBe(true);
 fireEvent.click(screen.getByText('Cancel item'));
 expect(act).toHaveBeenCalledWith('style:nike:hood','cancel_family',{family_key:'style:nike:hood'});
});
test('generated combinations clearly await approval and Review & Approve opens the actionable dialog',()=>{
 HTMLDialogElement.prototype.showModal=jest.fn();
 HTMLDialogElement.prototype.close=jest.fn();
 const act=jest.fn();
 render(<ShowcaseFamilyList items={[{...items[0],asset:{status:'review',showcase_image_url:'generated.png',family_version:'showcase-color-design-v2',qa_result:{renderer_version:'color-design-v1',detail_images:[]}}}]} act={act}/>);
 expect(screen.getByText('1/1 generated · 0 approved · 1 awaiting review')).toBeTruthy();
 expect(screen.getByText('Refresh images')).toBeTruthy();
 expect(screen.queryByText('Create images')).toBeNull();
 fireEvent.click(screen.getByText('Review combinations (1)'));
 expect(screen.getByText('Generated · Awaiting approval')).toBeTruthy();
 fireEvent.click(screen.getByText('Review & Approve'));
 expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
 fireEvent.click(screen.getByText('Approve Image'));
 expect(act).toHaveBeenCalledWith('0','approve',{webstore_product_id:'0'});
});
test('reject offers feedback before requesting a new family version and preserves the finish',()=>{
 HTMLDialogElement.prototype.showModal=jest.fn();HTMLDialogElement.prototype.close=jest.fn();
 const act=jest.fn();
 render(<ShowcaseFamilyList items={[{...items[0],asset:{status:'review',showcase_image_url:'candidate.png',showcase_settings:{decoration_type:'tackle_twill'}}}]} act={act}/>);
 fireEvent.click(screen.getByText('Review combinations (1)'));
 fireEvent.click(screen.getByText('Review & Approve'));
 fireEvent.click(screen.getByText('Reject'));
 expect(act).not.toHaveBeenCalled();
 expect(screen.getByText('Create revised images').disabled).toBe(true);
 fireEvent.change(screen.getByRole('textbox',{hidden:true}),{target:{value:'Keep the pose; soften lighting and raise the logo'}});
 fireEvent.click(screen.getByText('Create revised images'));
 expect(act).toHaveBeenCalledWith('0','generate_image',{family_key:'style:nike:hood',webstore_product_id:'0',new_master:true,showcase_settings:{decoration_type:'tackle_twill',revision_notes:'Keep the pose; soften lighting and raise the logo'}});
});

test('a combination can generate by itself without requesting the family',()=>{
 const act=jest.fn();render(<ShowcaseFamilyList items={items} act={act}/>);
 fireEvent.click(screen.getByText('Review combinations (15)'));
 fireEvent.click(screen.getAllByText('Create this image')[4]);
 expect(act).toHaveBeenCalledWith('4','generate_image',{family_key:'style:nike:hood',webstore_product_id:'4',showcase_settings:{decoration_type:'auto',revision_notes:''}});
});

test('item and store bulk approval target only ready current images without opening review',()=>{
 const act=jest.fn();
 render(<ShowcaseFamilyList items={items.map((i,n)=>({...i,asset:n<2?{status:'review',showcase_image_url:'ready.png'}:{status:'missing'}}))} act={act}/>);
 fireEvent.click(screen.getByText('Approve all (2)'));
 expect(act).toHaveBeenLastCalledWith('style:nike:hood','approve_all',{image_ids:['0','1']});
 fireEvent.click(screen.getByText('Approve all images (2)'));
 expect(act).toHaveBeenLastCalledWith('approve_all','approve_all',{image_ids:['0','1']});
 expect(screen.queryAllByText('Before / After')).toHaveLength(0);
});

test('collapsed item thumbnail includes saved decoration before generation',()=>{
 const decorated={...items[0],decorations:[{side:'front',art_url:'logo.png',x:50,y:43,w:30}],supplier_image_url:'blank.png'};
 const {container}=render(<ShowcaseFamilyList items={[decorated]} act={jest.fn()}/>);
 expect(screen.getByAltText('Club fleece with decoration').getAttribute('src')).toBe('blank.png');
 expect(container.querySelector('img[src="logo.png"]')).toBeTruthy();
});

test('collapsed item thumbnail uses generated pixels without double overlaying the artwork',()=>{
 const decorated={...items[0],decorations:[{side:'front',art_url:'logo.png',x:50,y:43,w:30}],asset:{status:'review',showcase_image_url:'finished.png'}};
 const {container}=render(<ShowcaseFamilyList items={[decorated]} act={jest.fn()}/>);
 expect(screen.getByAltText('Club fleece Showcase preview').getAttribute('src')).toBe('finished.png');
 expect(container.querySelector('img[src="logo.png"]')).toBeNull();
});

test('baked decorations use the existing mockup thumbnail without adding the logo twice',()=>{
 const item={...items[0],supplier_image_url:'blank.png',standard_image_url:'decorated-mockup.png',decorations:[{side:'front',baked:true,art_url:'logo.png'}]};
 const {container}=render(<ShowcaseFamilyList items={[item]} act={jest.fn()}/>);
 expect(screen.getByAltText('Club fleece with decoration').getAttribute('src')).toBe('decorated-mockup.png');
 expect(container.querySelector('img[src="logo.png"]')).toBeNull();
});
