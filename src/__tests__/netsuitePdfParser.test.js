import { parseNetSuitePdf, parseNetSuitePdfMulti } from '../lib/netsuitePdfParser';

// Build the tab-separated text extractPdfText produces from an NSA NetSuite SO PDF.
const soText = (itemBlocks) => [
  'National Sports Apparel LLC',
  'Sales Order',
  '#SO135636',
  '5/12/2026',
  'Bill To\tShip To',
  'Servite Baseball',
  'Quantity\tItem\tRate\tAmount',
  ...itemBlocks,
  'Subtotal\t$1,000.00',
  'Tax (7.75%)\t$77.50',
  'Total\t$1,077.50',
].join('\n');

describe('parseNetSuitePdf', () => {
  test('inseam-variant SKUs collapse into the base SKU (IS1111-S 7")', () => {
    const r = parseNetSuitePdf(soText([
      '15\tIS1111-S 7"\t$33.00\t$495.00',
      'Adidas M D4T W Short Black/White - S 7"',
      '40\tIS1111-M 7"\t$33.00\t$1,320.00',
      'Adidas M D4T W Short Black/White - M 7"',
      '10\tIS1111-XL7"\t$33.00\t$330.00',      // no space before the inseam token
      'Adidas M D4T W Short Black/White - XL7"',
    ]), 'so', []);
    expect(r.docNumber).toBe('SO135636');
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('IS1111');
    expect(items[0].sizes).toEqual({ S: 15, M: 40, XL: 10 });
    expect(items[0].quantity).toBe(65);
    expect(items[0].color).toBe('Black');
  });

  test('half shoe sizes in dash form parse as sizes (KJ3537-9-)', () => {
    const r = parseNetSuitePdf(soText([
      '8\tKJ3537-9\t$61.75\t$494.00',
      'Adidas Adizero Impact 3.0 BSB White/Navy/Navy - 9',
      '4\tKJ3537-9-\t$61.75\t$247.00',
      'Adidas Adizero Impact 3.0 BSB White/Navy/Navy - 9-',
      '12\tKJ3537-10-\t$61.75\t$741.00',
      'Adidas Adizero Impact 3.0 BSB White/Navy/Navy - 10-',
    ]), 'so', []);
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('KJ3537');
    expect(items[0].sizes).toEqual({ '9': 8, '9-': 4, '10-': 12 });
  });

  test('tall sizes parse (JX4452-LT / -XLT)', () => {
    const r = parseNetSuitePdf(soText([
      '36\tJX4452-L\t$18.00\t$648.00',
      'Adidas SS Pregame A - Black,White - L',
      '3\tJX4452-LT\t$18.00\t$54.00',
      'Adidas SS Pregame A - Black,White - LT',
      '3\tJX4452-XLT\t$18.00\t$54.00',
      'Adidas SS Pregame A - Black,White - XLT',
    ]), 'so', []);
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('JX4452');
    expect(items[0].sizes).toEqual({ L: 36, LT: 3, XLT: 3 });
  });

  test('embedded size runs normalize XXL/XXXL to 2XL/3XL', () => {
    const r = parseNetSuitePdf(soText([
      '70\tMisc\t$18.00\t$1,260.00',
      '5163778 Modern Stretch Fit - Black Size - 8/S, 30/M, 26/L, 6/XXL',
    ]), 'so', []);
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items).toHaveLength(1);
    expect(items[0].sizes).toEqual({ S: 8, M: 30, L: 26, '2XL': 6 });
  });

  test('existing behavior intact: colon SKU, decoration + shipping lines, totals', () => {
    const r = parseNetSuitePdf(soText([
      '12\tJP4674 : JP4674-S\t$20.00\t$240.00',
      'Adidas Creator Tee - Black - S',
      '12\tScreen 1\t$2.25\t$27.00',
      'Screen Print 1 Color',
      '1\tShipping\t$600.00\t$600.00',
      'Shipping - Estimate',
    ]), 'so', []);
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('JP4674');
    expect(items[0].sizes).toEqual({ S: 12 });
    expect(items[0].color).toBe('Black');
    const decos = r.lineItems.filter(i => i.isDecoration);
    expect(decos).toHaveLength(1);
    expect(decos[0].decoType).toBe('screen_print');
    expect(r.shipping).toBe(600);
    expect(r.subtotal).toBe(1000);
    expect(r.tax).toBe(77.5);
    expect(r.total).toBe(1077.5);
    expect(r.confidence).toBe('high');
  });

  test('waist sizes still parse and do not get eaten by the dash rule', () => {
    const r = parseNetSuitePdf(soText([
      '5\tJZ4600-38\t$40.00\t$200.00',
      'Adidas Knicker – White – 38',
    ]), 'so', []);
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items[0].sku).toBe('JZ4600');
    expect(items[0].sizes).toEqual({ '38': 5 });
  });
});

describe('parseNetSuitePdf — negative-quantity return lines and signed totals (2026-07-18 fix)', () => {
  test('a negative-quantity return line is captured as its own line item (qty -2, negative amount), not swallowed into the prior item description', () => {
    const r = parseNetSuitePdf(soText([
      '12\tJP4674 : JP4674-S\t$20.00\t$240.00',
      'Adidas Creator Tee - Black - S',
      '-2\tKJ3537-9\t$61.75\t-$123.50',
      'Adidas Adizero Impact 3.0 BSB White/Navy/Navy - 9',
    ]), 'so', []);
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items).toHaveLength(2);

    const original = items.find(i => i.sku === 'JP4674');
    expect(original).toBeTruthy();
    expect(original.sizes).toEqual({ S: 12 }); // untouched by the return line
    expect(original.description).not.toMatch(/KJ3537|Adizero/); // not swallowed into this item's description

    const ret = items.find(i => i.sku === 'KJ3537');
    expect(ret).toBeTruthy();
    expect(ret.quantity).toBe(-2);
    expect(ret.sizes).toEqual({ '9': -2 });
    expect(ret.amount).toBeCloseTo(-123.5);
  });

  test('Subtotal/Total lines keep their sign whether parenthesized or minus-prefixed', () => {
    const text = [
      'National Sports Apparel LLC',
      'Sales Order',
      '#SO135636',
      '5/12/2026',
      'Bill To\tShip To',
      'Servite Baseball',
      'Quantity\tItem\tRate\tAmount',
      '-2\tJP4674 : JP4674-S\t$20.00\t-$40.00',
      'Adidas Creator Tee - Black - S',
      'Subtotal\t($40.00)',
      'Total\t-$40.00',
    ].join('\n');
    const r = parseNetSuitePdf(text, 'so', []);
    expect(r.subtotal).toBe(-40);
    expect(r.total).toBe(-40);
  });

  test('a normal positive doc still parses identically (no sign regression)', () => {
    const r = parseNetSuitePdf(soText([
      '12\tJP4674 : JP4674-S\t$20.00\t$240.00',
      'Adidas Creator Tee - Black - S',
    ]), 'so', []);
    const items = r.lineItems.filter(i => !i.isDecoration);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(12);
    expect(items[0].amount).toBe(240);
    expect(r.subtotal).toBe(1000);
    expect(r.total).toBe(1077.5);
  });
});

describe('parseNetSuitePdfMulti', () => {
  test('splits pages by document number', () => {
    const p1 = soText(['12\tJP4674-S\t$20.00\t$240.00', 'Adidas Creator Tee - Black - S']);
    const p2 = p1.replace(/#SO135636/g, '#SO135637').replace('Servite Baseball', 'Biola Baseball');
    const docs = parseNetSuitePdfMulti([p1, p2], 'so', []);
    expect(docs).toHaveLength(2);
    expect(docs[0].docNumber).toBe('SO135636');
    expect(docs[1].docNumber).toBe('SO135637');
  });
});
