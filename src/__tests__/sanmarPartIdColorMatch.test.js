// REGRESSION — SanMar Part ID (Unique_Key) resolution: safe fuzzy color fallback.
//
// Orders built off an S&S (or other) feed carry a fuller color spelling than SanMar lists
// — e.g. Gildan 18500 "Forest Green" on the order vs SanMar's "Forest". _smNorm already
// ignores spacing, so the exact match only misses on a whole extra word. The resolver's
// fuzzy fallback assigns a Part ID ONLY when the SanMar color's words are a SUBSET of the
// order color's AND exactly one Unique_Key qualifies at that size — so it never grabs a
// more-specific colorway or guesses between two. These pin that boundary.

import { smColorSubset, smSizeMatch } from '../lib/vendorColorMatch';

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

// Real fixture: SanMar's STC21 (Sport-Tek Pom Pom Team Beanie) colorways as returned by the
// product API, verbatim from NSA 4566's "What SanMar lists" panel. The order line is
// "Forest Green/Black/White". SanMar abbreviates it to "For Grn/Blk/Wht"; exactly one of the
// nine candidates may match, so the resolver's single-Unique_Key rule resolves it.
describe('smColorSubset — SanMar abbreviated compound colorway (STC21 real fixture)', () => {
  const ORDER = 'Forest Green/Black/White';
  const SANMAR_STC21 = [
    'For Grn/Blk/Wht',   // <- the match
    'Maroon/Blk/Wht',
    'Purple/Blk/Wht',
    'Tr Navy/Gld/Wh',
    'Tr Red/Blk/Wht',
    'Tr Red/Roy/Wht',
    'Tr Roy/Blk/Wht',
    'IronGy/Blk/Wht',
    'PnkRsp/Gry/Wht',
  ];

  test('"For Grn/Blk/Wht" matches "Forest Green/Black/White"', () => {
    expect(smColorSubset('For Grn/Blk/Wht', ORDER)).toBe(true);
  });

  test('EXACTLY ONE of the nine SanMar candidates matches (resolver resolves it uniquely)', () => {
    const hits = SANMAR_STC21.filter((c) => smColorSubset(c, ORDER));
    expect(hits).toEqual(['For Grn/Blk/Wht']);
  });
});

// Real fixture: S&S BY6624's pattern colorways as returned by the product API, verbatim from
// batch NSA 4568's "What S&S lists" panel. The order line abbreviates "Plaid" to "Pl"
// ("Green/White Pl"); the COLOR_ABBREV expansion (PL→PLAID) lets exactly one of the twelve
// S&S candidates match, so ssResolveSkus's single-sku rule resolves it — and the other five
// plaids stay out of the match, so it can never grab the wrong pattern.
describe('smColorSubset — abbreviated pattern name (S&S BY6624 "Green/White Pl" real fixture)', () => {
  const ORDER = 'Green/White Pl';
  const SS_BY6624 = [
    'Black/ Gold', 'Black/ White', 'Green/ White Plaid', 'Navy/ Columbia Plaid',
    'Navy/ Gold', 'Navy/ Silver Plaid', 'Purple/ White Plaid', 'Red/ Black Buffalo',
    'Red/ White', 'Royal/ Silver Plaid', 'Scottish Tartan Plaid', 'Varsity Maroon Oxford Plaid',
  ];
  test('"Pl" expands to "Plaid" so "Green/ White Plaid" matches "Green/White Pl"', () => {
    expect(smColorSubset('Green/ White Plaid', ORDER)).toBe(true);
  });
  test('EXACTLY ONE of the twelve S&S candidates matches (resolved uniquely)', () => {
    const hits = SS_BY6624.filter((c) => smColorSubset(c, ORDER));
    expect(hits).toEqual(['Green/ White Plaid']);
  });
  test('another green+white line does NOT grab the plaid, nor vice versa', () => {
    expect(smColorSubset('Green/ White Plaid', 'Green/White')).toBe(false); // plaid is more specific
    expect(smColorSubset('Black/ White', ORDER)).toBe(false);                // black ∉ green/white/plaid
  });
});

// smSizeMatch takes ALREADY-normalized tokens (the resolver runs _smSizeNorm first). YS/S etc.
// are what normSzName yields for "YS"/"S"; these pin the youth→bare fallback for 18500B.
describe('smSizeMatch — youth order size matches a bare catalog size (18500B "YS" ↔ SanMar "S")', () => {
  test('exact tokens match', () => {
    expect(smSizeMatch('S', 'S')).toBe(true);
    expect(smSizeMatch('2XL', '2XL')).toBe(true);
    expect(smSizeMatch('YS', 'YS')).toBe(true);
  });
  test('youth order size matches its bare catalog equivalent', () => {
    expect(smSizeMatch('YS', 'S')).toBe(true);
    expect(smSizeMatch('YM', 'M')).toBe(true);
    expect(smSizeMatch('YL', 'L')).toBe(true);
    expect(smSizeMatch('YXL', 'XL')).toBe(true);
    expect(smSizeMatch('YXS', 'XS')).toBe(true);
  });
  test('NEVER the reverse — an adult order size must not match a youth catalog size', () => {
    expect(smSizeMatch('S', 'YS')).toBe(false);
    expect(smSizeMatch('L', 'YL')).toBe(false);
  });
  test('different sizes never match', () => {
    expect(smSizeMatch('S', 'M')).toBe(false);
    expect(smSizeMatch('YS', 'M')).toBe(false);
    expect(smSizeMatch('YS', 'XS')).toBe(false);
  });
  test('blank tokens never match', () => {
    expect(smSizeMatch('', 'S')).toBe(false);
    expect(smSizeMatch('S', '')).toBe(false);
  });
});
