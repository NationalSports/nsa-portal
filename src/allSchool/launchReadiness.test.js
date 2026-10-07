import { schoolLaunchError } from './launchReadiness';
const ready = { id: '1', sku: 'SHIRT', active: true, image_url: 'mock.png', production_approved_at: '2026-10-06', production_approved_by: 'rep1' };
test('cannot launch an empty store or an unapproved active offering', () => {
  expect(schoolLaunchError([])).toMatch(/at least one/);
  expect(schoolLaunchError([{ ...ready, production_approved_at: null }])).toMatch(/SHIRT/);
  expect(schoolLaunchError([{ ...ready, production_approved_by: '' }])).toMatch(/before launch/);
  expect(schoolLaunchError([{ ...ready, image_url: null }])).toMatch(/before launch/);
});
test('archived unfinished offerings do not block approved active catalog', () => {
  expect(schoolLaunchError([ready, { sku: 'OLD', active: false }])).toBe('');
});
