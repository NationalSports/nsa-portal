/* eslint-disable */
/**
 * jobItemRoster — a job row's numbers/names, read from the LIVE SO line.
 *
 * SO-2257 (Coronado FC): the jersey job was split on 9/17 and each half kept a copy of the
 * numbers on the job row. The SO's numbers were re-entered afterwards, but every tech sheet
 * kept printing the 9/17 copy (adult lines numbered after the split printed blank).
 *
 * SAFE: pure functions only — no Supabase, no DOM, no network.
 */
import { jobItemRoster, jobRosterBlocks } from '../safeHelpers';

const line = (sizes, roster, names) => ({
  sku: 'JJ0058', color: 'White', sizes,
  decorations: [
    { kind: 'art', position: 'Front Center' },
    { kind: 'numbers', position: 'Back', roster },
    ...(names ? [{ kind: 'names', position: 'Back', names }] : []),
  ],
});
const row = (sizes, extra = {}) => ({ item_idx: 0, deco_idxs: [0, 1, 2], sku: 'JJ0058', sizes, ...extra });

describe('jobItemRoster — split jobs follow the live SO list', () => {
  // Live SO line today: 7 jerseys, numbers re-entered after the split.
  const items = [line({ XS: 1, S: 3, M: 3 }, { XS: ['12'], S: ['3', '13', '24'], M: ['8', '11', '12'] })];
  // The 9/17 split: parent kept S/M, the -S backorder took the XS. Both rows carry the OLD copy.
  const parent = { id: 'JOB-2257-01-S', items: [row({ S: 3, M: 3 }, { roster: { S: ['28', '14', ''], M: ['6', '15', '19'] } })] };
  const split = { id: 'JOB-2257-01-S-S', split_from: 'JOB-2257-01-S', items: [row({ XS: 1 }, { roster: { XS: ['2', '12'] } })] };
  const jobs = [parent, split];

  test('parent prints the current SO numbers, not its 9/17 copy', () => {
    expect(jobItemRoster(items, jobs, parent, parent.items[0])).toEqual({ S: ['3', '13', '24'], M: ['8', '11', '12'] });
  });

  test('the backorder half prints its share of the current list', () => {
    expect(jobItemRoster(items, jobs, split, split.items[0])).toEqual({ XS: ['12'] });
  });

  test('two halves of the same size split the list without overlap', () => {
    const its = [line({ M: 4 }, { M: ['1', '2', '3', '4'] })];
    const a = { id: 'A', items: [row({ M: 3 }, { roster: { M: ['9', '9', '9'] } })] };
    const b = { id: 'A-S', items: [row({ M: 1 }, { roster: { M: ['9'] } })] };
    expect(jobItemRoster(its, [a, b], a, a.items[0])).toEqual({ M: ['1', '2', '3'] });
    expect(jobItemRoster(its, [a, b], b, b.items[0])).toEqual({ M: ['4'] });
  });

  test('a job already pressed keeps the numbers it printed', () => {
    const done = { ...parent, prod_status: 'completed' };
    expect(jobItemRoster(items, [done, split], done, done.items[0])).toEqual({ S: ['28', '14', ''], M: ['6', '15', '19'] });
  });

  test('names are shared out the same way as numbers', () => {
    const its = [line({ M: 2 }, { M: ['1', '2'] }, { M: ['ANA', 'BEA'] })];
    const a = { id: 'A', items: [row({ M: 1 })] };
    const b = { id: 'A-S', items: [row({ M: 1 })] };
    expect(jobItemRoster(its, [a, b], b, b.items[0], 'names')).toEqual({ M: ['BEA'] });
    expect(jobItemRoster(its, [a, b], b, b.items[0], 'numbers')).toEqual({ M: ['2'] });
  });

  test('an unsplit job reads the live list scoped to its sizes', () => {
    const its = [line({ M: 2 }, { M: ['1', '2', '27'], L: ['5'] })];
    const j = { id: 'A', items: [{ item_idx: 0, deco_idxs: [0, 1] }] };
    expect(jobItemRoster(its, [j], j, j.items[0])).toEqual({ M: ['1', '2'] });
  });

  test("a sibling job that doesn't run the numbers doesn't take a share", () => {
    const its = [line({ M: 2 }, { M: ['1', '2'] })];
    const art = { id: 'ART', items: [{ item_idx: 0, deco_idxs: [0], sizes: { M: 2 } }] };
    const nums = { id: 'NUM', items: [{ item_idx: 0, deco_idxs: [1], sizes: { M: 2 } }] };
    expect(jobItemRoster(its, [art, nums], nums, nums.items[0])).toEqual({ M: ['1', '2'] });
  });

  test('without the order job list, the old copy-first behavior is kept', () => {
    expect(jobItemRoster(items, null, split, split.items[0])).toEqual({ XS: ['2'] });
  });

  test('jobRosterBlocks uses the live share when given the job list', () => {
    const blocks = jobRosterBlocks(parent, items, ['XS', 'S', 'M'], jobs);
    expect(blocks[0].rows).toEqual([['S', ['3', '13', '24']], ['M', ['8', '11', '12']]]);
  });
});
