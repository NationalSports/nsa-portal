/* eslint-disable */
/**
 * jobRosterBlocks — the "numbers to print" roll-up shown on a job card.
 *
 * A job can carry several garment lines. Garments that hold the SAME roster are one
 * team list copied onto each piece and must be counted once (SO-1588); garments that
 * hold DIFFERENT rosters are different lists and each must be shown in full. The old
 * merge-by-(size, number) rule did the second case wrong: it collapsed any number that
 * legitimately appeared on two garments, so SO-2361/JOB-2361-01 showed 36 of the 38
 * numbers entered on the SO.
 *
 * SAFE: pure functions only — no Supabase, no DOM, no network.
 */
import { jobRosterBlocks } from '../safeHelpers';

const SZ = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const numbersDeco = (roster) => ({ kind: 'numbers', position: 'Back', roster });
const line = (sku, color, sizes, roster) => ({
  sku, color, sizes,
  decorations: [{ kind: 'art', position: 'Front Center' }, numbersDeco(roster)],
});
const job = (...idxs) => ({ items: idxs.map((i) => ({ item_idx: i, deco_idxs: [0, 1] })) });
const countOf = (blocks) => blocks.reduce((a, b) => a + b.total, 0);

describe('jobRosterBlocks — different garment rosters are each kept', () => {
  // The real JOB-2361-01: two jersey lines, 30 + 8 numbers.
  const items = [
    line('JM5134', 'Black/White', { S: 1, M: 7, L: 13, XL: 9 }, {
      S: ['23'],
      // trailing blanks: the line was sized down after the numbers were typed
      M: ['5', '55', '5', '3', '12', '23', '6', '', '', '', '', '', '', '', '', '', ''],
      L: ['1', '2', '4', '7', '10', '10', '30', '2', '20', '37', '0', '1', '18'],
      XL: ['3', '3', '24', '24', '9', '32', '3', '8', '9'],
    }),
    line('JM5094', 'Black', { S: 4, M: 4 }, { S: ['23', '29', '2', '25'], M: ['4', '4', '3', '7'] }),
  ];

  test('every number entered on the SO reaches the job list', () => {
    const blocks = jobRosterBlocks(job(0, 1), items, SZ);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.total)).toEqual([30, 8]);
    expect(countOf(blocks)).toBe(38);
  });

  test('a number on BOTH garments is listed on both — not collapsed', () => {
    const blocks = jobRosterBlocks(job(0, 1), items, SZ);
    const sizeS = blocks.map((b) => (b.rows.find(([sz]) => sz === 'S') || [null, []])[1]);
    expect(sizeS[0]).toEqual(['23']);            // jersey line
    expect(sizeS[1]).toEqual(['23', '29', '2', '25']); // second line keeps its own 23
    const sizeM = blocks.map((b) => (b.rows.find(([sz]) => sz === 'M') || [null, []])[1]);
    expect(sizeM[0]).toHaveLength(7);
    expect(sizeM[1]).toEqual(['4', '4', '3', '7']); // the 3 survives on both garments
  });

  test('each block is labelled with its garment', () => {
    const blocks = jobRosterBlocks(job(0, 1), items, SZ);
    expect(blocks[0].labels).toEqual(['JM5134 · Black/White']);
    expect(blocks[1].labels).toEqual(['JM5094 · Black']);
  });

  test('blank slots past the ordered qty are dropped, not counted', () => {
    const [jersey] = jobRosterBlocks(job(0), items, SZ);
    expect(jersey.rows.find(([sz]) => sz === 'M')[1]).toEqual(['5', '55', '5', '3', '12', '23', '6']);
  });

  test('rows come back in size-run order', () => {
    const [jersey] = jobRosterBlocks(job(0), items, SZ);
    expect(jersey.rows.map(([sz]) => sz)).toEqual(['S', 'M', 'L', 'XL']);
  });
});

describe('jobRosterBlocks — one team roster copied across garments collapses (SO-1588)', () => {
  const team = { S: ['7', '12'], M: ['3'] };
  const items = [
    line('TEE', 'Navy', { S: 2, M: 1 }, team),
    line('HOOD', 'Navy', { S: 2, M: 1 }, { ...team }),
    line('SHORT', 'Navy', { S: 2, M: 1 }, { S: ['12', '7'], M: ['3'] }), // same list, typed in another order
  ];

  test('five garments carrying the same list report it once', () => {
    const blocks = jobRosterBlocks(job(0, 1, 2), items, SZ);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].total).toBe(3);
    expect(blocks[0].labels).toEqual(['TEE · Navy', 'HOOD · Navy', 'SHORT · Navy']);
  });
});

describe('jobRosterBlocks — edge cases', () => {
  test('a job with no numbers decoration returns no blocks', () => {
    const items = [{ sku: 'TEE', sizes: { M: 4 }, decorations: [{ kind: 'art', position: 'Front Center' }] }];
    expect(jobRosterBlocks(job(0), items, SZ)).toEqual([]);
  });

  test('an empty roster returns no blocks', () => {
    const items = [line('BAG', 'Black', { OSFA: 3 }, {})];
    expect(jobRosterBlocks(job(0), items, SZ)).toEqual([]);
  });

  test('a job item pointing at a missing line is skipped', () => {
    expect(jobRosterBlocks(job(0, 9), [line('TEE', 'Navy', { M: 1 }, { M: ['3'] })], SZ)).toHaveLength(1);
  });

  test('only decorations the job owns are read (deco_idxs scoping)', () => {
    const it = {
      sku: 'TEE', color: 'Navy', sizes: { M: 2 },
      decorations: [{ kind: 'art' }, numbersDeco({ M: ['1', '2'] })],
    };
    const artOnlyJob = { items: [{ item_idx: 0, deco_idxs: [0] }] };
    expect(jobRosterBlocks(artOnlyJob, [it], SZ)).toEqual([]);
  });

  test("a split job's own roster slice wins over the source decoration", () => {
    const it = line('TEE', 'Navy', { M: 4 }, { M: ['1', '2', '3', '4'] });
    const split = { items: [{ item_idx: 0, deco_idxs: [0, 1], sizes: { M: 2 }, roster: { M: ['3', '4'] } }] };
    expect(jobRosterBlocks(split, [it], SZ)[0].rows).toEqual([['M', ['3', '4']]]);
  });

  test('numeric roster entries survive', () => {
    const it = line('TEE', 'Navy', { M: 2 }, { M: [7, 0] });
    expect(jobRosterBlocks(job(0), [it], SZ)[0].rows).toEqual([['M', ['7', '0']]]);
  });

  test('a null/empty job is safe', () => {
    expect(jobRosterBlocks(null, null, SZ)).toEqual([]);
    expect(jobRosterBlocks({}, [], SZ)).toEqual([]);
  });
});
