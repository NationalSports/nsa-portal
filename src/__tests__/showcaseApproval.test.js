import { approvableImageIds, approveImages } from '../lib/showcaseApproval';
test('only finished current candidates qualify for bulk approval',()=>{
 const rows=[{status:'review',showcase_image_url:'new.png'},{status:'review'},{status:'failed',showcase_image_url:'old.png'},{status:'approved',showcase_image_url:'old.png'},{status:'generating'},{status:'review',showcase_image_url:'stale.png',needs_regeneration:true}];
 expect(approvableImageIds(rows.map((asset,i)=>({webstore_product_id:String(i),asset})))).toEqual(['0']);
});
test('bulk approval retains individual validation and reports partial failures while continuing',async()=>{
 const call=jest.fn(async(action,{webstore_product_id:id})=>{if(id==='b')throw new Error('Catalog changed');return {ok:true};});
 expect(await approveImages(call,['a','b','a','c'])).toEqual({approved:2,failures:[{id:'b',message:'Catalog changed'}]});
 expect(call.mock.calls).toEqual([['approve',{webstore_product_id:'a'}],['approve',{webstore_product_id:'b'}],['approve',{webstore_product_id:'c'}]]);
});
