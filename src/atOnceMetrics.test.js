import { buildAtOnceReport, reportCsv } from './atOnceMetrics';
import { calcSOStatus } from './components';
const options = { now: new Date(2026, 9, 10), days: 7, calcStatus: o => o.stage, calcValue: o => o.value };
const order = (id, extra = {}) => ({ id, created_at: '2026-10-10T09:00:00Z', stage: 'need_order', value: 100, ...extra });
test('intake excludes booking/cancelled/deleted orders and future dates, while null types follow legacy At-Once semantics', () => {
  const report = buildAtOnceReport({ ...options, orders: [order('yes'), order('legacy', { order_type: null }), order('booking', { order_type: 'booking' }), order('cancel', { status: 'cancelled' }), order('deleted', { deleted_at: '2026-10-09' }), order('future', { created_at: '2026-10-11' })] });
  expect(report.intake).toBe(200); expect(report.period.map(r => r.id)).toEqual(['yes', 'legacy']);
});
test('date windows include today, handle US dates, and compare equal prior periods without overlap', () => {
  const report = buildAtOnceReport({ ...options, orders: [order('start', { created_at: '10/4/2026, 8:00:00 AM' }), order('prior', { created_at: '2026-10-03' }), order('priorStart', { created_at: '2026-09-27' }), order('old', { created_at: '2026-09-26' })] });
  expect(report.intake).toBe(100); expect(report.previousIntake).toBe(200); expect(report.daily.reduce((s, r) => s + r.value, 0)).toBe(100);
});
test('backlog includes older orders and overdue uses need-by date, not creation date or a completed status', () => {
  const report = buildAtOnceReport({ ...options, orders: [order('old', { created_at: '2025-01-01', expected_date: '2026-10-09', stage: 'needs_pull' }), order('done', { stage: 'complete', expected_date: '2026-10-01' }), order('today', { expected_date: '2026-10-10' })] });
  expect(report.open).toHaveLength(2); expect(report.overdue.map(r => r.id)).toEqual(['old']); expect(report.stages.find(s => s.id === 'needs_pull').rows[0].id).toBe('old');
});
test('24/7 classification requires actual store metadata and never includes OMG or club stores', () => {
  const stores = [{ id: 'school', name: 'School', org_type: 'all_school' }, { id: 'club', org_type: 'club' }];
  const orders = [order('s', { webstore_id: 'school' }), order('c', { webstore_id: 'club' }), order('o', { webstore_id: 'school', omg_store_id: 'OMG-1' }), order('unknown', { source: 'webstore' })];
  expect(buildAtOnceReport({ ...options, orders, stores, source: 'all_school' }).period.map(r => r.id)).toEqual(['s']);
  expect(buildAtOnceReport({ ...options, orders, stores, source: 'webstores' }).period).toHaveLength(3);
});
test('unavailable dates, values, and unknown stages remain explicit rather than silently disappearing', () => {
  const report = buildAtOnceReport({ ...options, orders: [order('bad', { created_at: 'bad', stage: 'new' }), order('noValue', { value: undefined })] });
  expect(report.missingDates).toBe(1); expect(report.missingValues).toBe(1); expect(report.intake).toBe(0); expect(report.stages.find(s => s.id === 'unknown').rows).toHaveLength(1);
});
test('stage counts partition the backlog and source groups reconcile to intake', () => {
  const report = buildAtOnceReport({ ...options, orders: [order('a'), order('b', { stage: 'in_production' }), order('c', { stage: 'complete' })] });
  expect(report.stages.reduce((sum, s) => sum + s.rows.length, 0)).toBe(report.open.length);
  expect(report.groups.reduce((sum, s) => sum + s.value, 0)).toBe(report.intake);
});
test('CSV quotes commas/newlines and neutralizes spreadsheet formulas', () => {
  const report = buildAtOnceReport({ ...options, customers: [{ id: 'c', name: '=HYPERLINK("bad")' }], orders: [order('id,1', { customer_id: 'c' })] });
  expect(reportCsv(report.rows)).toContain('"\'=HYPERLINK(""bad"")"'); expect(reportCsv(report.rows)).toContain('"id,1"');
});
test('real shared operational status drives purchasing, receiving, picking and production buckets', () => {
  const item = { sku: 'SHIRT', sizes: { M: 2 }, decorations: [{ kind: 'art' }] };
  const orders = [
    order('buy', { items: [item] }),
    order('receive', { items: [{ ...item, po_lines: [{ M: 2 }] }] }),
    order('pick', { items: [{ ...item, pick_lines: [{ M: 2, status: 'pick' }] }] }),
    order('prep', { items: [{ ...item, pick_lines: [{ M: 2, status: 'pulled' }] }] }),
    order('produce', { items: [item], jobs: [{ id: 'j1', prod_status: 'in_process' }] }),
    order('closed', { items: [item], status: 'complete' }),
  ];
  const report = buildAtOnceReport({ ...options, orders, calcStatus: calcSOStatus });
  expect(Object.fromEntries(report.rows.map(r => [r.id, r.status]))).toEqual({ buy: 'need_order', receive: 'waiting_receive', pick: 'needs_pull', prep: 'items_received', produce: 'in_production', closed: 'complete' });
});
