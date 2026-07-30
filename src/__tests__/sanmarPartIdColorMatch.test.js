// REGRESSION — SanMar Part ID (Unique_Key) resolution: safe fuzzy color fallback.
//
// Orders built off an S&S (or other) feed carry a fuller color spelling than SanMar lists
// — e.g. Gildan 18500 "Forest Green" on the order vs SanMar's "Forest". _smNorm already
// ignores spacing, so the exact match only misses on a whole extra word. The resolver's
// fuzzy fallback assigns a Part ID ONLY when the SanMar color's words are a SUBSET of the
// order color's AND exactly one Unique_Key qualifies at that size — so it never grabs a
// more-specific colorway or guesses between two. These pin that boundary.

import { smColorSubset } from '../lib/vendorColorMatch';

describe('smColorSubset — SanMar color is a shorter spelling of the order color', () => {
  test('SanMar "Forest" matches an order "Forest Green" (extra qualifier stripped)', () => {
    expect(smColorSubset('Forest', 'Forest Green')).toBe(true);
  });
  test('exact same color matches', () => {
    expect(smColorSubset('Forest Green', 'Forest Green')).toBe(true);
    expect(smColorSubset('Charcoal', 'Charcoal')).toBe(true);
  });
  test('word order / spacing / punctuation do not matter', () => {
    expect(smColorSubset('DARK GREEN', 'Green Dark')).toBe(true);
    expect(smColorSubset('Heather-Navy', 'Heather Navy')).toBe(true);
  });
});

describe('smColorSubset — never lets a generic order color grab a specific SanMar colorway', () => {
  test('order "Green" does NOT match SanMar "Forest Green"', () => {
    expect(smColorSubset('Forest Green', 'Green')).toBe(false);
  });
  test('order "Navy" does NOT match SanMar "True Navy"', () => {
    expect(smColorSubset('True Navy', 'Navy')).toBe(false);
  });
  test('unrelated colors never match', () => {
    expect(smColorSubset('Royal', 'Forest Green')).toBe(false);
    expect(smColorSubset('Forest', 'Charcoal')).toBe(false);
  });
  test('empty/blank colors never match (no accidental catch-all)', () => {
    expect(smColorSubset('', 'Forest Green')).toBe(false);
    expect(smColorSubset('Forest', '')).toBe(false);
    expect(smColorSubset('', '')).toBe(false);
  });
});

// The resolver only assigns when the subset rule yields exactly ONE Unique_Key at the size.
// This documents that the guard lives in the resolver, not the predicate: the predicate can
// legitimately return true for two SanMar variants (e.g. "Forest" and "Green" both subsets of
// "Forest Green"), and when it does the resolver treats the line as ambiguous and leaves it
// blank rather than picking one.
describe('smColorSubset — ambiguity is possible by design (resolver breaks the tie by leaving blank)', () => {
  test('both "Forest" and "Green" are subsets of "Forest Green"', () => {
    expect(smColorSubset('Forest', 'Forest Green')).toBe(true);
    expect(smColorSubset('Green', 'Forest Green')).toBe(true);
  });
});
