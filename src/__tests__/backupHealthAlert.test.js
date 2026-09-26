/* Tests for netlify/functions/backup-health-alert.js — the email-or-not decision. */
const { findProblems } = require('../../netlify/functions/backup-health-alert');

const NOW = Date.parse('2026-09-25T13:30:00Z');
const h = n => new Date(NOW - n * 3600000).toISOString();

test('healthy: a daily backup finished within 26h and nothing failed', () => {
  const runs = [
    { kind: 'intraday', status: 'ok', created_at: h(2), finished_at: h(1.8) },
    { kind: 'daily', status: 'ok', created_at: h(6.5), finished_at: h(6) },
  ];
  expect(findProblems(runs, null, NOW)).toEqual([]);
});

test('alerts when the backup table cannot be read', () => {
  expect(findProblems([], 'HTTP 404', NOW)).toHaveLength(1);
});

test('alerts when no daily backup has ever finished', () => {
  expect(findProblems([{ kind: 'intraday', status: 'ok', created_at: h(1), finished_at: h(1) }], null, NOW)[0]).toMatch(/No daily backup has ever finished/);
});

test('alerts when the last daily backup is older than 26h', () => {
  expect(findProblems([{ kind: 'daily', status: 'ok', created_at: h(31), finished_at: h(30) }], null, NOW)[0]).toMatch(/over 26 hours/);
});

test('alerts on a failed run in the last 24h, not an older one', () => {
  const base = { kind: 'daily', status: 'ok', created_at: h(6.5), finished_at: h(6) };
  const recent = { kind: 'intraday', status: 'failed', created_at: h(4), finished_at: h(3), last_error: 'boom' };
  const old = { kind: 'intraday', status: 'failed', created_at: h(40), finished_at: h(39), last_error: 'old' };
  const p = findProblems([recent, base, old], null, NOW);
  expect(p).toHaveLength(1);
  expect(p[0]).toMatch(/boom/);
});

test('alerts on a run stuck for more than 3h', () => {
  const runs = [
    { kind: 'daily', status: 'running', created_at: h(4), finished_at: null },
    { kind: 'daily', status: 'ok', created_at: h(20), finished_at: h(19.5) },
  ];
  expect(findProblems(runs, null, NOW)[0]).toMatch(/running for over 3 hours/);
});
