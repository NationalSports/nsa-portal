jest.mock('../renderCanvas', () => ({
  renderToDataURL: jest.fn(),
  renderProductionPDF: jest.fn(),
  renderProductionSheet: jest.fn(),
}));

import { aiDesignSupportedForSport, frontIdentityStatus, hasFrontLogo, numberDefaultsFor } from '../ProBuilder';

describe('guided builder production rules', () => {
  test('launches the dedicated AI route only for the approved starting sports', () => {
    expect(aiDesignSupportedForSport('soccer')).toBe(true);
    expect(aiDesignSupportedForSport('basketball')).toBe(true);
    expect(aiDesignSupportedForSport('flagfootball')).toBe(false);
    expect(aiDesignSupportedForSport('football')).toBe(false);
  });

  test('uses sport and program-specific finished number heights', () => {
    expect(numberDefaultsFor('soccer', 'mens')).toEqual({ front: 4, back: 8 });
    expect(numberDefaultsFor('soccer', 'womens')).toEqual({ front: 4, back: 6 });
    expect(numberDefaultsFor('soccer', 'youth')).toEqual({ front: 4, back: 6 });
    expect(numberDefaultsFor('basketball', 'mens')).toEqual({ front: 4, back: 8 });
    expect(numberDefaultsFor('flagfootball', 'womens')).toEqual({ front: 6, back: 8 });
  });

  test('only front-chest placements satisfy the front-logo rule', () => {
    expect(hasFrontLogo({ chest: { src: 'logo.png' } })).toBe(true);
    expect(hasFrontLogo({ rightChest: { src: 'logo.png' } })).toBe(true);
    expect(hasFrontLogo({ leftSleeve: { src: 'logo.png' }, back: { src: 'logo.png' } })).toBe(false);
  });

  test('requires exactly the identity assets the coach selected', () => {
    expect(frontIdentityStatus({ frontIdentity: 'wordmark', teamName: 'North Gate' }).ok).toBe(true);
    expect(frontIdentityStatus({ frontIdentity: 'logo', teamName: 'North Gate', logos: {} }).ok).toBe(false);
    expect(frontIdentityStatus({ frontIdentity: 'logo', logos: { chest: { src: 'logo.png' } } }).ok).toBe(true);
    expect(frontIdentityStatus({ frontIdentity: 'both', teamName: 'North Gate', logos: { chest: { src: 'logo.png' } } }).ok).toBe(true);
    expect(frontIdentityStatus({ frontIdentity: 'both', teamName: 'North Gate', logos: {} }).ok).toBe(false);
    expect(frontIdentityStatus({ frontIdentity: 'none', teamName: 'North Gate' }).ok).toBe(false);
  });
});
