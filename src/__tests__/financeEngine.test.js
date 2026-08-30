// financeEngine unit tests — pure fixtures, no DOM.
import {
  parseDate, monthKey, addMonths, billedByMonth, matchedPL, arAging,
  backlogSchedule, forecastRevenue, cashForecast, insights,
  portalStatement, combineStatement, profitByEntity, forecastAccuracy, buildSnapshotRows,
  receivablesDashboard, staleOrdersReport, arCashForecast,
  customerExposureReport, buildArSnapshotRows,
} from '../lib/financeEngine';

// Simple margin stub: rev = order.rev, cost = order.cost, shipRev = order.ship||0.
const calcMargin = (o) => ({ rev: o._rev || 0, cost: o._cost || 0, shipRev: o._ship || 0, margin: 0, pct: 0 });

describe('date helpers', () => {
  test('parses M/D/YYYY with time, M/D/YY, and ISO', () => {
    expect(monthKey(parseDate('6/1/2026 10:22:00'))).toBe('2026-06');
    expect(monthKey(parseDate('6/1/26'))).toBe('2026-06');
    expect(monthKey(parseDate('2026-07-31'))).toBe('2026-07');
    expect(parseDate('')).toBeNull();
    expect(parseDate('garbage')).toBeNull();
  });
  test('addMonths rolls the year', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('billedByMonth', () => {
  const histInvs = [
    { id: 'H1', date: '2026-07-03', total: 1070, tax: 70, status: 'open' },
    { id: 'H2', date: '2026-07-10', total: 500, tax: 0, status: 'void' },  // excluded
    { id: 'P1', date: '2026-07-12', total: 214, tax: 14, status: 'paid' }, // mirrors portal P1
  ];
  const invs = [
    { id: 'P1', date: '7/15/2026', total: 214, tax: 14, status: 'paid' },  // deduped (hist wins)
    { id: 'P2', date: '7/20/2026', total: 428, tax: 28, status: 'open' },
    { id: 'P3', date: '7/21/2026', total: 100, tax: 0, status: 'void' },   // excluded
    { id: 'P4', date: '8/01/2026', total: 50, tax: 0, status: 'open', deleted_at: '2026-08-02' }, // excluded
  ];
  test('dedupes on id, excludes void/deleted, splits sources, nets tax', () => {
    const rows = billedByMonth({ histInvs, invs });
    expect(rows).toHaveLength(1);
    const jul = rows[0];
    expect(jul.month).toBe('2026-07');
    expect(jul.ns).toBeCloseTo(1070 + 214);
    expect(jul.portal).toBeCloseTo(428);
    expect(jul.gross).toBeCloseTo(1712);
    expect(jul.net).toBeCloseTo(1712 - 70 - 14 - 28);
  });
});

describe('matchedPL', () => {
  const sos = [
    { id: 'SO-1', created_at: '6/1/2026', _rev: 1000, _ship: 0, _cost: 600 },
    { id: 'SO-2', created_at: '6/5/2026', _rev: 400, _ship: 100, _cost: 300 },
  ];
  const invs = [
    { id: 'I1', so_id: 'SO-1', date: '6/20/2026', total: 535, tax: 35, status: 'paid' },   // half of SO-1
    { id: 'I2', so_id: 'SO-1', date: '7/10/2026', total: 535, tax: 35, status: 'open' },   // other half
    { id: 'I3', so_id: 'SO-2', date: '7/12/2026', total: 500, tax: 0, status: 'open' },    // full SO-2
  ];
  test('allocates cost pro-rata to invoiced revenue by month', () => {
    const { months, wip } = matchedPL({ sos, invs, calcMargin });
    const jun = months.find((r) => r.month === '2026-06');
    const jul = months.find((r) => r.month === '2026-07');
    expect(jun.revenue).toBeCloseTo(500);
    expect(jun.cogs).toBeCloseTo(300);       // 600 × 500/1000
    expect(jul.revenue).toBeCloseTo(1000);   // 500 + 500
    expect(jul.cogs).toBeCloseTo(300 + 300); // SO-1 half + SO-2 full
    expect(jun.gp).toBeCloseTo(200);
    expect(wip).toBeCloseTo(0);              // both orders fully invoiced
  });
  test('uninvoiced cost lands in WIP, not COGS', () => {
    const { months, wip } = matchedPL({
      sos: [{ id: 'SO-3', created_at: '7/1/2026', _rev: 1000, _cost: 500 }],
      invs: [{ id: 'I9', so_id: 'SO-3', date: '7/20/2026', total: 250, tax: 0, status: 'open' }],
      calcMargin,
    });
    expect(months[0].cogs).toBeCloseTo(125);
    expect(wip).toBeCloseTo(375);
  });
});

describe('arAging', () => {
  const asOf = new Date(2026, 7, 26); // Aug 26 2026
  const invs = [
    { id: 'A', date: '8/26/2026', total: 100, paid: 0, status: 'open' },   // current
    { id: 'B', date: '8/10/2026', total: 200, paid: 50, status: 'partial' }, // 16d -> 1-30
    { id: 'C', date: '6/30/2026', total: 300, paid: 0, status: 'open' },   // 57d -> 31-60
    { id: 'D', date: '4/01/2026', total: 400, paid: 0, status: 'open' },   // 90+
    { id: 'E', date: '8/01/2026', total: 500, paid: 500, status: 'paid' }, // closed
  ];
  test('buckets open balances by age', () => {
    const { buckets, total } = arAging({ invs, asOf });
    expect(buckets.current).toBeCloseTo(100);
    expect(buckets.d1_30).toBeCloseTo(150);
    expect(buckets.d31_60).toBeCloseTo(300);
    expect(buckets.d90plus).toBeCloseTo(400);
    expect(total).toBeCloseTo(950);
  });
});

describe('receivablesDashboard', () => {
  const asOf = new Date(2026, 7, 29); // Aug 29 2026
  const reps = [
    { id: 'R1', name: 'Rep One', email: 'rep1@nsa.test' },
    { id: 'R2', name: 'Rep Two', email: 'rep2@nsa.test' },
  ];
  const customers = [
    { id: 'P', name: 'Parent', primary_rep_id: 'R2', payment_terms: 'net30', contacts: [{ role: 'Billing', name: 'AP', email: 'ap@parent.test' }] },
    { id: 'C1', name: 'Alpha', primary_rep_id: 'R1', payment_terms: 'net30', contacts: [{ role: 'Coach', name: 'Coach?', email: 'rep1@nsa.test' }] },
    { id: 'C2', name: 'Beta', parent_id: 'P', primary_rep_id: 'R2', payment_terms: 'net30', contacts: [{ role: 'Coach', name: 'Real Coach', email: 'coach@beta.test' }] },
  ];
  const invs = [
    // Portal row wins the I1 collision because it carries the live partial payment.
    { id: 'I1', customer_id: 'C1', date: '2026-06-01', due_date: '2026-06-30', total: 1000, paid: 700, status: 'partial' },
    { id: 'IP', customer_id: 'C1', date: '2026-07-01', total: 200, paid: 200, status: 'paid', payments: [{ amount: 200, date: '2026-08-10' }] },
  ];
  const histInvs = [
    { id: 'I1', customer_id: 'C1', date: '2026-06-01', total: 1000, status: 'open', raw_customer_name: 'Alpha duplicate' },
    // Temporary owner-directed fallback: an explicitly open legacy row uses face value.
    { id: 'H1', customer_id: 'C2', date: '2026-04-01', total: 500, status: 'open', raw_customer_name: 'Beta' },
    // A current remaining balance from the accounting source is safe to collect.
    { id: 'H2', customer_id: 'C2', date: '2026-04-15', total: 600, open_balance: 125, status: 'open', raw_customer_name: 'Beta' },
    { id: 'HC', customer_id: 'C2', date: '2026-03-01', total: 1000, status: 'closed', raw_customer_name: 'Beta' },
    // Paid NetSuite rows have no paid date and must not pollute days-to-pay.
    { id: 'HP', customer_id: 'C2', date: '2026-05-01', total: 900, status: 'paid' },
  ];

  test('dedupes sources, ages from due dates, and totals every rep', () => {
    const d = receivablesDashboard({ invs, histInvs, customers, reps, asOf });
    expect(d.openInvoices).toHaveLength(3);
    expect(d.kpis.total).toBeCloseTo(925); // I1 300 + H1 assumed 500 + H2 exact 125
    expect(d.kpis.pastDue).toBeCloseTo(925);
    expect(d.aging.buckets.d31_60).toBeCloseTo(300); // I1 is exactly 60 days late
    expect(d.aging.buckets.d90plus).toBeCloseTo(625);
    expect(d.repRows.find((r) => r.repId === 'R1').total).toBeCloseTo(300);
    expect(d.repRows.find((r) => r.repId === 'R2').total).toBeCloseTo(625);
    expect(d.assumedHistorical.map((r) => r.id)).toEqual(['H1']);
    expect(d.kpis.assumedHistoryCount).toBe(1);
    expect(d.kpis.assumedHistoryFaceValue).toBeCloseTo(500);
    expect(d.openInvoices.find((r) => r.id === 'H1').balanceBasis).toBe('assumed_full');
    expect(d.openInvoices.find((r) => r.id === 'H2').balance).toBe(125);
    expect(d.openInvoices.some((r) => r.id === 'HC')).toBe(false);
  });

  test('flags rep-address placeholders, honors inherited billing, and reports payment behavior', () => {
    const d = receivablesDashboard({ invs, histInvs, customers, reps, asOf });
    const alpha = d.accountsNeedingInfo.find((r) => r.customerId === 'C1');
    expect(alpha.issues).toContain('Coach email is a staff/rep address');
    expect(alpha.issues).toContain('No billing email');
    const betaOpen = d.accountRows.find((r) => r.customerId === 'C2');
    expect(betaOpen.billingEmail).toBe('ap@parent.test');
    expect(betaOpen.coachEmail).toBe('coach@beta.test');
    expect(d.kpis.noBillingExposure).toBeCloseTo(300);
    const r1Pay = d.repPayRows.find((r) => r.repId === 'R1');
    expect(r1Pay.count).toBe(1);
    expect(r1Pay.avgDays).toBe(40);
    expect(d.kpis.paySampleCount).toBe(1);
  });

  test('excludes portal credit memos and recognizes non-sales staff email placeholders', () => {
    const staffReps = [...reps, { id: 'A1', name: 'Accounting', email: 'accounting@nsa.test', role: 'accounting' }];
    const specialCustomers = [{ id: 'C3', name: 'Gamma', primary_rep_id: 'R1', payment_terms: 'net30', contacts: [{ role: 'Coach', email: 'accounting@nsa.test' }] }];
    const d = receivablesDashboard({
      invs: [
        { id: 'CM1', customer_id: 'C3', date: '2026-08-01', total: 250, paid: 0, status: 'open', type: 'credit_memo' },
        { id: 'I3', customer_id: 'C3', date: '2026-08-01', total: 100, paid: 0, status: 'open', type: 'invoice' },
      ],
      customers: specialCustomers, reps, staffReps, asOf,
    });
    expect(d.kpis.total).toBe(100);
    expect(d.openInvoices.map((i) => i.id)).toEqual(['I3']);
    expect(d.accountsNeedingInfo[0].issues).toContain('Coach email is a staff/rep address');
  });

  test('ages by calendar date across daylight-saving boundaries', () => {
    const d = receivablesDashboard({
      invs: [{ id: 'DST', customer_id: 'C1', date: '2026-02-01', due_date: '2026-03-08', total: 100, paid: 0, status: 'open' }],
      customers, reps, asOf: new Date(2026, 2, 9, 0, 0, 0),
    });
    expect(d.openInvoices[0].daysPastDue).toBe(1);
    expect(d.aging.buckets.d1_30).toBe(100);
  });
});

describe('operational AR forecast and exposure', () => {
  const asOf = new Date(2026, 7, 29);
  const openInvoices = [
    { id: 'I-DUE', customer_id: 'C1', repId: 'R1', balance: 1000, invoiceDate: new Date(2026, 6, 15), dueDate: new Date(2026, 7, 31), qb_invoice_id: 'qb1' },
    { id: 'I-LATE', customer_id: 'C2', repId: 'R2', balance: 2000, invoiceDate: new Date(2026, 3, 1), dueDate: new Date(2026, 4, 1), daysPastDue: 120 },
  ];

  test('projects 7/30/60 day cash without requiring a bank feed and reports QB coverage', () => {
    const f = arCashForecast({ openInvoices, accountPayRows: [{ customerId: 'C1', avgDays: 45 }], asOf });
    expect(f.total).toBe(3000);
    expect(f.forecast30).toBeGreaterThan(f.next7);
    expect(f.forecast60).toBeGreaterThan(f.forecast30);
    expect(f.beyond60).toBeGreaterThan(0);
    expect(f.qbLinked).toBe(1);
    expect(f.qbCoveragePct).toBeCloseTo(1 / 3);
  });

  test('keeps an invoice due today in the full seven-day forecast all day', () => {
    const midday = new Date(2026, 7, 29, 15, 30, 0);
    const f = arCashForecast({
      openInvoices: [{ id: 'TODAY', customer_id: 'C1', balance: 1234.49, invoiceDate: new Date(2026, 6, 30), dueDate: new Date(2026, 7, 29) }],
      accountPayRows: [], asOf: midday,
    });
    expect(f.rows[0].expectedIn).toBe(0);
    expect(f.next7).toBeCloseTo(1234.49);
    expect(f.forecast30).toBeCloseTo(1234.49);
  });

  test('combines open AR, completed uninvoiced work, and other open order value by account', () => {
    const ar = { accountRows: [{ customerId: 'C1', name: 'Alpha', repId: 'R1', total: 400, pastDue: 100 }] };
    const customers = [{ id: 'C1', name: 'Alpha', primary_rep_id: 'R1' }];
    const sos = [
      { id: 'SO-DONE', customer_id: 'C1', status: 'complete', _rev: 1000 },
      { id: 'SO-OPEN', customer_id: 'C1', status: 'in_production', _rev: 500 },
    ];
    const rows = customerExposureReport({ ar, sos, invs: [{ id: 'I1', so_id: 'SO-DONE', total: 250, tax: 0, status: 'open' }], customers, calcMargin, calcStatus: (so) => so.status });
    expect(rows[0]).toMatchObject({ customerId: 'C1', openAR: 400, completedUninvoiced: 750, openOrderValue: 500, totalExposure: 1650 });
  });

  test('builds team and rep daily snapshots with forecast and exposure values', () => {
    const ar = {
      openInvoices,
      accountPayRows: [],
    };
    const rows = buildArSnapshotRows({
      ar,
      exposureRows: [
        { repId: 'R1', completedUninvoiced: 300, openOrderValue: 700 },
        { repId: 'R2', completedUninvoiced: 50, openOrderValue: 100 },
      ],
      reps: [{ id: 'R1', name: 'Rep One' }, { id: 'R2', name: 'Rep Two' }],
      asOf,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ as_of_date: '2026-08-29', scope_id: 'team', total_ar: 3000, completed_uninvoiced: 350 });
    expect(rows.find((r) => r.scope_id === 'R1')).toMatchObject({ total_ar: 1000, completed_uninvoiced: 300, open_order_value: 700 });
  });
});

describe('staleOrdersReport', () => {
  const asOf = new Date(2026, 7, 29);
  const customers = [{ id: 'C1', name: 'Alpha', primary_rep_id: 'R1' }];
  const sos = [
    { id: 'SO-A', customer_id: 'C1', created_at: '2026-08-10', _rev: 1000, _status: 'ready_to_invoice', items: [] },
    { id: 'SO-B', customer_id: 'C1', created_at: '2026-07-01', _rev: 500, _status: 'need_order', items: [] },
    { id: 'SO-C', customer_id: 'C1', created_at: '2026-05-01', order_type: 'booking', _rev: 700, _status: 'booking', items: [] },
    { id: 'SO-D', customer_id: 'C1', created_at: '2026-08-01', _rev: 800, _status: 'ready_to_invoice',
      items: [{ sizes: { M: 10 }, pick_lines: [], po_lines: [{ received: { M: 5 } }] }],
      jobs: [{ id: 'J1', prod_status: 'completed' }] },
    { id: 'SO-E', customer_id: 'C1', created_at: '2026-06-01', _rev: 300, _status: 'need_order', items: [] },
  ];
  const invs = [
    { id: 'IA', so_id: 'SO-A', date: '2026-08-20', total: 400, tax: 0, paid: 0, status: 'open' },
    { id: 'IE', so_id: 'SO-E', date: '2026-07-01', total: 300, tax: 0, paid: 0, status: 'open' },
  ];
  const calcStatus = (so) => so._status;

  test('finds ready, mismatch, and 30-day non-booking orders while excluding bookings and fully invoiced orders', () => {
    const d = staleOrdersReport({ sos, invs, customers, calcMargin, calcStatus, asOf });
    expect(d.rows.map((r) => r.id).sort()).toEqual(['SO-A', 'SO-B', 'SO-D']);
    expect(d.rows.find((r) => r.id === 'SO-A').openToInvoice).toBeCloseTo(600);
    expect(d.rows.find((r) => r.id === 'SO-B').category).toBe('old_open');
    const mismatch = d.rows.find((r) => r.id === 'SO-D');
    expect(mismatch.category).toBe('system_mismatch');
    expect(mismatch.reasons.join(' ')).toMatch(/verify a receiving\/shipping mismatch/);
    expect(d.summary).toMatchObject({ count: 3, readyCount: 1, mismatchCount: 1, oldCount: 1 });
  });
});

describe('backlogSchedule + forecastRevenue', () => {
  const asOf = new Date(2026, 7, 26);
  const sos = [
    // fully invoiced (no backlog)
    { id: 'SO-A', created_at: '7/1/2026', _rev: 1000, _cost: 500 },
    // open with an expected date in Sept
    { id: 'SO-B', created_at: '8/10/2026', expected_date: '9/15/2026', _rev: 2000, _cost: 1000 },
    // open, no dates -> created + median lag
    { id: 'SO-C', created_at: '8/20/2026', _rev: 600, _cost: 300 },
    // overdue expected date -> clamps to current month
    { id: 'SO-D', created_at: '6/01/2026', expected_date: '7/01/2026', _rev: 800, _cost: 400 },
  ];
  const invs = [
    { id: 'IA', so_id: 'SO-A', date: '7/20/2026', total: 1000, tax: 0, status: 'paid' },
    { id: 'ID', so_id: 'SO-D', date: '7/25/2026', total: 400, tax: 0, status: 'open' },
  ];
  test('schedules uninvoiced value into billing months', () => {
    const b = backlogSchedule({ sos, invs, calcMargin, asOf });
    expect(b.totalValue).toBeCloseTo(2000 + 600 + 400);
    const sep = b.months.find((r) => r.month === '2026-09');
    expect(sep.value).toBeCloseTo(2000);
    const aug = b.months.find((r) => r.month === '2026-08');
    expect(aug.value).toBeCloseTo(400); // overdue expected date clamps to the current month
    // undated SO-C schedules at created + median lag (19d/54d history -> 54d = October)
    const oct = b.months.find((r) => r.month === '2026-10');
    expect(oct.value).toBeCloseTo(600);
  });
  test('forecast layers committed + new business with low<=base<=high', () => {
    const b = backlogSchedule({ sos, invs, calcMargin, asOf });
    const billedHistory = [
      { month: '2025-07', net: 100 }, { month: '2025-08', net: 100 }, { month: '2025-09', net: 100 },
    ];
    const f = forecastRevenue({ billedHistory, backlog: b, sos, calcMargin, asOf, horizon: 3 });
    expect(f.months).toHaveLength(3);
    for (const r of f.months) {
      expect(r.low).toBeLessThanOrEqual(r.base + 0.001);
      expect(r.base).toBeLessThanOrEqual(r.high + 0.001);
      expect(r.committed).toBeGreaterThanOrEqual(0);
    }
    expect(f.months[1].committed).toBeCloseTo(2000); // Sept backlog is the committed layer
  });
});

describe('cashForecast', () => {
  test('collects AR and forecast billings on the curve, excludes 90+', () => {
    const aging = { buckets: { current: 100, d1_30: 100, d31_60: 100, d61_90: 0, d90plus: 999 }, total: 1299 };
    const revForecast = { months: [{ base: 1000 }, { base: 0 }, { base: 0 }] };
    const cf = cashForecast({ aging, revForecast, asOf: new Date(2026, 7, 26) });
    expect(cf.months).toHaveLength(3);
    expect(cf.excluded90plus).toBe(999);
    const m0 = cf.months[0];
    expect(m0.fromNewBilling).toBeCloseTo(550); // 1000 × m0 0.55
    expect(m0.total).toBeGreaterThan(0);
  });
});

describe('insights', () => {
  test('flags margin drift, old AR, and YoY', () => {
    const asOf = new Date(2026, 7, 26);
    const pl = { months: [
      { month: '2026-06', revenue: 100000, cogs: 55000, gp: 45000, gpPct: 0.45 },
      { month: '2026-07', revenue: 100000, cogs: 55000, gp: 45000, gpPct: 0.45 },
      { month: '2026-08', revenue: 50000, cogs: 35000, gp: 15000, gpPct: 0.30 },
    ] };
    const aging = { buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 50000, d90plus: 20000 }, total: 70000 };
    const backlog = { totalValue: 500000, totalGp: 200000, orders: 100 };
    const billedHistory = [
      { month: '2025-06', net: 90000 }, { month: '2026-06', net: 100000 },
    ];
    const list = insights({ pl, aging, backlog, billedHistory, asOf });
    const texts = list.map((i) => i.text).join(' | ');
    expect(texts).toMatch(/gross margin/);
    expect(texts).toMatch(/over 60 days/);
    expect(texts).toMatch(/past 90 days/);
    expect(texts).toMatch(/Open order book/);
    expect(texts).toMatch(/vs the same period last year/);
  });
});

describe('portalStatement', () => {
  const sos = [
    { id: 'SO-1', created_at: '6/1/2026', _rev: 1000, _ship: 100, _cost: 600 },
    { id: 'SO-2', created_at: '7/5/2026', _rev: 500, _ship: 0, _cost: 250 },
  ];
  const invs = [
    // SO-1 half-invoiced in June ($550 net of $1,100 order value), $40 of it shipping
    { id: 'I1', so_id: 'SO-1', date: '6/20/2026', total: 585, tax: 35, shipping: 40, status: 'paid' },
    // SO-2 fully invoiced, but in August — beyond the July cutoff
    { id: 'I2', so_id: 'SO-2', date: '8/02/2026', total: 500, tax: 0, status: 'open' },
    { id: 'I3', so_id: 'SO-1', date: '6/22/2026', total: 99, tax: 0, status: 'void' }, // excluded
  ];
  test('nets tax, splits shipping, matches cost pro-rata, honors the cutoff', () => {
    const calcMargin = (o) => ({ rev: o._rev, cost: o._cost, shipRev: o._ship });
    const s = portalStatement({ sos, invs, calcMargin, through: '2026-07' });
    expect(s.sales).toBeCloseTo(585 - 35 - 40);   // 510
    expect(s.shipping).toBeCloseTo(40);
    expect(s.revenue).toBeCloseTo(550);
    expect(s.cogs).toBeCloseTo(600 * (550 / 1100)); // 300 — SO-2 not invoiced yet, contributes nothing
    expect(s.gp).toBeCloseTo(250);
  });
});

describe('combineStatement', () => {
  const legacy = {
    income: [
      { label: '40000 - Sales', amount: 1000, leaf: true },
      { label: '40100 - Shipping and Handling', amount: -20, leaf: true },
    ],
    cogs: [
      { label: '51300 - Purchases', amount: 600, leaf: true },
      { label: 'Total - group', amount: 600, kind: 'subtotal' }, // must NOT double-count
    ],
    expense: [{ label: '60000 - Salaries and Wages', amount: 200, leaf: true }],
  };
  test('folds portal into 40000/40100, adds a portal COGS line, sums leaves only', () => {
    const c = combineStatement({ legacy, portal: { sales: 500, shipping: 30, cogs: 260 } });
    expect(c.income.find((r) => /^40000/.test(r.label)).amount).toBeCloseTo(1500);
    expect(c.income.find((r) => /^40100/.test(r.label)).amount).toBeCloseTo(10);
    expect(c.totalIncome).toBeCloseTo(1510);
    expect(c.totalCogs).toBeCloseTo(860);          // 600 + 260, subtotal row ignored
    expect(c.grossProfit).toBeCloseTo(650);
    expect(c.totalExpense).toBeCloseTo(200);
    expect(c.netIncome).toBeCloseTo(450);
    expect(c.cogs.find((r) => r.portalLine).amount).toBeCloseTo(260);
  });
  test('real Jan–Jul snapshot reproduces the published statement', () => {
    const { LEGACY_STATEMENTS } = require('../data/legacyStatements');
    const c = combineStatement({
      legacy: LEGACY_STATEMENTS['2026-07'],
      portal: { sales: 832110, shipping: 27661, cogs: 490024 },
    });
    expect(c.totalIncome).toBeCloseTo(5329921.84, 1);
    expect(c.totalCogs).toBeCloseTo(3504343.65, 1);
    expect(c.grossProfit).toBeCloseTo(1825578.19, 1);
    expect(c.netIncome).toBeCloseTo(455922.77, 1);
  });
});

describe('profitByEntity', () => {
  const customers = [
    { id: 'C1', name: 'Alpha HS', primary_rep_id: 'R1' },
    { id: 'C2', name: 'Beta HS', primary_rep_id: 'R2' },
  ];
  const sos = [
    // Big biller, thin margin, only half invoiced
    { id: 'SO-1', customer_id: 'C1', created_at: '6/1/2026', _rev: 2000, _ship: 0, _cost: 1800 },
    // Smaller biller, fat margin, fully invoiced
    { id: 'SO-2', customer_id: 'C2', created_at: '6/2/2026', _rev: 800, _ship: 0, _cost: 300 },
  ];
  const invs = [
    { id: 'I1', so_id: 'SO-1', date: '6/20/2026', total: 1050, tax: 50, paid: 1050, status: 'paid' }, // $1000 net = half
    { id: 'I2', so_id: 'SO-2', date: '6/21/2026', total: 800, tax: 0, paid: 0, status: 'open' },      // full, unpaid
  ];
  const calcMargin = (o) => ({ rev: o._rev, cost: o._cost, shipRev: o._ship });

  test('recognizes only invoiced revenue with its matching share of cost', () => {
    const rows = profitByEntity({ sos, invs, calcMargin, customers, groupBy: 'customer' });
    const c1 = rows.find((r) => r.key === 'C1');
    expect(c1.revenue).toBeCloseTo(1000);
    expect(c1.cogs).toBeCloseTo(900);      // half of 1800, matching the half invoiced
    expect(c1.gp).toBeCloseTo(100);
    expect(c1.openValue).toBeCloseTo(1000); // the uninvoiced half
    const c2 = rows.find((r) => r.key === 'C2');
    expect(c2.gp).toBeCloseTo(500);
    expect(c2.openBalance).toBeCloseTo(800); // invoiced but unpaid
  });

  test('ranks by gross profit, not billings — the small account wins', () => {
    const rows = profitByEntity({ sos, invs, calcMargin, customers, groupBy: 'customer' });
    expect(rows[0].key).toBe('C2');
    expect(rows[0].revenue).toBeLessThan(rows[1].revenue); // billed less, earned more
  });

  test('groups by rep via the customer primary rep', () => {
    const rows = profitByEntity({ sos, invs, calcMargin, customers, groupBy: 'rep' });
    expect(rows.map((r) => r.key).sort()).toEqual(['R1', 'R2']);
    expect(rows.find((r) => r.key === 'R2').gp).toBeCloseTo(500);
  });
});

describe('forecastAccuracy', () => {
  const snapshots = [
    { as_of_month: '2026-06', target_month: '2026-06', horizon: 0, base: 100, low: 90, high: 115 },
    { as_of_month: '2026-06', target_month: '2026-07', horizon: 1, base: 200, low: 150, high: 230 },
    { as_of_month: '2026-06', target_month: '2026-09', horizon: 3, base: 400, low: 300, high: 460 }, // future — not scored
  ];
  const actualByMonth = new Map([['2026-06', 125], ['2026-07', 200]]);

  test('scores only completed months and computes error, bias and hit rate', () => {
    const a = forecastAccuracy({ snapshots, actualByMonth, asOf: new Date(2026, 7, 15) }); // Aug
    expect(a.scored).toBe(2);
    const jun = a.rows.find((r) => r.targetMonth === '2026-06');
    expect(jun.error).toBeCloseTo(-25);            // forecast 100 vs actual 125 — model ran low
    expect(jun.errorPct).toBeCloseTo(-0.2);
    expect(jun.withinBand).toBe(false);            // 125 above the 90–115 band
    const jul = a.rows.find((r) => r.targetMonth === '2026-07');
    expect(jul.error).toBeCloseTo(0);
    expect(jul.withinBand).toBe(true);
    expect(a.mape).toBeCloseTo(0.1);               // (20% + 0%) / 2
    expect(a.bias).toBeCloseTo(-0.1);              // signed — runs low on average
    expect(a.hitRate).toBeCloseTo(0.5);
  });

  test('returns nulls rather than NaN when nothing is scoreable yet', () => {
    const a = forecastAccuracy({ snapshots: [], actualByMonth, asOf: new Date(2026, 7, 15) });
    expect(a.scored).toBe(0);
    expect(a.mape).toBeNull();
    expect(a.bias).toBeNull();
  });
});

describe('buildSnapshotRows', () => {
  test('emits one row per forecast month carrying a shared KPI block', () => {
    const rows = buildSnapshotRows({
      revForecast: { months: [
        { month: '2026-08', committed: 100.4, newBusiness: 50.6, base: 151, low: 100, high: 173 },
        { month: '2026-09', committed: 40, newBusiness: 60, base: 100, low: 40, high: 115 },
      ] },
      aging: { total: 5000, buckets: { current: 3000, d1_30: 1000, d31_60: 500, d61_90: 300, d90plus: 200 } },
      backlog: { totalValue: 9000, totalGp: 4000, orders: 12 },
      pl: { months: [{ month: '2026-07', revenue: 1000, gp: 400 }], wip: 777 },
      asOf: new Date(2026, 7, 15),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ as_of_month: '2026-08', as_of_date: '2026-08-15', target_month: '2026-08', horizon: 0, base: 151 });
    expect(rows[1].horizon).toBe(1);
    expect(rows[0].kpis).toMatchObject({ arTotal: 5000, ar60plus: 500, backlogValue: 9000, wip: 777, ytdRev: 1000, ytdGp: 400 });
    expect(rows[0].kpis).toEqual(rows[1].kpis); // same block on every row
  });
});
