/* src/lib/storeClock.js — the PT clock behind team-store open/close windows.
 *
 * Regression suite for the close-date bug: the editor used to write the raw
 * 'YYYY-MM-DD' from an <input type="date"> into the TIMESTAMPTZ close_at, so
 * Postgres stored midnight UTC = 5 PM PT the PREVIOUS day. Stores closed a day
 * early and every list rendered the day before the one the rep picked. These
 * tests pin both directions of the conversion, the 11:59 PM default, and the
 * DST edges. */
import {
  ptToIso, ptDateInput, ptTimeInput, ptDateLabel, ptOffsetMinutes,
  isCustomCloseTime, DEFAULT_CLOSE_TIME,
} from '../lib/storeClock';

describe('ptToIso — picker values become the right instant', () => {
  test('defaults to 11:59 PM PT on the chosen day, not midnight UTC', () => {
    // Aug 16 is PDT (UTC−7), so 23:59 PT is 06:59Z the NEXT day.
    expect(ptToIso('2026-08-16')).toBe('2026-08-17T06:59:00.000Z');
  });

  test('the old behaviour it replaces closed the store a day early', () => {
    // What the bare date used to mean once Postgres cast it: 5 PM PT Aug 15.
    const legacy = new Date('2026-08-16T00:00:00Z');
    const fixed = new Date(ptToIso('2026-08-16'));
    expect(fixed.getTime() - legacy.getTime()).toBe(30 * 3600 * 1000 + 59 * 60000);
    expect(ptDateInput(legacy)).toBe('2026-08-15'); // the day the rep saw, off by one
    expect(ptDateInput(fixed)).toBe('2026-08-16'); // the day the rep picked
  });

  test('honours an explicit time', () => {
    expect(ptToIso('2026-08-16', '17:00')).toBe('2026-08-17T00:00:00.000Z');
    expect(ptToIso('2026-08-16', '00:00')).toBe('2026-08-16T07:00:00.000Z');
    expect(ptToIso('2026-08-16', '9:05')).toBe('2026-08-16T16:05:00.000Z');
  });

  test('winter dates use PST (UTC−8)', () => {
    expect(ptToIso('2026-01-15')).toBe('2026-01-16T07:59:00.000Z');
    expect(ptToIso('2026-12-31', '23:59')).toBe('2027-01-01T07:59:00.000Z');
  });

  test('resolves days that straddle a DST transition', () => {
    // Spring forward 2026-03-08, fall back 2026-11-01. 23:59 lands after each
    // shift, so the offset must be read at the target instant, not the guess.
    expect(ptToIso('2026-03-08')).toBe('2026-03-09T06:59:00.000Z'); // PDT, −7
    expect(ptToIso('2026-11-01')).toBe('2026-11-02T07:59:00.000Z'); // PST, −8
    // Round-trip is what actually matters: the date survives either way.
    ['2026-03-08', '2026-03-07', '2026-11-01', '2026-10-31'].forEach((ymd) => {
      expect(ptDateInput(ptToIso(ymd))).toBe(ymd);
      expect(ptTimeInput(ptToIso(ymd))).toBe(DEFAULT_CLOSE_TIME);
    });
  });

  test('rejects junk instead of inventing a close date', () => {
    ['', null, undefined, 'tomorrow', '08/16/2026', '2026-8-6'].forEach((v) => {
      expect(ptToIso(v)).toBeNull();
    });
  });

  test('clamps an out-of-range time rather than rolling into another day', () => {
    expect(ptToIso('2026-08-16', '99:99')).toBe('2026-08-17T06:59:00.000Z');
  });
});

describe('round-trip through the pickers', () => {
  test('every day of a month survives date → store → date', () => {
    for (let d = 1; d <= 31; d++) {
      const ymd = `2026-03-${String(d).padStart(2, '0')}`;
      expect(ptDateInput(ptToIso(ymd, '23:59'))).toBe(ymd);
    }
  });

  test('the time comes back as it went in', () => {
    ['00:00', '08:30', '12:00', '17:00', '23:59'].forEach((hm) => {
      expect(ptTimeInput(ptToIso('2026-08-16', hm))).toBe(hm);
    });
  });

  test('a bare picker date passes through untouched', () => {
    expect(ptDateInput('2026-08-16')).toBe('2026-08-16');
  });

  test('a date with no time of day takes the default, not midnight', () => {
    // A store seeded date-only (OMG wizard / duplicate) must still close at the END
    // of that day — reading the bare date as 00:00 would shut it before it opened.
    expect(ptTimeInput('2026-08-16')).toBe(DEFAULT_CLOSE_TIME);
    expect(ptTimeInput('2026-08-16', '17:00')).toBe('17:00');
  });

  test('empty values stay empty / fall back', () => {
    expect(ptDateInput(null)).toBe('');
    expect(ptDateInput('')).toBe('');
    expect(ptTimeInput(null)).toBe(DEFAULT_CLOSE_TIME);
    expect(ptTimeInput(null, '17:00')).toBe('17:00');
  });
});

describe('display', () => {
  test('labels the PT date, not the viewer local date', () => {
    // 06:59Z is still Aug 16 in PT even though it is Aug 17 in UTC/Europe.
    expect(ptDateLabel('2026-08-17T06:59:00.000Z')).toBe('Aug 16');
    expect(ptDateLabel('2026-08-17T06:59:00.000Z', { month: 'short', day: 'numeric', year: 'numeric' })).toBe('Aug 16, 2026');
  });

  test('null in, null out', () => {
    expect(ptDateLabel(null)).toBeNull();
    expect(ptDateLabel('not a date')).toBeNull();
  });

  test('only a non-default close time is worth showing', () => {
    expect(isCustomCloseTime(ptToIso('2026-08-16', '23:59'))).toBe(false);
    expect(isCustomCloseTime(ptToIso('2026-08-16', '17:00'))).toBe(true);
    expect(isCustomCloseTime(null)).toBe(false);
  });
});

describe('ptOffsetMinutes', () => {
  test('tracks PDT and PST', () => {
    expect(ptOffsetMinutes(new Date('2026-08-16T12:00:00Z'))).toBe(-420);
    expect(ptOffsetMinutes(new Date('2026-01-16T12:00:00Z'))).toBe(-480);
  });
});
