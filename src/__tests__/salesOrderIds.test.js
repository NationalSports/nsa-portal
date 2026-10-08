import { nextSalesOrderId, salesOrderSequenceNumber } from '../lib/salesOrderIds';

test('ignores test and date-like sales order IDs when advancing the sequence', () => {
  const orders = [
    { id: 'SO-2872' },
    { id: 'SO-TEST-SAVE-20261008' },
    { id: 'SO-20261009' },
    { id: 'SO-20261015' },
  ];
  expect(nextSalesOrderId(orders, 20261015)).toBe('SO-2873');
  expect(salesOrderSequenceNumber('SO-TEST-SAVE-20261008')).toBe(0);
});

test('keeps four digits through 9999, then moves to 10000', () => {
  expect(nextSalesOrderId([{ id: 'SO-9998' }, { id: 'SO-20261009' }])).toBe('SO-9999');
  expect(nextSalesOrderId([{ id: 'SO-9999' }, { id: 'SO-20261009' }])).toBe('SO-10000');
  expect(nextSalesOrderId([{ id: 'SO-10000' }, { id: 'SO-20261009' }])).toBe('SO-10001');
});

test('uses a newer canonical ID found in the database', () => {
  expect(nextSalesOrderId([{ id: 'SO-2872' }], 2875)).toBe('SO-2876');
});
