// Regression tests for the Silver Screen (decoration) supplier-bill parser in src/App.js.
//
// Same harness as billParser.test.js: slice the real parser closure out of App.js (between
// `const _normalizeDecoPO=` and `const processBillPdfs=`) and run it with stubbed catalog/state.
// The fixtures are the ACTUAL pdf.js text extraction of two real Silver Screen invoices, so they
// lock in the two bugs the team hit on these bills:
//   • the P.O. NUMBER cell holds "PO 3514 OLuST - tackle twill" — a store tag plus a trailing
//     description — so the old both-ends-anchored /^(PO\d{3,}|\d{3,})$/ never matched and the PO
//     was dropped ("PO number not found", no SO match).
//   • the amount column carries a thousands-comma once a line hits $1,000 ("3,432.00T"), which the
//     numeric guard in _parseDecoRow rejected — so that $3,432 line vanished and the remaining
//     items no longer summed to the invoice total.
//   • the P.O. NUMBER cell can carry the "DPO" (decoration PO) prefix the app itself mints
//     ("DPO 3516 OLuST", see OrderEditor) — the PO regex only recognized a "PO"/bare-number prefix,
//     so the leading "D" made it match nothing and the PO was dropped again.
// After the fix the PO is read verbatim (so it matches the deco PO the rep created on the SO) and
// every line item is kept, so the items reconcile to the printed total.
const fs = require('fs');
const path = require('path');

function loadParser() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8').split('\n');
  const start = src.findIndex(l => l.includes('const _normalizeDecoPO='));
  const end = src.findIndex(l => l.includes('const processBillPdfs='));
  if (start < 0 || end < 0 || end <= start) throw new Error('Could not locate bill parser block in App.js');
  const block = src.slice(start, end).join('\n');
  const safeNum = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  // Two sales orders each carrying the deco PO the rep created for these bills, so the auto-match
  // (so.deco_pos) can be exercised end-to-end — a picked-up PO is only useful if it actually matches.
  const sos = [
    { id: 'SO-1600', customer_id: 'c1', deco_pos: [{ po_id: 'PO 3514 OLuST', vendor: 'Silver Screen', deco_type: 'embroidery', expected_cost: 4213.44 }], items: [] },
    { id: 'SO-1601', customer_id: 'c2', deco_pos: [{ po_id: 'PO 3521 OLuST', vendor: 'Silver Screen', deco_type: 'embroidery', expected_cost: 2608.52 }], items: [] },
    { id: 'SO-1602', customer_id: 'c3', deco_pos: [{ po_id: 'DPO 3516 OLuST', vendor: 'Silver Screen', deco_type: 'embroidery', expected_cost: 4213.44 }], items: [] },
  ];
  const factory = new Function('prod', 'vend', 'sos', 'submittedBatches', 'invPOs', 'safeNum',
    block + '\n; return { parseSupplierBill };');
  return factory([], [], sos, [], [], safeNum);
}

const fixtures = require('./fixtures/silverScreenBills.json');
const { parseSupplierBill } = loadParser();

describe('Silver Screen supplier-bill parser — real-invoice regressions', () => {
  for (const fx of fixtures) {
    describe(fx.name, () => {
      const bill = parseSupplierBill(fx.pages.join('\n'), fx.pages)[0];

      test('is recognized as a Silver Screen decoration bill', () => {
        expect(bill.kind).toBe('decoration');
        expect(bill.supplier).toBe(fx.expect.supplier);
        expect(bill.doc_number).toBe(fx.expect.docNumber);
      });

      test('reads the doc date and due date from the columnar header table', () => {
        expect(bill.doc_date).toBe(fx.expect.docDate);
        expect(bill.due_date).toBe(fx.expect.dueDate);
      });

      test('picks up the PO number verbatim (store tag kept, trailing description trimmed)', () => {
        expect(bill.po_number).toBe(fx.expect.po);
        expect(bill.warnings).not.toContain('PO number not found');
      });

      test('auto-matches the sales-order decoration PO', () => {
        expect(bill.matchedPOSource).toBe('so_deco_po');
        expect(bill.matchedPO && bill.matchedPO.po_id).toBe(fx.expect.po);
      });

      test('keeps every line item so they reconcile to the invoice total', () => {
        expect(bill.items.length).toBe(fx.expect.itemCount);
        expect(bill.doc_total).toBeCloseTo(fx.expect.docTotal, 2);
        const sum = bill.items.reduce((a, it) => a + (it.amount || 0), 0);
        expect(sum).toBeCloseTo(fx.expect.docTotal, 2);
      });
    });
  }
});
