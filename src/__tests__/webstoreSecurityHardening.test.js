/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const checkout = require('../../netlify/functions/webstore-checkout');

describe('public order bearer boundary', () => {
  test('legacy UUID-only lookup is rejected without touching the database', async () => {
    const sb = { from: jest.fn(() => { throw new Error('database must not be touched'); }) };
    const response = await checkout.getOrder(sb, { orderId: 'known-order-uuid' });
    expect(response.statusCode).toBe(403);
    expect(sb.from).not.toHaveBeenCalled();
  });

  test('public tracker allow-lists fields and excludes payment/internal secrets', () => {
    expect(checkout.PUBLIC_ORDER_FIELDS).toContain('status_token');
    expect(checkout.PUBLIC_ORDER_FIELDS).toContain('ship_address');
    expect(checkout.PUBLIC_ORDER_FIELDS).not.toMatch(/stripe_pi_id|label_data|shipstation_shipment_id|buyer_email|buyer_phone/);
    expect(checkout.PUBLIC_ORDER_ITEM_FIELDS).not.toMatch(/unit_cost|nsa_cost|refund/);
  });

  test('storefront routes and address updates use the status token, not order UUID', () => {
    const source = fs.readFileSync(path.join(__dirname, '../storefront/Storefront.js'), 'utf8');
    expect(source).toMatch(/action: 'track_order', token: orderToken/);
    expect(source).toMatch(/action: 'update_ship', token, ship: f/);
    expect(source).not.toMatch(/action: 'get_order'/);
    expect(source).not.toMatch(/action: 'update_ship', orderId/);
  });

  function addressSb(order, updateResult = { data: [{ id: order.id }], error: null }) {
    const calls = [];
    return {
      calls,
      from: jest.fn(() => {
        let op = 'select';
        const chain = {
          select: () => chain, eq: () => chain, limit: () => chain, is: () => chain, not: () => chain,
          update: (payload) => { op = 'update'; calls.push(payload); return chain; },
          then: (resolve, reject) => Promise.resolve(op === 'update' ? updateResult : { data: [order], error: null }).then(resolve, reject),
        };
        return chain;
      }),
    };
  }

  test('buyer cannot silently change tax jurisdiction after checkout', async () => {
    const order = { id: 'o1', status: 'paid', shipped_at: null, ship_address: { name: 'Buyer', street1: '1 Main St', street2: '', city: 'Fresno', state: 'CA', zip: '93703' } };
    const sb = addressSb(order);
    const response = await checkout.updateShip(sb, { token: 'private-token', ship: { ...order.ship_address, zip: '93704' } });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error).toMatch(/verify tax and shipping/i);
    expect(sb.calls).toHaveLength(0);
  });

  test('buyer may still correct recipient name and apartment without changing charged address fields', async () => {
    const order = { id: 'o1', status: 'paid', shipped_at: null, ship_address: { name: 'Buyer', street1: '1 Main St', street2: '', city: 'Fresno', state: 'CA', zip: '93703' } };
    const sb = addressSb(order);
    const response = await checkout.updateShip(sb, { token: 'private-token', ship: { name: 'New Recipient', street1: ' 1  MAIN ST ', street2: 'Apt 2', city: 'fresno', state: 'ca', zip: '93703-1234' } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).ship_address).toEqual({ name: 'New Recipient', street1: '1 Main St', street2: 'Apt 2', city: 'Fresno', state: 'CA', zip: '93703' });
    expect(sb.calls).toEqual([expect.objectContaining({ ship_address: expect.objectContaining({ street1: '1 Main St', city: 'Fresno', state: 'CA', zip: '93703' }) })]);
  });
});

describe('webstore RLS regression guard', () => {
  test('sensitive tables are staff-only and public settings table access is removed', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260902035500_harden_webstore_client_privileges.sql'), 'utf8');
    expect(sql).toMatch(/using \(\(select public\.is_team_member\(\)\)\)/i);
    expect(sql).toMatch(/revoke all on public\.%I from public, anon/i);
    expect(sql).toMatch(/drop policy if exists webstore_settings_read/i);
    expect(sql).toMatch(/'webstore_orders'/);
    expect(sql).toMatch(/'webstore_roster'/);
  });
});
