/** @jest-environment node */

const { _test } = require('../../../netlify/functions/uniform-ai-concept');
const { _test: designTest } = require('../../../netlify/functions/uniform-ai-design');

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('guided AI concept contract', () => {
  test('builds a garment-grounded prompt with locked production rules', () => {
    const prompt = _test.buildConceptPrompt({
      prompt: 'Black and orange paint splatter with italic block numbers',
      context: {
        sport: 'basketball',
        program: 'mens',
        teamColors: ['#111111', '#F97316', 'not-a-color'],
        reversible: true,
        lockedRules: {
          teamName: 'NORTH GATE',
          frontIdentity: 'wordmark',
          playerNamesEnabled: false,
          frontNumberInches: 4,
          backNumberInches: 8,
        },
      },
    });

    expect(prompt).toContain('exact blank garment');
    expect(prompt).toContain('This is reversible; coordinate two distinct faces');
    expect(prompt).toContain('NORTH GATE');
    expect(prompt).toContain('Front number height: 4 inches. Back number height: 8 inches');
    expect(prompt).toContain('Do not add a player name');
    expect(prompt).toContain('#111111, #F97316');
    expect(prompt).toContain('Black and orange paint splatter');
    expect(prompt).toContain('Return valid JSON only');
  });

  test('accepts supported image data URLs and rejects unsafe payloads', () => {
    const parsed = _test.parseImageDataUrl(ONE_PIXEL_PNG);
    expect(parsed.mediaType).toBe('image/png');
    expect(parsed.bytes.length).toBeGreaterThan(0);
    expect(_test.parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(_test.parseImageDataUrl('https://example.com/image.png')).toBeNull();
  });

  test('the production mapper accepts a selected concept image', () => {
    const parsed = designTest.parseConceptImage(ONE_PIXEL_PNG);
    expect(parsed.mediaType).toBe('image/png');
    expect(parsed.data.length).toBeGreaterThan(10);
    expect(designTest.parseConceptImage('not-an-image')).toBeNull();
  });

  test('renders Kimi directions as safe displayable SVG concept boards', () => {
    const direction = _test.normalizeConcept({
      name: 'Solar Strike',
      bodyColor: '#111111',
      secondaryColor: '#F97316',
      accentColor: '#FFFFFF',
      accentColor2: '#334155',
      motif: 'splatter',
      layout: 'allover',
      numberFill: '#FFFFFF',
      numberOutline: '#111111',
      typography: 'italic athletic block',
    }, 0, []);
    const image = _test.renderConceptSvg(direction, {
      sport: 'basketball',
      reversible: true,
      lockedRules: { teamName: 'NORTH GATE', frontIdentity: 'wordmark' },
    }, 0);
    expect(image).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(image.split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('NORTH GATE');
    expect(svg).toContain('#F97316');
    expect(svg).not.toMatch(/<script|onload=/i);
  });
});
