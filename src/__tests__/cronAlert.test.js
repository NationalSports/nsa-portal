// _cronAlert: the three supplier-bill crons email once when they fail (2026-10-17 audit).
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('_cronAlert', () => {
  const env = { ...process.env };
  let fetchCalls;
  beforeEach(() => {
    jest.resetModules();
    fetchCalls = [];
    global.fetch = jest.fn(async (url, opts) => { fetchCalls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; });
    process.env.REACT_APP_BREVO_API_KEY = 'k';
    delete process.env.CRON_ALERT_EMAILS; delete process.env.BILL_ANOMALY_EMAILS;
  });
  afterEach(() => { process.env = { ...env }; delete global.fetch; });

  test('a non-2xx return emails accounting + Steve once and keeps the original response', async () => {
    const { withCronAlert } = require('../../netlify/functions/_cronAlert');
    const h = withCronAlert('Sports Inc bill feed', 'No new bills reach the Portal.', async () => ({ statusCode: 502, body: 'Sports Inc API 401' }));
    const res = await h();
    expect(res).toEqual({ statusCode: 502, body: 'Sports Inc API 401' });
    expect(fetchCalls).toHaveLength(1);
    const b = fetchCalls[0].body;
    expect(fetchCalls[0].url).toMatch(/brevo/);
    expect(b.subject).toBe('Portal job failed: Sports Inc bill feed');
    expect(b.to.map((t) => t.email).sort()).toEqual(['accounting@nationalsportsapparel.com', 'steve@nationalsportsapparel.com']);
    expect(b.htmlContent).toMatch(/Sports Inc API 401/);
    expect(b.htmlContent).toMatch(/No new bills reach the Portal/);
  });

  test('a thrown exception becomes a 500 and one email', async () => {
    const { withCronAlert } = require('../../netlify/functions/_cronAlert');
    const h = withCronAlert('S&S Activewear bill feed', 'c', async () => { throw new Error('fetch failed: ENOTFOUND'); });
    const res = await h();
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatch(/ENOTFOUND/);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.htmlContent).toMatch(/ENOTFOUND/);
  });

  test('a clean run sends nothing', async () => {
    const { withCronAlert } = require('../../netlify/functions/_cronAlert');
    const h = withCronAlert('x', 'c', async () => ({ statusCode: 200, body: 'ok' }));
    expect(await h()).toEqual({ statusCode: 200, body: 'ok' });
    expect(fetchCalls).toHaveLength(0);
  });

  test('without a mail key the failure is logged and the original response still returns', async () => {
    delete process.env.REACT_APP_BREVO_API_KEY;
    const { withCronAlert } = require('../../netlify/functions/_cronAlert');
    const h = withCronAlert('x', 'c', async () => ({ statusCode: 502, body: 'down' }));
    expect(await h()).toEqual({ statusCode: 502, body: 'down' });
    expect(fetchCalls).toHaveLength(0);
  });

  test('CRON_ALERT_EMAILS overrides the recipients', async () => {
    process.env.CRON_ALERT_EMAILS = 'a@x.com, b@x.com';
    const { recipients } = require('../../netlify/functions/_cronAlert');
    expect(recipients()).toEqual(['a@x.com', 'b@x.com']);
  });
});

describe('the bill crons are wrapped and no longer claim nothing is automatic', () => {
  const si = read('netlify/functions/_background-workers/sportslink-sync-background.js');
  const ss = read('netlify/functions/_background-workers/ss-orders-sync-background.js');
  const digest = read('netlify/functions/bill-anomaly-digest.js');

  test('each handler is wrapped in withCronAlert', () => {
    for (const src of [si, ss, digest]) {
      expect(src).toMatch(/require\('\.\.\/(?:\.\.\/)?_cronAlert'\)|require\('\.\/_cronAlert'\)/);
      expect(src).toMatch(/exports\.handler = withCronAlert\(/);
    }
  });

  test('the digest fails loudly when anomalies exist but the mail key is missing', () => {
    expect(digest).toMatch(/statusCode: 500, body: 'Anomalies found but REACT_APP_BREVO_API_KEY is not set/);
    expect(digest).not.toMatch(/statusCode: 200, body: 'Anomalies found but/);
  });

  test('the Sports Inc and S&S digests describe auto-push honestly', () => {
    for (const src of [si, ss]) {
      expect(src).not.toMatch(/Nothing is applied automatically/);
      expect(src).toMatch(/Clean, exact matches push themselves to the Portal at the daily pull/);
    }
  });
});
