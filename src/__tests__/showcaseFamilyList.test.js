import React from 'react';
import { render,screen,fireEvent } from '@testing-library/react';
import ShowcaseFamilyList from '../ui/ShowcaseFamilyList';
const items=Array.from({length:15},(_,i)=>({webstore_product_id:String(i),product_id:'p'+i,sku:'HOOD-Color'+Math.floor(i/3),brand:'Nike',name:'Club fleece',color:'Color'+Math.floor(i/3),variant_group_id:'design'+i%3,supplier_image_url:'supplier.png',standard_image_url:'before.png',asset:{status:'missing'}}));
test('15 combinations show one base card, generation targets the group, review expands combinations',()=>{
 const act=jest.fn();render(<ShowcaseFamilyList items={items} act={act}/>);
 expect(screen.getByText('Showcase · 1 base items')).toBeTruthy();
 expect(screen.getByText('5 colors · 3 designs · 15 combinations')).toBeTruthy();
 expect(screen.queryAllByText('Before / After')).toHaveLength(0);
 fireEvent.click(screen.getByText('Generate whole item'));
 expect(act).toHaveBeenCalledWith('style:nike:hood','generate_family',{family_key:'style:nike:hood',new_master:false,showcase_settings:{decoration_type:'auto'}});
 fireEvent.click(screen.getByText('Review combinations (15)'));
 expect(screen.getAllByText('Before / After')).toHaveLength(15);
});
test('running family disables new generation and cancellation targets entire item',()=>{
 const act=jest.fn();render(<ShowcaseFamilyList items={items.map(i=>({...i,asset:{status:'generating'}}))} act={act}/>);
 expect(screen.getByText('Generating item…').disabled).toBe(true);
 fireEvent.click(screen.getByText('Cancel item'));
 expect(act).toHaveBeenCalledWith('style:nike:hood','cancel_family',{family_key:'style:nike:hood'});
});
