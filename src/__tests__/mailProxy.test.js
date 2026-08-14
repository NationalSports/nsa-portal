/* Outgoing staff email transport (sendBrevoEmail / mailProxyFetch).
 *
 * A rep hit "Email send failed: Failed to fetch" on every estimate and sales order he
 * sent. fetch() only throws that TypeError when the request never got a response — a
 * blocker/filter killing it in the browser, or the edge tearing down an oversized
 * upload. Both cases used to surface the raw message with no way for the rep to act on
 * it. These tests pin the two behaviors that fix it: sends go out on the neutral
 * /api/mail-send path first (the vendor name "brevo" in a URL is what filters match),
 * and every transport failure returns a message that says what to do next. */
import { sendBrevoEmail, mailProxyFetch } from '../utils';

jest.mock('../lib/supabase', () => ({
  supabase: { auth: {
    getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } } }),
    refreshSession: async () => ({ data: { session: { access_token: 't' } } }),
  } },
}));

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => 'application/json' },
  json: async () => body,
});
// What an older deploy (no /api rewrite) returns for /api/mail-send: the SPA shell,
// served 200 by the `/* -> /index.html` catch-all.
const spaShell = () => ({
  ok: true, status: 200,
  headers: { get: () => 'text/html; charset=utf-8' },
  json: async () => { throw new SyntaxError('Unexpected token <'); },
});
const blocked = () => { throw new TypeError('Failed to fetch'); };

const MAIL = { to: [{ email: 'coach@example.edu' }], subject: 'National Sports Estimate - EST-2052', htmlContent: '<p>hi</p>' };

afterEach(() => { delete global.fetch; jest.restoreAllMocks(); });

describe('mailProxyFetch — path order and fallback', () => {
  test('uses the neutral /api path first, never the vendor URL', async () => {
    const seen = [];
    global.fetch = jest.fn(async (url) => { seen.push(url); return jsonRes(200, { messageId: 'm1' }); });
    await mailProxyFetch('', { method: 'POST' });
    expect(seen).toEqual(['/api/mail-send']);
  });

  test('falls back to the vendor URL when the deploy has no /api rewrite yet', async () => {
    const seen = [];
    global.fetch = jest.fn(async (url) => { seen.push(url); return url === '/api/mail-send' ? spaShell() : jsonRes(200, { messageId: 'm1' }); });
    const { res, netErr } = await mailProxyFetch('', { method: 'POST' });
    expect(seen).toEqual(['/api/mail-send', '/.netlify/functions/brevo-proxy']);
    expect(netErr).toBeUndefined();
    expect(res.status).toBe(200);
  });

  test('a real error response is returned, not retried on the vendor path', async () => {
    const seen = [];
    global.fetch = jest.fn(async (url) => { seen.push(url); return jsonRes(401, { error: 'Missing bearer token' }); });
    const { res } = await mailProxyFetch('', { method: 'POST' });
    // authFetch's own one-shot 401 retry (hard session refresh) is the second call — both
    // stay on the neutral path, and the vendor URL is never reached.
    expect(seen).toEqual(['/api/mail-send', '/api/mail-send']);
    expect(res.status).toBe(401);
  });

  test('appends the query string (open-tracking stats lookups)', async () => {
    const seen = [];
    global.fetch = jest.fn(async (url) => { seen.push(url); return jsonRes(200, { events: [] }); });
    await mailProxyFetch('?endpoint=stats&messageId=abc', {});
    expect(seen[0]).toBe('/api/mail-send?endpoint=stats&messageId=abc');
  });
});

describe('sendBrevoEmail — transport failures are actionable', () => {
  test('sends over the neutral path', async () => {
    global.fetch = jest.fn(async () => jsonRes(201, { messageId: 'm1' }));
    const r = await sendBrevoEmail(MAIL);
    expect(r).toEqual({ ok: true, messageId: 'm1' });
    expect(global.fetch.mock.calls[0][0]).toBe('/api/mail-send');
  });

  test('a blocked vendor URL still sends — the neutral path is tried first', async () => {
    global.fetch = jest.fn(async (url) => (/brevo/.test(url) ? blocked() : jsonRes(201, { messageId: 'm1' })));
    await expect(sendBrevoEmail(MAIL)).resolves.toEqual({ ok: true, messageId: 'm1' });
  });

  test('both paths blocked: names the cause instead of surfacing "Failed to fetch"', async () => {
    global.fetch = jest.fn(blocked);
    const r = await sendBrevoEmail(MAIL);
    expect(r.ok).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(r.error).toMatch(/blocked before it left your browser/i);
    expect(r.error).toMatch(/ad blocker/i);
  });

  test('oversized payload is caught before the request is fired', async () => {
    global.fetch = jest.fn(async () => jsonRes(201, { messageId: 'm1' }));
    const r = await sendBrevoEmail({ ...MAIL, attachment: [{ name: 'mockup.pdf', content: 'A'.repeat(6 * 1024 * 1024) }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large to send/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an empty-bodied 413 reports the size, not a JSON parse error', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false, status: 413,
      headers: { get: () => 'text/plain' },
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    }));
    const r = await sendBrevoEmail(MAIL);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large to send/i);
  });
});
