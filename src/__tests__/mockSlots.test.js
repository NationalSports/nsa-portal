/* eslint-disable */
/**
 * NSA Portal — reversible mockup slot tests
 *
 * SAFE: pure functions from safeHelpers.js only. No DB, no UI, no network.
 *
 * mockSlotKeys is the single source of truth for per-garment mockup slot keys —
 * the rep art-detail grid, the artist upload modal, and the send-for-approval gate
 * (skusMissingMockups) all consume it. These tests pin the key scheme (so uploads
 * never orphan) and the reversible slot enforcement in the approval gate.
 */

const { mockSlotKeys, skusMissingMockups, skusMissingRevColorWays } = require('../safeHelpers');

const BASE = 'JSY|Navy/White';

describe('mockSlotKeys — key scheme', () => {
  test('single non-reversible art deco → one primary slot on the bare base key', () => {
    const slots = mockSlotKeys(BASE, [{ kind: 'art', art_file_id: 'af1' }]);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ key: BASE, primary: true, kind: 'art', idx: 0, di: 0, side: '', reversible: false });
  });

  test('reversible art deco → Side A keeps the bare key, Side B keys off its color way', () => {
    const slots = mockSlotKeys(BASE, [{ kind: 'art', art_file_id: 'af1', reversible: true, color_way_id: 'cwA', color_way_id_b: 'cwB' }]);
    expect(slots.map(s => s.key)).toEqual([BASE, BASE + '|cwB']);
    expect(slots[0]).toMatchObject({ primary: true, side: 'A', reversible: true });
    expect(slots[1]).toMatchObject({ primary: false, side: 'B', reversible: true });
  });

  test('reversible art deco with no Side B color way falls back to a positional key', () => {
    const slots = mockSlotKeys(BASE, [{ kind: 'art', art_file_id: 'af1', reversible: true, color_way_id: 'cwA' }]);
    expect(slots.map(s => s.key)).toEqual([BASE, BASE + '|d0_1']);
  });

  test('second art deco keys off its color way (unchanged legacy scheme)', () => {
    const slots = mockSlotKeys(BASE, [
      { kind: 'art', art_file_id: 'af1', color_way_id: 'cwA' },
      { kind: 'art', art_file_id: 'af2', color_way_id: 'cwC' },
    ]);
    expect(slots.map(s => s.key)).toEqual([BASE, BASE + '|cwC']);
  });

  test('reversible numbers/names get _b suffixed Side B slots; non-reversible stay single', () => {
    const slots = mockSlotKeys(BASE, [
      { kind: 'numbers', reversible: true },
      { kind: 'numbers' },
      { kind: 'names', reversible: true },
    ]);
    expect(slots.map(s => s.key)).toEqual([
      BASE + '|numbers', BASE + '|numbers_b',
      BASE + '|numbers_1',
      BASE + '|names', BASE + '|names_b',
    ]);
  });

  test('accepts the enriched camelCase view models the mockup screens build', () => {
    const slots = mockSlotKeys(BASE, [{ kind: 'art', reversible: true, colorWayId: 'cwA', colorWayIdB: 'cwB' }]);
    expect(slots.map(s => s.key)).toEqual([BASE, BASE + '|cwB']);
  });

  test('di indexes the ORIGINAL decos array so jobs can scope slots via deco_idxs', () => {
    const slots = mockSlotKeys(BASE, [
      { kind: 'numbers', reversible: true },
      { kind: 'art', art_file_id: 'af1', reversible: true, color_way_id: 'cwA', color_way_id_b: 'cwB' },
    ]);
    expect(slots.filter(s => s.kind === 'numbers').every(s => s.di === 0)).toBe(true);
    expect(slots.filter(s => s.kind === 'art').every(s => s.di === 1)).toBe(true);
  });
});

// ─── Approval gate: reversible slots must all carry a mockup ───

const revCase = (item_mockups, { decoIdxs } = {}) => {
  const art = {
    id: 'af1',
    color_ways: [{ id: 'cwA', garment_color: 'Navy', inks: ['White'] }, { id: 'cwB', garment_color: 'White', inks: ['Navy'] }],
    item_mockups,
    mockup_files: [],
  };
  const so = {
    items: [{
      sku: 'JSY', color: 'Navy/White',
      decorations: [
        { kind: 'art', art_file_id: 'af1', reversible: true, color_way_id: 'cwA', color_way_id_b: 'cwB' },
        { kind: 'numbers', reversible: true },
      ],
    }],
    art_files: [art],
  };
  const job = {
    _art_ids: ['af1'], art_file_id: 'af1',
    items: [{ item_idx: 0, sku: 'JSY', color: 'Navy/White', ...(decoIdxs ? { deco_idxs: decoIdxs } : {}) }],
  };
  return { job, so };
};

describe('skusMissingMockups — reversible garments require every side mocked', () => {
  const mk = 'JSY|Navy/White';

  test('only Side A mocked → Side B art + both numbers sides reported missing', () => {
    const { job, so } = revCase({ [mk]: [{ url: 'http://x/sideA.png' }] });
    expect(skusMissingMockups(job, so)).toEqual(['JSY (art Side B, numbers Side A, numbers Side B)']);
  });

  test('all four slots mocked → nothing missing', () => {
    const { job, so } = revCase({
      [mk]: [{ url: 'http://x/a.png' }],
      [mk + '|cwB']: [{ url: 'http://x/b.png' }],
      [mk + '|numbers']: [{ url: 'http://x/n1.png' }],
      [mk + '|numbers_b']: [{ url: 'http://x/n2.png' }],
    });
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test('no primary mock at all → plain SKU missing (slot detail only once primary exists)', () => {
    const { job, so } = revCase({});
    expect(skusMissingMockups(job, so)).toEqual(['JSY']);
  });

  test('legacy general-bucket art (no per-item mocks) is left alone — no slot enforcement', () => {
    const { job, so } = revCase({});
    so.art_files[0].mockup_files = [{ url: 'http://x/legacy.png' }];
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test("POLICY: an embroidery sew-out proof in prod_files does NOT satisfy the gate — jobs require a real mockup", () => {
    // Reused library art arriving with only the sew-out (SO-1661): Approve / Send to
    // Coach must stay blocked until a real garment mockup is reused or made. The proof
    // remains a labeled display fallback (artProofFallback) but can't pass approval.
    const { job, so } = revCase({});
    so.art_files[0].deco_type = 'embroidery';
    job.deco_type = 'embroidery';
    so.art_files[0].prod_files = [{ url: 'http://x/sewout.pdf' }, { url: 'http://x/sewout.jpg' }];
    expect(skusMissingMockups(job, so)).toEqual(['JSY']);
  });

  test('a screen-print production proof satisfies the approval gate', () => {
    const { job, so } = revCase({});
    so.art_files[0].deco_type = 'screen_print';
    job.deco_type = 'screen_print';
    so.art_files[0].prod_files = [{ url: 'http://x/garment-proof.png' }];
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test('slots are scoped to the decos THIS job owns (deco_idxs)', () => {
    // Job owns only the art deco (idx 0) — the sibling numbers job's slots must not block it.
    const { job, so } = revCase({
      [mk]: [{ url: 'http://x/a.png' }],
      [mk + '|cwB']: [{ url: 'http://x/b.png' }],
    }, { decoIdxs: [0] });
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test('non-reversible garments keep the old per-garment behavior', () => {
    const art = { id: 'af1', item_mockups: { 'P1|Red': [{ url: 'http://x/p1.png' }] }, mockup_files: [] };
    const so = {
      items: [{ sku: 'P1', color: 'Red', decorations: [{ kind: 'art', art_file_id: 'af1' }, { kind: 'numbers' }] }],
      art_files: [art],
    };
    const job = { _art_ids: ['af1'], art_file_id: 'af1', items: [{ item_idx: 0, sku: 'P1', color: 'Red' }] };
    // numbers slot exists but is NOT reversible → not enforced (would block older in-flight jobs)
    expect(skusMissingMockups(job, so)).toEqual([]);
  });
});

// ─── Approval gate: reversible art decos must have BOTH color ways picked ───

describe('skusMissingRevColorWays — reversible decos require Side A + Side B color ways', () => {
  test('both sides picked and resolving → nothing missing', () => {
    const { job, so } = revCase({});
    expect(skusMissingRevColorWays(job, so)).toEqual([]);
  });

  test('no color ways defined on the art file → reported as needing 2 color ways (SO-1469)', () => {
    const { job, so } = revCase({});
    so.art_files[0].color_ways = [];
    so.art_files[0].name = 'Reversible Chest Logo';
    so.items[0].decorations[0].color_way_id = null;
    so.items[0].decorations[0].color_way_id_b = null;
    expect(skusMissingRevColorWays(job, so)).toEqual(['JSY ("Reversible Chest Logo" needs 2 color ways)']);
  });

  test('color ways defined but sides unpicked → Side A / Side B reported', () => {
    const { job, so } = revCase({});
    so.items[0].decorations[0].color_way_id = null;
    so.items[0].decorations[0].color_way_id_b = null;
    expect(skusMissingRevColorWays(job, so)).toEqual(['JSY (Side A CW, Side B CW)']);
  });

  test('a dangling color-way id (CW deleted from the art file) counts as unpicked', () => {
    const { job, so } = revCase({});
    so.items[0].decorations[0].color_way_id_b = 'cwGone';
    expect(skusMissingRevColorWays(job, so)).toEqual(['JSY (Side B CW)']);
  });

  test('non-reversible decos and reversible numbers are not gated', () => {
    const { job, so } = revCase({});
    so.items[0].decorations[0].reversible = false;
    so.items[0].decorations[0].color_way_id = null;
    so.items[0].decorations[0].color_way_id_b = null;
    expect(skusMissingRevColorWays(job, so)).toEqual([]);
  });

  test('DTF art is exempt — full-color print needs no color ways', () => {
    const { job, so } = revCase({});
    so.art_files[0].deco_type = 'dtf';
    so.art_files[0].color_ways = [];
    so.items[0].decorations[0].color_way_id = null;
    so.items[0].decorations[0].color_way_id_b = null;
    expect(skusMissingRevColorWays(job, so)).toEqual([]);
  });

  test('scoped to the decos THIS job owns (deco_idxs)', () => {
    // Job owns only the numbers deco (idx 1) — the art deco's missing CWs must not block it.
    const { job, so } = revCase({}, { decoIdxs: [1] });
    so.items[0].decorations[0].color_way_id = null;
    so.items[0].decorations[0].color_way_id_b = null;
    expect(skusMissingRevColorWays(job, so)).toEqual([]);
  });
});
