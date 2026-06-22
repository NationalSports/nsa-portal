// vendorInventory → vendorApis → components.js pulls in heavy dist bundles jest
// can't transform; stub them (mirrors appSmoke.test.js). None are used here.
jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));
jest.mock('fabric', () => ({ __esModule: true, Canvas: class {}, Rect: class {}, Image: class {} }));
jest.mock('tesseract.js', () => ({ __esModule: true, createWorker: () => ({}) }));
jest.mock('barcode-detector', () => ({ __esModule: true, BarcodeDetector: class {} }));
jest.mock('imagetracerjs', () => ({ __esModule: true, default: { imagedataToSVG: () => '' } }));
jest.mock('xlsx', () => ({ __esModule: true, read: () => ({}), utils: {}, writeFile: () => {} }));

import { vendorInvSource } from '../vendorInventory';

// vendorInvSource decides which stock source an OMG item is checked against.
// It keys off the vendor's api_provider (or name/brand), so a wrong mapping
// silently sends an item to the wrong API — lock the contract here.
describe('vendorInvSource', () => {
  test('maps api_provider to the right source code', () => {
    expect(vendorInvSource({ api_provider: 'ss_activewear' })).toBe('ss');
    expect(vendorInvSource({ api_provider: 'sanmar' })).toBe('sm');
    expect(vendorInvSource({ api_provider: 'momentec' })).toBe('mt');
    expect(vendorInvSource({ api_provider: 'richardson' })).toBe('rs');
    expect(vendorInvSource({ api_provider: 'champro' })).toBe('cp');
  });

  test('falls back to vendor name when api_provider is absent', () => {
    expect(vendorInvSource({ name: 'S&S Activewear' })).toBe('ss');
    expect(vendorInvSource({ name: 'SanMar' })).toBe('sm');
    expect(vendorInvSource({ name: 'Momentec' })).toBe('mt');
    expect(vendorInvSource({ name: 'Richardson' })).toBe('rs');
    expect(vendorInvSource({ name: 'Adidas' })).toBe('adidas');
    // Champro vendor row carries name only (api_provider is null), so the name match matters.
    expect(vendorInvSource({ name: 'Champro' })).toBe('cp');
    expect(vendorInvSource({ name: 'Champro', api_provider: null })).toBe('cp');
  });

  test('Richardson brand resolves even without a vendor record', () => {
    expect(vendorInvSource(null, { brand: 'Richardson' })).toBe('rs');
    expect(vendorInvSource(undefined, { brand: 'adidas' })).toBe('adidas');
  });

  test('vendors with no stock API return empty (no fake check)', () => {
    expect(vendorInvSource({ name: 'Flag', api_provider: '' })).toBe('');
    expect(vendorInvSource(null)).toBe('');
    expect(vendorInvSource({})).toBe('');
  });
});
