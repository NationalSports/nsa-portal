import { applyAdidasTagRows, attachAdidasTagSkus, isSsAdidasOrderSku, reportOrderSku } from '../lib/adidasSsReport';

describe('S&S/adidas report references', () => {
  test('recognizes only S&S ordering SKUs, never direct adidas articles', () => {
    expect(isSsAdidasOrderSku('AT310-50')).toBe(true);
    expect(isSsAdidasOrderSku('at101-black-white')).toBe(true);
    expect(isSsAdidasOrderSku('JL5410')).toBe(false);
    expect(isSsAdidasOrderSku('AT101')).toBe(false);
  });

  test('uses the current SO SKU and adds the adidas article without replacing it', () => {
    const lines = [
      { id: 'ss', sku: 'OLD', _sku: 'AT310-50' },
      { id: 'adidas', sku: 'JL5410', _sku: 'JL5410' },
      { id: 'other', sku: 'PC61' },
    ];
    const out = applyAdidasTagRows(lines, [{ ss_sku: 'AT310-50', adidas_article: 'JL5410', rank: 1 }]);
    expect(reportOrderSku(out[0])).toBe('AT310-50');
    expect(out[0]).toMatchObject({ _sku: 'AT310-50', _adidasTagSku: 'JL5410' });
    expect(out[1]._adidasTagSku).toBeUndefined();
    expect(out[2]._adidasTagSku).toBeUndefined();
  });

  test('loads all S&S references in one batched query and leaves unmapped SKUs alone', async () => {
    const calls = [];
    const supabase = {
      from(table) {
        calls.push({ table });
        const q = {
          select(columns) { calls[0].columns = columns; return q; },
          in(column, values) { calls[0].column = column; calls[0].values = values; return q; },
          eq(column, value) { calls[0].rank = [column, value]; return Promise.resolve({ data: [{ ss_sku: 'AT310-50', adidas_article: 'JL5410', rank: 1 }], error: null }); },
        };
        return q;
      },
    };
    const out = await attachAdidasTagSkus(supabase, [
      { sku: 'AT310-50' }, { sku: 'AT310-50' }, { sku: 'AT999-00' }, { sku: 'JL5410' },
    ]);
    expect(calls).toEqual([{
      table: 'adidas_ss_sku_xref', columns: 'ss_sku,adidas_article,rank',
      column: 'ss_sku', values: ['AT310-50', 'AT999-00'], rank: ['rank', 1],
    }]);
    expect(out.map((l) => l._adidasTagSku || '')).toEqual(['JL5410', 'JL5410', '', '']);
    expect(out.map((l) => l.sku)).toEqual(['AT310-50', 'AT310-50', 'AT999-00', 'JL5410']);
  });

  test('does not query the crosswalk for direct adidas orders', async () => {
    const from = jest.fn();
    const lines = [{ sku: 'JL5410' }, { sku: 'JX4452' }];
    expect(await attachAdidasTagSkus({ from }, lines)).toBe(lines);
    expect(from).not.toHaveBeenCalled();
  });
});
