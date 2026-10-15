import { fetchDataVersions, allUnchanged, changedGroups, markLoaded, _resetDataVersionsForTest } from './dataVersions';

beforeEach(() => _resetDataVersionsForTest());

const client = (result) => ({ rpc: jest.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))) });

test('reads the counters through data_versions()', async () => {
  const c = client({ data: { sales_orders: 7 }, error: null });
  expect(await fetchDataVersions(c)).toEqual({ sales_orders: 7 });
  expect(c.rpc).toHaveBeenCalledWith('data_versions');
});

test('any failure reads as "unknown", never as "unchanged"', async () => {
  expect(await fetchDataVersions(client({ data: null, error: { message: 'Could not find the function' } }))).toBeNull();
  expect(await fetchDataVersions(client(new Error('network')))).toBeNull();
  expect(await fetchDataVersions(client({ data: [1], error: null }))).toBeNull();
  expect(await fetchDataVersions(null)).toBeNull();
  markLoaded({ sales_orders: 3 }, ['sales_orders']);
  expect(allUnchanged(null, ['sales_orders'])).toBe(false);
  expect(changedGroups(null, ['sales_orders'])).toEqual(['sales_orders']);
});

test('a group never loaded in this tab is changed', () => {
  expect(allUnchanged({ sales_orders: 3 }, ['sales_orders'])).toBe(false);
  expect(changedGroups({ sales_orders: 3 }, ['sales_orders', 'invoices'])).toEqual(['sales_orders', 'invoices']);
});

test('unchanged only when every group matches the counter read before its last load', () => {
  markLoaded({ sales_orders: 3, invoices: 9, messages: 1 }, ['sales_orders', 'invoices', 'messages']);
  expect(allUnchanged({ sales_orders: 3, invoices: 9, messages: 1 }, ['sales_orders', 'invoices', 'messages'])).toBe(true);
  expect(allUnchanged({ sales_orders: 4, invoices: 9, messages: 1 }, ['sales_orders', 'invoices', 'messages'])).toBe(false);
  expect(changedGroups({ sales_orders: 4, invoices: 9, messages: 1 }, ['sales_orders', 'invoices', 'messages'])).toEqual(['sales_orders']);
});

test('a group with no server counter is always changed', () => {
  markLoaded({ sales_orders: 3 }, ['sales_orders', 'customers']);
  expect(changedGroups({ sales_orders: 3 }, ['sales_orders', 'customers'])).toEqual(['customers']);
});

test('only the groups actually loaded are recorded', () => {
  markLoaded({ sales_orders: 3, invoices: 9 }, ['sales_orders']);
  expect(changedGroups({ sales_orders: 3, invoices: 9 }, ['sales_orders', 'invoices'])).toEqual(['invoices']);
});

test('counters compare by value whether they arrive as numbers or strings (bigint over JSON)', () => {
  markLoaded({ sales_orders: '12' }, ['sales_orders']);
  expect(allUnchanged({ sales_orders: 12 }, ['sales_orders'])).toBe(true);
});
