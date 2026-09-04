/* eslint-disable */
/**
 * SO-1468 regression — one supplier bill applied twice compounded billed qty and _bill_cost.
 *
 * Symptom on SO-1468 (Orange Lutheran G Tennis, PO 6500 OLuTNG):
 *   adidas invoice 6165918295 shipped KF0972 x31 ($697.50) and JX4499 x31 ($348.75).
 *   The SO recorded billed {L:6,M:10,S:46} and {L:6,M:10,S:40,XS:6} — exactly 62 units each —
 *   with the identical _bill_details entry (same doc, date, sizes, tracking, cost) present twice.
 *
 * Root cause: `_applyFreightToSOs` in App.js appends to `billed` and `_bill_details`
 * unconditionally. Its two sibling apply paths in the same file already called
 * `duplicateBillDetail` before writing; this one never did, so a second application of the
 * same shipment doubled the line instead of being skipped.
 *
 * Scope at the time of the fix: 129 duplicate groups across 43 live orders / 117 PO lines,
 * $22,876.88 of duplicated vendor cost — which feeds the order cost rollup (App.js `soCost`),
 * so job costing and margin were overstated on every one of them.
 *
 * The apply paths live inside App.js's component closure and cannot be imported, so this
 * regression is enforced at the source level: every append to a *garment* PO line's
 * _bill_details must be preceded by the duplicate guard. Deco-PO appends (`dp._bill_details`)
 * are deliberately out of scope — those details carry no size breakdown, so the guard has
 * nothing to discriminate on there, and no duplicate deco cost was observed.
 */
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');

// An append (spread of the existing array) onto a garment PO line's bill details.
// `po` and `pl` are the two names App.js uses for a so_item_po_lines entry.
const APPEND_RE = /_bill_details:\[\.\.\.\((po|pl)\._bill_details/g;

// How far back to look for the guard. The guard sits at the top of the same
// `.map(po=>{ ... })` callback, but the body between them grows, so this window is
// bounded on both sides:
//   lower — must exceed the widest real guard→append gap (currently 40 lines, at the
//           third site, where the overage qty-fix and price-sync blocks sit between).
//   upper — must stay well under the distance from an append back to the *previous*
//           site's guard (currently 123 lines), or a neighbouring block's guard would
//           satisfy the assertion and the test would pass while unguarded.
// 60 sits clear of both. If a future change pushes a real gap past this, widen the
// window — do not delete the site from the regex.
const LOOKBACK_LINES = 60;

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

const appendSites = () => {
  const out = [];
  let m;
  APPEND_RE.lastIndex = 0;
  while ((m = APPEND_RE.exec(APP)) !== null) out.push({ index: m.index, line: lineOf(APP, m.index), name: m[1] });
  return out;
};

describe('supplier-bill apply paths (App.js)', () => {
  const sites = appendSites();

  it('still has the garment PO-line bill-detail appends this test is guarding', () => {
    // A drop to zero would silently pass every assertion below.
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  it.each(sites.map((s) => [s.line, s.name, s.index]))(
    'App.js:%d — %s._bill_details append is preceded by duplicateBillDetail',
    (line, _name, index) => {
      const lines = APP.slice(0, index).split('\n');
      const window = lines.slice(Math.max(0, lines.length - LOOKBACK_LINES)).join('\n');
      expect(window).toContain('duplicateBillDetail(');
    }
  );

  it('imports the shared guard rather than reimplementing it', () => {
    expect(APP).toMatch(/import\s*\{[^}]*duplicateBillDetail[^}]*\}\s*from\s*'\.\/lib\/billAnomalies'/);
  });

  it('treats a portal-ledger duplicate as an already-applied QBO backfill', () => {
    expect(APP).toContain('const portalWasAlreadyApplied=portalBillAlreadyApplied(bill,_docAlreadyApplied)');
    expect(APP).toContain("b.portalMsg=portalWasAlreadyApplied?'Already applied to Portal; QBO backfill verified':'Applied to Portal after QBO verification'");
    expect(APP).toContain('if(portalApplied&&!portalWasAlreadyApplied&&_billHasTarget(bill))');
  });
});

describe('duplicateBillDetail against the real SO-1468 shape', () => {
  const { duplicateBillDetail } = require('../lib/billAnomalies');

  // Verbatim from so_item_po_lines._bill_details on SO-1468 after the double-apply.
  const kf0972 = { doc: '6165918295', cost: 697.5, date: '07/28/2026', sizes: { L: 3, M: 5, S: 23 }, tracking: '536507832927' };
  const jx4499 = { doc: '6165918295', cost: 348.75, date: '07/28/2026', sizes: { L: 3, M: 5, S: 20, XS: 3 }, tracking: '536507832927' };

  it('recognises the second application of each line as a duplicate', () => {
    expect(duplicateBillDetail([kf0972], { ...kf0972 })).toBe(kf0972);
    expect(duplicateBillDetail([jx4499], { ...jx4499 })).toBe(jx4499);
  });

  it('does not confuse the two lines — same doc and tracking, different size breakdown', () => {
    // Both lines shipped on one tracking number; only the sizes tell them apart. Treating
    // them as duplicates of each other would drop a genuine line off the bill.
    expect(duplicateBillDetail([kf0972], jx4499)).toBeNull();
    expect(duplicateBillDetail([jx4499], kf0972)).toBeNull();
  });

  it('still admits a later shipment of different sizes on the same PO', () => {
    const restock = { doc: '6165999999', cost: 33.74, date: '08/04/2026', sizes: { XL: 2 }, tracking: '536507999999' };
    expect(duplicateBillDetail([kf0972, jx4499], restock)).toBeNull();
  });
});
