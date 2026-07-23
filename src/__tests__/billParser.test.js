// Regression tests for the Sports Inc / Adidas supplier-bill parser in src/App.js.
//
// The parser lives as a closure inside the App component, so rather than refactor 30k lines we
// slice the real source out of App.js (between `const _normalizeDecoPO=` and `const processBillPdfs=`)
// and execute it with stubbed catalog/state. The fixtures are the ACTUAL pdf.js text extraction of
// real invoices (see src/__tests__/fixtures/sportsIncBills.json), so these lock in the exact bugs
// the team hit:
//   • a catalog SKU sitting in a barcode/description line ("ULT365 SLD POLO") became a phantom item
//   • sizes like "2XL7"/"3XLT" collapsed to the qty "1"
//   • repeated page header/address blocks ("DEPT CH 19361", "NATIONAL SPORTS APPAREL") became items
// In every case the real line items must sum to the printed merchandise total.
const fs = require('fs');
const path = require('path');

function loadParser() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8').split('\n');
  const start = src.findIndex(l => l.includes('const _normalizeDecoPO='));
  const end = src.findIndex(l => l.includes('const processBillPdfs='));
  if (start < 0 || end < 0 || end <= start) throw new Error('Could not locate bill parser block in App.js');
  const block = src.slice(start, end).join('\n');
  const safeNum = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  // Empty catalog → the parser falls back to its SKU regexes (still reproduces the ULT365 phantom,
  // which is detected via SKU_RE, not the catalog).
  // The parse block calls the real sportsLink helpers (document discount + SI-fee fill) —
  // inject the true implementations so these fixtures characterize actual behavior.
  const { applySiDocumentDiscount, siExpectedUpcharge } = require('../sportsLink');
  const factory = new Function('prod', 'vend', 'sos', 'submittedBatches', 'invPOs', 'safeNum', 'applySiDocumentDiscount', 'siExpectedUpcharge',
    block + '\n; return { parseSupplierBill, parseSingleInvoice };');
  return factory([], [], [], [], [], safeNum, applySiDocumentDiscount, siExpectedUpcharge);
}

const fixtures = require('./fixtures/sportsIncBills.json');
const { parseSupplierBill } = loadParser();

describe('Sports Inc supplier-bill parser — real-invoice regressions', () => {
  for (const fx of fixtures) {
    describe(fx.name, () => {
      const pages = fx.pages;
      const bills = parseSupplierBill(pages.join('\n'), pages);
      const bill = bills[0];

      test('produces exactly the expected number of line items (no phantoms)', () => {
        expect(bill.items.length).toBe(fx.expect.itemCount);
      });

      test('line items sum to the merchandise total', () => {
        const sum = bill.items.reduce((a, it) => a + (it.extension || 0), 0);
        expect(Math.abs(sum - fx.expect.merch)).toBeLessThan(0.5);
      });

      if (fx.expect.absentSku) {
        test(`never emits a phantom "${fx.expect.absentSku}" item`, () => {
          expect(bill.items.some(it => (it.sku || '').toUpperCase() === fx.expect.absentSku)).toBe(false);
        });
      }

      if (fx.expect.skus) {
        test('emits the real SKUs with the right counts', () => {
          for (const [sku, count] of Object.entries(fx.expect.skus)) {
            expect(bill.items.filter(it => (it.sku || '').toUpperCase() === sku).length).toBe(count);
          }
        });
      }

      if (fx.expect.sizes) {
        test('reads sizes from the size column, not the qty', () => {
          expect(bill.items.map(it => it.size)).toEqual(fx.expect.sizes);
        });
      }
    });
  }
});
