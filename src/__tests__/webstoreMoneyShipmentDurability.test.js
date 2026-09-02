/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const { normalizeShipment } = require('../../netlify/functions/webstore-shipment-record');
const { listIntentRefunds } = require('../../netlify/functions/stripe-payment');

describe('direct-label shipment durability', () => {
  test('normalizes the label response into the same shape as a ShipStation webhook', () => {
    expect(normalizeShipment({
      shipment_id: 123,
      tracking_number: '1ZTEST',
      carrier: 'ups',
      service: 'ups_ground',
      ship_date: '2026-09-02',
      cost: 12.34,
      items: [{ lineItemKey: 'line-1', sku: 'TEE-L', name: 'Tee', qty: 2 }],
    })).toEqual(expect.objectContaining({
      shipmentId: '123', trackingNumber: '1ZTEST', carrierCode: 'ups',
      serviceCode: 'ups_ground', shipDate: '2026-09-02', shipmentCost: 12.34,
      shipmentItems: [expect.objectContaining({ lineItemKey: 'line-1', quantity: 2 })],
    }));
  });

  test('rejects a shipment with no stable id/tracking or no line quantities', () => {
    expect(() => normalizeShipment({ items: [{ lineItemKey: 'x', qty: 1 }] })).toThrow(/shipment_id or tracking_number/i);
    expect(() => normalizeShipment({ shipment_id: '1', items: [] })).toThrow(/items required/i);
  });

  test('both desk and bagging flows synchronously record the shipment ledger', () => {
    const desk = fs.readFileSync(path.join(__dirname, '../Webstores.js'), 'utf8');
    const bagging = fs.readFileSync(path.join(__dirname, '../../netlify/functions/_baggingShip.js'), 'utf8');
    const webhook = fs.readFileSync(path.join(__dirname, '../../netlify/functions/shipstation-webhook.js'), 'utf8');
    expect(desk).toMatch(/webstore-shipment-record/);
    expect(desk).toMatch(/do not create another label/i);
    expect(bagging).toMatch(/await processDirectShipment/);
    expect(webhook).toMatch(/await queueShipmentEmail\(sb, order, shipment\)/);
  });
});

describe('refund and payment recovery guards', () => {
  test('refund discovery paginates before deciding money is safe to move', async () => {
    const list = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: 're_1' }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: 're_2' }], has_more: false });
    await expect(listIntentRefunds({ refunds: { list } }, 'pi_1')).resolves.toEqual([{ id: 're_1' }, { id: 're_2' }]);
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ payment_intent: 'pi_1', starting_after: 're_1' }));
  });

  test('refund retries detect unrecorded Stripe money and carry a stable attempt id', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../netlify/functions/stripe-payment.js'), 'utf8');
    const client = fs.readFileSync(path.join(__dirname, '../Webstores.js'), 'utf8');
    expect(server).toMatch(/listIntentRefunds\(client, order\.stripe_pi_id\)/);
    expect(server).toMatch(/webstore_refund_attempt_id/);
    expect(server).toMatch(/expected_refunded_cents required/);
    expect(server).toMatch(/if \(rpc && rpc\.duplicate\)/);
    expect(client).toMatch(/const refundAttemptRef = useRef\(null\)/);
    expect(client).toMatch(/expected_refunded_cents/);
  });

  test('checkout clients do not clear carts after a failed paid-status write', () => {
    const storefront = fs.readFileSync(path.join(__dirname, '../storefront/Storefront.js'), 'utf8');
    const teamshop = fs.readFileSync(path.join(__dirname, '../teamshop/CheckoutPage.js'), 'utf8');
    expect(storefront.match(/if \(finalized\.error \|\| !finalized\.ok\)/g)).toHaveLength(2);
    expect(teamshop).toMatch(/if \(!res\.ok \|\| !finalized\.ok\) throw/);
  });
});
