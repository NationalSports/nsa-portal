import { cleanZone, DEFAULT_ZONE } from '../designSpec';

describe('custom print patterns', () => {
  test('accepts an approved local pattern and preserves duotone editing', () => {
    const zone = cleanZone({
      pattern: 'custom',
      patternImage: '/uniform/patterns/hex-flow-test.png',
      patternName: 'Hex Flow',
      patternTint: true,
      patternTintMode: 'duotone',
      color: '#7f1d1d',
      color2: '#ffffff',
      patternColor2: '#1f2a44',
    }, DEFAULT_ZONE);

    expect(zone).toMatchObject({
      pattern: 'custom',
      patternImage: '/uniform/patterns/hex-flow-test.png',
      patternName: 'Hex Flow',
      patternTint: true,
      patternTintMode: 'duotone',
      color: '#7f1d1d',
      color2: '#ffffff',
      patternColor2: '#1f2a44',
    });
  });

  test('still rejects unrelated local paths', () => {
    const zone = cleanZone({
      pattern: 'custom',
      patternImage: '/private/unapproved.png',
      patternTint: true,
      patternTintMode: 'duotone',
    }, DEFAULT_ZONE);

    expect(zone.patternImage).toBeUndefined();
    expect(zone.pattern).not.toBe('custom');
  });
});
