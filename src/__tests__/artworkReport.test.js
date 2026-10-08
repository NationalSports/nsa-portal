import { mapLinesToSoItems } from '../lib/soPlayerReport';
import { artworkInstructions } from '../lib/artworkReport';
const recipe = (id) => ({ webstore_product_id: id, decorations: [{ art_id: id, placement: 'full_front', art_url: `${id}.png` }], art_files: [{ id, name: `Serra ${id}` }] });
test('same SKU and size remain isolated by purchased art, including a substitution', () => {
  const a = recipe('script'), b = recipe('block');
  const lines = [{ id: 'a', sku: 'HOODIE', size: 'M', qty: 1, production_recipe: a }, { id: 'b', sku: 'HOODIE', size: 'M', qty: 2, production_recipe: b }];
  const mapped = mapLinesToSoItems(lines, [{ sku: 'NEW-HOODIE', name: 'Replacement', sizes: { M: 1 }, recipe_snapshot: a }, { sku: 'HOODIE', name: 'Original', sizes: { M: 2 }, recipe_snapshot: b }]);
  expect(mapped.lines.find((l) => l.id === 'a')._sku).toBe('NEW-HOODIE');
  expect(mapped.lines.find((l) => l.id === 'b')._sku).toBe('HOODIE');
  expect(mapped.lines.reduce((n, l) => n + l.qty, 0)).toBe(3);
});
test('missing recipe match cannot silently fall back to another logo with the same SKU', () => {
  const mapped = mapLinesToSoItems([{ id: 'a', sku: 'HOODIE', qty: 1, size: 'M', production_recipe: recipe('script') }], [{ sku: 'HOODIE', sizes: { M: 1 }, recipe_snapshot: recipe('block') }]);
  expect(mapped.lines[0]._unmatched).toBe(true);
});
test('instructions contain frozen logo name, placement, preview, and application details', () => {
  expect(artworkInstructions({ production_recipe: { ...recipe('script'), transfer_inventory: [{ code: 'T1', label: 'Script twill', decoration_type: 'twill', application_method: 'sew_on', application_instructions: 'Blue thread' }] } })).toBe('Serra script — full front — script.png; Script twill — twill — sew on — Blue thread');
});
