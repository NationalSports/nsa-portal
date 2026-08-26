// financeEngine unit tests — pure fixtures, no DOM.
import {
  parseDate, monthKey, addMonths, billedByMonth, matchedPL, arAging,
  backlogSchedule, forecastRevenue, cashForecast, insights,
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
