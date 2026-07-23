import { DEFAULT_PRESETS } from '../builderSettings';
import { getTemplate } from '../templates';

describe('228125 reversible basketball system', () => {
  test('ships both independently editable faces in the basketball gallery', () => {
    const preset = DEFAULT_PRESETS.find((item) => item.id === 'BB-4R3CHB');

    expect(preset).toMatchObject({
      sports: ['basketball'],
      config: { neckStyle: 'basketball4r3chb' },
    });
    expect(preset.config.sections.body.color).not.toBe(preset.config.reverseSections.body.color);
    expect(preset.config.reverseSections).toEqual(expect.objectContaining({
      body: expect.any(Object),
      sleeves: expect.any(Object),
      collar: expect.any(Object),
    }));
  });

  test('ships every extracted 228125 design line as an editable basketball preset', () => {
    const designs = DEFAULT_PRESETS.filter((item) => item.id.startsWith('BB-4R3CHB-'));
    expect(designs).toHaveLength(34);
    expect(designs.every((item) => item.config.sections.body.patternTintMode === 'atlas')).toBe(true);
    expect(designs.every((item) => item.config.sections.body.patternImage.startsWith('/uniform/designs/228125/'))).toBe(true);
    expect(designs.every((item) => item.config.reverseSections.body.patternImage === item.config.sections.body.patternImage)).toBe(true);
  });

  test('uses the extracted reversible shorts asset with its native atlas orientation', () => {
    expect(getTemplate('basketball_4r3chb_shorts')).toMatchObject({
      model3d: '/uniform/4R3CHB-full.glb',
      reversible: true,
      atlasFlipY: false,
    });
  });
});
