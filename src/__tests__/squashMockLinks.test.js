/* eslint-disable */
/**
 * NSA Portal — squashing near-identical garments onto ONE mockup (SO-1628 class)
 *
 * SO-1628 carried two near-identical white long sleeves (JX4482 White/Grey and AT104
 * White/ Team Grey Four) printed with the SAME left-chest design. The artist built a
 * separate mock for each, so the approval panel showed two almost-identical proofs and
 * the coach had to approve both. The fix is the existing mock_links mechanism, exposed in
 * two new places: a "squash" picker on an already-mocked card, and a garment checklist in
 * the art-request modal so the group is set BEFORE the artist starts and only one mock
 * ever gets built.
 *
 * Both write through applyMockLink / squashMockLinks. This pins the invariants those two
 * must hold: nothing is moved or deleted (unlink restores per-garment behavior exactly),
 * chains stay flat, and a group never grows a cycle.
 *
 * SAFE: pure functions from safeHelpers.js only. No DB, no UI, no network.
 */

const {
  applyMockLink,
  squashMockLinks,
  mockLinksOf,
  replaceMockLinkGroup,
  resolveMockLink,
  mockLinkDependents,
  mockLinkSourceFiles,
  skusMissingMockups,
} = require('../safeHelpers');

const JX = 'JX4482|White/Grey';
const AT = 'AT104|White/ Team Grey Four';
const JM = 'JM5286|Grey/White';

// The real SO-1628 art file: one design, one mock per garment.
const artFile = () => ({
  id: 'af1785687765691',
  name: 'VIKINGS Basketball Net',
  mock_links: {},
  item_mockups: {
    [JX]: [{ sku: 'JX4482', url: 'http://x/left-chest-01.jpg' }],
    [AT]: [{ sku: 'AT104', url: 'http://x/left-chest-02.jpg' }],
  },
});
const arts = () => [artFile()];

describe('applyMockLink — single link', () => {
  test('links AT104 to JX4482 without moving or deleting either mock', () => {
    const out = applyMockLink(arts(), 'af1785687765691', AT, JX);
    expect(mockLinksOf(out[0])).toEqual({ [AT]: JX });
    // The point of linking: nothing moves. Both buckets are byte-identical to before.
    expect(out[0].item_mockups).toEqual(artFile().item_mockups);
  });

  test('the linked garment resolves to the source and reads the source mock', () => {
    const out = applyMockLink(arts(), 'af1785687765691', AT, JX);
    expect(resolveMockLink(out, 'AT104', 'White/ Team Grey Four')).toBe(JX);
    expect(mockLinkSourceFiles(out, JX)[0].url).toBe('http://x/left-chest-01.jpg');
    expect(mockLinkDependents(out, 'JX4482', 'White/Grey')).toEqual([AT]);
  });

  test('unlink restores per-garment behavior exactly', () => {
    const linked = applyMockLink(arts(), 'af1785687765691', AT, JX);
    const out = applyMockLink(linked, 'af1785687765691', AT, null);
    expect(mockLinksOf(out[0])).toEqual({});
    expect(out[0].item_mockups).toEqual(artFile().item_mockups);
    expect(resolveMockLink(out, 'AT104', 'White/ Team Grey Four')).toBeNull();
  });

  test('no-op writes return the same array reference (callers can skip the save)', () => {
    const before = arts();
    expect(applyMockLink(before, 'af1785687765691', AT, AT)).toBe(before); // self-link
    expect(applyMockLink(before, null, AT, JX)).toBe(before);              // no art id
    expect(applyMockLink(before, 'nope', AT, JX)).toBe(before);            // unknown art id
    expect(applyMockLink(before, 'af1785687765691', AT, null)).toBe(before); // already unlinked
  });

  test('chains are flattened — linking to a linked garment stores its root', () => {
    let out = applyMockLink(arts(), 'af1785687765691', AT, JX);
    out = applyMockLink(out, 'af1785687765691', JM, AT);
    expect(mockLinksOf(out[0])).toEqual({ [AT]: JX, [JM]: JX });
  });

  test('re-pointing the source into its own dependent leaves a flat, cycle-free map', () => {
    // AT -> JX, then squash JX into AT. AT must become the source and JX its member.
    let out = applyMockLink(arts(), 'af1785687765691', AT, JX);
    out = applyMockLink(out, 'af1785687765691', JX, AT);
    const links = mockLinksOf(out[0]);
    expect(links).toEqual({ [JX]: AT });
    expect(resolveMockLink(out, 'JX4482', 'White/Grey')).toBe(AT);
    expect(resolveMockLink(out, 'AT104', 'White/ Team Grey Four')).toBeNull();
  });
});

describe('squashMockLinks — group write from the art-request modal', () => {
  test('first key is the source; every later key links to it in one write', () => {
    const out = squashMockLinks(arts(), 'af1785687765691', [JX, AT, JM]);
    expect(mockLinksOf(out[0])).toEqual({ [AT]: JX, [JM]: JX });
  });

  test('a group of one (or none) is a no-op', () => {
    const before = arts();
    expect(squashMockLinks(before, 'af1785687765691', [JX])).toBe(before);
    expect(squashMockLinks(before, 'af1785687765691', [])).toBe(before);
  });

  test('duplicate keys collapse instead of producing a self-link', () => {
    const out = squashMockLinks(arts(), 'af1785687765691', [JX, AT, JX]);
    expect(mockLinksOf(out[0])).toEqual({ [AT]: JX });
  });
});

describe('replaceMockLinkGroup — editable submit-to-art grouping', () => {
  test('replaces an older group and makes the newly selected first garment the source', () => {
    const before = squashMockLinks(arts(), 'af1785687765691', [JX, AT, JM]);
    const out = replaceMockLinkGroup(before, 'af1785687765691', [JX, AT, JM], [AT, JM]);
    expect(mockLinksOf(out[0])).toEqual({ [JM]: AT });
  });

  test('selecting fewer than two garments removes the old grouping', () => {
    const before = squashMockLinks(arts(), 'af1785687765691', [JX, AT, JM]);
    const out = replaceMockLinkGroup(before, 'af1785687765691', [JX, AT, JM], [JX]);
    expect(mockLinksOf(out[0])).toEqual({});
  });
});

describe('grouping upfront cannot wave an unmocked garment past approval', () => {
  // The art-request modal writes the links BEFORE any mock exists. The approval gate must
  // still hold the whole group until the SOURCE garment has a real mock — otherwise
  // grouping would be a way to skip the mockup entirely.
  const so = (artFiles) => ({
    art_files: artFiles,
    items: [
      { sku: 'JX4482', color: 'White/Grey', decorations: [{ kind: 'art', art_file_id: 'af1' }] },
      { sku: 'AT104', color: 'White/ Team Grey Four', decorations: [{ kind: 'art', art_file_id: 'af1' }] },
    ],
  });
  const job = { art_file_id: 'af1', items: [{ item_idx: 0 }, { item_idx: 1 }] };

  test('linked group with NO mock anywhere is still reported missing', () => {
    const af = [{ id: 'af1', mock_links: { [AT]: JX }, item_mockups: {} }];
    expect(skusMissingMockups(job, so(af))).toEqual(expect.arrayContaining(['JX4482', 'AT104']));
  });

  test('one mock on the source satisfies the whole group', () => {
    const af = [{ id: 'af1', mock_links: { [AT]: JX }, item_mockups: { [JX]: [{ url: 'http://x/one.jpg' }] } }];
    expect(skusMissingMockups(job, so(af))).toEqual([]);
  });

  test('a mock on the LINKED garment alone does not satisfy it — the source is the source of truth', () => {
    const af = [{ id: 'af1', mock_links: { [AT]: JX }, item_mockups: { [AT]: [{ url: 'http://x/two.jpg' }] } }];
    expect(skusMissingMockups(job, so(af))).toEqual(expect.arrayContaining(['JX4482', 'AT104']));
  });
});
