// New customers (no QBO link yet) go first in the hourly batch; linked customers keep rotating.
// Before, a new customer waited for the rotation (~4 days) and its invoices were held meanwhile.
import fs from 'fs';
import path from 'path';
import { customerBatchWindow, NEW_CUSTOMERS_PER_RUN } from '../../supabase/functions/qbo-sales-background/logic';

const ids = rows => rows.map(r => r.id);
const linked = Array.from({ length: 60 }, (_, i) => ({ id: 'c' + String(i).padStart(3, '0') }));
const links = Object.fromEntries(linked.map(r => [r.id, { qbo_id: 'q' + r.id }]));

describe('customerBatchWindow', () => {
  test('unlinked customers come first, then the usual rotating window of linked ones', () => {
    const fresh = [{ id: 'c9999' }, { id: 'c0500' }];
    const batch = customerBatchWindow([...linked, ...fresh], links, { customer_batch_limit: 25, continuation_cursor: { customer_offset: 50 } });
    expect(ids(batch).slice(0, 2)).toEqual(['c0500', 'c9999']);
    expect(ids(batch).slice(2)).toEqual([...ids(linked.slice(50)), ...ids(linked.slice(0, 15))]);
  });

  test('the linked rotation advances exactly as before when nothing is unlinked', () => {
    expect(ids(customerBatchWindow(linked, links, { customer_batch_limit: 25, continuation_cursor: { customer_offset: 25 } })))
      .toEqual(ids(linked.slice(25, 50)));
  });

  test('at most a few unlinked customers per run (each QBO create takes ~20s of a 150s limit)', () => {
    expect(NEW_CUSTOMERS_PER_RUN).toBe(3);
    const many = Array.from({ length: 40 }, (_, i) => ({ id: 'n' + String(i).padStart(3, '0') }));
    const batch = customerBatchWindow([...linked, ...many], links, { customer_batch_limit: 25 });
    expect(ids(batch.filter(r => r.id.startsWith('n')))).toEqual(['n000', 'n001', 'n002']);
    expect(batch.filter(r => r.id.startsWith('c'))).toHaveLength(25);
  });

  test('a link without a QBO id counts as unlinked; defaults apply with no settings', () => {
    const batch = customerBatchWindow([{ id: 'a' }, { id: 'b' }], { a: { qbo_id: '' }, b: { qbo_id: '7' } });
    expect(ids(batch)).toEqual(['a', 'b']);
    expect(customerBatchWindow([], {}, {})).toEqual([]);
  });

  test('the hourly sync uses it for the customer batch', () => {
    const edge = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/functions/qbo-sales-background/index.ts'), 'utf8');
    expect(edge).toContain('customerBatchWindow(activeCustomers,snapshot.customer_links||{},settings)');
  });
});
