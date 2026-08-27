import { DEFAULT_PRESETS, MOMENTEC_4R3CHA_DESIGNS } from '../builderSettings';
import { getMomentecProduct, MOMENTEC_CATALOG, MOMENTEC_STYLE_IDS } from '../momentecCatalog';
import { getTemplate } from '../templates';

describe('Momentec garment catalog', () => {
  test('registers every delivered model once', () => {
    expect(MOMENTEC_CATALOG).toHaveLength(50);
    expect(new Set(MOMENTEC_STYLE_IDS).size).toBe(MOMENTEC_STYLE_IDS.length);
    expect(MOMENTEC_CATALOG.every((item) => item.modelReady)).toBe(true);
    expect(MOMENTEC_CATALOG.filter((item) => item.atlasReady).map((item) => item.style)).toEqual(['4R3CHA']);
  });

  test('does not invent classifications for unidentified cuts', () => {
    const pending = getMomentecProduct('228137');
    expect(pending).toMatchObject({ classification: 'pending', sport: null, garment: null });
  });

  test('registers the verified adult Elite basketball kit', () => {
    expect(getMomentecProduct('4R3CHA')).toMatchObject({
      classification: 'verified', sport: 'basketball', garment: 'jersey', mates: ['4R3VTB', '4R6VTB'],
      atlasReady: true, atlasRoot: '/uniform/designs/4r3cha',
    });
    expect(MOMENTEC_4R3CHA_DESIGNS).toHaveLength(29);
    expect(MOMENTEC_4R3CHA_DESIGNS.every(([, , colors]) => colors >= 1 && colors <= 5)).toBe(true);
    expect(getTemplate('momentec_4r3cha').model3d).toContain('/uniform/catalog/momentec/models/4R3CHA.glb');
    expect(getTemplate('momentec_4r3vtb_shorts').model3d).toContain('/uniform/catalog/momentec/models/4R3VTB.glb');
    expect(DEFAULT_PRESETS.find((preset) => preset.id === 'BB-MOMENTEC-4R3CHA')).toMatchObject({
      sports: ['basketball'],
      config: {
        neckStyle: 'momentec4r3cha',
        sections: { body: { patternTintMode: 'atlas', patternImage: '/uniform/designs/4r3cha/all_star.svg' } },
      },
    });
  });
});
