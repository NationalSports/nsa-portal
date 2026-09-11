/* eslint-disable */
/**
 * buildWorkOrderOpts — which garment rosters reach the production Work Order sheet.
 *
 * SO-2361 / JOB-2361-01: the job grouped two numbered jersey lines (30 + 8 numbers) plus
 * an un-numbered short. The builder stopped at the FIRST line carrying a roster, so the
 * sheet the floor works from showed 30 of the 38 numbers the rep entered on the SO, with
 * nothing to indicate the rest existed.
 *
 * SAFE: pure builder only — no Supabase, no network.
 */
import { buildWorkOrderOpts } from '../App';

const numbersDeco = (roster, over = {}) => ({ kind: 'numbers', position: 'Back', num_method: 'screen_print', num_size: '4"', roster, ...over });
const artDeco = () => ({ kind: 'art', position: 'Front Center', art_file_id: 'AF1' });

// The real SO-2361 lines, as stored on so_items / so_item_decorations.
const JERSEY = {
  sku: 'JM5134', name: 'Adidas Y Evryday Pro Rev Jersey', color: 'Black/White',
  sizes: { S: 1, M: 7, L: 13, XL: 9 },
  decorations: [artDeco(), numbersDeco({
    S: ['23'],
    M: ['5', '55', '5', '3', '12', '23', '6', '', '', '', '', '', '', '', '', '', ''],
    L: ['1', '2', '4', '7', '10', '10', '30', '2', '20', '37', '0', '1', '18'],
    XL: ['3', '3', '24', '24', '9', '32', '3', '8', '9'],
  })],
};
const JERSEY2 = {
  sku: 'JM5094', name: 'Adidas Everyday Pro Jersey', color: 'Black',
  sizes: { S: 4, M: 4 },
  decorations: [artDeco(), numbersDeco({ S: ['23', '29', '2', '25'], M: ['4', '4', '3', '7'] }, { num_size: '6"' })],
};
const SHORT = {
  sku: 'JM2649', name: 'Adidas Y Game Elite Short', color: 'Black/White',
  sizes: { S: 1, M: 9, L: 14, XL: 14 },
  decorations: [artDeco()],
};

const soOf = (items) => ({
  id: 'SO-2361', customer_id: 'C1', expected_date: '2026-09-25', created_at: '2026-09-09',
  items, art_files: [{ id: 'AF1', name: 'JSK Basketball', deco_type: 'screen_print', ink_colors: 'Black' }],
});
const jobOf = (items) => ({
  id: 'JOB-2361-01', deco_type: 'screen_print', art_file_id: 'AF1', positions: 'Front Center',
  total_units: items.reduce((a, x) => a + Object.values(x.sizes).reduce((b, v) => b + v, 0), 0),
  items: items.map((_, i) => ({ item_idx: i, deco_idx: 0, deco_idxs: [0, 1] })),
});
const build = (items) => buildWorkOrderOpts(jobOf(items), soOf(items), {});
const totalNumbers = (opts) => (opts.rosters || []).reduce((a, r) => a + r.total, 0);

describe('buildWorkOrderOpts — every numbered garment reaches the sheet', () => {
  const items = [JERSEY, JERSEY2, SHORT];
  const opts = build(items);

  test('both jersey rosters are built, not just the first', () => {
    expect(opts.rosters).toHaveLength(2);
    expect(opts.rosters.map((r) => r.total)).toEqual([30, 8]);
  });

  test('the sheet carries every number entered on the SO', () => {
    expect(totalNumbers(opts)).toBe(38);
  });

  test('each roster names its own garment and number height', () => {
    expect(opts.rosters[0].garment).toBe('JM5134 · Black/White');
    expect(opts.rosters[1].garment).toBe('JM5094 · Black');
    expect(opts.rosters[0].personalization).toContainEqual({ k: 'Number height', v: '4"' });
    expect(opts.rosters[1].personalization).toContainEqual({ k: 'Number height', v: '6"' });
  });

  test('a number used on both garments survives on both', () => {
    const sizeS = opts.rosters.map((r) => r.groups.find((g) => g.size === 'S').players.map((p) => p.num));
    expect(sizeS[0]).toEqual(['23']);
    expect(sizeS[1]).toEqual(['23', '29', '2', '25']);
  });

  test('blank slots left after the line was sized down are not counted', () => {
    const m = opts.rosters[0].groups.find((g) => g.size === 'M');
    expect(m.players.map((p) => p.num)).toEqual(['5', '55', '5', '3', '12', '23', '6']);
  });

  test('the un-numbered short contributes no roster', () => {
    expect(opts.rosters.every((r) => !/JM2649/.test(r.garment))).toBe(true);
  });

  test('`roster` stays the first block so the renderer keeps working', () => {
    expect(opts.roster).toBe(opts.rosters[0]);
    expect(opts.includePickList).toBe(true);
  });
});

describe('buildWorkOrderOpts — one team roster across garments still prints once (SO-1588)', () => {
  const team = { S: ['7', '12'], M: ['3'] };
  const kit = ['TEE', 'HOOD', 'SHORT'].map((sku) => ({
    sku, name: sku, color: 'Navy', sizes: { S: 2, M: 1 },
    decorations: [artDeco(), numbersDeco({ ...team })],
  }));
  const opts = build(kit);

  test('the shared list collapses to a single roster page', () => {
    expect(opts.rosters).toHaveLength(1);
    expect(opts.rosters[0].total).toBe(3);
  });

  test('the single page names every garment it covers', () => {
    expect(opts.rosters[0].garment).toBe('TEE · Navy + HOOD · Navy + SHORT · Navy');
  });
});

describe('buildWorkOrderOpts — jobs with no roster', () => {
  test('a bulk decoration job gets no roster and no pick list', () => {
    const opts = build([SHORT]);
    expect(opts.rosters).toEqual([]);
    expect(opts.roster).toBeNull();
    expect(opts.includePickList).toBe(false);
  });
});
