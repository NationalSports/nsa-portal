// Smoke test: the App component must initialize and mount without throwing.
// This guards against startup crashes that a production build can't catch —
// e.g. a temporal-dead-zone ReferenceError from a hook dependency array that
// references a state variable declared later in the component body.
// Supabase is null here (no REACT_APP_SUPABASE_* env), so the app mounts in
// no-DB mode and we only assert that rendering does not throw.

// Heavy PDF/canvas/OCR libs ship dist bundles jest can't transform; stub them
// so we can actually mount <App/>. None are exercised on initial render.
jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));
jest.mock('fabric', () => ({ __esModule: true, Canvas: class {}, Rect: class {}, Image: class {} }));
jest.mock('tesseract.js', () => ({ __esModule: true, createWorker: () => ({}) }));
jest.mock('barcode-detector', () => ({ __esModule: true, BarcodeDetector: class {} }));
jest.mock('imagetracerjs', () => ({ __esModule: true, default: { imagedataToSVG: () => '' } }));
jest.mock('xlsx', () => ({ __esModule: true, read: () => ({}), utils: {}, writeFile: () => {} }));

import React from 'react';
import { render } from '@testing-library/react';
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

test('App mounts without throwing (no TDZ / init crash)', () => {
  expect(() => render(<App />)).not.toThrow();
});
