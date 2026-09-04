import { _pickSoItem } from '../constants';

describe('_pickSoItem invoice_line_keys normalization', () => {
  test.each([
    ['missing', { sku: 'NEW-1' }],
    ['explicit null', { sku: 'NEW-1', invoice_line_keys: null }],
    ['malformed legacy value', { sku: 'NEW-1', invoice_line_keys: {} }],
  ])('coalesces %s to an empty array', (_label, item) => {
    expect(_pickSoItem(item)).toEqual(expect.objectContaining({
      sku: 'NEW-1',
      invoice_line_keys: [],
    }));
  });

  test('preserves prior invoice aliases without mutating the source item', () => {
    const aliases=['A1005|White|1'];
    const item={sku:'LH0083',invoice_line_keys:aliases,_sessionOnly:'ignored'};

    const row=_pickSoItem(item);

    expect(row.invoice_line_keys).toBe(aliases);
    expect(row).not.toHaveProperty('_sessionOnly');
    expect(item).toEqual({sku:'LH0083',invoice_line_keys:aliases,_sessionOnly:'ignored'});
  });

  test('gives every row in a mixed existing/new batch the required array', () => {
    const rows=[
      {sku:'EXISTING',invoice_line_keys:['OLD|Blue|0']},
      {sku:'NEW'},
    ].map(_pickSoItem);

    expect(rows.map(row=>row.invoice_line_keys)).toEqual([
      ['OLD|Blue|0'],
      [],
    ]);
  });
});
