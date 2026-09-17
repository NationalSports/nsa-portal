const {
  parseMoney,
  parseRemittanceDate,
  parseStoreRow,
  isTuoRemittance,
  parseTuoRemittance,
  tuoStoreKey,
  matchForm,
  suggestCustomers,
  allocateFees,
} = require('../lib/tuoRemittance');

// Verbatim pdf.js output for the 09/15/2026 TUO Store Remittance Report
// (#126388, 11 stores, $5,241.20 remitted), captured by running the real PDF
// through the same row-grouping extractPdfText() uses. Two things in here are
// exactly what a hand-typed fixture would have missed:
//   * the summary box is TWO COLUMNS, so lines 28/30/31/32/33 each carry a
//     label/value pair from each side;
//   * the "Corporate" row has no tab after the type, unlike every Club/Spirit row.
const REPORT = [
  'Store Remittance Report',
  'Remittance/Invoice # 126388',
  'Date Created 09/15/2026 21:00 pm PDT',
  'Total Orders 26',
  'Item Quantity Total 180',
  'National sports apparel (1521087)',
  'Type\tStore Name\tBilled Qty\tFree Qty Total Assessed',
  'Amount\tAmount\tAmount',
  'Club\tLake SC 2026/27 - U10 Molina U10\t$275.00\t$0.00\t$275.00',
  'Club\tLake SC 2026/27 - U15 Boys Hughes U15\t$88.00\t$0.00\t$88.00',
  'Club\tLake SC 2026/27 - U14 Boys BU14 Herrera\t$58.00\t$0.00\t$58.00',
  'Club\tLake SC 2026/27 - U13 Boys Petty BU13\t$353.00\t$0.00\t$353.00',
  'Club\tSonoma County Premier 2026/27 - Garetto 12B\t$135.00\t$0.00\t$135.00',
  'Club\tLake SC 2026/27 - U07 Boys BU8/BU7 Anchando\t$781.00\t$0.00\t$781.00',
  'Spirit\tNativity School\t$486.00\t$0.00\t$486.00',
  'Spirit\tCoronado FC(588)\t$2,105.50\t$0.00\t$2,105.50',
  'Spirit\tGolden Eagles FC 2025/26\t$177.00\t$0.00\t$177.00',
  'Spirit\tVista HS Field Hockey 2026\t$178.00\t$0.00\t$178.00',
  'Corporate Lake SC Coaches 2026/27 - Coaches\t$205.00\t$0.00\t$205.00',
  'Fee Description\tRate\tAssessed Amount\tFee Amount',
  'Credit Card Fees\t2.90%\t$5,547.32\t$160.87',
  'Commission on Items\t3.00%\t$4,841.50\t$145.25',
  'Total Fees\t$306.12',
  'Items Ordered\t$4,841.50',
  'Fundraiser Tax\t$0.00',
  'Fundraisers\t$0.00',
  'Shipping\t$312.00',
  'Bulk Fee\t$0.00 Total Collected on TUO CC\t$5,547.32',
  'Merchant Account',
  'Handling\t$0.00 CC Fees\t$160.87',
  'Sales Tax\t$393.88 TUO Fees\t$145.25',
  'Store Discounts\t$0.00 Total Re-Closed Amount\t$0.00',
  'Total Billed Amount\t$0.00 Remittance Amount\t$5,241.20',
  'There is an end credit and TUO will remit $5,241.20 to close out these orders.',
].join('\n');

// The real customers these stores belong to, plus the two near-misses that make
// name matching dangerous: "The Church of The Nativity" and "Rancho Buena Vista
// High School Field Hockey" both look plausible and are both wrong.
const CUSTOMERS = [
  { id: 'c1789473629494', name: 'Lake SC ' },
  { id: 'c1786388662862', name: 'Lake SC Coaches' },
  { id: 'c-ns-4995', name: 'Lake SC Online' },
  { id: 'c1784570072490', name: 'Sonoma County Premier' },
  { id: 'c-ns-4131', name: 'The Nativity School' },
  { id: 'c-ns-5257', name: 'The Church of The Nativity' },
  { id: 'c-ns-3970', name: 'Coronado FC' },
  { id: 'c-ns-4082', name: 'Coronado High School' },
  { id: 'c-ns-4325', name: 'Golden Eagles FC' },
  { id: 'c-ns-5252', name: 'Vista High School Field Hockey' },
  { id: 'c-inv-rbv-field-hockey', name: 'Rancho Buena Vista High School Field Hockey' },
];

describe('TUO remittance parser', () => {
  test('reads the report header', () => {
    expect(parseTuoRemittance(REPORT)).toMatchObject({
      remittanceNo: '126388',
      remittanceKey: '126388',
      dateCreated: '2026-09-15',
      totalOrders: 26,
      itemQtyTotal: 180,
    });
  });

  test('reads the two-column summary box, each value from its own label', () => {
    expect(parseTuoRemittance(REPORT)).toMatchObject({
      itemsOrdered: 4841.50,
      shipping: 312.00,
      salesTax: 393.88,
      fundraiserTax: 0,
      fundraisers: 0,
      bulkFee: 0,
      handling: 0,
      storeDiscounts: 0,
      totalBilled: 0,
      totalCollected: 5547.32,
      ccFees: 160.87,
      tuoFees: 145.25,
      totalFees: 306.12,
      totalReClosed: 0,
      remittanceAmount: 5241.20,
    });
  });

  test('a merged summary line does not let a neighbouring column leak in', () => {
    // "Handling $0.00 CC Fees $160.87" must give handling 0 and cc fees 160.87,
    // not handling 160.87 (the old OMG bug, in a new document).
    const parsed = parseTuoRemittance(REPORT);
    expect(parsed.handling).toBe(0);
    expect(parsed.ccFees).toBe(160.87);
    expect(parsed.salesTax).toBe(393.88);
    expect(parsed.tuoFees).toBe(145.25);
    expect(parsed.totalBilled).toBe(0);
    expect(parsed.remittanceAmount).toBe(5241.20);
  });

  test('reads all 11 store rows and no fee, summary or header line', () => {
    const { lines } = parseTuoRemittance(REPORT);
    expect(lines).toHaveLength(11);
    expect(lines.map(l => l.storeType)).toEqual(
      ['Club', 'Club', 'Club', 'Club', 'Club', 'Club', 'Spirit', 'Spirit', 'Spirit', 'Spirit', 'Corporate']);
    lines.forEach(l => expect(l.problems).toEqual([]));
  });

  test('the Corporate row parses despite having no tab after its type', () => {
    const row = parseStoreRow('Corporate Lake SC Coaches 2026/27 - Coaches\t$205.00\t$0.00\t$205.00', 19);
    expect(row).toMatchObject({
      storeType: 'Corporate',
      storeName: 'Lake SC Coaches 2026/27 - Coaches',
      billed: 205, free: 0, assessed: 205, problems: [],
    });
  });

  test('accepts the report with no problems', () => {
    expect(parseTuoRemittance(REPORT).problems).toEqual([]);
  });

  test('store rows total Items Ordered', () => {
    const { lines, itemsOrdered } = parseTuoRemittance(REPORT);
    const sum = Math.round(lines.reduce((t, l) => t + l.assessed, 0) * 100) / 100;
    expect(sum).toBe(itemsOrdered);
    expect(sum).toBe(4841.50);
  });

  test('collected minus fees equals the remitted amount', () => {
    const { totalCollected, ccFees, tuoFees, remittanceAmount } = parseTuoRemittance(REPORT);
    expect(Math.round((totalCollected - ccFees - tuoFees) * 100) / 100).toBe(remittanceAmount);
  });

  test("TUO's own 6-cent component rounding is reported, not treated as an error", () => {
    const parsed = parseTuoRemittance(REPORT);
    // items 4841.50 + shipping 312.00 + tax 393.88 = 5547.38, six cents over
    // the 5547.32 they say they collected.
    expect(parsed.collectedDrift).toBe(0.06);
    expect(parsed.problems).toEqual([]);
  });

  test('a missed store row cannot hide — the Items Ordered check catches it', () => {
    const short = REPORT.split('\n').filter(l => !l.includes('Coronado FC(588)')).join('\n');
    const parsed = parseTuoRemittance(short);
    expect(parsed.lines).toHaveLength(10);
    expect(parsed.problems.some(p => /Store rows total 2736\.00 but Items Ordered says 4841\.50/.test(p))).toBe(true);
  });

  test('flags fees that do not add up to Total Fees', () => {
    const tampered = REPORT.replace('CC Fees\t$160.87', 'CC Fees\t$150.87');
    expect(parseTuoRemittance(tampered).problems.some(p => /Total Fees says/.test(p))).toBe(true);
  });

  test('flags a remittance amount that does not follow from collected minus fees', () => {
    const tampered = REPORT.replace('Remittance Amount\t$5,241.20', 'Remittance Amount\t$5,000.00');
    expect(parseTuoRemittance(tampered).problems.some(p => /Remittance Amount says/.test(p))).toBe(true);
  });

  test('flags a row whose billed + free does not equal assessed', () => {
    const row = parseStoreRow('Club\tBroken Row\t$100.00\t$5.00\t$100.00', 9);
    expect(row.problems).toEqual(['Billed + free does not equal assessed']);
  });

  test('reports an unfamiliar store type rather than dropping the row', () => {
    const row = parseStoreRow('Booster\tSome New Store\t$10.00\t$0.00\t$10.00', 9);
    expect(row.assessed).toBe(10);
    expect(row.problems[0]).toMatch(/Unrecognised store type "Booster"/);
  });

  test('rejects a file that is not a TUO remittance', () => {
    const parsed = parseTuoRemittance('Deposit Statement\nStores Included\t22');
    expect(parsed.problems).toContain('This file is not a TUO Store Remittance Report');
  });

  describe('store name to customer matching', () => {
    test('every store on the real report resolves to exactly one exact customer', () => {
      const { lines } = parseTuoRemittance(REPORT);
      const resolved = lines.map(l => {
        const top = suggestCustomers(l.storeName, CUSTOMERS, 3);
        return { store: l.storeName, exacts: top.filter(s => s.exact).map(s => s.customer.name) };
      });
      resolved.forEach(r => expect(r.exacts).toHaveLength(1));
      expect(resolved.map(r => r.exacts[0])).toEqual([
        'Lake SC ', 'Lake SC ', 'Lake SC ', 'Lake SC ', 'Sonoma County Premier', 'Lake SC ',
        'The Nativity School', 'Coronado FC', 'Golden Eagles FC',
        'Vista High School Field Hockey', 'Lake SC Coaches',
      ]);
    });

    test('"Nativity School" picks The Nativity School, not The Church of The Nativity', () => {
      const top = suggestCustomers('Nativity School', CUSTOMERS, 3);
      expect(top[0].customer.id).toBe('c-ns-4131');
      expect(top[0].exact).toBe(true);
    });

    test('"Vista HS Field Hockey 2026" does not pick Rancho Buena Vista', () => {
      const top = suggestCustomers('Vista HS Field Hockey 2026', CUSTOMERS, 3);
      expect(top[0].customer.id).toBe('c-ns-5252');
      expect(top[0].exact).toBe(true);
      expect(top.filter(s => s.exact)).toHaveLength(1);
    });

    test('a team suffix and season are stripped, but a different club is not merged', () => {
      expect(matchForm('Lake SC 2026/27 - U10 Molina U10')).toBe('LAKE SC');
      expect(matchForm('Lake SC Coaches 2026/27 - Coaches')).toBe('LAKE SC COACHES');
      expect(matchForm('Coronado FC(588)')).toBe('CORONADO FC');
      expect(matchForm('Vista HS Field Hockey 2026')).toBe('VISTA HIGH SCHOOL FIELD HOCKEY');
      expect(matchForm('The Nativity School')).toBe('NATIVITY SCHOOL');
    });

    test('an unknown store yields suggestions but no exact match', () => {
      const top = suggestCustomers('Some Brand New Club 2027', CUSTOMERS, 3);
      expect(top.filter(s => s.exact)).toHaveLength(0);
    });

    test('the map key keeps each team separate, so two teams can differ', () => {
      expect(tuoStoreKey('Lake SC 2026/27 - U10 Molina U10'))
        .not.toBe(tuoStoreKey('Lake SC 2026/27 - U15 Boys Hughes U15'));
      expect(tuoStoreKey('  Coronado FC(588) ')).toBe('CORONADO FC(588)');
    });
  });

  describe('pro-rata fee estimate', () => {
    test('shares total fees by each store’s share of the gross', () => {
      const { lines, totalFees } = parseTuoRemittance(REPORT);
      const allocated = allocateFees(lines, totalFees);
      const coronado = allocated.find(l => l.storeName === 'Coronado FC(588)');
      expect(coronado.share).toBeCloseTo(0.4349, 3);
      expect(coronado.estFees).toBeCloseTo(133.13, 2);
      expect(coronado.estNet).toBeCloseTo(1972.37, 2);
    });

    test('the estimate deliberately does NOT sum to the remitted amount', () => {
      // Shipping and sales tax are remitted but belong to no store row, so a
      // per-store split of fees alone cannot reconcile to the deposit. The UI
      // must never present these as the money received.
      const { lines, totalFees, itemsOrdered, remittanceAmount } = parseTuoRemittance(REPORT);
      const netTotal = Math.round(allocateFees(lines, totalFees)
        .reduce((t, l) => t + l.estNet, 0) * 100) / 100;
      expect(netTotal).toBeCloseTo(itemsOrdered - totalFees, 2);
      expect(netTotal).not.toBeCloseTo(remittanceAmount, 2);
    });
  });

  test('money and date helpers', () => {
    expect(parseMoney('$2,105.50')).toBe(2105.5);
    expect(parseMoney('($43.63)')).toBe(-43.63);
    expect(parseMoney('')).toBe(0);
    expect(parseRemittanceDate('09/15/2026 21:00 pm PDT')).toBe('2026-09-15');
    expect(parseRemittanceDate('9/5/26')).toBe('2026-09-05');
    expect(parseRemittanceDate('nope')).toBe('');
    expect(isTuoRemittance('… Store Remittance Report …')).toBe(true);
    expect(isTuoRemittance('Deposit Statement')).toBe(false);
  });
});
