const { rowTimeMs, localRowIsNewer, keepLocalAdoptVersion } = require('../lib/pollMergeRecency');

// Real values from the EST-2522 loss (2026-09-11). The DB row is ~5.5 minutes NEWER than the
// client's copy at the moment Jered's tab first fell behind.
const DB_TS = '2026-09-11 13:44:52.177736+00';   // set_updated_at trigger — ISO
const LOCAL_TS = '9/11/2026, 6:39:18 AM';        // new Date().toLocaleString() — US locale

describe('poll-merge recency: date formats must be compared as times, not strings', () => {
  test('parses both the DB (ISO) and client (US locale) formats', () => {
    expect(isNaN(rowTimeMs(DB_TS))).toBe(false);
    expect(isNaN(rowTimeMs(LOCAL_TS))).toBe(false);
  });

  test('a naive string compare gets EST-2522 backwards — this is the bug being fixed', () => {
    expect(LOCAL_TS > DB_TS).toBe(true);              // '9' > '2' — what the old code believed
    expect(localRowIsNewer(LOCAL_TS, DB_TS)).toBe(false); // the truth: the DB row is newer
  });

  // The string compare sorted by first character, so its answer tracked the month's leading digit
  // rather than the date. Against a DB row dated 2026-09-11, the truth is simply "is this month
  // after September?" — and the string compare disagrees with it for nine months of the year.
  test.each([
    //        month  stringSaysLocalNewer  actuallyNewer
    [1, false, false], [2, false, false],
    [3, true, false], [4, true, false], [5, true, false], [6, true, false],
    [7, true, false], [8, true, false], [9, true, false],
    [10, false, true], [11, false, true], [12, false, true],
  ])('month %i: string compare says %s, truth is %s', (month, stringSaysLocalNewer, actuallyNewer) => {
    const local = `${month}/11/2026, 6:39:18 AM`;
    expect(local > DB_TS).toBe(stringSaysLocalNewer);
    expect(localRowIsNewer(local, DB_TS)).toBe(actuallyNewer);
  });

  test('the string compare is wrong for 10 months of the year; the time compare for none', () => {
    const monthsWrong = [];
    for (let m = 1; m <= 12; m++) {
      const local = `${m}/11/2026, 6:39:18 AM`;
      const truth = localRowIsNewer(local, DB_TS);
      if ((local > DB_TS) !== truth) monthsWrong.push(m);
    }
    // Mar–Sep: string wrongly favors the local copy (the lockout). Oct–Dec: it wrongly favors the DB.
    expect(monthsWrong).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('a genuinely newer local edit still wins', () => {
    expect(localRowIsNewer('9/11/2026, 11:00:00 AM', '2026-09-11 13:44:52.177736+00')).toBe(true);
  });

  test('an unparseable or missing timestamp lets the DB row win, so _version can heal', () => {
    expect(localRowIsNewer('not a date', DB_TS)).toBe(false);
    expect(localRowIsNewer(LOCAL_TS, 'not a date')).toBe(false);
    expect(localRowIsNewer(null, DB_TS)).toBe(false);
    expect(localRowIsNewer(undefined, undefined)).toBe(false);
  });
});

describe('keeping the local copy must not strand its _version', () => {
  test('adopts the DB _version so the next save is not rejected as stale', () => {
    // Jered's tab: 7 items built locally, still on v3, while the DB had moved to v4.
    const local = { id: 'EST-2522', _version: 3, updated_at: LOCAL_TS, items: new Array(7) };
    const dbRow = { id: 'EST-2522', _version: 4, updated_at: DB_TS, items: new Array(1) };

    const merged = keepLocalAdoptVersion(local, dbRow);

    expect(merged._version).toBe(4);        // unblocked — the save can now succeed
    expect(merged.items).toHaveLength(7);   // and his work is still on screen
  });

  test('keeps the local updated_at — overwriting it would drop the rep\'s lines on the next poll', () => {
    const local = { id: 'EST-2522', _version: 3, updated_at: LOCAL_TS, items: new Array(7) };
    const dbRow = { id: 'EST-2522', _version: 4, updated_at: DB_TS };

    const merged = keepLocalAdoptVersion(local, dbRow);
    expect(merged.updated_at).toBe(LOCAL_TS);
  });

  test('returns the same object when there is nothing to adopt, keeping change-detection cheap', () => {
    const local = { id: 'EST-2522', _version: 4 };
    expect(keepLocalAdoptVersion(local, { _version: 4 })).toBe(local);
    expect(keepLocalAdoptVersion(local, { _version: null })).toBe(local);
    expect(keepLocalAdoptVersion(local, null)).toBe(local);
  });
});
