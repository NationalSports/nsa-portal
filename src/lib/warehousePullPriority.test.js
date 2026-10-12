import {isQuickPull,compareWarehousePulls} from './warehousePullPriority';
const stores=[{id:'club',org_type:'club'},{id:'school',org_type:'all_school'},{id:'team',org_type:'team'},{id:'omg',org_type:'club',source:'omg'}];
test('only native Club and All School orders get Quick Pull treatment',()=>{
 for(const id of ['club','school'])expect(isQuickPull({webstore_id:id},stores)).toBe(true);
 for(const id of ['team','omg','unknown'])expect(isQuickPull({id:'1010042',webstore_id:id},stores)).toBe(false);
 expect(isQuickPull({id:'247-1234'},stores)).toBe(false);
 expect(isQuickPull({webstore_id:'club',omg_store_id:'omg'},stores)).toBe(false);
});
test('same queue: over-five-day pulls, then quick pulls, then ordinary pulls',()=>{
 const rows=[{id:'regular',urgent:true,openAgeDays:4},{id:'quick',quickPull:true,openAgeDays:1},{id:'five',openAgeDays:5},{id:'over',openAgeDays:5.001},{id:'oldest',openAgeDays:9}];
 expect([...rows].sort(compareWarehousePulls).map(t=>t.id)).toEqual(['oldest','over','quick','regular','five']);
});
test('ordinary pulls retain urgency and age order within their tier',()=>{
 const rows=[{id:1,openDays:1},{id:2,openDays:2},{id:3,urgent:true,openDays:0}];
 expect(rows.sort(compareWarehousePulls).map(t=>t.id)).toEqual([3,2,1]);
});
