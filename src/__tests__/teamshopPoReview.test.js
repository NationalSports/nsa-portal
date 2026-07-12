/* Team Shop — staff School-PO verification (netlify/functions/teamshop-po-review.js).
 *
 * Drives the exported listPending/approve/reject with a scripted fake supabase
 * (same style as teamshopCheckout.test.js) and a mocked global fetch for the
 * Brevo rejection email. Auth (verifyUser) is the handler's concern and is
 * exercised by calling the actions directly with a staff identity, matching
 * how teamshopCheckout.test.js drives its actions past verifyCoach.
 */
jest.mock('../../netlify/functions/_webstoreEmail', () => ({
  sendPoOrderApproved: jest.fn().mockResolvedValue(undefined),
}));

const emailMock = require('../../netlify/functions/_webstoreEmail');
const po = require('../../netlify/functions/teamshop-po-review');

// Scripted fake supabase — results consumed in order per "table.op" key;
// every call is recorded. Extends the teamshopCheckout fake with .not() and
// storage.createSignedUrl (the PO queue's signed-URL mint).
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
    storage: {
      from(bucket) {
        return {
          createSignedUrl: (path, seconds) => {
            const call = { table: 'storage.' + bucket, op: 'sign', payload: { path, seconds } };
            calls.push(call);
            return Promise.resolve(nextResult('storage.' + bucket + '.sign', call));
          },
        };
      },
    },
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
        not: (col, op, val) => { call.filters.push([col, op, val]); return chain; },
        in: () => chain, order: () => chain, limit: () => chain,
        update: (payload) => { call.op = 'update'; call.payload = payload; return chain; },
        then: (resolve, reject) => Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject),
      };
      return chain;
    },
  };
}

const STAFF = { ok: true, teamMemberId: 'tm-1', userId: 'u-1' };
const PENDING = {
  id: 'ordpo1', order_number: 1010002, created_at: '2026-07-10T12:00:00Z', status: 'unpaid',
  total: 250.5, buyer_name: 'Coach Jones', buyer_email: 'jones@example.com',
  po_number: 'PO-2026-0042', po_doc_path: 'ordpo1/po.pdf', customer_id: 'custA', coach_id: 'coach1',
  order_source: 'teamshop', so_id: null,
};

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  delete process.env.BREVO_API_KEY;
  delete process.env.REACT_APP_BREVO_API_KEY;
  emailMock.sendPoOrderApproved.mockClear();
});

describe('list', () => {
  test('returns pending PO orders with names and a signed PDF url', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PENDING], error: null }],
      'customers.select': [{ data: [{ id: 'custA', name: 'Central High' }], error: null }],
      'coach_accounts.select': [{ data: [{ id: 'coach1', name: 'Pat Jones', email: 'jones@example.com' }], error: null }],
      'storage.po-docs.sign': [{ data: { signedUrl: 'https://signed/po.pdf' }, error: null }],
    });
    const res = await po.listPending(sb);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.enabled).toBe(true);
    expect(out.orders).toHaveLength(1);
    expect(out.orders[0]).toMatchObject({
      id: 'ordpo1', po_number: 'PO-2026-0042', customer_name: 'Central High',
      coach_name: 'Pat Jones', pdf_url: 'https://signed/po.pdf', total: 250.5,
    });
    // signed URL is short-lived, never the raw path
    const sign = sb.calls.find((c) => c.op === 'sign');
    expect(sign.payload).toEqual({ path: 'ordpo1/po.pdf', seconds: 600 });
    expect(JSON.stringify(out.orders[0])).not.toContain('po_doc_path');
  });

  test('pre-00201 (po column missing) → enabled:false, not an error', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: null, error: { message: 'column webstore_orders.po_number does not exist' } }],
    });
    const res = await po.listPending(sb);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.enabled).toBe(false);
    expect(out.orders).toEqual([]);
  });
});

describe('approve', () => {
  test('unpaid → guarded flip to po_verified, then create_teamshop_sales_order (00199 open-invoice branch)', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PENDING], error: null }],
      'webstore_orders.update': [{ data: [{ id: 'ordpo1' }], error: null }],
      'rpc.create_teamshop_sales_order': [{ data: { so_id: 'SO-1002', replayed: false, invoice_id: 'INV-1002' }, error: null }],
    });
    const res = await po.approve(sb, { order_id: 'ordpo1' }, STAFF);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.so_id).toBe('SO-1002');
    expect(out.invoice_id).toBe('INV-1002');

    const upd = sb.calls.find((c) => c.op === 'update');
    expect(upd.payload.status).toBe('po_verified');
    expect(upd.payload.po_reviewed_by).toBe('tm-1');
    // compare-and-set: only an order still awaiting review may advance
    expect(upd.filters).toEqual(expect.arrayContaining([['id', 'ordpo1'], ['status', 'unpaid']]));
    const rpc = sb.calls.find((c) => c.op === 'rpc');
    expect(rpc.table).toBe('create_teamshop_sales_order');
    expect(rpc.payload).toEqual({ p_webstore_order_id: 'ordpo1' });

    // "PO order approved" fires once, after the RPC succeeds, with the order row.
    expect(emailMock.sendPoOrderApproved).toHaveBeenCalledTimes(1);
    expect(emailMock.sendPoOrderApproved).toHaveBeenCalledWith(sb, expect.objectContaining({ id: 'ordpo1' }));
  });

  test('a failed "PO order approved" email never fails the approval (best-effort)', async () => {
    emailMock.sendPoOrderApproved.mockRejectedValueOnce(new Error('brevo down'));
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PENDING], error: null }],
      'webstore_orders.update': [{ data: [{ id: 'ordpo1' }], error: null }],
      'rpc.create_teamshop_sales_order': [{ data: { so_id: 'SO-1002', replayed: false, invoice_id: 'INV-1002' }, error: null }],
    });
    const res = await po.approve(sb, { order_id: 'ordpo1' }, STAFF);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).so_id).toBe('SO-1002');
    expect(emailMock.sendPoOrderApproved).toHaveBeenCalledTimes(1);
  });

  test('already converted (so_id set) → replayed, no writes, no email', async () => {
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [{ ...PENDING, so_id: 'SO-1002', status: 'batched' }], error: null }] });
    const res = await po.approve(sb, { order_id: 'ordpo1' }, STAFF);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.replayed).toBe(true);
    expect(emailMock.sendPoOrderApproved).not.toHaveBeenCalled();
    expect(out.so_id).toBe('SO-1002');
    expect(sb.calls.filter((c) => c.op === 'update' || c.op === 'rpc')).toHaveLength(0);
  });

  test('lost the review race (guarded update hits 0 rows) → 409, RPC never invoked', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PENDING], error: null }],
      'webstore_orders.update': [{ data: [], error: null }],
    });
    const res = await po.approve(sb, { order_id: 'ordpo1' }, STAFF);
    expect(res.statusCode).toBe(409);
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  test('po_verified with a failed earlier conversion retries ONLY the RPC; RPC failure leaves it retryable', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [{ ...PENDING, status: 'po_verified' }], error: null }],
      'rpc.create_teamshop_sales_order': [{ data: null, error: { message: 'boom' } }],
    });
    const res = await po.approve(sb, { order_id: 'ordpo1' }, STAFF);
    expect(res.statusCode).toBe(502);
    // no status flip attempted — the order is already po_verified and stays so
    expect(sb.calls.filter((c) => c.op === 'update')).toHaveLength(0);
    // conversion never succeeded, so no "in production" email is sent
    expect(emailMock.sendPoOrderApproved).not.toHaveBeenCalled();
  });

  test('cancelled / card / non-PO orders are refused', async () => {
    for (const row of [
      { ...PENDING, status: 'cancelled' },
      { ...PENDING, order_source: null },
      { ...PENDING, po_number: null },
    ]) {
      const sb = fakeSb({ 'webstore_orders.select': [{ data: [row], error: null }] });
      const res = await po.approve(sb, { order_id: 'ordpo1' }, STAFF);
      expect(res.statusCode).toBe(409);
      expect(sb.calls.filter((c) => c.op === 'update' || c.op === 'rpc')).toHaveLength(0);
    }
  });
});

describe('reject', () => {
  test('requires a reason', async () => {
    const sb = fakeSb({});
    const res = await po.reject(sb, { order_id: 'ordpo1', reason: '   ' }, STAFF);
    expect(res.statusCode).toBe(400);
    expect(sb.calls).toHaveLength(0);
  });

  test('terminal guarded flip to cancelled with the reason recorded; email sent when Brevo is configured', async () => {
    process.env.BREVO_API_KEY = 'test-key';
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PENDING], error: null }],
      'webstore_orders.update': [{ data: [{ id: 'ordpo1' }], error: null }],
    });
    const res = await po.reject(sb, { order_id: 'ordpo1', reason: 'PO number not on file with the district' }, STAFF);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).emailed).toBe(true);

    const upd = sb.calls.find((c) => c.op === 'update');
    expect(upd.payload.status).toBe('cancelled');
    expect(upd.payload.po_rejected_reason).toBe('PO number not on file with the district');
    expect(upd.payload.po_reviewed_by).toBe('tm-1');
    expect(upd.filters).toEqual(expect.arrayContaining([['id', 'ordpo1'], ['status', 'unpaid']]));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('brevo.com');
    const sent = JSON.parse(opts.body);
    expect(sent.to).toEqual([{ email: 'jones@example.com', name: 'Coach Jones' }]);
    expect(sent.htmlContent).toContain('PO number not on file');
  });

  test('no Brevo key: rejection still lands (reason recorded), emailed:false', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PENDING], error: null }],
      'webstore_orders.update': [{ data: [{ id: 'ordpo1' }], error: null }],
    });
    const res = await po.reject(sb, { order_id: 'ordpo1', reason: 'Illegible document' }, STAFF);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).emailed).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(sb.calls.find((c) => c.op === 'update').payload.po_rejected_reason).toBe('Illegible document');
  });

  test('already reviewed / converted orders are refused', async () => {
    for (const row of [
      { ...PENDING, status: 'po_verified' },
      { ...PENDING, status: 'cancelled' },
      { ...PENDING, so_id: 'SO-1002', status: 'batched' },
    ]) {
      const sb = fakeSb({ 'webstore_orders.select': [{ data: [row], error: null }] });
      const res = await po.reject(sb, { order_id: 'ordpo1', reason: 'x' }, STAFF);
      expect(res.statusCode).toBe(409);
      expect(sb.calls.filter((c) => c.op === 'update')).toHaveLength(0);
    }
  });
});
