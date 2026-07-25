const {
  normalizeMode,
  isPublicAddress,
  isAllowedImageHost,
  cleanDecorations,
  buildEditPrompt,
  artworkUrls,
  analyzeWithKimi,
  generateWithOpenAI,
  getKimiConfig,
} = require('../../netlify/functions/_showcase');

describe('Showcase provider boundary', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  test('defaults invalid presentation values to Standard', () => {
    expect(normalizeMode('showcase')).toBe('showcase');
    expect(normalizeMode('standard')).toBe('standard');
    expect(normalizeMode('anything-else')).toBe('standard');
  });

  test('blocks loopback and private source-image addresses', () => {
    ['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.8', '169.254.1.1', '::1', 'fd00::1']
      .forEach((address) => expect(isPublicAddress(address)).toBe(false));
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  test('allows only known supplier/storage hosts unless an extra host is configured', () => {
    expect(isAllowedImageHost('cdnm.sanmar.com')).toBe(true);
    expect(isAllowedImageHost('hpslkvngulqirmbstlfx.supabase.co')).toBe(true);
    expect(isAllowedImageHost('attacker.example')).toBe(false);
    process.env.SHOWCASE_ALLOWED_IMAGE_HOSTS = 'approved.example';
    expect(isAllowedImageHost('images.approved.example')).toBe(true);
  });

  test('keeps artwork and placement fields locked in the structured brief', () => {
    const decorations = cleanDecorations([{
      art_url: 'https://cdn.example/team.png',
      placement: 'left_chest',
      x: 48,
      y: 34,
      w: 22,
    }]);
    expect(decorations[0]).toEqual(expect.objectContaining({
      artwork_url: 'https://cdn.example/team.png',
      placement: 'left_chest',
      x_percent: 48,
      y_percent: 34,
      width_percent: 22,
      locked: true,
    }));
    const prompt = buildEditPrompt(
      { sku: 'A123', name: 'Performance Polo', brand: 'Adidas', color: 'Navy' },
      decorations,
      { garment_invariants: ['three-stripe sleeve mark'], protected_elements: ['Adidas mark'], decoration_bounds: ['left chest'] },
    );
    expect(prompt).toContain('never redraw, restyle');
    expect(prompt).toContain('Adidas mark');
    expect(prompt).toContain('three-stripe sleeve mark');
    expect(prompt).toContain('left chest');
  });

  test('collects the existing decoration URL shapes without duplicates', () => {
    const urls = artworkUrls([{
      art_url: 'https://cdn.example/team.png',
      source_url: 'https://cdn.example/team.png',
      cw_by_color: { navy: 'https://cdn.example/team-navy.png' },
    }], []);
    expect(urls).toEqual([
      'https://cdn.example/team.png',
      'https://cdn.example/team-navy.png',
    ]);
  });

  test('Kimi is analysis-only and its credential remains a request header', async () => {
    process.env.MOONSHOT_API_KEY = 'server-kimi-secret';
    process.env.SHOWCASE_KIMI_MODEL = 'kimi-k2.6';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'kimi-job',
        choices: [{ message: { content: JSON.stringify({
          garment_invariants: ['navy polo'],
          protected_elements: ['team crest'],
          decoration_bounds: ['left chest'],
          edit_prompt: 'studio light only',
          qa_checklist: ['crest exact'],
        }) } }],
      }),
    });
    const image = { contentType: 'image/png', bytes: Buffer.from('image') };
    const result = await analyzeWithKimi({ product: { sku: 'A1' }, decorations: [], images: [image] });
    expect(result.model).toBe('kimi-k2.6');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer server-kimi-secret');
    expect(global.fetch.mock.calls[0][1].body).not.toContain('server-kimi-secret');
  });

  test('reuses the deployed AIUniBuilder secret as the Kimi credential', () => {
    delete process.env.MOONSHOT_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.AIUNIBUILDER_KIMI_API_KEY;
    process.env.AIUniBuilder = 'existing-kimi-secret';
    expect(getKimiConfig()).toEqual(expect.objectContaining({ key: 'existing-kimi-secret' }));
  });

  test('OpenAI image edit returns bytes and keeps its credential server-side', async () => {
    process.env.OPENAI_API_KEY = 'server-openai-secret';
    process.env.SHOWCASE_IMAGE_MODEL = 'gpt-image-2';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'openai-job', data: [{ b64_json: Buffer.from('generated').toString('base64') }] }),
    });
    const image = { contentType: 'image/png', bytes: Buffer.from('source') };
    const result = await generateWithOpenAI({
      product: { sku: 'A1', name: 'Polo', color: 'Navy' },
      decorations: [],
      images: [image],
      analysis: {},
    });
    expect(result.bytes.toString()).toBe('generated');
    expect(result.model).toBe('gpt-image-2');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer server-openai-secret');
    expect(global.fetch.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });
});

describe('Showcase public/staff response boundaries', () => {
  afterEach(() => jest.resetModules());

  test('staff asset response does not expose prompts, analysis, or generation request ids', () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}),
      getSiteUrl: () => '',
      verifyUser: jest.fn(),
    }));
    const { publicAsset } = require('../../netlify/functions/showcase-admin');
    const safe = publicAsset({
      id: 'asset-1',
      status: 'review',
      prompt: 'internal prompt',
      analysis: { internal: true },
      generation_request_id: 'private-job-token',
    });
    expect(safe.status).toBe('review');
    expect(safe).not.toHaveProperty('prompt');
    expect(safe).not.toHaveProperty('analysis');
    expect(safe).not.toHaveProperty('generation_request_id');
  });

  test('background worker uses the current validated deploy instead of the production URL', () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}),
      verifyUser: jest.fn(),
    }));
    const { getWorkerBaseUrl } = require('../../netlify/functions/showcase-admin');
    const env = {
      URL: 'https://connect.nationalsportsapparel.com',
      SITE_NAME: 'nsa-portal',
    };
    expect(getWorkerBaseUrl({
      headers: { host: 'deploy-preview-1821--nsa-portal.netlify.app' },
    }, env)).toBe('https://deploy-preview-1821--nsa-portal.netlify.app');
    expect(getWorkerBaseUrl({
      headers: { host: 'connect.nationalsportsapparel.com' },
    }, env)).toBe('https://connect.nationalsportsapparel.com');
  });

  test('background worker rejects untrusted request hosts', () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}),
      verifyUser: jest.fn(),
    }));
    const { getWorkerBaseUrl } = require('../../netlify/functions/showcase-admin');
    const env = {
      URL: 'https://connect.nationalsportsapparel.com',
      SITE_NAME: 'nsa-portal',
    };
    expect(getWorkerBaseUrl({ headers: { host: 'attacker.example' } }, env)).toBe('');
    expect(getWorkerBaseUrl({ headers: { host: 'nsa-portal.netlify.app.attacker.example' } }, env)).toBe('');
  });

  test('readiness synthesizes Missing rows and keeps unapproved products on Standard fallback', () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}),
      getSiteUrl: () => '',
      verifyUser: jest.fn(),
    }));
    const { buildStateSnapshot } = require('../../netlify/functions/showcase-admin');
    const snapshot = buildStateSnapshot(
      { id: 'store-1', presentation_mode: 'showcase', published_presentation_mode: 'standard' },
      [
        { webstore_product_id: 'wp-1', product_id: 'p-1', standard_image_url: 'https://cdnm.sanmar.com/one.jpg' },
        { webstore_product_id: 'wp-2', product_id: 'p-2', standard_image_url: 'https://cdnm.sanmar.com/two.jpg' },
      ],
      [{
        id: 'asset-1',
        store_id: 'store-1',
        webstore_product_id: 'wp-1',
        product_id: 'p-1',
        standard_image_url: 'https://cdnm.sanmar.com/one.jpg',
        showcase_image_url: 'https://project.supabase.co/storage/v1/object/public/showcase-images/one.png',
        approved_showcase_image_url: 'https://project.supabase.co/storage/v1/object/public/showcase-images/one.png',
        status: 'approved',
        approval_status: 'approved',
      }],
    );
    expect(snapshot.counts).toEqual(expect.objectContaining({ approved: 1, missing: 1 }));
    expect(snapshot.items[1].asset).toEqual(expect.objectContaining({
      status: 'missing',
      showcase_image_url: null,
      fallback_to_standard: true,
    }));
    expect(snapshot.store.presentation_mode).toBe('showcase');
    expect(snapshot.store.published_presentation_mode).toBe('standard');
  });

  test('the shopper asset map includes only explicitly approved images', () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}),
      getSupabaseAdmin: jest.fn(),
    }));
    const { approvedAssetMap } = require('../../netlify/functions/showcase-public');
    expect(approvedAssetMap([
      { webstore_product_id: 'approved', approved_showcase_image_url: 'https://cdn/approved.png', status: 'approved', approval_status: 'approved' },
      { webstore_product_id: 'regenerating', approved_showcase_image_url: 'https://cdn/live-old.png', status: 'generating', approval_status: 'pending' },
      { webstore_product_id: 'review', showcase_image_url: 'https://cdn/review.png', status: 'review', approval_status: 'pending' },
      { webstore_product_id: 'rejected', showcase_image_url: 'https://cdn/rejected.png', status: 'review', approval_status: 'rejected' },
      { webstore_product_id: 'failed', showcase_image_url: null, status: 'failed', approval_status: 'pending' },
    ])).toEqual({ approved: 'https://cdn/approved.png', regenerating: 'https://cdn/live-old.png' });
  });

  test('anonymous callers cannot use staff Showcase actions', async () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({ 'Content-Type': 'application/json' }),
      getSiteUrl: () => '',
      verifyUser: jest.fn(async () => ({ ok: false, status: 401, error: 'Missing bearer token' })),
    }));
    const { handler } = require('../../netlify/functions/showcase-admin');
    const result = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    expect(result.statusCode).toBe(401);
  });
});
