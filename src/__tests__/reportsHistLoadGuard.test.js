// Regression: the Reports page must not present billed totals as final while the
// NetSuite invoice history (customer_invoices) is still loading — or failed to load.
//
// That history loads on an idle callback AFTER the main sync, so for the first
// seconds histInvs is []. Every billed figure on the page then silently reduced over
// portal invoices only and rendered a real-looking "$2.82M YTD / vs $0 last year /
// ▲100%" instead of the true $8.4M — reported from production 2026-09-21.
jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));
jest.mock('fabric', () => ({ __esModule: true, Canvas: class {}, Rect: class {}, Image: class {} }));
jest.mock('tesseract.js', () => ({ __esModule: true, createWorker: () => ({}) }));
jest.mock('barcode-detector', () => ({ __esModule: true, BarcodeDetector: class {} }));
jest.mock('imagetracerjs', () => ({ __esModule: true, default: { imagedataToSVG: () => '' } }));
jest.mock('xlsx', () => ({ __esModule: true, read: () => ({}), utils: {}, writeFile: () => {} }));

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from '../App';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
  window.scrollTo = window.scrollTo || (() => {});
  window.print = window.print || (() => {});
  if (!('IntersectionObserver' in window)) {
    window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
  }
});

test('billed totals are withheld while NetSuite invoice history has not loaded', () => {
  window.localStorage.setItem('nsa_user', JSON.stringify({
    id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin', role: 'admin',
  }));
  const { container } = render(<App />);

  const reportsLink = screen.getAllByText('Reports').find((el) => el.closest('.sidebar-link'));
  fireEvent.click(reportsLink);

  const shell = container.querySelector('.nsa-rpt');
  expect(shell).toBeTruthy();
  const q = within(shell);

  // The page says plainly that the history isn't in yet — on the page banner and
  // again in place of the monthly billed chart.
  expect(q.getAllByText(/Loading NetSuite invoice history/i).length).toBeGreaterThanOrEqual(2);

  // And the YTD Billed tile shows an em-dash, not a portal-only dollar figure.
  const ytdTile = q.getByText('YTD Billed').closest('div.num');
  expect(ytdTile).toBeTruthy();
  expect(ytdTile.textContent).toContain('—');
  expect(ytdTile.textContent).not.toMatch(/\$[\d,.]/);

  // No "vs $0 last year" / "▲ 100%" style comparison against a missing baseline.
  expect(ytdTile.textContent).not.toMatch(/last year/i);
  expect(within(shell).queryByText(/vs last yr/i)).toBeNull();

  // Pipeline figures are sales-order-derived, not billed — they must stay live.
  const pipeTile = q.getByText('Pipeline Rev').closest('div.num');
  expect(pipeTile.textContent).not.toContain('—');
});
