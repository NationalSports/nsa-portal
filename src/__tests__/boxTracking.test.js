// Box tracking (BX-#### license plates) — pure-seam unit tests for src/boxTracking.js.
import {
  isBoxCode,
  plateFromCounter,
  boxUnits,
  sumBoxContents,
  makeBoxRow,
  mergeSourceRefs,
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
});
