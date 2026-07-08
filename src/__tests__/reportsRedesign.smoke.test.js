// Smoke: the redesigned Reports page mounts and its shell + Overview
// interactions do not throw with empty (no-DB) data. Guards the new
// rReports shell/Overview against startup + render crashes.
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

test('redesigned Reports shell + Overview render and interact without throwing', () => {
  window.localStorage.setItem('nsa_user', JSON.stringify({
    id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin', role: 'admin',
  }));
  const { container } = render(<App />);

  // Navigate to the Reports page via the sidebar nav link.
  const reportsLink = screen.getAllByText('Reports').find((el) => el.closest('.sidebar-link'));
  expect(reportsLink).toBeTruthy();
  expect(() => fireEvent.click(reportsLink)).not.toThrow();

  // The redesigned branded shell rendered (scope queries to it to avoid
  // colliding with the sidebar's own "Overview"/"Customers" labels).
  const shell = container.querySelector('.nsa-rpt');
  expect(shell).toBeTruthy();
  const q = within(shell);
  expect(q.getByText('Team Dealer Portal')).toBeTruthy();
  expect(q.getByText('YTD Billed')).toBeTruthy();       // KPI tile
  expect(q.getByText('Overview')).toBeTruthy();          // active sub-tab
  expect(q.getByText('Monthly Sales')).toBeTruthy();     // Overview module
  expect(q.getByText('Reorder Radar')).toBeTruthy();

  // Overview interactions.
  expect(() => fireEvent.click(q.getByText('Trend'))).not.toThrow();   // chart mode
  expect(() => fireEvent.click(q.getByText('At-Risk'))).not.toThrow(); // radar mode

  // Group nav + sub-tab switching keeps the shell alive (legacy tabs still render).
  expect(() => fireEvent.click(within(shell).getAllByText('Customers')[0])).not.toThrow();
  expect(() => fireEvent.click(within(shell).getAllByText('Production')[0])).not.toThrow();
  expect(() => fireEvent.click(within(shell).getAllByText('Finance')[0])).not.toThrow();
  expect(() => fireEvent.click(within(shell).getAllByText('Sales')[0])).not.toThrow();
  expect(container.querySelector('.nsa-rpt')).toBeTruthy();

  window.localStorage.removeItem('nsa_user');
});
