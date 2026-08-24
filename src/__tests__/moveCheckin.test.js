/* Unit tests for src/movecheckin/moveLogic.js — the pure helpers behind the
 * /move-checkin station (September building move). */

const { classifyMoveScan, boxesForRef, parseLegacyItems, makeLegacyMoveBox, normShelf, moveStats, isCountedInventoryBox, inventoryTally, buildSubmitPlan, boxStage, placePatch } = require('../movecheckin/moveLogic');

describe('classifyMoveScan', () => {
  test('bare BX plate', () => {
    expect(classifyMoveScan('BX-2001')).toEqual({ type: 'box', id: 'BX-2001' });
  });
  test('printed label URL (?scan=)', () => {
    expect(classifyMoveScan('https://portal.app/?scan=BX-2001')).toEqual({ type: 'box', id: 'BX-2001' });
    expect(classifyMoveScan('https://portal.app/?scan=BX-2001&x=1')).toEqual({ type: 'box', id: 'BX-2001' });
  });
  test('hand-typed variants normalize', () => {
    expect(classifyMoveScan('bx2001')).toEqual({ type: 'box', id: 'BX-2001' });
    expect(classifyMoveScan('bx 2001')).toEqual({ type: 'box', id: 'BX-2001' });
    expect(classifyMoveScan(' bx-k9z3a1 ')).toEqual({ type: 'box', id: 'BX-K9Z3A1' });
  });
  test('old pre-plate labels come back as refs', () => {
    expect(classifyMoveScan('IF-1071')).toEqual({ type: 'ref', id: 'IF-1071' });
    expect(classifyMoveScan('https://portal.app/?scan=NSA-4501')).toEqual({ type: 'ref', id: 'NSA-4501' });
  });
  test('printed location labels (LOC:) lock a location', () => {
    expect(classifyMoveScan('LOC:A3')).toEqual({ type: 'loc', code: 'A3' });
    expect(classifyMoveScan('loc: stage  1 ')).toEqual({ type: 'loc', code: 'STAGE 1' });
  });
  test('empty / blank input', () => {
    expect(classifyMoveScan('')).toEqual({ type: 'empty' });
    expect(classifyMoveScan(null)).toEqual({ type: 'empty' });
    expect(classifyMoveScan('   ')).toEqual({ type: 'empty' });
  });
});

describe('boxesForRef', () => {
  const boxes = [
    { id: 'BX-2001', if_id: 'IF-1071', so_id: 'SO-100', status: 'staged', source_refs: [{ type: 'IF', id: 'IF-1071' }] },
    { id: 'BX-2002', if_id: 'IF-1071', status: 'staged', source_refs: [] },
    { id: 'BX-2003', if_id: 'IF-1071', status: 'combined', merged_into: 'BX-2001', source_refs: [] },
    { id: 'BX-2004', po_id: 'NSA-4501', status: 'staged', source_refs: [{ type: 'PO', id: 'NSA-4501' }] },
  ];
  test('matches by IF, PO, SO — case-insensitive', () => {
    expect(boxesForRef(boxes, 'if-1071').map((b) => b.id)).toEqual(['BX-2001', 'BX-2002']);
    expect(boxesForRef(boxes, 'NSA-4501').map((b) => b.id)).toEqual(['BX-2004']);
    expect(boxesForRef(boxes, 'SO-100').map((b) => b.id)).toEqual(['BX-2001']);
  });
  test('combined boxes are excluded (their survivor matches instead)', () => {
    expect(boxesForRef(boxes, 'IF-1071').some((b) => b.id === 'BX-2003')).toBe(false);
  });
  test('no match / blank ref', () => {
    expect(boxesForRef(boxes, 'IF-9999')).toEqual([]);
    expect(boxesForRef(boxes, '')).toEqual([]);
  });
});

describe('parseLegacyItems', () => {
  test('quantity-first, x optional', () => {
    expect(parseLegacyItems('12 x navy hoodies L\n6 white polos')).toEqual([
      { sku: '', name: 'navy hoodies L', color: '', sizes: { EA: 12 } },
      { sku: '', name: 'white polos', color: '', sizes: { EA: 6 } },
    ]);
  });
  test('trailing xN and bare lines default to 1', () => {
    expect(parseLegacyItems('trophy parts\nbanners x3')).toEqual([
      { sku: '', name: 'trophy parts', color: '', sizes: { EA: 1 } },
      { sku: '', name: 'banners', color: '', sizes: { EA: 3 } },
    ]);
  });
  test('blank lines dropped, empty text is empty', () => {
    expect(parseLegacyItems('\n\n  \n')).toEqual([]);
    expect(parseLegacyItems('')).toEqual([]);
  });
});

describe('makeLegacyMoveBox', () => {
  const now = '2026-08-24T10:00:00.000Z';
  test('job assignment carries the SO', () => {
    const row = makeLegacyMoveBox({ plate: 'BX-2050', assign: 'job', soId: 'SO-100', items: [{ sku: '', name: 'hoodies', color: '', sizes: { EA: 5 } }], createdBy: 'a@nsa.com', now });
    expect(row.id).toBe('BX-2050');
    expect(row.kind).toBe('legacy');
    expect(row.so_id).toBe('SO-100');
    expect(row.assigned_to).toBe('job');
    expect(row.checked_in_at).toBe(now);
    expect(row.checked_in_by).toBe('a@nsa.com');
    expect(row.status).toBe('staged');
    expect(row.source_refs).toEqual([{ type: 'SO', id: 'SO-100' }]);
  });
  test('inventory assignment never carries an SO, shelf optional', () => {
    const row = makeLegacyMoveBox({ plate: 'BX-2051', assign: 'inventory', soId: 'SO-100', items: [], bin: 'A3', now });
    expect(row.so_id).toBe(null);
    expect(row.assigned_to).toBe('inventory');
    expect(row.bin).toBe('A3');
    expect(row.source_refs).toEqual([]);
  });
});

describe('buildLocationLabels', () => {
  const { buildLocationLabels } = require('../movecheckin/moveLogic');
  test('splits on newlines/commas, normalizes, dedupes; QR encodes LOC:', () => {
    const l = buildLocationLabels('a1, A2\n a1 \nstage  1');
    expect(l.map((x) => x.code)).toEqual(['A1', 'A2', 'STAGE 1']);
    expect(l[0].qrData).toBe('LOC:A1');
  });
  test('empty text → no labels', () => {
    expect(buildLocationLabels(' \n, ')).toEqual([]);
  });
});

describe('normShelf', () => {
  test('trims, uppercases, collapses spaces', () => {
    expect(normShelf(' a3 ')).toBe('A3');
    expect(normShelf('rack  12')).toBe('RACK 12');
    expect(normShelf('')).toBe('');
    expect(normShelf(null)).toBe('');
  });
});

describe('inventory count → submit', () => {
  const checkedIn = '2026-09-02T10:00:00Z';
  const boxes = [
    // counted: inventory, checked in
    { id: 'BX-1', status: 'staged', checked_in_at: checkedIn, assigned_to: 'inventory', contents: [{ sku: 'ab123', product_id: 'p1', name: 'Hoodie', sizes: { S: 2, M: 3 } }] },
    { id: 'BX-2', status: 'staged', checked_in_at: checkedIn, assigned_to: 'inventory', contents: [{ sku: 'AB123', sizes: { M: 1, L: 4 } }, { sku: 'ZZ9', name: 'Polo', sizes: { L: 6 } }] },
    // NOT counted: sales-order box, un-checked-in inventory, combined
    { id: 'BX-3', status: 'staged', checked_in_at: checkedIn, so_id: 'SO-1', assigned_to: 'job', contents: [{ sku: 'AB123', sizes: { S: 99 } }] },
    { id: 'BX-4', status: 'staged', checked_in_at: null, assigned_to: 'inventory', contents: [{ sku: 'AB123', sizes: { S: 50 } }] },
    { id: 'BX-5', status: 'combined', checked_in_at: checkedIn, assigned_to: 'inventory', contents: [{ sku: 'AB123', sizes: { S: 50 } }] },
    // counted but no SKU → must surface as unmatched, never silently dropped
    { id: 'BX-6', status: 'staged', checked_in_at: checkedIn, assigned_to: 'inventory', contents: [{ sku: '', name: 'mystery shirts', sizes: { EA: 7 } }] },
  ];

  test('isCountedInventoryBox gates on checked-in + inventory + not combined', () => {
    expect(boxes.map(isCountedInventoryBox)).toEqual([true, true, false, false, false, true]);
  });

  test('inventoryTally sums SKU×size across counted boxes only, case-insensitive SKU', () => {
    const t = inventoryTally(boxes);
    expect(t.AB123.sizes).toEqual({ S: 2, M: 4, L: 4 });
    expect(t.AB123.product_id).toBe('p1');
    expect(t.ZZ9.sizes).toEqual({ L: 6 });
    expect(t[''].sizes).toEqual({ EA: 7 });
  });

  test('buildSubmitPlan: counted vs zero-candidates vs unmatched', () => {
    const t = inventoryTally(boxes);
    const invRows = [
      { product_id: 'p1', size: 'S', quantity: 10 }, { product_id: 'p1', size: 'XL', quantity: 5 }, // XL not counted → goes to 0
      { product_id: 'p2', size: 'L', quantity: 1 },   // ZZ9 counted by sku match
      { product_id: 'p3', size: 'M', quantity: 8 },   // never came over → zero candidate
      { product_id: 'p4', size: 'M', quantity: 0 },   // already zero → NOT a zero candidate
    ];
    const products = [
      { id: 'p1', sku: 'AB123', name: 'Hoodie' }, { id: 'p2', sku: 'ZZ9', name: 'Polo' },
      { id: 'p3', sku: 'GONE1', name: 'Old Tee' }, { id: 'p4', sku: 'EMPTY', name: 'Empty' },
    ];
    const plan = buildSubmitPlan(t, invRows, products);
    expect(plan.counted.map((c) => c.sku)).toEqual(['AB123', 'ZZ9']);
    const ab = plan.counted.find((c) => c.sku === 'AB123');
    expect(ab.rows).toEqual(expect.arrayContaining([
      { size: 'S', quantity: 2, oldQty: 10 }, { size: 'M', quantity: 4, oldQty: 0 },
      { size: 'L', quantity: 4, oldQty: 0 }, { size: 'XL', quantity: 0, oldQty: 5 },
    ]));
    expect(ab.units).toBe(10);
    expect(plan.zeroCandidates.map((z) => z.sku)).toEqual(['GONE1']);
    expect(plan.zeroCandidates[0].rows).toEqual([{ size: 'M', quantity: 0, oldQty: 8 }]);
    expect(plan.zeroCandidates[0].oldUnits).toBe(8);
    expect(plan.unmatched.length).toBe(1);
    expect(plan.unmatched[0].sizes).toEqual({ EA: 7 });
  });
});

describe('submitPlanCsv', () => {
  const { submitPlanCsv } = require('../movecheckin/moveLogic');
  test('one row per SKU×size; zero-outs marked by confirmation; quotes escaped', () => {
    const plan = {
      counted: [{ product_id: 'p1', sku: 'AB123', name: 'Hoodie, "warm"', color: 'Navy', rows: [{ size: 'S', quantity: 2, oldQty: 10 }] }],
      zeroCandidates: [
        { product_id: 'p3', sku: 'GONE1', name: 'Old Tee', color: '', rows: [{ size: 'M', quantity: 0, oldQty: 8 }] },
        { product_id: 'p4', sku: 'KEEP1', name: 'Kept', color: '', rows: [{ size: 'L', quantity: 0, oldQty: 3 }] },
      ],
      unmatched: [{ sku: 'XX', name: 'mystery', sizes: { EA: 7 } }],
    };
    const lines = submitPlanCsv(plan, { p3: true }).split('\n');
    expect(lines[0]).toBe('type,sku,name,color,size,current_qty,new_qty');
    expect(lines[1]).toBe('counted,AB123,"Hoodie, ""warm""",Navy,S,10,2');
    expect(lines[2]).toBe('zero_out_confirmed,GONE1,Old Tee,,M,8,0');
    expect(lines[3]).toBe('never_came_over_kept,KEEP1,Kept,,L,3,3');
    expect(lines[4]).toBe('unmatched_sku,XX,mystery,,EA,,7');
  });
});

describe('contents ⇄ editor lines (edit scans)', () => {
  const { contentsToLines, linesToContents } = require('../movecheckin/moveLogic');
  test('round-trips and preserves reconciliation refs (so_id/if_id)', () => {
    const contents = [{ sku: 'AB123', product_id: 'p1', name: 'Hoodie', color: 'Navy', so_id: 'SO-1', if_id: 'IF-9', sizes: { S: 2, M: 3 } }];
    expect(linesToContents(contentsToLines(contents))).toEqual(contents);
  });
  test('edited quantities: zero/blank cells drop, empty lines drop', () => {
    const lines = contentsToLines([{ sku: 'A', sizes: { S: 2, M: 3 } }, { sku: 'B', sizes: { L: 1 } }]);
    lines[0].sizes.M = '';    // blanked in the UI
    lines[0].sizes.S = '5';   // typed as string
    lines[1].sizes.L = 0;     // line emptied entirely
    expect(linesToContents(lines)).toEqual([{ sku: 'A', name: '', color: '', sizes: { S: 5 } }]);
  });
});

describe('three-stage flow: checked in → staging → on shelf', () => {
  test('boxStage derives the stage, shelf wins over staging', () => {
    expect(boxStage({ checked_in_at: null })).toBe('not_in');
    expect(boxStage({ checked_in_at: 'x' })).toBe('checked_in');
    expect(boxStage({ checked_in_at: 'x', staging_area: 'STAGE 1' })).toBe('staged');
    expect(boxStage({ checked_in_at: 'x', staging_area: 'STAGE 1', bin: 'A3' })).toBe('shelved');
    expect(boxStage(null)).toBe('not_in');
  });
  test('placePatch: shelf is final (clears staging), staging clears the shelf', () => {
    expect(placePatch('shelf', 'A3')).toEqual({ bin: 'A3', staging_area: null });
    expect(placePatch('staging', 'DOCK 1')).toEqual({ staging_area: 'DOCK 1', bin: null });
  });
});

describe('moveStats', () => {
  const boxes = [
    { id: 'BX-1', status: 'staged', checked_in_at: '2026-08-24T09:00:00Z', bin: 'A1' },
    { id: 'BX-2', status: 'staged', checked_in_at: '2026-08-23T09:00:00Z', bin: null },
    { id: 'BX-6', status: 'staged', checked_in_at: '2026-08-23T10:00:00Z', staging_area: 'STAGE 1' },
    { id: 'BX-3', status: 'staged', checked_in_at: null, bin: null },
    { id: 'BX-4', status: 'combined', checked_in_at: null },
    { id: 'BX-5', status: 'shipped', checked_in_at: null },
  ];
  test('rollup counts per stage', () => {
    expect(moveStats(boxes, '2026-08-24T00:00:00Z')).toEqual({ checkedIn: 3, today: 1, checkedInOnly: 1, staged: 1, shelved: 1, notCheckedIn: 1 });
  });
  test('empty input', () => {
    expect(moveStats([], null)).toEqual({ checkedIn: 0, today: 0, checkedInOnly: 0, staged: 0, shelved: 0, notCheckedIn: 0 });
  });
});
