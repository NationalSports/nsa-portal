import { makePortalFetch } from '../lib/portalFetch';
import { makeBreakerFetch } from '../lib/requestBreaker';

const origin = 'https://portal-project.supabase.co';
const make = (fetcher, token = 'opaque-secret') => makePortalFetch(fetcher, {
  projectUrl: origin, getCredential: () => token,
});

test('portal reads carry credentials privately with pagination and response unchanged', async () => {
  const response = { status: 206, headers: { 'content-range': '1000-1999/*' } };
  const fetcher = jest.fn().mockResolvedValue(response);
  const controller = new AbortController();
  const result = await make(fetcher)(origin + '/rest/v1/invoices?select=*&order=id.asc', {
    headers: { Range: '1000-1999', Accept: 'application/vnd.pgrst.object+json', Authorization: 'Bearer staff-token' },
    signal: controller.signal,
  });
  expect(result).toBe(response);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('/.netlify/functions/portal-data');
  expect(init.signal).toBe(controller.signal);
  expect(init.headers.Authorization).toBeUndefined();
  expect(JSON.parse(init.body)).toMatchObject({ portal: 'opaque-secret', table: 'invoices', range: '1000-1999', query: 'select=*&order=id.asc', accept: 'application/vnd.pgrst.object+json' });
});

test.each([
  [origin + '/rest/v1/customers', { method: 'POST', body: '{}' }, 'opaque-secret'],
  [origin + '/auth/v1/user', {}, 'opaque-secret'],
  [origin + '/rest/v1/products', {}, 'opaque-secret'],
  ['https://other.supabase.co/rest/v1/customers', {}, 'opaque-secret'],
  [origin + '/rest/v1/customers', {}, ''],
])('unrelated and staff traffic is preserved: %s', async (url, init, token) => {
  const fetcher = jest.fn().mockResolvedValue({});
  await make(fetcher, token)(url, init);
  expect(fetcher).toHaveBeenCalledWith(url, init);
});

test('a gateway failure never retries through public tables', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('Offline'));
  await expect(make(fetcher)(new URL(origin + '/rest/v1/customers'))).rejects.toThrow('Offline');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('the runaway request breaker still sees the original table before proxying', async () => {
  const savedResponse = global.Response;
  global.Response = class { constructor(body, options) { this.status = options.status; } };
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const fetcher = jest.fn().mockResolvedValue({ status: 200 });
    const guarded = makeBreakerFetch({ fetch: make(fetcher), maxPerWindow: 1 });
    await guarded(origin + '/rest/v1/invoices');
    expect((await guarded(origin + '/rest/v1/invoices')).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { global.Response = savedResponse; log.mockRestore(); }
});
