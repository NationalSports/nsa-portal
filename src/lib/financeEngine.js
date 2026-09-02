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
  // App-created rows use toLocaleString(), which places a comma between the
  // date and time ("5/5/2026, 2:47:17 PM"). Match the leading calendar date
  // directly so those real sales-order dates do not render as unknown.
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D|$)/);
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

// ── Detailed A/R dashboard ────────────────────────────────────────
// Combines portal invoices with the read-only NetSuite history. Portal rows win
// a document-number collision because they carry the freshest payment detail;
// this is especially important after a payment is recorded in the portal but
// before the next accounting import. Aging is based on DUE date, not invoice
// date: an invoice inside its terms is current, while daysPastDue measures the
// actual collections delay.
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const termsDays = (v) => {
  const s = String(v || 'net30').toLowerCase();
  if (s.includes('prepay') || s.includes('due on receipt')) return 0;
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : 30;
};

// Resolve an account to the top of its customer family. Most NSA data has one
// parent level, but walking the chain also handles imported hierarchies without
// double-counting. A cycle or a missing parent safely leaves the last known id.
export function customerFamilyId(customerId, customers = []) {
  if (!customerId) return customerId;
  const byId = new Map(customers.map((c) => [c.id, c]));
  let id = customerId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const parentId = byId.get(id)?.parent_id;
    if (!parentId || !byId.has(parentId)) break;
    id = parentId;
  }
  return id;
}

// Roll operational account totals to parent families. This deliberately does
// not merge workflow state: chat, email, TODOs, and collection ownership remain
// attached to a real child account and the UI drills down before acting.
export function rollupCustomerAccounts({ rows = [], customers = [] }) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const sums = ['openAR', 'pastDue', 'd60plus', 'd90plus', 'completedUninvoiced', 'openOrderValue', 'totalExposure', 'invoiceCount'];
  const groups = new Map();
  rows.forEach((row, index) => {
    const familyId = customerFamilyId(row.customerId, customers) || `unlinked:${row.name || index}`;
    const parent = byId.get(familyId);
    let group = groups.get(familyId);
    if (!group) {
      group = {
        customerId: familyId.startsWith?.('unlinked:') ? row.customerId : familyId,
        name: parent?.name || parent?.alpha_tag || row.name || 'Unknown account',
        repId: parent?.primary_rep_id || row.repId || null,
        memberIds: [], memberNames: [], repIds: [], issues: [], oldestDays: 0,
        workflow: null, isParentRollup: true,
      };
      sums.forEach((key) => { group[key] = 0; });
      groups.set(familyId, group);
    }
    sums.forEach((key) => { group[key] += N(row[key]); });
    group.oldestDays = Math.max(group.oldestDays, N(row.oldestDays));
    if (row.customerId && !group.memberIds.includes(row.customerId)) group.memberIds.push(row.customerId);
    if (row.name && !group.memberNames.includes(row.name)) group.memberNames.push(row.name);
    if (row.repId && !group.repIds.includes(row.repId)) group.repIds.push(row.repId);
    (row.issues || []).forEach((issue) => { if (!group.issues.includes(issue)) group.issues.push(issue); });
  });
  return [...groups.values()].map((row) => ({
    ...row,
    childCount: row.memberIds.filter((id) => id !== row.customerId).length,
    searchText: `${row.name} ${row.customerId || ''} ${row.memberNames.join(' ')}`.toLowerCase(),
  }));
}

// Payment speed must be weighted by invoice sample count, not averaged across
// child-account averages. Summing totalDays/count preserves the exact result.
export function rollupCustomerPayments({ rows = [], customers = [] }) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const groups = new Map();
  rows.forEach((row, index) => {
    const familyId = customerFamilyId(row.customerId, customers) || `unlinked:${row.name || index}`;
    const parent = byId.get(familyId);
    const group = groups.get(familyId) || {
      key: familyId, customerId: familyId.startsWith?.('unlinked:') ? row.customerId : familyId,
      name: parent?.name || parent?.alpha_tag || row.name || 'Unknown account',
      repId: parent?.primary_rep_id || row.repId || null,
      termsDays: termsDays(parent?.payment_terms), totalDays: 0, count: 0,
      maxDays: 0, totalPaid: 0, fallbackCount: 0, memberIds: [], isParentRollup: true,
    };
    group.totalDays += N(row.totalDays);
    group.count += N(row.count);
    group.maxDays = Math.max(group.maxDays, N(row.maxDays));
    group.totalPaid += N(row.totalPaid);
    group.fallbackCount += N(row.fallbackCount);
    if (row.customerId && !group.memberIds.includes(row.customerId)) group.memberIds.push(row.customerId);
    groups.set(familyId, group);
  });
  return [...groups.values()].map((row) => ({
    ...row, avgDays: row.count ? row.totalDays / row.count : null,
    childCount: row.memberIds.filter((id) => id !== row.customerId).length,
  })).sort((a, b) => (b.avgDays || 0) - (a.avgDays || 0));
}
const addDays = (d, n) => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + n) : null;
// Financial aging is a calendar-date calculation, not an elapsed-hours
// calculation. Converting local date parts to UTC ordinals keeps "due today"
// at zero all day and avoids one-day errors across daylight-saving changes.
const dayOrdinal = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
const daysBetween = (a, b) => dayOrdinal(a) - dayOrdinal(b);
const emailKey = (v) => String(v || '').trim().toLowerCase();

function contactHealth(customer, customerById, staffEmails) {
  const own = Array.isArray(customer?.contacts) ? customer.contacts : [];
  const parent = customer?.parent_id ? customerById.get(customer.parent_id) : null;
  const inherited = Array.isArray(parent?.contacts)
    ? parent.contacts.filter((c) => /billing/i.test(String(c?.role || '')))
    : [];
  const all = [...own, ...inherited];
  const billing = all.filter((c) => /billing/i.test(String(c?.role || '')) && validEmail(c?.email));
  const coachRole = (c, i) => /coach|athletic\s*director|manager|primary/i.test(String(c?.role || ''))
    || (!String(c?.role || '').trim() && i === 0);
  const coachCandidates = own.filter(coachRole);
  const coach = coachCandidates.filter((c) => validEmail(c?.email) && !staffEmails.has(emailKey(c.email)));
  const coachStaff = coachCandidates.filter((c) => validEmail(c?.email) && staffEmails.has(emailKey(c.email)));
  const invalid = own.filter((c) => c?.email && !validEmail(c.email));
  const issues = [];
  if (!coach.length) issues.push(coachStaff.length ? 'Coach email is a staff/rep address' : 'No coach email');
  if (!billing.length) issues.push('No billing email');
  if (!customer?.primary_rep_id) issues.push('No account rep');
  if (!customer?.payment_terms) issues.push('No payment terms');
  if (invalid.length) issues.push('Invalid contact email');
  return {
    coachEmail: coach[0]?.email || '', billingEmail: billing[0]?.email || '',
    coachUsesStaffEmail: coachStaff.length > 0, invalidEmails: invalid.length, issues,
  };
}

export function receivablesDashboard({
  invs = [], histInvs = [], sos = [], customers = [], reps = [], staffReps = reps, asOf,
}) {
  const today = asOf || new Date();
  const customerById = new Map(customers.filter(Boolean).map((c) => [c.id, c]));
  const soById = new Map(sos.filter(Boolean).map((s) => [s.id, s]));
  const repById = new Map(reps.filter(Boolean).map((r) => [r.id, r]));
  const repByName = new Map(reps.filter((r) => r?.name).map((r) => [r.name.trim().toLowerCase(), r]));
  const staffEmails = new Set(staffReps.filter((r) => validEmail(r?.email)).map((r) => emailKey(r.email)));
  const portalIds = new Set(invs.filter(Boolean).map((i) => String(i.id)));
  const sourceRows = [
    ...invs.filter(Boolean).map((i) => ({ ...i, _source: 'Portal' })),
    ...histInvs.filter((i) => i && !portalIds.has(String(i.id))).map((i) => ({ ...i, _source: 'NetSuite' })),
  ];

  const resolveRepId = (inv, customer, so) => inv.rep_id
    || customer?.primary_rep_id
    || repByName.get(String(inv.rep_name || '').trim().toLowerCase())?.id
    || so?.created_by
    || null;
  const openInvoices = [];
  const assumedHistorical = [];
  for (const inv of sourceRows) {
    if (!liveInv(inv) || inv.status === 'cancelled') continue;
    const invoiceType = String(inv.invoice_type || inv.type || 'invoice').trim().toLowerCase().replace(/\s+/g, '_');
    if (invoiceType !== 'invoice') continue;
    const total = N(inv.total);
    const customer = customerById.get(inv.customer_id);
    const so = soById.get(inv.so_id);
    const repId = resolveRepId(inv, customer, so);

    // Until the NetSuite export includes Amount Remaining, the owner-directed
    // fallback is to treat invoices explicitly marked open as fully open. Keep
    // the assumption attached to every affected row so the UI can disclose
    // exactly how much AR/forecast/exposure is based on face value. A supplied
    // open_balance always wins and correctly handles partial payments.
    const explicitBalance = [
      inv.open_balance, inv.balance_remaining, inv.remaining_balance,
      inv.amount_remaining, inv.balance_due,
    ].find((v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)));
    const normalizedStatus = String(inv.status || '').trim().toLowerCase().replace(/\s+/g, '_');
    const openStatuses = ['open', 'partial', 'partially_paid'];
    if (inv._source === 'NetSuite' && !openStatuses.includes(normalizedStatus)) continue;
    const usesAssumedBalance = inv._source === 'NetSuite' && explicitBalance === undefined;
    // Pending or unfamiliar statuses are never silently converted into debt.
    if (usesAssumedBalance) {
      assumedHistorical.push({
        ...inv, source: inv._source, total, faceValue: total, repId, customer,
        customerName: customer?.name || inv.raw_customer_name || 'Unknown account',
      });
    }
    const balance = inv._source === 'NetSuite' ? (usesAssumedBalance ? total : N(explicitBalance)) : total - N(inv.paid);
    const paid = inv._source === 'NetSuite' ? Math.max(0, total - balance) : N(inv.paid);
    if (balance <= 0.005 || inv.status === 'paid') continue;
    const invoiceDate = parseDate(inv.date || inv.invoice_date);
    const dueDate = parseDate(inv.due_date) || addDays(invoiceDate, termsDays(customer?.payment_terms));
    const rawPastDue = dueDate ? daysBetween(today, dueDate) : 0;
    const daysPastDue = Math.max(0, rawPastDue);
    const ageDays = invoiceDate ? Math.max(0, daysBetween(today, invoiceDate)) : 0;
    openInvoices.push({
      ...inv, source: inv._source, total, paid, balance, balanceBasis: usesAssumedBalance ? 'assumed_full' : 'explicit', invoiceDate, dueDate,
      daysPastDue, ageDays, repId, customer,
      customerName: customer?.name || inv.raw_customer_name || 'Unknown account',
    });
  }

  const emptyAging = () => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });
  const addAging = (b, inv) => {
    if (inv.daysPastDue <= 0) b.current += inv.balance;
    else if (inv.daysPastDue <= 30) b.d1_30 += inv.balance;
    else if (inv.daysPastDue <= 60) b.d31_60 += inv.balance;
    else if (inv.daysPastDue <= 90) b.d61_90 += inv.balance;
    else b.d90plus += inv.balance;
  };
  const buckets = emptyAging();
  openInvoices.forEach((i) => addAging(buckets, i));
  const aging = {
    buckets,
    total: openInvoices.reduce((a, i) => a + i.balance, 0),
    count: openInvoices.length,
  };

  // One row for every sales rep supplied by the caller, including zero-balance
  // reps, plus Unassigned when an invoice cannot be tied to an account owner.
  const repMap = new Map(reps.map((r) => [r.id, {
    repId: r.id, name: r.name || r.id, total: 0, pastDue: 0, dueNext7: 0,
    invoiceCount: 0, oldestDays: 0, aging: emptyAging(), customerIds: new Set(),
  }]));
  for (const inv of openInvoices) {
    const key = inv.repId || '__unassigned__';
    const rep = repMap.get(key) || {
      repId: key, name: key === '__unassigned__' ? 'Unassigned' : (repById.get(key)?.name || key),
      total: 0, pastDue: 0, dueNext7: 0, invoiceCount: 0, oldestDays: 0,
      aging: emptyAging(), customerIds: new Set(),
    };
    rep.total += inv.balance;
    if (inv.daysPastDue > 0) rep.pastDue += inv.balance;
    const untilDue = inv.dueDate ? daysBetween(inv.dueDate, today) : null;
    if (untilDue != null && untilDue >= 0 && untilDue <= 7) rep.dueNext7 += inv.balance;
    rep.invoiceCount++;
    rep.oldestDays = Math.max(rep.oldestDays, inv.daysPastDue);
    if (inv.customer_id) rep.customerIds.add(inv.customer_id);
    addAging(rep.aging, inv);
    repMap.set(key, rep);
  }
  const repRows = [...repMap.values()].map((r) => ({
    ...r, accountCount: r.customerIds.size,
    current: r.aging.current, d1_30: r.aging.d1_30, d31_60: r.aging.d31_60,
    d61_90: r.aging.d61_90, d90plus: r.aging.d90plus,
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const accountMap = new Map();
  for (const inv of openInvoices) {
    const key = inv.customer_id || `raw:${inv.customerName}`;
    const customer = inv.customer;
    const row = accountMap.get(key) || {
      customerId: inv.customer_id || null, name: inv.customerName, repId: inv.repId,
      total: 0, pastDue: 0, d60plus: 0, d90plus: 0, invoiceCount: 0,
      oldestDays: 0, invoices: [], customer,
    };
    row.total += inv.balance;
    if (inv.daysPastDue > 0) row.pastDue += inv.balance;
    if (inv.daysPastDue > 60) row.d60plus += inv.balance;
    if (inv.daysPastDue > 90) row.d90plus += inv.balance;
    row.invoiceCount++;
    row.oldestDays = Math.max(row.oldestDays, inv.daysPastDue);
    row.invoices.push(inv);
    accountMap.set(key, row);
  }

  // Payment behavior uses only records with an observable final-payment date.
  // NetSuite history has no paid date and is deliberately excluded rather than
  // pretending the invoice date was the payment date (which would bias averages).
  const paidSamples = [];
  for (const inv of invs) {
    if (!liveInv(inv)) continue;
    const total = N(inv.total), paid = N(inv.paid);
    if (!(inv.status === 'paid' || (total > 0 && paid >= total - 0.005))) continue;
    const invoiceDate = parseDate(inv.date);
    if (!invoiceDate) continue;
    const paymentDates = (Array.isArray(inv.payments) ? inv.payments : [])
      .map((p) => parseDate(p?.date || p?.paid_at)).filter(Boolean);
    const explicit = parseDate(inv.paid_date || inv.paid_at);
    if (explicit) paymentDates.push(explicit);
    // updated_at is the established legacy fallback for older portal invoices.
    const fallback = !paymentDates.length ? parseDate(inv.updated_at) : null;
    const finalPaid = paymentDates.sort((a, b) => b - a)[0] || fallback;
    if (!finalPaid || finalPaid < invoiceDate) continue;
    const customer = customerById.get(inv.customer_id);
    const so = soById.get(inv.so_id);
    const repId = resolveRepId(inv, customer, so);
    paidSamples.push({
      invoiceId: inv.id, customerId: inv.customer_id, customerName: customer?.name || 'Unknown account',
      repId, days: Math.max(0, daysBetween(finalPaid, invoiceDate)), total,
      usedFallbackDate: !paymentDates.length,
    });
  }
  const summarizePayments = (samples, keyOf, seed = []) => {
    const rows = new Map(seed);
    for (const s of samples) {
      const key = keyOf(s);
      if (!key) continue;
      const r = rows.get(key) || { key, totalDays: 0, count: 0, maxDays: 0, totalPaid: 0, fallbackCount: 0 };
      r.totalDays += s.days; r.count++; r.maxDays = Math.max(r.maxDays, s.days);
      r.totalPaid += s.total; if (s.usedFallbackDate) r.fallbackCount++;
      rows.set(key, r);
    }
    return [...rows.values()].map((r) => ({ ...r, avgDays: r.count ? r.totalDays / r.count : null }));
  };
  const accountPayRows = summarizePayments(paidSamples, (s) => s.customerId)
    .map((r) => {
      const c = customerById.get(r.key);
      return { ...r, customerId: r.key, name: c?.name || 'Unknown account', repId: c?.primary_rep_id || null, termsDays: termsDays(c?.payment_terms) };
    }).sort((a, b) => (b.avgDays || 0) - (a.avgDays || 0));
  const accountPayById = new Map(accountPayRows.map((r) => [r.customerId, r]));
  const repPayRows = summarizePayments(paidSamples, (s) => s.repId,
    reps.map((r) => [r.id, { key: r.id, totalDays: 0, count: 0, maxDays: 0, totalPaid: 0, fallbackCount: 0 }]))
    .map((r) => {
      const owned = accountPayRows.filter((a) => a.repId === r.key && a.count > 0);
      const worst = owned.sort((a, b) => (b.avgDays || 0) - (a.avgDays || 0))[0] || null;
      return { ...r, repId: r.key, name: repById.get(r.key)?.name || r.key, worstAccount: worst };
    }).sort((a, b) => (b.avgDays || -1) - (a.avgDays || -1));

  const accountRows = [...accountMap.values()].map((r) => {
    const health = r.customer
      ? contactHealth(r.customer, customerById, staffEmails)
      : { coachEmail: '', billingEmail: '', coachUsesStaffEmail: false, invalidEmails: 0, issues: ['Customer record not linked'] };
    const pay = accountPayById.get(r.customerId);
    return { ...r, ...health, avgPayDays: pay?.avgDays ?? null, maxPayDays: pay?.maxDays ?? null };
  }).sort((a, b) => b.pastDue - a.pastDue || b.total - a.total);

  const activeCustomers = customers.filter((c) => c && c.id !== 'c_deleted' && c.is_active !== false);
  const accountsNeedingInfo = activeCustomers.map((customer) => {
    const health = contactHealth(customer, customerById, staffEmails);
    const open = accountMap.get(customer.id);
    return {
      customerId: customer.id, name: customer.name || customer.alpha_tag || customer.id,
      repId: customer.primary_rep_id || null, exposure: open?.total || 0,
      pastDue: open?.pastDue || 0, ...health,
    };
  }).filter((r) => r.issues.length)
    .sort((a, b) => b.exposure - a.exposure || b.issues.length - a.issues.length || a.name.localeCompare(b.name));

  const pastDue = buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90plus;
  const dueNext7 = repRows.reduce((a, r) => a + r.dueNext7, 0);
  const noBillingExposure = accountRows.filter((r) => !r.billingEmail).reduce((a, r) => a + r.total, 0);
  const top5 = [...accountRows].sort((a, b) => b.total - a.total).slice(0, 5).reduce((a, r) => a + r.total, 0);
  return {
    aging, openInvoices: openInvoices.sort((a, b) => b.daysPastDue - a.daysPastDue || b.balance - a.balance),
    assumedHistorical, repRows, accountRows, accountsNeedingInfo, accountPayRows, repPayRows,
    kpis: {
      total: aging.total, pastDue, pastDuePct: aging.total ? pastDue / aging.total : 0,
      d60plus: buckets.d61_90 + buckets.d90plus, d90plus: buckets.d90plus,
      dueNext7, noBillingExposure, top5Pct: aging.total ? top5 / aging.total : 0,
      paySampleCount: paidSamples.length,
      payFallbackCount: paidSamples.filter((s) => s.usedFallbackDate).length,
      assumedHistoryCount: assumedHistorical.length,
      assumedHistoryFaceValue: assumedHistorical.reduce((a, i) => a + i.faceValue, 0),
    },
  };
}

// ── Operational A/R forecast + total customer exposure ─────────────
// This forecast deliberately does not require a bank feed. It starts with the
// invoice's contractual due date, adjusts for the account's observed payment
// speed, and applies a conservative recovery curve when that expected date is
// already behind us. QB-linked invoices are counted separately so the UI can
// explain how much of the projection benefits from accounting-side payment sync.
export function arCashForecast({ openInvoices = [], accountPayRows = [], asOf }) {
  const today = asOf || new Date();
  const payByCustomer = new Map(accountPayRows.map((r) => [r.customerId, r]));
  const out = {
    next7: 0, days8to30: 0, days31to60: 0, beyond60: 0,
    contractual7: 0, contractual30: 0, contractual60: 0,
    total: 0, qbLinked: 0, qbLinkedAmount: 0, rows: [],
  };
  for (const inv of openInvoices) {
    const balance = N(inv.balance);
    if (balance <= 0.005) continue;
    const pay = payByCustomer.get(inv.customer_id);
    const contractualTerms = inv.invoiceDate && inv.dueDate
      ? Math.max(0, daysBetween(inv.dueDate, inv.invoiceDate)) : 30;
    const observedDays = pay?.avgDays == null ? contractualTerms : Math.max(0, pay.avgDays);
    const behaviorLag = Math.max(0, Math.round(observedDays - contractualTerms));
    const expectedDate = addDays(inv.dueDate || inv.invoiceDate || today, behaviorLag) || today;
    const expectedIn = daysBetween(expectedDate, today);
    const dueIn = inv.dueDate ? daysBetween(inv.dueDate, today) : expectedIn;
    let w7 = 0, w30 = 0, w60 = 0;
    if (expectedIn >= 0) {
      if (expectedIn <= 7) w7 = w30 = w60 = 1;
      else if (expectedIn <= 30) w30 = w60 = 1;
      else if (expectedIn <= 60) w60 = 1;
    } else {
      const late = Math.abs(expectedIn);
      if (late <= 15) { w7 = 0.75; w30 = 0.95; w60 = 1; }
      else if (late <= 45) { w7 = 0.35; w30 = 0.75; w60 = 0.90; }
      else if (late <= 90) { w7 = 0.15; w30 = 0.45; w60 = 0.70; }
      else { w7 = 0.05; w30 = 0.25; w60 = 0.45; }
    }
    out.next7 += balance * w7;
    out.days8to30 += balance * Math.max(0, w30 - w7);
    out.days31to60 += balance * Math.max(0, w60 - w30);
    out.beyond60 += balance * Math.max(0, 1 - w60);
    if (dueIn <= 7) out.contractual7 += balance;
    if (dueIn <= 30) out.contractual30 += balance;
    if (dueIn <= 60) out.contractual60 += balance;
    out.total += balance;
    const qbLinked = !!(inv.qb_invoice_id || inv.qb_customer_id
      || (Array.isArray(inv.payments) && inv.payments.some((p) => p?.method === 'qb_sync')));
    if (qbLinked) { out.qbLinked++; out.qbLinkedAmount += balance; }
    out.rows.push({
      invoiceId: inv.id, customerId: inv.customer_id, repId: inv.repId,
      balance, expectedDate, expectedIn, dueIn, behaviorLag, qbLinked,
      expected7: balance * w7, expected30: balance * w30, expected60: balance * w60,
    });
  }
  out.forecast30 = out.next7 + out.days8to30;
  out.forecast60 = out.forecast30 + out.days31to60;
  out.qbCoveragePct = out.total ? out.qbLinkedAmount / out.total : 0;
  out.rows.sort((a, b) => a.expectedIn - b.expectedIn || b.balance - a.balance);
  return out;
}

function uninvoicedOrderRows({
  sos = [], invs = [], histInvs = [], customers = [], calcMargin, calcStatus, asOf,
}) {
  const portalIds = new Set(invs.filter(Boolean).map((i) => String(i.id)));
  const allInvs = [...invs.filter(Boolean), ...histInvs.filter((i) => i && !portalIds.has(String(i.id)))];
  const invoicedBySo = new Map();
  for (const inv of allInvs) {
    if (!liveInv(inv) || !inv.so_id) continue;
    // Invoice totals are customer-facing, tax-inclusive amounts. Compare like
    // with like so the remaining amount agrees with the invoice and order UI.
    const billed = Math.max(0, N(inv.total));
    invoicedBySo.set(inv.so_id, (invoicedBySo.get(inv.so_id) || 0) + billed);
  }
  const customerById = new Map(customers.filter(Boolean).map((c) => [c.id, c]));
  const today = asOf || new Date();
  const rows = [];
  for (const so of sos) {
    if (!liveSO(so)) continue;
    let margin = null;
    try { margin = calcMargin ? calcMargin(so) : null; } catch (_) {}
    const customer = customerById.get(so.customer_id);
    const orderSubtotal = Math.max(0, N(margin?.rev) + N(margin?.shipRev));
    const taxRate = (so.tax_exempt || customer?.tax_exempt)
      ? 0
      : N(so.tax_rate != null ? so.tax_rate : customer?.tax_rate);
    // Shipping is not taxed in the order editor; mirror that calculation here.
    const orderTax = Math.max(0, N(margin?.rev) * taxRate);
    const orderValue = orderSubtotal + orderTax;
    const invoiced = N(invoicedBySo.get(so.id));
    const openToInvoice = Math.max(0, orderValue - invoiced);
    if (openToInvoice < 1) continue;
    let status = so.status || '';
    try { status = calcStatus ? calcStatus(so) : status; } catch (_) {}
    const storedStatus = String(so.status || '').toLowerCase();
    // The stored workflow state is authoritative for operational TODOs. A
    // calculated ready state must not pull waiting/receiving orders forward.
    const completed = ['ready_to_invoice', 'complete', 'completed', 'shipped'].includes(storedStatus);
    const orderDate = parseDate(so.created_at);
    rows.push({
      id: so.id, customerId: so.customer_id || null, customerName: customer?.name || 'Unknown account',
      repId: customer?.primary_rep_id || so.created_by || null, status, storedStatus: so.status || '',
      orderSubtotal, orderTax, taxRate, orderValue, invoiced, openToInvoice, completed, orderDate,
      ageDays: orderDate ? Math.max(0, daysBetween(today, orderDate)) : null,
      memo: so.memo || '', order: so,
    });
  }
  return rows.sort((a, b) => b.openToInvoice - a.openToInvoice || String(a.id).localeCompare(String(b.id)));
}

// Exact drill-down for the Completed, Uninvoiced KPI. Keeping this and
// customerExposureReport on the same row builder guarantees that the visible
// order list reconciles to the account totals and management snapshot.
export function completedUninvoicedOrdersReport(args) {
  return uninvoicedOrderRows(args).filter((r) => r.completed);
}

export function customerExposureReport({
  ar, sos = [], invs = [], histInvs = [], customers = [], calcMargin, calcStatus, asOf,
}) {
  const byCustomer = new Map();
  const seed = (customerId, name, repId) => {
    const key = customerId || `raw:${name || 'Unknown account'}`;
    if (!byCustomer.has(key)) byCustomer.set(key, {
      customerId: customerId || null, name: name || 'Unknown account', repId: repId || null,
      openAR: 0, pastDue: 0, completedUninvoiced: 0, openOrderValue: 0,
      totalExposure: 0, completedOrders: 0, openOrders: 0,
    });
    return byCustomer.get(key);
  };
  for (const r of (ar?.accountRows || [])) {
    const row = seed(r.customerId, r.name, r.repId);
    row.openAR += N(r.total); row.pastDue += N(r.pastDue);
  }
  for (const order of uninvoicedOrderRows({ sos, invs, histInvs, customers, calcMargin, calcStatus, asOf })) {
    const row = seed(order.customerId, order.customerName, order.repId);
    if (order.completed) { row.completedUninvoiced += order.openToInvoice; row.completedOrders++; }
    else { row.openOrderValue += order.openToInvoice; row.openOrders++; }
  }
  return [...byCustomer.values()].map((r) => ({
    ...r, totalExposure: r.openAR + r.completedUninvoiced + r.openOrderValue,
  })).sort((a, b) => b.totalExposure - a.totalExposure || a.name.localeCompare(b.name));
}

// One idempotent row per day/scope is persisted by the AR workspace. "Daily"
// therefore means once per report-open day; no bank connection or server-side
// pricing reimplementation is required.
export function buildArSnapshotRows({ ar, exposureRows = [], reps = [], asOf }) {
  const day = monthKey(asOf || new Date()) + '-' + String((asOf || new Date()).getDate()).padStart(2, '0');
  const make = (scopeId, name) => {
    const invoices = scopeId === 'team' ? ar.openInvoices : ar.openInvoices.filter((i) => i.repId === scopeId);
    const payRows = scopeId === 'team' ? ar.accountPayRows : ar.accountPayRows.filter((r) => r.repId === scopeId);
    const forecast = arCashForecast({ openInvoices: invoices, accountPayRows: payRows, asOf });
    const exposure = scopeId === 'team' ? exposureRows : exposureRows.filter((r) => r.repId === scopeId);
    return {
      as_of_date: day, scope_id: scopeId, scope_name: name,
      total_ar: invoices.reduce((a, i) => a + N(i.balance), 0),
      past_due: invoices.filter((i) => i.daysPastDue > 0).reduce((a, i) => a + N(i.balance), 0),
      d60plus: invoices.filter((i) => i.daysPastDue > 60).reduce((a, i) => a + N(i.balance), 0),
      d90plus: invoices.filter((i) => i.daysPastDue > 90).reduce((a, i) => a + N(i.balance), 0),
      completed_uninvoiced: exposure.reduce((a, r) => a + N(r.completedUninvoiced), 0),
      open_order_value: exposure.reduce((a, r) => a + N(r.openOrderValue), 0),
      forecast_7: forecast.next7, forecast_30: forecast.forecast30, forecast_60: forecast.forecast60,
      account_count: new Set(invoices.map((i) => i.customer_id).filter(Boolean)).size,
      invoice_count: invoices.length,
    };
  };
  return [make('team', 'All reps'), ...reps.map((r) => make(r.id, r.name || r.id))];
}

// ── Stale / ready-to-invoice sales orders ─────────────────────────────
// This intentionally has two nets: operational completion signals catch work
// that looks invoice-ready even when a stored shipment/receiving flag is wrong;
// the 30-day non-booking rule catches everything else that has simply lingered.
export function staleOrdersReport({
  sos = [], invs = [], histInvs = [], customers = [], calcMargin, calcStatus, asOf,
}) {
  const today = asOf || new Date();
  const customerById = new Map(customers.filter(Boolean).map((c) => [c.id, c]));
  const portalIds = new Set(invs.filter(Boolean).map((i) => String(i.id)));
  const allInvs = [
    ...invs.filter(Boolean),
    ...histInvs.filter((i) => i && !portalIds.has(String(i.id))),
  ];
  const invBySo = new Map();
  for (const inv of allInvs) {
    if (!liveInv(inv) || !inv.so_id) continue;
    const arr = invBySo.get(inv.so_id) || [];
    arr.push(inv); invBySo.set(inv.so_id, arr);
  }
  const rows = [];
  for (const so of sos) {
    if (!liveSO(so)) continue;
    const orderDate = parseDate(so.created_at);
    const ageDays = orderDate ? Math.max(0, daysBetween(today, orderDate)) : 0;
    const isBooking = so.order_type === 'booking';
    let status = so.status || 'unknown';
    try { status = calcStatus ? calcStatus(so) : status; } catch (_) {}
    const margin = calcMargin(so);
    const orderValue = Math.max(0, N(margin?.rev) + N(margin?.shipRev));
    const linkedInvs = invBySo.get(so.id) || [];
    const invoiced = linkedInvs.reduce((a, i) => a + Math.max(0, N(i.total) - N(i.tax)), 0);
    const openToInvoice = Math.max(0, orderValue - invoiced);
    if (orderValue <= 0 || openToInvoice < 1) continue;

    const jobs = Array.isArray(so.jobs) ? so.jobs.filter((j) => j && j.prod_status !== 'draft') : [];
    const doneJobs = jobs.filter((j) => j.prod_status === 'completed' || j.prod_status === 'shipped').length;
    const shippedJobs = jobs.filter((j) => j.prod_status === 'shipped').length;
    const allJobsDone = jobs.length > 0 && doneJobs === jobs.length;
    const allJobsShipped = jobs.length > 0 && shippedJobs === jobs.length;
    let totalUnits = 0, fulfilledUnits = 0;
    for (const item of (Array.isArray(so.items) ? so.items : [])) {
      let entries = Object.entries(item?.sizes || {}).filter(([, q]) => N(q) > 0);
      if (!entries.length && N(item?.est_qty) > 0) entries = [['QTY', N(item.est_qty)]];
      const isServiceLine = item?._topstar || item?.sku === 'DIGITIZING' || /^artwork$/i.test(String(item?.sku || '').trim());
      for (const [size, rawQty] of entries) {
        const qty = N(rawQty); totalUnits += qty;
        if (isServiceLine) { fulfilledUnits += qty; continue; }
        const pulled = (Array.isArray(item.pick_lines) ? item.pick_lines : [])
          .filter((p) => p?.status === 'pulled').reduce((a, p) => a + N(p[size]), 0);
        const received = (Array.isArray(item.po_lines) ? item.po_lines : []).reduce((a, p) => {
          const rec = N(p?.received?.[size]);
          return a + (p?.drop_ship ? Math.max(rec, N(p?.billed?.[size])) : rec);
        }, 0);
        fulfilledUnits += Math.min(qty, pulled + received);
      }
    }
    const expected = parseDate(so.expected_ship_date) || parseDate(so.ship_on_date)
      || parseDate(so.deliver_on_date) || parseDate(so.expected_date);
    const daysLate = expected ? Math.max(0, daysBetween(today, expected)) : 0;
    const storedComplete = so.status === 'complete' || so.status === 'completed' || so.status === 'shipped';
    const readySignal = status === 'ready_to_invoice' || status === 'complete' || storedComplete || allJobsDone;
    const oldNonBooking = !isBooking && ageDays > 30;
    if (!readySignal && !oldNonBooking) continue;

    const reasons = [];
    if (status === 'ready_to_invoice') reasons.push('System says Ready to Invoice');
    if (status === 'complete' || storedComplete) reasons.push('Order is complete/shipped but value remains uninvoiced');
    if (allJobsDone) reasons.push(`All ${jobs.length} production job${jobs.length === 1 ? '' : 's'} finished`);
    if (allJobsShipped) reasons.push('Every production job is marked shipped');
    if (allJobsDone && totalUnits > 0 && fulfilledUnits < totalUnits) reasons.push(`Fulfillment data shows ${fulfilledUnits}/${totalUnits} units — verify a receiving/shipping mismatch`);
    if (oldNonBooking) reasons.push(`Non-booking order still open after ${ageDays} days`);
    if (daysLate > 0) reasons.push(`Expected date is ${daysLate} day${daysLate === 1 ? '' : 's'} past`);
    if (invoiced > 0) reasons.push(`${Math.round(invoiced / orderValue * 100)}% already invoiced; remainder is still open`);

    const mismatch = allJobsDone && totalUnits > 0 && fulfilledUnits < totalUnits;
    const severity = ((status === 'complete' || storedComplete || allJobsShipped) && openToInvoice >= 1) || ageDays > 90
      ? 'critical' : (status === 'ready_to_invoice' || allJobsDone || ageDays > 60) ? 'high' : 'watch';
    const category = mismatch ? 'system_mismatch'
      : (status === 'ready_to_invoice' || status === 'complete' || storedComplete || allJobsDone) ? 'ready'
        : 'old_open';
    const customer = customerById.get(so.customer_id);
    rows.push({
      so, id: so.id, customerId: so.customer_id, customerName: customer?.name || 'Unknown account',
      repId: customer?.primary_rep_id || so.created_by || null, status, storedStatus: so.status || '',
      isBooking, ageDays, expected, daysLate, orderValue, invoiced, openToInvoice,
      invoiceCount: linkedInvs.length, invoicePct: orderValue ? Math.min(1, invoiced / orderValue) : 0,
      totalUnits, fulfilledUnits, jobCount: jobs.length, doneJobs, shippedJobs,
      allJobsDone, allJobsShipped, mismatch, severity, category, reasons,
    });
  }
  const severityRank = { critical: 0, high: 1, watch: 2 };
  rows.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]
    || b.openToInvoice - a.openToInvoice || b.ageDays - a.ageDays);
  return {
    rows,
    summary: {
      count: rows.length,
      value: rows.reduce((a, r) => a + r.openToInvoice, 0),
      readyCount: rows.filter((r) => r.category === 'ready').length,
      mismatchCount: rows.filter((r) => r.category === 'system_mismatch').length,
      oldCount: rows.filter((r) => r.category === 'old_open').length,
      criticalCount: rows.filter((r) => r.severity === 'critical').length,
    },
  };
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

// ── Profitability by customer / rep ─────────────────────────────────
// Matched basis, same as matchedPL: an order contributes the revenue actually
// invoiced and the matching share of its cost — so a big order that has only
// half shipped counts half, not all of it. That is the difference between
// "who bills the most" and "who is actually profitable".
//
// Rep attribution mirrors the sales dashboard: the customer's primary rep,
// falling back to whoever created the order.
export function profitByEntity({ sos = [], invs = [], calcMargin, customers = [], groupBy = 'customer', customerLevel = 'child' }) {
  const custById = new Map(customers.map((c) => [c.id, c]));
  const invBySo = new Map();
  for (const inv of invs) {
    if (!liveInv(inv)) continue;
    const arr = invBySo.get(inv.so_id) || [];
    arr.push(inv); invBySo.set(inv.so_id, arr);
  }
  const rows = new Map();
  for (const so of sos) {
    if (!liveSO(so)) continue;
    const cust = custById.get(so.customer_id);
    const key = groupBy === 'rep'
      ? (cust?.primary_rep_id || so.created_by || '—')
      : (customerLevel === 'parent' ? customerFamilyId(so.customer_id, customers) : so.customer_id) || '—';
    const m = calcMargin(so);
    const ordVal = N(m.rev) + N(m.shipRev);
    if (ordVal <= 0) continue;
    const soInvs = invBySo.get(so.id) || [];
    const invNet = soInvs.reduce((a, i) => a + N(i.total) - N(i.tax), 0);
    const share = Math.min(1, invNet / ordVal);
    const r = rows.get(key) || {
      key, revenue: 0, cogs: 0, orders: 0, invoices: 0, openValue: 0, openBalance: 0,
    };
    r.revenue += invNet;
    r.cogs += N(m.cost) * share;
    r.orders++;
    r.invoices += soInvs.length;
    r.openValue += Math.max(0, ordVal - invNet);
    r.openBalance += soInvs.reduce((a, i) => a + Math.max(0, N(i.total) - N(i.paid)), 0);
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, gp: r.revenue - r.cogs, gpPct: r.revenue > 0 ? (r.revenue - r.cogs) / r.revenue : 0 }))
    .filter((r) => r.revenue > 0 || r.openValue > 0)
    .sort((a, b) => b.gp - a.gp);
}

// ── Forecast accuracy ───────────────────────────────────────────────
// Joins saved forecast snapshots to what actually billed in the target month.
// Only scores months that are COMPLETE (target month < current month) — grading
// a month still in progress would always read as a miss.
// Returns per-month rows plus MAPE (average absolute error) and bias (signed
// average: positive = the model runs high).
export function forecastAccuracy({ snapshots = [], actualByMonth = new Map(), asOf }) {
  const thisMonth = monthKey(asOf || new Date());
  const rows = [];
  for (const s of snapshots) {
    if (!s || !s.target_month || s.target_month >= thisMonth) continue;
    const actual = N(actualByMonth.get(s.target_month));
    if (actual <= 0) continue;
    const base = N(s.base);
    const err = base - actual;
    rows.push({
      targetMonth: s.target_month,
      asOfMonth: s.as_of_month,
      horizon: N(s.horizon),
      forecast: base,
      committed: N(s.committed),
      actual,
      error: err,
      errorPct: actual > 0 ? err / actual : 0,
      withinBand: actual >= N(s.low) && actual <= N(s.high),
    });
  }
  rows.sort((a, b) => a.targetMonth.localeCompare(b.targetMonth) || a.horizon - b.horizon);
  const scored = rows.length;
  const mape = scored ? rows.reduce((a, r) => a + Math.abs(r.errorPct), 0) / scored : null;
  const bias = scored ? rows.reduce((a, r) => a + r.errorPct, 0) / scored : null;
  const hitRate = scored ? rows.filter((r) => r.withinBand).length / scored : null;
  return { rows, scored, mape, bias, hitRate };
}

// ── Snapshot builder ────────────────────────────────────────────────
// The rows the Financials page persists to finance_snapshots: one per forecast
// month, each carrying the same KPI block so the weekly digest can read the
// newest row without recomputing anything.
export function buildSnapshotRows({ revForecast, aging, backlog, pl, asOf }) {
  const today = asOf || new Date();
  const asOfMonth = monthKey(today);
  const y = String(today.getFullYear());
  const ytd = (pl?.months || []).filter((r) => r.month.startsWith(y));
  const kpis = {
    arTotal: Math.round(aging?.total || 0),
    ar60plus: Math.round((aging?.buckets?.d61_90 || 0) + (aging?.buckets?.d90plus || 0)),
    backlogValue: Math.round(backlog?.totalValue || 0),
    backlogGp: Math.round(backlog?.totalGp || 0),
    backlogOrders: backlog?.orders || 0,
    wip: Math.round(pl?.wip || 0),
    ytdRev: Math.round(ytd.reduce((a, r) => a + r.revenue, 0)),
    ytdGp: Math.round(ytd.reduce((a, r) => a + r.gp, 0)),
  };
  const asOfDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return (revForecast?.months || []).map((m, i) => ({
    as_of_month: asOfMonth,
    as_of_date: asOfDate,
    target_month: m.month,
    horizon: i,
    committed: Math.round(m.committed),
    new_business: Math.round(m.newBusiness),
    base: Math.round(m.base),
    low: Math.round(m.low),
    high: Math.round(m.high),
    kpis,
  }));
}
