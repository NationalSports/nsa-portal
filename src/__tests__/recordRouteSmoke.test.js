// Mounts <App/> under a range of deep-link URLs to exercise the record-level URL router
// (boot → open record, portal guard, popstate listener) for crash-safety. The pure
// serialization is covered separately in recordRoute.test.js; this guards the wiring.

jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));
jest.mock('fabric', () => ({ __esModule: true, Canvas: class {}, Rect: class {}, Image: class {} }));
jest.mock('tesseract.js', () => ({ __esModule: true, createWorker: () => ({}) }));
jest.mock('barcode-detector', () => ({ __esModule: true, BarcodeDetector: class {} }));
jest.mock('imagetracerjs', () => ({ __esModule: true, default: { imagedataToSVG: () => '' } }));
jest.mock('xlsx', () => ({ __esModule: true, read: () => ({}), utils: {}, writeFile: () => {} }));

import React from 'react';
import { render, act } from '@testing-library/react';
import App from '../App';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
  window.scrollTo = window.scrollTo || (() => {});
  if (!('IntersectionObserver' in window)) {
    window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
  }
});

// Set the URL without triggering jsdom navigation (which is unimplemented).
const setUrl = (search) => window.history.replaceState({}, '', '/' + (search || ''));

beforeEach(() => {
  window.localStorage.setItem('nsa_user', JSON.stringify({
    id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin', role: 'admin',
  }));
});
afterEach(() => { window.localStorage.removeItem('nsa_user'); setUrl(''); });

test('mounts on a section deep-link (?pg=orders) and keeps ?pg= in the URL', () => {
  setUrl('?pg=orders');
  expect(() => render(<App />)).not.toThrow();
  // The router must not wipe the section param it loaded into.
  expect(new URLSearchParams(window.location.search).get('pg')).toBe('orders');
});

test('mounts on a record deep-link (?so=SO-X) with no data loaded — no crash', () => {
  // No Supabase in tests, so the collection stays empty and the boot simply waits; the point
  // is that the new boot/needWait path does not throw.
  setUrl('?so=SO-DOESNOTEXIST');
  expect(() => render(<App />)).not.toThrow();
});

test('mounts on an invoice deep-link (?pg=invoices&inv=INV-X) — no crash', () => {
  setUrl('?pg=invoices&inv=INV-DOESNOTEXIST');
  expect(() => render(<App />)).not.toThrow();
});

test('mounts in public portal mode (?portal=tag) without the router touching the URL', () => {
  setUrl('?portal=some-team');
  expect(() => render(<App />)).not.toThrow();
  // The record router must leave the storefront URL alone.
  expect(new URLSearchParams(window.location.search).get('portal')).toBe('some-team');
});

test('a Back/Forward (popstate) event does not throw', () => {
  setUrl('?pg=orders');
  render(<App />);
  expect(() => act(() => { window.dispatchEvent(new PopStateEvent('popstate')); })).not.toThrow();
});
