/* Explicit art mutation intent must survive optimistic conflict merging without broadening a scoped delete. */
import { markArtChanges, markArtFieldEdit } from '../safeHelpers';

describe('art mutation intent tombstones', () => {
  test('a scoped mock removal records only the affected garment key', () => {
    const shared = { url: 'https://x/mock.png' };
    const before = [{
      id: 'a1', mockup_files: [shared],
      item_mockups: { 'TEE|Red': [shared], 'TEE|Blue': [shared] },
    }];
    const after = [{
      ...before[0], mockup_files: [],
      item_mockups: { 'TEE|Red': [], 'TEE|Blue': [shared] },
    }];
    const tracked = markArtChanges(before, after)[0];
    expect(tracked._artDeletes.mockup_files).toEqual(['https://x/mock.png']);
    expect(tracked._artDeletes.item_mockups).toEqual({ 'TEE|Red': ['https://x/mock.png'] });
  });

  test('unlink and preview replacement are stamped as explicit edits', () => {
    let art = { id: 'a1', mock_links: { red: 'blue' }, preview_url: 'old.png' };
    art = markArtFieldEdit(art, 'mock_links', {});
    art = markArtFieldEdit(art, 'preview_url', 'new.png');
    expect(art._artDeletes.mock_links).toEqual(['red']);
    expect(art._artEditedFields).toEqual(expect.arrayContaining(['mock_links', 'preview_url']));
  });

  test('undoing a removal before save clears its tombstone', () => {
    const file = { url: 'proof.png' };
    let art = markArtFieldEdit({ id: 'a1', prod_files: [file] }, 'prod_files', []);
    expect(art._artDeletes.prod_files).toEqual(['proof.png']);
    art = markArtFieldEdit(art, 'prod_files', [file]);
    expect(art._artDeletes).toBeUndefined();
  });
});
