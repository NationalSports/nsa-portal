/* eslint-disable */
// ═══════════════════════════════════════════════════════════════════════
// NETSUITE CSV / SPREADSHEETML PARSER
//
// Parses the eight report exports described in NETSUITE_TAX_EXPORT_HANDOFF.md
// into the shapes the gl_* tables and customer_invoices expect:
//
//   chart of accounts   → gl_accounts
//   general ledger      → gl_entries
//   trial balance       → gl_account_balances (report_type='trial_balance')
//   income statement    → gl_account_balances (report_type='income_statement')
//   balance sheet       → gl_account_balances (report_type='balance_sheet')
//   invoice saved search→ customer_invoices   (subtotal / tax / credit memos)
//
// MONEY IS PARSED TO INTEGER CENTS, never floats. The whole point of the
// GL import is the debit == credit assertion, and 0.1+0.2 !== 0.3 makes a
// float-based version of that check either wrong or fuzzy. Cents are summed
// as integers and compared exactly; `.amount` fields are converted back to
// a 2dp number only at the very edge, when building the row to write.
//
// FORMAT CAVEAT (read before trusting this): these parsers were written
// against NetSuite's *documented* export conventions, not against a real
// export from account 6108444 — nobody has run the exports yet. The column
// matching is therefore deliberately fuzzy (alias lists, case/space
// insensitive) and every parser returns `warnings` plus the header row it
// actually found, so a format surprise shows up in the import preview as a
// visible mismatch rather than as silently dropped rows.
// ═══════════════════════════════════════════════════════════════════════

// ── Money ────────────────────────────────────────────────────────────────
// NetSuite writes negatives as (1,234.56), sometimes appends CR/DR, and
// prefixes a currency symbol. Blank / "-" / "—" mean zero.
const toCents = (raw) => {
  if (raw === null || raw === undefined) return 0;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '–' || s === '—' || s === '$') return 0;
  let neg = false;
  // Parenthesised negative — (1,234.56)
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  // Trailing or leading CR (credit) marker used by some NetSuite layouts.
  if (/(^CR\b|\bCR$)/i.test(s)) { neg = true; s = s.replace(/(^CR\b|\bCR$)/i, ''); }
  s = s.replace(/(^DR\b|\bDR$)/i, '');
  s = s.replace(/[$£€\s,]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!s || !/^\d*\.?\d*$/.test(s)) return 0;
  // Round half-away-from-zero on the cent, so 0.005 → 0.01 not 0.00.
  const cents = Math.round(parseFloat(s || '0') * 100);
  if (!isFinite(cents)) return 0;
  return neg ? -cents : cents;
};

const centsToNum = (c) => Math.round(c) / 100;

// True when a money cell was genuinely blank rather than a zero — lets the
// GL parser tell "no debit on this line" from "a debit of exactly 0.00".
const isBlankMoney = (raw) => {
  if (raw === null || raw === undefined) return true;
  const s = String(raw).trim();
  return !s || s === '-' || s === '–' || s === '—';
};

// ── Delimited text ───────────────────────────────────────────────────────
// RFC4180 state machine: honours quoted fields containing commas, newlines
// and doubled quotes. Handles \r\n, \r and \n line endings.
const parseDelimited = (text, delimiter) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const s = String(text || '').replace(/^﻿/, ''); // strip BOM
  const d = delimiter || ',';
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      if (s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; i++; continue;
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
};

// NetSuite's "Excel" export is SpreadsheetML 2003 — XML, not a real .xls.
// <Row><Cell ss:Index="3"><Data ss:Type="String">text</Data></Cell></Row>
const isSpreadsheetML = (text) =>
  /<\s*Workbook[\s>]/i.test(text) && /urn:schemas-microsoft-com:office:spreadsheet/i.test(text);

const decodeXmlEntities = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&'); // last, so &amp;lt; survives as &lt;

const parseSpreadsheetML = (text) => {
  const rows = [];
  const rowRe = /<Row\b[^>]*>([\s\S]*?)<\/Row>/gi;
  const cellRe = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi;
  const dataRe = /<Data\b[^>]*>([\s\S]*?)<\/Data>/i;
  let rowMatch;
  while ((rowMatch = rowRe.exec(text)) !== null) {
    const cells = [];
    let cellMatch;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      // ss:Index skips columns — pad so column positions stay aligned.
      const idxAttr = /ss:Index\s*=\s*"(\d+)"/i.exec(cellMatch[1]);
      if (idxAttr) {
        const target = parseInt(idxAttr[1], 10) - 1;
        while (cells.length < target) cells.push('');
      }
      const dm = dataRe.exec(cellMatch[2]);
      cells.push(dm ? decodeXmlEntities(dm[1].replace(/<[^>]+>/g, '')).trim() : '');
    }
    // Self-closing <Cell/> produces nothing above; that is fine — trailing
    // empties do not shift earlier columns.
    rows.push(cells);
  }
  return rows;
};

// Pick the delimiter by counting candidates outside quotes on the busiest line.
const sniffDelimiter = (text) => {
  const sample = String(text || '').split(/\r?\n/).slice(0, 40);
  const score = (d) => sample.reduce((best, line) => {
    let n = 0, q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === d && !q) n++;
    }
    return Math.max(best, n);
  }, 0);
  const tab = score('\t'), comma = score(','), semi = score(';');
  if (tab >= comma && tab >= semi && tab > 0) return '\t';
  if (semi > comma && semi > 0) return ';';
  return ',';
};

// One entry point for all three shapes.
const parseTabular = (text) => {
  const s = String(text || '');
  if (isSpreadsheetML(s)) return parseSpreadsheetML(s);
  return parseDelimited(s, sniffDelimiter(s));
};

// ── Header location ──────────────────────────────────────────────────────
// NetSuite reports carry title / company / date-range rows above the real
// header. Find the first row that matches enough of the expected columns.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findHeaderRow = (rows, required, maxScan) => {
  const limit = Math.min(rows.length, maxScan || 30);
  let best = -1, bestHits = 0;
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map(norm);
    if (!cells.some(Boolean)) continue;
    let hits = 0;
    for (const group of required) {
      if (group.some(alias => cells.includes(norm(alias)))) hits++;
    }
    if (hits > bestHits) { bestHits = hits; best = r; }
    if (hits === required.length) return { index: r, hits };
  }
  return { index: best, hits: bestHits };
};

// Build a name→column-index map from a header row, matching on aliases.
//
// Two passes, and the rules are deliberately strict, because a loose match
// here is silent financial corruption rather than a visible error. Binding
// `subtotal` to a gross `Amount` column would populate the subtotal field
// with tax-inclusive figures and report the §6 tax gap as fixed.
//
//  1. Exact matches for every key first; each one CLAIMS its column.
//  2. Unbound keys may then take a prefix match, but only where the header
//     is a decorated form of the alias ("Amount (Foreign Currency)" →
//     `amount`), never the reverse, and never a column already claimed.
const mapColumns = (headerCells, spec) => {
  const normed = (headerCells || []).map(norm);
  const out = {};
  const claimed = new Set();

  for (const key of Object.keys(spec)) {
    let idx = -1;
    for (const alias of spec[key]) {
      const found = normed.indexOf(norm(alias));
      if (found !== -1 && !claimed.has(found)) { idx = found; break; }
    }
    out[key] = idx;
    if (idx !== -1) claimed.add(idx);
  }

  for (const key of Object.keys(spec)) {
    if (out[key] !== -1) continue;
    for (const alias of spec[key]) {
      const a = norm(alias);
      if (a.length < 3) continue;
      // Header must be at least as specific as the alias. The reverse
      // direction is what let "Amount" answer to "Amount (Net)".
      const found = normed.findIndex((h, i) => h && !claimed.has(i) && h.startsWith(a));
      if (found !== -1) { out[key] = found; claimed.add(found); break; }
    }
  }
  return out;
};

const cell = (row, idx) => (idx == null || idx < 0) ? '' : String((row || [])[idx] ?? '').trim();

// ── Account classification ───────────────────────────────────────────────
// NetSuite account types → the statement_group the gl_* tables key on.
const ACCOUNT_TYPE_GROUP = {
  bank: 'asset',
  accountsreceivable: 'asset',
  othercurrentasset: 'asset',
  fixedasset: 'asset',
  otherasset: 'asset',
  deferredexpense: 'asset',
  unbilledreceivable: 'asset',
  accountspayable: 'liability',
  creditcard: 'liability',
  othercurrentliability: 'liability',
  longtermliability: 'liability',
  deferredrevenue: 'liability',
  equity: 'equity',
  income: 'income',
  otherincome: 'income',
  costofgoodssold: 'cogs',
  expense: 'expense',
  otherexpense: 'expense',
  statistical: 'statistical',
  nonposting: 'nonposting',
};

// Number-range fallback, used only when Type is absent. This is the guessing
// the handoff doc §5.1 warns about — callers surface it as `unverified`.
// Keyed on the leading digit, not a fixed range: National Sports Apparel's
// chart of accounts is five digits (10100 Checking, 40000 Sales, 51300
// Purchases), and a 1000-9999 range check returns null for every one of them.
// Leading-digit keeps the four-digit behaviour identical and extends it to
// any width.
const groupFromNumber = (num) => {
  const digits = String(num || '').replace(/\D/g, '');
  if (!digits) return null;
  switch (digits[0]) {
    case '1': return 'asset';
    case '2': return 'liability';
    case '3': return 'equity';
    case '4': return 'income';
    case '5': return 'cogs';
    case '6': case '7': case '8': case '9': return 'expense';
    default: return null;
  }
};

const classifyAccount = (accountType, accountNumber) => {
  const key = norm(accountType);
  if (key && ACCOUNT_TYPE_GROUP[key]) return { group: ACCOUNT_TYPE_GROUP[key], verified: true };
  // Loose contains-match for localized / decorated type strings.
  if (key) {
    for (const k of Object.keys(ACCOUNT_TYPE_GROUP)) {
      if (key.includes(k)) return { group: ACCOUNT_TYPE_GROUP[k], verified: true };
    }
  }
  const guessed = groupFromNumber(accountNumber);
  return { group: guessed, verified: false };
};

// ── Row-shape helpers ────────────────────────────────────────────────────
// NetSuite report bodies contain "Total - Income", "Total", blank spacer
// rows and repeated group headers. None are ledger rows.
const isTotalRow = (label) => /^\s*(total|subtotal|net\s+(income|loss|ordinary\s+income)|gross\s+profit)\b/i.test(String(label || ''));
const isBlankRow = (row) => !(row || []).some(c => String(c ?? '').trim());

// "1000 Checking : 1010 Operating" → leaf "1010 Operating", parent "1000 Checking"
const splitFullName = (full) => {
  const s = String(full || '').trim();
  if (!s) return { leaf: '', parent: null };
  const parts = s.split(':').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { leaf: s, parent: null };
  return { leaf: parts[parts.length - 1], parent: parts.slice(0, -1).join(' : ') };
};

// "4000 Sales" → { number: '4000', name: 'Sales' }
// "10100 - First Foundation Checking" → { number: '10100', name: 'First
// Foundation Checking' } — NSA's exports separate number from name with a
// spaced dash, and leaving it attached puts "- Sales" in gl_accounts.name.
// A dash *inside* the number ("1000-01 Operating") has no surrounding space,
// so it stays part of the number.
const splitNumberName = (label) => {
  const s = String(label || '').trim();
  const m = /^(\d[\d.]*(?:-\d[\d.]*)*)\s+(?:[-–—:]+\s*)?(.*)$/.exec(s);
  if (m) return { number: m[1], name: m[2].trim() };
  return { number: '', name: s };
};

const parseDate = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return null;
  // ISO first — unambiguous.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  // NetSuite US default M/D/YYYY.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (parseInt(y, 10) > 70 ? '19' : '20') + y;
    return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
};

const yearOf = (isoDate) => {
  const m = /^(\d{4})/.exec(String(isoDate || ''));
  return m ? parseInt(m[1], 10) : null;
};

// Deterministic id — same input row always produces the same key, so a
// re-import overwrites rather than duplicating. Not a hash: readable ids
// make a bad import diagnosable by eye in the table.
const slug = (s, max) => String(s || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max || 60);

// ═══════════════════════════════════════════════════════════════════════
// 5.1 CHART OF ACCOUNTS → gl_accounts
// ═══════════════════════════════════════════════════════════════════════
const COA_SPEC = {
  number: ['Number', 'Account Number', 'Acct No', 'No.'],
  name: ['Name', 'Account Name', 'Account'],
  fullName: ['Full Name', 'Account (Full Name)', 'Full Account Name'],
  type: ['Type', 'Account Type'],
  internalId: ['Internal ID', 'InternalId', 'Internal Id'],
  inactive: ['Inactive', 'Is Inactive'],
  isSummary: ['Summary', 'Is Summary'],
  parent: ['Parent', 'Sub Account Of', 'Subaccount Of'],
};

const parseChartOfAccounts = (text) => {
  const rows = parseTabular(text);
  const warnings = [];
  const { index: hIdx, hits } = findHeaderRow(rows, [
    ['Name', 'Account Name', 'Account'],
    ['Type', 'Account Type'],
    ['Internal ID', 'Number', 'Account Number'],
  ]);
  if (hIdx < 0 || hits < 2) {
    return { rows: [], warnings: ['Could not find a chart-of-accounts header row (looked for Name / Type / Internal ID).'], header: null, unverifiedCount: 0 };
  }
  const header = rows[hIdx];
  const col = mapColumns(header, COA_SPEC);
  if (col.type < 0) warnings.push('No "Type" column found — every account will be classified by number range and flagged unverified (see handoff §5.1).');
  if (col.internalId < 0) warnings.push('No "Internal ID" column found — accounts will key on number/name instead, so a renamed account re-imports as a new row.');

  const out = [];
  const seen = new Set();
  let unverifiedCount = 0;
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const rawName = cell(row, col.name);
    const rawFull = cell(row, col.fullName);
    if (!rawName && !rawFull) continue;
    if (isTotalRow(rawName) || isTotalRow(rawFull)) continue;

    const fullName = rawFull || rawName;
    const { leaf, parent } = splitFullName(fullName);
    const explicitParent = cell(row, col.parent);
    let number = cell(row, col.number);
    let name = rawName || leaf;
    if (!number) {
      const sp = splitNumberName(name);
      if (sp.number) { number = sp.number; name = sp.name; }
    }
    const type = cell(row, col.type);
    const { group, verified } = classifyAccount(type, number);
    if (!verified) unverifiedCount++;

    const internalId = cell(row, col.internalId);
    const id = internalId ? `ns-${internalId}` : `acct-${slug(number || name, 48)}`;
    if (seen.has(id)) { warnings.push(`Duplicate account key "${id}" — later row kept.`); }
    seen.add(id);

    const inactiveRaw = cell(row, col.inactive);
    const summaryRaw = cell(row, col.isSummary);
    out.push({
      id,
      netsuite_internal_id: internalId || null,
      account_number: number || null,
      name: name || leaf || fullName,
      full_name: fullName || null,
      parent_full_name: explicitParent || parent || null,
      account_type: type || null,
      statement_group: group,
      is_summary: /^(t|true|yes|y|1)$/i.test(summaryRaw),
      is_inactive: /^(t|true|yes|y|1)$/i.test(inactiveRaw),
      _typeVerified: verified,
    });
  }
  if (!out.length) warnings.push('Header row found but no account rows parsed.');
  return { rows: out, warnings, header, unverifiedCount };
};

// ═══════════════════════════════════════════════════════════════════════
// 5.2 GENERAL LEDGER DETAIL → gl_entries
// ═══════════════════════════════════════════════════════════════════════
const GL_SPEC = {
  date: ['Date', 'Transaction Date', 'Trandate'],
  period: ['Period', 'Posting Period', 'Accounting Period'],
  account: ['Account', 'Account Name', 'Split'],
  type: ['Type', 'Transaction Type'],
  docNumber: ['Document Number', 'Document Number/ID', 'Number', 'Ref No.', 'Doc Num'],
  name: ['Name', 'Entity', 'Customer', 'Vendor'],
  memo: ['Memo', 'Memo (Main)', 'Description'],
  debit: ['Debit', 'Debit Amount'],
  credit: ['Credit', 'Credit Amount'],
  amount: ['Amount', 'Amount (Debit/Credit)'],
  internalId: ['Internal ID', 'InternalId', 'Transaction Internal ID'],
  subsidiary: ['Subsidiary'],
  department: ['Department'],
  klass: ['Class'],
  location: ['Location'],
};

// The GL report is account-grouped: an account header line, then its
// transactions, then a "Total - <account>" line. Rows carry no account of
// their own, so we track the current group header and stamp it on.
const parseGlDetail = (text, opts) => {
  const options = opts || {};
  const rows = parseTabular(text);
  const warnings = [];
  const { index: hIdx, hits } = findHeaderRow(rows, [
    ['Date', 'Transaction Date'],
    ['Debit', 'Amount'],
    ['Credit', 'Type', 'Account'],
  ]);
  if (hIdx < 0 || hits < 2) {
    return { rows: [], warnings: ['Could not find a general-ledger header row (looked for Date / Debit / Credit).'], header: null, totals: { debitCents: 0, creditCents: 0, balanced: true }, };
  }
  const header = rows[hIdx];
  const col = mapColumns(header, GL_SPEC);
  const hasDebitCredit = col.debit >= 0 && col.credit >= 0;
  if (!hasDebitCredit && col.amount < 0) {
    return { rows: [], warnings: ['No Debit/Credit columns and no Amount column — cannot read this as a general ledger.'], header, totals: { debitCents: 0, creditCents: 0, balanced: true } };
  }
  if (!hasDebitCredit) warnings.push('No separate Debit/Credit columns — using signed Amount (positive = debit, negative = credit).');

  const out = [];
  let currentAccount = '';
  let debitCents = 0, creditCents = 0;
  let skippedNoDate = 0;

  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const acctCell = cell(row, col.account);
    const dateRaw = cell(row, col.date);
    const iso = parseDate(dateRaw);

    // A row with an account but no date is a group header for that account.
    if (!iso) {
      const firstNonEmpty = (row || []).map(c => String(c ?? '').trim()).find(Boolean) || '';
      if (isTotalRow(acctCell) || isTotalRow(firstNonEmpty)) continue; // "Total - Sales"
      const candidate = acctCell || firstNonEmpty;
      // Only treat as a header if the row is essentially just a label.
      const populated = (row || []).filter(c => String(c ?? '').trim()).length;
      if (candidate && populated <= 2) { currentAccount = candidate; continue; }
      if (candidate) skippedNoDate++;
      continue;
    }

    const accountLabel = acctCell || currentAccount;
    if (!accountLabel) { warnings.push(`Row ${r + 1}: no account could be determined — skipped.`); continue; }
    const { leaf, parent } = splitFullName(accountLabel);
    const sp = splitNumberName(leaf);

    let dCents = 0, cCents = 0;
    if (hasDebitCredit) {
      dCents = toCents(cell(row, col.debit));
      cCents = toCents(cell(row, col.credit));
      // A negative debit is really a credit; normalise so the totals tie.
      if (dCents < 0) { cCents += -dCents; dCents = 0; }
      if (cCents < 0) { dCents += -cCents; cCents = 0; }
    } else {
      const amt = toCents(cell(row, col.amount));
      if (amt >= 0) dCents = amt; else cCents = -amt;
    }
    if (dCents === 0 && cCents === 0 && hasDebitCredit
      && isBlankMoney(cell(row, col.debit)) && isBlankMoney(cell(row, col.credit))) {
      continue; // spacer / non-posting line
    }
    debitCents += dCents;
    creditCents += cCents;

    const internalId = cell(row, col.internalId);
    const docNumber = cell(row, col.docNumber);
    const entryDate = iso;
    const fy = options.fiscalYear || yearOf(entryDate);
    const idBase = internalId
      ? `${internalId}-${slug(sp.number || sp.name, 24)}-${r}`
      : `${entryDate}-${slug(docNumber || 'na', 20)}-${slug(sp.number || sp.name, 24)}-${r}`;

    out.push({
      id: `gl-${idBase}`,
      account_id: null, // resolved against gl_accounts at write time
      account_number: sp.number || null,
      account_name: sp.name || leaf || null,
      account_full_name: accountLabel,
      statement_group: null, // resolved from gl_accounts at write time
      entry_date: entryDate,
      fiscal_year: fy,
      period: cell(row, col.period) || null,
      transaction_type: cell(row, col.type) || null,
      document_number: docNumber || null,
      netsuite_internal_id: internalId || null,
      entity_name: cell(row, col.name) || null,
      memo: cell(row, col.memo) || null,
      debit: centsToNum(dCents),
      credit: centsToNum(cCents),
      amount: centsToNum(dCents - cCents),
      subsidiary: cell(row, col.subsidiary) || null,
      department: cell(row, col.department) || null,
      class: cell(row, col.klass) || null,
      location: cell(row, col.location) || null,
      _parentFullName: parent,
    });
  }

  if (skippedNoDate) warnings.push(`${skippedNoDate} row(s) had no readable date and were skipped.`);
  const balanced = debitCents === creditCents;
  if (!balanced) {
    warnings.push(`OUT OF BALANCE: debits ${centsToNum(debitCents).toFixed(2)} vs credits ${centsToNum(creditCents).toFixed(2)} (difference ${centsToNum(debitCents - creditCents).toFixed(2)}). Handoff §5.2 says an unbalanced export is incomplete — re-run it.`);
  }
  if (!out.length) warnings.push('Header row found but no ledger rows parsed.');
  return {
    rows: out,
    warnings,
    header,
    totals: { debitCents, creditCents, balanced, debit: centsToNum(debitCents), credit: centsToNum(creditCents), difference: centsToNum(debitCents - creditCents) },
  };
};

// ═══════════════════════════════════════════════════════════════════════
// 5.3–5.5 TRIAL BALANCE / INCOME STATEMENT / BALANCE SHEET
//         → gl_account_balances
// ═══════════════════════════════════════════════════════════════════════
const BAL_SPEC = {
  account: ['Account', 'Financial Row', 'Name', 'Account Name'],
  debit: ['Debit', 'Debit Amount'],
  credit: ['Credit', 'Credit Amount'],
  amount: ['Amount', 'Total', 'Balance', 'Value'],
};

const parseBalanceReport = (text, reportType, opts) => {
  const options = opts || {};
  const rows = parseTabular(text);
  const warnings = [];
  const { index: hIdx, hits } = findHeaderRow(rows, [
    ['Account', 'Financial Row', 'Name'],
    ['Debit', 'Amount', 'Total', 'Balance'],
  ]);
  if (hIdx < 0 || hits < 1) {
    return { rows: [], warnings: [`Could not find a ${reportType} header row.`], header: null, totals: { debitCents: 0, creditCents: 0, balanced: true } };
  }
  const header = rows[hIdx];
  const col = mapColumns(header, BAL_SPEC);
  const hasDebitCredit = col.debit >= 0 && col.credit >= 0;
  if (!hasDebitCredit && col.amount < 0) {
    return { rows: [], warnings: [`No Debit/Credit and no Amount column — cannot read this as a ${reportType}.`], header, totals: { debitCents: 0, creditCents: 0, balanced: true } };
  }

  const fy = options.fiscalYear || null;
  const period = options.period || null;
  const out = [];
  const seen = new Set();
  const idsSeen = new Map();
  let debitCents = 0, creditCents = 0;
  let netIncomeCents = null;

  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    let label = cell(row, col.account);
    if (!label) {
      label = (row || []).map(c => String(c ?? '').trim()).find(Boolean) || '';
    }
    if (!label) continue;

    // Capture net income off the P&L for the cross-check in handoff §7,
    // but never store the total line as if it were an account.
    if (isTotalRow(label)) {
      if (/net\s+(income|loss)/i.test(label)) {
        netIncomeCents = hasDebitCredit
          ? toCents(cell(row, col.debit)) - toCents(cell(row, col.credit))
          : toCents(cell(row, col.amount));
      }
      continue;
    }

    let dCents = 0, cCents = 0, amtCents = 0;
    if (hasDebitCredit) {
      dCents = toCents(cell(row, col.debit));
      cCents = toCents(cell(row, col.credit));
      if (dCents < 0) { cCents += -dCents; dCents = 0; }
      if (cCents < 0) { dCents += -cCents; cCents = 0; }
      amtCents = dCents - cCents;
      if (isBlankMoney(cell(row, col.debit)) && isBlankMoney(cell(row, col.credit))) continue;
    } else {
      amtCents = toCents(cell(row, col.amount));
      if (isBlankMoney(cell(row, col.amount))) continue;
      if (amtCents >= 0) dCents = amtCents; else cCents = -amtCents;
    }
    debitCents += dCents;
    creditCents += cCents;

    const { leaf, parent } = splitFullName(label);
    const sp = splitNumberName(leaf);
    const fullName = label;
    const key = `${reportType}|${fy || ''}|${period || ''}|${fullName}`;
    if (seen.has(key)) {
      warnings.push(`Duplicate row for "${fullName}" in ${reportType} — later value kept.`);
    }
    seen.add(key);

    // The row id encodes exactly (report_type, fiscal_year, period, full name),
    // which is what the upsert conflicts on. slug() truncates, so two very long
    // account names could in principle collapse to one id and silently
    // overwrite each other — say so rather than losing a row quietly.
    const rowId = `bal-${slug(reportType, 20)}-${fy || 'na'}-${slug(period || '', 12)}-${slug(fullName, 60)}`;
    if (idsSeen.has(rowId) && idsSeen.get(rowId) !== fullName) {
      warnings.push(`"${fullName}" and "${idsSeen.get(rowId)}" both reduce to the same row id (${rowId}) — one would overwrite the other. Shorten one of the account names in NetSuite before importing.`);
    }
    idsSeen.set(rowId, fullName);

    out.push({
      id: rowId,
      account_id: null,
      account_number: sp.number || null,
      account_name: sp.name || leaf || null,
      account_full_name: fullName,
      statement_group: null,
      fiscal_year: fy,
      period: period,
      report_type: reportType,
      debit: hasDebitCredit ? centsToNum(dCents) : null,
      credit: hasDebitCredit ? centsToNum(cCents) : null,
      amount: centsToNum(amtCents),
      _parentFullName: parent,
    });
  }

  const balanced = debitCents === creditCents;
  if (reportType === 'trial_balance' && !balanced) {
    warnings.push(`OUT OF BALANCE: debits ${centsToNum(debitCents).toFixed(2)} vs credits ${centsToNum(creditCents).toFixed(2)} (difference ${centsToNum(debitCents - creditCents).toFixed(2)}). Handoff §5.3 says the tie-out is invalid until this balances.`);
  }
  if (!fy) warnings.push('No fiscal year supplied — set it on the import form, or the rows cannot be keyed to a year.');
  if (!out.length) warnings.push(`Header row found but no ${reportType} rows parsed.`);

  return {
    rows: out,
    warnings,
    header,
    totals: {
      debitCents, creditCents, balanced, hasDebitCredit,
      debit: centsToNum(debitCents), credit: centsToNum(creditCents),
      difference: centsToNum(debitCents - creditCents),
      netIncome: netIncomeCents === null ? null : centsToNum(netIncomeCents),
      netIncomeCents,
    },
  };
};

const parseTrialBalance = (text, opts) => parseBalanceReport(text, 'trial_balance', opts);
const parseIncomeStatement = (text, opts) => parseBalanceReport(text, 'income_statement', opts);
const parseBalanceSheet = (text, opts) => parseBalanceReport(text, 'balance_sheet', opts);

// ═══════════════════════════════════════════════════════════════════════
// 5.6 INVOICE + CREDIT MEMO SAVED SEARCH → customer_invoices
// The one that fixes the two real gaps: Subtotal/Tax are NULL on all 9,082
// existing rows, and no credit memo was ever imported.
// ═══════════════════════════════════════════════════════════════════════
const INV_SPEC = {
  date: ['Date', 'Transaction Date', 'Trandate'],
  type: ['Type', 'Transaction Type'],
  docNumber: ['Document Number', 'Document Number/ID', 'Number', 'Doc Num'],
  internalId: ['Internal ID', 'InternalId'],
  name: ['Name', 'Customer', 'Entity'],
  customerInternalId: ['Customer : Internal ID', 'Customer Internal ID', 'Entity Internal ID', 'Customer/Project : Internal ID'],
  status: ['Status'],
  // NetSuite has no field named "Subtotal". The pre-tax figure exports as
  // "Amount (Net of Tax)" (Transaction_NETAMOUNTNOTAX). Do NOT list
  // "Amount (Net)" here: that is Transaction_NETAMOUNT, which returns the
  // GROSS total and is indistinguishable from `Amount` in the data. Binding
  // it would populate subtotal with tax-inclusive figures and report the
  // sales-tax gap as fixed. Better to leave subtotal unbound and warn.
  subtotal: ['Amount (Net of Tax)', 'Amount Net of Tax', 'Subtotal', 'Sub Total'],
  // The two tax fields are labelled backwards from their internal names.
  // The column displayed as "Tax Total" (Transaction_TRANTAXTOTAL) is
  // populated on every row and zero on every row. Real sales tax lives in
  // "Amount (Transaction Tax Total)" (Transaction_TAXTOTAL), so it must be
  // tried FIRST — an export carrying both would otherwise bind the zeroes.
  tax: ['Amount (Transaction Tax Total)', 'Amount Transaction Tax Total', 'Tax Total', 'Tax Amount', 'Sales Tax', 'Tax'],
  amount: ['Amount', 'Total', 'Amount (Gross)', 'Total Amount'],
  subsidiary: ['Subsidiary'],
  salesRep: ['Sales Rep', 'Sales Representative', 'Rep'],
  memo: ['Memo', 'Memo (Main)'],
};

// NetSuite writes credit memos as "Credit Memo" / "CredMemo" / "Credit Memos".
const normalizeDocType = (raw) => {
  const t = norm(raw);
  if (!t) return 'invoice';
  if (t.includes('creditmemo') || t.includes('credmemo') || t === 'creditmemos') return 'credit_memo';
  if (t.includes('cashsale')) return 'cash_sale';
  if (t.includes('invoice')) return 'invoice';
  return slug(raw, 30).replace(/-/g, '_') || 'invoice';
};

const parseInvoiceSearch = (text) => {
  const rows = parseTabular(text);
  const warnings = [];
  const { index: hIdx, hits } = findHeaderRow(rows, [
    ['Date', 'Transaction Date'],
    ['Internal ID', 'Document Number', 'Number'],
    ['Amount', 'Total'],
  ]);
  if (hIdx < 0 || hits < 2) {
    return { rows: [], warnings: ['Could not find an invoice-search header row (looked for Date / Internal ID / Amount).'], header: null, summary: null };
  }
  const header = rows[hIdx];
  const col = mapColumns(header, INV_SPEC);

  // NetSuite exports "Customer : Internal ID" with its join prefix stripped,
  // so the file carries three separate columns all headed "Internal ID"
  // (transaction id, transaction id again, customer id). Header-name lookup
  // can only ever find the first, and any parser building a dict from the
  // header keeps only the last. Resolve the customer one by position: it is
  // the first unclaimed "Internal ID" appearing after the Name column.
  if (col.customerInternalId < 0 && col.name >= 0) {
    const claimed = new Set(Object.values(col).filter(i => i >= 0));
    const found = header.findIndex((h, i) =>
      i > col.name && !claimed.has(i) && norm(h) === 'internalid');
    if (found !== -1) col.customerInternalId = found;
  }

  // These two are the entire reason the export is being re-run (handoff §6).
  if (col.subtotal < 0) warnings.push('NO "Subtotal" COLUMN — this export does not fix the missing pre-tax revenue. Re-run the saved search with Subtotal included (handoff §5.6).');
  if (col.tax < 0) warnings.push('NO "Tax Total" COLUMN — this export does not fix the missing sales-tax figure. Re-run the saved search with Tax Total included (handoff §5.6).');
  if (col.internalId < 0) warnings.push('NO "Internal ID" COLUMN — without it a re-import cannot match existing rows and would duplicate every invoice. Refusing to treat this as loadable.');

  const out = [];
  const seen = new Set();
  const byType = {};
  const byYear = {};
  let dupes = 0;
  let missingInternalId = 0;
  let subtotalFromGross = 0;
  let taxOnBlankSubtotal = 0;
  let taxPopulated = 0;
  let taxSumCents = 0;
  let taxableRows = 0;

  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const internalId = cell(row, col.internalId);
    const docNumber = cell(row, col.docNumber);
    if (!internalId && !docNumber) continue;
    const label = cell(row, col.name) || docNumber;
    if (isTotalRow(label) || isTotalRow(docNumber)) continue;

    const iso = parseDate(cell(row, col.date));
    if (!iso) { warnings.push(`Row ${r + 1} (doc ${docNumber || internalId}): unreadable date — skipped.`); continue; }

    const docType = normalizeDocType(cell(row, col.type));
    const totalCents = toCents(cell(row, col.amount));
    const taxCents = col.tax >= 0 && !isBlankMoney(cell(row, col.tax)) ? toCents(cell(row, col.tax)) : null;
    // "Amount (Net of Tax)" is BLANK, not zero, on non-taxable documents, and
    // the tax cell is blank on exactly the same rows. On those the gross
    // Amount already IS the pre-tax figure. Treating blank as 0 understates
    // the pre-tax total by the entire non-taxable population — $1,757,945.13
    // across the 984 such rows in the 2024-2026 export.
    let subtotalCents = null;
    if (col.subtotal >= 0) {
      if (!isBlankMoney(cell(row, col.subtotal))) {
        subtotalCents = toCents(cell(row, col.subtotal));
      } else {
        subtotalCents = totalCents;
        subtotalFromGross++;
        if (taxCents) taxOnBlankSubtotal++;
      }
    }
    if (taxCents !== null) { taxPopulated++; taxSumCents += taxCents; }

    // Consistency check per document — subtotal + tax should equal total.
    if (subtotalCents !== null && taxCents !== null) {
      const diff = subtotalCents + taxCents - totalCents;
      // Allow a 1c rounding wobble; anything bigger is a real mismatch
      // (usually a shipping or discount column not in the export).
      if (Math.abs(diff) > 1) {
        warnings.push(`Doc ${docNumber || internalId}: subtotal ${centsToNum(subtotalCents).toFixed(2)} + tax ${centsToNum(taxCents).toFixed(2)} = ${centsToNum(subtotalCents + taxCents).toFixed(2)}, but Amount is ${centsToNum(totalCents).toFixed(2)} (off by ${centsToNum(diff).toFixed(2)}).`);
      }
    }

    if (subtotalCents !== null && subtotalCents !== totalCents) taxableRows++;

    const key = internalId || `doc-${docNumber}`;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    // customer_invoices.netsuite_internal_id is NOT NULL, so a row with a
    // blank Internal ID cannot be written. Count it here and let the caller
    // drop it visibly rather than having one bad row fail a whole batch.
    if (!internalId) missingInternalId++;

    const yr = yearOf(iso);
    byType[docType] = (byType[docType] || 0) + 1;
    if (yr) {
      if (!byYear[yr]) byYear[yr] = { invoice: { n: 0, cents: 0 }, credit_memo: { n: 0, cents: 0 }, other: { n: 0, cents: 0 } };
      const bucket = byYear[yr][docType] || byYear[yr].other;
      bucket.n++; bucket.cents += totalCents;
    }

    out.push({
      // MUST match the id convention already in customer_invoices:
      // all 9,082 existing rows are exactly 'inv-ns-' || netsuite_internal_id
      // (verified 2026-08-20, zero deviations). The upsert conflicts on
      // netsuite_internal_id, so a different prefix here would rewrite the
      // primary key of every existing row on the first import.
      id: internalId ? `inv-ns-${internalId}` : `inv-doc-${slug(docNumber, 40)}`,
      netsuite_internal_id: internalId || null,
      document_number: docNumber || null,
      invoice_date: iso,
      type: docType,
      status: cell(row, col.status) || null,
      subsidiary: cell(row, col.subsidiary) || null,
      rep_name: cell(row, col.salesRep) || null,
      raw_customer_name: cell(row, col.name) || null,
      raw_customer_nsid: cell(row, col.customerInternalId) || null,
      subtotal: subtotalCents === null ? null : centsToNum(subtotalCents),
      tax: taxCents === null ? null : centsToNum(taxCents),
      total: centsToNum(totalCents),
      memo: cell(row, col.memo) || null,
    });
  }

  // The mislabelled-tax-field trap: a bound tax column that is populated but
  // sums to exactly zero, while documents plainly carry tax, is NetSuite's
  // Transaction_TRANTAXTOTAL rather than the real figure.
  if (col.tax >= 0 && taxPopulated > 0 && taxSumCents === 0 && taxableRows > 0) {
    warnings.push(`The tax column ("${String(header[col.tax] || '').trim()}") is populated on ${taxPopulated} row(s) and zero on every one of them, yet ${taxableRows} document(s) have a pre-tax subtotal below their total. This is NetSuite's mislabelled "Tax Total" field — re-run the search selecting "Amount (Transaction Tax Total)" instead.`);
  }
  if (subtotalFromGross) warnings.push(`${subtotalFromGross} document(s) have a blank pre-tax amount (non-taxable) — their gross Amount was used as the subtotal, per the verified NetSuite rule. Blank is not zero.`);
  if (taxOnBlankSubtotal) warnings.push(`${taxOnBlankSubtotal} document(s) have a blank pre-tax amount but a non-zero tax figure. That contradicts NetSuite's own invariant — check these before loading.`);
  if (dupes) warnings.push(`${dupes} duplicate Internal ID row(s) collapsed — first occurrence kept.`);
  if (missingInternalId) warnings.push(`${missingInternalId} row(s) have a blank Internal ID and cannot be written (the column is NOT NULL) — they will be skipped on import. Re-run the search so every document carries its Internal ID.`);
  if (!byType.credit_memo) warnings.push('No credit memos in this export. Handoff §6 says zero credit memos have ever been imported and the saved search must use "Type is any of Invoice, Credit Memo" — check that criterion before loading.');
  if (!out.length) warnings.push('Header row found but no invoice rows parsed.');

  const summary = {
    total: out.length,
    missingInternalId,
    byType,
    byYear: Object.keys(byYear).sort().reduce((acc, y) => {
      const v = byYear[y];
      acc[y] = {
        invoiceCount: v.invoice.n,
        invoiceTotal: centsToNum(v.invoice.cents),
        creditMemoCount: v.credit_memo.n,
        creditMemoTotal: centsToNum(v.credit_memo.cents),
      };
      return acc;
    }, {}),
    loadable: col.internalId >= 0,
    hasSubtotal: col.subtotal >= 0,
    hasTax: col.tax >= 0,
    subtotalFromGross,
    taxTotal: centsToNum(taxSumCents),
    hasCustomerInternalId: col.customerInternalId >= 0,
  };
  return { rows: out, warnings, header, summary };
};

// ── Tie-out (handoff §7) ─────────────────────────────────────────────────
// The expected figures are the portal's own current invoice data, so this
// is a self-consistency check, NOT independent verification of NetSuite.
// A re-export that dropped the same rows the original dropped will match
// these perfectly and still be incomplete.
const TIE_OUT_2026_08 = {
  2024: { count: 2786, total: 6977277.67 },
  2025: { count: 4186, total: 10709792.89 },
  2026: { count: 2110, total: 5220614.25 },
};

const checkTieOut = (summary, expected) => {
  const exp = expected || TIE_OUT_2026_08;
  const results = [];
  for (const y of Object.keys(exp)) {
    const got = (summary && summary.byYear && summary.byYear[y]) || null;
    const e = exp[y];
    const gotCount = got ? got.invoiceCount : 0;
    const gotTotal = got ? got.invoiceTotal : 0;
    const diff = gotTotal - e.total;
    const pct = e.total ? Math.abs(diff) / e.total * 100 : 0;
    results.push({
      year: parseInt(y, 10),
      expectedCount: e.count, actualCount: gotCount,
      expectedTotal: e.total, actualTotal: gotTotal,
      difference: Math.round(diff * 100) / 100,
      percentOff: Math.round(pct * 1000) / 1000,
      // >1% is the handoff's own "materially different" threshold.
      status: pct === 0 && gotCount === e.count ? 'match' : pct > 1 ? 'material' : 'minor',
    });
  }
  return results;
};

// ── Report-type detection ────────────────────────────────────────────────
const detectReportType = (text, filename) => {
  const f = String(filename || '').toLowerCase();
  if (/coa|chart.*account/.test(f)) return 'chart_of_accounts';
  if (/gl_detail|general.?ledger/.test(f)) return 'general_ledger';
  if (/trial.?balance/.test(f)) return 'trial_balance';
  if (/income.?statement|profit.*loss|p.?and.?l/.test(f)) return 'income_statement';
  if (/balance.?sheet/.test(f)) return 'balance_sheet';
  if (/invoice|tax/.test(f)) return 'invoice_search';

  const head = String(text || '').slice(0, 4000).toLowerCase();
  if (/trial\s+balance/.test(head)) return 'trial_balance';
  if (/balance\s+sheet/.test(head)) return 'balance_sheet';
  if (/income\s+statement|profit\s*(and|&)\s*loss/.test(head)) return 'income_statement';
  if (/general\s+ledger/.test(head)) return 'general_ledger';
  if (/tax\s*total|subtotal/.test(head) && /internal\s*id/.test(head)) return 'invoice_search';
  if (/account\s*type/.test(head)) return 'chart_of_accounts';
  return null;
};

const REPORT_PARSERS = {
  chart_of_accounts: parseChartOfAccounts,
  general_ledger: parseGlDetail,
  trial_balance: parseTrialBalance,
  income_statement: parseIncomeStatement,
  balance_sheet: parseBalanceSheet,
  invoice_search: parseInvoiceSearch,
};

const parseNetSuiteReport = (text, reportType, opts) => {
  const fn = REPORT_PARSERS[reportType];
  if (!fn) return { rows: [], warnings: [`Unknown report type "${reportType}".`], header: null };
  return fn(text, opts);
};

export {
  toCents, centsToNum, parseDelimited, parseSpreadsheetML, parseTabular,
  sniffDelimiter, isSpreadsheetML, classifyAccount, groupFromNumber,
  splitFullName, splitNumberName, parseDate, yearOf,
  parseChartOfAccounts, parseGlDetail, parseBalanceReport,
  parseTrialBalance, parseIncomeStatement, parseBalanceSheet,
  parseInvoiceSearch, checkTieOut, detectReportType, parseNetSuiteReport,
  normalizeDocType, TIE_OUT_2026_08, REPORT_PARSERS,
};
