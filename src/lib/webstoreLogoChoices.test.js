import { fillHiddenRowStock, hasStorefrontLogoChoices, supportsLogoChoices } from './webstoreLogoChoices';

test('logo choices are configurable on team and all-school stores but not clubs', () => {
  expect(supportsLogoChoices({ org_type: 'team' })).toBe(true);
  expect(supportsLogoChoices({ org_type: 'all_school' })).toBe(true);
  expect(supportsLogoChoices({ org_type: 'club' })).toBe(false);
  expect(supportsLogoChoices({ org_type: 'team', source: 'omg' })).toBe(false);
  expect(supportsLogoChoices(null)).toBe(false);
});

test('ordinary team catalogs stay on their existing grouping path', () => {
  expect(hasStorefrontLogoChoices({ org_type: 'team' }, [{ kind: 'single', variant_group_id: 'colors' }])).toBe(false);
  expect(hasStorefrontLogoChoices({ org_type: 'team' }, [{ kind: 'single', school_style_group_id: 'style' }])).toBe(true);
  expect(hasStorefrontLogoChoices({ org_type: 'all_school' }, [])).toBe(true);
});

test('hidden logo-choice rows borrow the garment details of a visible row of the same blank', () => {
  const catalog = [{ id: 'shown', product_id: 'tee' }, { id: 'hidden', product_id: 'tee' }, { id: 'archived', product_id: 'other' }];
  const stock = { shown: { webstore_product_id: 'shown', name: 'Pregame Tee', color: 'Black', image_front_url: 'front.png', retail_price: 30, decorations: [{ art_id: 'a' }] } };
  fillHiddenRowStock(catalog, stock);
  expect(stock.hidden).toEqual({ webstore_product_id: 'hidden', name: 'Pregame Tee', color: 'Black', image_front_url: 'front.png' });
  expect(stock.archived).toBeUndefined();
  expect(stock.shown.webstore_product_id).toBe('shown');
});
