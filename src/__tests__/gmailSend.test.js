/* The Gmail route sends real customer email from the shared sales@ mailbox (or the rep's own,
 * with delegation). Properties under test: the rep is resolved server-side and gets Reply-To +
 * a Bcc copy, bad input never reaches Google, and a delegation failure falls back to sales@. */

jest.mock('../../netlify/functions/_gmailAi', () => {
  const actual = jest.requireActual('../../netlify/functions/_gmailAi');
  return { ...actual, getAccessToken: jest.fn(async () => 'sales-token'), gmailFetch: jest.fn(async () => ({ id: 'g1' })) };
});
const { gmailFetch, getAccessToken } = require('../../netlify/functions/_gmailAi');
const { sendViaGmail } = require('../../netlify/functions/_gmailSend');

const admin = (row) => ({ from: () => { const c = { select: () => c, ilike: () => c, limit: () => c, maybeSingle: async () => ({ data: row }) }; return c; } });
const rawOf = (call) => Buffer.from(JSON.parse(call[2].body).raw, 'base64url').toString('utf8');
const rep = { name: 'Jered Hunt', email: 'jered@nationalsportsapparel.com', is_active: true };
const payload = {
  sender: { name: 'Jered Hunt', email: 'noreply@nationalsportsapparel.com' },
  replyTo: { email: 'jered@nationalsportsapparel.com', name: 'Jered Hunt' },
  to: [{ email: 'fidel_alva@sangerusd.net' }], subject: 'Invoice INV-64030 — $120.00',
  htmlContent: '<p>Hi</p>', attachment: [{ name: 'INV-64030.pdf', content: 'JVBERi0=' }],
};

// CRA's jest config resets mock implementations before every test — re-arm them here.
beforeEach(() => {
  gmailFetch.mockImplementation(async () => ({ id: 'g1' }));
  getAccessToken.mockImplementation(async () => 'sales-token');
  delete process.env.GMAIL_SEND_AS_REPS;
});

test('sends from sales@ as the rep, with Reply-To and a Bcc copy to the rep', async () => {
  const out = await sendViaGmail(admin(rep), payload);
  expect(out).toMatchObject({ status: 200, messageId: 'gmail:g1', via: 'sales' });
  const raw = rawOf(gmailFetch.mock.calls[0]);
  expect(raw).toContain('From: Jered Hunt | National Sports Apparel <sales@nationalsportsapparel.com>');
  expect(raw).toContain('To: fidel_alva@sangerusd.net');
  expect(raw).toContain('Reply-To: Jered Hunt <jered@nationalsportsapparel.com>');
  expect(raw).toContain('Bcc: jered@nationalsportsapparel.com');
  expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/); // em dash encoded
  expect(raw).toContain('filename="INV-64030.pdf"');
});

test('rejects header-injection addresses and url attachments before calling Google', async () => {
  expect((await sendViaGmail(admin(rep), { ...payload, to: [{ email: 'a@b.com\r\nBcc: x@y.com' }] })).status).toBe(400);
  expect((await sendViaGmail(admin(rep), { ...payload, attachment: [{ url: 'https://x/y.png', name: 'y.png' }] })).status).toBe(400);
  expect(gmailFetch).not.toHaveBeenCalled();
});

test('an inactive or unknown sender is not presented as a rep', async () => {
  await sendViaGmail(admin(null), payload);
  const raw = rawOf(gmailFetch.mock.calls[0]);
  expect(raw).toContain('From: Jered Hunt <sales@nationalsportsapparel.com>');
  expect(raw).not.toContain('Bcc:');
});

test('delegation failure falls back to sales@', async () => {
  process.env.GMAIL_SEND_AS_REPS = 'true';
  process.env.GOOGLE_SA_EMAIL = 'sa@x.iam.gserviceaccount.com';
  process.env.GOOGLE_SA_PRIVATE_KEY = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized_client' }) }));
  const out = await sendViaGmail(admin(rep), payload);
  expect(out).toMatchObject({ status: 200, via: 'sales' });
  expect(out.delegationError).toContain('unauthorized_client');
});

test('Gmail reminders preserve one-click unsubscribe headers', async () => {
  await sendViaGmail(admin(rep), { ...payload, headers: { 'List-Unsubscribe': '<https://portal.example.com/unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Untrusted': 'ignored' } });
  const raw = rawOf(gmailFetch.mock.calls[0]);
  expect(raw).toContain('List-Unsubscribe: <https://portal.example.com/unsubscribe>');
  expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  expect(raw).not.toContain('X-Untrusted');
});
test('an ambiguous delegated send never falls back to sales and creates a duplicate', async () => {
  process.env.GMAIL_SEND_AS_REPS = 'true';
  process.env.GOOGLE_SA_EMAIL = 'sa@x.iam.gserviceaccount.com';
  process.env.GOOGLE_SA_PRIVATE_KEY = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'rep-token' }) }));
  gmailFetch.mockRejectedValue(new Error('timeout'));
  expect(await sendViaGmail(admin(rep), payload)).toMatchObject({ status: 502, uncertain: true });
  expect(gmailFetch).toHaveBeenCalledTimes(1);
  expect(getAccessToken).not.toHaveBeenCalled();
});
