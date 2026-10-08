import { schoolLaunchError } from './launchReadiness';
const ready = { id: '1', product_id: 'blank', sku: 'SHIRT', active: true, image_url: 'mock.png' };
test('empty store or missing mockup cannot launch', () => {
  expect(schoolLaunchError([])).toMatch(/at least one/);
  expect(schoolLaunchError([{ ...ready, image_url: null }])).toMatch(/mockup/);
});
test('ready setup needs no approval timestamp and hidden choices do not block launch', () => {
  expect(schoolLaunchError([ready, { sku: 'OLD', active: false }])).toBe('');
});
