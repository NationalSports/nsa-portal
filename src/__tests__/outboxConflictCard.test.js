// Conflict-card UI test: mounts the full <App/> (same harness as appSmoke) and drives the
// outbox conflict card through the live stale-rejection path — dbEngine's _emitOutboxConflict
// callback — asserting the card renders, "Discard my edit" clears both the card and the durable
// outbox entry, and "Apply my edit anyway" restores the payload for re-save.
// Supabase is null here, which is fine: the card, the callback, and the outbox store are all
// backend-independent by design (that's what makes the content durable).

jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));
jest.mock('fabric', () => ({ __esModule: true, Canvas: class {}, Rect: class {}, Image: class {} }));
jest.mock('tesseract.js', () => ({ __esModule: true, createWorker: () => ({}) }));
jest.mock('barcode-detector', () => ({ __esModule: true, BarcodeDetector: class {} }));
jest.mock('imagetracerjs', () => ({ __esModule: true, default: { imagedataToSVG: () => '' } }));
jest.mock('xlsx', () => ({ __esModule: true, read: () => ({}), utils: {}, writeFile: () => {} }));

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../App';
import { _emitOutboxConflict, _outboxList, _dbSaveFailedIds } from '../lib/dbEngine';

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

beforeEach(() => {
  localStorage.removeItem('nsa_outbox');
  window.localStorage.setItem('nsa_user', JSON.stringify({
    id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin', role: 'admin',
  }));
});

afterEach(() => {
  localStorage.removeItem('nsa_outbox');
  localStorage.removeItem('nsa_user');
});

const emitConflict = (id = 'EST-9001') => act(() => {
  _emitOutboxConflict('estimates', { id, memo: 'the rejected edit', customer_name: 'Big Team LLC', _version: 3 });
});

test('a stale rejection surfaces the conflict card immediately', () => {
  render(<App />);
  emitConflict();
  expect(screen.getByText(/EST-9001 — Big Team LLC/)).toBeTruthy();
  expect(screen.getByText(/Apply my edit anyway/)).toBeTruthy();
  expect(screen.getByText(/Discard my edit/)).toBeTruthy();
  // the content is durably stored, not just in component state
  expect(_outboxList().map(e => e.id)).toContain('EST-9001');
});

test('Discard clears the card AND the durable outbox entry', () => {
  render(<App />);
  emitConflict();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByText(/Discard my edit/));
  confirmSpy.mockRestore();
  expect(screen.queryByText(/EST-9001/)).toBeNull();
  expect(_outboxList()).toHaveLength(0);
});

test('Apply-anyway removes the card and flags the entity for re-save', () => {
  render(<App />);
  emitConflict();
  fireEvent.click(screen.getByText(/Apply my edit anyway/));
  // card gone…
  expect(screen.queryByText(/Apply my edit anyway/)).toBeNull();
  // …entity flagged so the retry/diff-save flow persists the restored payload; the outbox
  // entry deliberately survives until a save actually succeeds.
  expect(_dbSaveFailedIds.has('EST-9001')).toBe(true);
  expect(_outboxList().map(e => e.id)).toContain('EST-9001');
  // cleanup module-level state so later suites aren't affected
  _dbSaveFailedIds.delete('EST-9001');
});
