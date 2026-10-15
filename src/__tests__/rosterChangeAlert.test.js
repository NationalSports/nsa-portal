/**
 * SO-2506: the M jersey's number changed from #3 to #27 on the SO while JOB-2506-01 was already
 * In Line with its sheet printed. Nothing told production, and it was pressed as #3.
 */
import { detectFloorRosterChanges, stampRosterChanges, describeRosterChange } from '../lib/rosterChangeAlert';

const order = (roster, prodStatus = 'staging', extra = {}) => ({
  id: 'SO-2506',
  items: [{ sku: 'H44532', color: 'Black/White', line_id: 'L1', sizes: { M: 1 },
    decorations: [{ kind: 'art', art_file_id: 'af1' }, { kind: 'numbers', position: 'Back', roster }] }],
  jobs: [{ id: 'JOB-2506-01', prod_status: prodStatus, items: [{ item_idx: 0, deco_idxs: [0, 1], sizes: { M: 1 } }] }],
  ...extra,
});

describe('detectFloorRosterChanges', () => {
  test('flags a number change on a job that is In Line', () => {
    const found = detectFloorRosterChanges(order({ M: ['3'] }), order({ M: ['27'] }));
    expect(found).toEqual([{ jobId: 'JOB-2506-01', status: 'staging',
      changes: [{ kind: 'numbers', sku: 'H44532', color: 'Black/White', size: 'M', from: '3', to: '27' }] }]);
    expect(describeRosterChange(found[0].changes[0])).toBe('H44532 Black/White M #3 → #27');
  });

  test('flags In Process jobs and name changes', () => {
    const named = (n, st) => ({ ...order({ M: ['3'] }, st),
      items: [{ sku: 'H44532', color: 'Black/White', line_id: 'L1', sizes: { M: 1 },
        decorations: [{ kind: 'names', position: 'Back', names: { M: [n] } }] }] });
    const found = detectFloorRosterChanges(named('Smith', 'in_process'), named('Smyth', 'in_process'));
    expect(found[0].changes[0]).toMatchObject({ kind: 'names', from: 'Smith', to: 'Smyth' });
  });

  test('ignores jobs not yet on the floor, or already done', () => {
    ['hold', 'ready', 'completed'].forEach((st) => {
      expect(detectFloorRosterChanges(order({ M: ['3'] }, st), order({ M: ['27'] }, st))).toEqual([]);
    });
  });

  test('ignores padding blanks and whitespace', () => {
    expect(detectFloorRosterChanges(order({ M: ['3'] }), order({ M: [' 3 ', ''] }))).toEqual([]);
  });

  test('ignores changes to sizes the job does not run', () => {
    expect(detectFloorRosterChanges(order({ M: ['3'], S: ['21'] }), order({ M: ['3'], S: ['22'] }))).toEqual([]);
  });

  test('does not compare against a partially loaded order', () => {
    expect(detectFloorRosterChanges(order({ M: ['3'] }, 'staging', { _decosHydrated: false }), order({ M: ['27'] }))).toEqual([]);
  });

  test('matches the line by line_id when lines move', () => {
    const prev = order({ M: ['3'] });
    const next = order({ M: ['27'] });
    next.items = [{ sku: 'X', line_id: 'L0', sizes: {}, decorations: [] }, ...next.items];
    next.jobs[0].items[0].item_idx = 1;
    expect(detectFloorRosterChanges(prev, next)[0].changes[0]).toMatchObject({ from: '3', to: '27' });
  });
});

describe('stampRosterChanges', () => {
  test('stamps the job and keeps earlier unacknowledged changes', () => {
    const o = order({ M: ['27'] });
    o.jobs[0].roster_change = { changes: [{ kind: 'numbers', sku: 'H44532', size: 'M', from: '1', to: '3' }] };
    const found = [{ jobId: 'JOB-2506-01', status: 'staging', changes: [{ kind: 'numbers', sku: 'H44532', size: 'M', from: '3', to: '27' }] }];
    const out = stampRosterChanges(o, found, { by: 'Vic', at: '2026-10-09T16:49:00Z' });
    expect(out.jobs[0].roster_change).toMatchObject({ by: 'Vic', at: '2026-10-09T16:49:00Z', status: 'staging' });
    expect(out.jobs[0].roster_change.changes.map((c) => c.to)).toEqual(['3', '27']);
  });
});
