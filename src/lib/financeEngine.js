// ═══════════════════════════════════════════════════════════════════
// financeEngine — pure computation for the admin Financials page.
// No React, no I/O. Every function takes plain app-state shapes and
// returns plain data, so each is unit-testable in isolation.
//
// Pricing/margin math is NOT duplicated here: callers pass pricing.js's
// calcOrderMargin as `calcMargin` (one copy of the logic, per CLAUDE.md).
// ═══════════════════════════════════════════════════════════════════

const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Parse "M/D/YYYY[ time]", "M/D/YY", or "YYYY-MM-DD[...]" into a local Date (midnight).
export function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  const str = String(s);
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = str.split(' ')[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2]); }
  return null;
}

export const monthKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;

export function addMonths(key, n) {
  const [y, mo] = key.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return monthKey(d);
}

const liveInv = (i) => i && i.status !== 'void' && !i.deleted_at;
const liveSO = (o) => o && !o.deleted_at && o.status !== 'cancelled' && o.status !== 'deleted';

// ── Billed history ──────────────────────────────────────────────────
// One row per month: NetSuite-history billing + portal billing, gross and
// net of tax, deduped on document id (a hist row mirroring a portal invoice
// wins — same rule as the sales dashboard).
export function billedByMonth({ histInvs = [], invs = [] }) {
  const histIds = new Set(histInvs.map((h) => String(h.id)));
  const out = new Map();
  const add = (key, src, gross, tax) => {
    if (!key) return;
    const r = out.get(key) || { month: key, ns: 0, portal: 0, tax: 0, gross: 0, net: 0 };
    r[src] += gross; r.tax += tax; r.gross += gross; r.net += gross - tax;
    out.set(key, r);
  };
  for (const h of histInvs) {
    if (!h || h.status === 'void') continue;
    add(monthKey(parseDate(h.date || h.invoice_date)), 'ns', N(h.total), N(h.tax));
  }
  for (const p of invs) {
    if (!liveInv(p) || histIds.has(String(p.id))) continue;
    add(monthKey(parseDate(p.date)), 'portal', N(p.total), N(p.tax));
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// ── Matched P&L (portal) ────────────────────────────────────────────
// Revenue = portal invoices by invoice month, net of sales tax.
// COGS = each order's cost (from calcMargin), allocated pro-rata to its
// invoices; cost on uninvoiced work stays out (it's WIP, not COGS).
export function matchedPL({ sos = [], invs = [], calcMargin }) {
  const invBySo = new Map();
  for (const inv of invs) {
    if (!liveInv(inv)) continue;
    const arr = invBySo.get(inv.so_id) || [];
    arr.push(inv); invBySo.set(inv.so_id, arr);
  }
  const months = new Map();
  let wip = 0; // cost sitting on invoiced-incomplete orders (rough WIP signal)
  for (const so of sos) {
    if (!liveSO(so)) continue;
    const m = calcMargin(so);
    const ordVal = N(m.rev) + N(m.shipRev);
    const cost = N(m.cost);
    const soInvs = invBySo.get(so.id) || [];
    let invNet = 0;
    for (const inv of soInvs) {
      const net = N(inv.total) - N(inv.tax);
      invNet += net;
      const key = monthKey(parseDate(inv.date));
      if (!key) continue;
      const r = months.get(key) || { month: key, revenue: 0, cogs: 0 };
      r.revenue += net;
      r.cogs += ordVal > 0 ? cost * (net / ordVal) : 0;
      months.set(key, r);
    }
    if (ordVal > 0) wip += cost * Math.max(0, 1 - Math.min(1, invNet / ordVal));
  }
  const rows = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ({ ...r, gp: r.revenue - r.cogs, gpPct: r.revenue > 0 ? (r.revenue - r.cogs) / r.revenue : 0 }));
  return { months: rows, wip };
}

// ── AR aging (portal invoices) ──────────────────────────────────────
export function arAging({ invs = [], asOf }) {
  const today = asOf || new Date();
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  let total = 0, count = 0;
  for (const inv of invs) {
    if (!liveInv(inv)) continue;
    const open = N(inv.total) - N(inv.paid);
    if (open <= 0.005) continue;
    const d = parseDate(inv.date);
    if (!d) continue;
    const age = Math.floor((today - d) / 86400000);
    total += open; count++;
    if (age <= 0) buckets.current += open;
    else if (age <= 30) buckets.d1_30 += open;
    else if (age <= 60) buckets.d31_60 += open;
    else if (age <= 90) buckets.d61_90 += open;
    else buckets.d90plus += open;
  }
  return { buckets, total, count };
}

// ── Open order book, scheduled ──────────────────────────────────────
// Each live order's uninvoiced value + expected GP, bucketed into the month
// it is expected to bill: expected_ship/deliver date when set, else the
// order's expected_date, else order date + median completion lag.
export function backlogSchedule({ sos = [], invs = [], calcMargin, asOf }) {
  const today = asOf || new Date();
  const thisMonth = monthKey(today);
  const invBySo = new Map();
  for (const inv of invs) {
    if (!liveInv(inv)) continue;
    const arr = invBySo.get(inv.so_id) || [];
    arr.push(inv); invBySo.set(inv.so_id, arr);
  }
  // Median order→invoice lag (days) from completed history, for undated orders.
  const lags = [];
  for (const so of sos) {
    if (!liveSO(so)) continue;
    const od = parseDate(so.created_at);
    const first = (invBySo.get(so.id) || []).map((i) => parseDate(i.date)).filter(Boolean).sort((a, b) => a - b)[0];
    if (od && first && first >= od) lags.push(Math.round((first - od) / 86400000));
  }
  lags.sort((a, b) => a - b);
  const medianLag = lags.length ? lags[Math.floor(lags.length / 2)] : 21;

  const byMonth = new Map();
  let totalValue = 0, totalGp = 0, orders = 0;
  for (const so of sos) {
    if (!liveSO(so)) continue;
    const m = calcMargin(so);
    const ordVal = N(m.rev) + N(m.shipRev);
    if (ordVal <= 0) continue;
    const invNet = (invBySo.get(so.id) || []).reduce((a, i) => a + N(i.total) - N(i.tax), 0);
    const remaining = Math.max(0, ordVal - invNet);
    if (remaining < 1) continue;
    const gpShare = ordVal > 0 ? (ordVal - N(m.cost)) * (remaining / ordVal) : 0;
    let when = parseDate(so.expected_ship_date) || parseDate(so.ship_on_date)
      || parseDate(so.deliver_on_date) || parseDate(so.expected_date);
    if (!when) {
      const od = parseDate(so.created_at);
      when = od ? new Date(od.getFullYear(), od.getMonth(), od.getDate() + medianLag) : today;
    }
    let key = monthKey(when);
    if (key < thisMonth) key = thisMonth; // overdue work bills at the earliest, not in the past
    const r = byMonth.get(key) || { month: key, value: 0, gp: 0, orders: 0 };
    r.value += remaining; r.gp += gpShare; r.orders++;
    byMonth.set(key, r);
    totalValue += remaining; totalGp += gpShare; orders++;
  }
  return {
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    totalValue, totalGp, orders, medianLag,
  };
}

// ── Revenue forecast ────────────────────────────────────────────────
// Explainable two-layer model per future month:
//   committed = scheduled backlog billing (orders already written)
//   newBusiness = trailing-13-week order intake, reshaped by the prior
//     years' seasonal index for that month, discounted by how much of a
//     new order typically bills inside its own month.
// low = committed only · base = committed + newBusiness · high = base × 1.15
export function forecastRevenue({ billedHistory = [], backlog, sos = [], calcMargin, asOf, horizon = 4 }) {
  const today = asOf || new Date();
  const thisMonth = monthKey(today);

  // Seasonal index: each calendar month's share of its year (complete prior years only).
  const byYear = new Map();
  for (const r of billedHistory) {
    const [y, mo] = r.month.split('-');
    if (y >= String(today.getFullYear())) continue;
    const yr = byYear.get(y) || Array(13).fill(0);
    yr[+mo] += r.net; yr[0] += r.net;
    byYear.set(y, yr);
  }
  const seasonal = Array(13).fill(0); const seasonalN = Array(13).fill(0);
  for (const yr of byYear.values()) {
    if (yr[0] <= 0) continue;
    for (let mo = 1; mo <= 12; mo++) { seasonal[mo] += (yr[mo] / yr[0]) * 12; seasonalN[mo]++; }
  }
  const seasonalIdx = seasonal.map((v, i) => (i >= 1 && seasonalN[i] ? v / seasonalN[i] : 1)); // 1 = average month

  // Trailing-13-week new-order intake (order value written per week).
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 91);
  let intake = 0;
  for (const so of sos) {
    if (!liveSO(so)) continue;
    const d = parseDate(so.created_at);
    if (!d || d < cutoff || d > today) continue;
    const m = calcMargin(so);
    intake += N(m.rev) + N(m.shipRev);
  }
  const weeklyIntake = intake / 13;
  // Seasonal index of the trailing window, to de-seasonalize the run rate.
  const trailingIdx = (seasonalIdx[cutoff.getMonth() + 1] + seasonalIdx[today.getMonth() + 1]) / 2 || 1;
  const baseWeekly = trailingIdx > 0 ? weeklyIntake / trailingIdx : weeklyIntake;
  const SAME_MONTH_BILL = 0.35; // share of a new order that typically bills inside its own month

  const backlogByMonth = new Map((backlog?.months || []).map((r) => [r.month, r]));
  const rows = [];
  for (let i = 0; i < horizon; i++) {
    const key = addMonths(thisMonth, i);
    const mo = +key.split('-')[1];
    const committed = backlogByMonth.get(key)?.value || 0;
    // New business converts progressively: month 0 partial-month remaining, later months full.
    const monthWeeks = 4.345;
    const remainFrac = i === 0 ? Math.max(0, 1 - (today.getDate() / 30)) : 1;
    const newBiz = baseWeekly * monthWeeks * (seasonalIdx[mo] || 1) * remainFrac * (i === 0 ? SAME_MONTH_BILL : 0.75);
    rows.push({
      month: key, committed, newBusiness: newBiz,
      low: committed, base: committed + newBiz, high: (committed + newBiz) * 1.15,
    });
  }
  return { months: rows, seasonalIdx, weeklyIntake, medianLag: backlog?.medianLag };
}

// ── Cash-in forecast ────────────────────────────────────────────────
// Open AR collected on an aging curve + forecast billings collected on the
// same curve. Curve = share collected within 30/60/90 days of invoicing.
export function cashForecast({ aging, revForecast, curve = { m0: 0.55, m1: 0.30, m2: 0.10 }, asOf }) {
  const b = aging.buckets;
  const rows = [];
  const key0 = monthKey(asOf || new Date());
  // Existing AR: assume current+1-30 collect ~[m0,m1,m2] over the next 3 months,
  // older buckets collect one cycle later; 90+ is excluded (doubtful until proven).
  const fresh = b.current + b.d1_30, mid = b.d31_60, old = b.d61_90;
  const arIn = [fresh * curve.m0 + mid * (curve.m0 + curve.m1) / 2 + old * curve.m1,
    fresh * curve.m1 + mid * curve.m1 + old * curve.m2,
    fresh * curve.m2 + mid * curve.m2];
  for (let i = 0; i < 3; i++) {
    let billedIn = 0;
    for (let j = 0; j <= i; j++) {
      const f = revForecast.months[j];
      if (!f) continue;
      const lag = i - j;
      const share = lag === 0 ? curve.m0 : lag === 1 ? curve.m1 : lag === 2 ? curve.m2 : 0;
      billedIn += f.base * share;
    }
    rows.push({ month: addMonths(key0, i), fromAR: arIn[i] || 0, fromNewBilling: billedIn, total: (arIn[i] || 0) + billedIn });
  }
  return { months: rows, excluded90plus: b.d90plus };
}

// ── Insights — plain-English flags, each tied to a number ───────────
export function insights({ pl, aging, backlog, billedHistory = [], asOf }) {
  const out = [];
  const today = asOf || new Date();
  const thisKey = monthKey(today);
  const rows = pl?.months || [];
  const cur = rows.find((r) => r.month === thisKey);
  const ytd = rows.filter((r) => r.month < thisKey && r.month.startsWith(String(today.getFullYear())));
  const ytdRev = ytd.reduce((a, r) => a + r.revenue, 0);
  const ytdGp = ytd.reduce((a, r) => a + r.gp, 0);
  const ytdPct = ytdRev > 0 ? ytdGp / ytdRev : 0;
  if (cur && ytdRev > 0 && cur.revenue > 5000 && Math.abs(cur.gpPct - ytdPct) > 0.05) {
    out.push({
      level: cur.gpPct < ytdPct ? 'warn' : 'good',
      text: `This month's gross margin is ${(cur.gpPct * 100).toFixed(1)}% vs ${(ytdPct * 100).toFixed(1)}% YTD — ${cur.gpPct < ytdPct ? 'check for unposted revenue or heavy low-margin work' : 'running ahead of the year'}.`,
    });
  }
  if (aging && aging.total > 0) {
    const late = aging.buckets.d61_90 + aging.buckets.d90plus;
    if (late / aging.total > 0.10) out.push({ level: 'warn', text: `$${Math.round(late).toLocaleString()} of receivables (${Math.round(late / aging.total * 100)}%) is over 60 days old — worth a collections pass.` });
    if (aging.buckets.d90plus > 10000) out.push({ level: 'critical', text: `$${Math.round(aging.buckets.d90plus).toLocaleString()} of AR is past 90 days; the cash forecast excludes it until collected.` });
  }
  if (backlog && backlog.totalValue > 0) {
    out.push({ level: 'info', text: `Open order book: $${Math.round(backlog.totalValue).toLocaleString()} across ${backlog.orders} orders (~$${Math.round(backlog.totalGp).toLocaleString()} gross profit) — committed work not yet in revenue.` });
  }
  // Year-over-year, same months, from billed history.
  const y = today.getFullYear();
  const ytdThis = billedHistory.filter((r) => r.month.startsWith(String(y)) && r.month <= thisKey).reduce((a, r) => a + r.net, 0);
  const ytdLast = billedHistory.filter((r) => r.month.startsWith(String(y - 1)) && r.month <= `${y - 1}${thisKey.slice(4)}`).reduce((a, r) => a + r.net, 0);
  if (ytdThis > 0 && ytdLast > 0) {
    const d = (ytdThis / ytdLast - 1) * 100;
    out.push({ level: d >= 0 ? 'good' : 'warn', text: `Billed ${d >= 0 ? '+' : ''}${d.toFixed(0)}% vs the same period last year ($${Math.round(ytdThis).toLocaleString()} vs $${Math.round(ytdLast).toLocaleString()}, net of tax).` });
  }
  return out;
}

// ── Income statement (account-line P&L) ─────────────────────────────
// portalStatement: the portal side of the statement for Jan 1 through the
// end of `through` (a 'YYYY-MM' key). Revenue = invoices dated in the
// period, net of sales tax, split into product/deco sales vs shipping
// billed. COGS is matched: each order's cost (from calcMargin) recognized
// only in proportion to the revenue invoiced by the cutoff — cost on
// in-production work stays in WIP, exactly like matchedPL.
export function portalStatement({ sos = [], invs = [], calcMargin, through }) {
  let sales = 0, shipping = 0;
  const invBySo = new Map();
  for (const inv of invs) {
    if (!liveInv(inv)) continue;
    const key = monthKey(parseDate(inv.date));
    if (!key || key > through) continue;
    const net = N(inv.total) - N(inv.tax);
    const ship = N(inv.shipping);
    sales += net - ship; shipping += ship;
    const arr = invBySo.get(inv.so_id) || [];
    arr.push(net); invBySo.set(inv.so_id, arr);
  }
  let cogs = 0;
  for (const so of sos) {
    if (!liveSO(so)) continue;
    const nets = invBySo.get(so.id);
    if (!nets) continue;
    const m = calcMargin(so);
    const ordVal = N(m.rev) + N(m.shipRev);
    if (ordVal <= 0) continue;
    const invNet = nets.reduce((a, v) => a + v, 0);
    cogs += N(m.cost) * Math.min(1, invNet / ordVal);
  }
  return { sales, shipping, revenue: sales + shipping, cogs, gp: sales + shipping - cogs };
}

// combineStatement: merge a legacy (NetSuite) statement snapshot with the
// portal's computed side into one account-line income statement.
// Portal sales/shipping fold into the matching 40000/40100 rows (each row
// carries `portalAmount` so the UI can annotate the inclusion); portal COGS
// is its own labeled line. Section totals sum leaf rows only.
export function combineStatement({ legacy, portal }) {
  const secTotal = (rows) => rows.reduce((a, r) => a + (r.leaf ? N(r.amount) : 0), 0);
  const income = legacy.income.map((r) => {
    if (r.leaf && /^40000\b/.test(r.label)) return { ...r, amount: N(r.amount) + portal.sales, portalAmount: portal.sales };
    if (r.leaf && /^40100\b/.test(r.label)) return { ...r, amount: N(r.amount) + portal.shipping, portalAmount: portal.shipping };
    return { ...r };
  });
  const cogs = [...legacy.cogs.map((r) => ({ ...r })),
    { label: '51900 - Portal Cost of Sales (matched)', amount: portal.cogs, leaf: true, portalLine: true }];
  const expense = legacy.expense.map((r) => ({ ...r }));
  const totalIncome = secTotal(income);
  const totalCogs = secTotal(cogs);
  const grossProfit = totalIncome - totalCogs;
  const totalExpense = secTotal(expense);
  const netIncome = grossProfit - totalExpense;
  return { income, cogs, expense, totalIncome, totalCogs, grossProfit, totalExpense, netIncome };
}
