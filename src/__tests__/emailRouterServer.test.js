jest.mock('../../netlify/functions/_gmailSend', () => ({ sendViaGmail: jest.fn() }));
const { sendViaGmail } = require('../../netlify/functions/_gmailSend');
const { loadEmailRegistry, sendPortalEmail } = require('../../netlify/functions/_emailRouter');
const { buildEmailBlockRegistry } = require('../lib/emailRouting');
const blocked = { id: 'old-invoice', sent_history: [{ delivery: 'failed', delivery_to: 'old@district.edu', delivery_reason: '550 sender blocked' }] };
const payload = { to: [{ email: 'new@district.edu' }], subject: 'Invoice', htmlContent: '<p>invoice</p>' };
beforeEach(() => {
  process.env.BREVO_API_KEY = 'test';
  sendViaGmail.mockResolvedValue({ status: 200, messageId: 'gmail:123' });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ messageId: 'brevo123' }) }));
});
function adminPages(pages) {
  return { from: (table) => {
    const c = { select: () => c, not: () => c, order: () => c, range: async (offset) => pages(table, offset) };
    return c;
  } };
}
test('new documents use district evidence on later history pages from other documents', async () => {
  const admin = adminPages((table, offset) => ({ data: table === 'invoices' ? offset === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: i, sent_history: [] })) : [blocked] : [] }));
  expect(await sendPortalEmail(admin, payload)).toMatchObject({ messageId: 'gmail:123' });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('failed history reads stop all sends', async () => {
  const admin = adminPages(() => ({ data: null, error: { message: 'offline' } }));
  await expect(sendPortalEmail(admin, payload)).rejects.toThrow('Nothing was sent');
  expect(global.fetch).not.toHaveBeenCalled(); expect(sendViaGmail).not.toHaveBeenCalled();
});
test('linked attachment never falls back to Brevo for a blocked district', async () => {
  const reg = buildEmailBlockRegistry([[blocked]]);
  expect(await sendPortalEmail({}, { ...payload, attachment: [{ url: 'https://files.example.com/invoice.pdf' }] }, reg)).toMatchObject({ status: 422 });
  expect(global.fetch).not.toHaveBeenCalled(); expect(sendViaGmail).not.toHaveBeenCalled();
});
test('dead or opted-out CC/BCC stops the whole send and unknown suppression requires review', async () => {
  for (const event of [
    { delivery_reason: '5.1.1 user unknown' }, { delivery_event: 'spam' }, { delivery_event: 'blocked' },
  ]) {
    const reg = buildEmailBlockRegistry([[blocked, { sent_history: [{ ...event, delivery: 'failed', delivery_to: 'cc@other.edu' }] }]]);
    expect(await sendPortalEmail({}, { ...payload, bcc: [{ email: 'cc@other.edu' }] }, reg)).toMatchObject({ status: 422 });
  }
  expect(global.fetch).not.toHaveBeenCalled(); expect(sendViaGmail).not.toHaveBeenCalled();
});
test('unaffected recipients still use Brevo', async () => {
  const reg = await loadEmailRegistry(adminPages(() => ({ data: [] })));
  expect(await sendPortalEmail({}, payload, reg)).toMatchObject({ status: 200, via: 'brevo' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
