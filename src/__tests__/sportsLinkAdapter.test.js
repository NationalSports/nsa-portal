// Unit tests for the Sports Inc SportsLink document → parsed-bill adapter (src/sportsLink.js).
//
// The adapter must emit the exact shape App.js's parseSingleInvoice() produces, so the
// existing match / review / AI-reconcile / push-to-Billed-tracking pipeline can consume
// API documents with no downstream changes. These lock in the field mapping, the
// EDI-vs-scanned distinction, and credit handling.
const { mapSportsLinkDocToBill, buildSportsLinkDocsQuery, _siDate, siSupplierMethod,
  parseSiPoString, scoreSiPoMatch, rankSiPoCandidates, siPoOrigin, _siNum } = require('../sportsLink');

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

describe('_siNum', () => {
  test('parses formatted currency strings, tolerating parens and minus for negatives', () => {
    expect(_siNum('$1,234.56')).toBe(1234.56);
    expect(_siNum('(100.50)')).toBe(-100.5);
    expect(_siNum('-100.50')).toBe(-100.5);
  });
  test('leaves plain numbers and numeric strings unchanged', () => {
    expect(_siNum(42)).toBe(42);
    expect(_siNum('42')).toBe(42);
    expect(_siNum('42.5')).toBe(42.5);
  });
  test('garbage input returns 0', () => {
    expect(_siNum('garbage')).toBe(0);
    expect(_siNum(null)).toBe(0);
    expect(_siNum(undefined)).toBe(0);
    expect(_siNum('')).toBe(0);
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

  // CHARACTERIZATION — pins current behavior, not a spec. A 2-char customer alpha tag plus a
  // supplier-name match, with the wrong po_core and zero SKU overlap, still reaches score 50 /
  // 'medium'. Flag for review: this is enough for the matcher to attach a bill to the wrong
  // Sales Order if two customers happen to share (or collide on) a short alpha tag with the
  // same supplier — there is no corroborating PO number or line-item evidence at all here.
  test('CHARACTERIZATION: alpha tag + supplier alone (wrong po_core, no SKU overlap) reaches medium confidence', () => {
    const wrongCoreBill = { po_number: 'PO 9999 AB', supplier: 'SANMAR', items: [{ sku: 'ZZZZ' }] };
    const candidate = { po_id: 'PO1111', po_core: '1111', vendor: 'SANMAR', customer_alpha_tag: 'AB', skus: ['QQQQ'] };
    const r = scoreSiPoMatch(wrongCoreBill, candidate);
    expect(r.score).toBe(50); // alpha_tag(35) + supplier(15), no po_core hit, no SKU hit
    expect(r.confidence).toBe('medium');
    expect(r.method).toBe('alpha_tag');
  });
});

// CHARACTERIZATION — pins current behavior, not a spec.
describe('mapSportsLinkDocToBill isCredit (characterization)', () => {
  test('is_credit is set but item qty/extension and merchandise_total stay positive — downstream must sign-flip', () => {
    const b = mapSportsLinkDocToBill({ ...ediDoc, isCredit: true });
    expect(b.is_credit).toBe(true);
    expect(b.items[0].qty).toBeGreaterThan(0);
    expect(b.items[0].extension).toBeGreaterThan(0);
    expect(b.merchandise_total).toBeGreaterThan(0);
  });
});

// CHARACTERIZATION — pins current behavior, not a spec.
describe('parseSiPoString stopword collision (characterization)', () => {
  test('a customer alpha tag colliding with the "SO" stopword never contributes to matching', () => {
    // 'SO' is in _SI_PO_STOPWORDS (treated as PO-noise), so a customer whose real alpha tag is
    // "SO" is silently dropped here — it will never be picked up as a matching tag.
    const r = parseSiPoString('PO 4519 SO');
    expect(r.core).toBe('4519');
    expect(r.tags).toEqual([]);
  });
});

// ── Document-level dealer discount (Agron 25% off list; owner report 2026-07-22) ──
const { siDiscountFactor } = require('../sportsLink');
describe('document-level dealer discount', () => {
  test('siDiscountFactor derives the factor from gross line total vs net merch total', () => {
    expect(siDiscountFactor(260, 195)).toBe(0.75);   // the real Agron bill
    expect(siDiscountFactor(100, 100)).toBe(1);        // no discount
    expect(siDiscountFactor(100, 0)).toBe(1);          // missing merch total → leave as-is
    expect(siDiscountFactor(0, 195)).toBe(1);          // no gross → leave as-is
    expect(siDiscountFactor(100, 30)).toBe(1);         // >50% off is out of the sane band → don't apply, flag for review
    expect(siDiscountFactor(100, 101)).toBe(1);        // net above gross (credit/data quirk) → leave as-is
  });
  test('the real Agron bill: line unit_price becomes our NET cost, list preserved', () => {
    const bill = mapSportsLinkDocToBill({
      poNumber: 'PO 16950 LPUMS', siDocNumber: 24632739, supplierDocNumber: '100984970',
      supplier: 'AGRON INC.', merchandiseTotal: 195, docTotal: 211.79, freightAmount: 15.11, svcHandleCharge: 1.68,
      lines: [{ supplierItemNumber: '5159406', description: 'STADIUM 4 BACKPACK', quantityShipped: 8, netPrice: 32.5, listPrice: 32.5, extension: 260 }],
    });
    expect(bill._doc_discount_pct).toBe(25);
    expect(bill.items[0].unit_price).toBeCloseTo(24.38, 2); // 32.50 × 0.75, matches our order cost
    expect(bill.items[0].extension).toBeCloseTo(195, 2);
    expect(bill.items[0]._list_unit).toBe(32.5);            // audit trail kept
    expect(bill.merchandise_total).toBe(195);               // already net, unchanged
  });
  test('a normal (undiscounted) bill is untouched — no _list_unit, factor 1', () => {
    const bill = mapSportsLinkDocToBill({
      poNumber: 'PO 3000 ABC', supplier: 'SANMAR', merchandiseTotal: 100,
      lines: [{ supplierItemNumber: 'X', quantityShipped: 4, netPrice: 25, extension: 100 }],
    });
    expect(bill._doc_discount_pct).toBe(0);
    expect(bill.items[0].unit_price).toBe(25);
    expect(bill.items[0]._list_unit).toBeUndefined();
  });
});

// ── applySiDocumentDiscount / siExpectedUpcharge / earlyPayFreightWaiver (owner 2026-07-22:
// close the remaining manual touches — discounts on the PDF path, the 0.8% SI fee,
// the rare Rawlings/TCK early-pay freight waiver) ──
const { applySiDocumentDiscount, siExpectedUpcharge, earlyPayFreightWaiver } = require('../sportsLink');

describe('applySiDocumentDiscount (shared EDI + PDF discount rewrite)', () => {
  test('the real Agron shape: list lines + net merch total → net line costs, list kept', () => {
    const items = [{ unit_price: 32.5, extension: 260 }];
    const { discFactor, docDiscountPct } = applySiDocumentDiscount(items, 195);
    expect(discFactor).toBe(0.75);
    expect(docDiscountPct).toBe(25);
    expect(items[0].unit_price).toBeCloseTo(24.38, 2);
    expect(items[0]._list_unit).toBe(32.5);
  });
  test('no discount → items untouched, factor 1', () => {
    const items = [{ unit_price: 25, extension: 100 }];
    const { discFactor, docDiscountPct } = applySiDocumentDiscount(items, 100);
    expect(discFactor).toBe(1);
    expect(docDiscountPct).toBe(0);
    expect(items[0].unit_price).toBe(25);
    expect(items[0]._list_unit).toBeUndefined();
  });
  test('A4-style 5% document discount', () => {
    const items = [{ unit_price: 10, extension: 100 }];
    const { docDiscountPct } = applySiDocumentDiscount(items, 95);
    expect(docDiscountPct).toBe(5);
    expect(items[0].unit_price).toBeCloseTo(9.5, 2);
  });
});

describe('poCoreTagMatch (widen auto-push to sloppy-but-certain POs, owner 2026-07-23)', () => {
  const { poCoreTagMatch } = require('../sportsLink');
  it('accepts punctuation, missing prefix, extra tokens — same core + shared tag', () => {
    expect(poCoreTagMatch('PO.3182.LAF', 'PO 3182 LAF')).toBe(true);   // dots vs spaces
    expect(poCoreTagMatch('3094 CLHSSP', 'PO 3094 CLHSSP')).toBe(true); // missing PO prefix
    expect(poCoreTagMatch('3126 GC 3119 SE', 'PO 3126 GC')).toBe(true); // extra tokens, shared tag GC
    expect(poCoreTagMatch('PO 8002 FPUS', 'PO 8002 FPUS')).toBe(true);  // already exact
  });
  it('rejects a different core, a different customer, or a tag-less PO', () => {
    expect(poCoreTagMatch('PO 3182 LAF', 'PO 3183 LAF')).toBe(false);   // different PO number
    expect(poCoreTagMatch('PO 3094 CLHSSP', 'PO 3094 OTHER')).toBe(false); // same core, different customer
    expect(poCoreTagMatch('PO 3323 REP', 'PO 3323 AHSCS')).toBe(false); // REP is a stopword → no shared tag
    expect(poCoreTagMatch('3323', 'PO 3323 AHSCS')).toBe(false);        // no tag on the bill side
    expect(poCoreTagMatch('', 'PO 3182 LAF')).toBe(false);
  });
});

describe('looksNetsuiteDocRef (auto-route clearly-NetSuite refs to Outside, owner 2026-07-23)', () => {
  const { looksNetsuiteDocRef } = require('../sportsLink');
  it('flags SO-refs and long pure-numeric invoice ids', () => {
    expect(looksNetsuiteDocRef('SO135806')).toBe(true);
    expect(looksNetsuiteDocRef('SO 1255')).toBe(true);
    expect(looksNetsuiteDocRef('302682488263')).toBe(true);
    expect(looksNetsuiteDocRef('185946680')).toBe(true);
    expect(looksNetsuiteDocRef('05162026')).toBe(true);
  });
  it('never flags a portal PO, an NSA order, or a store-name PO', () => {
    expect(looksNetsuiteDocRef('PO 3182 LAF')).toBe(false);
    expect(looksNetsuiteDocRef('NSA 19251 CREW')).toBe(false); // real portal NSA order
    expect(looksNetsuiteDocRef('NSA4553')).toBe(false);         // ambiguous — left in review, not hidden
    expect(looksNetsuiteDocRef('SILICONVALLEY')).toBe(false);   // store name
    expect(looksNetsuiteDocRef('3094 CLHSSP')).toBe(false);     // spaced core+tag (portal shape)
    expect(looksNetsuiteDocRef('8464Q3019JH')).toBe(false);     // has letters
    expect(looksNetsuiteDocRef('')).toBe(false);
  });
});

describe('siExpectedUpcharge (0.8% of pre-discount subtotal, fill-when-missing)', () => {
  test('0.8% of gross, rounded to cents', () => {
    expect(siExpectedUpcharge(100)).toBe(0.8);
    expect(siExpectedUpcharge(260)).toBe(2.08);   // Agron gross (not the 195 net)
    expect(siExpectedUpcharge(1234.56)).toBe(9.88);
  });
  test('no basis → 0 (caller flags instead of computing)', () => {
    expect(siExpectedUpcharge(0)).toBe(0);
    expect(siExpectedUpcharge(-5)).toBe(0);
    expect(siExpectedUpcharge(null)).toBe(0);
  });
});

describe('earlyPayFreightWaiver (Rawlings/TCK early-pay detection — flag, never decide)', () => {
  const rawlingsBill = (over = {}) => ({
    supplier: 'RAWLINGS SPORTING GOODS CO INC', freight: 15.5,
    rawText: 'TERMS NET 30\nDISCOUNT DATE 08/15/2026 FREIGHT ALLOWED IF PAID', ...over,
  });
  test('Rawlings with freight and a discount-date signal → eligible with the date', () => {
    const w = earlyPayFreightWaiver(rawlingsBill());
    expect(w.eligible).toBe(true);
    expect(w.payByDate).toBe('08/15/2026');
    expect(w.freightAmount).toBe(15.5);
  });
  test('TCK matches; other vendors never do', () => {
    expect(earlyPayFreightWaiver(rawlingsBill({ supplier: 'TWIN CITY KNITTING CO' })).eligible).toBe(true);
    expect(earlyPayFreightWaiver(rawlingsBill({ supplier: 'AGRON INC.' })).eligible).toBe(false);
    expect(earlyPayFreightWaiver(rawlingsBill({ supplier: 'SANMAR' })).eligible).toBe(false);
  });
  test('no freight, or no early-pay signal → not eligible', () => {
    expect(earlyPayFreightWaiver(rawlingsBill({ freight: 0 })).eligible).toBe(false);
    expect(earlyPayFreightWaiver(rawlingsBill({ rawText: 'TERMS NET 30' })).eligible).toBe(false);
    expect(earlyPayFreightWaiver(null).eligible).toBe(false);
  });
  test('EDI doc (no rawText) with a freight allowance is the same signal', () => {
    const w = earlyPayFreightWaiver({ supplier: 'RAWLINGS SPORTING GOODS CO INC', freight: 12, rawText: '', _freight_allowance: 12 });
    expect(w.eligible).toBe(true);
    expect(w.payByDate).toBe('');
  });
});
