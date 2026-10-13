const {
  fetchWithBackoff,
  retryDelayMs,
  stylesAfterCursor,
} = require('../../netlify/functions/_background-workers/ss-adidas-sync-core');
const health = require('../../netlify/functions/adidas-inventory-sync-health');

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  text: async () => JSON.stringify(body),
});

describe('S&S Adidas sync reliability helpers', () => {
  test('resumes after a stable sorted style cursor', () => {
    const styles = [
      { styleID: '100', styleName: 'third' },
      { styleID: '9', styleName: 'first' },
      { styleID: '20', styleName: 'second' },
    ];
    expect(stylesAfterCursor(styles, { last_style_id: '9' }).map((style) => style.styleID))
      .toEqual(['20', '100']);
  });

  test('retries failed styles behind the high-water cursor before continuing', () => {
    const styles = [
      { styleID: '9' },
      { styleID: '20' },
      { styleID: '100' },
      { styleID: '200' },
    ];
    expect(stylesAfterCursor(styles, {
      last_style_id: '100',
      retry_style_ids: ['20'],
    }).map((style) => style.styleID)).toEqual(['20', '200']);
  });

  test('honors Retry-After and retries 429 responses', async () => {
    const waits = [];
    const makeRequest = jest.fn()
      .mockResolvedValueOnce(response(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response(200, { ok: true }));

    const result = await fetchWithBackoff(makeRequest, {
      sleep: async (ms) => waits.push(ms),
    });

    expect(result.status).toBe(200);
    expect(makeRequest).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([2000]);
    expect(retryDelayMs(response(429, {}, {}), 2)).toBe(5000);
  });

  test('defers a Retry-After that cannot fit in the invocation budget', async () => {
    const waits = [];
    const makeRequest = jest.fn()
      .mockResolvedValue(response(429, {}, { 'retry-after': '600' }));

    const result = await fetchWithBackoff(makeRequest, {
      sleep: async (ms) => waits.push(ms),
      maxDelayMs: 30_000,
    });

    expect(result.status).toBe(429);
    expect(makeRequest).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});

describe('Adidas inventory sync health check', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = {
      ...originalEnv,
      REACT_APP_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      BREVO_API_KEY: 'brevo-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  test('stays quiet when both sources are recent and covered', async () => {
    const now = new Date().toISOString();
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('adidas_inventory_sync_state')) {
        return response(200, [
          { source: 'api-materials', cycle_started_at: null, last_cycle_completed_at: now },
          { source: 'ss_activewear', cycle_started_at: null, last_cycle_completed_at: now },
        ]);
      }
      if (String(url).includes('adidas_inventory_sync_runs')) {
        return response(200, [
          { source: 'api-materials', status: 'success', error_count: 0, finished_at: now, started_at: now },
          { source: 'ss_activewear', status: 'completed', error_count: 0, finished_at: now, started_at: now },
        ]);
      }
      if (String(url).includes('adidas_inventory_guard_drops')) return response(200, []);
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await health.handler();
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('emails when a source is stale or guard drops are observed', async () => {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
    global.fetch = jest.fn(async (url) => {
      const value = String(url);
      if (value.includes('adidas_inventory_sync_state')) {
        return response(200, [
          { source: 'api-materials', cycle_started_at: stale, last_cycle_completed_at: stale },
          { source: 'ss_activewear', cycle_started_at: null, last_cycle_completed_at: now },
        ]);
      }
      if (value.includes('adidas_inventory_sync_runs')) {
        return response(200, [
          { source: 'api-materials', status: 'failed', error_count: 1, finished_at: stale, started_at: stale },
          { source: 'ss_activewear', status: 'success', error_count: 0, finished_at: now, started_at: now },
        ]);
      }
      if (value.includes('adidas_inventory_guard_drops')) {
        return response(200, [{ source: 'api-materials', reason: 'raw_size_code', drop_count: 4 }]);
      }
      if (value === 'https://api.brevo.com/v3/smtp/email') return response(201, {});
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await health.handler();
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.alerted).toBe(true);
    expect(body.findings.map((finding) => finding.issue).join(' ')).toMatch(/No successful run in 24h/);
    expect(body.findings.map((finding) => finding.issue).join(' ')).toMatch(/coverage is behind/);
    expect(body.findings.map((finding) => finding.issue).join(' ')).toMatch(/4 inventory row/);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
