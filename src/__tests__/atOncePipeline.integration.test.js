import fs from 'fs';
import path from 'path';
import { calcSOStatus } from '../components';
import { calcOrderMargin } from '../pricing';
import { buildAtOnceReport } from '../atOnceMetrics';
import { shouldAutoCloseInvoicedSO } from '../lib/prepaidStoreFulfillment';

// Invoked by scripts/pgtest/verify_at_once_flow.cjs after the real SQL scenarios.
// Ordinary unit-test runs do not have a scratch PostgreSQL fixture to inspect.
const directory = process.env.AT_ONCE_SNAPSHOT_DIR;
const pipeline = directory ? describe : describe.skip;
pipeline('database lifecycle agrees with the actual dashboard and order page', () => {
  const files = directory ? fs.readdirSync(directory).filter(f => f.endsWith('.json')) : [];
  const snapshots = files.flatMap(file => JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')).map(s => ({...s, fixture:file})));
  test('both Club and All School fixture results are present', () => {
    expect(files.sort()).toEqual(['all_school.json','club.json']);
    expect(snapshots.length).toBeGreaterThanOrEqual(12);
  });
  test.each(snapshots)('$fixture: $label → $expectedStatus', snapshot => {
    const { order, expectedStatus, expectedValue, stores, customers } = snapshot;
    const actual = calcSOStatus(order);
    expect(actual).toBe(expectedStatus);
    const report = buildAtOnceReport({orders:[order],stores,customers,source:'24_7',now:new Date(),calcStatus:calcSOStatus,calcValue:o=>calcOrderMargin(o,[o]).rev});
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].status).toBe(expectedStatus);
    expect(report.period).toHaveLength(1);
    expect(report.intake).toBeCloseTo(expectedValue,2);
    expect(report.open).toHaveLength(expectedStatus === 'complete' ? 0 : 1);
    expect(report.stages.reduce((n,s)=>n+s.rows.length,0)).toBe(report.open.length);
    expect(shouldAutoCloseInvoicedSO(order,{status:actual,hasInvoices:true,hasRemainingQty:false})).toBe(false);
  });
});
