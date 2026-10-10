// Reporting is read-only. Operational stages always come from the shared SO status calculator.
export const STAGES = [
  ['need_order', 'Purchasing', '#bb7919'],
  ['waiting_receive', 'Receiving', '#b39668'],
  ['needs_pull', 'Picking', '#768ac2'],
  ['items_received', 'Production prep', '#6976b8'],
  ['in_production', 'In production', '#5269bc'],
  ['ready_to_invoice', 'Fulfillment / closeout', '#418f86'],
  ['complete', 'Complete', '#257b66'],
  ['unknown', 'Needs review', '#697586'],
];
export const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function portalDate(value) {
  if (!value) return null;
  const text = String(value);
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let date;
  if (us) date = new Date(Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]), +us[1] - 1, +us[2]);
  else if (iso) date = new Date(+iso[1], +iso[2] - 1, +iso[3]);
  else date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (iso && (date.getFullYear() !== +iso[1] || date.getMonth() !== +iso[2] - 1 || date.getDate() !== +iso[3])) return null;
  if (us && (date.getMonth() !== +us[1] - 1 || date.getDate() !== +us[2])) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}
const shift = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
export function buildAtOnceReport({ orders = [], customers = [], stores = [], calcStatus, calcValue, days = 30, source = 'all', storeId = 'all', now = new Date() }) {
  const today = portalDate(now), end = shift(today, 1), start = shift(today, 1 - days), previousStart = shift(start, -days);
  const customerMap = new Map(customers.map(c => [c.id, c]));
  const storeMap = new Map(stores.map(s => [s.id, s]));
  const rows = orders.filter(o => o && (!o.order_type || o.order_type === 'at_once') && !o.deleted_at && !['cancelled', 'deleted', 'void'].includes(o.status)).map(order => {
    const store = storeMap.get(order.webstore_id);
    const channel = order.omg_store_id ? 'omg' : order.webstore_id || order.source === 'webstore' ? (store?.org_type === 'all_school' ? 'all_school' : 'webstore') : 'direct';
    let status, value = null;
    try { status = calcStatus(order); } catch { status = 'unknown'; }
    if (!STAGES.some(s => s[0] === status)) status = 'unknown';
    try { const result = calcValue(order); if (result !== null && result !== undefined && Number.isFinite(Number(result))) value = Number(result); } catch { /* Missing financial data is not a zero sale. */ }
    const due = portalDate(order.expected_date);
    return { order, id: order.id, customer: customerMap.get(order.customer_id)?.name || 'Unassigned customer', store: store?.name || (order.webstore_id ? 'Store ' + order.webstore_id : ''), channel, status, value, created: portalDate(order.created_at), due, overdue: status !== 'complete' && !!due && due < today };
  }).filter(r => (source === 'all' || r.channel === source || (source === 'webstores' && ['all_school', 'webstore'].includes(r.channel))) && (storeId === 'all' || r.order.webstore_id === storeId));
  const period = rows.filter(r => r.created && r.created >= start && r.created < end);
  const previous = rows.filter(r => r.created && r.created >= previousStart && r.created < start);
  const open = rows.filter(r => r.status !== 'complete');
  const sum = list => list.reduce((total, r) => total + (r.value ?? 0), 0);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = shift(start, i), previousDate = shift(previousStart, i);
    const currentRows = period.filter(r => r.created.getTime() === date.getTime());
    const previousRows = previous.filter(r => r.created.getTime() === previousDate.getTime());
    return { date, previousDate, value: sum(currentRows), previous: sum(previousRows), count: currentRows.length };
  });
  const stages = STAGES.filter(([id]) => id !== 'complete').map(([id, label, color]) => ({ id, label, color, rows: open.filter(r => r.status === id) }));
  const groups = new Map();
  period.forEach(r => {
    const key = r.order.webstore_id || r.channel;
    if (!groups.has(key)) groups.set(key, { key, name: r.store || (r.channel === 'omg' ? 'OMG stores' : 'Direct orders'), count: 0, value: 0 });
    const group = groups.get(key); group.count++; group.value += r.value ?? 0;
  });
  return { rows, period, previous, open, stages, daily, start, end, intake: sum(period), previousIntake: sum(previous), openValue: sum(open), overdue: open.filter(r => r.overdue), missingDates: rows.filter(r => !r.created).length, missingValues: period.filter(r => r.value === null).length, groups: [...groups.values()].sort((a, b) => b.value - a.value) };
}
export function reportCsv(rows) {
  const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
  return [['Order', 'Customer', 'Store', 'Channel', 'Created', 'Need by', 'Stage', 'Order value', 'Overdue'], ...rows.map(r => [r.id, r.customer, r.store, r.channel, r.order.created_at, r.order.expected_date, STAGES.find(s => s[0] === r.status)?.[1], r.value, r.overdue ? 'Yes' : 'No'])].map(row => row.map(cell).join(',')).join('\r\n');
}
