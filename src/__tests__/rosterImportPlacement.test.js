/* eslint-disable */
/**
 * placeRosterEntries — the 📋 Paste / 📤 Upload Roster importers in BOTH order editors.
 *
 * The old inline loop shallow-copied the roster, wrote straight into the live nested arrays,
 * and threw away any number that found no empty slot (findIndex === -1) while still reporting
 * a clean "Imported". Numbers that never reach the roster never reach the mock, the job card,
 * or the press — SO-2502/CSM Baseball ran with an M row that held six numbers twice and was
 * missing six real ones, and nothing in the UI ever said a number had been dropped.
 *
 * SAFE: pure functions only — no Supabase, no DOM, no network.
 */
import { placeRosterEntries, rosterDropSummary } from '../safeHelpers';

const rows = (csv) => csv.trim().split('\n').map((l) => l.split(',').map((s) => s.trim()));

describe('placeRosterEntries — nothing is dropped silently', () => {
  test('fills the open slots of an empty roster in order', () => {
    const r = placeRosterEntries({}, { M: 3, L: 2 }, rows('M,2\nM,3\nL,9\nM,4\nL,10'));
    expect(r.roster).toEqual({ M: ['2', '3', '4'], L: ['9', '10'] });
    expect(r.placed).toBe(5);
    expect(r.dropped).toEqual([]);
  });

  test('appends after numbers already entered instead of overwriting them', () => {
    const r = placeRosterEntries({ M: ['2', '3', '', ''] }, { M: 4 }, rows('M,7\nM,11'));
    expect(r.roster.M).toEqual(['2', '3', '7', '11']);
    expect(r.placed).toBe(2);
  });

  // The SO-2502 shape: M was typed while the line was 6 pieces, then the line grew to 12.
  // The stored row is still length 6 and full, so the old findIndex(-1) discarded every
  // corrected number the rep pasted over it.
  test('a size row shorter than the qty is grown, not treated as full', () => {
    const stale = { M: ['2', '3', '4', '8', '39', '5'] };
    const r = placeRosterEntries(stale, { M: 12 }, rows('M,6\nM,7\nM,11\nM,14\nM,15\nM,20'));
    expect(r.roster.M).toEqual(['2', '3', '4', '8', '39', '5', '6', '7', '11', '14', '15', '20']);
    expect(r.placed).toBe(6);
    expect(r.dropped).toEqual([]);
  });

  test('numbers that genuinely do not fit are reported, not swallowed', () => {
    const r = placeRosterEntries({ M: ['2', '3'] }, { M: 2 }, rows('M,7\nM,11'));
    expect(r.roster.M).toEqual(['2', '3']);
    expect(r.placed).toBe(0);
    expect(r.dropped).toHaveLength(2);
    expect(rosterDropSummary(r.dropped)).toBe('M ×2 (no open slots)');
  });

  test('a size the garment does not carry is reported, not planted as a junk key', () => {
    const r = placeRosterEntries({}, { M: 2 }, rows('Medium,7\nM,11'));
    expect(r.roster).toEqual({ M: ['11', ''] });
    expect(Object.keys(r.roster)).not.toContain('Medium');
    expect(rosterDropSummary(r.dropped)).toBe('Medium ×1 (not a size on this garment)');
  });

  test('the caller’s roster is never mutated', () => {
    const original = { M: ['2', '', ''] };
    const snapshot = JSON.parse(JSON.stringify(original));
    const r = placeRosterEntries(original, { M: 3 }, rows('M,7'));
    expect(original).toEqual(snapshot);
    expect(r.roster.M).toEqual(['2', '7', '']);
  });

  test('blank cells and malformed lines are skipped without counting as drops', () => {
    const r = placeRosterEntries({}, { M: 3 }, rows('M,\n,5\nM,12'));
    expect(r.roster.M).toEqual(['12', '', '']);
    expect(r.placed).toBe(1);
    expect(r.dropped).toEqual([]);
  });

  test('survives a line with no sizes object at all', () => {
    const r = placeRosterEntries(null, null, rows('M,12'));
    expect(r.placed).toBe(0);
    expect(r.dropped).toHaveLength(1);
  });

  test('works the same for a names map', () => {
    const r = placeRosterEntries({ M: ['SMITH', ''] }, { M: 2 }, rows('M,JONES\nM,LEE'));
    expect(r.roster.M).toEqual(['SMITH', 'JONES']);
    expect(rosterDropSummary(r.dropped)).toBe('M ×1 (no open slots)');
  });
});

describe('rosterDropSummary', () => {
  test('groups by size and reason', () => {
    const dropped = [
      { size: 'M', reason: 'full' }, { size: 'M', reason: 'full' },
      { size: 'XXL', reason: 'unknown-size' },
    ];
    expect(rosterDropSummary(dropped)).toBe('M ×2 (no open slots), XXL ×1 (not a size on this garment)');
  });

  test('empty in, empty out', () => {
    expect(rosterDropSummary([])).toBe('');
    expect(rosterDropSummary(null)).toBe('');
  });
});
