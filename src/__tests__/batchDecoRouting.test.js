/* eslint-disable */
// Which batch-queue group a new batch PO joins: the vendor's regular (warehouse) batch, or a
// "Vendor → Decorator" batch that ships the blanks straight to an outside decorator.
//
// The PO modal used to route by the inline deco PO alone, so a rep who picked 🏭 In-House but
// also added a deco PO in the same window had the blanks filed under the decorator's batch
// (live queue: SO-2814 / SO-2454 sat in "SanMar → BYOG" / "Richardson → WePrintIt" with no
// drop-ship flag). And a Drop Ship PO whose decorator was picked only in Ship To got its
// decorator-bound lines filed under the WAREHOUSE batch, which then pulled that whole batch's
// ship-to to the decorator. This runs the real routing line from both editors.
import fs from 'fs';
import path from 'path';

const routeFor = (file) => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith('const batchDecoId='));
  const shipIdx = lines.findIndex((l) => l.trim().startsWith('const _poShipDecoId='));
  const expr = lines[idx].trim().replace(/^const batchDecoId=/, '').replace(/;$/, '');
  // eslint-disable-next-line no-new-func
  const fn = new Function('poDropShip', 'podDv', '_existingBatchDeco', '_poShipDecoId', 'return ' + expr);
  return { idx, shipIdx, route: ({ dropShip = false, inlineDeco = null, existingDeco = null, shipDeco = null }) =>
    fn(dropShip, inlineDeco ? { id: inlineDeco } : null, existingDeco ? { deco_vendor_id: existingDeco } : null, shipDeco) };
};

describe.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s batch destination', (file) => {
  const { idx, shipIdx, route } = routeFor(file);

  test('routing line exists and reads the Ship To decorator after it is computed', () => {
    expect(idx).toBeGreaterThan(-1);
    expect(shipIdx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(shipIdx);
  });

  test('In-House + a deco PO made in the same window stays in the regular batch', () => {
    expect(route({ dropShip: false, inlineDeco: 'dv_byog_screenprinting' })).toBeNull();
  });

  test('In-House never routes to a decorator, whatever Ship To or existing deco POs say', () => {
    expect(route({ dropShip: false, existingDeco: 'dv_weprintit', shipDeco: 'dv_weprintit' })).toBeNull();
  });

  test('Drop Ship + inline deco PO joins that decorator\'s batch', () => {
    expect(route({ dropShip: true, inlineDeco: 'dv_byog_screenprinting' })).toBe('dv_byog_screenprinting');
  });

  test('Drop Ship covered by an existing drop-ship deco PO joins that decorator\'s batch', () => {
    expect(route({ dropShip: true, existingDeco: 'dv_weprintit' })).toBe('dv_weprintit');
  });

  test('Drop Ship to a decorator picked only in Ship To gets its own decorator batch, not the warehouse one', () => {
    expect(route({ dropShip: true, shipDeco: 'dv_weprintit' })).toBe('dv_weprintit');
  });

  test('Drop Ship to a customer address stays out of every decorator batch', () => {
    expect(route({ dropShip: true })).toBeNull();
  });
});
