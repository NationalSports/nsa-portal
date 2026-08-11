/* In-flight ACH scan (netlify/functions/stripe-payment.js findInFlightIntent).
 *
 * The double-debit guard refuses a new PaymentIntent while an ACH debit for the
 * same invoice is still 'processing'. Stripe lists intents newest-first at up to
 * 100/page — a single-page scan missed any in-flight debit older than the 100
 * most recent intents (a busy multi-channel week), which is exactly the payer-
 * returns-days-later scenario the guard exists for. The scan must paginate.
 */
const { findInFlightIntent } = require('../../netlify/functions/stripe-payment');

const intent = (id, status, invoiceId) => ({ id, status, metadata: invoiceId != null ? { invoice_id: invoiceId } : {}, created: 0 });
const fillerPage = (n, start) => Array.from({ length: n }, (_, i) => intent('pi_f' + (start + i), 'succeeded', 'INV-OTHER-' + (start + i)));

// Fake Stripe client serving fixed pages; records the params of each list call.
const mkClient = (pages) => {
  const calls = [];
  return {
    calls,
    paymentIntents: {
      list: async (params) => {
        calls.push(params);
        const idx = params.starting_after ? pages.findIndex((p) => p.data.length && p.data[p.data.length - 1].id === params.starting_after) + 1 : 0;
        return pages[idx] || { data: [], has_more: false };
      },
    },
  };
};

test('finds a processing intent pushed past page 1 by newer volume', async () => {
  const hit = intent('pi_ach_old', 'processing', 'INV-63144');
  const client = mkClient([
    { data: fillerPage(100, 0), has_more: true },
    { data: fillerPage(100, 100), has_more: true },
    { data: [...fillerPage(50, 200), hit], has_more: false },
  ]);
  const found = await findInFlightIntent(client, ['INV-63144']);
  expect(found?.id).toBe('pi_ach_old');
  expect(client.calls.length).toBe(3);
  // Later pages continue from the previous page's last intent.
  expect(client.calls[1].starting_after).toBe('pi_f99');
});

test('matches comma-joined multi-invoice metadata', async () => {
  const hit = intent('pi_multi', 'processing', 'INV-1, INV-2');
  const client = mkClient([{ data: [hit], has_more: false }]);
  const found = await findInFlightIntent(client, ['INV-2']);
  expect(found?.id).toBe('pi_multi');
});

test('ignores non-processing and other-invoice intents; stops at has_more=false', async () => {
  const client = mkClient([
    { data: [intent('pi_a', 'succeeded', 'INV-9'), intent('pi_b', 'processing', 'INV-8'), intent('pi_c', 'processing', null)], has_more: false },
  ]);
  expect(await findInFlightIntent(client, ['INV-9'])).toBeNull();
  expect(client.calls.length).toBe(1);
});

test('bounded: gives up (fail-open) after maxPages rather than scanning forever', async () => {
  const endless = { data: fillerPage(100, 0), has_more: true };
  const client = { paymentIntents: { list: jest.fn(async () => endless) } };
  expect(await findInFlightIntent(client, ['INV-1'], { maxPages: 5 })).toBeNull();
  expect(client.paymentIntents.list).toHaveBeenCalledTimes(5);
});
