jest.mock('../../netlify/functions/_gmailSend', () => ({ sendViaGmail: jest.fn() }));
const { sendViaGmail } = require('../../netlify/functions/_gmailSend');
const { trackedSend, retryPlan, retryPayload, fingerprint } = require('../../netlify/functions/_emailFirewallRetry');
const { processRow } = require('../../netlify/functions/email-firewall-retry');
const { buildEmailBlockRegistry } = require('../lib/emailRouting');
const payload = { sender: { name: 'Rep', email: 'noreply@nationalsportsapparel.com' }, replyTo: { email: 'rep@nationalsportsapparel.com' }, to: [{ email: 'coach@district.edu' }, { email: 'delivered@other.edu' }], subject: 'Invoice', htmlContent: '<p>Original invoice</p>', attachment: [{ name: 'invoice.pdf', content: 'cGRm' }] };
const firewall = (email = 'coach@district.edu') => ({ email, event: 'hardBounces', reason: '550 permanent failure (recipient:blocked)' });
function fixture(options = {}) {
  const state = { id: 'row1', payload, status: 'pending', original_message_id: 'brevo1', fingerprint: fingerprint(payload), created_at: '2026-09-26T01:00:00Z', expires_at: '2099-01-01', next_check_at: '2026-09-26T01:05:00Z', ...options.row };
  const admin = { from: () => {
    let values = null, isInsert = false, filters = [], gt = false;
    const chain = {
      select: () => chain, single: () => chain, limit: () => chain,
      insert: (v) => { isInsert = true; values = v; return chain; },
      update: (v) => { values = v; return chain; },
      eq: (key, value) => { filters.push([key, value]); return chain; },
      gt: () => { gt = true; return chain; },
      then: (resolve, reject) => Promise.resolve().then(() => {
        if (gt) return { data: options.newer ? [{ id: 'newer' }] : [] };
        if (isInsert) return options.insertError ? { error: new Error('DB down') } : { data: { id: 'row1' } };
        if (options.resultError && values?.original_message_id) return { error: new Error('DB down after send') };
        if (options.afterSendError && values?.retry_results) return { error: new Error('DB down after Gmail') };
        if (!filters.every(([key, value]) => state[key] === value)) return { data: [] };
        if (values) Object.assign(state, values);
        return { data: [{ id: state.id }] };
      }).then(resolve, reject),
    }; return chain;
  } };
  return { state, admin, row: { ...state } };
}
beforeEach(() => {
  process.env.EMAIL_AUTO_FIREWALL_RETRY_ENABLED = 'true';
  sendViaGmail.mockResolvedValue({ status: 200, messageId: 'gmail:retry1', from: 'sales@nationalsportsapparel.com' });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ events: [firewall(), { email: 'delivered@other.edu', event: 'delivered' }] }) }));
});
afterEach(() => { delete process.env.EMAIL_AUTO_FIREWALL_RETRY_ENABLED; });
test('retries only a confirmed firewall recipient with the original attachment and rep reply address', async () => {
  const { admin, row, state } = fixture();
  expect(await processRow(admin, row, buildEmailBlockRegistry([]))).toBe('resent');
  expect(sendViaGmail).toHaveBeenCalledTimes(1);
  expect(sendViaGmail.mock.calls[0][1]).toMatchObject({ to: [{ email: 'coach@district.edu' }], cc: [], bcc: [], replyTo: payload.replyTo, attachment: payload.attachment });
  expect(state.status).toBe('resent'); expect(state.payload).toBeNull();
});
test('overlapping workers and repeated runs never resend the same original twice', async () => {
  const { admin, row } = fixture();
  await Promise.all([processRow(admin, row, buildEmailBlockRegistry([])), processRow(admin, row, buildEmailBlockRegistry([]))]);
  await processRow(admin, row, buildEmailBlockRegistry([]));
  expect(sendViaGmail).toHaveBeenCalledTimes(1);
});
test('a crash saving the Gmail result leaves retrying and never automatically repeats', async () => {
  const { admin, row, state } = fixture({ afterSendError: true });
  await expect(processRow(admin, row, buildEmailBlockRegistry([]))).rejects.toThrow();
  expect(state.status).toBe('retrying');
  await processRow(admin, { ...state }, buildEmailBlockRegistry([]));
  expect(sendViaGmail).toHaveBeenCalledTimes(1);
});
test('uncertain Gmail outcome is held for manual review', async () => {
  sendViaGmail.mockRejectedValue(new Error('connection closed'));
  const { admin, row, state } = fixture();
  expect(await processRow(admin, row, buildEmailBlockRegistry([]))).toBe('review');
  await processRow(admin, { ...state }, buildEmailBlockRegistry([]));
  expect(sendViaGmail).toHaveBeenCalledTimes(1);
});
test.each([
  { event: 'blocked', reason: '' },
  { event: 'hardBounces', reason: '550 5.1.1 user unknown' },
  { event: 'softBounces', reason: '550 sender blocked' },
  { event: 'spam', reason: 'complaint' },
  { event: 'hardBounces', reason: 'unknown error' },
])('does not auto-resend ineligible rejection %j', async (event) => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ events: [{ email: 'coach@district.edu', ...event }] }) });
  const { admin, row } = fixture();
  await processRow(admin, row, buildEmailBlockRegistry([]));
  expect(sendViaGmail).not.toHaveBeenCalled();
});
test('delivered/opened recipients and unrelated addresses are never retried', () => {
  expect(retryPlan(payload, [firewall(), { event: 'opened', email: 'coach@district.edu' }, firewall('unrelated@district.edu')]).retry).toEqual([]);
});
test('a recorded opt-out, newer send, or linked attachment prevents retry', async () => {
  for (const options of [{ newer: true }, { row: { payload: { ...payload, attachment: [{ url: 'https://example.com/file.pdf' }] } } }, {}]) {
    const { admin, row } = fixture(options);
    const registry = !Object.keys(options).length ? buildEmailBlockRegistry([[{ sent_history: [{ delivery: 'failed', delivery_event: 'spam', delivery_to: 'coach@district.edu' }] }]]) : buildEmailBlockRegistry([]);
    await processRow(admin, row, registry);
  }
  expect(sendViaGmail).not.toHaveBeenCalled();
});
test('BCC retry is isolated so its original address is never revealed to other recipients', () => {
  const p = retryPayload({ ...payload, bcc: [{ email: 'private@district.edu' }] }, ['private@district.edu']);
  expect(p.to).toEqual([{ email: 'private@district.edu' }]); expect(p.cc).toEqual([]); expect(p.bcc).toEqual([]);
});
test('failure to create the durable record prevents the initial send', async () => {
  const send = jest.fn();
  const { admin } = fixture({ insertError: true });
  expect(await trackedSend(admin, payload, send)).toMatchObject({ status: 503 });
  expect(send).not.toHaveBeenCalled();
});
test('post-send bookkeeping failure does not falsely report the original send as failed', async () => {
  const { admin } = fixture({ resultError: true });
  const send = jest.fn(async () => ({ status: 201, messageId: 'brevo1' }));
  expect(await trackedSend(admin, payload, send)).toMatchObject({ status: 201, messageId: 'brevo1', automaticRetryAvailable: false });
  expect(send).toHaveBeenCalledTimes(1);
});

test('consumer and company mailbox rejections do not trigger district auto-retry', () => {
  for (const email of ['coach@gmail.com', 'rep@nationalsportsapparel.com']) {
    const result = retryPlan({ ...payload, to: [{ email }] }, [firewall(email)]);
    expect(result.retry).toEqual([]); expect(result.manual).toEqual([email]);
  }
});
