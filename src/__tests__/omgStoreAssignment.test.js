const {
  normalizeOmgStoreCode,
  validateOmgStoreAssignment,
  buildOmgStoreAssignment,
} = require('../lib/omgStoreAssignment');

describe('OMG 24/7 store assignment', () => {
  test('normalizes pasted OMG codes', () => {
    expect(normalizeOmgStoreCode(' 5yp6d ')).toBe('5YP6D');
  });

  test('requires a five-character code, customer, and rep', () => {
    expect(validateOmgStoreAssignment({ code: '1234', storeName: 'Store', customerId: 'c1', repId: 'r1' })).toMatch(/exactly 5/);
    expect(validateOmgStoreAssignment({ code: '5YP6D', storeName: 'Store', customerId: 'c1', repId: '' })).toMatch(/Sales rep/);
  });

  test('builds the stable store id used by monthly imports', () => {
    expect(buildOmgStoreAssignment({
      code: '5yp6d',
      storeName: ' WVC Team Store ',
      customerId: 'c-ns-2730',
      repId: 'rep-1',
      today: '2026-09-02',
    })).toEqual(expect.objectContaining({
      id: 'OMG-sale_5YP6D',
      _omg_sale_code: '5YP6D',
      store_name: 'WVC Team Store',
      customer_id: 'c-ns-2730',
      rep_id: 'rep-1',
      channel_type: '24/7',
      status: 'open',
      open_date: '2026-09-02',
    }));
  });

  test('preserves existing operational data while updating ownership', () => {
    const result = buildOmgStoreAssignment({
      code: 'abc12',
      storeName: 'Updated name',
      customerId: 'c2',
      repId: 'r2',
      existing: { id: 'OMG-sale_ABC12', status: 'closed', open_date: '2026-01-01', total_sales: 200 },
    });
    expect(result).toEqual(expect.objectContaining({ status: 'closed', open_date: '2026-01-01', total_sales: 200, customer_id: 'c2', rep_id: 'r2' }));
  });
});
