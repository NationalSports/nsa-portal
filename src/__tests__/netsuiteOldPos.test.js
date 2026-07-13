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
});
