const { sendOrderConfirmation } = require('../../netlify/functions/_webstoreEmail');

const store = { name: 'San Gabriel Football Team Store', slug: 'san-gabriel' };
function fakeSb() {
  return {
    from(table) {
      const chain = {
        select: () => chain, eq: () => chain, limit: () => chain,
        then: (resolve, reject) => Promise.resolve({ data: table === 'webstores' ? [store] : [], error: null }).then(resolve, reject),
      };
      return chain;
    },
  };
}
const order = { id: 'order-id', store_id: 'store-id', order_number: 12345, buyer_email: 'buyer@example.com', buyer_name: 'Buyer', payment_mode: 'paid', total: 200 };
let oldFetch, oldKey;
beforeEach(() => {
  oldFetch = global.fetch;
  oldKey = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = 'test-only';
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});
afterEach(() => {
  global.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = oldKey;
});

async function email(overrides = {}) {
  await sendOrderConfirmation(fakeSb(), { ...order, ...overrides });
  return JSON.parse(global.fetch.mock.calls[0][1].body);
}

test('confirmation uses the store/order subject and a quiet reference immediately below the status', async () => {
  const sent = await email();
  expect(sent.subject).toBe('San Gabriel Football Team Store - Order #12345');
  expect(sent.htmlContent).toMatch(/Order confirmed &amp; paid<\/div>\s*<div style="font-size:13px;opacity:.85;margin-top:6px">Order #12345<\/div>/);
});
test('invoiced confirmation preserves its status and includes the same order reference', async () => {
  const sent = await email({ payment_mode: 'invoice' });
  expect(sent.subject).toBe('San Gabriel Football Team Store - Order #12345');
  expect(sent.htmlContent).toContain('Order #12345');
  expect(sent.htmlContent).toContain('Order confirmed</div>');
  expect(sent.htmlContent).not.toContain('Order confirmed &amp; paid');
});
test('legacy orders without a number have a useful subject without an undefined reference', async () => {
  const sent = await email({ order_number: null });
  expect(sent.subject).toBe('San Gabriel Football Team Store - Order confirmed');
  expect(sent.htmlContent).not.toContain('Order #');
});
test('order references are escaped in HTML', async () => {
  const sent = await email({ order_number: '<123&45>' });
  expect(sent.htmlContent).toContain('Order #&lt;123&amp;45&gt;');
  expect(sent.htmlContent).not.toContain('Order #<123&45>');
});
