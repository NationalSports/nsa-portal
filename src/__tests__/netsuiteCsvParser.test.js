import {
  toCents, parseDelimited, parseTabular, sniffDelimiter, parseSpreadsheetML,
  classifyAccount, splitFullName, splitNumberName, parseDate,
  parseChartOfAccounts, parseGlDetail, parseTrialBalance, parseIncomeStatement,
  parseBalanceSheet, parseInvoiceSearch, checkTieOut, detectReportType,
  normalizeDocType, TIE_OUT_2026_08,
} from '../lib/netsuiteCsvParser';

// NetSuite reports lead with title / company / date-range rows before the
// real header, end with "Total - X" lines, and indent subaccounts. Every
// fixture below keeps that shape so the parsers are exercised against the
// noise they will actually meet, not a clean table.

describe('money parsing (integer cents)', () => {
  it('reads plain, comma-grouped and currency-prefixed amounts', () => {
    expect(toCents('1234.56')).toBe(123456);
    expect(toCents('1,234.56')).toBe(123456);
    expect(toCents('$1,234.56')).toBe(123456);
    expect(toCents(' 1,234.56 ')).toBe(123456);
  });

  it('reads NetSuite negatives in all three notations', () => {
    expect(toCents('(1,234.56)')).toBe(-123456);
    expect(toCents('-1,234.56')).toBe(-123456);
    expect(toCents('1,234.56 CR')).toBe(-123456);
  });

  it('treats blanks and dashes as zero', () => {
    expect(toCents('')).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents('-')).toBe(0);
    expect(toCents('—')).toBe(0);
  });

  it('avoids float drift — the whole reason the check is in cents', () => {
    // 0.1 + 0.2 !== 0.3 in floats; in cents it is exact.
    expect(toCents('0.10') + toCents('0.20')).toBe(toCents('0.30'));
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += toCents('0.01');
    expect(sum).toBe(toCents('10.00'));
  });

  it('rounds a half cent away from zero rather than truncating', () => {
    expect(toCents('0.005')).toBe(1);
    expect(toCents('(0.005)')).toBe(-1);
  });
});

describe('delimited parsing', () => {
  it('honours quoted fields containing commas, quotes and newlines', () => {
    const csv = 'a,b,c\n"Smith, John","He said ""hi""","line1\nline2"\n';
    const rows = parseDelimited(csv, ',');
    expect(rows[1][0]).toBe('Smith, John');
    expect(rows[1][1]).toBe('He said "hi"');
    expect(rows[1][2]).toBe('line1\nline2');
  });

  it('strips a BOM and handles CRLF', () => {
    const rows = parseDelimited('﻿a,b\r\n1,2\r\n', ',');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['1', '2']);
  });

  it('sniffs tab-delimited exports', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('does not split on a delimiter inside quotes when sniffing', () => {
    const text = 'Name,Amount\n"Acme, Inc.",100\n';
    expect(sniffDelimiter(text)).toBe(',');
    expect(parseTabular(text)[1][0]).toBe('Acme, Inc.');
  });
});

describe('SpreadsheetML (NetSuite .xls export)', () => {
  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Sheet1"><Table>
<Row><Cell><Data ss:Type="String">Account</Data></Cell><Cell><Data ss:Type="String">Debit</Data></Cell><Cell><Data ss:Type="String">Credit</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">1000 Checking</Data></Cell><Cell><Data ss:Type="Number">100.00</Data></Cell><Cell ss:Index="3"><Data ss:Type="Number">0</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Smith &amp; Sons</Data></Cell><Cell><Data ss:Type="Number">50.00</Data></Cell></Row>
</Table></Worksheet></Workbook>`;

  it('parses rows and cells', () => {
    const rows = parseSpreadsheetML(xml);
    expect(rows[0]).toEqual(['Account', 'Debit', 'Credit']);
    expect(rows[1][0]).toBe('1000 Checking');
  });

  it('honours ss:Index so skipped columns do not shift later ones', () => {
    const rows = parseSpreadsheetML(xml);
    expect(rows[1][2]).toBe('0'); // Credit stays in column 3
  });

  it('decodes XML entities', () => {
    expect(parseSpreadsheetML(xml)[2][0]).toBe('Smith & Sons');
  });

  it('is picked up automatically by parseTabular', () => {
    expect(parseTabular(xml)[0][0]).toBe('Account');
  });
});

describe('account classification', () => {
  it('maps NetSuite account types to statement groups', () => {
    expect(classifyAccount('Bank', '1000')).toEqual({ group: 'asset', verified: true });
    expect(classifyAccount('Accounts Receivable', '1200').group).toBe('asset');
    expect(classifyAccount('Accounts Payable', '2000').group).toBe('liability');
    expect(classifyAccount('Equity', '3000').group).toBe('equity');
    expect(classifyAccount('Income', '4000').group).toBe('income');
    expect(classifyAccount('Cost of Goods Sold', '5000').group).toBe('cogs');
    expect(classifyAccount('Expense', '6000').group).toBe('expense');
    expect(classifyAccount('Other Income', '4900').group).toBe('income');
    expect(classifyAccount('Long Term Liability', '2900').group).toBe('liability');
  });

  it('falls back to number ranges and flags the guess as unverified', () => {
    expect(classifyAccount('', '4100')).toEqual({ group: 'income', verified: false });
    expect(classifyAccount('', '5100')).toEqual({ group: 'cogs', verified: false });
    expect(classifyAccount('', 'no-number')).toEqual({ group: null, verified: false });
  });

  // NSA's chart of accounts is five digits wide. A 1000-9999 range check
  // classified none of it, so the fallback was dead for this company.
  it('classifies the five-digit account numbers NSA actually uses', () => {
    expect(classifyAccount('', '10100').group).toBe('asset');    // Checking
    expect(classifyAccount('', '11000').group).toBe('asset');    // Accounts Receivable
    expect(classifyAccount('', '21000').group).toBe('liability');// Accounts Payable
    expect(classifyAccount('', '30000').group).toBe('equity');
    expect(classifyAccount('', '40000').group).toBe('income');   // Sales
    expect(classifyAccount('', '51300').group).toBe('cogs');     // Purchases
    expect(classifyAccount('', '60000').group).toBe('expense');  // Salaries and Wages
    expect(classifyAccount('', '78300').group).toBe('expense');  // Taxes and Licenses
  });
});

describe('name helpers', () => {
  it('splits NetSuite hierarchy names', () => {
    expect(splitFullName('1000 Checking : 1010 Operating'))
      .toEqual({ leaf: '1010 Operating', parent: '1000 Checking' });
    expect(splitFullName('4000 Sales')).toEqual({ leaf: '4000 Sales', parent: null });
  });

  it('splits leading account numbers off names', () => {
    expect(splitNumberName('4000 Sales')).toEqual({ number: '4000', name: 'Sales' });
    expect(splitNumberName('Sales')).toEqual({ number: '', name: 'Sales' });
  });

  // The real 2025/2026 exports separate number from name with a spaced dash.
  it('drops the spaced separator NSA exports put between number and name', () => {
    expect(splitNumberName('10100 - First Foundation Checking'))
      .toEqual({ number: '10100', name: 'First Foundation Checking' });
    expect(splitNumberName('40000 - Sales')).toEqual({ number: '40000', name: 'Sales' });
    expect(splitNumberName('21000 - Accounts Payable - Trade'))
      .toEqual({ number: '21000', name: 'Accounts Payable - Trade' });
    expect(splitNumberName('51300 : Purchases')).toEqual({ number: '51300', name: 'Purchases' });
  });

  it('keeps a dash that is part of the account number itself', () => {
    expect(splitNumberName('1000-01 Operating')).toEqual({ number: '1000-01', name: 'Operating' });
  });

  it('parses NetSuite US dates and ISO dates', () => {
    expect(parseDate('1/5/2025')).toBe('2025-01-05');
    expect(parseDate('12/31/2024')).toBe('2024-12-31');
    expect(parseDate('2025-06-01')).toBe('2025-06-01');
    expect(parseDate('')).toBeNull();
  });
});

describe('chart of accounts', () => {
  const coa = [
    'National Sports Apparel LLC',
    'Chart of Accounts',
    '',
    'Number,Name,Type,Internal ID,Inactive',
    '1000,Checking,Bank,101,No',
    '1200,Accounts Receivable,Accounts Receivable,102,No',
    '4000,Sales,Income,103,No',
    '5000,Cost of Goods Sold,Cost of Goods Sold,104,No',
    '6100,Rent,Expense,105,Yes',
    '',
  ].join('\n');

  it('skips the title rows and finds the real header', () => {
    const r = parseChartOfAccounts(coa);
    expect(r.rows).toHaveLength(5);
    expect(r.header).toContain('Number');
  });

  it('classifies each account and keys on the NetSuite internal id', () => {
    const r = parseChartOfAccounts(coa);
    const sales = r.rows.find(a => a.account_number === '4000');
    expect(sales.statement_group).toBe('income');
    expect(sales.id).toBe('ns-103');
    expect(sales.netsuite_internal_id).toBe('103');
    expect(r.unverifiedCount).toBe(0);
  });

  it('reads the Inactive flag', () => {
    const r = parseChartOfAccounts(coa);
    expect(r.rows.find(a => a.account_number === '6100').is_inactive).toBe(true);
    expect(r.rows.find(a => a.account_number === '1000').is_inactive).toBe(false);
  });

  it('warns loudly when Type is missing — the §5.1 guessing case', () => {
    const noType = 'Number,Name,Internal ID\n4000,Sales,103\n';
    const r = parseChartOfAccounts(noType);
    expect(r.warnings.join(' ')).toMatch(/No "Type" column/);
    expect(r.rows[0]._typeVerified).toBe(false);
    expect(r.unverifiedCount).toBe(1);
  });

  it('is idempotent — the same export yields the same ids', () => {
    const a = parseChartOfAccounts(coa).rows.map(r => r.id);
    const b = parseChartOfAccounts(coa).rows.map(r => r.id);
    expect(a).toEqual(b);
  });
});

describe('general ledger detail', () => {
  // Account-grouped layout: a bare account header, its transactions, then a
  // "Total - <account>" line that must not be read as a ledger row.
  const gl = [
    'National Sports Apparel LLC',
    'General Ledger',
    '1/1/2025 to 12/31/2025',
    '',
    'Date,Period,Account,Type,Document Number,Name,Memo,Debit,Credit,Internal ID',
    ',,1200 Accounts Receivable,,,,,,,',
    '1/15/2025,Jan 2025,,Invoice,INV1001,Acme Club,Spring order,"1,000.00",,5001',
    '2/20/2025,Feb 2025,,Invoice,INV1002,"Smith, John",Team gear,"500.00",,5002',
    'Total - 1200 Accounts Receivable,,,,,,,"1,500.00",,',
    ',,4000 Sales,,,,,,,',
    '1/15/2025,Jan 2025,,Invoice,INV1001,Acme Club,Spring order,,"1,000.00",5001',
    '2/20/2025,Feb 2025,,Invoice,INV1002,"Smith, John",Team gear,,"500.00",5002',
    'Total - 4000 Sales,,,,,,,,"1,500.00",',
    '',
  ].join('\n');

  it('stamps the group-header account onto its transaction rows', () => {
    const r = parseGlDetail(gl, { fiscalYear: 2025 });
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0].account_full_name).toBe('1200 Accounts Receivable');
    expect(r.rows[0].account_number).toBe('1200');
    expect(r.rows[2].account_full_name).toBe('4000 Sales');
  });

  it('excludes Total rows from the ledger', () => {
    const r = parseGlDetail(gl, { fiscalYear: 2025 });
    expect(r.rows.some(x => /^total/i.test(x.account_full_name || ''))).toBe(false);
  });

  it('ties debits to credits exactly', () => {
    const r = parseGlDetail(gl, { fiscalYear: 2025 });
    expect(r.totals.debitCents).toBe(150000);
    expect(r.totals.creditCents).toBe(150000);
    expect(r.totals.balanced).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/OUT OF BALANCE/);
  });

  it('flags an out-of-balance export instead of accepting it', () => {
    const broken = gl.replace('1/15/2025,Jan 2025,,Invoice,INV1001,Acme Club,Spring order,,"1,000.00",5001',
      '1/15/2025,Jan 2025,,Invoice,INV1001,Acme Club,Spring order,,"900.00",5001');
    const r = parseGlDetail(broken, { fiscalYear: 2025 });
    expect(r.totals.balanced).toBe(false);
    expect(r.totals.difference).toBeCloseTo(100, 2);
    expect(r.warnings.join(' ')).toMatch(/OUT OF BALANCE/);
  });

  it('keeps quoted commas inside names intact', () => {
    const r = parseGlDetail(gl, { fiscalYear: 2025 });
    expect(r.rows[1].entity_name).toBe('Smith, John');
  });

  it('normalises a negative debit into a credit so totals still tie', () => {
    const neg = [
      'Date,Account,Debit,Credit',
      '1/5/2025,4000 Sales,"(100.00)",',
      '1/5/2025,1200 AR,"100.00",',
    ].join('\n');
    const r = parseGlDetail(neg, { fiscalYear: 2025 });
    expect(r.totals.debitCents).toBe(10000);
    expect(r.totals.creditCents).toBe(10000);
    expect(r.totals.balanced).toBe(true);
  });

  it('falls back to a signed Amount column when Debit/Credit are absent', () => {
    const amt = [
      'Date,Account,Type,Amount',
      '1/5/2025,1200 AR,Invoice,"100.00"',
      '1/5/2025,4000 Sales,Invoice,"(100.00)"',
    ].join('\n');
    const r = parseGlDetail(amt, { fiscalYear: 2025 });
    expect(r.rows).toHaveLength(2);
    expect(r.totals.balanced).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/signed Amount/);
  });

  it('derives the fiscal year from the row date when none is supplied', () => {
    expect(parseGlDetail(gl).rows[0].fiscal_year).toBe(2025);
  });
});

describe('trial balance', () => {
  const tb = [
    'National Sports Apparel LLC',
    'Trial Balance',
    'As of 12/31/2025',
    '',
    'Account,Debit,Credit',
    '1000 Checking,"50,000.00",',
    '1200 Accounts Receivable,"25,000.00",',
    '2000 Accounts Payable,,"15,000.00"',
    '3000 Equity,,"20,000.00"',
    '4000 Sales,,"100,000.00"',
    '5000 COGS,"60,000.00",',
    'Total,"135,000.00","135,000.00"',
  ].join('\n');

  it('parses accounts and excludes the Total line', () => {
    const r = parseTrialBalance(tb, { fiscalYear: 2025 });
    expect(r.rows).toHaveLength(6);
    expect(r.rows.some(x => /^total/i.test(x.account_full_name))).toBe(false);
  });

  it('balances exactly and tags every row with the report type', () => {
    const r = parseTrialBalance(tb, { fiscalYear: 2025 });
    expect(r.totals.balanced).toBe(true);
    expect(r.totals.debit).toBe(135000);
    expect(r.rows.every(x => x.report_type === 'trial_balance')).toBe(true);
    expect(r.rows.every(x => x.fiscal_year === 2025)).toBe(true);
  });

  it('flags an unbalanced trial balance', () => {
    const broken = tb.replace('5000 COGS,"60,000.00",', '5000 COGS,"59,000.00",');
    const r = parseTrialBalance(broken, { fiscalYear: 2025 });
    expect(r.totals.balanced).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/OUT OF BALANCE/);
  });

  it('produces stable keys matching the unique index shape', () => {
    const r = parseTrialBalance(tb, { fiscalYear: 2025 });
    const ids = r.rows.map(x => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseTrialBalance(tb, { fiscalYear: 2025 }).rows.map(x => x.id)).toEqual(ids);
  });
});

describe('income statement', () => {
  const is = [
    'National Sports Apparel LLC',
    'Income Statement',
    '1/1/2025 to 12/31/2025',
    '',
    'Financial Row,Amount',
    '4000 Sales,"100,000.00"',
    '5000 Cost of Goods Sold,"(60,000.00)"',
    'Gross Profit,"40,000.00"',
    '6100 Rent,"(12,000.00)"',
    'Net Income,"28,000.00"',
  ].join('\n');

  it('captures net income for the §7 cross-check without storing it as an account', () => {
    const r = parseIncomeStatement(is, { fiscalYear: 2025 });
    expect(r.totals.netIncome).toBe(28000);
    expect(r.rows.some(x => /net income/i.test(x.account_full_name))).toBe(false);
    expect(r.rows.some(x => /gross profit/i.test(x.account_full_name))).toBe(false);
  });

  it('reads parenthesised amounts as negatives', () => {
    const r = parseIncomeStatement(is, { fiscalYear: 2025 });
    expect(r.rows.find(x => x.account_number === '5000').amount).toBe(-60000);
  });
});

describe('balance sheet', () => {
  it('parses as-of balances', () => {
    const bs = [
      'Balance Sheet', 'As of 12/31/2025', '',
      'Account,Amount',
      '1000 Checking,"50,000.00"',
      '2000 Accounts Payable,"(15,000.00)"',
      'Total,"35,000.00"',
    ].join('\n');
    const r = parseBalanceSheet(bs, { fiscalYear: 2025 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every(x => x.report_type === 'balance_sheet')).toBe(true);
  });
});

describe('invoice + credit memo saved search (file 8)', () => {
  const inv = [
    'Date,Type,Document Number,Internal ID,Name,Customer : Internal ID,Status,Subtotal,Tax Total,Amount,Subsidiary,Sales Rep,Memo',
    '1/15/2024,Invoice,INV1001,5001,Acme Club,C100,Paid In Full,"1,000.00","80.00","1,080.00",NSA,Jane Rep,Spring',
    '2/20/2025,Invoice,INV1002,5002,"Smith, John",C101,Open,"500.00","40.00","540.00",NSA,Jane Rep,Team',
    '3/10/2025,Credit Memo,CM2001,6001,Acme Club,C100,Fully Applied,"(200.00)","(16.00)","(216.00)",NSA,Jane Rep,Return',
    '',
  ].join('\n');

  it('parses subtotal and tax — the columns missing from all 9,082 portal rows', () => {
    const r = parseInvoiceSearch(inv);
    const first = r.rows.find(x => x.document_number === 'INV1001');
    expect(first.subtotal).toBe(1000);
    expect(first.tax).toBe(80);
    expect(first.total).toBe(1080);
    expect(r.summary.hasSubtotal).toBe(true);
    expect(r.summary.hasTax).toBe(true);
  });

  it('recognises credit memos and keeps their negative amounts', () => {
    const r = parseInvoiceSearch(inv);
    const cm = r.rows.find(x => x.document_number === 'CM2001');
    expect(cm.type).toBe('credit_memo');
    expect(cm.total).toBe(-216);
    expect(cm.subtotal).toBe(-200);
    expect(r.summary.byType.credit_memo).toBe(1);
  });

  it('keys on the NetSuite internal id so a re-import cannot duplicate', () => {
    const r = parseInvoiceSearch(inv);
    expect(r.summary.loadable).toBe(true);
    const again = parseInvoiceSearch(inv);
    expect(again.rows.map(x => x.id)).toEqual(r.rows.map(x => x.id));
  });

  it('generates ids in the exact form already used by the 9,082 loaded rows', () => {
    // Every existing customer_invoices row is 'inv-ns-' || netsuite_internal_id.
    // The upsert conflicts on netsuite_internal_id, so any other prefix would
    // rewrite the primary key of all 9,082 rows on the first import.
    const r = parseInvoiceSearch(inv);
    expect(r.rows.find(x => x.document_number === 'INV1001').id).toBe('inv-ns-5001');
    expect(r.rows.every(x => x.id === `inv-ns-${x.netsuite_internal_id}`)).toBe(true);
  });

  it('collapses duplicate internal ids rather than double-loading', () => {
    const dup = inv.trimEnd() + '\n1/15/2024,Invoice,INV1001,5001,Acme Club,C100,Paid In Full,"1,000.00","80.00","1,080.00",NSA,Jane Rep,Spring\n';
    const r = parseInvoiceSearch(dup);
    expect(r.rows.filter(x => x.id === 'inv-ns-5001')).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/duplicate Internal ID/i);
  });

  it('warns when Subtotal is missing — the export then fixes nothing', () => {
    const noSub = [
      'Date,Type,Document Number,Internal ID,Name,Amount',
      '1/15/2024,Invoice,INV1001,5001,Acme Club,"1,080.00"',
    ].join('\n');
    const r = parseInvoiceSearch(noSub);
    expect(r.warnings.join(' ')).toMatch(/NO "Subtotal" COLUMN/);
    expect(r.warnings.join(' ')).toMatch(/NO "Tax Total" COLUMN/);
    expect(r.summary.hasSubtotal).toBe(false);
  });

  it('refuses to call an export loadable without Internal ID', () => {
    const noId = 'Date,Type,Document Number,Name,Amount\n1/15/2024,Invoice,INV1001,Acme,"1,080.00"\n';
    const r = parseInvoiceSearch(noId);
    expect(r.summary.loadable).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/duplicate every invoice/);
  });

  it('counts rows with a blank Internal ID, which the NOT NULL column rejects', () => {
    const blank = [
      'Date,Type,Document Number,Internal ID,Name,Subtotal,Tax Total,Amount',
      '1/15/2024,Invoice,INV1001,5001,Acme,"1,000.00","80.00","1,080.00"',
      '1/16/2024,Invoice,INV1002,,Beta,"500.00","40.00","540.00"',
    ].join('\n');
    const r = parseInvoiceSearch(blank);
    expect(r.summary.missingInternalId).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/blank Internal ID/);
    // The row is still parsed; the import screen is what drops it.
    expect(r.rows).toHaveLength(2);
    expect(r.rows.filter(x => x.netsuite_internal_id)).toHaveLength(1);
  });

  it('warns when the export contains no credit memos at all', () => {
    const invOnly = [
      'Date,Type,Document Number,Internal ID,Name,Subtotal,Tax Total,Amount',
      '1/15/2024,Invoice,INV1001,5001,Acme,"1,000.00","80.00","1,080.00"',
    ].join('\n');
    expect(parseInvoiceSearch(invOnly).warnings.join(' ')).toMatch(/No credit memos/);
  });

  it('flags a document whose subtotal plus tax does not reach its total', () => {
    const bad = [
      'Date,Type,Document Number,Internal ID,Name,Subtotal,Tax Total,Amount',
      '1/15/2024,Invoice,INV9,9001,Acme,"1,000.00","80.00","1,200.00"',
    ].join('\n');
    const r = parseInvoiceSearch(bad);
    expect(r.warnings.join(' ')).toMatch(/off by -120\.00/);
  });

  it('tolerates a one-cent rounding wobble without crying wolf', () => {
    const wobble = [
      'Date,Type,Document Number,Internal ID,Name,Subtotal,Tax Total,Amount',
      '1/15/2024,Invoice,INV9,9001,Acme,"1,000.00","80.00","1,080.01"',
    ].join('\n');
    expect(parseInvoiceSearch(wobble).warnings.join(' ')).not.toMatch(/off by/);
  });

  it('summarises per year, splitting invoices from credit memos', () => {
    const r = parseInvoiceSearch(inv);
    expect(r.summary.byYear['2024'].invoiceCount).toBe(1);
    expect(r.summary.byYear['2024'].invoiceTotal).toBe(1080);
    expect(r.summary.byYear['2025'].invoiceCount).toBe(1);
    expect(r.summary.byYear['2025'].creditMemoCount).toBe(1);
    expect(r.summary.byYear['2025'].creditMemoTotal).toBe(-216);
  });

  it('normalises NetSuite credit-memo type spellings', () => {
    expect(normalizeDocType('Credit Memo')).toBe('credit_memo');
    expect(normalizeDocType('CredMemo')).toBe('credit_memo');
    expect(normalizeDocType('Invoice')).toBe('invoice');
  });
});

describe('tie-out against the portal figures (handoff §7)', () => {
  it('reports a match when the export reproduces the expected invoice totals', () => {
    const summary = {
      byYear: {
        2024: { invoiceCount: 2786, invoiceTotal: 6977277.67 },
        2025: { invoiceCount: 4186, invoiceTotal: 10709792.89 },
        2026: { invoiceCount: 2110, invoiceTotal: 5220614.25 },
      },
    };
    const res = checkTieOut(summary);
    expect(res.every(r => r.status === 'match')).toBe(true);
  });

  it('flags a >1% gap as material, per the handoff threshold', () => {
    const summary = { byYear: { 2024: { invoiceCount: 2700, invoiceTotal: 6000000 }, 2025: { invoiceCount: 4186, invoiceTotal: 10709792.89 }, 2026: { invoiceCount: 2110, invoiceTotal: 5220614.25 } } };
    const res = checkTieOut(summary);
    expect(res.find(r => r.year === 2024).status).toBe('material');
  });

  it('treats a missing year as a total miss rather than a silent pass', () => {
    const res = checkTieOut({ byYear: {} });
    expect(res.every(r => r.status === 'material')).toBe(true);
  });

  it('the published expectations sum to the portal total of $22,907,684.81', () => {
    const sum = Object.values(TIE_OUT_2026_08).reduce((a, v) => a + Math.round(v.total * 100), 0);
    expect(sum).toBe(Math.round(22907684.81 * 100));
  });
});

describe('report-type detection', () => {
  it('detects from the handoff filenames', () => {
    expect(detectReportType('', 'coa.csv')).toBe('chart_of_accounts');
    expect(detectReportType('', 'gl_detail_2025.csv')).toBe('general_ledger');
    expect(detectReportType('', 'trial_balance_2024.csv')).toBe('trial_balance');
    expect(detectReportType('', 'income_statement_2026_ytd.csv')).toBe('income_statement');
    expect(detectReportType('', 'balance_sheet_2025.csv')).toBe('balance_sheet');
    expect(detectReportType('', 'invoices_with_tax_2024_2026.csv')).toBe('invoice_search');
  });

  it('falls back to report content when the filename is unhelpful', () => {
    expect(detectReportType('National Sports Apparel\nTrial Balance\n', 'export.csv')).toBe('trial_balance');
    expect(detectReportType('Date,Internal ID,Subtotal,Tax Total\n', 'export.csv')).toBe('invoice_search');
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(detectReportType('a,b,c\n1,2,3', 'export.csv')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regressions from the first real export (account 6108444, 2026-08-20).
// The header below is byte-for-byte the one NetSuite produced. Three of its
// fifteen columns are called "Internal ID", the pre-tax field is called
// "Amount (Net of Tax)" and is BLANK on non-taxable documents, and the real
// sales tax lives in "Amount (Transaction Tax Total)".
// ─────────────────────────────────────────────────────────────────────────
describe('invoice search — the real NetSuite export shape', () => {
  const REAL_HEADER =
    'Internal ID,Date,Type,Period,Document Number,Internal ID,Name,Internal ID,Status,' +
    'Amount (Net of Tax),Amount (Transaction Tax Total),Amount,Subsidiary,Sales Rep,Memo';
  const realFile = (...lines) => [REAL_HEADER, ...lines].join('\n');

  it('binds the real tax column instead of reporting no tax at all', () => {
    const res = parseInvoiceSearch(realFile(
      '10609,7/1/2024,Invoice,Jul 2024,52766,10609,J Serra Baseball,2956,Paid In Full,2230.72,168.56,2399.28,NSA LLC,Chase Koissian,returners',
    ));
    expect(res.summary.hasTax).toBe(true);
    expect(res.rows[0].tax).toBe(168.56);
    expect(res.rows[0].subtotal).toBe(2230.72);
    expect(res.rows[0].total).toBe(2399.28);
  });

  it('prefers "Amount (Transaction Tax Total)" over the zero-filled "Tax Total"', () => {
    const res = parseInvoiceSearch([
      'Internal ID,Date,Type,Document Number,Name,Amount (Net of Tax),Tax Total,Amount (Transaction Tax Total),Amount',
      '1,1/2/2025,Invoice,INV1,Acme,100.00,0.00,8.25,108.25',
    ].join('\n'));
    expect(res.rows[0].tax).toBe(8.25);
  });

  it('warns when the only tax column present is populated but all zero', () => {
    const res = parseInvoiceSearch([
      'Internal ID,Date,Type,Document Number,Name,Amount (Net of Tax),Tax Total,Amount',
      '1,1/2/2025,Invoice,INV1,Acme,100.00,0.00,108.25',
    ].join('\n'));
    expect(res.warnings.some(w => /zero on every one of them/.test(w))).toBe(true);
  });

  it('never binds subtotal to "Amount (Net)", which returns the gross figure', () => {
    const res = parseInvoiceSearch([
      'Internal ID,Date,Type,Document Number,Name,Amount (Net),Amount',
      '1,1/2/2025,Invoice,INV1,Acme,108.25,108.25',
    ].join('\n'));
    expect(res.summary.hasSubtotal).toBe(false);
    expect(res.rows[0].subtotal).toBeNull();
    expect(res.warnings.some(w => /NO "Subtotal" COLUMN/.test(w))).toBe(true);
  });

  it('treats a blank pre-tax amount as non-taxable, not as zero', () => {
    const res = parseInvoiceSearch(realFile(
      '1,1/2/2025,Invoice,Jan 2025,INV1,1,Taxable Co,10,Paid In Full,100.00,8.25,108.25,NSA LLC,Rep,',
      '2,1/3/2025,Invoice,Jan 2025,INV2,2,Non-taxable Co,11,Paid In Full,,,250.00,NSA LLC,Rep,',
    ));
    expect(res.rows[1].subtotal).toBe(250.00);
    expect(res.rows[1].tax).toBeNull();
    expect(res.summary.subtotalFromGross).toBe(1);
    // subtotal + tax must still reconcile to the gross total across the file
    const sub = res.rows.reduce((a, r) => a + r.subtotal, 0);
    const tax = res.rows.reduce((a, r) => a + (r.tax || 0), 0);
    const tot = res.rows.reduce((a, r) => a + r.total, 0);
    expect(Number((sub + tax).toFixed(2))).toBe(Number(tot.toFixed(2)));
  });

  it('resolves the customer Internal ID from the third same-named column', () => {
    const res = parseInvoiceSearch(realFile(
      '10609,7/1/2024,Invoice,Jul 2024,52766,10609,J Serra Baseball,2956,Paid In Full,2230.72,168.56,2399.28,NSA LLC,Rep,',
    ));
    expect(res.summary.hasCustomerInternalId).toBe(true);
    expect(res.rows[0].netsuite_internal_id).toBe('10609');
    expect(res.rows[0].raw_customer_nsid).toBe('2956');
  });

  it('flags a blank pre-tax amount that still carries tax', () => {
    const res = parseInvoiceSearch(realFile(
      '1,1/2/2025,Invoice,Jan 2025,INV1,1,Odd Co,10,Open,,8.25,108.25,NSA LLC,Rep,',
    ));
    expect(res.warnings.some(w => /contradicts NetSuite's own invariant/.test(w))).toBe(true);
  });
});

describe('amount-only reports carry no balance check', () => {
  // A NetSuite balance sheet exports one Amount column and prints liabilities
  // and equity as POSITIVE figures, so a debit/credit split derived from the
  // sign is meaningless and the two sides will never agree.
  const BS = [
    'National Sports Apparel LLC', 'Balance Sheet', 'End of Dec 2025', '', '',
    'Financial Row ,Amount ',
    'ASSETS,',
    '10100 - First Foundation Checking,"$514,706.00"',
    '11000 - Accounts Receivable,"$1,104,548.09"',
    'Total Bank,"$1,619,254.09"',
    'LIABILITIES AND EQUITY,',
    '21000 - Accounts Payable - Trade,"$1,271,470.36"',
    'Net Income,"$698,952.42"',
  ].join('\n');

  it('reports hasDebitCredit false so the UI does not cry "out of balance"', () => {
    const res = parseBalanceSheet(BS, { fiscalYear: 2025 });
    expect(res.totals.hasDebitCredit).toBe(false);
    expect(res.totals.netIncome).toBe(698952.42);
    expect(res.rows.length).toBe(3);
  });

  it('still reports hasDebitCredit true for a real trial balance', () => {
    const tb = [
      'National Sports Apparel LLC', 'Trial Balance', 'End of Dec 2025', '', '',
      'Account ,Debit ,Credit ',
      '10100 - First Foundation Checking,"$514,706.00",',
      '40000 - Sales,,"$514,706.00"',
    ].join('\n');
    const res = parseTrialBalance(tb, { fiscalYear: 2025 });
    expect(res.totals.hasDebitCredit).toBe(true);
    expect(res.totals.balanced).toBe(true);
  });

  it('warns when two account names collapse to the same row id', () => {
    const long = 'A'.repeat(70);
    const res = parseBalanceSheet([
      'Balance Sheet', '', '', '', '',
      'Financial Row ,Amount ',
      `${long}B,"$1.00"`,
      `${long}C,"$2.00"`,
    ].join('\n'), { fiscalYear: 2025 });
    expect(res.warnings.some(w => /same row id/.test(w))).toBe(true);
  });
});
