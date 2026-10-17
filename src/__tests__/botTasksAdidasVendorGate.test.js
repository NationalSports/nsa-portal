import { botTargetForVendor, buildBotCartPayload } from '../lib/botTasks';
import { isAdidasClickPayload } from '../lib/adidasClickPlan';

test('routes adidas by vendor name, never by a product inventory_source tag', () => {
  expect(botTargetForVendor('adidas')).toBe('adidas_click');
  expect(botTargetForVendor('Adidas Team')).toBe('adidas_click');
  expect(botTargetForVendor('Champro')).toBe('champro');
  expect(botTargetForVendor('A4')).toBe('a4');

  const payload = buildBotCartPayload({
    poNumber: 'PO1',
    vendorName: 'Champro',
    batches: [{
      items: [{ sku: 'CH1', qty: 2, sizes: { S: 2 }, inventory_source: 'click' }],
    }],
  });
  expect(payload.bot_payload.target).toBe('champro');
  expect(isAdidasClickPayload(payload.bot_payload)).toBe(false);
  expect(isAdidasClickPayload({ target: 'adidas_click', inventory_source: 'anything' })).toBe(true);
});
