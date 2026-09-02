import { reopenPatchForCloseDate, webstoreCloseIsFuture } from '../lib/webstoreSchedule';

describe('webstore close-date status', () => {
  const now = new Date('2026-09-02T15:00:00-07:00');

  test('treats a date-only value as open through the end of that day', () => {
    expect(webstoreCloseIsFuture('2026-09-02', now)).toBe(true);
    expect(webstoreCloseIsFuture('2026-09-01', now)).toBe(false);
  });

  test('uses the exact instant for the current ISO close value', () => {
    expect(webstoreCloseIsFuture('2026-09-02T23:59:00-07:00', now)).toBe(true);
    expect(webstoreCloseIsFuture('2026-09-02T14:59:00-07:00', now)).toBe(false);
  });

  test('reopens a closed store when its close time is extended', () => {
    expect(reopenPatchForCloseDate(
      { status: 'closed', close_at: '2026-09-02T23:59:00-07:00' },
      '2026-09-03T23:59:00-07:00', now,
    )).toEqual({ status: 'open', closed_notified_at: null });
  });

  test('reopens a closed store when its close date is removed', () => {
    expect(reopenPatchForCloseDate({ status: 'closed', close_at: '2026-09-01T23:59:00-07:00' }, null, now)).toEqual({
      status: 'open', closed_notified_at: null,
    });
  });

  test('does not reopen for a past date or alter an already-open store', () => {
    expect(reopenPatchForCloseDate({ status: 'closed', close_at: '2026-08-31T23:59:00-07:00' }, '2026-09-01T23:59:00-07:00', now)).toEqual({});
    expect(reopenPatchForCloseDate({ status: 'open' }, '2026-09-03T23:59:00-07:00', now)).toEqual({});
  });

  test('does not reopen a manually closed store when an unrelated field is saved', () => {
    expect(reopenPatchForCloseDate(
      { status: 'closed', close_at: '2026-09-03T23:59:00-07:00' },
      '2026-09-03T23:59:00-07:00', now,
    )).toEqual({});
  });

  test('can explicitly repair a closed store whose future date is already saved', () => {
    expect(reopenPatchForCloseDate(
      { status: 'closed', close_at: '2026-09-03T23:59:00-07:00' },
      '2026-09-03T23:59:00-07:00', now, true,
    )).toEqual({ status: 'open', closed_notified_at: null });
  });
});
