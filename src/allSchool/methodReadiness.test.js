import { methodSetupError, resolveSchoolSetup } from './methodReadiness.shared';
import { garmentInventoryRows } from './garmentInventory';
const blank = { id: '1', product_id: 'p', sku: 'HOODIE-Royal', image_url: 'mock.png', decorations: [{ art_id: 'logo', art_url: 'logo.png', placement: 'full_front' }] };
const stock = { code: 'store-art-logo', decoration_type: 'twill', application_method: 'heat_press', on_hand: 0 };
test('zero-stock heat-transfer twill needs inventory setup, not artwork approval or an AI upload', () => {
  expect(methodSetupError(blank, [stock], [{ id: 'logo', deco_type: 'dtf' }])).toBe('');
  expect(resolveSchoolSetup(blank, [stock], []).transfer_codes).toEqual(['store-art-logo']);
  expect(methodSetupError(blank, [], [{ id: 'logo', deco_type: 'dtf' }])).toMatch(/inventory/);
});
test('embroidery requires its attached DST and mockup but no separate approval click', () => {
  const art = [{ id: 'logo', deco_type: 'embroidery', status: 'draft', files: [{ name: 'logo.dst', url: '/logo.dst' }] }];
  expect(methodSetupError(blank, [], art)).toBe('');
  expect(methodSetupError({ ...blank, image_url: null }, [], art)).toMatch(/mockup/);
  expect(methodSetupError(blank, [], [{ ...art[0], files: [{ url: 'preview.png' }] }])).toMatch(/dst/);
});
test('screen print remains blocked, including a legacy approved setup', () => {
  expect(methodSetupError({ ...blank, production_approved_at: 'yesterday' }, [], [{ id: 'logo', deco_type: 'screen_print' }])).toMatch(/not offered/);
});
test('inventory groups identical blank colors without summing the same physical stock', () => {
  const rows = garmentInventoryRows([blank, { ...blank, id: '2' }, { ...blank, id: '3', sku: 'HOODIE-Black' }], { '1': { name: 'Hoodie', vendor_on_hand: 1079 }, '2': { vendor_on_hand: 0 } });
  expect(rows).toHaveLength(2);
  expect(rows[0].inventoryChoices).toHaveLength(2);
  expect(rows[0].inventoryStock.vendor_on_hand).toBe(1079);
});
