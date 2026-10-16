import {createSessionOutbox} from '../lib/sessionOutbox';
let a,b,owner;
const entry=(id,memo,revision)=>({table:'sales_orders',id,payload:{id,memo},revision});
beforeEach(()=>{localStorage.clear();owner='steve';a=createSessionOutbox({storage:()=>localStorage,owner:()=>owner,session:'a'});b=createSessionOutbox({storage:()=>localStorage,owner:()=>owner,session:'b'});});
test('two tabs retain independent copies and one acknowledgement cannot erase the other',()=>{
 a.write('sales_orders','SO-1',entry('SO-1','A','a1'));b.write('sales_orders','SO-1',entry('SO-1','B','b1'));
 expect(a.list()).toHaveLength(2);expect(a.remove('sales_orders','SO-1','b1')).toBe(false);
 a.remove('sales_orders','SO-1','a1');expect(b.own('sales_orders','SO-1').payload.memo).toBe('B');
});
test('older completion preserves newer draft and unrelated documents',()=>{
 a.write('sales_orders','SO-1',entry('SO-1','A','a1'));a.write('sales_orders','SO-2',entry('SO-2','B','a2'));
 a.write('sales_orders','SO-1',entry('SO-1','new','a3'));expect(a.remove('sales_orders','SO-1','a1')).toBe(false);expect(a.list()).toHaveLength(2);
});
test('another account cannot see or delete a draft',()=>{
 a.write('sales_orders','SO-1',entry('SO-1','A','a1'));const [e]=a.list();owner='gayle';expect(a.list()).toEqual([]);
 expect(a.remove(e.table,e.id,e.revision,e.storageKey)).toBe(false);
});
test('legacy acknowledgement never rewrites old tabs shared blob',()=>{
 const old=entry('SO-1','old','old');localStorage.setItem('nsa_outbox',JSON.stringify({'sales_orders:SO-1':old}));
 const [e]=a.list();expect(e.reviewOnly).toBe(true);a.remove(e.table,e.id,e.revision,e.storageKey,e.legacySnapshot);
 expect(a.list()).toEqual([]);expect(JSON.parse(localStorage.getItem('nsa_outbox'))['sales_orders:SO-1']).toEqual(old);
 localStorage.setItem('nsa_outbox',JSON.stringify({'sales_orders:SO-1':{...old,revision:'new'}}));expect(a.list()).toHaveLength(1);
});
test('reload exposes previous session as review only',()=>{a.write('sales_orders','SO-1',entry('SO-1','A','a1'));expect(b.list()[0].reviewOnly).toBe(true);});

test('reviewing another tab hides only the reviewed revision, without modifying its live lane',()=>{
 b.write('sales_orders','SO-1',entry('SO-1','old','b1'));const [review]=a.list();
 a.remove(review.table,review.id,review.revision,review.storageKey);
 expect(b.own('sales_orders','SO-1').revision).toBe('b1');expect(a.list()).toEqual([]);
 b.write('sales_orders','SO-1',entry('SO-1','new','b2'));expect(a.list()).toHaveLength(1);
});
