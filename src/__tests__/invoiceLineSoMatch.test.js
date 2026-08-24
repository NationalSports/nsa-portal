// matchInvoiceLinesToSo — the join between an invoice line and the sales-order line it came
// from. It is what re-attaches SO-only detail (size breakdown, decorations) to a printed
// invoice and to the invoice page's packing slip, so a mismatch would put one garment's sizes
// on another garment's row. What this pins down:
//   • the stored _so_line_key wins, even when the invoice lines are in a different order
//   • duplicate SKUs map 1:1 — one SO line is never claimed by two invoice lines
//   • lines with no key fall back to SKU, then to a description prefix
//   • a line that matches nothing reports -1 rather than borrowing a neighbour's SO line

jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));
jest.mock('fabric', () => ({ __esModule: true, Canvas: class {}, Rect: class {}, Image: class {} }));
jest.mock('tesseract.js', () => ({ __esModule: true, createWorker: () => ({}) }));
jest.mock('barcode-detector', () => ({ __esModule: true, BarcodeDetector: class {} }));
jest.mock('imagetracerjs', () => ({ __esModule: true, default: { imagedataToSVG: () => '' } }));
jest.mock('xlsx', () => ({ __esModule: true, read: () => ({}), utils: {}, writeFile: () => {} }));

import { matchInvoiceLinesToSo } from '../App';
import { soLineKey } from '../safeHelpers';

const soItems = [
  { sku: 'A325', name: 'Tiro Jersey', color: 'Navy', sizes: { M: 6, L: 6 } },
  { sku: 'A325', name: 'Tiro Jersey', color: 'White', sizes: { M: 4 } },
  { sku: 'B100', name: 'Select Ball', color: '', sizes: { OSFA: 12 } },
];

test('stored line key wins, whatever order the invoice lines are in', () => {
  const lines = [
    { desc: 'A325 Tiro Jersey — White', _sku: 'A325', _so_line_key: soLineKey(soItems[1], 1) },
    { desc: 'A325 Tiro Jersey — Navy', _sku: 'A325', _so_line_key: soLineKey(soItems[0], 0) },
  ];
  expect(matchInvoiceLinesToSo(lines, soItems)).toEqual([1, 0]);
});

test('duplicate SKUs without keys map 1:1 — the second line takes the second SO row', () => {
  const lines = [{ _sku: 'A325' }, { _sku: 'A325' }];
  expect(matchInvoiceLinesToSo(lines, soItems)).toEqual([0, 1]);
});

test('falls back to a description prefix when the line carries no SKU', () => {
  expect(matchInvoiceLinesToSo([{ desc: 'B100 Select Ball' }], soItems)).toEqual([2]);
});

test('an unmatched line reports -1 instead of claiming someone else’s SO row', () => {
  const lines = [{ _sku: 'A325' }, { _sku: 'NOPE-999' }];
  expect(matchInvoiceLinesToSo(lines, soItems)).toEqual([0, -1]);
});

test('a stale line key degrades to the SKU match rather than dropping the line', () => {
  const lines = [{ _sku: 'B100', _so_line_key: 'B100|Blue|7' }];
  expect(matchInvoiceLinesToSo(lines, soItems)).toEqual([2]);
});

test('no SO items at all — every line is unmatched, nothing throws', () => {
  expect(matchInvoiceLinesToSo([{ _sku: 'A325' }, { desc: 'B100 Ball' }], [])).toEqual([-1, -1]);
});
