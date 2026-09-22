import { checkUpsTracking } from '../lib/upsTracking';
const { handler } = require('../../netlify/functions/ups-tracking');
const ok = { status: 'On the Way', pickedUp: true, delivered: false };
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
test('deduplicates simultaneous requests and caches successful checks', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ok });
  const results = await Promise.all([checkUpsTracking('1ZCACHE'), checkUpsTracking('1ZCACHE')]);
  expect(results).toEqual([ok, ok]);
  await checkUpsTracking('1ZCACHE');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('server times out a stalled upstream request and does not claim a pickup', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = handler({ queryStringParameters: { tracking: '1ZTIMEOUT' } });
  jest.advanceTimersByTime(6000);
  const response = await pending;
  expect(response.statusCode).toBe(504);
  expect(JSON.parse(response.body)).toMatchObject({ pickedUp: false, error: 'UPS request timed out' });
  expect(jest.getTimerCount()).toBe(0);
});
test('server reports upstream errors as failures', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
  expect((await handler({ queryStringParameters: { tracking: '1ZFAILED' } })).statusCode).toBe(502);
});
test('server preserves successful tracking results', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ trackDetails: [{ packageStatus: 'Delivered', shipmentProgressActivities: [{ date: 'today', activityScan: 'Delivered' }] }] }) });
  const response = await handler({ queryStringParameters: { tracking: '1ZGOOD' } });
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({ pickedUp: true, delivered: true, status: 'Delivered' });
});
test('browser aborts a stalled request and pauses further lookups during the outage', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = checkUpsTracking('1ZBROWSER');
  const assertion = expect(pending).rejects.toThrow('aborted');
  jest.advanceTimersByTime(9000);
  await assertion;
  await expect(checkUpsTracking('1ZNEXT')).rejects.toThrow('temporarily unavailable');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60001);
  global.fetch.mockResolvedValue({ ok: true, json: async () => ok });
  expect(await checkUpsTracking('1ZNEXT')).toEqual(ok);
  expect(jest.getTimerCount()).toBe(0);
});
test('scheduled check stops after an outage and preserves earlier confirmed shipments', async () => {
  const { handler: sync } = require('../../netlify/functions/ups-pickup-sync');
  const previousUrl = process.env.REACT_APP_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.REACT_APP_SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const shipments = [{ id: 'a', tracking_number: '1ZA' }, { id: 'b', tracking_number: '1ZB' }, { id: 'c', tracking_number: '1ZC' }];
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'SO-TEST', _shipments: shipments }] })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ trackDetails: [{ packageStatus: 'Delivered' }] }) })
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true });
  try {
    const response = await sync();
    expect(JSON.parse(response.body)).toMatchObject({ checked: 2, confirmed: 1, errors: 1, sos_updated: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    const patch = JSON.parse(global.fetch.mock.calls[3][1].body);
    expect(patch._shipments[0]).toMatchObject({ id: 'a', carrier_picked_up: true });
    expect(patch._shipments.slice(1)).toEqual(shipments.slice(1));
  } finally {
    if (previousUrl === undefined) delete process.env.REACT_APP_SUPABASE_URL; else process.env.REACT_APP_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    warn.mockRestore(); log.mockRestore();
  }
});
test('server timeout also covers a stalled response body', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async (url, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('body aborted')));
  }) }));
  const pending = handler({ queryStringParameters: { tracking: '1ZBODY' } });
  await Promise.resolve();
  jest.advanceTimersByTime(6000);
  expect((await pending).statusCode).toBe(504);
  expect(jest.getTimerCount()).toBe(0);
});
