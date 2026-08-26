
/* eslint-disable */
jest.mock('../utils', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../utils');
const { createShipStationLabel } = require('../vendorApis');

const ok = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('decorator IF ShipStation label handoff', () => {
  beforeEach(() => {
    authFetch.mockReset();
    authFetch.mockResolvedValue(ok({ trackingNumber: '1ZTEST', shipmentId: 42, shipmentCost: 12.34 }));
  });

  test('sends the selected DPO as attention with the exact decorator address', async () => {
    const so = { id: 'SO-2021', created_at: '8/26/2026', items: [], status: 'complete' };
    const customer = { id: 'SFXC', name: 'St. Francis Cross Country', contacts: [] };
    const shipTo = {
      name: 'ATTN: DPO 57243 SFXC', company: 'Silver Screen',
      street1: '100 Decorator Way', street2: 'Suite 4', city: 'Portland', state: 'OR',
      postalCode: '97201', country: 'US', phone: '503-555-0100', residential: false,
    };

    await createShipStationLabel(so, customer,
      [{ sku: 'HI0704', name: 'Adidas W. Team Issue Pants', color: 'Black', sizes: { S: 1 } }],
      5, 'ups', 'ups_ground', { length: 12, width: 10, height: 4 }, shipTo);

    expect(authFetch).toHaveBeenCalledTimes(1);
    const [url, options] = authFetch.mock.calls[0];
    expect(decodeURIComponent(url)).toContain('path=/shipments/createlabel');
    expect(decodeURIComponent(url)).not.toContain('/orders/createlabelfororder');
    const payload = JSON.parse(options.body);
    expect(payload.shipTo).toEqual(shipTo);
    expect(payload.shipTo.name).toBe('ATTN: DPO 57243 SFXC');
    expect(payload.advancedOptions.customField1).toBe('NSA-SO-SO-2021');
  });

  test('refuses a label before any API call when the decorator address is incomplete', async () => {
    await expect(createShipStationLabel(
      { id: 'SO-2021', items: [], status: 'complete' },
      { name: 'Customer', contacts: [] }, [], 5, 'ups', 'ups_ground', {},
      { name: 'ATTN: DPO 57243 SFXC', company: 'Silver Screen', street1: '', city: '', state: 'OR', postalCode: '' },
    )).rejects.toThrow(/Ship-to address is incomplete/);
    expect(authFetch).not.toHaveBeenCalled();
  });
});