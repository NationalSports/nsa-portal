import { isAtOnceOrder, mainSalesOrders } from './orderChannels';
const stores=[{id:'c',org_type:'club',source:'webstore'},{id:'s',org_type:'all_school',source:'webstore'},{id:'w',org_type:'team',source:'webstore'},{id:'o',org_type:'club',source:'omg'}];
test('new 24/7 numbers and historical Club/School orders leave the main list only',()=>{
  const orders=[{id:'SO-1001'},{id:'247-1001',webstore_id:'c'},{id:'SO-1002',webstore_id:'c'},{id:'SO-1003',webstore_id:'s'},{id:'SO-1004',webstore_id:'w'},{id:'SO-1005',webstore_id:'o'},{id:'SO-1006',omg_store_id:'omg'}];
  expect(mainSalesOrders(orders,stores).map(o=>o.id)).toEqual(['SO-1001','SO-1004','SO-1005','SO-1006']);
  expect(orders).toHaveLength(7); // the shared operational collection stays intact
  expect(isAtOnceOrder({id:'247-1009'},[])).toBe(true);
  expect(isAtOnceOrder({id:'SO-2471'},[])).toBe(false);
});
