/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const {
  assertStoreInFamily,
  curateRosterRow,
  curateShipAddress,
  normalizePosition,
  rosterInsertRow,
} = require('../../netlify/functions/_coachWebstoreAccess');

describe('coach webstore token-scoped gateway', () => {
  test('curates shipping addresses down to non-street display fields', () => {
    expect(curateShipAddress({
      name: 'Jane Parent', city: 'Tustin', state: 'CA', zip: '92780',
      line1: '14241 Olive Tree Cir', email: 'private@example.com', phone: '555-1212',
    })).toEqual({ name: 'Jane Parent', city: 'Tustin', state: 'CA', zip: '92780' });
  });

  test('roster responses allow-list fields and server-generates unique tokens', () => {
    const first = rosterInsertRow('store-1', { player_name: ' Alex ', position: 'goalkeeper' });
    const second = rosterInsertRow('store-1', { player_name: 'Sam', position: 'field' });
    expect(first).toMatchObject({ store_id: 'store-1', player_name: 'Alex', position: 'gk', ordered: false });
    expect(first.token).toMatch(/^[a-f0-9]{32}$/);
    expect(second.token).not.toBe(first.token);
    expect(curateRosterRow({ ...first, secret: 'nope' })).not.toHaveProperty('secret');
    expect(normalizePosition('keeper')).toBe('gk');
    expect(normalizePosition('outfield')).toBe('field');
    expect(normalizePosition('other')).toBeNull();
  });

  test('rejects stores outside the resolved customer family', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'store-1', customer_id: 'customer-b', name: 'B', slug: 'b' }, error: null,
    });
    const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) };
    await expect(assertStoreInFamily(admin, new Set(['customer-a']), 'store-1'))
      .resolves.toEqual({ error: 'Store not found', status: 404 });
  });

  test('coach browser no longer queries global views or roster directly', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'CoachPortal.js'), 'utf8');
    expect(source).toContain('/.netlify/functions/coach-webstore-access');
    expect(source).not.toMatch(/\.from\(['"]coach_webstores['"]\)/);
    expect(source).not.toMatch(/\.from\(['"]coach_webstore_orders['"]\)/);
    expect(source).not.toMatch(/\.from\(['"]coach_webstore_order_items['"]\)/);
    expect(source).not.toMatch(/\.from\(['"]webstore_roster['"]\)/);
    expect(source).toContain('alpha_tag: alphaTag, store_id: store.id, player_ids: ids');
  });

  test('migration revokes public reads and restores staff-only roster access', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260902030050_scope_coach_webstore_access.sql'), 'utf8');
    expect(sql).toMatch(/revoke all on public\.coach_webstores from anon, authenticated/i);
    expect(sql).toMatch(/drop policy if exists webstore_roster_anon_read/i);
    expect(sql).toMatch(/create policy webstore_roster_staff_all/i);
    expect(sql).toMatch(/drop policy if exists profiles_select/i);
    expect(sql).toMatch(/revoke all on public\.user_profiles from anon/i);
  });
});
