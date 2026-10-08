import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {ProductPage} from '../storefront/Storefront';
jest.mock('../lib/supabase',()=>({supabase:null}));
jest.mock('../lib/webstoreTracking',()=>({trackEvent:jest.fn(),setTrackedStore:jest.fn()}));
const theme={warm:'#fff',line:'#ddd',ink:'#111',primary:'#146',subText:'#555'};
const rows=[['a','Blue','Block'],['b','Black','Block'],['c','Blue','Script']].map(([id,color,design])=>({
 webstore_product_id:id,product_id:id,name:'Club fleece',color,variant_group_id:design,school_design_label:design,
 image_front_url:`${id}-hero.png`,retail_price:77,decorations:[],showcase_active:true,
 showcase_detail_images:[{id:'logo-1',url:`${id}-detail.png`,label:'Decoration detail'}]
}));
test('detail follows selected color and logo',()=>{
 const onAdd=jest.fn();
 render(<ProductPage store={{id:'store',slug:'serra',org_type:'all_school'}} theme={theme} product={rows[0]} colorRows={rows} isOpen onAdd={onAdd}/>);
 fireEvent.click(screen.getByRole('button',{name:'Decoration detail'}));
 expect(screen.getByAltText('Club fleece — Blue — Decoration detail').getAttribute('src')).toContain('a-detail.png');
 fireEvent.click(screen.getByTitle('Black'));
 expect(screen.getByAltText('Club fleece — Black — Decoration detail').getAttribute('src')).toContain('b-detail.png');
 fireEvent.click(screen.getByText('Script'));
 expect(screen.getByAltText('Club fleece — Blue — Decoration detail').getAttribute('src')).toContain('c-detail.png');
 expect(screen.getByText(/Actual fabric and stitching may vary/)).toBeTruthy();
});
test('legacy product without approved detail has no detail control',()=>{
 render(<ProductPage store={{id:'store',slug:'serra'}} theme={theme} product={{...rows[0],showcase_detail_images:[]}} isOpen onAdd={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'Decoration detail'})).toBeNull();
});
