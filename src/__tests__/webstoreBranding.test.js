/** @jest-environment node */
const { publicStorefront } = require('../../netlify/functions/webstore-checkout');

function database(store, customers) {
  const calls = [];
  return { calls, from(table) {
    let id;
    const q = { select: () => q, eq: (key, value) => { if (key === 'id') id = value; return q; }, limit: () => q, order: () => q, range: () => q,
      then(resolve, reject) {
        calls.push({ table, id });
        const data = table === 'webstores' ? [store] : table === 'customers' ? customers.filter(c => c.id === id) : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      } };
    return q;
  } };
}
const store = { id: 'store', slug: 'school', name: 'School Athletics', status: 'draft', org_type: 'all_school', customer_id: 'team', logo_url: '', all_school_settings: { hero_background_text: 'PADRES', purchasing: { secret: 'private' } } };

test('storefront inherits current customer logo without exposing customer data or private settings', async () => {
  const customers = [{ id: 'team', logo_url: 'school-logo.png' }];
  const sb = database(store, customers);
  let result = JSON.parse((await publicStorefront(sb, { slug: 'school' })).body).store;
  expect(result.logo_url).toBe('school-logo.png');
  expect(result.customer_id).toBeUndefined();
  expect(result.all_school_settings.hero_background_text).toBe('PADRES');
  expect(result.all_school_settings.purchasing).toBeUndefined();
  customers[0].logo_url = 'updated-logo.png';
  result = JSON.parse((await publicStorefront(sb, { slug: 'school' })).body).store;
  expect(result.logo_url).toBe('updated-logo.png');
  expect(store.logo_url).toBe('');
});

test('public storefront includes only display-safe promotion settings', async () => {
  const branded = { ...store, all_school_settings: {
    ...store.all_school_settings, show_promo_banner: true, secondary_logo_url: 'secondary.png',
    promo_heading: 'Homecoming gear', promo_description: 'Shop for Friday night',
    promo_button_label: 'Shop now', promo_destination: 'football', promo_art_text: 'Homecoming',
    purchasing: { secret: 'private' }, dtf: { supplier_id: 'private' },
  } };
  const result = JSON.parse((await publicStorefront(database(branded, []), { slug: 'school' })).body).store;
  expect(result.all_school_settings).toMatchObject({
    show_promo_banner: true, secondary_logo_url: 'secondary.png', promo_heading: 'Homecoming gear',
    promo_description: 'Shop for Friday night', promo_button_label: 'Shop now',
    promo_destination: 'football', promo_art_text: 'Homecoming',
  });
  expect(result.all_school_settings.purchasing).toBeUndefined();
  expect(result.all_school_settings.dtf).toBeUndefined();
  const legacy = JSON.parse((await publicStorefront(database(store, []), { slug: 'school' })).body).store;
  expect(legacy.all_school_settings.show_promo_banner).toBe(false);
});

test('explicit store override wins and clearing it restores inheritance', async () => {
  const sb = database({ ...store, logo_url: 'override.png' }, [{ id: 'team', logo_url: 'school.png' }]);
  expect(JSON.parse((await publicStorefront(sb, { slug: 'school' })).body).store.logo_url).toBe('override.png');
  expect(sb.calls.some(call => call.table === 'customers')).toBe(false);
});

test('team with no logo inherits its parent school; missing logos retain initials fallback', async () => {
  const sb = database(store, [{ id: 'team', parent_id: 'school' }, { id: 'school', logo_url: 'parent.png' }]);
  expect(JSON.parse((await publicStorefront(sb, { slug: 'school' })).body).store.logo_url).toBe('parent.png');
  expect(JSON.parse((await publicStorefront(database(store, []), { slug: 'school' })).body).store.logo_url).toBe('');
});
