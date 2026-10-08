const { stalledJobMessage, expireStalledJobs, dispatchShowcaseJob, recordDispatchFailure } = require('../../netlify/functions/_showcaseJobs');
const { conditionalUpdate } = require('../../netlify/functions/_background-workers/showcase-image-background');
const { artworkUrls, buildAnalysisBrief, buildEditPrompt } = require('../../netlify/functions/_showcase');

const now = Date.parse('2026-10-08T08:05:00Z');
const queued = { id: 'asset', generation_request_id: 'request', status: 'queued', updated_at: '2026-10-08T07:58:32Z', approved_showcase_image_url: 'approved.png' };
function memoryDb(initial) {
  let row = { ...initial };
  return { get row() { return row; }, from() {
    let patch; const filters = [];
    const execute = () => {
      if (!filters.every(([k, v]) => row[k] === v)) return { data: null, error: null };
      row = { ...row, ...patch }; return { data: { ...row }, error: null };
    };
    const chain = { update(value) { patch = value; return chain; }, eq(k, v) { filters.push([k, v]); return chain; },
      select() { return chain; }, maybeSingle: async () => execute(), then: (resolve) => Promise.resolve(execute()).then(resolve) };
    return chain;
  } };
}

test('an unstarted job becomes retryable without removing its approved image', async () => {
  const admin = memoryDb(queued);
  const [result] = await expireStalledJobs(admin, [queued], now);
  expect(result.status).toBe('failed');
  expect(result.error_details).toContain('did not start');
  expect(result.generation_request_id).toBeNull();
  expect(result.approved_showcase_image_url).toBe('approved.png');
  expect(await conditionalUpdate(admin, 'asset', 'request', { status: 'generating' }, 'queued')).toBe(false);
});

test('recovery never overwrites a job that starts or is replaced while status loads', async () => {
  for (const changed of [{ status: 'generating' }, { generation_request_id: 'new', updated_at: '2026-10-08T08:04:59Z' }, { status: 'canceled' }]) {
    const admin = memoryDb({ ...queued, ...changed });
    await expireStalledJobs(admin, [queued], now);
    expect(admin.row).toEqual({ ...queued, ...changed });
  }
});

test('two deliveries of the same job can claim it only once', async () => {
  const admin = memoryDb(queued);
  const outcomes = await Promise.all([1, 2].map(() => conditionalUpdate(admin, 'asset', 'request', { status: 'generating' }, 'queued')));
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(admin.row.status).toBe('generating');
});

test('dispatch failures cannot clobber an already started or replaced job', async () => {
  for (const changed of [{ status: 'generating' }, { generation_request_id: 'new' }, { status: 'canceled' }]) {
    const admin = memoryDb({ ...queued, ...changed });
    await recordDispatchFailure(admin, queued, new Error('timeout'));
    expect(admin.row).toEqual({ ...queued, ...changed });
  }
});

test('fresh queued jobs and in-flight jobs remain active; abandoned jobs expire after runtime limit', () => {
  expect(stalledJobMessage({ ...queued, updated_at: '2026-10-08T08:04:00Z' }, now)).toBeNull();
  expect(stalledJobMessage({ ...queued, status: 'generating', generation_started_at: '2026-10-08T07:50:00Z' }, now)).toBeNull();
  expect(stalledJobMessage({ ...queued, status: 'generating', generation_started_at: '2026-10-08T07:44:00Z' }, now)).toContain('timed out');
  expect(stalledJobMessage({ ...queued, status: 'review' }, now)).toBeNull();
});

test('only an actual 202 response acknowledges dispatch; redirects and hangs are bounded', async () => {
  const originalFetch = global.fetch; const originalTimeout = AbortSignal.timeout;
  const originalSecret = process.env.INTERNAL_FUNCTION_SECRET;
  try {
    process.env.INTERNAL_FUNCTION_SECRET = 'test-only';
    AbortSignal.timeout = jest.fn(() => new AbortController().signal);
    global.fetch = jest.fn(async () => ({ status: 202 }));
    await dispatchShowcaseJob('https://nsa-portal.netlify.app', queued);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10000);
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', body: JSON.stringify({ asset_id: 'asset', generation_request_id: 'request' }) }));
    for (const status of [200, 301, 401, 500]) {
      global.fetch.mockResolvedValueOnce({ status });
      await expect(dispatchShowcaseJob('https://nsa-portal.netlify.app', queued)).rejects.toThrow(`HTTP ${status}`);
    }
  } finally {
    global.fetch = originalFetch; AbortSignal.timeout = originalTimeout;
    if (originalSecret === undefined) delete process.env.INTERNAL_FUNCTION_SECRET; else process.env.INTERNAL_FUNCTION_SECRET = originalSecret;
  }
});

test('generation receives only the assigned garment-color artwork, never other store designs', () => {
  const decorations = [{ art_url: 'https://cdn/original.png', cw_by_color: { navy: { url: 'https://cdn/white-logo.png' }, white: 'https://cdn/blue-logo.png' }, x: 50, y: 39, w: 30 },
    { art_id: 'linked', baked: true }];
  const art = [{ id: 'linked', url: 'https://cdn/linked.png' }, { id: 'unused', url: 'https://cdn/unrelated.png' }];
  expect(artworkUrls(decorations, art, 'Navy')).toEqual(['https://cdn/white-logo.png', 'https://cdn/linked.png']);
  expect(artworkUrls([], art, 'Navy')).toEqual([]);
  const brief = buildAnalysisBrief({ color: 'Navy' }, decorations, {}, art);
  expect(brief.decorations[0]).toMatchObject({ artwork_url: 'https://cdn/white-logo.png', x_percent: 50, y_percent: 39, width_percent: 30 });
  expect(brief.decorations[1].already_in_source).toBe(true);
  const prompt = buildEditPrompt({ color: 'Navy' }, decorations, {}, {}, art);
  expect(prompt).toContain('even if the FIRST image is a blank supplier photo');
  expect(prompt).toContain('without double-stamping');
  expect(prompt).not.toContain('unrelated.png');
});
