// ═══════════════════════════════════════════════
// PRICING DRIFT GUARD
// The pricing tables/primitives exist in several places by design:
//   src/lib/decoPricing.js — the single source of truth (CJS, shared with the
//                            Netlify quickorder-quote function via included_files)
//   src/pricing.js         — thin client layer over decoPricing (adds the localStorage
//                            override merge; OrderEditor & App.js import from it)
//   src/App.js             — a local copy (line ~1570) used by App-internal closures
//   src/businessLogic.js   — the CommonJS test mirror (must stay dependency-free; see its
//                            "no spread syntax" note for why it can't just import pricing.js)
// These have drifted before: businessLogic.js carried a pre-_v:4 embroidery cost table for
// months, so passing tests validated prices production didn't use (FABLE_SYSTEM_AUDIT_2026-07-03).
// This suite fails loudly the moment any copy diverges again.
// ═══════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { SP as P_SP, EM as P_EM, NP as P_NP, DTF as P_DTF, spP as p_spP, emP as p_emP, npP as p_npP } from '../pricing';

const BL = require('../businessLogic');
const DP = require('../lib/decoPricing');

const stripV = (o) => {
  const c = JSON.parse(JSON.stringify(o));
  delete c._v;
  return c;
};

describe('pricing tables agree between pricing.js and businessLogic.js', () => {
  test('EM (embroidery) tables are identical', () => {
    expect(stripV(BL.EM)).toEqual(stripV(P_EM));
  });
  test('SP (screen print) tables are identical', () => {
    expect(stripV(BL.SP)).toEqual(stripV(P_SP));
  });
  test('NP (numbers) tables are identical', () => {
    expect(BL.NP).toEqual(P_NP);
  });
  test('DTF tables are identical', () => {
    expect(BL.DTF).toEqual(P_DTF);
  });
});

describe('pricing primitives agree between pricing.js and businessLogic.js', () => {
  // Grids chosen to hit every bracket boundary from both sides, plus out-of-range.
  const QTYS = [1, 5, 11, 12, 23, 24, 35, 36, 47, 48, 71, 72, 107, 108, 143, 144, 215, 216, 499, 500, 1000, 99999];
  const STITCHES = [1, 5000, 8000, 10000, 10001, 12000, 15000, 15001, 18000, 20000, 20001, 50000, 999999];
  const EM_QTYS = [1, 6, 7, 24, 25, 48, 49, 100, 99999];

  test('spP matches for every bracket x colors x sell/cost', () => {
    for (const q of QTYS) {
      for (let c = 0; c <= 6; c++) {
        for (const s of [true, false]) {
          expect(BL.spP(q, c, s)).toBe(p_spP(q, c, s));
        }
      }
    }
  });

  test('emP matches for every stitch bracket x qty bracket x sell/cost', () => {
    for (const st of STITCHES) {
      for (const q of EM_QTYS) {
        for (const s of [true, false]) {
          expect(BL.emP(st, q, s)).toBe(p_emP(st, q, s));
        }
      }
    }
  });

  test('npP matches for every qty bracket x two-color x sell/cost', () => {
    for (const q of [1, 10, 11, 50, 51, 99999, 100000]) {
      for (const tw of [true, false]) {
        for (const s of [true, false]) {
          expect(BL.npP(q, tw, s)).toBe(p_npP(q, tw, s));
        }
      }
    }
  });
});

describe('decoPricing.js (shared client/server source of truth) matches businessLogic.js', () => {
  test('tables are identical', () => {
    expect(stripV(BL.SP)).toEqual(stripV(DP.SP));
    expect(stripV(BL.EM)).toEqual(stripV(DP.EM));
    expect(BL.NP).toEqual(DP.NP);
    expect(BL.DTF).toEqual(DP.DTF);
  });

  test('primitives agree at the defaults across all brackets', () => {
    const T = DP.DEFAULTS;
    for (const q of [1, 11, 12, 47, 48, 143, 144, 499, 500, 99999, 100000]) {
      for (let c = 0; c <= 6; c++) {
        for (const s of [true, false]) expect(DP.spP(T, q, c, s)).toBe(BL.spP(q, c, s));
      }
    }
    for (const st of [1, 8000, 10001, 15001, 20001, 999999]) {
      for (const q of [1, 6, 7, 24, 25, 48, 49, 99999]) {
        for (const s of [true, false]) expect(DP.emP(T, st, q, s)).toBe(BL.emP(st, q, s));
      }
    }
    for (const q of [1, 10, 11, 50, 51, 99999, 100000]) {
      for (const tw of [true, false]) {
        for (const s of [true, false]) expect(DP.npP(T, q, tw, s)).toBe(BL.npP(q, tw, s));
      }
    }
  });
});

describe('pricing.js re-exports the decoPricing defaults (no overrides in test env)', () => {
  test('tables are the decoPricing defaults', () => {
    expect(P_SP).toEqual(DP.SP);
    expect(P_EM).toEqual(DP.EM);
    expect(P_NP).toEqual(DP.NP);
    expect(P_DTF).toEqual(DP.DTF);
  });
});

describe('App.js local pricing tables match decoPricing.js', () => {
  // App.js can't be imported here (it's the app root with side effects), so compare the
  // source text of its `let SP=...;` / `let EM=...;` lines against decoPricing.js's —
  // the two files intentionally keep these lines byte-identical after the declaration prefix.
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  const decoSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'decoPricing.js'), 'utf8');
  const grab = (src, name, prefix) => {
    const re = new RegExp('^' + prefix + name + '=(\\{.*?\\});', 'm');
    const m = src.match(re);
    return m && m[1];
  };

  test('EM literal in App.js equals EM literal in decoPricing.js', () => {
    const app = grab(appSrc, 'EM', 'let ');
    const deco = grab(decoSrc, 'EM', 'const ');
    expect(app).toBeTruthy();
    expect(deco).toBeTruthy();
    expect(app).toBe(deco);
  });

  test('SP literal in App.js equals SP literal in decoPricing.js', () => {
    const app = grab(appSrc, 'SP', 'let ');
    const deco = grab(decoSrc, 'SP', 'const ');
    expect(app).toBeTruthy();
    expect(deco).toBeTruthy();
    expect(app).toBe(deco);
  });
});
