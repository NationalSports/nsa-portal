import {createRepSaveNoticeFilter} from '../lib/repSaveNoticeScope';

const setup = (repId = 'rep-a', customers = [{id:'customer',primary_rep_id:'rep-a'}]) => createRepSaveNoticeFilter({
  repId,customers,salesOrders:[{id:'SO-1',customer_id:'customer',created_by:'creator'}],
  estimates:[{id:'EST-1',customer_id:'customer',created_by:'creator'}],
});

test.each(['SO-1','EST-1','memo:SO-1'])('only the currently assigned rep sees %s, not its creator or an unrelated admin', id => {
  expect(setup()({id})).toBe(true);
  expect(setup('rep-b')({id})).toBe(false);
  expect(setup('creator')({id})).toBe(false);
  expect(setup('admin')({id})).toBe(false);
});

test('current customer assignment beats stale draft ownership and updates on reassignment', () => {
  const entry={table:'sales_orders',id:'SO-1',owner:'rep-b',payload:{id:'SO-1',created_by:'rep-b'}};
  expect(setup('rep-a')(entry)).toBe(true);
  expect(setup('rep-b')(entry)).toBe(false);
  expect(setup('rep-b',[{id:'customer',primary_rep_id:'rep-b'}])(entry)).toBe(true);
});

test('new documents fall back to their creator; unknown documents do not become everyone’s notices', () => {
  expect(setup()({table:'estimates',id:'EST-new',payload:{id:'EST-new',created_by:'rep-a'}})).toBe(true);
  expect(setup()({id:'EST-missing'})).toBe(false);
  expect(setup(null)({id:'SO-1'})).toBe(false);
  expect(setup()({table:'sales_order_memos',id:'SO-1'})).toBe(true);
});

test('non-document failures keep existing session visibility', () => {
  expect(setup()({table:'products',id:'product-1'})).toBe(true);
});
