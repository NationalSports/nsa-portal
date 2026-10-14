import { hasStorefrontLogoChoices, supportsLogoChoices } from './webstoreLogoChoices';

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
