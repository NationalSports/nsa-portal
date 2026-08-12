/* eslint-disable */
// Batch-PO eligibility for vendors that live only in the DB (not the D_V seed).
//
// The PO modal decides "is this vendor batchable?" by matching the vendor's NAME against
// BATCH_VENDORS. It used to resolve that name from D_V — the static v1–v8 seed in
// constants.js — so any vendor whose real id isn't in that seed (A4 = ns_23,
// Champro = ns_49) fell back to the raw id ('ns_49'), matched nothing, and silently
// lost its "Add to Batch" button. The original batch vendors all happen to have
// v1–v8 ids, which is why this went unnoticed.
import fs from 'fs';
import path from 'path';
import { BATCH_VENDORS, BATCH_NOTIFY_VENDORS, D_V } from '../constants';

// The real vendors table rows these keys are meant to match (ids are production values).
const DB_VENDORS = [
  { id: 'v4', name: 'S&S Activewear' },
  { id: 'v3', name: 'SanMar' },
  { id: 'v5', name: 'Richardson' },
  { id: 'v8', name: 'Momentec' },
  { id: 'ns_23', name: 'A4' },
  { id: 'ns_49', name: 'Champro' },
  { id: 'v1', name: 'Adidas' },
  { id: 'v2', name: 'Under Armour' },
  // Near-misses that must NOT be swept into a batch queue.
  { id: 'ns_48', name: 'Champion' },
  { id: 'ns_3839', name: 'S&S Seating Inc.' },
  { id: 'v6', name: 'Rawlings' },
  { id: 'v7', name: 'Badger' },
];

// The vendor-name → batch-key matcher, verbatim from OrderEditor.js.
const batchKeyFor = (vn, showPO) => Object.keys(BATCH_VENDORS).find((k) => {
  const bvName = BATCH_VENDORS[k].name.toLowerCase();
  const vnL = vn.toLowerCase();
  return vnL === bvName || vnL.includes(k) || showPO.toLowerCase().includes(k);
});

// How the PO modal resolves the vendor name: DB-loaded vendors first, seed as fallback.
const resolveName = (vendorList, showPO) =>
  vendorList.find((v) => v.id === showPO)?.name || D_V.find((v) => v.id === showPO)?.name || showPO;

describe('BATCH_VENDORS registry', () => {
  test('Champro is batch-eligible at the $200 free-ship threshold', () => {
    expect(BATCH_VENDORS.champro).toEqual({ name: 'Champro', threshold: 200 });
  });

  test('Champro pops the batch-ready prompt', () => {
    expect(BATCH_NOTIFY_VENDORS).toContain('champro');
  });
});

describe('batch eligibility for DB-only vendors', () => {
  test.each([
    ['Champro', 'ns_49', 'champro'],
    ['A4', 'ns_23', 'a4'],
  ])('%s (%s) resolves to the %s batch queue', (name, id, key) => {
    expect(batchKeyFor(resolveName(DB_VENDORS, id), id)).toBe(key);
  });

  test('resolving from the D_V seed alone loses them — the bug this guards', () => {
    // Neither id exists in the v1–v8 seed, so the name falls back to the raw id.
    expect(D_V.find((v) => v.id === 'ns_49')).toBeUndefined();
    expect(batchKeyFor('ns_49', 'ns_49')).toBeUndefined();
    expect(batchKeyFor('ns_23', 'ns_23')).toBeUndefined();
  });

  test('every BATCH_VENDORS key is reachable from a real vendor row', () => {
    const reached = new Set(DB_VENDORS.map((v) => batchKeyFor(resolveName(DB_VENDORS, v.id), v.id)));
    Object.keys(BATCH_VENDORS).forEach((k) => expect(reached).toContain(k));
  });

  test('Champion, S&S Seating, Rawlings and Badger stay out of every batch queue', () => {
    ['ns_48', 'ns_3839', 'v6', 'v7'].forEach((id) => {
      expect(batchKeyFor(resolveName(DB_VENDORS, id), id)).toBeUndefined();
    });
  });
});

// Source-level guard: the fix is a one-token change that a future edit could quietly revert,
// and the symptom (a missing button for two vendors) is easy to miss in review.
describe('the PO modal resolves vendor names from the DB list, not the seed', () => {
  test.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const line = src.split('\n').find((l) => l.includes('const vItems=vendorMap[showPO]'));
    expect(line).toBeDefined();
    expect(line).toContain('vendorList.find(v=>v.id===showPO)');
    // vendorList must come first — D_V may only be the fallback.
    expect(line.indexOf('vendorList.find')).toBeLessThan(line.indexOf('D_V.find'));
  });
});
