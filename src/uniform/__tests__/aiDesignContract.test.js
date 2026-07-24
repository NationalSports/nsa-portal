/** @jest-environment node */

const { _test } = require('../../../netlify/functions/uniform-ai-design');

describe('guided AI design contract', () => {
  test('carries coordinated reversible zones to the client', () => {
    const spec = _test.toClientSpec('basketball_4r3chb', {
      zones: {
        body: { color: '#111111', secondaryColor: '#ff6600', pattern: 'splatter' },
      },
      reverseZones: {
        body: { color: '#ffffff', secondaryColor: '#111111', pattern: 'splatter' },
      },
    }, { originalMode: true });

    expect(spec.zones.body).toMatchObject({ color: '#111111', color2: '#ff6600', pattern: 'splatter' });
    expect(spec.reverseZones.body).toMatchObject({ color: '#ffffff', color2: '#111111', pattern: 'splatter' });
  });

  test('original mode rejects saved vendor print substitutions', () => {
    const spec = _test.toClientSpec('basketball_4r3chb', {
      zones: {
        body: {
          color: '#111111',
          secondaryColor: '#eaff00',
          pattern: 'splatter',
          printPattern: 'Hex Flow',
        },
      },
    }, { originalMode: true });

    expect(spec.zones.body.pattern).toBe('splatter');
    expect(spec.zones.body.printPattern).toBeUndefined();
  });

  test('keeps requested italic number treatment', () => {
    const spec = _test.toClientSpec('basketball_4r3chb', {
      zones: { body: { color: '#111111' } },
      text: {
        front: { number: { value: '23', fill: '#eaff00', outline: '#111827', italic: true } },
        back: { number: { value: '23', fill: '#eaff00', outline: '#111827', italic: true } },
      },
    }, { originalMode: true });

    expect(spec.text.front.number).toMatchObject({ fill: '#eaff00', outline: '#111827', italic: true });
    expect(spec.text.back.number.italic).toBe(true);
  });

  test('parses Kimi structured output without Markdown leakage', () => {
    expect(_test.parseJsonContent('```json\n{"designs":[{"zones":{}}]}\n```')).toEqual({
      designs: [{ zones: {} }],
    });
    expect(_test.parseJsonContent('not json')).toBeNull();
  });
});
