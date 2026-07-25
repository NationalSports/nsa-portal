const {
  PROMPT_VERSION,
  normalizeMode,
  isPublicAddress,
  isAllowedImageHost,
  cleanDecorations,
  inferAthleticFormProfile,
  buildEditPrompt,
  artworkUrls,
  analyzeWithKimi,
  generateWithOpenAI,
  getKimiConfig,
} = require('../../netlify/functions/_showcase');
const {
  summarizeAssets,
  buildShowcaseReviewEmail,
  markShowcaseBatchPending,
  notifyShowcaseReady,
} = require('../../netlify/functions/_showcaseEmail');

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
    expect(prompt).toContain('garment or product alone');
    expect(prompt).toContain('remove it completely');
    expect(prompt).toContain('no people, models, body parts, mannequins');
    expect(prompt).toContain('only the complete hero garment or product');
    expect(prompt).toContain('uniform neutral pure white (#FFFFFF)');
    expect(prompt).toContain('must read as #FFFFFF');
    expect(prompt).toContain('No cream, beige, ivory, tan');
    expect(prompt).toContain('near-front hero view');
    expect(prompt).toContain('approximately 8–15');
    expect(prompt).toContain('front must remain 85–92%');
    expect(prompt).toContain('Never exceed 15 degrees');
    expect(prompt).toContain('angle the waistband and stagger the legs subtly');
    expect(prompt).toContain('polished invisible support');
    expect(prompt).toContain('believable on-body');
    expect(prompt).toContain('no visible or residual wearer');
    expect(prompt).toContain('dramatic appeal must come from product angle');
    expect(prompt).toContain('5–8% breathing room');
    expect(prompt).not.toContain('consistent warm-neutral studio background');
    expect(PROMPT_VERSION).toBe('showcase-v6-athletic-forms');
  });

  test('uses athletic male and female invisible garment forms without visible models', () => {
    expect(inferAthleticFormProfile({ name: "Men's Performance Hoodie" })).toBe('men');
    expect(inferAthleticFormProfile({ name: "Women's Training Quarter-Zip" })).toBe('women');
    expect(inferAthleticFormProfile({ name: 'Youth Team Jersey' })).toBe('youth');
    expect(inferAthleticFormProfile({ name: 'Unisex Fleece Crew' })).toBe('unisex');
    expect(inferAthleticFormProfile({ name: 'Performance Hoodie' })).toBe('men');

    const mensPrompt = buildEditPrompt({ name: "Men's Performance Hoodie" }, [], {});
    expect(mensPrompt).toContain('naturally strong and athletic');
    expect(mensPrompt).toContain('never jacked, bulky, over-muscled');

    const womensPrompt = buildEditPrompt({ name: "Women's Training Quarter-Zip" }, [], {});
    expect(womensPrompt).toContain('clearly female');
    expect(womensPrompt).toContain('fit and strong, never exaggerated');
    expect(womensPrompt).toContain('no visible or residual wearer');
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
    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const instructions = requestBody.messages[1].content[0].text;
    expect(instructions).toContain('garment or product alone');
    expect(instructions).toContain('complete removal');
    expect(instructions).toContain('"people_allowed":false');
    expect(instructions).toContain('"mannequins_allowed":false');
    expect(instructions).toContain('"background_color_hex":"#FFFFFF"');
    expect(instructions).toContain('"composition":"premium near-front hero view with a subtle three-quarter turn"');
    expect(instructions).toContain('"camera_yaw_degrees":"8–15"');
    expect(instructions).toContain('"presentation":"product-only invisible support with natural on-body volume and drape"');
    expect(instructions).toContain('"athletic_form_profile":"men"');
    expect(instructions).toContain('Men’s items should read as naturally strong and athletic');
    expect(instructions).toContain('"straight_on_catalog_view_allowed":false');
    expect(instructions).toContain('pure white background');
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
      getTrustedSiteBaseUrl: jest.requireActual('../../netlify/functions/_shared').getTrustedSiteBaseUrl,
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
      getTrustedSiteBaseUrl: jest.requireActual('../../netlify/functions/_shared').getTrustedSiteBaseUrl,
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
      getTrustedSiteBaseUrl: jest.requireActual('../../netlify/functions/_shared').getTrustedSiteBaseUrl,
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
      getTrustedSiteBaseUrl: jest.requireActual('../../netlify/functions/_shared').getTrustedSiteBaseUrl,
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

  test('Generate All queues missing, failed, rejected, and older-style products without duplicating active jobs', () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}),
      getSiteUrl: () => '',
      getTrustedSiteBaseUrl: jest.requireActual('../../netlify/functions/_shared').getTrustedSiteBaseUrl,
      verifyUser: jest.fn(),
    }));
    const { generateAllProducts } = require('../../netlify/functions/showcase-admin');
    const catalog = [
      { webstore_product_id: 'missing', standard_image_url: 'https://cdn/missing.jpg' },
      { webstore_product_id: 'failed', standard_image_url: 'https://cdn/failed.jpg' },
      { webstore_product_id: 'rejected', standard_image_url: 'https://cdn/rejected.jpg' },
      { webstore_product_id: 'review', standard_image_url: 'https://cdn/review.jpg' },
      { webstore_product_id: 'approved', standard_image_url: 'https://cdn/approved.jpg' },
      { webstore_product_id: 'stale-review', standard_image_url: 'https://cdn/stale-review.jpg' },
      { webstore_product_id: 'stale-approved', standard_image_url: 'https://cdn/stale-approved.jpg' },
      { webstore_product_id: 'canceled', standard_image_url: 'https://cdn/canceled.jpg' },
      { webstore_product_id: 'active', standard_image_url: 'https://cdn/active.jpg' },
      { webstore_product_id: 'bundle', kind: 'bundle', standard_image_url: 'https://cdn/bundle.jpg' },
      { webstore_product_id: 'no-source', standard_image_url: null },
    ];
    const assets = [
      { webstore_product_id: 'failed', status: 'failed', approval_status: 'pending', prompt_version: PROMPT_VERSION },
      { webstore_product_id: 'rejected', status: 'review', approval_status: 'rejected', prompt_version: PROMPT_VERSION },
      { webstore_product_id: 'review', status: 'review', approval_status: 'pending', prompt_version: PROMPT_VERSION },
      { webstore_product_id: 'approved', status: 'approved', approval_status: 'approved', prompt_version: PROMPT_VERSION },
      { webstore_product_id: 'stale-review', status: 'review', approval_status: 'pending', prompt_version: 'showcase-v3-white-background' },
      { webstore_product_id: 'stale-approved', status: 'approved', approval_status: 'approved', prompt_version: 'showcase-v3-white-background' },
      { webstore_product_id: 'canceled', status: 'canceled', approval_status: 'pending', prompt_version: PROMPT_VERSION },
      { webstore_product_id: 'active', status: 'generating', approval_status: 'pending', prompt_version: 'showcase-v3-white-background' },
    ];
    expect(generateAllProducts(catalog, assets).map((product) => product.webstore_product_id))
      .toEqual(['missing', 'failed', 'rejected', 'stale-review', 'stale-approved', 'canceled']);
  });

  test('background cancellation checkpoint requires the same request to remain generating', async () => {
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}),
      getSupabaseAdmin: jest.fn(),
      safeEqualStr: jest.fn(),
      getTrustedSiteBaseUrl: jest.fn(),
    }));
    const { isJobCurrent } = require('../../netlify/functions/showcase-image-background');
    const filters = [];
    const chain = {
      select() { return chain; },
      eq(column, value) { filters.push([column, value]); return chain; },
      maybeSingle: jest.fn(async () => ({ data: { id: 'asset-1' }, error: null })),
    };
    const admin = { from: jest.fn(() => chain) };
    await expect(isJobCurrent(admin, 'asset-1', 'request-1')).resolves.toBe(true);
    expect(filters).toEqual([
      ['id', 'asset-1'],
      ['generation_request_id', 'request-1'],
      ['status', 'generating'],
    ]);
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
      getTrustedSiteBaseUrl: jest.requireActual('../../netlify/functions/_shared').getTrustedSiteBaseUrl,
      verifyUser: jest.fn(async () => ({ ok: false, status: 401, error: 'Missing bearer token' })),
    }));
    const { handler } = require('../../netlify/functions/showcase-admin');
    const result = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    expect(result.statusCode).toBe(401);
  });
});

describe('Showcase completion email', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, BREVO_API_KEY: 'server-brevo-secret' };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  function makeAdmin(route) {
    const calls = [];
    return {
      calls,
      from(table) {
        const op = { table, kind: 'select', patch: null, filters: [] };
        const chain = {
          select() { return chain; },
          update(patch) { op.kind = 'update'; op.patch = patch; return chain; },
          eq(col, value) { op.filters.push(['eq', col, value]); return chain; },
          in(col, value) { op.filters.push(['in', col, value]); return chain; },
          limit(value) { op.filters.push(['limit', value]); calls.push(op); return Promise.resolve(route(op)); },
          maybeSingle() { calls.push(op); return Promise.resolve(route(op)); },
          then(resolve, reject) { calls.push(op); return Promise.resolve(route(op)).then(resolve, reject); },
        };
        return chain;
      },
    };
  }

  test('builds a review summary and escapes store/rep content', () => {
    const summary = summarizeAssets([
      { status: 'review', approval_status: 'pending' },
      { status: 'review', approval_status: 'rejected' },
      { status: 'approved', approval_status: 'approved' },
      { status: 'failed', approval_status: 'pending' },
    ]);
    expect(summary).toEqual({ total: 4, review: 2, approved: 1, failed: 1 });
    const email = buildShowcaseReviewEmail({
      store: { name: '<Mountain House>' },
      rep: { name: 'Steve & Team' },
      summary,
      reviewUrl: 'https://preview.example/?pg=webstores',
    });
    expect(email.subject).toContain('finished with 1 issue');
    expect(email.html).toContain('Hi Steve &amp; Team');
    expect(email.html).toContain('&lt;Mountain House&gt;');
    expect(email.html).toContain('Review Showcase images');
    expect(email.html).not.toContain('server-brevo-secret');
  });

  test('marks each generation request as a pending store-level email batch', async () => {
    const admin = makeAdmin(() => ({ data: null, error: null }));
    await markShowcaseBatchPending(admin, 'store-1', 'batch-1');
    const update = admin.calls.find((call) => call.table === 'webstores' && call.kind === 'update');
    expect(update.patch).toEqual(expect.objectContaining({
      showcase_generation_batch_id: 'batch-1',
      showcase_review_notification_status: 'pending',
      showcase_review_notified_at: null,
      showcase_review_notified_to: null,
    }));
  });

  test('the final worker claims once and emails the assigned rep with a direct review link', async () => {
    let storeRead = 0;
    const admin = makeAdmin((op) => {
      if (op.table === 'webstore_showcase_assets' && op.filters.some((f) => f[0] === 'in')) {
        return { data: [], error: null };
      }
      if (op.table === 'webstores' && op.kind === 'select') {
        storeRead++;
        return storeRead === 1 ? {
          data: {
            id: 'store-1',
            name: 'Mountain House HS Football 2026',
            slug: 'mhfb2026',
            rep_id: 'rep-1',
            showcase_generation_batch_id: 'batch-1',
            showcase_review_notification_status: 'pending',
          },
          error: null,
        } : { data: null, error: null };
      }
      if (op.table === 'webstores' && op.kind === 'update'
        && op.patch.showcase_review_notification_status === 'sending') {
        return { data: { id: 'store-1' }, error: null };
      }
      if (op.table === 'team_members') {
        return { data: { id: 'rep-1', name: 'Steve Peterson', email: 'steve@nationalsportsapparel.com', is_active: true }, error: null };
      }
      if (op.table === 'webstore_showcase_assets') {
        return { data: [{ status: 'review', approval_status: 'pending' }], error: null };
      }
      return { data: null, error: null };
    });
    global.fetch.mockResolvedValue({ ok: true, status: 201, text: async () => '' });

    const result = await notifyShowcaseReady(admin, 'store-1', 'https://deploy-preview-1821--nsa-portal.netlify.app');

    expect(result).toEqual(expect.objectContaining({ sent: true, to: 'steve@nationalsportsapparel.com' }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request.to).toEqual([{ email: 'steve@nationalsportsapparel.com', name: 'Steve Peterson' }]);
    expect(request.subject).toContain('Showcase images ready for review');
    expect(request.htmlContent).toContain('store=store-1&amp;tab=appearance');
    expect(global.fetch.mock.calls[0][1].body).not.toContain('server-brevo-secret');
    expect(admin.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'webstores',
        kind: 'update',
        patch: expect.objectContaining({ showcase_review_notification_status: 'sent' }),
      }),
    ]));
  });

  test('does not claim or email while another product is still generating', async () => {
    const admin = makeAdmin((op) => (
      op.table === 'webstore_showcase_assets'
        ? { data: [{ id: 'active-asset' }], error: null }
        : { data: null, error: null }
    ));
    const result = await notifyShowcaseReady(admin, 'store-1', 'https://preview.example');
    expect(result).toEqual({ sent: false, reason: 'active-jobs' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(admin.calls.filter((call) => call.table === 'webstores')).toHaveLength(0);
  });
});
