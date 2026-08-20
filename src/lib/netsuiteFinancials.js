// ═══════════════════════════════════════════════════════════════════════
// NETSUITE FINANCIALS — parse NetSuite financial reports into GL rows, and
// build income statement / balance sheet / trial balance from those rows.
//
// Two callers, one normalized shape:
//   • the Accounting page importer (browser, SheetJS-parsed CSV/xls rows)
//   • netlify/functions/netsuite-sync.js (server, SuiteQL result rows)
// Both hand this module arrays of plain objects keyed by column header, and
// get back rows shaped for gl_entries / gl_account_balances / gl_accounts.
//
// ─── THE SIGN RULE ───────────────────────────────────────────────────
// `amount` is stored DEBIT MINUS CREDIT everywhere — at rest in the database
// and on every row this module returns:
//     asset / expense / COGS  → POSITIVE
//     liability / equity / income → NEGATIVE
// That is NetSuite's own convention, and it is what makes the import
// checkable: a complete trial balance sums to exactly zero. Revenue is
// flipped to read positive only at PRESENTATION time, in buildIncomeStatement.
// Never flip it earlier — a "helpfully" positive income row silently breaks
// the zero-sum check that proves nothing was dropped on import.
// ═══════════════════════════════════════════════════════════════════════

// Money, to the cent. Every sum in this module rounds through here: JS floats
// accumulate error over 200k+ ledger rows, and a trial balance that misses
// zero by $0.0000001 would read as "out of balance" in the UI.
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum2 = (xs) => round2(xs.reduce((a, b) => a + (Number(b) || 0), 0));

// NetSuite prints money as "$1,234.56", "(1,234.56)" for negatives, "1,234.56",
// or an em/en dash for zero. Parens-negative is the one that matters: read
// naively, every credit in the file comes back positive.
export const parseMoney = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^[–—-]$/.test(s)) return 0;          // – — - all mean zero
  const negated = /^\(.*\)$/.test(s);
  s = s.replace(/^\((.*)\)$/, '$1')
       .replace(/[$,\s]/g, '')
       .replace(/[−]/g, '-');                    // unicode minus
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return round2(negated ? -n : n);
};

// NetSuite exports dates as M/D/YYYY, sometimes YYYY-MM-DD, and SheetJS can
// hand back a Date object. Returns an ISO yyyy-mm-dd string or null.
export const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = String(2000 + parseInt(y, 10));
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
};

// ─── Column mapping ──────────────────────────────────────────────────
// Same approach as scripts/load-netsuite-invoices.py: NetSuite column labels
// vary by report, by saved search, and by who built it. Exact match wins over
// substring so that "Memo" cannot steal the column "Memo (Main)" belongs to.
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

export const GL_ALIASES = {
  entry_date:           ['date', 'trandate', 'transaction date', 'gl date'],
  period:               ['period', 'posting period', 'accounting period'],
  account_full_name:    ['account', 'account name', 'split', 'account (full name)'],
  account_number:       ['account number', 'account no', 'number', 'acct #', 'acct no'],
  transaction_type:     ['type', 'transaction type'],
  document_number:      ['document number', 'document #', 'tranid', 'num', 'number'],
  netsuite_internal_id: ['internal id', 'transaction internal id'],
  entity_name:          ['name', 'entity', 'customer', 'vendor', 'customer/vendor'],
  memo:                 ['memo', 'memo (main)', 'description'],
  debit:                ['debit', 'debit amount'],
  credit:               ['credit', 'credit amount'],
  amount:               ['amount', 'amount (debit/credit)', 'net amount'],
  subsidiary:           ['subsidiary'],
  department:           ['department'],
  class:                ['class'],
  location:             ['location'],
};

export const COA_ALIASES = {
  netsuite_internal_id: ['internal id'],
  account_number:       ['number', 'account number', 'acct #', 'acct no'],
  name:                 ['name', 'account name'],
  full_name:            ['account', 'full name', 'account (full name)', 'display name'],
  account_type:         ['type', 'account type'],
  is_inactive:          ['inactive', 'is inactive'],
};

export const BALANCE_ALIASES = {
  account_full_name:    ['account', 'account name', 'financial row', 'row'],
  account_number:       ['account number', 'number', 'acct #'],
  debit:                ['debit'],
  credit:               ['credit'],
  amount:               ['amount', 'balance', 'total', 'net', 'end balance', 'ending balance'],
};

// Build {canonicalField: actualHeader} for one file's headers.
// Exact matches are resolved first across ALL fields, then substring matches
// fill what is left — otherwise a substring hit on an early field claims a
// header that a later field matches exactly.
//
// Within a field, the ALIAS list is the priority order, not the file's column
// order. That distinction is load-bearing: `memo` lists 'memo' before
// 'memo (main)', so in a file with both columns it takes the plain Memo and
// leaves Memo (Main) alone. Scanning headers first would let whichever column
// happened to come earlier win, which is how the header memo ends up in the
// line-memo field (the same trap scripts/merge-netsuite-transactions.py hit).
export const mapColumns = (headers, aliases) => {
  const map = {};
  const taken = new Set();
  const normed = headers.map((h) => ({ raw: h, n: norm(h) }));
  const claim = (field, match) => {
    for (const alias of aliases[field]) {
      const hit = normed.find((h) => !taken.has(h.raw) && match(h.n, alias));
      if (hit) { map[field] = hit.raw; taken.add(hit.raw); return true; }
    }
    return false;
  };
  for (const field of Object.keys(aliases)) claim(field, (h, a) => h === a);
  for (const field of Object.keys(aliases)) {
    if (!map[field]) claim(field, (h, a) => h.includes(a));
  }
  return map;
};

const pick = (row, map, field) => (map[field] ? row[map[field]] : undefined);

// ─── Account classification ──────────────────────────────────────────
// NetSuite account type → the bucket the statements group on. Order matters:
// 'Other Income' must be tested before 'Income', 'Cost of Goods Sold' before
// 'Expense', or the looser pattern swallows the specific one.
const TYPE_RULES = [
  [/other\s*income/i,                              'other_income'],
  [/other\s*expense/i,                             'other_expense'],
  [/cost\s*of\s*goods|^cogs$/i,                    'cogs'],
  [/income|revenue|sales/i,                        'income'],
  [/expense/i,                                     'expense'],
  [/accounts\s*payable|credit\s*card|liability|deferred\s*revenue/i, 'liability'],
  [/equity|retained\s*earnings/i,                  'equity'],
  [/bank|receivable|asset|inventory|deferred\s*expense/i, 'asset'],
];

export const classifyAccountType = (accountType) => {
  const t = String(accountType || '').trim();
  if (!t) return null;
  for (const [re, group] of TYPE_RULES) if (re.test(t)) return group;
  return null;
};

// When an export carries no Type column, fall back to the account-number
// range. These are the conventional US ranges and they are a GUESS — every
// account classified this way is reported as a warning so a human can confirm
// before the numbers reach a return.
export const classifyAccountNumber = (num) => {
  const n = parseInt(String(num || '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000 && n < 2000) return 'asset';
  if (n >= 2000 && n < 3000) return 'liability';
  if (n >= 3000 && n < 4000) return 'equity';
  if (n >= 4000 && n < 5000) return 'income';
  if (n >= 5000 && n < 6000) return 'cogs';
  if (n >= 6000 && n < 8000) return 'expense';
  if (n >= 8000 && n < 9000) return 'other_income';
  if (n >= 9000 && n < 10000) return 'other_expense';
  return null;
};

export const PL_GROUPS = ['income', 'other_income', 'cogs', 'expense', 'other_expense'];
export const BS_GROUPS = ['asset', 'liability', 'equity'];
export const isPL = (g) => PL_GROUPS.includes(g);
export const isBS = (g) => BS_GROUPS.includes(g);

// A NetSuite report prints "Total - Payroll Expenses" subtotal rows inline
// with the detail. Summing a file that contains them double-counts every
// rolled-up dollar, so they are dropped on the way in.
export const isSummaryRow = (label) => {
  const s = norm(label);
  if (!s) return false;
  return /^total\b/.test(s) || /^net (income|loss|ordinary income)\b/.test(s) ||
         /^(gross profit|total)\b/.test(s) || /\btotal$/.test(s);
};

// Leaf name out of "Income : Sales : Apparel".
const leafName = (full) => String(full || '').split(':').pop().trim();
const parentName = (full) => {
  const parts = String(full || '').split(':').map((p) => p.trim());
  return parts.length > 1 ? parts.slice(0, -1).join(' : ') : null;
};

// Stable slug used as gl_accounts.id, so the same account keeps one row
// across imports whether or not the export carried an internal id.
export const accountSlug = (accountNumber, fullNameOrName) => {
  const base = [String(accountNumber || '').trim(), norm(fullNameOrName)]
    .filter(Boolean).join('-');
  return 'acct_' + base.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 120);
};

// djb2 — a short, dependency-free, stable hash. Only ever used to build row
// ids for idempotent re-import; nothing security-sensitive rides on it.
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// gl_entries.id. NetSuite's GL Detail export carries no per-line key, so the
// id is a hash of the posting's identifying fields PLUS its occurrence index
// among otherwise-identical rows in the same file. Re-importing the same file
// lands on the same ids (idempotent); two genuinely identical postings on the
// same day still get distinct ids (index 0 and 1) instead of one silently
// overwriting the other.
export const entryFingerprint = (e, occurrence = 0) => 'gle_' + hash([
  e.entry_date, e.account_full_name || e.account_name, e.netsuite_internal_id || '',
  e.document_number || '', e.transaction_type || '', String(e.amount),
  e.memo || '', e.entity_name || '', String(occurrence),
].join('|'));

const assignFingerprints = (entries) => {
  const seen = new Map();
  return entries.map((e) => {
    const base = entryFingerprint(e, 0);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return { ...e, id: n === 0 ? base : entryFingerprint(e, n) };
  });
};

// ─── Report-type detection ───────────────────────────────────────────
// Called on the parsed headers so the importer can tell the user what it
// thinks a dropped file is before writing anything.
export const detectReportType = (headers) => {
  const hs = headers.map(norm);
  const has = (...names) => names.some((n) => hs.some((h) => h === n || h.includes(n)));
  const hasDate = has('date', 'trandate');
  const hasDrCr = has('debit') && has('credit');
  const hasAcct = has('account');

  if (hasDate && hasAcct && (hasDrCr || has('amount'))) return 'gl_detail';
  if (hasAcct && hasDrCr && !hasDate) return 'trial_balance';
  if (has('account type') || (has('type') && has('number') && has('name') && !hasDate)) return 'chart_of_accounts';
  if (has('subtotal') && has('tax') && hasDate) return 'invoice_totals';
  if (hasAcct && has('amount') && !hasDate) return 'income_statement';
  return 'unknown';
};

// ─── Parsers ─────────────────────────────────────────────────────────

// GL Detail / Transaction Detail → gl_entries rows.
export const parseGlDetail = (rows, opts = {}) => {
  const { sourceFile = null, importBatchId = null, accountIndex = {} } = opts;
  const warnings = [];
  const entries = [];
  if (!rows || !rows.length) return { entries: [], warnings: ['File contained no rows.'], skipped: 0 };

  const headers = Object.keys(rows[0]);
  const map = mapColumns(headers, GL_ALIASES);
  if (!map.entry_date) warnings.push('No Date column found — GL detail needs one; rows cannot be dated.');
  if (!map.account_full_name) warnings.push('No Account column found — entries cannot be classified.');
  if (!map.debit && !map.credit && !map.amount) warnings.push('No Debit/Credit or Amount column found — no figures to import.');

  // NetSuite's GL Detail repeats the account only on its first row and leaves
  // it blank down the group. Carry the last non-blank account forward, or
  // every row but the first lands unclassified.
  let carriedAccount = null;
  let skipped = 0;
  let guessedFromNumber = 0;

  rows.forEach((row) => {
    const rawAccount = String(pick(row, map, 'account_full_name') || '').trim();
    if (rawAccount) {
      if (isSummaryRow(rawAccount)) { skipped++; return; }
      carriedAccount = rawAccount;
    }
    const accountFull = carriedAccount;

    const date = parseDate(pick(row, map, 'entry_date'));
    const debit = parseMoney(pick(row, map, 'debit'));
    const credit = parseMoney(pick(row, map, 'credit'));
    const rawAmount = parseMoney(pick(row, map, 'amount'));

    // amount = debit - credit. When the export gives only a single signed
    // Amount column, trust its sign as already debit-positive.
    let amount;
    if (debit !== null || credit !== null) amount = round2((debit || 0) - (credit || 0));
    else if (rawAmount !== null) amount = rawAmount;
    else amount = null;

    // A row with no date, no account or no figure is a spacer/heading, not a
    // posting. Counted, not imported — the count is shown after the import.
    if (!date || !accountFull || amount === null) { skipped++; return; }

    const acctNumber = String(pick(row, map, 'account_number') || '').trim() ||
      (accountFull.match(/^(\d{3,6})\b/) || [])[1] || null;

    const known = accountIndex[norm(accountFull)] || accountIndex[norm(leafName(accountFull))];
    let group = known ? known.statement_group : classifyAccountNumber(acctNumber);
    if (!known && group) guessedFromNumber++;

    entries.push({
      account_id: known ? known.id : accountSlug(acctNumber, accountFull),
      account_number: acctNumber,
      account_name: leafName(accountFull),
      account_full_name: accountFull,
      statement_group: group,
      entry_date: date,
      fiscal_year: parseInt(date.slice(0, 4), 10),
      period: String(pick(row, map, 'period') || '').trim() || null,
      transaction_type: String(pick(row, map, 'transaction_type') || '').trim() || null,
      document_number: String(pick(row, map, 'document_number') || '').trim() || null,
      netsuite_internal_id: String(pick(row, map, 'netsuite_internal_id') || '').trim() || null,
      entity_name: String(pick(row, map, 'entity_name') || '').trim() || null,
      memo: String(pick(row, map, 'memo') || '').trim() || null,
      debit, credit, amount,
      subsidiary: String(pick(row, map, 'subsidiary') || '').trim() || null,
      department: String(pick(row, map, 'department') || '').trim() || null,
      class: String(pick(row, map, 'class') || '').trim() || null,
      location: String(pick(row, map, 'location') || '').trim() || null,
      source_file: sourceFile,
      import_batch_id: importBatchId,
    });
  });

  const unclassified = entries.filter((e) => !e.statement_group).length;
  if (unclassified) warnings.push(`${unclassified} entries could not be matched to an account type — import the Chart of Accounts first, then re-import this file.`);
  if (guessedFromNumber) warnings.push(`${guessedFromNumber} entries were classified by account-number range rather than a known account type — confirm before filing.`);
  if (skipped) warnings.push(`${skipped} rows skipped (subtotal, heading or blank rows).`);

  // The completeness check: a full period of GL detail nets to zero. Anything
  // else means rows are missing, and it is surfaced rather than swallowed.
  const net = sum2(entries.map((e) => e.amount));
  if (entries.length && Math.abs(net) >= 0.01) {
    warnings.push(`Debits and credits differ by ${net.toFixed(2)} — this export is not a complete balanced period. Totals built from it will not tie to NetSuite.`);
  }

  return { entries: assignFingerprints(entries), warnings, skipped, net };
};

// Chart of Accounts export → gl_accounts rows.
export const parseChartOfAccounts = (rows, opts = {}) => {
  const warnings = [];
  const accounts = [];
  if (!rows || !rows.length) return { accounts: [], warnings: ['File contained no rows.'] };

  const map = mapColumns(Object.keys(rows[0]), COA_ALIASES);
  if (!map.name && !map.full_name) warnings.push('No account Name column found.');
  if (!map.account_type) warnings.push('No account Type column — accounts will be classified by number range, which is a guess.');

  let unclassified = 0;
  rows.forEach((row) => {
    const full = String(pick(row, map, 'full_name') || pick(row, map, 'name') || '').trim();
    if (!full || isSummaryRow(full)) return;
    const number = String(pick(row, map, 'account_number') || '').trim() || null;
    const type = String(pick(row, map, 'account_type') || '').trim() || null;
    const group = classifyAccountType(type) || classifyAccountNumber(number);
    if (!group) unclassified++;
    const inactiveRaw = norm(pick(row, map, 'is_inactive'));

    accounts.push({
      id: accountSlug(number, full),
      netsuite_internal_id: String(pick(row, map, 'netsuite_internal_id') || '').trim() || null,
      account_number: number,
      name: leafName(full) || full,
      full_name: full,
      parent_full_name: parentName(full),
      account_type: type,
      statement_group: group,
      is_summary: false,
      is_inactive: inactiveRaw === 'yes' || inactiveRaw === 'true' || inactiveRaw === 't',
    });
  });

  if (unclassified) warnings.push(`${unclassified} accounts could not be classified into a statement group — they will be excluded from the P&L and balance sheet until fixed.`);
  return { accounts, warnings };
};

// Trial Balance / Income Statement / Balance Sheet → gl_account_balances rows.
// These are stored as the tie-out reference, never as the source of the
// statements themselves. See the migration comment on gl_account_balances.
export const parseBalances = (rows, opts = {}) => {
  const { reportType = 'trial_balance', fiscalYear, period = null, sourceFile = null, importBatchId = null, accountIndex = {} } = opts;
  const warnings = [];
  const balances = [];
  if (!rows || !rows.length) return { balances: [], warnings: ['File contained no rows.'] };
  if (!fiscalYear) warnings.push('No fiscal year supplied for this report — rows cannot be filed to a year.');

  const map = mapColumns(Object.keys(rows[0]), BALANCE_ALIASES);
  let skipped = 0;

  rows.forEach((row) => {
    const label = String(pick(row, map, 'account_full_name') || '').trim();
    if (!label) { skipped++; return; }
    if (isSummaryRow(label)) { skipped++; return; }

    const debit = parseMoney(pick(row, map, 'debit'));
    const credit = parseMoney(pick(row, map, 'credit'));
    const raw = parseMoney(pick(row, map, 'amount'));
    let amount;
    if (debit !== null || credit !== null) amount = round2((debit || 0) - (credit || 0));
    else if (raw !== null) amount = raw;
    else { skipped++; return; }

    const number = String(pick(row, map, 'account_number') || '').trim() ||
      (label.match(/^(\d{3,6})\b/) || [])[1] || null;
    const known = accountIndex[norm(label)] || accountIndex[norm(leafName(label))];

    balances.push({
      id: `glb_${reportType}_${fiscalYear}_${period || 'FY'}_${accountSlug(number, label)}`,
      account_id: known ? known.id : accountSlug(number, label),
      account_number: number,
      account_name: leafName(label),
      account_full_name: label,
      statement_group: known ? known.statement_group : classifyAccountNumber(number),
      fiscal_year: fiscalYear,
      period,
      report_type: reportType,
      debit, credit, amount,
      source_file: sourceFile,
      import_batch_id: importBatchId,
    });
  });

  if (skipped) warnings.push(`${skipped} rows skipped (subtotal, heading or blank rows).`);

  // A trial balance that does not net to zero is not a trial balance.
  if (reportType === 'trial_balance' && balances.length) {
    const net = sum2(balances.map((b) => b.amount));
    if (Math.abs(net) >= 0.01) warnings.push(`Trial balance is out by ${net.toFixed(2)} — check that the export covers every account.`);
  }
  return { balances, warnings };
};

// Invoice saved search WITH the Subtotal and Tax columns → customer_invoices
// upsert rows. The existing 9,082 imported invoices carry NULL subtotal and
// NULL tax on every row, because the saved search that produced them selected
// Amount only. Re-running it with those two columns is what makes a sales-tax
// figure possible at all.
export const parseInvoiceTotals = (rows, opts = {}) => {
  const warnings = [];
  const invoices = [];
  if (!rows || !rows.length) return { invoices: [], warnings: ['File contained no rows.'] };

  const ALIASES = {
    entry_date:           ['date', 'invoice date', 'trandate'],
    type:                 ['type', 'transaction type'],
    document_number:      ['document number', 'document #', 'number', 'tranid'],
    netsuite_internal_id: ['internal id', 'transaction internal id'],
    customer_nsid:        ['customer : internal id', 'customer internal id', 'customer:internal id'],
    customer_name:        ['name', 'customer', 'customer name'],
    status:               ['status'],
    subsidiary:           ['subsidiary'],
    rep_name:             ['sales rep', 'rep'],
    subtotal:             ['subtotal'],
    tax:                  ['tax total', 'total tax', 'tax'],
    total:                ['amount', 'total'],
    memo:                 ['memo', 'notes'],
  };
  const map = mapColumns(Object.keys(rows[0]), ALIASES);
  if (!map.netsuite_internal_id) warnings.push('No Internal ID column — without it a re-import would duplicate every invoice instead of updating it.');
  if (!map.subtotal) warnings.push('No Subtotal column in this export — the tax split will stay empty.');
  if (!map.tax) warnings.push('No Tax column in this export — the tax split will stay empty.');

  let creditMemos = 0;
  rows.forEach((row) => {
    const nsid = String(pick(row, map, 'netsuite_internal_id') || '').trim();
    const date = parseDate(pick(row, map, 'entry_date'));
    const total = parseMoney(pick(row, map, 'total'));
    if (!nsid || !date || total === null) return;

    const rawType = norm(pick(row, map, 'type'));
    const isCredit = rawType.includes('credit');
    if (isCredit) creditMemos++;

    // Credit memos reduce revenue. NetSuite exports them as positive amounts,
    // so the sign is applied here — otherwise importing credits would ADD to
    // sales. The existing 9,082 rows contain no credit memos at all.
    const signed = isCredit ? -Math.abs(total) : total;
    const sub = parseMoney(pick(row, map, 'subtotal'));
    const tax = parseMoney(pick(row, map, 'tax'));

    invoices.push({
      id: nsid,
      netsuite_internal_id: nsid,
      raw_customer_nsid: String(pick(row, map, 'customer_nsid') || '').trim() || null,
      raw_customer_name: String(pick(row, map, 'customer_name') || '').trim() || null,
      document_number: String(pick(row, map, 'document_number') || '').trim() || null,
      invoice_date: date,
      type: isCredit ? 'credit_memo' : 'invoice',
      status: String(pick(row, map, 'status') || '').trim().toLowerCase() || null,
      subsidiary: String(pick(row, map, 'subsidiary') || '').trim() || null,
      rep_name: String(pick(row, map, 'rep_name') || '').trim() || null,
      subtotal: sub === null ? null : (isCredit ? -Math.abs(sub) : sub),
      tax: tax === null ? null : (isCredit ? -Math.abs(tax) : tax),
      total: signed,
      memo: String(pick(row, map, 'memo') || '').trim() || null,
    });
  });

  if (creditMemos) warnings.push(`${creditMemos} credit memos found — imported as negative amounts so they reduce revenue.`);
  return { invoices, warnings };
};

// ─── Statement builders ──────────────────────────────────────────────
// Input is always gl_entries-shaped rows (debit-positive). Output carries a
// `display` figure with the sign a reader expects on a statement.

const groupByAccount = (entries) => {
  const acc = new Map();
  for (const e of entries) {
    const key = e.account_full_name || e.account_name || '(unclassified)';
    if (!acc.has(key)) acc.set(key, {
      account_full_name: key,
      account_name: e.account_name || key,
      account_number: e.account_number || null,
      statement_group: e.statement_group || null,
      amount: 0, entry_count: 0,
    });
    const a = acc.get(key);
    a.amount = round2(a.amount + (Number(e.amount) || 0));
    a.entry_count++;
    if (!a.statement_group && e.statement_group) a.statement_group = e.statement_group;
  }
  return [...acc.values()];
};

// Income statement. Revenue flips to positive HERE and only here.
export const buildIncomeStatement = (entries) => {
  const pl = entries.filter((e) => isPL(e.statement_group));
  const accounts = groupByAccount(pl);
  const of = (g) => accounts.filter((a) => a.statement_group === g)
    .map((a) => ({ ...a, display: (g === 'income' || g === 'other_income') ? round2(-a.amount) : a.amount }))
    .sort((x, y) => (x.account_number || '').localeCompare(y.account_number || '') || x.account_full_name.localeCompare(y.account_full_name));

  const income = of('income');
  const cogs = of('cogs');
  const expense = of('expense');
  const otherIncome = of('other_income');
  const otherExpense = of('other_expense');

  const revenue = sum2(income.map((a) => a.display));
  const cogsTotal = sum2(cogs.map((a) => a.display));
  const grossProfit = round2(revenue - cogsTotal);
  const opex = sum2(expense.map((a) => a.display));
  const operatingIncome = round2(grossProfit - opex);
  const otherInc = sum2(otherIncome.map((a) => a.display));
  const otherExp = sum2(otherExpense.map((a) => a.display));
  const netIncome = round2(operatingIncome + otherInc - otherExp);

  return {
    sections: { income, cogs, expense, otherIncome, otherExpense },
    totals: { revenue, cogs: cogsTotal, grossProfit, opex, operatingIncome, otherIncome: otherInc, otherExpense: otherExp, netIncome },
    // Independent re-derivation of the same number by a different route: net
    // income is the negated sum of every raw P&L amount. The UI shows this as
    // a tick; a mismatch means a group was dropped from the arithmetic above.
    checkNetIncome: round2(-sum2(pl.map((e) => e.amount))),
    entryCount: pl.length,
  };
};

// Balance sheet. Liabilities and equity flip to positive for display.
export const buildBalanceSheet = (entries) => {
  const bs = entries.filter((e) => isBS(e.statement_group));
  const accounts = groupByAccount(bs);
  const of = (g) => accounts.filter((a) => a.statement_group === g)
    .map((a) => ({ ...a, display: g === 'asset' ? a.amount : round2(-a.amount) }))
    .sort((x, y) => (x.account_number || '').localeCompare(y.account_number || '') || x.account_full_name.localeCompare(y.account_full_name));

  const assets = of('asset');
  const liabilities = of('liability');
  const equity = of('equity');
  const totalAssets = sum2(assets.map((a) => a.display));
  const totalLiabilities = sum2(liabilities.map((a) => a.display));
  const totalEquity = sum2(equity.map((a) => a.display));

  return {
    sections: { assets, liabilities, equity },
    totals: {
      assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity,
      liabilitiesAndEquity: round2(totalLiabilities + totalEquity),
    },
    // Assets − (Liabilities + Equity). Non-zero means the balance sheet does
    // not balance — usually because current-year net income has not been
    // closed to retained earnings in the imported data.
    outOfBalance: round2(totalAssets - totalLiabilities - totalEquity),
    entryCount: bs.length,
  };
};

export const buildTrialBalance = (entries) => {
  const accounts = groupByAccount(entries)
    .map((a) => ({ ...a, debit: a.amount > 0 ? a.amount : 0, credit: a.amount < 0 ? round2(-a.amount) : 0 }))
    .sort((x, y) => (x.account_number || '').localeCompare(y.account_number || '') || x.account_full_name.localeCompare(y.account_full_name));
  const totalDebit = sum2(accounts.map((a) => a.debit));
  const totalCredit = sum2(accounts.map((a) => a.credit));
  const difference = round2(totalDebit - totalCredit);
  return { accounts, totals: { debit: totalDebit, credit: totalCredit, difference }, isBalanced: Math.abs(difference) < 0.01 };
};

// Derived (from gl_entries) vs reported (from an imported NetSuite report).
// This is the check that makes the section trustworthy for a filing: if the
// two disagree, the GL detail import is incomplete and every statement built
// from it is wrong by that amount.
export const reconcile = (derivedAccounts, reportedBalances) => {
  const byKey = new Map();
  const key = (r) => norm(r.account_full_name || r.account_name);
  for (const d of derivedAccounts) byKey.set(key(d), { account: d.account_full_name, derived: d.amount, reported: null });
  for (const r of reportedBalances) {
    const k = key(r);
    if (!byKey.has(k)) byKey.set(k, { account: r.account_full_name, derived: null, reported: r.amount });
    else byKey.get(k).reported = r.amount;
  }
  const rows = [...byKey.values()].map((r) => ({
    ...r,
    difference: round2((r.derived || 0) - (r.reported || 0)),
    status: r.derived === null ? 'missing_in_gl' : r.reported === null ? 'missing_in_report'
      : Math.abs(round2((r.derived || 0) - (r.reported || 0))) < 0.01 ? 'match' : 'differs',
  }));
  return {
    rows: rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)),
    totalDifference: sum2(rows.map((r) => r.difference)),
    matched: rows.filter((r) => r.status === 'match').length,
    differing: rows.filter((r) => r.status !== 'match').length,
  };
};

// Index of imported accounts, keyed by both full name and leaf name, so GL
// detail rows can resolve their account however the export spells it.
export const buildAccountIndex = (accounts) => {
  const ix = {};
  for (const a of accounts || []) {
    if (a.full_name) ix[norm(a.full_name)] = a;
    if (a.name) ix[norm(a.name)] = a;
  }
  return ix;
};

export const _internal = { norm, leafName, parentName, sum2, hash };
