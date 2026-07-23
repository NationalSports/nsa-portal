// The bundled pre-portal NetSuite PO lookup (src/netsuiteOldPos.js) is generated from a
// NetSuite "all purchase orders" saved-search export. It's the confirmation layer that lets
// the Sports Inc triage call a format-ambiguous bill "old system" with certainty instead of
// guessing. These tests lock in that the set loaded and the helper behaves.
const { NETSUITE_OLD_PO_CORES, isPrePortalNetsuitePo } = require('../netsuiteOldPos');

describe('netsuiteOldPos', () => {
  test('loaded a non-trivial set of distinct PO cores', () => {
    expect(NETSUITE_OLD_PO_CORES.size).toBeGreaterThan(3000);
  });

  test('recognizes a known pre-portal NetSuite PO core', () => {
    // 3611 appears in the export (PO3611 NSA, Adidas) and is NOT a portal PO core.
    expect(isPrePortalNetsuitePo('3611')).toBe(true);
  });

  test('tolerates numeric input and whitespace', () => {
    expect(isPrePortalNetsuitePo(3611)).toBe(true);
    expect(isPrePortalNetsuitePo(' 3611 ')).toBe(true);
  });

  test('does not match a bogus / empty core', () => {
    expect(isPrePortalNetsuitePo('999999999')).toBe(false);
    expect(isPrePortalNetsuitePo('')).toBe(false);
    expect(isPrePortalNetsuitePo(null)).toBe(false);
    expect(isPrePortalNetsuitePo(undefined)).toBe(false);
  });

  // CHARACTERIZATION — pins current behavior, not a spec. The set stores '033126' as a literal
  // string (from the raw NetSuite export), and isPrePortalNetsuitePo does a straight Set.has()
  // with no numeric normalization. So the exact stored form matches, but a numerically-equal
  // value with the leading zero stripped does NOT — a future "normalize to a number/strip
  // leading zeros" refactor would silently break this lookup for core 033126.
  test('CHARACTERIZATION: leading-zero core matches only in its exact stored string form', () => {
    expect(isPrePortalNetsuitePo('033126')).toBe(true);
    expect(isPrePortalNetsuitePo('33126')).toBe(false); // numerically identical, but not stored this way
  });
});
