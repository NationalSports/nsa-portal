/** @jest-environment node */

const { _test } = require('../../../netlify/functions/uniform-ai-concept');
const { _test: designTest } = require('../../../netlify/functions/uniform-ai-design');
const { validJobId } = require('../../../netlify/functions/uniform-ai-concept-store');

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

    expect(prompt).toContain('exact physical template');
    expect(prompt).toContain('Show coordinated Side A and Side B');
    expect(prompt).toContain('NORTH GATE');
    expect(prompt).toContain('approximately 4" tall on the front and 8" tall on the back');
    expect(prompt).toContain('Do not add a player name');
    expect(prompt).toContain('#111111, #F97316');
    expect(prompt).toContain('Black and orange paint splatter');
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

  test('only unguessable UUID job ids can be polled', () => {
    expect(validJobId('252fd472-1f06-4db7-9c41-7f1182fd429a')).toBe('252fd472-1f06-4db7-9c41-7f1182fd429a');
    expect(validJobId('../another-job')).toBe('');
    expect(validJobId('concept-1')).toBe('');
  });

});
