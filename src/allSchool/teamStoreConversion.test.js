import { buildTeamStoreConversionPlan, classifyTeamStoreProduct, conversionRpcActions } from './teamStoreConversion';

const sha = 'a'.repeat(64);
const file = { bucket: 'all-school-art', path: 'art/blue.ai', name: 'blue.ai', sha256: sha };
const art = {
  id: 'logo', name: 'Team logo', deco_type: 'screen_print',
  web_logos: [{ url: 'logo-blue.png' }],
  dtf_variants: [{ id: 'blue', garment_color: 'Royal', reviewed: true, knockout_color: 'white', production_file: file, width_in: 10, height_in: 5, web_logo_url: 'logo-blue.png' }],
};
const transfer = { kind: 'design', code: 'dtf-logo-blue', label: 'Team logo — Royal', decoration_type: 'dtf', application_method: 'heat_press', production_file: file, width_in: 10, height_in: 5 };
const product = {
  id: 'item', kind: 'single', active: true, product_id: 'blank', sku: 'TEE-ROYAL', image_url: 'mock.png',
  school_style_group_id: 'style', variant_group_id: 'design', school_design_label: 'Primary',
  decorations: [{ kind: 'art', art_id: 'logo', art_url: 'logo.png', type: 'screen_print' }],
};

test('maps a screen-print decoration to its exact reviewed DTF color variant', () => {
  const action = classifyTeamStoreProduct(product, { transfers: [transfer], art: [art], stock: { color: 'Royal' }, inventorySource: 'sanmar' });
  expect(action).toMatchObject({ action: 'map_dtf', transfer_codes: ['dtf-logo-blue'] });
  expect(action.decorations[0]).toMatchObject({ type: 'dtf', transfer_code: 'dtf-logo-blue', dtf_variant_id: 'blue', art_url: 'logo-blue.png' });
});

test('hides incompatible offerings without discarding their logo grouping', () => {
  const action = classifyTeamStoreProduct(product, { transfers: [], art: [{ ...art, dtf_variants: [] }], stock: { color: 'Royal' }, inventorySource: 'sanmar' });
  expect(action.action).toBe('deactivate');
  expect(action.reason).toMatch(/DTF production variant/i);
  expect(product.school_style_group_id).toBe('style');
  expect(product.school_design_label).toBe('Primary');
});

test('flags manual or missing blank stock sources for hiding', () => {
  expect(classifyTeamStoreProduct(product, { art: [art], stock: { color: 'Royal' }, inventorySource: 'manual' })).toMatchObject({
    action: 'deactivate', reason: expect.stringMatching(/stock source/i),
  });
});

test('conversion plan preserves logo defaults and sends a complete stale-safe review', () => {
  const hidden = { ...product, id: 'hidden', active: false, variant_group_id: 'alternate', school_design_label: 'Alternate' };
  const plan = buildTeamStoreConversionPlan({
    store: { org_type: 'team', status: 'open', all_school_settings: { first_logo_by_style: { style: 'design' } } },
    catalog: [product, hidden], transfers: [transfer], art: [art],
    stockByWp: { item: { color: 'Royal' } }, inventorySourceByProductId: { blank: 'sanmar' },
    orders: [{ id: 'order', status: 'paid', so_id: null }],
  });
  expect(plan.storePatch.all_school_settings.first_logo_by_style).toEqual({ style: 'design' });
  expect(plan.warnings.join(' ')).toMatch(/currently open/i);
  expect(plan.blockers.join(' ')).toMatch(/existing team order/i);
  expect(conversionRpcActions(plan)).toHaveLength(2);
  expect(conversionRpcActions(plan).map((row) => row.action)).toEqual(['map_dtf', 'keep_hidden']);
});

test('an in-flight card order blocks conversion while resolved orders do not', () => {
  const common = { store: { org_type: 'team' }, catalog: [], transfers: [], art: [] };
  expect(buildTeamStoreConversionPlan({ ...common, orders: [{ status: 'pending_payment', so_id: null }] }).blockers).toHaveLength(1);
  expect(buildTeamStoreConversionPlan({ ...common, orders: [{ status: 'refunded', so_id: null }] }).blockers).toHaveLength(0);
});
