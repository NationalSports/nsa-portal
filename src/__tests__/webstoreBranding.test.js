/** @jest-environment node */
const { publicStorefront } = require('../../netlify/functions/webstore-checkout');

function database(store, customers, productRows = [], storefrontRows = []) {
  const calls = [];
  return { calls, from(table) {
    let id;
    const q = { select: () => q, eq: (key, value) => { if (key === 'id') id = value; return q; }, in: () => q, limit: () => q, order: () => q, range: () => q,
      then(resolve, reject) {
        calls.push({ table, id });
        const data = table === 'webstores' ? [store] : table === 'customers' ? customers.filter(c => c.id === id)
          : table === 'webstore_products' ? productRows : table === 'webstore_storefront_products' ? storefrontRows : [];
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
  const sb = database(
    { ...store, logo_url: 'override.png', primary_color: '#010203', accent_color: '#040506' },
    [{ id: 'team', logo_url: 'school.png', school_colors: ['Navy', 'Red'] }],
  );
  expect(JSON.parse((await publicStorefront(sb, { slug: 'school' })).body).store.logo_url).toBe('override.png');
  expect(sb.calls.some(call => call.table === 'customers')).toBe(false);
});

test('team with no logo inherits its parent school; missing logos retain initials fallback', async () => {
  const sb = database(store, [{ id: 'team', parent_id: 'school' }, { id: 'school', logo_url: 'parent.png' }]);
  expect(JSON.parse((await publicStorefront(sb, { slug: 'school' })).body).store.logo_url).toBe('parent.png');
  expect(JSON.parse((await publicStorefront(database(store, []), { slug: 'school' })).body).store.logo_url).toBe('');
});

test('storefront inherits named school colors while store-level colors still win', async () => {
  const customer = { id: 'team', school_colors: ['White', 'Grey', 'Navy', 'Red'] };
  const inherited = JSON.parse((await publicStorefront(
    database({ ...store, primary_color: null, accent_color: null }, [customer]),
    { slug: 'school' },
  )).body).store;
  expect(inherited.primary_color).toBe('#1B2A4A');
  expect(inherited.accent_color).toBe('#BA0C2F');

  const overridden = JSON.parse((await publicStorefront(
    database({ ...store, primary_color: '#112233', accent_color: '#cf1723' }, [customer]),
    { slug: 'school' },
  )).body).store;
  expect(overridden.primary_color).toBe('#112233');
  expect(overridden.accent_color).toBe('#cf1723');
});

test('a partial store override is combined with the missing customer default', async () => {
  const result = JSON.parse((await publicStorefront(
    database(
      { ...store, primary_color: null, accent_color: '#cf1723' },
      [{ id: 'team', school_colors: ['White', 'Grey', 'Navy', 'Red'] }],
    ),
    { slug: 'school' },
  )).body).store;
  expect(result.primary_color).toBe('#1B2A4A');
  expect(result.accent_color).toBe('#cf1723');
});

test('team storefront receives logo grouping fields without all-school personalization defaults', async () => {
  const team = { ...store, org_type: 'team', all_school_settings: { first_logo_by_style: { hoodie: 'arch' } } };
  const result = JSON.parse((await publicStorefront(database(
    team,
    [],
    [{ id: 'wp', school_style_group_id: 'hoodie', school_design_label: 'Arched crest', personalization_template: { max_length: 40 } }],
    [{ webstore_product_id: 'wp', name: 'Hoodie' }],
  ), { slug: 'school' })).body);
  expect(result.store.all_school_settings).toEqual({ first_logo_by_style: { hoodie: 'arch' } });
  expect(result.products[0]).toMatchObject({ school_style_group_id: 'hoodie', school_design_label: 'Arched crest' });
  expect(result.products[0].personalization_template).toBeUndefined();
  expect(result.products[0].school_shared).toBeUndefined();
});

test('team storefront with no logo options keeps its ordinary product behavior', async () => {
  const team = { ...store, org_type: 'team', all_school_settings: {} };
  const result = JSON.parse((await publicStorefront(database(
    team, [], [{ id: 'wp', school_style_group_id: null, school_design_label: null }], [{ webstore_product_id: 'wp', name: 'Tee' }],
  ), { slug: 'school' })).body);
  expect(result.store.all_school_settings).toBeUndefined();
  expect(result.products[0]).toMatchObject({ name: 'Tee', school_style_group_id: null, school_design_label: null });
  expect(result.products[0].personalization_template).toBeUndefined();
});
