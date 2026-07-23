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

  test('preserves an approved full-garment SVG atlas mode', () => {
    const zone = cleanZone({
      pattern: 'custom',
      patternImage: '/uniform/patterns/flag-228187/huddle-atlas.png',
      patternName: 'Huddle',
      patternTint: true,
      patternTintMode: 'atlas',
      patternColorCount: 5,
      color: '#1f2a44',
      color2: '#c8102e',
      color3: '#ffffff',
      color4: '#0b6e4f',
      color5: '#16246e',
    }, DEFAULT_ZONE);

    expect(zone).toMatchObject({
      pattern: 'custom',
      patternImage: '/uniform/patterns/flag-228187/huddle-atlas.png',
      patternName: 'Huddle',
      patternTint: true,
      patternTintMode: 'atlas',
      patternColorCount: 5,
      color5: '#16246e',
    });
  });

  test('preserves a versioned design atlas used by an approved garment', () => {
    const zone = cleanZone({
      pattern: 'custom',
      patternImage: '/uniform/designs/ayson/design-atlas.png?v=4',
      patternName: 'AYSONSA Layout',
      patternTint: true,
      patternTintMode: 'atlas',
      patternColorCount: 5,
    }, DEFAULT_ZONE);

    expect(zone).toMatchObject({
      pattern: 'custom',
      patternImage: '/uniform/designs/ayson/design-atlas.png?v=4',
      patternTintMode: 'atlas',
      patternColorCount: 5,
    });
  });
});
