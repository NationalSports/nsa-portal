const { cleanDecorations, buildAnalysisBrief, buildEditPrompt, heroDirection } = require('../../netlify/functions/_showcase');
const { normalizeDecorationType, showcaseSettingsChanged } = require('../lib/showcaseSettings');

describe('Showcase decoration finish and hero direction', () => {
  test.each([
    ['twill', 'tackle_twill', 'Light 3D tackle twill'],
    ['embroidery', 'embroidery', 'fine directional thread'],
    ['chenile', 'chenille', 'soft plush looped yarn'],
    ['screen print', 'screen_print', 'Keep the print flat'],
  ])('resolves %s and protects artwork placement', (input, type, guidance) => {
    const source = { art_id: 'crest', art_url: 'https://example.com/crest.png', deco_type: input, x: 50, y: 40, w: 24 };
    const result = cleanDecorations([source])[0];
    expect(normalizeDecorationType(input)).toBe(type);
    expect(result).toMatchObject({ decoration_type: type, x_percent: 50, y_percent: 40, width_percent: 24, locked: true });
    expect(result.finish_guidance).toContain(guidance);
    expect(source).not.toHaveProperty('finish_guidance');
  });

  test('auto preserves mixed finishes and resolves linked art metadata', () => {
    const result = cleanDecorations([{ deco_type: 'embroidery' }, { art_id: 'a', type: 'art' }], { decoration_type: 'auto' }, [{ id: 'a', deco_type: 'chenille' }]);
    expect(result.map((deco) => deco.decoration_type)).toEqual(['embroidery', 'chenille']);
    expect(cleanDecorations([{ type: 'unknown' }])[0].finish_guidance).toContain('Preserve the existing');
  });

  test('explicit finish overrides customer rendering without changing production records', () => {
    const decorations = [{ deco_type: 'screen_print', x: 48, y: 30, w: 20 }];
    const settings = { decoration_type: 'tackle_twill', revision_notes: 'Lighter depth please' };
    const brief = buildAnalysisBrief({ name: 'Serra Hoodie' }, decorations, settings);
    expect(brief.decorations[0].decoration_type).toBe('tackle_twill');
    const prompt = buildEditPrompt({ name: 'Serra Hoodie' }, decorations, {}, settings);
    expect(prompt).toContain('Lighter depth please');
    expect(prompt).toContain('never manufacturer marks or undecorated fabric');
    expect(prompt).toContain('An undecorated source must remain undecorated');
    expect(prompt).toContain('SELECTED CUSTOMER DECORATION FINISH: Light 3D');
    expect(decorations[0].deco_type).toBe('screen_print');
  });

  test.each([
    ['Serra Snapback Cap', 'Headwear:'], ['Team Duffel Bag', 'Bags:'],
    ['Soccer Cleats', 'Footwear:'], ['Training Shorts', 'Bottoms:'], ['Hoodie', 'dimensional shoulders'],
  ])('gives %s an appropriate dimensional hero direction', (name, direction) => {
    expect(heroDirection({ name })).toContain(direction);
    expect(buildEditPrompt({ name }, [], {})).toContain(direction);
  });

  test('settings changes require regeneration, including review feedback', () => {
    expect(showcaseSettingsChanged({})).toBe(false);
    const settings = { decoration_type: 'embroidery', revision_notes: '' };
    expect(showcaseSettingsChanged({ showcase_settings: settings, generated_showcase_settings: settings })).toBe(false);
    expect(showcaseSettingsChanged({ showcase_settings: settings })).toBe(true);
    expect(showcaseSettingsChanged({ showcase_settings: { ...settings, revision_notes: 'Sharper stitches' }, generated_showcase_settings: settings })).toBe(true);
  });
});

describe('Showcase settings storage', () => {
  const storeId = '11111111-1111-4111-8111-111111111111';
  const wpId = '22222222-2222-4222-8222-222222222222';
  const settings = { decoration_type: 'tackle_twill', revision_notes: '' };
  let operations;
  let existing;
  let handler;
  let failLease;

  beforeEach(() => {
    jest.resetModules();
    operations = [];
    existing = { id: 'asset', status: 'review', showcase_image_url: 'new.png', approved_showcase_image_url: 'approved.png', updated_at: '2026-10-07T07:00:00Z', analysis: { garment_invariants: ['navy'] } };
    failLease = false;
    const admin = { from(table) {
      const op = { table, patch: null, filters: [] };
      operations.push(op);
      const result = () => {
        if (op.patch) return { data: failLease ? null : { ...existing, ...op.patch }, error: null };
        if (table === 'webstores') return { data: { id: storeId }, error: null };
        if (table === 'webstore_products') return { data: [{ id: wpId, kind: 'single', image_url: 'source.png' }], error: null };
        return { data: existing, error: null };
      };
      const chain = {
        select() { return chain; }, eq(key, value) { op.filters.push([key, value]); return chain; },
        order() { return chain; }, update(patch) { op.patch = patch; return chain; },
        insert(patch) { op.patch = patch; return chain; }, upsert(patch) { op.patch = patch; return chain; },
        maybeSingle: async () => result(), single: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return chain;
    } };
    jest.doMock('../../netlify/functions/_shared', () => ({
      corsHeaders: () => ({}), verifyUser: async () => ({ ok: true, admin }), getTrustedSiteBaseUrl: () => '',
    }));
    handler = require('../../netlify/functions/showcase-admin').handler;
  });

  const request = (action, extra = {}) => ({ httpMethod: 'POST', body: JSON.stringify({ action, store_id: storeId, webstore_product_id: wpId, ...extra }) });

  test('saves finish without clearing approved imagery, analysis or production decorations', async () => {
    const result = await handler(request('save_settings', { showcase_settings: settings }));
    expect(result.statusCode).toBe(200);
    const writes = operations.filter((op) => op.patch);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('webstore_showcase_assets');
    expect(writes[0].patch.analysis).toEqual({ garment_invariants: ['navy'], showcase_settings: settings });
    expect(writes[0].patch).not.toHaveProperty('approved_showcase_image_url');
    expect(writes[0].filters).toContainEqual(['updated_at', existing.updated_at]);
    expect(JSON.parse(result.body).asset.needs_regeneration).toBe(true);
  });

  test('rejects settings edits during generation and rejects invalid finishes', async () => {
    existing.status = 'generating';
    expect((await handler(request('save_settings', { showcase_settings: settings }))).statusCode).toBe(409);
    expect((await handler(request('save_settings', { showcase_settings: { decoration_type: 'anything' } }))).statusCode).toBe(400);
    expect(operations.filter((op) => op.patch)).toHaveLength(0);
  });

  test('approves hero and detail set atomically; fallback clears both and rejection preserves both', async () => {
    const details = [{id:'logo-1',url:'new-detail.png',label:'Decoration detail'}];
    existing.qa_result = {detail_images:details};
    existing.approved_detail_images = [{url:'old-detail.png'}];
    expect((await handler(request('approve'))).statusCode).toBe(200);
    expect(operations.filter(o=>o.patch).pop().patch).toEqual(expect.objectContaining({approved_showcase_image_url:'new.png',approved_detail_images:details}));
    operations=[];
    expect((await handler(request('reject'))).statusCode).toBe(200);
    expect(operations.filter(o=>o.patch).pop().patch).not.toHaveProperty('approved_detail_images');
    operations=[];
    expect((await handler(request('fallback'))).statusCode).toBe(200);
    expect(operations.filter(o=>o.patch).pop().patch).toEqual(expect.objectContaining({approved_showcase_image_url:null,approved_detail_images:[]}));
  });

  test('refuses to approve an image made with different finish settings', async () => {
    existing.analysis.showcase_settings = settings;
    const result = await handler(request('approve'));
    expect(result.statusCode).toBe(409);
    expect(operations.filter((op) => op.patch)).toHaveLength(0);
  });

  test('reports a concurrent edit instead of overwriting it', async () => {
    failLease = true;
    expect((await handler(request('save_settings', { showcase_settings: settings }))).statusCode).toBe(409);
  });

  test('queues saved finish and retains the previous approved image', async () => {
    const { queueProduct } = require('../../netlify/functions/showcase-admin');
    let patch;
    const chain = { upsert(value) { patch = value; return chain; }, select() { return chain; }, single: async () => ({ data: patch, error: null }) };
    await queueProduct({ from: () => chain }, storeId, { webstore_product_id: wpId }, 'request', 'now', settings);
    expect(patch.analysis.showcase_settings).toEqual(settings);
    expect(patch).not.toHaveProperty('approved_showcase_image_url');
  });
});
