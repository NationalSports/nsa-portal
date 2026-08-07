/* Unit tests for the age-based pickup backstop in netlify/functions/ups-pickup-sync.js.
 *
 * The UPS scan path is network-bound and covered only by the smoke suite; these
 * tests pin the pure age logic that decides when a non-UPS (e.g. FedEx) package
 * still "Awaiting Pickup" is old enough to auto-clear. `now` is injected so the
 * tests don't depend on the wall clock. */

const { shipmentAgeDays, agedOut } = require('../../netlify/functions/ups-pickup-sync');

// Fixed reference "now" so ages are deterministic: 2026-07-31 12:00 local.
const NOW = new Date('2026-07-31T12:00:00').getTime();

describe('shipmentAgeDays', () => {
  test('parses ship_date in M/D/YYYY', () => {
    expect(shipmentAgeDays({ ship_date: '7/6/2026' }, NOW)).toBe(25);
    expect(shipmentAgeDays({ ship_date: '6/22/2026' }, NOW)).toBe(39);
  });

  test('parses ship_date without leading zeros the same as the DB stores it', () => {
    expect(shipmentAgeDays({ ship_date: '7/30/2026' }, NOW)).toBe(1);
    expect(shipmentAgeDays({ ship_date: '7/31/2026' }, NOW)).toBe(0);
  });

  test('falls back to created_at (locale timestamp) when ship_date is missing', () => {
    // created_at carries a time (12:03 PM); NOW is noon, so 6/22 12:03 PM → 7/31 noon
    // is a hair under 39 days and floors to 38. ship_date (midnight) is preferred in
    // real data, so this cross-day boundary only bites when ship_date is absent.
    expect(shipmentAgeDays({ created_at: '6/22/2026, 12:03:31 PM' }, NOW)).toBe(38);
  });

  test('returns -1 for missing or unparseable dates (never triggers a clear)', () => {
    expect(shipmentAgeDays({}, NOW)).toBe(-1);
    expect(shipmentAgeDays({ ship_date: 'not-a-date' }, NOW)).toBe(-1);
    expect(shipmentAgeDays(null, NOW)).toBe(-1);
  });
});

describe('agedOut', () => {
  const old = { tracking_number: '382445349254', ship_date: '7/6/2026' };   // 25d, FedEx
  const fresh = { tracking_number: '1Z42Y2E00398251673', ship_date: '7/30/2026' }; // 1d, UPS

  test('clears a tracked package past the threshold', () => {
    expect(agedOut(old, 4, NOW)).toBe(true);
  });

  test('leaves a fresh package alone', () => {
    expect(agedOut(fresh, 4, NOW)).toBe(false);
  });

  test('never clears a package with no tracking number ("No label" rows)', () => {
    expect(agedOut({ tracking_number: '', ship_date: '6/1/2026' }, 4, NOW)).toBe(false);
    expect(agedOut({ ship_date: '6/1/2026' }, 4, NOW)).toBe(false);
  });

  test('never re-clears an already picked-up package', () => {
    expect(agedOut({ ...old, carrier_picked_up: true }, 4, NOW)).toBe(false);
  });

  test('threshold is inclusive at exactly N days', () => {
    expect(agedOut({ tracking_number: 'X', ship_date: '7/27/2026' }, 4, NOW)).toBe(true);  // 4d
    expect(agedOut({ tracking_number: 'X', ship_date: '7/28/2026' }, 4, NOW)).toBe(false); // 3d
  });
});
