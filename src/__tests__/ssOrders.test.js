// Unit tests for the S&S Activewear Orders → parsed-bill adapter (src/ssOrders.js).
//
// S&S comes through Sports Inc only as a scanned/header-only doc (no usable lines), so we
// pull the bill straight from S&S's own /Orders feed instead. The adapter must emit the SAME
// shape mapSportsLinkDocToBill / parseSingleInvoice produce so the match / review / push
// pipeline consumes it unchanged. These lock in the field mapping, the shipped-qty-only rule,
// the two-key dedup, credit handling, and the query builder.
const { mapSsOrderToBill, buildSsOrdersQuery, resolveSsBillLines } = require('../ssOrders');

// Realistic shape of a GET /Orders?lines=true item (camelCase, as S&S V2 returns).
const ssOrder = {
  orderNumber: '12345678',
  poNumber: 'PO 3421 WEST',
  invoiceNumber: '98765432',
  orderDate: '2026-05-10T00:00:00',
  shipDate: '2026-05-12T00:00:00',
  invoiceDate: '2026-05-12T00:00:00',
  shipping: 14.25,
  total: 140.25,
  totalPieces: 36,
  totalLines: 3,
  lines: [
    { lineNumber: 1, type: 'S', sku: 'B00760003', gtin: '00821780012345', yourSku: 'PC61-BLACK-M', qtyOrdered: 12, qtyShipped: 12, price: 3.5, title: 'Port & Company Essential Tee', colorName: 'Black', sizeName: 'Medium' },
    { lineNumber: 2, type: 'S', sku: 'B00760004', gtin: '00821780012352', yourSku: 'PC61-BLACK-L', qtyOrdered: 24, qtyShipped: 24, price: 3.5, title: 'Port & Company Essential Tee', colorName: 'Black', sizeName: 'Large' },
    // Ordered but not yet shipped — must NOT be billed (dropped).
    { lineNumber: 3, type: 'S', sku: 'B00760005', gtin: '00821780012369', yourSku: 'PC61-BLACK-XL', qtyOrdered: 6, qtyShipped: 0, price: 3.5, title: 'Port & Company Essential Tee', colorName: 'Black', sizeName: 'X-Large' },
  ],
};

describe('mapSsOrderToBill', () => {
  test('maps header fields into the parsed-bill shape', () => {
    const b = mapSsOrderToBill(ssOrder);
    expect(b.po_number).toBe('PO 3421 WEST');
    expect(b.doc_number).toBe('98765432');        // dedup key = invoice #
    expect(b.supplier_doc_number).toBe('98765432');
    expect(b.si_doc_number).toBe('12345678');     // stable secondary key = order #
    expect(b.supplier).toBe('S&S Activewear');
    expect(b.supplier_method).toBe('EDI');        // structured lines → approve flow
    expect(b.po_origin).toBe('portal');           // "PO " + space
    expect(b.source_type).toBe('edi');
    expect(b.doc_date).toBe('05/12/2026');        // prefers invoiceDate
    expect(b.ship_date).toBe('05/12/2026');
    expect(b.freight).toBe(14.25);
    expect(b.doc_total).toBe(140.25);
    expect(b.si_upcharge).toBe(0);
    expect(b.kind).toBe('goods');
    expect(b.source).toBe('ss_orders');
    expect(b.has_lines).toBe(true);
    expect(b.has_usable_lines).toBe(true);
    expect(b.warnings).toHaveLength(0);
  });

  test('uses yourSku (our own SKU) as the match key and bills the shipped qty', () => {
    const b = mapSsOrderToBill(ssOrder);
    expect(b.items).toHaveLength(2); // the 0-shipped line is dropped
    expect(b.items[0]).toMatchObject({ sku: 'PC61-BLACK-M', upc: '00821780012345', size: 'Medium', color: 'Black', qty: 12, unit_price: 3.5, extension: 42 });
    expect(b.items[1]).toMatchObject({ sku: 'PC61-BLACK-L', qty: 24, extension: 84 });
    // merchandise = sum of line extensions
    expect(b.merchandise_total).toBe(126);
  });

  test('a 0-shipped (backordered/pending) line is NOT billed against the ordered qty', () => {
    const pending = { orderNumber: 'P1', lines: [{ yourSku: 'A-B-M', qtyOrdered: 5, qtyShipped: 0, price: 5, sizeName: 'M' }] };
    const b = mapSsOrderToBill(pending);
    expect(b.items).toHaveLength(0);
    expect(b.has_usable_lines).toBe(false);
    expect(b.source_type).toBe('scanned');
    expect(b.warnings.join(' ')).toMatch(/nothing to bill/i);
  });

  test('falls back to the S&S sku when yourSku is absent (order placed directly on ssactivewear.com)', () => {
    const b = mapSsOrderToBill({ orderNumber: 'X', lines: [{ sku: 'B999', qtyShipped: 1, price: 5, sizeName: 'L', colorName: 'Red' }] });
    expect(b.items[0].sku).toBe('B999');
  });

  test('two-key dedup: doc_number falls back to the order # before the order is invoiced', () => {
    const b = mapSsOrderToBill({ ...ssOrder, invoiceNumber: '' });
    expect(b.doc_number).toBe('12345678');   // order # so it still dedups
    expect(b.si_doc_number).toBe('12345678');
    expect(b.supplier_doc_number).toBe('');
  });

  test('tolerates PascalCase field casing', () => {
    const b = mapSsOrderToBill({ OrderNumber: 'O1', InvoiceNumber: 'I1', PoNumber: 'PO 9 ABC', Shipping: 10, Total: 60,
      Lines: [{ YourSku: 'A-B-M', Sku: 'S1', QtyShipped: 2, Price: 25, SizeName: 'M', ColorName: 'Navy', Title: 'Tee' }] });
    expect(b.doc_number).toBe('I1');
    expect(b.items[0]).toMatchObject({ sku: 'A-B-M', qty: 2, size: 'M', color: 'Navy' });
    expect(b.merchandise_total).toBe(50);
  });

  test('flags a return/credit (negative total)', () => {
    const b = mapSsOrderToBill({ orderNumber: 'R1', total: -42, lines: [{ yourSku: 'A-B-M', qtyShipped: 1, price: -42, sizeName: 'M' }] });
    expect(b.is_credit).toBe(true);
    expect(b.warnings.join(' ')).toMatch(/negative|credit/i);
  });

  test('tolerates a completely empty order without throwing', () => {
    const b = mapSsOrderToBill({});
    expect(b.items).toHaveLength(0);
    expect(b.po_number).toBe('');
    expect(b.doc_number).toBe('');
    expect(b.has_usable_lines).toBe(false);
    expect(b.po_origin).toBe('unknown');
  });
});

describe('buildSsOrdersQuery', () => {
  test('defaults to ?All=True&lines=true (last 3 months, with line detail)', () => {
    expect(buildSsOrdersQuery()).toBe('/Orders/?All=True&lines=true');
  });
  test('builds an invoice date range (both bounds, S&S requires it)', () => {
    expect(buildSsOrdersQuery({ startDate: '2026-01-01', endDate: '2026-03-31' }))
      .toBe('/Orders/?invoicestartdate=2026-01-01&invoiceenddate=2026-03-31&lines=true');
  });
  test('puts a specific identifier (PO/order/invoice #) in the path segment', () => {
    expect(buildSsOrdersQuery({ poNumber: 'PO 3421' })).toBe('/Orders/PO%203421?lines=true');
    expect(buildSsOrdersQuery({ invoiceNumber: '98765432' })).toBe('/Orders/98765432?lines=true');
  });
  test('single invoice date', () => {
    expect(buildSsOrdersQuery({ invoiceDate: '2026-05-12' })).toBe('/Orders/?invoicedate=2026-05-12&lines=true');
  });
});

describe('resolveSsBillLines', () => {
  // The real SO-1396 case: our line is style 3023CL / Ivory, one candidate per open size.
  const cand = (size, unit) => ({ sku: '3023CL', size, color: 'Ivory', so_id: 'SO-1396', item_id: 'it1', po_id: 'PO 3517 OLuST', unit_cost: unit });
  const ivoryCands = [cand('S', 6.63), cand('M', 6.63), cand('L', 6.63), cand('XL', 6.63), cand('2XL', 8.46)];
  // The bill lines carry S&S's per-size part numbers, not our style.
  const bill = [
    { sku: 'B18008333', size: 'S', color: 'Ivory', qty: 30 },
    { sku: 'B18008334', size: 'M', color: 'Ivory', qty: 15 },
    { sku: 'B18008335', size: 'L', color: 'Ivory', qty: 10 },
    { sku: 'B18008336', size: 'XL', color: 'Ivory', qty: 7 },
    { sku: 'B18008337', size: '2XL', color: 'Ivory', qty: 3 },
  ];

  test('resolves S&S part-number lines to our style by color + size', () => {
    const r = resolveSsBillLines(bill, ivoryCands);
    expect(r.map((x) => x.via)).toEqual(['color_size', 'color_size', 'color_size', 'color_size', 'color_size']);
    expect(r.map((x) => x.cand && x.cand.sku)).toEqual(['3023CL', '3023CL', '3023CL', '3023CL', '3023CL']);
    expect(r.map((x) => x.cand && x.cand.size)).toEqual(['S', 'M', 'L', 'XL', '2XL']);
    expect(r[4].cand.unit_cost).toBe(8.46); // 2XL priced line lands on the 2XL bucket
  });

  test('prefers an exact SKU + size match when the bill DOES carry our SKU (CrossRef set up)', () => {
    const r = resolveSsBillLines([{ sku: '3023CL', size: 'L', color: 'Ivory', qty: 10 }], ivoryCands);
    expect(r[0].via).toBe('sku_size');
    expect(r[0].cand.size).toBe('L');
  });

  test('normalizes size labels via canonSize so "Medium" ↔ "M" align', () => {
    const canonSize = (s) => ({ MEDIUM: 'M', 'X-LARGE': 'XL' }[String(s).toUpperCase()] || String(s).toUpperCase());
    const r = resolveSsBillLines([{ sku: 'B1', size: 'Medium', color: 'Ivory', qty: 5 }], ivoryCands, { canonSize });
    expect(r[0].cand.size).toBe('M');
    expect(r[0].via).toBe('color_size');
  });

  test('falls back to size alone when the bill line has no color but the size is unique', () => {
    const r = resolveSsBillLines([{ sku: 'B1', size: 'L', color: '', qty: 5 }], ivoryCands);
    expect(r[0].via).toBe('size_only');
    expect(r[0].cand.sku).toBe('3023CL');
  });

  test('breaks a same-size+color tie across two styles by exact unit price (the batch case)', () => {
    // Real case: batch NSA 4505 holds a $15.44 bra AND a $7.14 tee, both in "L Black".
    const batchCands = [
      { sku: 'LUXEBRA', size: 'L', color: 'Black', so_id: 'SO-9', item_id: 'b1', po_id: 'NSA 4505', unit_cost: 15.44 },
      { sku: 'LUXETEE', size: 'L', color: 'Black', so_id: 'SO-9', item_id: 't1', po_id: 'NSA 4505', unit_cost: 7.14 },
    ];
    const r = resolveSsBillLines([
      { sku: 'B005A2505', size: 'L', color: 'Black', qty: 1, unit_price: 15.44 },
      { sku: 'B007A2503', size: 'L', color: 'Black', qty: 1, unit_price: 7.14 },
    ], batchCands);
    expect(r[0].cand.sku).toBe('LUXEBRA');
    expect(r[0].via).toBe('color_size_price');
    expect(r[1].cand.sku).toBe('LUXETEE');
    expect(r[1].via).toBe('color_size_price');
  });

  test('returns null (no guess) when color + size is ambiguous and prices also tie', () => {
    const ambiguous = [
      cand('L', 6.63),
      { sku: '18000', size: 'L', color: 'Ivory', so_id: 'SO-1396', item_id: 'it2', po_id: 'PO 3517 OLuST', unit_cost: 6.63 },
    ];
    const r = resolveSsBillLines([{ sku: 'B18008335', size: 'L', color: 'Ivory', qty: 10, unit_price: 6.63 }], ambiguous);
    expect(r[0].cand).toBeNull();
    expect(r[0].via).toBe('none');
  });

  test('returns null when color + size is ambiguous and the bill price matches neither', () => {
    const ambiguous = [
      cand('L', 6.63),
      { sku: '18000', size: 'L', color: 'Ivory', so_id: 'SO-1396', item_id: 'it2', po_id: 'PO 3517 OLuST', unit_cost: 4.0 },
    ];
    const r = resolveSsBillLines([{ sku: 'B18008335', size: 'L', color: 'Ivory', qty: 10, unit_price: 9.99 }], ambiguous);
    expect(r[0].cand).toBeNull();
    expect(r[0].via).toBe('none');
  });

  test('returns null when the size is not on the SO at all', () => {
    const r = resolveSsBillLines([{ sku: 'B1', size: '4XL', color: 'Ivory', qty: 2 }], ivoryCands);
    expect(r[0].cand).toBeNull();
  });

  test('collapses duplicate candidate buckets (same item+po_line+size) so it is not falsely ambiguous', () => {
    const dupe = [cand('L', 6.63), cand('L', 6.63)]; // same item_id/po_id/size twice
    const r = resolveSsBillLines([{ sku: 'B1', size: 'L', color: 'Ivory', qty: 10 }], dupe);
    expect(r[0].cand && r[0].cand.sku).toBe('3023CL');
  });
});
