const { inferAthleticFormProfile, buildAnalysisBrief, buildEditPrompt, analyzeWithKimi } = require('../../netlify/functions/_showcase');
const { loadJob } = require('../../netlify/functions/_background-workers/showcase-image-background');

test.each([
  [{ name: 'Womens Hoodie' }, 'women'],
  [{ name: 'Women’s Hoodie' }, 'women'],
  [{ name: 'Youth Girls Hoodie' }, 'youth'],
  [{ name: 'Youth Unisex Hoodie' }, 'youth'],
  [{ name: 'Youth Womens Hoodie' }, 'youth'],
  [{ name: 'Unisex Hoodie', description: 'Also offered in ladies sizes' }, 'unisex'],
  [{ name: 'Mens Hoodie', category: 'Women' }, 'men'],
  [{ display_name: 'Women’s Team Hoodie', name: 'Mens Hoodie' }, 'women'],
  [{ name: 'Serra Hoodie', catalog_name: 'Youth Fleece Hoodie' }, 'youth'],
  [{ name: 'Team Hoodie', category: 'Ladies' }, 'women'],
  [{ name: 'Team Hoodie' }, 'men'],
])('uses item fit metadata in priority order: %j', (product, profile) => {
  expect(inferAthleticFormProfile(product)).toBe(profile);
});

test('adult unisex and mens forms share proportions; tops retain dimensional support', () => {
  const mens = buildAnalysisBrief({ name: 'Mens Hoodie' }, []);
  const unisex = buildAnalysisBrief({ name: 'Unisex Hoodie' }, []);
  expect(unisex.output.athletic_form_guidance).toBe(mens.output.athletic_form_guidance);
  expect(unisex.output.item_hero_direction).toContain('dimensional shoulders, chest');
});

test('jogger hero retains the right-hip logo separately from opposite-leg branding', () => {
  const product = { name: 'Nike Club Fleece Jogger NKHM8045' };
  const decorations = [{ placement: 'right_hip', x: 34, y: 28, w: 17, baked: true }];
  const brief = buildAnalysisBrief(product, decorations);
  expect(brief.output.item_hero_direction).toContain('balanced planted athletic stance');
  expect(brief.output.item_hero_direction).toContain('never turn them into leggings');
  expect(brief.output.logo_laterality_locked).toBe(true);
  expect(brief.decorations[0]).toMatchObject({ placement: 'right_hip', x_percent: 34, y_percent: 28, width_percent: 17, already_in_source: true });
  const prompt = buildEditPrompt(product, decorations, { protected_elements: ['Nike mark on wearer left leg'] });
  expect(prompt).toContain('wearer’s right hip is on the viewer’s left');
  expect(prompt).toContain('never mirror the garment or swap artwork');
  expect(prompt).toContain('for baked artwork, preserve its actual source position');
  expect(prompt).toContain('never move it to the opposite leg or stack it above a brand');
  expect(prompt).toContain('Nike mark on wearer left leg');
  expect(prompt).not.toContain('angle the waistband and stagger');
});

test('worker retains supplier fit when staff renames the item', async () => {
  const rows = {
    webstore_showcase_assets: { store_id: 'store', webstore_product_id: 'wp' },
    webstores: { id: 'store' },
    webstore_products: { id: 'wp', product_id: 'product', display_name: 'Serra Hoodie' },
    products: { name: 'Youth Fleece Hoodie', description: 'Cotton blend', color: 'Navy' },
  };
  const admin = { from(table) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: rows[table], error: null }) };
    return chain;
  } };
  const job = await loadJob(admin, 'asset', 'request');
  const brief = buildAnalysisBrief(job.product, []);
  expect(brief.name).toBe('Serra Hoodie');
  expect(brief.catalog_name).toBe('Youth Fleece Hoodie');
  expect(brief.description).toBe('Cotton blend');
  expect(brief.output.athletic_form_profile).toBe('youth');
});

test('analysis provider receives stance, source coordinates and logo-laterality rules', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.MOONSHOT_API_KEY;
  try {
    process.env.MOONSHOT_API_KEY = 'test-only';
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }));
    await analyzeWithKimi({ product: { name: 'Unisex Joggers' }, decorations: [{ x: 32, y: 25, w: 16 }], images: [] });
    const input = JSON.parse(global.fetch.mock.calls[0][1].body).messages[1].content[0].text;
    expect(input).toContain('balanced planted athletic stance');
    expect(input).toContain('wearer’s right hip is on the viewer’s left');
    expect(input).toContain('same adult male athletic sizing proportions');
    expect(input).toContain('"x_percent":32');
    expect(input).toContain('qa_checklist must verify original logo leg/hip');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = originalKey;
  }
});
