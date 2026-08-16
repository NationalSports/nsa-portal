// Team-store open/close windows run on the company clock (Pacific) — not on the
// browser's timezone and not on Postgres' UTC default. A rep who picks
// "Aug 16 · 11:59 PM" means 11:59 PM PT for everyone: the shopper in Chicago,
// the close sweep running in UTC, the flyer that says "Order by Aug 16".
//
// Why this module exists: `webstores.close_at` is a TIMESTAMPTZ, but the editor
// wrote the raw 'YYYY-MM-DD' string from an <input type="date"> straight into it.
// Postgres read that bare date as midnight UTC — i.e. 5 PM PT the PREVIOUS day —
// so a store set to close "Aug 16" actually stopped taking orders Aug 15 at 5 PM,
// and every list that rendered the value back through the browser's local clock
// showed the day before the one the rep picked. Both directions now go through an
// explicit PT offset instead of whatever timezone happens to be in play.

export const STORE_TZ = 'America/Los_Angeles';
// Stores close at the end of the chosen day, and open at the start of it.
export const DEFAULT_CLOSE_TIME = '23:59';
export const DEFAULT_OPEN_TIME = '00:00';

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^(\d{1,2}):(\d{2})/;

// Minutes the instant's PT wall clock leads UTC (−420 in PDT, −480 in PST).
export function ptOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = {};
  parts.forEach((x) => { p[x.type] = x.value; });
  const hour = p.hour === '24' ? 0 : Number(p.hour); // some ICU builds report midnight as 24
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

// 'YYYY-MM-DD' (+ 'HH:MM', PT wall clock) → ISO instant for a timestamptz column.
// Returns null for anything unparseable so callers can store NULL.
export function ptToIso(ymd, hm = DEFAULT_CLOSE_TIME) {
  const d = YMD_RE.exec(String(ymd || '').trim());
  if (!d) return null;
  const t = HM_RE.exec(String(hm || '').trim());
  const hour = t ? Math.min(23, Math.max(0, Number(t[1]))) : 23;
  const min = t ? Math.min(59, Math.max(0, Number(t[2]))) : 59;
  // Read the wall clock as if it were UTC, then back out the PT offset. That
  // offset depends on the very instant we're solving for, so resolve it twice —
  // the second pass settles days that straddle a DST transition.
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], hour, min, 0, 0);
  const firstPass = wall - ptOffsetMinutes(new Date(wall)) * 60000;
  const inst = wall - ptOffsetMinutes(new Date(firstPass)) * 60000;
  return new Date(inst).toISOString();
}

// Anything the app might hold — Date, ISO timestamp, or a bare 'YYYY-MM-DD' from
// an unsaved form — as a real instant. Bare dates are read as PT midnight rather
// than the UTC midnight `new Date('2026-08-16')` would give us.
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const d = new Date(YMD_RE.test(s) ? ptToIso(s, DEFAULT_OPEN_TIME) : s);
  return isNaN(d.getTime()) ? null : d;
}

// timestamptz → the PT calendar date an <input type="date"> should show.
export function ptDateInput(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (YMD_RE.test(s)) return s; // already a picker value; nothing to convert
  const d = toDate(v);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// timestamptz → the PT wall-clock 'HH:MM' an <input type="time"> should show.
// A bare 'YYYY-MM-DD' carries no time of day, so it takes the fallback rather than
// reading as midnight — otherwise a store seeded with a date-only close would come
// back with a 12:00 AM close time and shut at the START of the chosen day.
export function ptTimeInput(v, fallback = DEFAULT_CLOSE_TIME) {
  if (YMD_RE.test(String(v || '').trim())) return fallback;
  const d = toDate(v);
  if (!d) return fallback;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: STORE_TZ, hour12: false, hour: '2-digit', minute: '2-digit' }).format(d);
  return hm === '24:00' ? '00:00' : hm;
}

// Display helpers — always the PT date, so a rep in any timezone reads the same
// close date the storefront and the flyers print.
export function ptDateLabel(v, opts = { month: 'short', day: 'numeric' }) {
  const d = toDate(v);
  if (!d) return null;
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: STORE_TZ }).format(d);
}

// "11:59 PM" — omitted by callers when the time is the boring default.
export function ptTimeLabel(v) {
  const d = toDate(v);
  if (!d) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: STORE_TZ, hour: 'numeric', minute: '2-digit' }).format(d);
}

// A close time worth showing next to the date (anything but the 11:59 PM default).
export function isCustomCloseTime(v) {
  const t = ptTimeInput(v, null);
  return !!t && t !== DEFAULT_CLOSE_TIME;
}
