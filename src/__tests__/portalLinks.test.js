jest.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

const { supabase } = require('../lib/supabase');
const { getPortalUrl, _resetPortalLinkCache } = require('../lib/portalLinks');

const session = (userId = 'staff-1', signedInAt = '2026-09-04T10:00:00Z') => ({
  data: { session: { access_token: `jwt-${userId}-${signedInAt}`, user: { id: userId, last_sign_in_at: signedInAt } } },
  error: null,
});

describe('getPortalUrl', () => {
  beforeEach(() => {
    _resetPortalLinkCache();
    supabase.auth.getSession.mockReset().mockResolvedValue(session());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, token: 'secret token', id: 'cred-1' }),
    });
  });

  test('issues once per staff session/customer and reuses the in-memory token', async () => {
    const [first, second] = await Promise.all([
      getPortalUrl('customer-1', 'est=EST%201'),
      getPortalUrl('customer-1', '&page=billing'),
    ]);

    expect(first).toBe('https://nationalsportsapparel.com/coach?portal=secret%20token&est=EST%201');
    expect(second).toBe('https://nationalsportsapparel.com/coach?portal=secret%20token&page=billing');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/.netlify/functions/portal-credential', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer jwt-staff-1-2026-09-04T10:00:00Z' }),
      body: JSON.stringify({ customer_id: 'customer-1', action: 'issue' }),
    }));
  });

  test('clears cached credentials when the authenticated session identity changes', async () => {
    await getPortalUrl('customer-1');
    supabase.auth.getSession.mockResolvedValue(session('staff-2'));
    await getPortalUrl('customer-1');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not let an old in-flight session poison the new identity cache', async () => {
    let resolveOldIssue;
    global.fetch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldIssue = resolve; }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, token: 'new-token', id: 'cred-new' }) });

    const oldRequest = getPortalUrl('customer-1');
    await Promise.resolve();await Promise.resolve();
    supabase.auth.getSession.mockResolvedValue(session('staff-2'));
    await expect(getPortalUrl('customer-1')).resolves.toContain('portal=new-token');
    resolveOldIssue({ ok: true, status: 200, json: async () => ({ ok: true, token: 'old-token', id: 'cred-old' }) });
    await oldRequest;

    await expect(getPortalUrl('customer-1')).resolves.toContain('portal=new-token');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not cache an issuance failure and surfaces the server error', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ ok: false, error: 'Credential storage unavailable' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, token: 'retry-token', id: 'cred-2' }) });

    await expect(getPortalUrl('customer-1')).rejects.toThrow('Credential storage unavailable');
    await expect(getPortalUrl('customer-1')).resolves.toContain('portal=retry-token');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('requires an authenticated staff session and never calls the issuer without one', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getPortalUrl('customer-1')).rejects.toThrow(/staff session has expired/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
