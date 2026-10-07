/** @jest-environment node */
jest.mock('../../netlify/functions/_shared', () => ({ verifyUser: jest.fn(), corsHeaders: () => ({}) }));
jest.mock('../../netlify/functions/_soShipStationBridge', () => ({
  ...jest.requireActual('../../netlify/functions/_soShipStationBridge'),
  fetchShipmentPages: jest.fn(), importSoShipment: jest.fn(),
}));
const { verifyUser } = require('../../netlify/functions/_shared');
const { fetchShipmentPages, importSoShipment } = require('../../netlify/functions/_soShipStationBridge');
const { handler } = require('../../netlify/functions/so-shipstation-sync');
const { processShipStationPayload } = require('../../netlify/functions/shipstation-webhook');
const event = { httpMethod: 'POST', body: JSON.stringify({ soId: 'SO-2173', shipments: [{ trackingNumber: 'UNTRUSTED' }] }) };
beforeEach(() => { jest.clearAllMocks(); verifyUser.mockResolvedValue({ ok: true, admin: {} }); importSoShipment.mockResolvedValue({ changed: true }); });
test('unauthenticated callers cannot fetch or import shipments', async () => {
  verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
  expect((await handler(event)).statusCode).toBe(401);
  expect(fetchShipmentPages).not.toHaveBeenCalled(); expect(importSoShipment).not.toHaveBeenCalled();
});
test('status check imports all matching live packages from the provider only', async () => {
  fetchShipmentPages.mockResolvedValue([
    { orderNumber: 'SO-2173', shipmentId: 1 }, { orderNumber: 'SO-2173', shipmentId: 2 },
    { orderNumber: 'SO-21730', shipmentId: 3 }, { orderNumber: 'SO-2173', shipmentId: 4, voided: true },
  ]);
  const result = await handler(event);
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body)).toEqual({ matched: 2, changed: 2 });
  expect(importSoShipment).toHaveBeenCalledTimes(2);
  expect(importSoShipment.mock.calls[0][1]).toEqual({ orderNumber: 'SO-2173', shipmentId: 1 });
  expect(String(fetchShipmentPages.mock.calls[0][0])).toContain('/shipments?orderNumber=SO-2173');
});
test('ordinary SO webhook now uses the same bridge and propagates write failures for retry', async () => {
  const shipments = [{ orderNumber: 'SO-2173', shipmentId: 1 }, { orderNumber: 'SO-2173', shipmentId: 2 }];
  expect(await processShipStationPayload({}, { shipments })).toMatchObject({ processed: 2, ignored: 0 });
  expect(importSoShipment).toHaveBeenCalledTimes(2);
  importSoShipment.mockRejectedValueOnce(new Error('write failed'));
  await expect(processShipStationPayload({}, { shipments })).rejects.toThrow('write failed');
});
