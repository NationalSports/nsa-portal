/* Unit tests for src/lib/recordRoute.js — the pure serialization behind record-level
 * URL routing (each open order/estimate/customer/etc. is its own address + history entry). */

const { REC_PARAMS, REC_PARAM_FOR_PG, buildRouteSearch, readRoute, recKey } = require('../lib/recordRoute');

describe('buildRouteSearch', () => {
  test('dashboard with no record => clean URL (no params)', () => {
    expect(buildRouteSearch('', 'dashboard', null, null)).toBe('');
  });

  test('a section with no record => ?pg=<section>', () => {
    expect(buildRouteSearch('', 'orders', null, null)).toBe('?pg=orders');
    expect(buildRouteSearch('', 'customers', null, null)).toBe('?pg=customers');
  });

  test('a section with an open record => ?pg=<section>&<rec>=<id>', () => {
    expect(buildRouteSearch('', 'orders', 'so', 'SO-1141')).toBe('?pg=orders&so=SO-1141');
    expect(buildRouteSearch('', 'invoices', 'inv', 'INV-9')).toBe('?pg=invoices&inv=INV-9');
  });

  test('clears every stale record param, keeps only the live one', () => {
    // Was on an order (so=SO-1); now viewing a customer — the so must not linger.
    const out = buildRouteSearch('?pg=orders&so=SO-1', 'customers', 'cust', 'c9');
    const p = new URLSearchParams(out.replace(/^\?/, ''));
    expect(p.get('so')).toBeNull();
    expect(p.get('pg')).toBe('customers');
    expect(p.get('cust')).toBe('c9');
  });

  test('closing a record (record -> none) drops the record param but keeps the section', () => {
    expect(buildRouteSearch('?pg=orders&so=SO-1', 'orders', null, null)).toBe('?pg=orders');
  });

  test('preserves unrelated params (e.g. ?portal=) untouched', () => {
    const out = buildRouteSearch('?portal=grande', 'orders', 'so', 'SO-2');
    const p = new URLSearchParams(out.replace(/^\?/, ''));
    expect(p.get('portal')).toBe('grande');
    expect(p.get('pg')).toBe('orders');
    expect(p.get('so')).toBe('SO-2');
  });

  test('going back to dashboard clears ?pg= but keeps unrelated params', () => {
    const out = buildRouteSearch('?portal=grande&pg=orders&so=SO-2', 'dashboard', null, null);
    expect(out).toBe('?portal=grande');
  });
});

describe('readRoute', () => {
  test('empty search => dashboard, no record', () => {
    expect(readRoute('')).toEqual({ pg: 'dashboard', recParam: null, recId: null });
  });

  test('section only', () => {
    expect(readRoute('?pg=vendors')).toEqual({ pg: 'vendors', recParam: null, recId: null });
  });

  test('section + matching record', () => {
    expect(readRoute('?pg=orders&so=SO-1141')).toEqual({ pg: 'orders', recParam: 'so', recId: 'SO-1141' });
  });

  test('record param with no ?pg= still resolves (email deep-link shape)', () => {
    expect(readRoute('?inv=INV-3')).toEqual({ pg: 'dashboard', recParam: 'inv', recId: 'INV-3' });
  });

  test('the section-matching record wins over a stale foreign param', () => {
    // Defensive: if two record params ever coexist, the one for the current section wins.
    expect(readRoute('?pg=customers&cust=c1&so=SO-9')).toEqual({ pg: 'customers', recParam: 'cust', recId: 'c1' });
  });
});

describe('round-trip', () => {
  test.each([
    ['dashboard', null, null],
    ['orders', 'so', 'SO-1141'],
    ['estimates', 'est', 'EST-77'],
    ['customers', 'cust', 'c123'],
    ['vendors', 'vend', 'v9'],
    ['products', 'prod', 'p42'],
    ['invoices', 'inv', 'INV-5'],
  ])('build then read is stable for %s/%s/%s', (pg, recParam, recId) => {
    const search = buildRouteSearch('', pg, recParam, recId);
    expect(readRoute(search)).toEqual({ pg, recParam: recParam || null, recId: recId || null });
  });
});

describe('recKey', () => {
  test('empty when no record', () => {
    expect(recKey(null, null)).toBe('');
    expect(recKey('so', null)).toBe('');
  });
  test('type:id when a record is open', () => {
    expect(recKey('so', 'SO-1')).toBe('so:SO-1');
  });
});

describe('constants', () => {
  test('every record-bearing section maps to a known record param', () => {
    Object.values(REC_PARAM_FOR_PG).forEach((param) => {
      expect(REC_PARAMS).toContain(param);
    });
  });
});
