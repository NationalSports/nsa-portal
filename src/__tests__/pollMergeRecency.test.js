const { rowTimeMs, localRowIsNewer, estimatePollRecencyDecision } = require('../lib/pollMergeRecency');

// Real values from the EST-2522 loss (2026-09-11).
const DB_TS = '2026-09-11 13:44:52.177736+00';   // set_updated_at trigger — ISO
const LOCAL_TS = '9/11/2026, 6:39:18 AM';        // new Date().toLocaleString() — US locale

// The client writes updated_at with toLocaleString() in the tab's own timezone, and the merge parses
// it back in that same timezone. So tests of the TIME comparison must derive their local strings from
// real instants rather than hardcoding an offset — otherwise they only hold on one runner. (CI runs
// UTC; a dev machine may not.) Assertions about the STRING comparison use literals, since character
// ordering does not depend on the clock.
const localStringAt = (isoInstant, offsetMs = 0) =>
  new Date(Date.parse(isoInstant) + offsetMs).toLocaleString();
const DB_INSTANT = '2026-09-11T13:44:52.177Z';
const MINUTE = 60 * 1000;

describe('poll-merge recency: date formats must be compared as times, not strings', () => {
  test('the client format round-trips through Date.parse — the premise of the whole fix', () => {
    const instant = Date.parse(DB_INSTANT);
    expect(rowTimeMs(new Date(instant).toLocaleString())).toBe(instant - (instant % 1000));
  });

  test('parses both the DB (ISO) and client (US locale) formats', () => {
    expect(isNaN(rowTimeMs(DB_TS))).toBe(false);
    expect(isNaN(rowTimeMs(LOCAL_TS))).toBe(false);
  });

  test('a naive string compare gets EST-2522 backwards — this is the bug being fixed', () => {
    // Jered's tab was ~5.5 minutes BEHIND the DB row when it first fell out of sync.
    const localOlder = localStringAt(DB_INSTANT, -5.5 * MINUTE);

    expect(localOlder > DB_TS).toBe(true);                 // '9' > '2' — what the old code believed
    expect(localRowIsNewer(localOlder, DB_TS)).toBe(false); // the truth: the DB row is newer
  });

  // The string compare sorted by first character, so its answer tracked the month's leading digit
  // rather than the date. Against a DB row dated 2026-09-11, the truth is simply "is this month after
  // September?" — and the string compare disagrees with it for ten months of the year.
  test.each([
    //  month  stringSaysLocalNewer  actuallyNewer
    [1, false, false], [2, false, false],
    [3, true, false], [4, true, false], [5, true, false], [6, true, false],
    [7, true, false], [8, true, false], [9, true, false],
    [10, false, true], [11, false, true], [12, false, true],
  ])('month %i: string compare says %s, truth is %s', (month, stringSaysLocalNewer, actuallyNewer) => {
    // Noon UTC on the 11th: far enough from a date boundary that no real timezone shifts the month.
    const local = localStringAt(`2026-${String(month).padStart(2, '0')}-11T12:00:00Z`);

    expect(local > DB_TS).toBe(stringSaysLocalNewer);
    expect(localRowIsNewer(local, DB_TS)).toBe(actuallyNewer);
  });

  test('the string compare is wrong for 10 months of the year; the time compare for none', () => {
    const monthsWrong = [];
    for (let m = 1; m <= 12; m++) {
      const local = localStringAt(`2026-${String(m).padStart(2, '0')}-11T12:00:00Z`);
      if ((local > DB_TS) !== localRowIsNewer(local, DB_TS)) monthsWrong.push(m);
    }
    // Mar–Sep: string wrongly favors the local copy (the lockout). Oct–Dec: it wrongly favors the DB.
    expect(monthsWrong).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('a genuinely newer local edit still wins', () => {
    expect(localRowIsNewer(localStringAt(DB_INSTANT, 5 * MINUTE), DB_TS)).toBe(true);
  });

  test('an equal instant is not "newer" — only a strictly later local edit keeps the local copy', () => {
    expect(localRowIsNewer(localStringAt(DB_INSTANT, -(Date.parse(DB_INSTANT) % 1000)), DB_TS)).toBe(false);
  });

  test('an unparseable or missing timestamp lets the DB row win, so _version can heal', () => {
    expect(localRowIsNewer('not a date', DB_TS)).toBe(false);
    expect(localRowIsNewer(LOCAL_TS, 'not a date')).toBe(false);
    expect(localRowIsNewer(null, DB_TS)).toBe(false);
    expect(localRowIsNewer(undefined, undefined)).toBe(false);
  });
});

describe('a newer local timestamp never bypasses optimistic concurrency', () => {
  const newerLocalTs = localStringAt(DB_INSTANT, 5 * MINUTE);

  test('same-base local edits stay in the editor while their save is pending', () => {
    const local = { id: 'EST-2522', _version: 4, updated_at: newerLocalTs, items: new Array(7) };
    const dbRow = { id: 'EST-2522', _version: 4, updated_at: DB_TS, items: new Array(1) };
    expect(estimatePollRecencyDecision(local, dbRow)).toBe('keep-local');
  });

  test('a DB advance preserves the local document as a conflict instead of adopting its version', () => {
    const local = { id: 'EST-2522', _version: 3, updated_at: newerLocalTs, items: new Array(7) };
    const dbRow = { id: 'EST-2522', _version: 4, updated_at: DB_TS, items: new Array(1) };
    expect(estimatePollRecencyDecision(local, dbRow)).toBe('conflict');
    expect(local._version).toBe(3);
    expect(local.items).toHaveLength(7);
  });

  test('_obBaseVersion remains authoritative after dbEngine has observed the newer DB version', () => {
    // This is the exact hole in #2276: dbEngine had already changed _version to 4, but the content
    // was still authored against v3 and the save RPC still (correctly) sent v3.
    const local = { id: 'EST-2522', _version: 4, _obBaseVersion: 3, updated_at: newerLocalTs };
    const dbRow = { id: 'EST-2522', _version: 4, updated_at: DB_TS };
    expect(estimatePollRecencyDecision(local, dbRow)).toBe('conflict');
  });

  test('missing version proof fails closed to conflict review', () => {
    expect(estimatePollRecencyDecision({ updated_at: newerLocalTs }, { updated_at: DB_TS, _version: 4 })).toBe('conflict');
    expect(estimatePollRecencyDecision({ updated_at: newerLocalTs, _version: 4 }, { updated_at: DB_TS })).toBe('conflict');
  });

  test('an older/equal local timestamp continues through the existing DB field merge', () => {
    expect(estimatePollRecencyDecision({ updated_at: localStringAt(DB_INSTANT, -MINUTE), _version: 3 }, { updated_at: DB_TS, _version: 4 })).toBe('merge-db');
  });
});
