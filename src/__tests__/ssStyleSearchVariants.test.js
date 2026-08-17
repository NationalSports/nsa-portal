// Unit tests for ssStyleSearchVariants (src/lib/vendorColorMatch.js) — the ordered list of
// style codes ssResolveSkus searches S&S for when turning our order lines into S&S SKUs.
//
// Real failure this locks in (batch NSA 4568): SanMar prefixes brand codes on our styles —
// Bella+Canvas "BC3945", Next Level "NL3600"/"NL1510"/"NL6733" — while S&S catalogs the bare
// manufacturer number ("3945", "3600", ...). Searching S&S for the prefixed code finds no
// style, so those lines showed "⚠ missing" and blocked the order. The bare-number fallback
// (strict) recovers them; adidas-style codes (AT204, A515) have no prefix and are unaffected.
const { ssStyleSearchVariants } = require('../lib/vendorColorMatch');

describe('ssStyleSearchVariants', () => {
  test('a bare/adidas style is searched as-is, no looser fallback', () => {
    expect(ssStyleSearchVariants('A515')).toEqual([
      { code: 'A515', strict: false },
      { code: '515', strict: true }, // 1-letter prefix strip is offered, but only as a strict fallback
    ]);
  });

  test('SanMar brand prefixes fall back to the bare S&S style number (strict), pinned to the brand', () => {
    expect(ssStyleSearchVariants('BC3945')).toEqual([
      { code: 'BC3945', strict: false },
      { code: '3945', strict: true, brand: 'Bella' },
    ]);
    expect(ssStyleSearchVariants('NL3600')).toEqual([
      { code: 'NL3600', strict: false },
      { code: '3600', strict: true, brand: 'Next Level' },
    ]);
    expect(ssStyleSearchVariants('NL1510')).toEqual([
      { code: 'NL1510', strict: false },
      { code: '1510', strict: true, brand: 'Next Level' },
    ]);
    // NL1580 is the case that broke: "1580" alone is shared with another brand, so the brand
    // pin ("Next Level") is what makes it resolve to S&S's crop top instead of the wrong style.
    expect(ssStyleSearchVariants('NL1580')).toEqual([
      { code: 'NL1580', strict: false },
      { code: '1580', strict: true, brand: 'Next Level' },
    ]);
    // An unmapped prefix ("BY") still strips, but carries no brand — the resolver then requires
    // the bare number to be unambiguous on S&S before using it.
    expect(ssStyleSearchVariants('BY6624')).toEqual([
      { code: 'BY6624', strict: false },
      { code: '6624', strict: true },
    ]);
  });

  test('a numeric color suffix searches the base style first (synced sku fast path)', () => {
    expect(ssStyleSearchVariants('AT300-50')).toEqual([
      { code: 'AT300', strict: false },
      { code: 'AT300-50', strict: false },
    ]);
  });

  test('a non-numeric dash suffix keeps the as-is code first', () => {
    expect(ssStyleSearchVariants('PC54-P')).toEqual([
      { code: 'PC54-P', strict: false },
      { code: 'PC54', strict: false },
    ]);
  });

  test('normalizes case/whitespace and dedupes', () => {
    expect(ssStyleSearchVariants('  nl3600 ')).toEqual([
      { code: 'NL3600', strict: false },
      { code: '3600', strict: true, brand: 'Next Level' },
    ]);
  });

  test('an already-bare number produces a single search (no duplicate prefix strip)', () => {
    expect(ssStyleSearchVariants('3600')).toEqual([{ code: '3600', strict: false }]);
  });

  test('empty/nullish styles produce no searches', () => {
    expect(ssStyleSearchVariants('')).toEqual([]);
    expect(ssStyleSearchVariants(null)).toEqual([]);
    expect(ssStyleSearchVariants(undefined)).toEqual([]);
  });
});
