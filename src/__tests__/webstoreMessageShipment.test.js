/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const { planShipmentLineUpdates } = require('../../netlify/functions/_webstoreShipment');
const { staffRecipientIds, staffEmailRecipients } = require('../../netlify/functions/webstore-checkout');

describe('webstore customer reply routing', () => {
  test('routes a customer reply to both the CSR and owning rep', () => {
    expect(staffRecipientIds('tam-id', 'steve-id')).toEqual(['tam-id', 'steve-id']);
  });

  test('deduplicates when the rep is also the assigned CSR', () => {
    expect(staffRecipientIds('same-id', 'same-id')).toEqual(['same-id']);
  });

  test('always includes the shared webstore team mailbox without duplicates', () => {
    expect(staffEmailRecipients([
      { email: 'tam@example.com', name: 'Tam' },
      { email: 'STORES@nationalsportsapparel.com', name: 'Already assigned' },
    ])).toEqual([
      { email: 'tam@example.com', name: 'Tam' },
      { email: 'STORES@nationalsportsapparel.com', name: 'Already assigned' },
    ]);
  });

  test('Slack notification worker consumes the portal tagged_members field', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../supabase/functions/slack-notify/index.ts'), 'utf8');
    expect(source).toMatch(/parseIds\(record\.tagged_members\)/);
  });

  test('customer replies include active webstore-team subscribers', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../netlify/functions/webstore-checkout.js'), 'utf8');
    expect(source).toMatch(/contains\('notify_depts', \['store'\]\)/);
  });
});

describe('webstore shipment tracker reconciliation', () => {
  test('uses lineItemKey for exact partial and full shipment quantities', () => {
    const lines = [
      { id: 'red-m', sku: 'TEE', size: 'M', qty: 2, line_status: 'bagging' },
      { id: 'black-xl', sku: 'TEE', size: 'XL', qty: 1, line_status: 'bagging' },
    ];
    const shipments = [{ items: [
      { lineItemKey: 'red-m', sku: 'TEE', qty: 1 },
      { lineItemKey: 'black-xl', sku: 'TEE', qty: 1 },
    ] }];

    expect(planShipmentLineUpdates(lines, shipments)).toEqual([
      { id: 'red-m', shipped_qty: 1, line_status: 'bagging' },
      { id: 'black-xl', shipped_qty: 1, line_status: 'shipped' },
    ]);
  });

  test('falls back to SKU + size when ShipStation omits our line key', () => {
    const lines = [
      { id: 'm', sku: 'TEE', size: 'M', qty: 1, line_status: 'on_order' },
      { id: 'xl', sku: 'TEE', size: 'XL', qty: 1, line_status: 'on_order' },
    ];
    const shipments = [{ items: [
      { sku: 'TEE', name: 'TEE · Size XL', quantity: 1 },
    ] }];

    expect(planShipmentLineUpdates(lines, shipments)).toEqual([
      { id: 'xl', shipped_qty: 1, line_status: 'shipped' },
    ]);
  });

  test('sums multiple shipments without over-counting a line', () => {
    const lines = [{ id: 10, sku: 'TEE', size: 'M', qty: 2, line_status: 'bagging' }];
    const shipments = [
      { items: [{ lineItemKey: '10', qty: 1 }] },
      { items: [{ lineItemKey: 10, qty: 1 }] },
      { items: [{ lineItemKey: 10, qty: 1 }] },
    ];
    expect(planShipmentLineUpdates(lines, shipments)).toEqual([
      { id: 10, shipped_qty: 2, line_status: 'shipped' },
    ]);
  });
});
