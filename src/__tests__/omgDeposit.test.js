const {
  parseMoney,
  parseStatementDate,
  parseStoreRow,
  isOmgDepositStatement,
  parseOmgDepositStatement,
} = require('../lib/omgDeposit');

// Verbatim text of the 09/15/26 OMG Deposit Statement (22 stores, $14,927.85
// net), including the two net-refund rows and the two work-order-prefixed
// codes. Tabs stand in for the column gaps pdf.js emits; the parser has to
// tolerate both that and plain spaces.
const STATEMENT = [
  'National Sports Apparel LLC',
  '2238 North Glasell Avenue Suite E',
  'Orange, CA 92865',
  'US',
  'Deposit Statement',
  'VQFGYBTFP',
  'Statement Date\t09/15/26',
  'Deposit Status\tpending',
  'Bank Account\tFIRST FOUNDATION BANK – 7609',
  'Stores Included\t22',
  'Total Collected\t$16,125.81',
  'OMG Fee Withheld\t($659.38)',
  'Processing Fee Withheld\t($538.58)',
  'Net Amount\t$14,927.85',
  'Stores',
  'Work Order\tStore\tTotal Collected\tOMG Fee\tProcessing Fee\tNet Deposit',
  'GEX63 | Alemany HS Wresting August 2026\t$3,286.23\t($124.89)\t($112.98)\t$3,048.36',
  'D2SVU | Dana Hills Football 2026\t($59.91)\t$2.28\t$1.79\t($55.84)',
  'K3Q93 | Concordia University Baseball September 2026\t$1,097.49\t($41.71)\t($35.43)\t$1,020.35',
  'E7XS2 | San Luis Obispo Band 2026\t$1,703.28\t($64.74)\t($55.92)\t$1,582.62',
  'KB5259 VUG6Y | Amador Valley Cross Country 2026\t$1,148.15\t($43.63)\t($37.22)\t$1,067.30',
  'KB4504 Y6BTU | Springfield High School XC Fall 2026 -store 3\t$330.03\t($12.54)\t($10.77)\t$306.72',
  'MVJDY | Clovis High School Track & Field 2026\t$65.46\t($2.49)\t($2.20)\t$60.77',
  'W9Y2K | Orange Lutheran Girls Lacrosse Sept 2026\t$51.72\t($1.97)\t($1.80)\t$47.95',
  'PX33C | Seton Soccer 2026\t$1,643.64\t($62.46)\t($48.87)\t$1,532.31',
  'SE54Y | Evergreen Christian School Swag Store 2026\t$619.64\t($23.55)\t($20.95)\t$575.14',
  '3DNAF | North School Spirit Wear 2026\t$72.35\t($2.75)\t($2.40)\t$67.20',
  'CS5XD | Esperanza HS Wrestling September 2026\t$967.35\t($36.75)\t($33.65)\t$896.95',
  'EM637 | Clovis South High School and Sanchez Intermediate School 2026\t$1,571.34\t($59.71)\t($55.57)\t$1,456.06',
  'FNQY9 | Exeter Union High School Basketball Spirit Wear 2026\t$1,247.64\t($47.41)\t($43.88)\t$1,156.35',
  'HWS7S | Amador Valley High School Boosters Gold Store 2026 Store 3\t$401.17\t($61.79)\t($13.43)\t$325.95',
  'R2B25 | POLY ROYAL RODEO 2026\t($39.20)\t$1.49\t$1.17\t($36.54)',
  'RSYJ3 | Redbirds Baseball 2026\t($105.50)\t$4.01\t$3.25\t($98.24)',
  'KHTK8 | Seton Catholic High School Girls Soccer\t$601.91\t($22.88)\t($20.14)\t$558.89',
  'TFD5K | Mission Viejo Baseball September 2026\t$704.22\t($26.76)\t($22.53)\t$654.93',
  'FEATT | Biola University Athletics 2026\t$71.50\t($2.72)\t($2.37)\t$66.41',
  'QZXQF | Acacia Elementary Spirit Wear 2026\t$660.05\t($25.09)\t($21.55)\t$613.41',
  'KB5296 69CZD | Ida B Wells Cross Country 2026\t$87.25\t($3.32)\t($3.13)\t$80.80',
].join('\n');

// The same statement as pdf.js actually extracts it in the browser. The summary
// box is laid out in TWO COLUMNS, and pdf.js groups text by vertical position,
// so each line carries a label/value pair from each column. Reading "the last
// number on the line" gave Stores Included = 85, out of "$14,927.85" next to it,
// which blocked the import of a perfectly good statement.
const STATEMENT_TWO_COLUMN = [
  'National Sports Apparel LLC\tDeposit Statement',
  '2238 North Glasell Avenue Suite E',
  'Orange, CA 92865\tVQFGYBTFP',
  'US',
  'Statement Date\t09/15/26\tTotal Collected\t$16,125.81',
  'Deposit Status\tpending\tOMG Fee Withheld\t($659.38)',
  'Bank Account FIRST FOUNDATION BANK – 7609\tProcessing Fee Withheld\t($538.58)',
  'Stores Included\t22\tNet Amount\t$14,927.85',
  'Stores',
  'Work Order\tStore\tTotal Collected\tOMG Fee Processing Fee\tNet Deposit',
  'GEX63 | Alemany HS Wresting August 2026\t$3,286.23\t($124.89)\t($112.98)\t$3,048.36',
  'D2SVU | Dana Hills Football 2026\t($59.91)\t$2.28\t$1.79\t($55.84)',
  'KB5259 VUG6Y | Amador Valley Cross Country 2026\t$1,148.15\t($43.63)\t($37.22)\t$1,067.30',
].join('\n');

describe('OMG deposit statement parser', () => {
  test('reads the statement header', () => {
    const parsed = parseOmgDepositStatement(STATEMENT);
    expect(parsed).toMatchObject({
      statementNo: 'VQFGYBTFP',
      statementDate: '2026-09-15',
      statementKey: 'VQFGYBTFP',
      depositStatus: 'pending',
      bankAccount: 'FIRST FOUNDATION BANK – 7609',
      storesIncluded: 22,
      totalCollected: 16125.81,
      omgFee: -659.38,
      processingFee: -538.58,
      netAmount: 14927.85,
    });
  });

  test('reads every store row and nothing else', () => {
    const parsed = parseOmgDepositStatement(STATEMENT);
    expect(parsed.lines).toHaveLength(22);
    // The letterhead, the summary box, and the column-header row must not be
    // mistaken for stores.
    expect(parsed.lines.map(r => r.storeCode)).not.toContain('');
  });

  test('accepts the statement with no problems', () => {
    expect(parseOmgDepositStatement(STATEMENT).problems).toEqual([]);
  });

  test('row totals reconcile to the header totals', () => {
    const { lines, totalCollected, omgFee, processingFee, netAmount } = parseOmgDepositStatement(STATEMENT);
    const sum = key => Math.round(lines.reduce((t, r) => t + r[key], 0) * 100) / 100;
    expect(sum('collected')).toBe(totalCollected);
    expect(sum('omgFee')).toBe(omgFee);
    expect(sum('processingFee')).toBe(processingFee);
    expect(sum('netDeposit')).toBe(netAmount);
  });

  test('every row satisfies collected + fees = net deposit', () => {
    parseOmgDepositStatement(STATEMENT).lines.forEach(row => {
      const computed = Math.round((row.collected + row.omgFee + row.processingFee) * 100) / 100;
      expect(computed).toBeCloseTo(row.netDeposit, 2);
    });
  });

  test('a bare sale code becomes the store code', () => {
    const row = parseStoreRow('GEX63 | Alemany HS Wresting August 2026\t$3,286.23\t($124.89)\t($112.98)\t$3,048.36', 17);
    expect(row).toMatchObject({
      storeCode: 'GEX63',
      workOrder: '',
      storeName: 'Alemany HS Wresting August 2026',
      collected: 3286.23,
      omgFee: -124.89,
      processingFee: -112.98,
      netDeposit: 3048.36,
      problems: [],
    });
  });

  test('a work-order prefix is split off and the sale code kept', () => {
    const row = parseStoreRow('KB5259 VUG6Y | Amador Valley Cross Country 2026\t$1,148.15\t($43.63)\t($37.22)\t$1,067.30', 21);
    expect(row).toMatchObject({ storeCode: 'VUG6Y', workOrder: 'KB5259', netDeposit: 1067.3 });
  });

  test('a net-refund week keeps the printed signs', () => {
    const row = parseStoreRow('D2SVU | Dana Hills Football 2026\t($59.91)\t$2.28\t$1.79\t($55.84)', 18);
    expect(row).toMatchObject({ storeCode: 'D2SVU', collected: -59.91, omgFee: 2.28, processingFee: 1.79, netDeposit: -55.84 });
    expect(row.problems).toEqual([]);
  });

  test('numbers inside a store name are never read as money', () => {
    const row = parseStoreRow('HWS7S | Amador Valley High School Boosters Gold Store 2026 Store 3\t$401.17\t($61.79)\t($13.43)\t$325.95', 31);
    expect(row.storeName).toBe('Amador Valley High School Boosters Gold Store 2026 Store 3');
    expect(row.collected).toBe(401.17);
  });

  test('parses plain space-separated columns as well as tabs', () => {
    const row = parseStoreRow('TFD5K | Mission Viejo Baseball September 2026 $704.22 ($26.76) ($22.53) $654.93', 1);
    expect(row).toMatchObject({ storeCode: 'TFD5K', collected: 704.22, netDeposit: 654.93 });
  });

  test('flags a row whose columns do not add up', () => {
    const row = parseStoreRow('GEX63 | Broken Row 2026\t$100.00\t($5.00)\t($5.00)\t$95.00', 1);
    expect(row.problems).toEqual(['Collected + fees does not equal Net Deposit']);
  });

  test('flags a statement whose rows disagree with the header totals', () => {
    const tampered = STATEMENT.replace('$3,286.23\t($124.89)\t($112.98)\t$3,048.36', '$3,186.23\t($124.89)\t($112.98)\t$2,948.36');
    const parsed = parseOmgDepositStatement(tampered);
    expect(parsed.problems.some(p => /Total Collected: rows total/.test(p))).toBe(true);
    expect(parsed.problems.some(p => /Net Amount: rows total/.test(p))).toBe(true);
  });

  test('flags a statement missing a store row', () => {
    const short = STATEMENT.split('\n').filter(l => !l.startsWith('FEATT |')).join('\n');
    const parsed = parseOmgDepositStatement(short);
    expect(parsed.lines).toHaveLength(21);
    expect(parsed.problems).toContain('Statement says 22 stores but 21 rows were read');
  });

  test('rejects a file that is not a deposit statement', () => {
    const parsed = parseOmgDepositStatement('Accounting Report\nTotal Collected\t$500.00\nOMG Fees\t($20.00)');
    expect(parsed.problems).toContain('This file is not an OMG Deposit Statement');
    expect(parsed.lines).toEqual([]);
  });

  test('falls back to a date key when the statement number is missing', () => {
    const parsed = parseOmgDepositStatement(STATEMENT.replace('VQFGYBTFP\n', ''));
    expect(parsed.statementNo).toBe('');
    expect(parsed.statementKey).toBe('DATE-2026-09-15');
  });

  describe('the two-column summary box pdf.js actually produces', () => {
    test('each value is read from its own label, not its neighbour', () => {
      const parsed = parseOmgDepositStatement(STATEMENT_TWO_COLUMN);
      expect(parsed).toMatchObject({
        statementNo: 'VQFGYBTFP',
        statementDate: '2026-09-15',
        depositStatus: 'pending',
        bankAccount: 'FIRST FOUNDATION BANK – 7609',
        totalCollected: 16125.81,
        omgFee: -659.38,
        processingFee: -538.58,
        netAmount: 14927.85,
      });
    });

    test('Stores Included reads 22, not the 85 inside the $14,927.85 beside it', () => {
      expect(parseOmgDepositStatement(STATEMENT_TWO_COLUMN).storesIncluded).toBe(22);
    });

    test('the statement number is found in the right-hand cell of an address line', () => {
      expect(parseOmgDepositStatement(STATEMENT_TWO_COLUMN).statementKey).toBe('VQFGYBTFP');
    });

    test('the column-header row is not mistaken for a summary value', () => {
      // "Work Order  Store  Total Collected  OMG Fee Processing Fee  Net Deposit"
      // carries every label and no amount; it must not zero out the real totals.
      const parsed = parseOmgDepositStatement(STATEMENT_TWO_COLUMN);
      expect(parsed.totalCollected).toBe(16125.81);
      expect(parsed.processingFee).toBe(-538.58);
    });
  });

  test('money and date helpers', () => {
    expect(parseMoney('$1,148.15')).toBe(1148.15);
    expect(parseMoney('($43.63)')).toBe(-43.63);
    expect(parseMoney('')).toBe(0);
    expect(parseStatementDate('09/15/26')).toBe('2026-09-15');
    expect(parseStatementDate('9/5/2026')).toBe('2026-09-05');
    expect(parseStatementDate('2026-09-15')).toBe('2026-09-15');
    expect(parseStatementDate('nope')).toBe('');
    expect(isOmgDepositStatement('… Deposit Statement …')).toBe(true);
    expect(isOmgDepositStatement('Accounting Report')).toBe(false);
  });
});
