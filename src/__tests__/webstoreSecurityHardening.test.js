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
