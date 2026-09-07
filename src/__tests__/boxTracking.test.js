// Box tracking (BX-#### license plates) — pure-seam unit tests for src/boxTracking.js.
import {
  isBoxCode,
  plateFromCounter,
  boxUnits,
  sumBoxContents,
  makeBoxRow,
  mergeSourceRefs,
  mergeAllContents,
  mergeAllSourceRefs,
  crossCustomerGroups,
  buildBoxLabel,
  BOX_STATUS_META,
} from '../boxTracking';

describe('isBoxCode', () => {
  it('matches BX plates in any case, with surrounding whitespace', () => {
    expect(isBoxCode('BX-2001')).toBe(true);
    expect(isBoxCode('bx-2001')).toBe(true);
    expect(isBoxCode('  BX-2001  ')).toBe(true);
    expect(isBoxCode('BX-K9Z3A1')).toBe(true); // fallback plates are alphanumeric
  });
  it('rejects IF/PO/SO ids and junk', () => {
    expect(isBoxCode('IF-1071')).toBe(false);
    expect(isBoxCode('NSA 4501')).toBe(false);
    expect(isBoxCode('SO-1234')).toBe(false);
    expect(isBoxCode('')).toBe(false);
    expect(isBoxCode(null)).toBe(false);
    expect(isBoxCode('BX-')).toBe(false);
    expect(isBoxCode('BX-20 01')).toBe(false);
  });
});

describe('plateFromCounter', () => {
  it('starts the plate space at BX-2001', () => {
    expect(plateFromCounter(1)).toBe('BX-2001');
    expect(plateFromCounter(42)).toBe('BX-2042');
  });
});

describe('boxUnits', () => {
  it('sums all size cells across entries', () => {
    expect(
      boxUnits([
        { sku: 'A', sizes: { S: 3, M: 2 } },
        { sku: 'B', sizes: { L: 5 } },
      ])
    ).toBe(10);
  });
  it('is 0 for empty/missing contents', () => {
    expect(boxUnits([])).toBe(0);
    expect(boxUnits(null)).toBe(0);
    expect(boxUnits([{ sku: 'A' }])).toBe(0);
  });
});

describe('sumBoxContents (combine)', () => {
  it('sums sizes for the same sku+color+refs line', () => {
    const a = [{ sku: 'TS100', name: 'Tee', color: 'Red', so_id: 'SO-1', if_id: 'IF-1', sizes: { S: 3, M: 2 } }];
    const b = [{ sku: 'TS100', name: 'Tee', color: 'Red', so_id: 'SO-1', if_id: 'IF-1', sizes: { M: 1, L: 4 } }];
    const merged = sumBoxContents(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].sizes).toEqual({ S: 3, M: 3, L: 4 });
  });
  it('keeps distinct lines separate (different color or IF)', () => {
    const a = [{ sku: 'TS100', color: 'Red', if_id: 'IF-1', sizes: { S: 1 } }];
    const b = [
      { sku: 'TS100', color: 'Blue', if_id: 'IF-1', sizes: { S: 2 } },
      { sku: 'TS100', color: 'Red', if_id: 'IF-2', sizes: { S: 4 } },
    ];
    const merged = sumBoxContents(a, b);
    expect(merged).toHaveLength(3);
    expect(boxUnits(merged)).toBe(7);
  });
  it('drops zero/empty lines and never mutates inputs', () => {
    const a = [{ sku: 'A', color: '', sizes: { S: 2 } }];
    const b = [{ sku: 'B', color: '', sizes: { S: 0 } }, null];
    const aCopy = JSON.parse(JSON.stringify(a));
    const merged = sumBoxContents(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].sku).toBe('A');
    expect(a).toEqual(aCopy);
  });
});

describe('sumBoxContents — PO traceability', () => {
  // The merge must never destroy which PO a garment came from: short-ship claims and
  // invoice reconciliation are argued off exactly this. Same SKU+size from two POs
  // stays two lines; the same PO combines into one.
  it('keeps the same SKU+size split when it came from different POs', () => {
    const a = [{ sku: 'KD9803', color: 'Navy', so_id: 'SO-1', po_id: 'PO-A', sizes: { L: 5 } }];
    const b = [{ sku: 'KD9803', color: 'Navy', so_id: 'SO-1', po_id: 'PO-B', sizes: { L: 3 } }];
    const merged = sumBoxContents(a, b);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.po_id).sort()).toEqual(['PO-A', 'PO-B']);
    expect(boxUnits(merged)).toBe(8);
  });
  it('combines the same SKU+size when it came from the SAME PO', () => {
    const a = [{ sku: 'KD9803', color: 'Navy', so_id: 'SO-1', po_id: 'PO-A', sizes: { L: 5 } }];
    const b = [{ sku: 'KD9803', color: 'Navy', so_id: 'SO-1', po_id: 'PO-A', sizes: { L: 3 } }];
    const merged = sumBoxContents(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].sizes).toEqual({ L: 8 });
    expect(merged[0].po_id).toBe('PO-A');
  });
  it('every content row still carries its source PO after a merge', () => {
    const merged = mergeAllContents([
      [{ sku: 'A', po_id: 'PO-1', sizes: { M: 2 } }],
      [{ sku: 'A', po_id: 'PO-2', sizes: { M: 4 } }],
      [{ sku: 'B', po_id: 'PO-1', sizes: { S: 1 } }],
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.every((e) => !!e.po_id)).toBe(true);
  });
});

describe('mergeAllContents / mergeAllSourceRefs (2+ boxes at once)', () => {
  it('folds three boxes in one pass, target first', () => {
    const merged = mergeAllContents([
      [{ sku: 'A', color: 'Red', sizes: { S: 1 } }],
      [{ sku: 'A', color: 'Red', sizes: { S: 2 } }],
      [{ sku: 'B', color: 'Blue', sizes: { L: 3 } }],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].sizes).toEqual({ S: 3 });
    expect(boxUnits(merged)).toBe(6);
  });
  it('is a no-op for an empty or missing list', () => {
    expect(mergeAllContents([])).toEqual([]);
    expect(mergeAllContents(null)).toEqual([]);
  });
  it('de-dupes source_refs across every box', () => {
    const refs = mergeAllSourceRefs([
      [{ type: 'PO', id: 'PO-1' }],
      [{ type: 'PO', id: 'PO-1' }, { type: 'PO', id: 'PO-2' }],
      [{ type: 'SO', id: 'SO-9' }],
    ]);
    expect(refs).toEqual([
      { type: 'PO', id: 'PO-1' },
      { type: 'PO', id: 'PO-2' },
      { type: 'SO', id: 'SO-9' },
    ]);
  });
});

describe('crossCustomerGroups (merge guard)', () => {
  it('passes when every box belongs to the same customer', () => {
    const g = crossCustomerGroups([
      { id: 'BX-1', customerId: 'c1', customerName: 'Fresno Pacific' },
      { id: 'BX-2', customerId: 'c1', customerName: 'Fresno Pacific' },
    ]);
    expect(g.mismatch).toBe(false);
    expect(g.groups).toHaveLength(1);
  });
  it('flags a cross-customer merge and names both sides with their plates', () => {
    const g = crossCustomerGroups([
      { id: 'BX-1041', customerId: 'c1', customerName: "Fresno Pacific Men's Soccer" },
      { id: 'BX-1042', customerId: 'c2', customerName: 'Orange Lutheran Baseball' },
    ]);
    expect(g.mismatch).toBe(true);
    expect(g.groups).toHaveLength(2);
    expect(g.groups[0]).toEqual({ key: 'c1', name: "Fresno Pacific Men's Soccer", boxIds: ['BX-1041'] });
    expect(g.groups[1].boxIds).toEqual(['BX-1042']);
  });
  it('falls back to so_id when the customer cannot be resolved', () => {
    const g = crossCustomerGroups([
      { id: 'BX-1', customerId: '', soId: 'SO-5', customerName: '' },
      { id: 'BX-2', customerId: '', soId: 'SO-5', customerName: '' },
    ]);
    expect(g.mismatch).toBe(false);
  });
  it('treats an unidentifiable box as its own group — worth the second tap', () => {
    const g = crossCustomerGroups([
      { id: 'BX-1', customerId: 'c1', customerName: 'Fresno Pacific' },
      { id: 'BX-2', customerId: '', soId: '', customerName: '' },
    ]);
    expect(g.mismatch).toBe(true);
    expect(g.groups[1].name).toBe('Unknown customer');
  });
});

describe('buildBoxLabel — supersedes', () => {
  it('lists the absorbed plates so the floor kills the dead labels', () => {
    const lbl = buildBoxLabel(
      { id: 'BX-1055', status: 'staged', contents: [{ sku: 'A', sizes: { M: 2 } }], updated_at: '2026-09-03T00:00:00.000Z' },
      { supersedes: ['BX-1041', 'BX-1042'] }
    );
    expect(lbl.supersedes).toBe('SUPERSEDES: BX-1041, BX-1042');
  });
  it('is blank on an ordinary (non-merged) label', () => {
    const lbl = buildBoxLabel({ id: 'BX-1055', status: 'staged', contents: [] });
    expect(lbl.supersedes).toBe('');
  });
});

describe('makeBoxRow', () => {
  it('builds a row matching the 00185 schema with derived source_refs', () => {
    const row = makeBoxRow({
      id: 'BX-2001',
      contents: [{ sku: 'A', sizes: { S: 1 } }],
      soId: 'SO-1234',
      ifId: 'IF-1071',
      createdBy: 'wh1',
      now: '2026-07-08T00:00:00.000Z',
    });
    expect(row).toEqual({
      id: 'BX-2001',
      kind: 'fulfillment',
      contents: [{ sku: 'A', sizes: { S: 1 } }],
      source_refs: [
        { type: 'IF', id: 'IF-1071' },
        { type: 'SO', id: 'SO-1234' },
      ],
      so_id: 'SO-1234',
      if_id: 'IF-1071',
      po_id: null,
      status: 'staged',
      merged_into: null,
      bin: null,
      created_by: 'wh1',
      created_at: '2026-07-08T00:00:00.000Z',
      updated_at: '2026-07-08T00:00:00.000Z',
    });
  });
});

describe('makeBoxRow — receiving kind (PO receive)', () => {
  it('builds a kind=receiving row whose source_refs carry the PO (and SO when present)', () => {
    const row = makeBoxRow({
      id: 'BX-2050',
      kind: 'receiving',
      contents: [{ sku: 'PC61', color: 'Red', sizes: { M: 6 } }],
      soId: 'SO-2001',
      poId: 'NSA-4501',
      createdBy: 'wh1',
      now: '2026-07-12T00:00:00.000Z',
    });
    expect(row.kind).toBe('receiving');
    expect(row.po_id).toBe('NSA-4501');
    expect(row.so_id).toBe('SO-2001');
    expect(row.if_id).toBe(null);
    expect(row.source_refs).toEqual([
      { type: 'PO', id: 'NSA-4501' },
      { type: 'SO', id: 'SO-2001' },
    ]);
    // A receiving box carries a scannable plate exactly like a pull box.
    const l = buildBoxLabel(row, { scanBase: 'https://x.app/' });
    expect(l.qrData).toBe('https://x.app/?scan=BX-2050');
  });
  it('a PO-only receiving box (no SO) still records the PO ref', () => {
    const row = makeBoxRow({ id: 'BX-2051', kind: 'receiving', contents: [{ sku: 'X', sizes: { S: 1 } }], poId: 'NSA-9', now: '2026-07-12T00:00:00.000Z' });
    expect(row.source_refs).toEqual([{ type: 'PO', id: 'NSA-9' }]);
  });
});

describe('mergeSourceRefs', () => {
  it('de-dupes by type+id, survivor first', () => {
    expect(
      mergeSourceRefs(
        [{ type: 'IF', id: 'IF-1' }],
        [{ type: 'IF', id: 'IF-1' }, { type: 'IF', id: 'IF-2' }, { type: 'SO', id: 'SO-1' }]
      )
    ).toEqual([
      { type: 'IF', id: 'IF-1' },
      { type: 'IF', id: 'IF-2' },
      { type: 'SO', id: 'SO-1' },
    ]);
  });
});

describe('buildBoxLabel', () => {
  const box = {
    id: 'BX-2001',
    so_id: 'SO-1234',
    if_id: 'IF-1071',
    status: 'staged',
    updated_at: '2026-06-16T12:00:00.000Z',
    contents: [{ sku: 'TS100', name: 'Tee', color: 'Red', sizes: { S: 3, M: 2 } }],
  };
  it('QR encodes the plate; meta line reads plate context (IF · STATUS — date)', () => {
    const l = buildBoxLabel(box, { program: 'Grande FC', rep: 'Sam', scanBase: 'https://x.app/', dateStr: '6/16' });
    expect(l.code).toBe('BX-2001');
    expect(l.qrData).toBe('https://x.app/?scan=BX-2001');
    expect(l.note).toBe('IF-1071 · STAGED — 6/16');
    expect(l.subtitle).toBe('SO-1234');
    expect(l.program).toBe('Grande FC');
    expect(l.rep).toBe('Rep: Sam');
    expect(l.codeSub).toBe('5 units · scan box');
    expect(l.items).toEqual([{ title: 'TS100 Tee', detail: 'Red · 5 units', sizes: 'S: 3  M: 2' }]);
  });
  it('unknown status falls back to the raw value; missing IF drops from the meta line', () => {
    const l = buildBoxLabel({ ...box, if_id: null, status: 'weird' }, { dateStr: '6/16' });
    expect(l.note).toBe('WEIRD — 6/16');
    expect(BOX_STATUS_META.weird).toBeUndefined();
  });
  it('carries the SO memo through as its own zone, verbatim (no "Rep:"-style prefix)', () => {
    const l = buildBoxLabel(box, { program: 'Grande FC', memo: 'Fall 2026 Boys Soccer Warmups', dateStr: '6/16' });
    expect(l.memo).toBe('Fall 2026 Boys Soccer Warmups');
    // The memo must not bleed into the lines the warehouse scans by.
    expect(l.program).toBe('Grande FC');
    expect(l.subtitle).toBe('SO-1234');
    expect(l.note).toBe('IF-1071 · STAGED — 6/16');
  });
  it('omits the memo when the caller has none to resolve', () => {
    expect(buildBoxLabel(box, { program: 'Grande FC', dateStr: '6/16' }).memo).toBe('');
  });
});

// ── Adversarial-input regressions (2026-07-18 sweep) ──
describe('boxUnits negative-cell hardening', () => {
  it('ignores negative size cells instead of subtracting them (label unit counts)', () => {
    // Regression: a corrupted contents row { S: -3 } used to shrink the printed count.
    expect(boxUnits([{ sku: 'A', sizes: { S: -3, M: 5 } }])).toBe(5);
    expect(boxUnits([{ sku: 'A', sizes: { S: '-2', M: '4' } }])).toBe(4);
    expect(boxUnits([{ sku: 'A', sizes: { S: 'abc', M: 2 } }])).toBe(2);
  });
});
