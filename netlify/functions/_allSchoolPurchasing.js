// Per-store gates shared by the scheduled worker and purchasing preview. Money
// is blank garment COST in integer cents; tax, freight and decoration are absent.
const DEFAULT_PURCHASING = Object.freeze({ mode: 'minimum_weekly', minimum_cents: 20000, weekday: 3, time: '09:00', timezone: 'America/Los_Angeles', combine_regular: true, no_batch_policy: 'separate', max_wait_days: 7, max_run_cents: 100000, enabled: false });
const MODES = ['manual', 'minimum', 'weekly', 'minimum_weekly'];
function purchasingSettings(store, vendor) {
  const source = store?.all_school_settings?.purchasing || {};
  const overrides = source.vendors?.[vendor] || {};
  const value = { ...DEFAULT_PURCHASING, ...source, ...overrides };
  if (!MODES.includes(value.mode)) throw new Error('Invalid purchasing mode');
  for (const key of ['minimum_cents', 'max_run_cents']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error('Invalid ' + key);
  if (!Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6) throw new Error('Invalid purchasing weekday');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw new Error('Invalid purchasing time');
  if (!Number.isFinite(value.max_wait_days) || value.max_wait_days < 1 || value.max_wait_days > 30) throw new Error('Invalid maximum purchasing wait');
  if (!['separate', 'hold'].includes(value.no_batch_policy)) throw new Error('Invalid no-batch policy');
  new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format(new Date());
  return value;
}
function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
// Convert the latest scheduled local wall time to an instant. Offset is resolved
// on that day, so Los Angeles' DST shift never moves a 09:00 cutoff to 08:00.
function latestWeeklyCutoff(now, settings) {
  const p = localParts(new Date(now), settings.timezone);
  const today = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  let days = (new Date(today).getUTCDay() - settings.weekday + 7) % 7;
  if (!days && `${p.hour}:${p.minute}` < settings.time) days = 7;
  const day = new Date(today - days * 86400000);
  const [hour, minute] = settings.time.split(':').map(Number);
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const q = localParts(new Date(instant), settings.timezone);
    const represented = Date.UTC(Number(q.year), Number(q.month) - 1, Number(q.day), Number(q.hour), Number(q.minute));
    instant += wall - represented;
  }
  return new Date(instant).toISOString();
}
function purchaseDecision({ pendingNeeds = [], settings, now = new Date().toISOString() }) {
  const current = new Date(now).getTime();
  if (!Number.isFinite(current)) throw new Error('Invalid purchasing clock');
  const pending = pendingNeeds.filter(n => !n.po_id && !n.dismissed_at && Math.max(0, Number(n.qty_needed) - Number(n.qty_on_hand || 0)) > 0);
  const totalCents = pending.reduce((sum, n) => sum + Math.max(0, Number(n.qty_needed) - Number(n.qty_on_hand || 0)) * Number(n.unit_cost_cents || 0), 0);
  const dates = pending.map(n => new Date(n.created_at).getTime());
  const oldest = dates.length ? Math.min(...dates) : current;
  const base = { total_cents: totalCents, need_ids: pending.map(n => n.id), oldest_age_days: (current - oldest) / 86400000 };
  if (!settings.enabled) return { due: false, reason: 'disabled', ...base };
  if (settings.mode === 'manual') return { due: false, reason: 'manual', ...base };
  if (!pending.length) return { due: false, reason: 'no_pending', ...base };
  if (dates.some(d => !Number.isFinite(d)) || pending.some(n => !Number.isSafeInteger(Number(n.unit_cost_cents)) || Number(n.unit_cost_cents) <= 0)) return { due: false, reason: 'unverified_cost_or_date', ...base };
  if (!Number.isSafeInteger(totalCents) || totalCents > settings.max_run_cents) return { due: false, reason: 'run_limit', ...base };
  const minimum = totalCents >= settings.minimum_cents;
  const cutoff = latestWeeklyCutoff(now, settings);
  const weekly = dates.some(d => d <= new Date(cutoff).getTime());
  let reason = 'waiting';
  if (['minimum', 'minimum_weekly'].includes(settings.mode) && minimum) reason = 'minimum';
  else if (base.oldest_age_days >= settings.max_wait_days) reason = 'max_wait';
  else if (['weekly', 'minimum_weekly'].includes(settings.mode) && weekly) reason = 'weekly';
  const due = reason !== 'waiting';
  return { due, reason, combine_regular: due && reason !== 'minimum' && !minimum && settings.combine_regular === true, weekly_cutoff: cutoff, ...base };
}
module.exports = { DEFAULT_PURCHASING, purchasingSettings, latestWeeklyCutoff, purchaseDecision };
