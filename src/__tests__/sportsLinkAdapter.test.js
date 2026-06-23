// Unit tests for the Sports Inc SportsLink document → parsed-bill adapter (src/sportsLink.js).
//
// The adapter must emit the exact shape App.js's parseSingleInvoice() produces, so the
// existing match / review / AI-reconcile / push-to-Billed-tracking pipeline can consume
// API documents with no downstream changes. These lock in the field mapping, the
// EDI-vs-scanned distinction, and credit handling.
const { mapSportsLinkDocToBill, buildSportsLinkDocsQuery, _siDate } = require('../sportsLink');

const ediDoc = {
  poNumber: 'PO4133',
  siDocNumber: 987654,
  supplierDocNumber: 'INV-55012',
  siDocDate: '2026-03-15T13:46:11.369Z',
  supplierDocDate: '2026-03-14T00:00:00.000Z',
  dueDate: '2026-04-13T00:00:00.000Z',
  shipDate: '2026-03-13T00:00:00.000Z',
  supplier: 'adidas',
  trackingNumber: '1Z999AA10123456784',
  merchandiseTotal: 625,
  freightAmount: 25.5,
  freightAllowance: 0,
  siUpcharge: 3.1,
  svcHandleCharge: 1.9,
  docTotal: 656.5,
  isCredit: false,
  carrier: 'UPS',
  lines: [
    { supplierItemNumber: 'IU2788', upc: '193105', quantityShipped: 25, quantityOrdered: 25, netPrice: 12.5, extension: 312.5, size: 'M', color: 'BLACK', description: 'Ultraboost Cleat' },
    { supplierItemNumber: 'IU2788', upc: '193106', quantityShipped: 25, quantityOrdered: 25, netPrice: 12.5, extension: 312.5, size: 'L', color: 'BLACK', description: 'Ultraboost Cleat' },
  ],
};

describe('mapSportsLinkDocToBill', () => {
  test('maps header fields into the parsed-bill shape', () => {
    const b = mapSportsLinkDocToBill(ediDoc);
    expect(b.po_number).toBe('PO4133');
    expect(b.doc_number).toBe('INV-55012'); // dedup key = supplier invoice #
    expect(b.si_doc_number).toBe(987654);
    expect(b.supplier_doc_number).toBe('INV-55012');
    expect(b.supplier).toBe('adidas');
    expect(b.tracking).toBe('1Z999AA10123456784');
    expect(b.doc_date).toBe('03/14/2026'); // prefers supplierDocDate
    expect(b.merchandise_total).toBe(625);
    expect(b.freight).toBe(25.5);
    expect(b.si_upcharge).toBe(5); // siUpcharge + svcHandleCharge
    expect(b.doc_total).toBe(656.5);
    expect(b.kind).toBe('goods');
    expect(b.source).toBe('sportsinc');
    expect(b.has_lines).toBe(true);
    expect(b.has_usable_lines).toBe(true);
    expect(b.warnings).toHaveLength(0);
  });

  test('maps EDI line items to per-size bill items that sum to the merchandise total', () => {
    const b = mapSportsLinkDocToBill(ediDoc);
    expect(b.items).toHaveLength(2);
    expect(b.items[0]).toMatchObject({ sku: 'IU2788', size: 'M', qty: 25, unit_price: 12.5, extension: 312.5, color: 'BLACK' });
    const sum = b.items.reduce((a, it) => a + it.extension, 0);
    expect(Math.abs(sum - b.merchandise_total)).toBeLessThan(0.5);
  });

  test('flags a scanned/OCR document with no line detail', () => {
    const b = mapSportsLinkDocToBill({ ...ediDoc, lines: [] });
    expect(b.items).toHaveLength(0);
    expect(b.has_lines).toBe(false);
    expect(b.has_usable_lines).toBe(false);
    expect(b.warnings.join(' ')).toMatch(/line detail/i);
  });

  test('treats a "SEE VENDOR INVOICE FOR DETAIL" placeholder line as unusable (S&S OCR case)', () => {
    // Real shape of a scanned S&S Activewear document: one zero-qty placeholder line.
    const scanned = { ...ediDoc, supplier: 'S AND S ACTIVEWEAR', lines: [
      { supplierItemNumber: '', quantityShipped: 0, quantityOrdered: 0, netPrice: 0, extension: 0, description: 'SEE VENDOR INVOICE FOR DETAIL.' },
    ] };
    const b = mapSportsLinkDocToBill(scanned);
    expect(b.has_lines).toBe(true);          // a line array exists…
    expect(b.has_usable_lines).toBe(false);  // …but nothing usable for size-level billing
    expect(b.warnings.join(' ')).toMatch(/manual PDF parse/i);
  });

  test('flags a credit memo', () => {
    const b = mapSportsLinkDocToBill({ ...ediDoc, isCredit: true });
    expect(b.is_credit).toBe(true);
    expect(b.warnings.join(' ')).toMatch(/credit/i);
  });

  test('falls back to siDocNumber for the dedup key when there is no supplier invoice number', () => {
    const b = mapSportsLinkDocToBill({ ...ediDoc, supplierDocNumber: '' });
    expect(b.doc_number).toBe('987654');
  });

  test('derives extension from qty × net price when the line omits it', () => {
    const b = mapSportsLinkDocToBill({ ...ediDoc, lines: [{ supplierItemNumber: 'X', quantityShipped: 4, netPrice: 10, size: 'S' }] });
    expect(b.items[0].extension).toBe(40);
  });

  test('nets freight allowance out of the freight charge', () => {
    const b = mapSportsLinkDocToBill({ ...ediDoc, freightAmount: 30, freightAllowance: 5 });
    expect(b.freight).toBe(25);
  });

  test('tolerates a completely empty document without throwing', () => {
    const b = mapSportsLinkDocToBill({});
    expect(b.items).toHaveLength(0);
    expect(b.po_number).toBe('');
    expect(b.doc_number).toBe('');
    expect(b.merchandise_total).toBe(0);
  });
});

describe('_siDate', () => {
  test('formats an ISO date to MM/DD/YYYY without timezone drift', () => {
    expect(_siDate('2026-03-14T00:00:00.000Z')).toBe('03/14/2026');
    expect(_siDate('2026-12-01T13:46:11.369Z')).toBe('12/01/2026');
  });
  test('returns empty string for missing/invalid input', () => {
    expect(_siDate('')).toBe('');
    expect(_siDate(null)).toBe('');
  });
});

describe('buildSportsLinkDocsQuery', () => {
  test('includes lines=true by default and honors filters', () => {
    const q = buildSportsLinkDocsQuery({ active: true, poNumber: 'PO4133' });
    expect(q.get('active')).toBe('true');
    expect(q.get('lines')).toBe('true');
    expect(q.get('poNumber')).toBe('PO4133');
  });
  test('lines can be disabled', () => {
    const q = buildSportsLinkDocsQuery({ lines: false });
    expect(q.get('lines')).toBeNull();
  });
});
