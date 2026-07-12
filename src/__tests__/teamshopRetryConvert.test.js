/* Team Shop / Club — staff "Retry convert" (netlify/functions/teamshop-retry-convert.js,
 * Team Shop backend hardening #3). Drives the exported retryConvert directly
 * with a scripted fake supabase — same style as teamshopPoReview.test.js. */
const { retryConvert } = require('../../netlify/functions/teamshop-retry-convert');

function fakeSb(script) {
  const calls = [];
  const nextResult = (key, call) => {
    const queue = script[key] || [];
    const result = queue.length ? queue.shift() : { data: [], error: null };
    call.result = result;
    return result;
  };
  return {
    calls,
    rpc(fn, args) {
      const call = { table: fn, op: 'rpc', payload: args };
      calls.push(call);
      return Promise.resolve(nextResult('rpc.' + fn, call));
    },
    from(table) {
      const call = { table, op: 'select', filters: [], payload: null };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (col, val) => { call.filters.push([col, val]); return chain; },
        limit: () => chain,
        then: (resolve, reject) => Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject),
      };
      return chain;
    },
  };
}

test('order_id is required', async () => {
  const sb = fakeSb({});
  const res = await retryConvert(sb, {});
  expect(res.statusCode).toBe(400);
});

test('unknown order -> 404', async () => {
  const sb = fakeSb({ 'webstore_orders.select': [{ data: [], error: null }] });
  const res = await retryConvert(sb, { order_id: 'nope' });
  expect(res.statusCode).toBe(404);
});

test('non teamshop/club order is refused', async () => {
  const sb = fakeSb({ 'webstore_orders.select': [{ data: [{ id: 'o1', order_source: 'webstore', status: 'paid', so_id: null }], error: null }] });
  const res = await retryConvert(sb, { order_id: 'o1' });
  expect(res.statusCode).toBe(409);
});

test('already-converted order replays with so_id, no RPC call', async () => {
  const sb = fakeSb({ 'webstore_orders.select': [{ data: [{ id: 'o1', order_source: 'teamshop', status: 'batched', so_id: 'SO-1' }], error: null }] });
  const res = await retryConvert(sb, { order_id: 'o1' });
  const body = JSON.parse(res.body);
  expect(body).toEqual({ ok: true, so_id: 'SO-1', replayed: true });
  expect(sb.calls.some((c) => c.op === 'rpc')).toBe(false);
});

test('order not in a retryable status is refused with the status in the message', async () => {
  const sb = fakeSb({ 'webstore_orders.select': [{ data: [{ id: 'o1', order_source: 'teamshop', status: 'cancelled', so_id: null }], error: null }] });
  const res = await retryConvert(sb, { order_id: 'o1' });
  expect(res.statusCode).toBe(409);
  expect(JSON.parse(res.body).error).toMatch(/cancelled/);
});

test('teamshop order calls create_teamshop_sales_order with p_webstore_order_id and auto-PO generation', async () => {
  jest.resetModules();
  jest.doMock('../../netlify/functions/teamshop-auto-po', () => ({ generateForSoSafe: jest.fn(() => Promise.resolve({ ok: true })) }));
  const { retryConvert: rc } = require('../../netlify/functions/teamshop-retry-convert');
  const sb = fakeSb({
    'webstore_orders.select': [{ data: [{ id: 'o1', order_source: 'teamshop', status: 'paid', so_id: null }], error: null }],
    'rpc.create_teamshop_sales_order': [{ data: { so_id: 'SO-9' }, error: null }],
  });
  const res = await rc(sb, { order_id: 'o1' });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true, so_id: 'SO-9' });
  const rpcCall = sb.calls.find((c) => c.op === 'rpc');
  expect(rpcCall.table).toBe('create_teamshop_sales_order');
  expect(rpcCall.payload).toEqual({ p_webstore_order_id: 'o1' });
  const autoPo = require('../../netlify/functions/teamshop-auto-po');
  expect(autoPo.generateForSoSafe).toHaveBeenCalledWith(sb, 'SO-9', 'teamshop-retry-convert', 'teamshop-retry-convert');
  jest.dontMock('../../netlify/functions/teamshop-auto-po');
});

test('club order calls create_club_sales_order with p_order_id and skips auto-PO', async () => {
  jest.resetModules();
  jest.doMock('../../netlify/functions/teamshop-auto-po', () => ({ generateForSoSafe: jest.fn(() => Promise.resolve({ ok: true })) }));
  const { retryConvert: rc } = require('../../netlify/functions/teamshop-retry-convert');
  const sb = fakeSb({
    'webstore_orders.select': [{ data: [{ id: 'o2', order_source: 'club', status: 'paid', so_id: null }], error: null }],
    'rpc.create_club_sales_order': [{ data: { so_id: 'SO-10' }, error: null }],
  });
  const res = await rc(sb, { order_id: 'o2' });
  expect(res.statusCode).toBe(200);
  const rpcCall = sb.calls.find((c) => c.op === 'rpc');
  expect(rpcCall.table).toBe('create_club_sales_order');
  expect(rpcCall.payload).toEqual({ p_order_id: 'o2' });
  const autoPo = require('../../netlify/functions/teamshop-auto-po');
  expect(autoPo.generateForSoSafe).not.toHaveBeenCalled();
  jest.dontMock('../../netlify/functions/teamshop-auto-po');
});

test('RPC failure surfaces the REAL error message, not a generic one', async () => {
  const sb = fakeSb({
    'webstore_orders.select': [{ data: [{ id: 'o1', order_source: 'teamshop', status: 'paid', so_id: null }], error: null }],
    'rpc.create_teamshop_sales_order': [{ data: null, error: { message: 'duplicate key value violates unique constraint "so_items_pkey"' } }],
  });
  const res = await retryConvert(sb, { order_id: 'o1' });
  expect(res.statusCode).toBe(502);
  expect(JSON.parse(res.body).error).toBe('duplicate key value violates unique constraint "so_items_pkey"');
});
