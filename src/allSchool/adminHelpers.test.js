import { productionSetupError } from './ProductionSetupReview';
import { allSchoolDefaults, normalizeAllSchoolSettings, validateAllSchoolSettings, coreOfferingCopies, logoDesignCopies, logoOptionsForItem, applySportDesign, stockLinkedArtError, changesProductionSetup } from './adminHelpers';
import { buildTransferMaps, transferUsage, unresolvedTransferLines } from './transferDemand';
it('uses $200 per vendor defaults with safe automation off and independent config values', () => {
  const a = allSchoolDefaults(); const b = allSchoolDefaults(); a.purchasing.enabled = true;
  expect(b.purchasing.enabled).toBe(false); expect(b.purchasing.minimum_cents).toBe(20000); expect(b.target_ship_days).toBe(14);
  expect(normalizeAllSchoolSettings({ dtf: { supplier_id: 'Astra' } }).dtf).toEqual({ supplier_id: 'Astra', auto_send: false });
  expect(validateAllSchoolSettings(b)).toBe('');
  expect(validateAllSchoolSettings({ purchasing: { max_wait_days: 20 } })).toMatch(/shipment target/);
});
it('copies core blanks with isolated art and group IDs and skips existing overrides', () => {
  const core = [{ id: 'a', kind: 'single', product_id: 'blank', variant_group_id: 'original', decorations: [{ art_id: 'spirit' }], retail_price: 20, weight_oz: 6 }, { id: 'b', kind: 'single', product_id: 'blue', variant_group_id: 'original', decorations: [], retail_price: 21 }];
  const copies = coreOfferingCopies(core, 'football', 'store', [], () => 'sport-group');
  expect(copies[0].weight_oz).toBe(6); expect(copies[0].product_id).toBe('blank'); expect(copies[0].school_template_id).toBe('a'); expect(copies[0].variant_group_id).toBe('sport-group'); expect(copies[1].variant_group_id).toBe('sport-group');
  copies[0].decorations[0].art_id = 'football'; expect(core[0].decorations[0].art_id).toBe('spirit');
  expect(coreOfferingCopies(core, 'football', 'store', copies)).toEqual([]);
  expect(coreOfferingCopies([{ ...core[0], school_program_ids: ['soccer'] }], 'football', 'store')).toEqual([]);
});
it('makes an inactive logo group with every source color and its own exact artwork', () => {
  const source = [{ id: 'blue', kind: 'single', product_id: 'blue-blank', variant_group_id: 'colors', school_program_ids: ['football'], retail_price: 42, decorations: [{ art_id: 'script' }] }, { id: 'black', kind: 'single', product_id: 'black-blank', variant_group_id: 'colors', school_program_ids: ['football'], retail_price: 44 }];
  const copies = logoDesignCopies(source, 'store', 'listing', 'arched-colors', 'Arched Serra', { code: 'ARCH' }, { id: 'arch-web', url: 'arch.png' });
  expect(copies.map((row) => row.product_id)).toEqual(['blue-blank', 'black-blank']);
  expect(copies.every((row) => row.school_style_group_id === 'listing' && row.variant_group_id === 'arched-colors' && row.school_design_label === 'Arched Serra' && row.active === false && row.school_template_id === null)).toBe(true);
  expect(copies.every((row) => row.transfer_codes[0] === 'ARCH' && row.decorations[0].art_id === 'arch-web')).toBe(true);
  copies[0].decorations[0].art_id = 'changed'; expect(source[0].decorations[0].art_id).toBe('script');
});
it('shows each logo choice once with its own colors and keeps unrelated items separate', () => {
  const rows = [{ id: 'a', kind: 'single', variant_group_id: 'script', school_style_group_id: 'hoodie' }, { id: 'b', kind: 'single', variant_group_id: 'script', school_style_group_id: 'hoodie' }, { id: 'c', kind: 'single', variant_group_id: 'arched', school_style_group_id: 'hoodie' }, { id: 'd', kind: 'single', variant_group_id: 'other', school_style_group_id: 'other' }];
  expect(logoOptionsForItem(rows, rows[0]).map((group) => group.colors.length)).toEqual([2, 1]);
  expect(logoOptionsForItem(rows, rows[3]).map((group) => group.key)).toEqual(['other']);
});
it('links a screen-print choice to its approved art folder instead of DTF stock', () => {
  const source = [{ id: 'blue', kind: 'single', product_id: 'blank', sku: 'HOODIE', image_url: 'old.png', transfer_codes: ['OLD'] }];
  const art = { id: 'serra-arch', url: 'arch.png', deco_type: 'screen_print', status: 'approved', prod_files: [{ name: 'arch.ai' }] };
  const [copy] = logoDesignCopies(source, 'store', 'listing', 'design', 'Serra arch', null, art);
  expect(copy.active).toBe(false);
  expect(copy.image_url).toBeNull();
  expect(copy.transfer_codes).toEqual([]);
  expect(copy.decorations).toEqual([{ kind: 'art', art_id: 'serra-arch', art_url: 'arch.png', placement: 'full_front', side: 'front', type: 'screen_print', baked: false }]);
  expect(productionSetupError({ ...copy, image_url: 'new-mock.png' }, [], [art])).toBe('');
});
it('counts exact sport offering transfer needs without product ID overwrite', () => {
  const maps = buildTransferMaps([{ id: 'football', product_id: 'blank', transfer_codes: ['football-logo'] }, { id: 'soccer', product_id: 'blank', transfer_codes: ['soccer-logo'] }], []);
  expect(transferUsage([{ webstore_product_id: 'football', product_id: 'blank', qty: 3, refunded_qty: 1 }, { webstore_product_id: 'soccer', product_id: 'blank', qty: 4 }], maps)).toEqual({ 'football-logo': 2, 'soccer-logo': 4 });
  expect(transferUsage([{ product_id: 'blank', qty: 7 }], maps)).toEqual({});
  expect(unresolvedTransferLines([{ product_id: 'blank', qty: 7 }], maps)).toHaveLength(1);
});
it('supports safe legacy product fallback and number zero, not cancelled quantities', () => {
  const maps = buildTransferMaps([{ id: 'a', product_id: 'blank', transfer_codes: ['logo'], takes_number: true, num_transfer_sets: ['8in|White'] }, { id: 'b', product_id: 'blank', transfer_codes: ['logo'], takes_number: true, num_transfer_sets: ['8in|White'] }], []);
  expect(transferUsage([{ product_id: 'blank', qty: 2, player_number: 0 }, { product_id: 'blank', qty: 10, line_status: 'cancelled' }], maps)).toEqual({ logo: 2, '0|8in|White': 2 });
});

it('paid recipe demand stays frozen after sport catalog art changes', () => {
  const maps = buildTransferMaps([{ id: 'sport', product_id: 'blank', transfer_codes: ['new-logo'] }], []);
  const line = { product_id: 'blank', qty: 3, production_recipe: { version: 1, webstore_product_id: 'sport', transfer_codes: ['paid-logo'], takes_number: false } };
  expect(transferUsage([line], maps)).toEqual({ 'paid-logo': 3 });
  expect(unresolvedTransferLines([line], maps)).toEqual([]);
});

it('sport design replacement affects only the copies and references exact stock once', () => {
  const source = [{ sku: 'TEE', product_id: 'blank', decorations: [{ art_id: 'school' }], transfer_codes: ['OLD'], image_url: 'baked-old-art.png' }];
  const replaced = applySportDesign(source, { code: 'FOOTBALL' }, { id: 'football-logo', url: 'football.png' });
  expect(replaced[0].decorations).toEqual([{ kind: 'art', art_id: 'football-logo', art_url: 'football.png', placement: 'full_front', side: 'front', type: 'dtf', transfer_code: 'FOOTBALL', baked: false }]);
  expect(replaced[0].transfer_codes).toEqual(['FOOTBALL']); expect(replaced[0].image_url).toBeNull();
  expect(source[0].transfer_codes).toEqual(['OLD']); expect(source[0].image_url).toBe('baked-old-art.png');
});

it('refuses generic art replacement of stock-linked offerings but allows explicit matching design', () => {
  const item = { transfer_codes: ['FOOTBALL'], decorations: [{ kind: 'art', art_id: 'old', transfer_code: 'FOOTBALL' }] };
  expect(stockLinkedArtError(item, [{ kind: 'art', art_id: 'new' }])).toMatch(/exact new production design/);
  expect(stockLinkedArtError(item, [{ kind: 'art', art_id: 'new', transfer_code: 'FOOTBALL' }])).toBe('');
  expect(stockLinkedArtError({ transfer_codes: [] }, [{ kind: 'art', art_id: 'new' }])).toBe('');
});

it('requires exact production files for approval and identifies setup invalidation fields', () => {
  const item = { product_id: 'blank', sku: 'TEE', image_url: 'exact-mock.png', transfer_codes: ['DTF'] };
  expect(productionSetupError(item, [])).toMatch(/exact production/);
  expect(productionSetupError({ ...item, image_url: null }, [])).toMatch(/mockup/);
  const stock = { code: 'DTF', width_in: 8, height_in: 10, production_file: { bucket: 'all-school-art', path: 'private/print.ai', name: 'print.ai' } };
  expect(productionSetupError(item, [stock])).toBe('');
  expect(productionSetupError({ ...item, takes_name: true }, [stock])).toMatch(/personalization/);
  expect(changesProductionSetup({ decorations: [] })).toBe(true);
  expect(changesProductionSetup({ personalization_template: {} })).toBe(true);
  expect(changesProductionSetup({ retail_price: 30 })).toBe(false);
  expect(changesProductionSetup({ production_approved_at: '2026-10-02' })).toBe(false);
});

it('number approval needs every exact configured digit and DTF production source', () => {
  const item = { product_id: 'blank', sku: 'JERSEY', image_url: 'mock.png', takes_number: true, num_transfer_sets: ['8in|White'] };
  const digits = Array.from({ length: 10 }, (_, digit) => ({ kind: 'number', digit: String(digit), tsize: '8in', color: 'White', decoration_type: 'dtf', width_in: 4, height_in: 8, production_file: { bucket: 'all-school-art', path: `${digit}.ai`, name: `${digit}.ai` } }));
  expect(productionSetupError(item, digits)).toBe('');
  expect(productionSetupError(item, digits.slice(0, 9))).toMatch(/digit 9/);
  expect(productionSetupError(item, digits.map((d) => ({ ...d, production_file: null })))).toMatch(/exact .ai/);
});
