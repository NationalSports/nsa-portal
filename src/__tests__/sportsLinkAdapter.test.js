// Unit tests for the Sports Inc SportsLink document → parsed-bill adapter (src/sportsLink.js).
//
// The adapter must emit the exact shape App.js's parseSingleInvoice() produces, so the
// existing match / review / AI-reconcile / push-to-Billed-tracking pipeline can consume
// API documents with no downstream changes. These lock in the field mapping, the
// EDI-vs-scanned distinction, and credit handling.
const { mapSportsLinkDocToBill, buildSportsLinkDocsQuery, _siDate, siSupplierMethod,
  parseSiPoString, scoreSiPoMatch, rankSiPoCandidates, siPoOrigin } = require('../sportsLink');

const ediDoc = {
  poNumber: 'PO4133',
  siDocNumber: 987654,
  supplierDocNumber: 'INV-55012',
  siDocDate: '2026-03-15T13:46:11.369Z',
  supplierDocDate: '2026-03-14T00:00:00.000Z',
  dueDate: '2026-04-13T00:00:00.000Z',
  shipDate: '2026-03-13T00:00:00.000Z',
  supplier: 'ADIDAS US TEAM SERVICES',
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
    expect(b.supplier).toBe('ADIDAS US TEAM SERVICES');
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
    expect(b.supplier_method).toBe('EDI'); // adidas is on the EDI list
    expect(b.source_type).toBe('edi');     // and carries real lines → approve flow
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
    expect(b.supplier_method).toBe('OCR');   // S&S is an OCR supplier (for now)
    expect(b.source_type).toBe('scanned');   // → manual worklist
    expect(b.warnings.join(' ')).toMatch(/Sports Inc/i);
  });

  test('auto-promotes an OCR-listed supplier to the approve flow once it sends real lines (S&S flip)', () => {
    // When S&S flips to EDI it will start sending real line items. Routing follows the line
    // data, so it lands in the approve flow with no code change — supplier_method still reads
    // OCR until the list is updated, but source_type follows reality.
    const ssEdi = { ...ediDoc, supplier: 'S AND S ACTIVEWEAR', lines: [
      { supplierItemNumber: 'B00760', quantityShipped: 12, netPrice: 3.5, extension: 42, size: 'L', description: 'Gildan Tee' },
    ] };
    const b = mapSportsLinkDocToBill(ssEdi);
    expect(b.has_usable_lines).toBe(true);
    expect(b.supplier_method).toBe('OCR');
    expect(b.source_type).toBe('edi');
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

describe('siSupplierMethod', () => {
  test('classifies EDI suppliers regardless of punctuation/casing', () => {
    expect(siSupplierMethod('SANMAR')).toBe('EDI');
    expect(siSupplierMethod('Adidas Us Team Services')).toBe('EDI');
    expect(siSupplierMethod('Augusta Sportswear/Asi')).toBe('EDI');
    expect(siSupplierMethod('richardson cap co')).toBe('EDI');
  });
  test('treats everything else (and unknowns) as OCR', () => {
    expect(siSupplierMethod('S AND S ACTIVEWEAR')).toBe('OCR');
    expect(siSupplierMethod('UNDER ARMOUR')).toBe('OCR'); // not on the EDI list
    expect(siSupplierMethod('Some New Vendor LLC')).toBe('OCR');
    expect(siSupplierMethod('')).toBe('OCR');
  });
});

describe('parseSiPoString', () => {
  test('decodes core PO number + customer alpha tags from real bill PO strings', () => {
    expect(parseSiPoString('PO 3332 CIVB')).toMatchObject({ core: '3332', tags: ['CIVB'] });
    expect(parseSiPoString('DPO 3239 TLL')).toMatchObject({ core: '3239', tags: ['TLL'] });
    expect(parseSiPoString('NSA 4519')).toMatchObject({ core: '4519', tags: [] });
    expect(parseSiPoString('3177 OLUSPL')).toMatchObject({ core: '3177', tags: ['OLUSPL'] });
    expect(parseSiPoString('PO8602 CSFB REP')).toMatchObject({ core: '8602', tags: ['CSFB'] }); // REP is noise
  });
});

describe('siPoOrigin (space-after-PO rule)', () => {
  test('a space after PO/DPO means a portal PO', () => {
    expect(siPoOrigin('PO 3545 CIVB')).toBe('portal');
    expect(siPoOrigin('PO 3332')).toBe('portal');
    expect(siPoOrigin('DPO 3239 TLL')).toBe('portal');
  });
  test('no space after PO means the legacy/old system (→ Outside of Portal)', () => {
    expect(siPoOrigin('PO3454')).toBe('old');
    expect(siPoOrigin('PO8633TWELVEMM')).toBe('old');
    expect(siPoOrigin('PO8602 CSFB')).toBe('old'); // joined "PO8602" → old, even with later spaces
  });
  test('non-PO-prefixed strings are unknown (let the matcher decide)', () => {
    expect(siPoOrigin('NSA 4519')).toBe('unknown');
    expect(siPoOrigin('3177 OLUSPL')).toBe('unknown');
    expect(siPoOrigin('')).toBe('unknown');
  });
  test('the adapter surfaces po_origin on the mapped bill', () => {
    expect(mapSportsLinkDocToBill({ poNumber: 'PO 3332 CIVB', lines: [] }).po_origin).toBe('portal');
    expect(mapSportsLinkDocToBill({ poNumber: 'PO8633TWELVE', lines: [] }).po_origin).toBe('old');
  });
});

describe('scoreSiPoMatch / rankSiPoCandidates', () => {
  // "PO 3332 CIVB" from adidas → portal PO 3332 for Civica HS Basketball.
  const bill = { po_number: 'PO 3332 CIVB', supplier: 'ADIDAS US TEAM SERVICES', items: [{ sku: 'IU2788' }, { sku: 'KB9105' }] };
  const civica = { po_id: 'PO3332', po_core: '3332', vendor: 'ADIDAS US TEAM SERVICES', customer_alpha_tag: 'CIVB', skus: ['IU2788', 'KB9105'], so_id: 'SO-2001' };

  test('PO core + alpha tag + supplier + SKUs → high confidence', () => {
    const r = scoreSiPoMatch(bill, civica);
    expect(r.confidence).toBe('high');
    expect(r.method).toBe('po_core');
    expect(r.reasons.join(' ')).toMatch(/CIVB/);
  });

  test('bill is source of truth: customer + supplier + SKUs still match when the PO number is wrong', () => {
    // Salesperson fat-fingered the PO number, but the customer tag + supplier + lines line up.
    const wrongNumber = { ...civica, po_id: 'PO9999', po_core: '9999' };
    const r = scoreSiPoMatch(bill, wrongNumber);
    expect(r.score).toBeGreaterThanOrEqual(45); // alpha_tag(35)+supplier(15)+SKUs(20) = 70
    expect(['medium', 'high']).toContain(r.confidence);
    expect(r.method).toBe('alpha_tag');
  });

  test('ranks the right customer first among candidates', () => {
    const other = { po_id: 'PO3332B', po_core: '3332', vendor: 'SANMAR', customer_alpha_tag: 'CDB', skus: ['610534'], so_id: 'SO-2002' };
    const ranked = rankSiPoCandidates(bill, [other, civica]);
    expect(ranked[0].candidate.so_id).toBe('SO-2001');
  });

  test('no signal → no match', () => {
    const unrelated = { po_id: 'PO1', po_core: '1', vendor: 'SANMAR', customer_alpha_tag: 'XYZ', skus: ['ZZZ'] };
    expect(scoreSiPoMatch(bill, unrelated).confidence).toBe('none');
    expect(rankSiPoCandidates(bill, [unrelated])).toHaveLength(0);
  });
});
