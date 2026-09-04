/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '../Webstores.js'), 'utf8');
const endpoint = fs.readFileSync(path.join(__dirname, '../../netlify/functions/webstore-clone.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260902081000_atomic_webstore_clone.sql'), 'utf8');

describe('atomic webstore cloning', () => {
  test('the UI delegates the entire clone to one RPC', () => {
    expect(ui).toMatch(/\/\.netlify\/functions\/webstore-clone/);
    expect(ui).toMatch(/item_ids: opts\.itemIds == null \? null : opts\.itemIds/);
    expect(ui).not.toMatch(/Catalog copy failed|Package items copy failed|Transfer setup copy failed/);
  });

  test('the transaction copies and remaps every child type before returning success', () => {
    expect(migration).toMatch(/insert into public\.webstores select v_store\.\*/);
    expect(migration).toMatch(/insert into public\.webstore_products select v_new_product\.\*/);
    expect(migration).toMatch(/v_id_map ->> v_bundle_item\.bundle_id::text/);
    expect(migration).toMatch(/insert into public\.webstore_bundle_items select v_new_bundle_item\.\*/);
    expect(migration).toMatch(/insert into public\.webstore_transfers select v_new_transfer\.\*/);
    expect(migration).toMatch(/'on_order', 0/);
  });

  test('templates and rebrands drop organization identity and source branding', () => {
    for (const field of ['customer_id', 'rep_id', 'csr_id', 'coach_contact_email', 'director_email']) {
      expect(migration).toMatch(new RegExp(`'${field}', null`));
    }
    expect(migration).toMatch(/'extra_image_urls', '\[\]'::jsonb/);
    expect(migration).toMatch(/'decoration_id', null/);
  });

  test('RPC access is active-staff scoped and denied to anonymous callers', () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/);
    expect(migration).toMatch(/v_role <> 'service_role' and not public\.is_team_member\(\)/);
    expect(migration).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function[\s\S]*to service_role/);
    expect(endpoint).toMatch(/await verifyUser\(event\)/);
    expect(endpoint).toMatch(/sb\.rpc\('clone_webstore_atomic'/);
  });
});
