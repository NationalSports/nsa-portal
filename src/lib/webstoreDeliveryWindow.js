export const WEBSTORE_DELIVERY_WINDOWS = Object.freeze([
  { value: '2-3', label: '2–3 weeks' },
  { value: '3-4', label: '3–4 weeks' },
  { value: '4-5', label: '4–5 weeks' },
  { value: '5-6', label: '5–6 weeks' },
]);

export const DEFAULT_WEBSTORE_DELIVERY_WINDOW = '4-5';

export function normalizeDeliveryWindow(value) {
  return WEBSTORE_DELIVERY_WINDOWS.some((option) => option.value === value)
    ? value
    : DEFAULT_WEBSTORE_DELIVERY_WINDOW;
}

export function deliveryWindowLabel(value) {
  const normalized = normalizeDeliveryWindow(value);
  return WEBSTORE_DELIVERY_WINDOWS.find((option) => option.value === normalized).label;
}

export function deliveryWindowEndWeeks(value) {
  return Number(normalizeDeliveryWindow(value).split('-')[1]);
}

export function deliveryWindowStartWeeks(value) {
  return Number(normalizeDeliveryWindow(value).split('-')[0]);
}

function pacificCloseDate(closeAt) {
  if (!closeAt) return null;
  const close = new Date(closeAt);
  if (Number.isNaN(close.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(close).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

function addUtcDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

const monthShort = (date) => date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const monthPart = (date) => (date.getUTCDate() <= 10 ? 'early' : date.getUTCDate() <= 20 ? 'mid' : 'late');

export function estimatedDeliveryRangeLabel(closeAt, value) {
  const closeDate = pacificCloseDate(closeAt);
  if (!closeDate) return '';
  const start = addUtcDays(closeDate, deliveryWindowStartWeeks(value) * 7);
  const end = addUtcDays(closeDate, deliveryWindowEndWeeks(value) * 7);
  const startMonth = monthShort(start);
  const endMonth = monthShort(end);
  const startPart = monthPart(start);
  const endPart = monthPart(end);
  if (startMonth === endMonth) {
    return startPart === endPart ? `${startPart} ${startMonth}` : `${startPart} to ${endPart} ${startMonth}`;
  }
  return `${startPart} ${startMonth} to ${endPart} ${endMonth}`;
}

export function estimatedDeliveryDate(closeAt, value) {
  if (!closeAt) return null;
  const close = new Date(closeAt);
  if (Number.isNaN(close.getTime())) return null;
  return new Date(close.getTime() + deliveryWindowEndWeeks(value) * 7 * 86400000);
}

// Sales-order expected_date is a date-only field. Base it on the store's
// Pacific close DATE (not the UTC date of its 11:59 PM timestamp), then use the
// conservative end of the selected range.
export function salesOrderDueDate(closeAt, value) {
  const closeDate = pacificCloseDate(closeAt);
  return closeDate ? addUtcDays(closeDate, deliveryWindowEndWeeks(value) * 7).toISOString().slice(0, 10) : '';
}
