/**
 * Production-art routing (customer page Artwork tab).
 *
 * Drag-and-drop ignores an <input accept> entirely, so seps dropped on the Mockup zone were being
 * filed as mockup_files — where no production gate and no job sheet ever looked for them. The
 * customer-page upload now routes by what the file IS. This pins that rule: vector/stitch files are
 * always production art, and the ambiguous proof formats stay with whichever zone the rep chose.
 */
const { isProdArtFile } = require('../constants');

describe('isProdArtFile', () => {
  test.each(['seps.ai', 'LOGO.AI', 'left-chest.dst', 'cap.DST', 'vector.eps', 'stitch.emb', 'run.exp'])(
    'routes %s to production art', (name) => {
      expect(isProdArtFile(name)).toBe(true);
    });

  // Deliberately NOT production-only: a PDF/PNG/JPG is just as often a proof as a sep, so the zone
  // the rep dropped it on stays authoritative.
  test.each(['proof.pdf', 'mock.png', 'photo.jpg', 'front.jpeg', 'art.webp'])(
    'leaves %s to the zone it was dropped on', (name) => {
      expect(isProdArtFile(name)).toBe(false);
    });

  test('reads a file record or a bare URL, not just a name', () => {
    expect(isProdArtFile({ name: 'seps.ai' })).toBe(true);
    expect(isProdArtFile('https://res.cloudinary.com/x/raw/upload/v1/nsa-production/stitch.dst')).toBe(true);
    expect(isProdArtFile({ url: 'https://res.cloudinary.com/x/image/upload/v1/mock.png' })).toBe(false);
  });

  test('matches only on the extension, never on the name containing it', () => {
    expect(isProdArtFile('ai-generated-mock.png')).toBe(false);
    expect(isProdArtFile('dst-folder/proof.pdf')).toBe(false);
  });

  test('is safe on empty / missing input', () => {
    expect(isProdArtFile('')).toBe(false);
    expect(isProdArtFile(null)).toBe(false);
    expect(isProdArtFile(undefined)).toBe(false);
    expect(isProdArtFile({})).toBe(false);
  });
});
