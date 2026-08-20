import {
  parseMoney, parseDate, mapColumns, classifyAccountType, classifyAccountNumber,
  isSummaryRow, detectReportType, parseGlDetail, parseChartOfAccounts, parseBalances,
  parseInvoiceTotals, buildIncomeStatement, buildBalanceSheet, buildTrialBalance,
  reconcile, buildAccountIndex, entryFingerprint, GL_ALIASES, round2,
} from '../lib/netsuiteFinancials';

// A minimal balanced ledger, written out by hand so the expected figures below
// are derived from the fixture rather than from the code under test:
//   Revenue    1000 credit  -> amount -1000
//   COGS        400 debit   -> amount  +400
//   Rent        150 debit   -> amount  +150
//   Cash        450 debit   -> amount  +450
// Sum = 0. Net income = 1000 - 400 - 150 = 450.
const ledger = [
  { account_full_name: 'Income : Apparel Sales', account_name: 'Apparel Sales', account_number: '4000', statement_group: 'income',  entry_date: '2025-03-04', fiscal_year: 2025, amount: -1000 },
  { account_full_name: 'COGS : Garments',        account_name: 'Garments',      account_number: '5000', statement_group: 'cogs',    entry_date: '2025-03-04', fiscal_year: 2025, amount: 400 },
  { account_full_name: 'Expense : Rent',         account_name: 'Rent',          account_number: '6000', statement_group: 'expense', entry_date: '2025-03-31', fiscal_year: 2025, amount: 150 },
  { account_full_name: 'Assets : Cash',          account_name: 'Cash',          account_number: '1000', statement_group: 'asset',   entry_date: '2025-03-04', fiscal_year: 2025, amount: 450 },
];

describe('parseMoney', () => {
  test('reads NetSuite money formats', () => {
    expect(parseMoney('$1,234.56')).toBe(1234.56);
    expect(parseMoney('1234.56')).toBe(1234.56);
    expect(parseMoney(1234.56)).toBe(1234.56);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
  });

  test('parentheses mean negative — the credit-side trap', () => {
    // Read naively, every credit in a NetSuite export comes back positive and
    // the whole trial balance is wrong by twice the credit total.
    expect(parseMoney('(1,234.56)')).toBe(-1234.56);
    expect(parseMoney('($500.00)')).toBe(-500);
  });

  test('an em/en dash is zero, not null', () => {
    expect(parseMoney('—')).toBe(0);
    expect(parseMoney('–')).toBe(0);
    expect(parseMoney('-')).toBe(0);
  });

  test('rounds to the cent', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(parseMoney('0.005')).toBe(0.01);
  });
});

describe('parseDate', () => {
  test('handles the formats NetSuite exports', () => {
    expect(parseDate('3/4/2025')).toBe('2025-03-04');
    expect(parseDate('03/04/2025')).toBe('2025-03-04');
    expect(parseDate('2025-03-04')).toBe('2025-03-04');
    expect(parseDate('12/31/25')).toBe('2025-12-31');
    expect(parseDate(new Date(2025, 2, 4))).toBe('2025-03-04');
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('mapColumns', () => {
  test('an exact match beats a substring match', () => {
    // "Memo (Main)" contains "memo", so a naive substring pass lets `memo`
    // claim it and leaves the real Memo column unmapped.
    const map = mapColumns(['Date', 'Memo (Main)', 'Memo', 'Amount'], GL_ALIASES);
    expect(map.memo).toBe('Memo');
  });

  test('one header is never claimed by two fields', () => {
    const map = mapColumns(['Date', 'Account', 'Debit', 'Credit'], GL_ALIASES);
    const used = Object.values(map);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('classifyAccountType', () => {
  test('specific types win over the looser pattern', () => {
    // 'Other Income' contains 'Income'; 'Cost of Goods Sold' is not 'Expense'.
    expect(classifyAccountType('Other Income')).toBe('other_income');
    expect(classifyAccountType('Income')).toBe('income');
    expect(classifyAccountType('Cost of Goods Sold')).toBe('cogs');
    expect(classifyAccountType('Expense')).toBe('expense');
    expect(classifyAccountType('Other Expense')).toBe('other_expense');
    expect(classifyAccountType('Accounts Receivable')).toBe('asset');
    expect(classifyAccountType('Accounts Payable')).toBe('liability');
    expect(classifyAccountType('Equity')).toBe('equity');
    expect(classifyAccountType('Bank')).toBe('asset');
    expect(classifyAccountType('')).toBeNull();
  });

  test('number ranges are the fallback', () => {
    expect(classifyAccountNumber('4010')).toBe('income');
    expect(classifyAccountNumber('5200')).toBe('cogs');
    expect(classifyAccountNumber('1010')).toBe('asset');
    expect(classifyAccountNumber('abc')).toBeNull();
  });
});

describe('isSummaryRow', () => {
  test('catches NetSuite subtotal rows', () => {
    expect(isSummaryRow('Total - Payroll Expenses')).toBe(true);
    expect(isSummaryRow('Net Income')).toBe(true);
    expect(isSummaryRow('Gross Profit')).toBe(true);
    expect(isSummaryRow('Total')).toBe(true);
    expect(isSummaryRow('Income : Apparel Sales')).toBe(false);
    expect(isSummaryRow('')).toBe(false);
  });
});

describe('detectReportType', () => {
  test('identifies each export by its headers', () => {
    expect(detectReportType(['Date', 'Account', 'Debit', 'Credit', 'Memo'])).toBe('gl_detail');
    expect(detectReportType(['Account', 'Debit', 'Credit'])).toBe('trial_balance');
    expect(detectReportType(['Number', 'Name', 'Type', 'Account Type'])).toBe('chart_of_accounts');
    expect(detectReportType(['Nothing', 'Useful'])).toBe('unknown');
  });
});

describe('parseGlDetail', () => {
  const rows = [
    { Date: '3/4/2025', Account: 'Income : Apparel Sales', 'Document Number': 'INV1', Debit: '', Credit: '1,000.00', Memo: 'March sale' },
    { Date: '3/4/2025', Account: '',                        'Document Number': 'INV1', Debit: '400.00', Credit: '', Memo: 'cogs' },
    { Date: '3/31/2025', Account: 'Expense : Rent',          'Document Number': 'BILL9', Debit: '150.00', Credit: '', Memo: 'rent' },
    { Date: '', Account: 'Total - Expenses', Debit: '550.00', Credit: '', Memo: '' },
  ];

  test('amount is debit minus credit', () => {
    const { entries } = parseGlDetail(rows);
    expect(entries[0].amount).toBe(-1000);   // credit
    expect(entries[2].amount).toBe(150);     // debit
  });

  test('a blank Account cell inherits the account above it', () => {
    // NetSuite prints the account once per group. Without carry-forward every
    // row after the first lands unclassified.
    const { entries } = parseGlDetail(rows);
    expect(entries[1].account_full_name).toBe('Income : Apparel Sales');
    expect(entries[1].amount).toBe(400);
  });

  test('subtotal rows are skipped, not summed', () => {
    const { entries, skipped } = parseGlDetail(rows);
    expect(entries.some((e) => /^total/i.test(e.account_full_name))).toBe(false);
    expect(skipped).toBe(1);
  });

  test('an unbalanced export is reported, not swallowed', () => {
    const { warnings, net } = parseGlDetail(rows);
    expect(net).toBe(-450);
    expect(warnings.some((w) => /Debits and credits differ/.test(w))).toBe(true);
  });

  test('a balanced export raises no imbalance warning', () => {
    const balanced = [
      { Date: '3/4/2025', Account: 'Income : Apparel Sales', Debit: '', Credit: '1,000.00' },
      { Date: '3/4/2025', Account: 'Assets : Cash', Debit: '1,000.00', Credit: '' },
    ];
    const { warnings, net } = parseGlDetail(balanced);
    expect(net).toBe(0);
    expect(warnings.some((w) => /Debits and credits differ/.test(w))).toBe(false);
  });

  test('re-importing the same file produces the same ids', () => {
    const a = parseGlDetail(rows).entries.map((e) => e.id);
    const b = parseGlDetail(rows).entries.map((e) => e.id);
    expect(a).toEqual(b);
  });

  test('two identical postings get distinct ids', () => {
    // Same account, date and amount twice is a real thing in a ledger. If both
    // hashed to one id the second would overwrite the first and the import
    // would silently lose money.
    const dupes = [
      { Date: '3/4/2025', Account: 'Expense : Postage', Debit: '10.00', Credit: '' },
      { Date: '3/4/2025', Account: 'Expense : Postage', Debit: '10.00', Credit: '' },
    ];
    const { entries } = parseGlDetail(dupes);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  test('a known chart of accounts classifies the entries', () => {
    const { accounts } = parseChartOfAccounts([
      { Number: '4000', Name: 'Apparel Sales', Account: 'Income : Apparel Sales', Type: 'Income' },
    ]);
    const { entries } = parseGlDetail(rows, { accountIndex: buildAccountIndex(accounts) });
    expect(entries[0].statement_group).toBe('income');
  });

  test('fiscal year comes off the entry date', () => {
    const { entries } = parseGlDetail(rows);
    expect(entries.every((e) => e.fiscal_year === 2025)).toBe(true);
  });

  test('an empty file is handled', () => {
    const r = parseGlDetail([]);
    expect(r.entries).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('entryFingerprint', () => {
  test('is stable and content-sensitive', () => {
    const e = { entry_date: '2025-03-04', account_full_name: 'Income : Apparel Sales', amount: -1000 };
    expect(entryFingerprint(e, 0)).toBe(entryFingerprint(e, 0));
    expect(entryFingerprint(e, 0)).not.toBe(entryFingerprint({ ...e, amount: -1001 }, 0));
    expect(entryFingerprint(e, 0)).not.toBe(entryFingerprint(e, 1));
  });
});

describe('buildIncomeStatement', () => {
  test('revenue reads positive even though it is stored as a credit', () => {
    const is = buildIncomeStatement(ledger);
    expect(is.sections.income[0].amount).toBe(-1000);   // at rest: credit
    expect(is.sections.income[0].display).toBe(1000);   // on the statement
  });

  test('the totals match the hand-computed fixture', () => {
    const is = buildIncomeStatement(ledger);
    expect(is.totals.revenue).toBe(1000);
    expect(is.totals.cogs).toBe(400);
    expect(is.totals.grossProfit).toBe(600);
    expect(is.totals.opex).toBe(150);
    expect(is.totals.netIncome).toBe(450);
  });

  test('net income re-derives by an independent route', () => {
    // Route A sums the sections; route B negates the raw sum of every P&L
    // amount. They agree only if no group was dropped from route A.
    const is = buildIncomeStatement(ledger);
    expect(is.checkNetIncome).toBe(is.totals.netIncome);
  });

  test('balance-sheet accounts stay out of the P&L', () => {
    const is = buildIncomeStatement(ledger);
    expect(is.entryCount).toBe(3);
    expect(JSON.stringify(is.sections)).not.toMatch(/Cash/);
  });

  test('other income and other expense land below operating income', () => {
    const is = buildIncomeStatement([
      ...ledger,
      { account_full_name: 'Other Income : Interest', statement_group: 'other_income', amount: -50 },
      { account_full_name: 'Other Expense : Fees', statement_group: 'other_expense', amount: 20 },
    ]);
    expect(is.totals.operatingIncome).toBe(450);
    expect(is.totals.netIncome).toBe(480);      // 450 + 50 - 20
    expect(is.checkNetIncome).toBe(480);
  });
});

describe('buildBalanceSheet', () => {
  test('liabilities and equity read positive', () => {
    const bs = buildBalanceSheet([
      { account_full_name: 'Assets : Cash', statement_group: 'asset', amount: 1000 },
      { account_full_name: 'Liabilities : AP', statement_group: 'liability', amount: -300 },
      { account_full_name: 'Equity : Retained', statement_group: 'equity', amount: -700 },
    ]);
    expect(bs.totals.assets).toBe(1000);
    expect(bs.totals.liabilities).toBe(300);
    expect(bs.totals.equity).toBe(700);
    expect(bs.outOfBalance).toBe(0);
  });

  test('an unbalanced sheet reports the gap', () => {
    const bs = buildBalanceSheet([
      { account_full_name: 'Assets : Cash', statement_group: 'asset', amount: 1000 },
      { account_full_name: 'Liabilities : AP', statement_group: 'liability', amount: -300 },
    ]);
    expect(bs.outOfBalance).toBe(700);
  });
});

describe('buildTrialBalance', () => {
  test('a complete ledger balances', () => {
    const tb = buildTrialBalance(ledger);
    expect(tb.totals.debit).toBe(1000);
    expect(tb.totals.credit).toBe(1000);
    expect(tb.isBalanced).toBe(true);
  });

  test('a short ledger does not', () => {
    const tb = buildTrialBalance(ledger.slice(0, 3));
    expect(tb.isBalanced).toBe(false);
    expect(tb.totals.difference).toBe(-450);
  });
});

describe('parseInvoiceTotals', () => {
  const rows = [
    { Date: '3/4/2025', Type: 'Invoice', 'Document Number': 'INV1', 'Internal ID': '101', Name: 'West Valley College', Subtotal: '1,000.00', 'Tax Total': '77.50', Amount: '1,077.50', Status: 'Paid' },
    { Date: '3/9/2025', Type: 'Credit Memo', 'Document Number': 'CM1', 'Internal ID': '102', Name: 'West Valley College', Subtotal: '200.00', 'Tax Total': '15.50', Amount: '215.50', Status: 'Open' },
  ];

  test('a credit memo is imported as a negative so it reduces revenue', () => {
    const { invoices } = parseInvoiceTotals(rows);
    expect(invoices[0].total).toBe(1077.5);
    expect(invoices[1].type).toBe('credit_memo');
    expect(invoices[1].total).toBe(-215.5);
    expect(invoices[1].subtotal).toBe(-200);
    expect(invoices[1].tax).toBe(-15.5);
  });

  test('the tax split is captured', () => {
    const { invoices } = parseInvoiceTotals(rows);
    expect(invoices[0].subtotal).toBe(1000);
    expect(invoices[0].tax).toBe(77.5);
    // The figure that matters for a sales-tax filing.
    expect(round2(invoices[0].total - invoices[0].subtotal)).toBe(invoices[0].tax);
  });

  test('an export without Subtotal/Tax warns instead of guessing', () => {
    const { invoices, warnings } = parseInvoiceTotals([
      { Date: '3/4/2025', Type: 'Invoice', 'Internal ID': '101', Amount: '1,077.50' },
    ]);
    expect(invoices[0].subtotal).toBeNull();
    expect(invoices[0].tax).toBeNull();
    expect(warnings.some((w) => /Subtotal/.test(w))).toBe(true);
    expect(warnings.some((w) => /Tax/.test(w))).toBe(true);
  });

  test('the internal id is the idempotency key', () => {
    const { invoices } = parseInvoiceTotals(rows);
    expect(invoices[0].id).toBe('101');
    expect(invoices[0].netsuite_internal_id).toBe('101');
  });
});

describe('parseBalances', () => {
  test('a trial balance export nets to zero', () => {
    const { balances, warnings } = parseBalances([
      { Account: '4000 Apparel Sales', Debit: '', Credit: '1,000.00' },
      { Account: '1000 Cash', Debit: '1,000.00', Credit: '' },
      { Account: 'Total', Debit: '1,000.00', Credit: '1,000.00' },
    ], { fiscalYear: 2025 });
    expect(balances).toHaveLength(2);       // the Total row is dropped
    expect(balances[0].amount).toBe(-1000);
    expect(warnings.some((w) => /out by/.test(w))).toBe(false);
  });

  test('an out-of-balance trial balance is flagged', () => {
    const { warnings } = parseBalances([
      { Account: '4000 Apparel Sales', Debit: '', Credit: '1,000.00' },
      { Account: '1000 Cash', Debit: '900.00', Credit: '' },
    ], { fiscalYear: 2025 });
    expect(warnings.some((w) => /out by -100.00/.test(w))).toBe(true);
  });
});

describe('reconcile', () => {
  test('derived and reported agreeing is a match', () => {
    const r = reconcile(
      [{ account_full_name: 'Income : Apparel Sales', amount: -1000 }],
      [{ account_full_name: 'Income : Apparel Sales', amount: -1000 }],
    );
    expect(r.matched).toBe(1);
    expect(r.totalDifference).toBe(0);
  });

  test('a shortfall in the GL detail surfaces as a difference', () => {
    // The failure this whole section exists to prevent: the P&L looks fine,
    // but the detail import was 100 short and the return would be wrong.
    const r = reconcile(
      [{ account_full_name: 'Income : Apparel Sales', amount: -900 }],
      [{ account_full_name: 'Income : Apparel Sales', amount: -1000 }],
    );
    expect(r.differing).toBe(1);
    expect(r.rows[0].difference).toBe(100);
    expect(r.rows[0].status).toBe('differs');
  });

  test('accounts on one side only are called out', () => {
    const r = reconcile(
      [{ account_full_name: 'Expense : Rent', amount: 150 }],
      [{ account_full_name: 'Expense : Utilities', amount: 75 }],
    );
    expect(r.rows.map((x) => x.status).sort()).toEqual(['missing_in_gl', 'missing_in_report']);
  });
});
