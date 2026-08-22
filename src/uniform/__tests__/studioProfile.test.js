import { LACOSTE_TEST_PROFILE, STUDIO_DEFAULTS, resolveStudioProfile } from '../studioProfiles';

describe('studio render profiles', () => {
  test('keeps the calibrated production profile as the default', () => {
    expect(resolveStudioProfile()).toEqual(STUDIO_DEFAULTS);
  });

  test('provides an isolated premium apparel comparison profile', () => {
    expect(resolveStudioProfile('lacoste')).toEqual(LACOSTE_TEST_PROFILE);
    expect(resolveStudioProfile('lacoste')).not.toBe(LACOSTE_TEST_PROFILE);
  });

  test('merges persisted production tuning without mutating defaults', () => {
    expect(resolveStudioProfile('', { exposure: 0.77 }).exposure).toBe(0.77);
    expect(STUDIO_DEFAULTS.exposure).toBe(0.82);
  });
});
