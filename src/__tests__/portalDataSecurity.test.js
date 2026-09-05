jest.mock('../../netlify/functions/_shared', () => ({
  getSupabaseAdmin: jest.fn(),
  resolveCustomerFamily: jest.fn(),
}));

const shared = require('../../netlify/functions/_shared');
const { handler, _test } = require('../../netlify/functions/portal-data');

function fakeAdmin(seed) {
  const calls = [];
  const admin = { calls, from(table) {
    const call = { table, filters: [], orders: [] };
    calls.push(call);
    let rows = (seed[table] || []).map((row) => ({ ...row }));
    const b = {
      select(value, options) { call.select = value; call.selectOptions = options; return b; },
      in(column, values) { call.filters.push(['in', column, values]); rows = rows.filter((row) => values.includes(row[column])); return b; },
      eq(column, value) { call.filters.push(['eq', column, value]); rows = rows.filter((row) => String(row[column]) === value); return b; },
      neq(column, value) { call.filters.push(['neq', column, value]); rows = rows.filter((row) => String(row[column]) !== value); return b; },
      is(column, value) { call.filters.push(['is', column, value]); rows = rows.filter((row) => row[column] === value); return b; },
      order(column, options) { call.orders.push([column, options]); return b; },
      range(start, end) { call.range = [start, end]; rows = rows.slice(start, end + 1); return b; },
      then(resolve, reject) {
        const selected = call.select === '*' || !call.select
          ? rows
          : rows.map((row) => Object.fromEntries(call.select.split(',').filter((key) => Object.prototype.hasOwnProperty.call(row, key)).map((key) => [key, row[key]])));
        return Promise.resolve({ data: selected, error: null, count: call.selectOptions?.count === 'exact' ? selected.length : null }).then(resolve, reject);
      },
    };
    return b;
  } };
  return admin;
}

const invoke = (body) => handler({ httpMethod: 'POST', body: JSON.stringify({ portal: 'secret', method: 'GET', query: 'select=*', ...body }) });

describe('portal-data ownership boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shared.resolveCustomerFamily.mockResolvedValue({ ownerIds: ['A'], familyIds: ['A', 'A-1'], fam: new Set(['A', 'A-1']) });
  });

  test('intersects caller filters with the server-derived family', async () => {
    const admin = fakeAdmin({ sales_orders: [
      { id: 'SO-A', customer_id: 'A', memo: 'owned', production_notes: 'internal' },
      { id: 'SO-B', customer_id: 'B', memo: 'foreign', production_notes: 'internal' },
    ] });
    shared.getSupabaseAdmin.mockReturnValue(admin);

    const response = await invoke({ table: 'sales_orders', query: 'select=*&customer_id=eq.B' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([]);
    const read = admin.calls.find((call) => call.table === 'sales_orders');
    expect(read.filters).toContainEqual(['in', 'customer_id', ['A', 'A-1']]);
    expect(read.filters).toContainEqual(['eq', 'customer_id', 'B']);
  });

  test('uses fixed public columns and marks the credential owner', async () => {
    const admin = fakeAdmin({ customers: [
      { id: 'A', parent_id: null, name: 'Account', alpha_tag: 'DISPLAY', notes: 'private' },
      { id: 'A-1', parent_id: 'A', name: 'Team', alpha_tag: 'TEAM', notes: 'private' },
      { id: 'B', parent_id: null, name: 'Other', alpha_tag: 'OTHER', notes: 'private' },
    ] });
    shared.getSupabaseAdmin.mockReturnValue(admin);

    const response = await invoke({ table: 'customers', query: 'select=*', range: '0-999' });
    const rows = JSON.parse(response.body);

    expect(rows.map((row) => [row.id, row._portal_owner])).toEqual([['A', true], ['A-1', false]]);
    expect(admin.calls[0].select).not.toContain('notes');
    expect(admin.calls[0].select).not.toContain('alpha_tag');
    expect(rows[0]).not.toHaveProperty('notes');
    expect(rows[0]).not.toHaveProperty('alpha_tag');
  });

  test('scopes grandchild tables through owned parent ids', async () => {
    const admin = fakeAdmin({
      sales_orders: [{ id: 'SO-A', customer_id: 'A' }, { id: 'SO-B', customer_id: 'B' }],
      so_items: [{ id: 1, so_id: 'SO-A' }, { id: 2, so_id: 'SO-B' }],
      so_item_decorations: [{ id: 10, so_item_id: 1, deco_index: 0 }, { id: 20, so_item_id: 2, deco_index: 0 }],
    });
    shared.getSupabaseAdmin.mockReturnValue(admin);

    const response = await invoke({ table: 'so_item_decorations', query: 'select=*&order=deco_index.asc' });

    expect(JSON.parse(response.body).map((row) => row.id)).toEqual([10]);
    expect(admin.calls.find((call) => call.table === 'so_item_decorations').filters)
      .toContainEqual(['in', 'so_item_id', [1]]);
  });

  test('preserves legacy invoice line_items used to scope partial invoices', async () => {
    const lineItems = [{ so_item_index: 1, qty: 3, unit_price: 42 }];
    const admin = fakeAdmin({ invoices: [
      { id: 'INV-A', customer_id: 'A', so_id: 'SO-A', total: 126, line_items: lineItems },
    ] });
    shared.getSupabaseAdmin.mockReturnValue(admin);

    const response = await invoke({ table: 'invoices' });

    expect(JSON.parse(response.body)[0].line_items).toEqual(lineItems);
    expect(admin.calls[0].select).toContain('line_items');
  });

  test('rejects tables, columns, and operators outside the allowlist', async () => {
    const admin = fakeAdmin({}); shared.getSupabaseAdmin.mockReturnValue(admin);
    expect((await invoke({ table: 'vendors' })).statusCode).toBe(400);
    expect((await invoke({ table: 'customers', query: 'notes=eq.secret' })).statusCode).toBe(400);
    expect((await invoke({ table: 'customers', query: 'id=like.*' })).statusCode).toBe(400);
  });

  test('caps every requested range to 1000 rows', () => {
    expect(_test.parseRange('100-99999')).toEqual({ start: 100, end: 1099 });
  });

  test('rejects an unknown credential before any table read', async () => {
    const admin = fakeAdmin({ customers: [{ id: 'A' }] });
    shared.getSupabaseAdmin.mockReturnValue(admin);
    shared.resolveCustomerFamily.mockResolvedValueOnce({ error: 'Unknown portal credential', notFound: true });

    const response = await invoke({ table: 'customers' });

    expect(response.statusCode).toBe(403);
    expect(admin.calls).toEqual([]);
  });

  test('preserves exact-count and empty Content-Range semantics', async () => {
    const admin = fakeAdmin({ sales_orders: [] });
    shared.getSupabaseAdmin.mockReturnValue(admin);

    const response = await invoke({ table: 'sales_orders', prefer: 'count=exact' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Range']).toBe('*/0');
  });

  test('does not decode in-filter operands twice', () => {
    expect(_test.parseQuery('id=in.(percent%2525)', new Set(['id'])).filters[0].value)
      .toEqual(['percent%25']);
  });
});
