// NSA warehouse dates use Pacific time; arithmetic is date-only and skips weekends.
function businessDate(value) {
  if (!value) return null;
  const text = String(value);
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const legacy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,.*)?$/.exec(text);
  if (plain || legacy) {
    const [y, m, d] = plain ? plain.slice(1).map(Number) : [Number(legacy[3]), Number(legacy[1]), Number(legacy[2])];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addBusinessDays(value, days) {
  const day = businessDate(value);
  if (!day || !Number.isInteger(days) || days < 0 || days > 365) return null;
  const date = new Date(day + 'T12:00:00Z');
  for (let left = days; left > 0;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) left--;
  }
  return date.toISOString().slice(0, 10);
}
module.exports = { businessDate, addBusinessDays };
