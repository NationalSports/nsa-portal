// OMG **Deposit Statement** parser.
//
// Every Tuesday OMG publishes one statement covering the money that lands in our
// bank on Wednesday. It is a company-level document: one header (the bank
// deposit) and one row per store that contributed to it.
//
//   Deposit Statement  VQFGYBTFP
//   Statement Date 09/15/26            Stores Included 22
//   Total Collected $16,125.81         OMG Fee Withheld ($659.38)
//   Processing Fee Withheld ($538.58)  Net Amount $14,927.85
//
//   Work Order  Store                                Total Collected  OMG Fee  Processing Fee  Net Deposit
//   GEX63 | Alemany HS Wresting August 2026               $3,286.23  ($124.89)      ($112.98)    $3,048.36
//   KB5259 VUG6Y | Amador Valley Cross Country 2026       $1,148.15   ($43.63)       ($37.22)    $1,067.30
//   D2SVU | Dana Hills Football 2026                       ($59.91)     $2.28          $1.79       ($55.84)
//
// SIGNS ARE KEPT EXACTLY AS PRINTED. Fees are negative when withheld and
// positive when refunded back on a net-refund week, so for every row
// `net_deposit = collected + omg_fee + processing_fee` holds with no sign
// juggling, and an imported row can be diffed against the paper statement
// column for column. (This is deliberately NOT the abs()-to-positive-expense
// convention used by lib/omgMonthlyProfit.js, which reads a different report.)
//
// The "Work Order" cell is either a bare OMG sale code (`GEX63`) or a work
// order number followed by the sale code (`KB5259 VUG6Y`). The sale code is
// always the last token, and it is what matches `omg_stores._omg_sale_code`.

// Money always carries a "$" on this statement, which is what lets us read
// amounts off a line without a store name's year ("2026") or store number
// ("Store 3") being mistaken for a column value. Parentheses mean negative.
const MONEY_TOKEN = /\(\s*\$\s?-?[\d,]+\.\d{2}\s*\)|\$\s?-?[\d,]+\.\d{2}/g;

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;

const parseMoney = token => {
  const raw = String(token == null ? '' : token);
  const negative = raw.trim().startsWith('(');
  const digits = raw.replace(/[($),\s]/g, '');
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return 0;
  return roundMoney(negative ? -Math.abs(parsed) : parsed);
};

const moneyOn = line => (String(line || '').match(MONEY_TOKEN) || []).map(parseMoney);

const cleanLine = line => String(line == null ? '' : line).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();

const pad2 = value => String(value).padStart(2, '0');

// "09/15/26" / "9/15/2026" / "2026-09-15" -> "2026-09-15". OMG prints US order.
const parseStatementDate = raw => {
  const text = String(raw || '');
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;
  const us = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!us) return '';
  let year = Number(us[3]);
  if (year < 100) year += 2000;
  return `${year}-${pad2(Number(us[1]))}-${pad2(Number(us[2]))}`;
};

// A labelled summary value. The store table's column-header row repeats these
// words ("Total Collected  OMG Fee  Processing Fee"), so only lines that
// actually carry a dollar amount can answer, and the value is the last column.
const labelledAmount = (lines, labelRe) => {
  for (const line of lines) {
    const flat = cleanLine(line);
    if (!labelRe.test(flat)) continue;
    const amounts = moneyOn(flat);
    if (amounts.length) return amounts[amounts.length - 1];
  }
  return 0;
};

const labelledText = (lines, labelRe) => {
  for (const line of lines) {
    const flat = cleanLine(line);
    const match = flat.match(labelRe);
    if (!match) continue;
    const rest = flat.slice(match.index + match[0].length).trim();
    if (rest) return rest;
  }
  return '';
};

const labelledInt = (lines, labelRe) => {
  for (const line of lines) {
    const flat = cleanLine(line);
    if (!labelRe.test(flat)) continue;
    const nums = flat.match(/\b\d+\b/g);
    if (nums && nums.length) return Number(nums[nums.length - 1]);
  }
  return 0;
};

// The statement number sits on its own between the letterhead and "Statement
// Date" — an all-caps alphanumeric token with no spaces. Treated as optional:
// if OMG ever drops it, the statement date still keys the import.
const parseStatementNo = lines => {
  for (const line of lines.slice(0, 30)) {
    const flat = cleanLine(line);
    if (/^statement\s*date/i.test(flat)) break;
    const match = flat.match(/^(?:deposit\s*statement\s*)?([A-Z0-9]{6,16})$/);
    if (match && /[A-Z]/.test(match[1])) return match[1];
  }
  return '';
};

const isOmgDepositStatement = text => /deposit\s*statement/i.test(String(text || ''));

// One store row. `|` separates the work-order cell from the store name, and the
// last four dollar amounts are the four money columns.
const parseStoreRow = (line, lineNo) => {
  const flat = cleanLine(line);
  if (!flat.includes('|')) return null;
  const amounts = moneyOn(flat);
  if (amounts.length < 4) return null;
  const [collected, omgFee, processingFee, netDeposit] = amounts.slice(-4);

  const pipeAt = flat.indexOf('|');
  const workOrderCell = flat.slice(0, pipeAt).trim();
  // Name runs from the pipe to wherever the money columns start.
  const afterPipe = flat.slice(pipeAt + 1);
  const firstMoneyAt = afterPipe.search(MONEY_TOKEN);
  const storeName = (firstMoneyAt >= 0 ? afterPipe.slice(0, firstMoneyAt) : afterPipe).trim();

  const codeTokens = workOrderCell.split(/\s+/).filter(Boolean);
  const storeCode = (codeTokens[codeTokens.length - 1] || '').toUpperCase();
  const workOrder = codeTokens.slice(0, -1).join(' ');

  const problems = [];
  if (!storeCode) problems.push('Row has no OMG store code');
  if (Math.abs(roundMoney(collected + omgFee + processingFee) - netDeposit) > 0.01) {
    problems.push('Collected + fees does not equal Net Deposit');
  }

  return { lineNo, storeCode, workOrder, storeName, collected, omgFee, processingFee, netDeposit, problems };
};

// Parse a whole statement. Returns the header, every store row, and a list of
// problems. The caller must refuse to import while `problems` is non-empty:
// this writes money, and a statement we only half-understood is worse than one
// the user re-exports.
const parseOmgDepositStatement = text => {
  const allLines = String(text || '').split('\n');
  const problems = [];

  if (!isOmgDepositStatement(text)) {
    problems.push('This file is not an OMG Deposit Statement');
  }

  const statementNo = parseStatementNo(allLines);
  const statementDate = parseStatementDate(labelledText(allLines, /statement\s*date\b[:\s]*/i));
  const depositStatus = labelledText(allLines, /deposit\s*status\b[:\s]*/i).toLowerCase();
  const bankAccount = labelledText(allLines, /bank\s*account\b[:\s]*/i);
  const storesIncluded = labelledInt(allLines, /stores\s*included\b/i);
  const totalCollected = labelledAmount(allLines, /total\s*collected/i);
  const omgFee = labelledAmount(allLines, /omg\s*fee/i);
  const processingFee = labelledAmount(allLines, /processing\s*fee/i);
  const netAmount = labelledAmount(allLines, /net\s*amount/i);

  const lines = [];
  allLines.forEach((line, index) => {
    const row = parseStoreRow(line, index + 1);
    if (row) lines.push(row);
  });

  if (!statementDate) problems.push('Could not read the Statement Date');
  if (!lines.length) problems.push('No store rows were found');

  // Three independent cross-checks against the statement's own header. Any one
  // of them failing means the parse disagrees with OMG's arithmetic, so the
  // rows must not be trusted to move money onto stores.
  if (lines.length && storesIncluded && storesIncluded !== lines.length) {
    problems.push(`Statement says ${storesIncluded} stores but ${lines.length} rows were read`);
  }
  const sum = key => roundMoney(lines.reduce((total, row) => total + row[key], 0));
  const checkTotal = (label, rowTotal, headerTotal) => {
    if (!lines.length) return;
    if (Math.abs(rowTotal - headerTotal) > 0.01) {
      problems.push(`${label}: rows total ${rowTotal.toFixed(2)} but the statement says ${headerTotal.toFixed(2)}`);
    }
  };
  checkTotal('Total Collected', sum('collected'), totalCollected);
  checkTotal('OMG Fee', sum('omgFee'), omgFee);
  checkTotal('Processing Fee', sum('processingFee'), processingFee);
  checkTotal('Net Amount', sum('netDeposit'), netAmount);

  const rowProblems = lines.filter(row => row.problems.length);
  rowProblems.forEach(row => {
    problems.push(`${row.storeCode || `Row ${row.lineNo}`}: ${row.problems.join('; ')}`);
  });

  return {
    statementNo,
    statementDate,
    // Natural key for idempotent re-import. OMG's own statement number when it
    // is printed; otherwise the date, which is unique in practice (one weekly
    // deposit) and still stops the same file being imported twice.
    statementKey: statementNo || (statementDate ? `DATE-${statementDate}` : ''),
    depositStatus,
    bankAccount,
    storesIncluded: storesIncluded || lines.length,
    totalCollected,
    omgFee,
    processingFee,
    netAmount,
    lines,
    problems,
  };
};

export {
  MONEY_TOKEN,
  parseMoney,
  parseStatementDate,
  parseStatementNo,
  parseStoreRow,
  isOmgDepositStatement,
  parseOmgDepositStatement,
  roundMoney,
};
