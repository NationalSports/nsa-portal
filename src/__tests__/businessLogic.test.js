/* eslint-disable */
/**
 * NSA Portal — Automated Business Logic Tests
 *
 * SAFE: These tests ONLY test pure functions from businessLogic.js
 * - No Supabase calls, no database reads/writes
 * - No UI rendering, no DOM manipulation
 * - No external API calls
 * - Zero impact on production data or portal performance
 *
 * Run: npm test
 * Run with report: npm run test:report
 */

const BL = require('../businessLogic');

// ═══════════════════════════════════════════════
// 1. SAFE ACCESSORS
// ═══════════════════════════════════════════════
describe('Safe Accessors', () => {
  test('safe() returns value when present, default when null/undefined', () => {
    expect(BL.safe('hello', 'default')).toBe('hello');
    expect(BL.safe(0, 'default')).toBe(0);
    expect(BL.safe(false, 'default')).toBe(false);
    expect(BL.safe(null, 'default')).toBe('default');
    expect(BL.safe(undefined, 'default')).toBe('default');
  });

  test('safeArr() returns array or empty array', () => {
    expect(BL.safeArr([1, 2])).toEqual([1, 2]);
    expect(BL.safeArr(null)).toEqual([]);
    expect(BL.safeArr(undefined)).toEqual([]);
    expect(BL.safeArr('string')).toEqual([]);
    expect(BL.safeArr({})).toEqual([]);
  });

  test('safeObj() returns object or empty object', () => {
    expect(BL.safeObj({ a: 1 })).toEqual({ a: 1 });
    expect(BL.safeObj(null)).toEqual({});
    expect(BL.safeObj(undefined)).toEqual({});
    expect(BL.safeObj([])).toEqual({});
    expect(BL.safeObj('string')).toEqual({});
  });

  test('safeNum() returns number or 0', () => {
    expect(BL.safeNum(42)).toBe(42);
    expect(BL.safeNum(0)).toBe(0);
    expect(BL.safeNum(-5)).toBe(-5);
    expect(BL.safeNum(3.14)).toBe(3.14);
    expect(BL.safeNum(null)).toBe(0);
    expect(BL.safeNum(undefined)).toBe(0);
    expect(BL.safeNum('5')).toBe(0);
    expect(BL.safeNum(NaN)).toBe(0);
  });

  test('safeStr() returns string or empty string', () => {
    expect(BL.safeStr('hello')).toBe('hello');
    expect(BL.safeStr('')).toBe('');
    expect(BL.safeStr(null)).toBe('');
    expect(BL.safeStr(undefined)).toBe('');
    expect(BL.safeStr(42)).toBe('');
  });

  test('safeSizes() extracts sizes object from item', () => {
    expect(BL.safeSizes({ sizes: { S: 2, M: 3 } })).toEqual({ S: 2, M: 3 });
    expect(BL.safeSizes({})).toEqual({});
    expect(BL.safeSizes(null)).toEqual({});
  });

  test('safePicks() extracts pick_lines array from item', () => {
    expect(BL.safePicks({ pick_lines: [{ S: 1 }] })).toEqual([{ S: 1 }]);
    expect(BL.safePicks({})).toEqual([]);
    expect(BL.safePicks(null)).toEqual([]);
  });

  test('safePOs() extracts po_lines array from item', () => {
    expect(BL.safePOs({ po_lines: [{ S: 5 }] })).toEqual([{ S: 5 }]);
    expect(BL.safePOs({})).toEqual([]);
  });

  test('safeDecos() extracts decorations array from item', () => {
    expect(BL.safeDecos({ decorations: [{ kind: 'art' }] })).toEqual([{ kind: 'art' }]);
    expect(BL.safeDecos({})).toEqual([]);
  });

  test('safeItems() extracts items array from order', () => {
    expect(BL.safeItems({ items: [{ sku: 'A' }] })).toEqual([{ sku: 'A' }]);
    expect(BL.safeItems({})).toEqual([]);
  });

  test('safeArt() extracts art_files array from order', () => {
    expect(BL.safeArt({ art_files: [{ id: '1' }] })).toEqual([{ id: '1' }]);
    expect(BL.safeArt({})).toEqual([]);
  });

  test('safeJobs() extracts jobs array from order', () => {
    expect(BL.safeJobs({ jobs: [{ id: 'J1' }] })).toEqual([{ id: 'J1' }]);
    expect(BL.safeJobs({})).toEqual([]);
  });
});

// ═══════════════════════════════════════════════
// 2. ROUNDING HELPERS
// ═══════════════════════════════════════════════
describe('Rounding Helpers', () => {
  test('rQ() rounds to nearest quarter', () => {
    expect(BL.rQ(1.1)).toBe(1);
    expect(BL.rQ(1.13)).toBe(1.25);
    expect(BL.rQ(1.3)).toBe(1.25);
    expect(BL.rQ(1.4)).toBe(1.5);
    expect(BL.rQ(1.6)).toBe(1.5);
    expect(BL.rQ(1.9)).toBe(2);
    expect(BL.rQ(0)).toBe(0);
  });

  test('rT() rounds to nearest tenth', () => {
    expect(BL.rT(1.14)).toBe(1.1);
    expect(BL.rT(1.15)).toBe(1.2);
    expect(BL.rT(1.25)).toBe(1.3);
    expect(BL.rT(0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 3. SCREEN PRINT PRICING — spP()
// ═══════════════════════════════════════════════
describe('Screen Print Pricing — spP()', () => {
  test('returns sell price for valid qty/color combos', () => {
    // Bracket 0 (qty 1-11) stores sell directly (flat total price)
    expect(BL.spP(1, 1)).toBe(50);
    expect(BL.spP(5, 1)).toBe(50);
    expect(BL.spP(11, 1)).toBe(50);
    // Brackets 1+ store cost; sell = rT(cost * markup)
    // 1 color, qty 12-23: cost 5 → sell 7.5
    expect(BL.spP(12, 1)).toBe(BL.rT(5 * BL.SP.mk));
    expect(BL.spP(23, 1)).toBe(BL.rT(5 * BL.SP.mk));
    // 2 colors, qty 24-35: cost 4.5 → sell 6.8
    expect(BL.spP(24, 2)).toBe(BL.rT(4.5 * BL.SP.mk));
  });

  test('returns cost price when sell=false', () => {
    // Brackets 1+: stored value IS the cost
    expect(BL.spP(48, 1, false)).toBe(BL.SP.pr[4][0]);
    // Bracket 0 (under-12): cost = sell / markup
    expect(BL.spP(5, 1, false)).toBe(BL.rQ(BL.SP.pr[0][0] / BL.SP.mk));
  });

  test('returns 0 for invalid inputs', () => {
    expect(BL.spP(0, 1)).toBe(0); // qty 0 — no bracket
    expect(BL.spP(50, 0)).toBe(0); // 0 colors
    expect(BL.spP(50, 6)).toBe(0); // 6 colors (max is 5)
    expect(BL.spP(-1, 1)).toBe(0); // negative qty
  });

  test('returns null-based price as 0 for small qty + high colors', () => {
    // Bracket 0 (qty 1-11), colors 4 and 5 are null in the matrix
    expect(BL.spP(5, 4)).toBe(0);
    expect(BL.spP(5, 5)).toBe(0);
  });

  test('high quantity brackets return lower prices', () => {
    const price50 = BL.spP(50, 1);   // bracket 4
    const price200 = BL.spP(200, 1);  // bracket 7
    const price500 = BL.spP(500, 1);  // bracket 9
    expect(price50).toBeGreaterThan(price200);
    expect(price200).toBeGreaterThan(price500);
  });

  test('more colors = higher price at same quantity', () => {
    const c1 = BL.spP(48, 1);
    const c2 = BL.spP(48, 2);
    const c3 = BL.spP(48, 3);
    expect(c1).toBeLessThan(c2);
    expect(c2).toBeLessThan(c3);
  });
});

// ═══════════════════════════════════════════════
// 4. EMBROIDERY PRICING — emP()
// ═══════════════════════════════════════════════
describe('Embroidery Pricing — emP()', () => {
  test('returns sell price for valid stitch/qty combos', () => {
    // EM.pr stores cost; sell = rT(cost * markup)
    // ≤10000 stitches, ≤6 qty: cost 8 → sell = rT(8 * 1.6)
    expect(BL.emP(8000, 6)).toBe(BL.rT(8 * BL.EM.mk));
    // ≤15000 stitches, ≤24 qty: cost 8.5 → sell = rT(8.5 * 1.6)
    expect(BL.emP(12000, 20)).toBe(BL.rT(8.5 * BL.EM.mk));
  });

  test('returns cost price when sell=false', () => {
    // Stored value IS the cost
    expect(BL.emP(8000, 6, false)).toBe(BL.EM.pr[0][0]);
  });

  test('higher stitches cost more', () => {
    const low = BL.emP(8000, 10);
    const high = BL.emP(18000, 10);
    expect(high).toBeGreaterThan(low);
  });

  test('higher quantity lowers price', () => {
    const small = BL.emP(8000, 5);
    const large = BL.emP(8000, 100);
    expect(small).toBeGreaterThanOrEqual(large);
  });
});

// ═══════════════════════════════════════════════
// 5. NUMBER PRESS PRICING — npP()
// ═══════════════════════════════════════════════
describe('Number Press Pricing — npP()', () => {
  test('returns sell price by quantity brackets', () => {
    // ≤10 → NP.se[0] = 7
    expect(BL.npP(5)).toBe(7);
    expect(BL.npP(10)).toBe(7);
    // ≤50 → NP.se[1] = 6
    expect(BL.npP(25)).toBe(6);
    // >50 → NP.se[2] = 5
    expect(BL.npP(100)).toBe(5);
  });

  test('two-color adds surcharge', () => {
    const one = BL.npP(5, false);
    const two = BL.npP(5, true);
    expect(two).toBeGreaterThan(one);
  });

  test('returns cost when sell=false', () => {
    // ≤10 → NP.co[0] = 4
    expect(BL.npP(5, false, false)).toBe(4);
    expect(BL.npP(25, false, false)).toBe(3);
  });

  test('two-color cost includes tc surcharge', () => {
    const oneColor = BL.npP(5, false, false);
    const twoColor = BL.npP(5, true, false);
    expect(twoColor).toBe(oneColor + BL.NP.tc);
  });
});

// ═══════════════════════════════════════════════
// 6. DTF PRICING
// ═══════════════════════════════════════════════
describe('DTF Pricing Constants', () => {
  test('DTF has two size tiers', () => {
    expect(BL.DTF).toHaveLength(2);
  });

  test('DTF[0] is 4" sq & under', () => {
    expect(BL.DTF[0].cost).toBe(2.5);
    expect(BL.DTF[0].sell).toBe(4.5);
  });

  test('DTF[1] is front chest 12"x4"', () => {
    expect(BL.DTF[1].cost).toBe(4.5);
    expect(BL.DTF[1].sell).toBe(7.5);
  });

  test('sell is always greater than cost', () => {
    BL.DTF.forEach(t => {
      expect(t.sell).toBeGreaterThan(t.cost);
    });
  });
});

// ═══════════════════════════════════════════════
// 7. DECORATION PRICING — dP() (master dispatcher)
// ═══════════════════════════════════════════════
describe('Decoration Pricing — dP()', () => {
  test('screen_print decoration by type', () => {
    const d = { type: 'screen_print', colors: 2 };
    const result = BL.dP(d, 48, []);
    expect(result.sell).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.sell).toBeGreaterThan(result.cost);
  });

  test('embroidery decoration by type', () => {
    const d = { type: 'embroidery', stitches: 10000 };
    const result = BL.dP(d, 24, []);
    expect(result.sell).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
  });

  test('dtf decoration by type', () => {
    const d = { type: 'dtf', dtf_size: 0 };
    const result = BL.dP(d, 48, []);
    expect(result.sell).toBe(4.5);
    expect(result.cost).toBe(2.5);
  });

  test('number_press decoration by type', () => {
    const d = { type: 'number_press', roster: { S: ['1', '2'], M: ['3'] } };
    const result = BL.dP(d, 10, []);
    expect(result.sell).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
    expect(result._nq).toBe(3); // 3 names in roster
  });

  test('numbers kind decoration', () => {
    const d = { kind: 'numbers', roster: { S: ['10', '20'], M: ['30'] }, two_color: false };
    const result = BL.dP(d, 10, []);
    expect(result._nq).toBe(3);
    expect(result.sell).toBeGreaterThan(0);
  });

  test('names kind decoration', () => {
    const d = { kind: 'names', names: { S: ['John', 'Jane'], M: ['Bob'] }, sell_each: 6, cost_each: 3 };
    const result = BL.dP(d, 10, []);
    expect(result.sell).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
  });

  test('outside_deco kind uses sell_override and cost_each', () => {
    const d = { kind: 'outside_deco', sell_override: 10, sell_each: 8, cost_each: 5 };
    const result = BL.dP(d, 24, []);
    expect(result.sell).toBe(10);
    expect(result.cost).toBe(5);
  });

  test('art kind with TBD screen_print', () => {
    const d = { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print', tbd_colors: 2, underbase: false };
    const result = BL.dP(d, 48, []);
    expect(result.sell).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
  });

  test('art kind with TBD embroidery', () => {
    const d = { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'embroidery', tbd_stitches: 12000 };
    const result = BL.dP(d, 24, []);
    expect(result.sell).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
  });

  test('art kind with TBD dtf', () => {
    const d = { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'dtf', tbd_dtf_size: 1 };
    const result = BL.dP(d, 48, []);
    expect(result.sell).toBe(7.5);
    expect(result.cost).toBe(4.5);
  });

  test('art kind with real art file — screen_print', () => {
    const artFiles = [{ id: 'art1', deco_type: 'screen_print', ink_colors: 'Red\nBlue\nGreen' }];
    const d = { kind: 'art', art_file_id: 'art1' };
    const result = BL.dP(d, 48, artFiles);
    expect(result.sell).toBeGreaterThan(0);
    // 3 colors at qty 48
  });

  test('art kind with real art file — embroidery', () => {
    const artFiles = [{ id: 'art2', deco_type: 'embroidery', stitches: 15000 }];
    const d = { kind: 'art', art_file_id: 'art2' };
    const result = BL.dP(d, 24, artFiles);
    expect(result.sell).toBeGreaterThan(0);
  });

  test('art kind with missing art file returns 0', () => {
    const d = { kind: 'art', art_file_id: 'missing' };
    const result = BL.dP(d, 48, []);
    expect(result.sell).toBe(0);
    expect(result.cost).toBe(0);
  });

  test('underbase adds surcharge to screen_print', () => {
    const noUb = BL.dP({ type: 'screen_print', colors: 2 }, 48, []);
    const withUb = BL.dP({ type: 'screen_print', colors: 2, underbase: true }, 48, []);
    expect(withUb.cost).toBeGreaterThan(noUb.cost);
    expect(withUb.sell).toBeGreaterThan(noUb.sell);
  });

  test('unknown decoration type returns 0', () => {
    const result = BL.dP({ type: 'laser_engraving' }, 48, []);
    expect(result.sell).toBe(0);
    expect(result.cost).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 8. PO COMMITTED — poCommitted()
// ═══════════════════════════════════════════════
describe('PO Committed — poCommitted()', () => {
  test('sums quantity for a given size across PO lines', () => {
    const poLines = [{ S: 10, M: 5 }, { S: 3, M: 2 }];
    expect(BL.poCommitted(poLines, 'S')).toBe(13);
    expect(BL.poCommitted(poLines, 'M')).toBe(7);
  });

  test('subtracts cancelled quantities', () => {
    const poLines = [{ S: 10, cancelled: { S: 3 } }];
    expect(BL.poCommitted(poLines, 'S')).toBe(7);
  });

  test('handles null/empty PO lines', () => {
    expect(BL.poCommitted(null, 'S')).toBe(0);
    expect(BL.poCommitted([], 'S')).toBe(0);
  });

  test('returns 0 for unknown size', () => {
    const poLines = [{ S: 10 }];
    expect(BL.poCommitted(poLines, 'XXL')).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 9. SO STATUS CALCULATION — calcSOStatus()
// ═══════════════════════════════════════════════
describe('SO Status Calculation — calcSOStatus()', () => {
  test('empty order returns need_order', () => {
    expect(BL.calcSOStatus({})).toBe('need_order');
    expect(BL.calcSOStatus({ items: [] })).toBe('need_order');
  });

  test('items with no coverage return need_order', () => {
    const ord = {
      items: [{ sizes: { S: 10 }, pick_lines: [], po_lines: [], decorations: [] }],
      jobs: []
    };
    expect(BL.calcSOStatus(ord)).toBe('need_order');
  });

  test('fully picked items with no decos or jobs → ready_to_invoice', () => {
    const ord = {
      items: [{
        sizes: { S: 10 },
        pick_lines: [{ S: 10, status: 'pulled' }],
        po_lines: [],
        decorations: [],
        no_deco: true
      }],
      jobs: []
    };
    expect(BL.calcSOStatus(ord)).toBe('ready_to_invoice');
  });

  test('all jobs shipped → complete', () => {
    const ord = {
      items: [{ sizes: { S: 10 }, pick_lines: [{ S: 10, status: 'pulled' }], po_lines: [], decorations: [{ kind: 'art', art_file_id: 'a1' }] }],
      jobs: [{ prod_status: 'shipped' }]
    };
    expect(BL.calcSOStatus(ord)).toBe('complete');
  });

  test('all jobs completed → ready_to_invoice', () => {
    const ord = {
      items: [{ sizes: { S: 10 }, pick_lines: [{ S: 10, status: 'pulled' }], po_lines: [], decorations: [{ kind: 'art', art_file_id: 'a1' }] }],
      jobs: [{ prod_status: 'completed' }]
    };
    expect(BL.calcSOStatus(ord)).toBe('ready_to_invoice');
  });

  test('active jobs → in_production', () => {
    const ord = {
      items: [{ sizes: { S: 10 }, pick_lines: [{ S: 10, status: 'pulled' }], po_lines: [], decorations: [{ kind: 'art', art_file_id: 'a1' }] }],
      jobs: [{ prod_status: 'in_process' }]
    };
    expect(BL.calcSOStatus(ord)).toBe('in_production');
  });

  test('covered but not fulfilled → waiting_receive', () => {
    const ord = {
      items: [{
        sizes: { S: 10 },
        pick_lines: [],
        po_lines: [{ S: 10 }], // ordered but not received
        decorations: []
      }],
      jobs: []
    };
    expect(BL.calcSOStatus(ord)).toBe('waiting_receive');
  });

  test('all items fulfilled (picked+received) → items_received', () => {
    const ord = {
      items: [{
        sizes: { S: 10 },
        pick_lines: [{ S: 5, status: 'pulled' }],
        po_lines: [{ S: 5, received: { S: 5 } }],
        decorations: [{ kind: 'art', art_file_id: 'a1' }]
      }],
      jobs: [{ prod_status: 'hold' }]
    };
    expect(BL.calcSOStatus(ord)).toBe('items_received');
  });

  test('mixed job statuses — some shipped, some active → in_production', () => {
    const ord = {
      items: [{ sizes: { S: 10 }, pick_lines: [{ S: 10, status: 'pulled' }], po_lines: [], decorations: [{ kind: 'art' }] }],
      jobs: [{ prod_status: 'shipped' }, { prod_status: 'staging' }]
    };
    expect(BL.calcSOStatus(ord)).toBe('in_production');
  });
});

// ═══════════════════════════════════════════════
// 10. JOB BUILDING — buildJobs()
// ═══════════════════════════════════════════════
describe('Job Building — buildJobs()', () => {
  test('returns existing jobs if already present', () => {
    const o = { jobs: [{ id: 'J1' }] };
    expect(BL.buildJobs(o)).toEqual([{ id: 'J1' }]);
  });

  test('skips items with no_deco flag', () => {
    const o = {
      id: 'SO-100',
      items: [{ no_deco: true, sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1' }] }],
      art_files: []
    };
    expect(BL.buildJobs(o)).toEqual([]);
  });

  test('groups items by decoration signature', () => {
    const o = {
      id: 'SO-100',
      items: [
        { sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] },
        { sizes: { M: 10 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] },
        { sizes: { L: 3 }, decorations: [{ kind: 'art', art_file_id: 'a2', position: 'back' }] }
      ],
      art_files: [
        { id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'approved', prod_files: ['f1'] },
        { id: 'a2', name: 'Back Text', deco_type: 'embroidery', status: 'needs_approval' }
      ]
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(2);
    // First job should have 2 items (same a1+front signature)
    expect(jobs[0].items).toHaveLength(2);
    expect(jobs[0].total_units).toBe(15);
    // Second job should have 1 item
    expect(jobs[1].items).toHaveLength(1);
    expect(jobs[1].total_units).toBe(3);
  });

  test('job IDs follow SO-based naming convention', () => {
    const o = {
      id: 'SO-100',
      items: [{ sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] }],
      art_files: [{ id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'approved', prod_files: ['f1'] }]
    };
    const jobs = BL.buildJobs(o);
    expect(jobs[0].id).toBe('JOB-100-01');
  });

  test('art_status reflects worst status across art files', () => {
    const o = {
      id: 'SO-100',
      items: [{ sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] }],
      art_files: [{ id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'uploaded' }]
    };
    const jobs = BL.buildJobs(o);
    expect(jobs[0].art_status).toBe('waiting_approval');
  });

  test('items with no decorations produce no jobs', () => {
    const o = {
      id: 'SO-100',
      items: [{ sizes: { S: 5 }, decorations: [] }],
      art_files: []
    };
    expect(BL.buildJobs(o)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════
// 11. JOB READINESS — isJobReady()
// ═══════════════════════════════════════════════
describe('Job Readiness — isJobReady()', () => {
  test('not ready if art_status != art_complete', () => {
    const j = { art_status: 'needs_art', art_file_id: 'a1', items: [] };
    expect(BL.isJobReady(j, {})).toBe(false);
  });

  test('not ready if art file has no prod_files', () => {
    const j = { art_status: 'art_complete', art_file_id: 'a1', items: [{ item_idx: 0 }] };
    const o = {
      items: [{ sizes: { S: 5 }, pick_lines: [{ S: 5, status: 'pulled' }], po_lines: [] }],
      art_files: [{ id: 'a1', prod_files: [] }]
    };
    expect(BL.isJobReady(j, o)).toBe(false);
  });

  test('ready when art complete + prod files + items fulfilled', () => {
    const j = { art_status: 'art_complete', art_file_id: 'a1', items: [{ item_idx: 0 }] };
    const o = {
      items: [{ sizes: { S: 5 }, pick_lines: [{ S: 5, status: 'pulled' }], po_lines: [] }],
      art_files: [{ id: 'a1', prod_files: ['separation.ai'] }]
    };
    expect(BL.isJobReady(j, o)).toBe(true);
  });

  test('not ready if items not fully fulfilled', () => {
    const j = { art_status: 'art_complete', art_file_id: 'a1', items: [{ item_idx: 0 }] };
    const o = {
      items: [{ sizes: { S: 10 }, pick_lines: [{ S: 3, status: 'pulled' }], po_lines: [] }],
      art_files: [{ id: 'a1', prod_files: ['sep.ai'] }]
    };
    expect(BL.isJobReady(j, o)).toBe(false);
  });

  test('fulfilled via PO received counts', () => {
    const j = { art_status: 'art_complete', art_file_id: 'a1', items: [{ item_idx: 0 }] };
    const o = {
      items: [{ sizes: { S: 10 }, pick_lines: [], po_lines: [{ S: 10, received: { S: 10 } }] }],
      art_files: [{ id: 'a1', prod_files: ['sep.ai'] }]
    };
    expect(BL.isJobReady(j, o)).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 12. TOTALS CALCULATION — calcTotals()
// ═══════════════════════════════════════════════
describe('Totals Calculation — calcTotals()', () => {
  test('empty order returns all zeros', () => {
    const result = BL.calcTotals({}, {});
    expect(result.rev).toBe(0);
    expect(result.cost).toBe(0);
    expect(result.ship).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.grand).toBe(0);
    expect(result.margin).toBe(0);
    expect(result.pct).toBe(0);
  });

  test('calculates revenue and cost for simple items', () => {
    const o = {
      items: [{ sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] }],
      art_files: []
    };
    const result = BL.calcTotals(o, {});
    expect(result.rev).toBe(200);   // 10 * 20
    expect(result.cost).toBe(80);    // 10 * 8
    expect(result.margin).toBe(120); // 200 - 80
  });

  test('includes decoration pricing in totals', () => {
    const o = {
      items: [{
        sizes: { S: 48 }, unit_sell: 20, nsa_cost: 8,
        decorations: [{ type: 'screen_print', colors: 1 }]
      }],
      art_files: []
    };
    const result = BL.calcTotals(o, {});
    expect(result.rev).toBeGreaterThan(48 * 20); // base + deco
    expect(result.cost).toBeGreaterThan(48 * 8);
  });

  test('calculates flat shipping', () => {
    const o = {
      items: [{ sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] }],
      art_files: [],
      shipping_type: 'flat',
      shipping_value: 15
    };
    const result = BL.calcTotals(o, {});
    expect(result.ship).toBe(15);
  });

  test('calculates percentage shipping', () => {
    const o = {
      items: [{ sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] }],
      art_files: [],
      shipping_type: 'pct',
      shipping_value: 10 // 10%
    };
    const result = BL.calcTotals(o, {});
    expect(result.ship).toBe(20); // 10% of 200
  });

  test('calculates tax based on customer rate', () => {
    const o = {
      items: [{ sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] }],
      art_files: []
    };
    const cust = { tax_rate: 0.07 };
    const result = BL.calcTotals(o, cust);
    expect(result.tax).toBeCloseTo(14, 1); // 7% of 200
  });

  test('grand total = rev + ship + tax', () => {
    const o = {
      items: [{ sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] }],
      art_files: [],
      shipping_type: 'flat',
      shipping_value: 15
    };
    const cust = { tax_rate: 0.07 };
    const result = BL.calcTotals(o, cust);
    expect(result.grand).toBeCloseTo(result.rev + result.ship + result.tax, 2);
  });

  test('margin percentage calculated correctly', () => {
    const o = {
      items: [{ sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] }],
      art_files: []
    };
    const result = BL.calcTotals(o, {});
    expect(result.pct).toBeCloseTo(60, 0); // (200-80)/200 * 100 = 60%
  });

  test('handles multiple items', () => {
    const o = {
      items: [
        { sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] },
        { sizes: { M: 5, L: 5 }, unit_sell: 30, nsa_cost: 12, decorations: [] }
      ],
      art_files: []
    };
    const result = BL.calcTotals(o, {});
    expect(result.rev).toBe(500);   // (10*20) + (10*30)
    expect(result.cost).toBe(200);   // (10*8) + (10*12)
  });

  test('items with zero quantity are skipped', () => {
    const o = {
      items: [
        { sizes: { S: 0 }, unit_sell: 20, nsa_cost: 8, decorations: [] },
        { sizes: {}, unit_sell: 30, nsa_cost: 12, decorations: [] }
      ],
      art_files: []
    };
    const result = BL.calcTotals(o, {});
    expect(result.rev).toBe(0);
    expect(result.cost).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 13. INVOICE CREATION — createInvoice()
// ═══════════════════════════════════════════════
describe('Invoice Creation — createInvoice()', () => {
  const baseOrder = {
    items: [
      { sku: 'TSH-100', name: 'Basic Tee', color: 'Red', sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] },
      { sku: 'TSH-200', name: 'Premium Tee', color: 'Blue', sizes: { M: 5 }, unit_sell: 30, nsa_cost: 12, decorations: [] }
    ],
    art_files: [],
    shipping_type: 'flat',
    shipping_value: 15
  };
  const cust = { tax_rate: 0.07 };

  test('creates invoice for selected items', () => {
    const inv = BL.createInvoice(baseOrder, [0], cust, {});
    expect(inv.lineItems).toHaveLength(1);
    expect(inv.lineItems[0].desc).toContain('TSH-100');
    expect(inv.lineItems[0].qty).toBe(10);
    expect(inv.lineItems[0].rate).toBe(20);
    expect(inv.lineItems[0].amount).toBe(200);
  });

  test('includes shipping and tax when all items selected', () => {
    const inv = BL.createInvoice(baseOrder, [0, 1], cust, {});
    expect(inv.ship).toBe(15);
    expect(inv.tax).toBeGreaterThan(0);
  });

  test('no shipping/tax for partial invoice', () => {
    const inv = BL.createInvoice(baseOrder, [0], cust, {});
    expect(inv.ship).toBe(0);
    expect(inv.tax).toBe(0);
  });

  test('total equals subtotal + ship + tax', () => {
    const inv = BL.createInvoice(baseOrder, [0, 1], cust, {});
    expect(inv.total).toBeCloseTo(inv.selTotals.subtotal + inv.ship + inv.tax, 2);
  });

  test('handles empty selection', () => {
    const inv = BL.createInvoice(baseOrder, [], cust, {});
    expect(inv.lineItems).toHaveLength(0);
    expect(inv.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 14. PROMO DOLLARS
// ═══════════════════════════════════════════════
describe('Promo Dollars', () => {
  describe('calcPromoItemSell()', () => {
    test('returns retail_price when available', () => {
      expect(BL.calcPromoItemSell({ retail_price: 30, nsa_cost: 8 })).toBe(30);
    });

    test('returns nsa_cost * 2 when no retail_price', () => {
      expect(BL.calcPromoItemSell({ retail_price: 0, nsa_cost: 8 })).toBe(16);
      expect(BL.calcPromoItemSell({ nsa_cost: 10 })).toBe(20);
    });

    test('handles null/undefined gracefully', () => {
      expect(BL.calcPromoItemSell({})).toBe(0);
    });
  });

  describe('calcPromoTotals()', () => {
    test('returns null when promo not applied', () => {
      expect(BL.calcPromoTotals({}, {})).toBeNull();
      expect(BL.calcPromoTotals({ promo_applied: false }, {})).toBeNull();
    });

    test('separates promo and normal items', () => {
      const o = {
        promo_applied: true,
        items: [
          { is_promo: true, sizes: { S: 10 }, unit_sell: 30, nsa_cost: 8, decorations: [] },
          { is_promo: false, sizes: { M: 5 }, unit_sell: 20, nsa_cost: 8, decorations: [] }
        ],
        art_files: [],
        shipping_type: 'flat',
        shipping_value: 20
      };
      const result = BL.calcPromoTotals(o, { tax_rate: 0.07 });
      expect(result).not.toBeNull();
      expect(result.promoRev).toBe(300);  // 10 * 30
      expect(result.normalRev).toBe(100); // 5 * 20
      expect(result.normalTax).toBeCloseTo(7, 1); // 7% of 100
    });

    test('promo portion has zero tax', () => {
      const o = {
        promo_applied: true,
        items: [
          { is_promo: true, sizes: { S: 10 }, unit_sell: 30, nsa_cost: 8, decorations: [] }
        ],
        art_files: [],
        shipping_type: 'flat',
        shipping_value: 10
      };
      const result = BL.calcPromoTotals(o, { tax_rate: 0.07 });
      expect(result.normalTax).toBe(0);
    });

    test('promo shipping gets 25% markup', () => {
      expect(BL.PROMO_SHIP_MULT).toBe(1.25);
      expect(BL.PROMO_DECO_MULT).toBe(1.25);
    });
  });

  describe('calcPromoSpendAllocation()', () => {
    test('calculates spend allocation for customer in date range', () => {
      const orders = [
        { customer_id: 'c1', created_at: '2026-03-01', items: [{ sizes: { S: 10 }, unit_sell: 20 }] },
        { customer_id: 'c1', created_at: '2026-04-15', items: [{ sizes: { M: 5 }, unit_sell: 30 }] },
        { customer_id: 'c2', created_at: '2026-03-10', items: [{ sizes: { S: 8 }, unit_sell: 25 }] }
      ];
      const result = BL.calcPromoSpendAllocation(orders, 'c1', '2026-01-01', '2026-06-30', 0.05);
      // c1 total: (10*20) + (5*30) = 350, 5% = 17.50
      expect(result).toBe(17.5);
    });

    test('filters by date range', () => {
      const orders = [
        { customer_id: 'c1', created_at: '2025-12-01', items: [{ sizes: { S: 10 }, unit_sell: 20 }] },
        { customer_id: 'c1', created_at: '2026-03-01', items: [{ sizes: { S: 10 }, unit_sell: 20 }] }
      ];
      const result = BL.calcPromoSpendAllocation(orders, 'c1', '2026-01-01', '2026-06-30', 0.05);
      expect(result).toBe(10); // only 1 order in range: 10*20 * 0.05 = 10
    });

    test('handles multiple customer IDs', () => {
      const orders = [
        { customer_id: 'c1', created_at: '2026-03-01', items: [{ sizes: { S: 10 }, unit_sell: 20 }] },
        { customer_id: 'c2', created_at: '2026-03-01', items: [{ sizes: { S: 10 }, unit_sell: 20 }] }
      ];
      const result = BL.calcPromoSpendAllocation(orders, ['c1', 'c2'], '2026-01-01', '2026-06-30', 0.1);
      expect(result).toBe(40); // (200+200) * 0.1
    });
  });

  describe('Promo Periods', () => {
    test('getCurrentPromoPeriod() H1', () => {
      const p = BL.getCurrentPromoPeriod('2026-03-15');
      expect(p.start).toBe('2026-01-01');
      expect(p.end).toBe('2026-06-30');
      expect(p.label).toBe('H1 2026');
    });

    test('getCurrentPromoPeriod() H2', () => {
      const p = BL.getCurrentPromoPeriod('2026-09-15');
      expect(p.start).toBe('2026-07-01');
      expect(p.end).toBe('2026-12-31');
      expect(p.label).toBe('H2 2026');
    });

    test('getPreviousPromoPeriod() from H1 → previous H2', () => {
      const p = BL.getPreviousPromoPeriod('2026-03-15');
      expect(p.start).toBe('2025-07-01');
      expect(p.end).toBe('2025-12-31');
      expect(p.label).toBe('H2 2025');
    });

    test('getPreviousPromoPeriod() from H2 → same year H1', () => {
      const p = BL.getPreviousPromoPeriod('2026-09-15');
      expect(p.start).toBe('2026-01-01');
      expect(p.end).toBe('2026-06-30');
      expect(p.label).toBe('H1 2026');
    });
  });
});

// ═══════════════════════════════════════════════
// 15. QB SYNC BUILDERS
// ═══════════════════════════════════════════════
describe('QB Sync Builders', () => {
  test('buildQBSalesOrder() creates correct structure', () => {
    const so = {
      id: 'SO-500',
      created_at: '2026-03-01',
      memo: 'Test order',
      items: [
        { sku: 'TSH-100', name: 'Tee', color: 'Red', sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [] }
      ],
      art_files: []
    };
    const cust = { name: 'Acme Inc' };
    const qb = { income_account: '400' };
    const result = BL.buildQBSalesOrder(so, cust, qb);
    expect(result.docType).toBe('SalesOrder');
    expect(result.docNumber).toBe('SO-500');
    expect(result.customerRef).toBe('Acme Inc');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].qty).toBe(10);
    expect(result.lines[0].rate).toBe(20);
    expect(result.total).toBe(200);
  });

  test('buildQBSalesOrder() includes decoration lines', () => {
    const so = {
      id: 'SO-501',
      created_at: '2026-03-01',
      items: [{
        sku: 'TSH-100', name: 'Tee', color: 'Red',
        sizes: { S: 48 }, unit_sell: 20, nsa_cost: 8,
        decorations: [{ type: 'screen_print', colors: 1 }]
      }],
      art_files: []
    };
    const result = BL.buildQBSalesOrder(so, { name: 'Test' }, { income_account: '400' });
    expect(result.lines.length).toBeGreaterThan(1); // item + deco line
  });

  test('buildQBInvoice() creates correct structure', () => {
    const inv = { id: 'INV-100', so_id: 'SO-500', customer_id: 'c1', date: '2026-03-01', total: 500, paid: 200 };
    const sos = [{ id: 'SO-500' }];
    const custs = [{ id: 'c1', name: 'Acme' }];
    const qb = { ar_account: '110' };
    const result = BL.buildQBInvoice(inv, sos, custs, qb);
    expect(result.docType).toBe('Invoice');
    expect(result.docNumber).toBe('INV-100');
    expect(result.customerRef).toBe('Acme');
    expect(result.balance).toBe(300);
  });
});

// ═══════════════════════════════════════════════
// 16. INVENTORY CONFLICTS — checkInventoryConflicts()
// ═══════════════════════════════════════════════
describe('Inventory Conflicts — checkInventoryConflicts()', () => {
  test('no conflicts when no other orders use same product', () => {
    const currentSO = { id: 'SO-1' };
    const item = { sku: 'TSH-100', product_id: 'p1' };
    const inv = { S: 20, M: 15 };
    const allOrders = [
      { id: 'SO-1', items: [{ sku: 'TSH-100', product_id: 'p1', pick_lines: [{ S: 5, status: 'pending' }] }] },
      { id: 'SO-2', items: [{ sku: 'TSH-200', product_id: 'p2', pick_lines: [{ S: 10, status: 'pending' }] }] }
    ];
    const warnings = BL.checkInventoryConflicts(currentSO, item, inv, allOrders);
    expect(warnings).toHaveLength(0);
  });

  test('detects conflict when other order needs more than available', () => {
    const currentSO = { id: 'SO-1' };
    const item = { sku: 'TSH-100', product_id: 'p1' };
    const inv = { S: 3 }; // only 3 in stock
    const allOrders = [
      { id: 'SO-1', items: [{ sku: 'TSH-100', product_id: 'p1', pick_lines: [] }] },
      { id: 'SO-2', items: [{ sku: 'TSH-100', product_id: 'p1', pick_lines: [{ S: 10, status: 'pending' }] }] }
    ];
    const warnings = BL.checkInventoryConflicts(currentSO, item, inv, allOrders);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].so).toBe('SO-2');
  });

  test('ignores already-pulled picks (no conflict)', () => {
    const currentSO = { id: 'SO-1' };
    const item = { sku: 'TSH-100', product_id: 'p1' };
    const inv = { S: 3 };
    const allOrders = [
      { id: 'SO-2', items: [{ sku: 'TSH-100', product_id: 'p1', pick_lines: [{ S: 10, status: 'pulled' }] }] }
    ];
    const warnings = BL.checkInventoryConflicts(currentSO, item, inv, allOrders);
    expect(warnings).toHaveLength(0);
  });

  test('skips current SO (self-check)', () => {
    const currentSO = { id: 'SO-1' };
    const item = { sku: 'TSH-100', product_id: 'p1' };
    const inv = { S: 3 };
    const allOrders = [
      { id: 'SO-1', items: [{ sku: 'TSH-100', product_id: 'p1', pick_lines: [{ S: 100, status: 'pending' }] }] }
    ];
    const warnings = BL.checkInventoryConflicts(currentSO, item, inv, allOrders);
    expect(warnings).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════
// 17. EDGE CASES & REGRESSION GUARDS
// ═══════════════════════════════════════════════
describe('Edge Cases & Regression Guards', () => {
  test('dP handles reversible number decoration', () => {
    const d = { kind: 'numbers', roster: { S: ['1', '2'] }, reversible: true, front_and_back: true };
    const result = BL.dP(d, 10, []);
    // front_and_back + reversible = multiplier of 4
    expect(result._nq).toBe(8); // 2 names * 2 (front_and_back) * 2 (reversible)
  });

  test('calcTotals handles outside_deco PO cost lines', () => {
    const o = {
      items: [{
        sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [],
        po_lines: [{ po_type: 'outside_deco', S: 10, unit_cost: 5 }]
      }],
      art_files: []
    };
    const result = BL.calcTotals(o, {});
    expect(result.cost).toBeGreaterThan(80); // base cost + outside deco cost
  });

  test('calcSOStatus handles partially received POs', () => {
    const ord = {
      items: [{
        sizes: { S: 10 },
        pick_lines: [],
        po_lines: [{ S: 10, received: { S: 5 } }],
        decorations: []
      }],
      jobs: []
    };
    // Covered (10 PO ordered) but only 5 received → waiting_receive
    expect(BL.calcSOStatus(ord)).toBe('waiting_receive');
  });

  test('buildJobs handles items with numbers decoration', () => {
    const o = {
      id: 'SO-200',
      items: [{
        sizes: { S: 5 },
        decorations: [{ kind: 'numbers', num_method: 'heat_transfer', position: 'back' }]
      }],
      art_files: []
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].art_name).toContain('Numbers');
  });

  test('spP cost/sell relationship: sell > cost (markup applied)', () => {
    // Due to rQ rounding, exact markup ratio may differ slightly
    const sell = BL.spP(48, 2, true);
    const cost = BL.spP(48, 2, false);
    expect(sell).toBeGreaterThan(cost);
    // Sell should be approximately cost * markup (1.5), within rounding
    expect(sell / cost).toBeGreaterThan(1.2);
    expect(sell / cost).toBeLessThan(1.8);
  });

  test('emP cost/sell relationship: sell > cost (markup applied)', () => {
    const sell = BL.emP(8000, 10, true);
    const cost = BL.emP(8000, 10, false);
    expect(sell).toBeGreaterThan(cost);
    // Sell should be approximately cost * markup (1.6), within rounding
    expect(sell / cost).toBeGreaterThan(1.3);
    expect(sell / cost).toBeLessThan(2.0);
  });

  test('calcTotals with art-shared decorations computes artQty correctly', () => {
    // Two items sharing the same art file
    const o = {
      items: [
        { sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8, decorations: [{ kind: 'art', art_file_id: 'a1' }] },
        { sizes: { M: 20 }, unit_sell: 20, nsa_cost: 8, decorations: [{ kind: 'art', art_file_id: 'a1' }] }
      ],
      art_files: [{ id: 'a1', deco_type: 'screen_print', ink_colors: 'Red\nBlue' }]
    };
    const result = BL.calcTotals(o, {});
    // artQty for a1 = 10 + 20 = 30, so dP uses 30 as combined qty for pricing
    expect(result.rev).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
  });

  test('calcTotals margin % is 0 when revenue is 0', () => {
    const o = {
      items: [{ sizes: { S: 10 }, unit_sell: 0, nsa_cost: 0, decorations: [] }],
      art_files: []
    };
    const result = BL.calcTotals(o, {});
    expect(result.pct).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// 18. ARTWORK & DECORATION PRESERVATION (Regression)
// Guards against "artwork falling off jobs" and
// "decoration lines disappearing" bugs after imports,
// renames, or merges.
// ═══════════════════════════════════════════════
describe('Artwork Preservation — buildJobs()', () => {
  test('item with two art decorations of the same deco type keeps BOTH art_file_ids on the job', () => {
    // Regression guard: multiple decos per item (e.g. two embroideries on a hat) must not drop one
    const o = {
      id: 'SO-500',
      items: [{
        sku: 'HAT-01', sizes: { OS: 12 },
        decorations: [
          { kind: 'art', art_file_id: 'a1', position: 'front' },
          { kind: 'art', art_file_id: 'a2', position: 'side' }
        ]
      }],
      art_files: [
        { id: 'a1', name: 'Logo', deco_type: 'embroidery', status: 'approved', prod_files: ['f1'] },
        { id: 'a2', name: 'Side Text', deco_type: 'embroidery', status: 'approved', prod_files: ['f2'] }
      ]
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(1); // same deco_type → one combined job
    expect(jobs[0]._art_ids).toEqual(expect.arrayContaining(['a1', 'a2']));
    expect(jobs[0]._art_ids).toHaveLength(2);
    expect(jobs[0].art_name).toContain('Logo');
    expect(jobs[0].art_name).toContain('Side Text');
  });

  test('art decoration referencing a missing art_file still creates a job (art does not silently disappear)', () => {
    // Regression guard: if art_files array is stale or not yet loaded, the decoration reference
    // should not cause the job to vanish — it should surface as needs_art instead.
    const o = {
      id: 'SO-501',
      items: [{ sku: 'TEE', sizes: { M: 10 }, decorations: [{ kind: 'art', art_file_id: 'missing', position: 'front' }] }],
      art_files: []
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]._art_ids).toEqual(['missing']);
    expect(jobs[0].art_status).toBe('needs_art');
  });

  test('renaming an art_file updates job label but preserves the art_file_id reference', () => {
    // Regression guard for deco group renames (art_group naming) — the link must not be lost.
    const base = {
      id: 'SO-502',
      items: [{ sizes: { L: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] }],
      art_files: [{ id: 'a1', name: 'Redbirds Front', deco_type: 'screen_print', status: 'approved', prod_files: ['f'] }]
    };
    const jobs1 = BL.buildJobs(base);
    expect(jobs1[0]._art_ids).toEqual(['a1']);
    expect(jobs1[0].art_name).toContain('Redbirds Front');

    const renamed = { ...base, art_files: [{ ...base.art_files[0], name: 'Cardinals Front' }] };
    const jobs2 = BL.buildJobs(renamed);
    expect(jobs2[0]._art_ids).toEqual(['a1']);
    expect(jobs2[0].art_name).toContain('Cardinals Front');
  });

  test('different art_file_ids (same deco type, same position) produce separate jobs — art never merges across groups', () => {
    const o = {
      id: 'SO-503',
      items: [
        { sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] },
        { sizes: { M: 7 }, decorations: [{ kind: 'art', art_file_id: 'a2', position: 'front' }] }
      ],
      art_files: [
        { id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'approved', prod_files: ['f1'] },
        { id: 'a2', name: 'Back Text', deco_type: 'screen_print', status: 'approved', prod_files: ['f2'] }
      ]
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(2);
    const allArtIds = jobs.flatMap(j => j._art_ids);
    expect(allArtIds).toEqual(expect.arrayContaining(['a1', 'a2']));
  });

  test('buildJobs does not mutate the input order (no stray state changes on re-render / poll)', () => {
    const o = {
      id: 'SO-504',
      items: [{ sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] }],
      art_files: [{ id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'approved', prod_files: ['f1'] }]
    };
    const snapshot = JSON.stringify(o);
    BL.buildJobs(o);
    expect(JSON.stringify(o)).toBe(snapshot);
  });
});

describe('Decoration Lines Preservation — calcTotals() / createInvoice()', () => {
  test('calcTotals revenue drops when a decoration line is removed from an item', () => {
    // Regression guard: if decorations silently disappear, totals shouldn't stay the same
    const twoDecos = {
      items: [{
        sizes: { S: 10 }, unit_sell: 20, nsa_cost: 8,
        decorations: [
          { kind: 'art', art_file_id: 'a1', position: 'front' },
          { kind: 'art', art_file_id: 'a2', position: 'back' }
        ]
      }],
      art_files: [
        { id: 'a1', deco_type: 'screen_print', ink_colors: 'Red' },
        { id: 'a2', deco_type: 'screen_print', ink_colors: 'Blue' }
      ]
    };
    const oneDeco = {
      ...twoDecos,
      items: [{ ...twoDecos.items[0], decorations: [twoDecos.items[0].decorations[0]] }]
    };
    const tTwo = BL.calcTotals(twoDecos, {});
    const tOne = BL.calcTotals(oneDeco, {});
    expect(tTwo.rev).toBeGreaterThan(tOne.rev);
    expect(tTwo.cost).toBeGreaterThan(tOne.cost);
  });

  test('calcTotals still captures outside_deco PO cost on items[].po_lines (legacy path)', () => {
    // Regression guard: supplier-bill refactor moved outside-deco POs onto so.deco_pos[], but the
    // legacy per-item po_lines path must keep producing cost for historical orders.
    const o = {
      items: [{
        sku: 'TEE', sizes: { M: 10 }, unit_sell: 15, nsa_cost: 6,
        decorations: [],
        po_lines: [{ po_type: 'outside_deco', M: 10, unit_cost: 4 }]
      }],
      art_files: []
    };
    const t = BL.calcTotals(o, {});
    // base (10 * 6) + deco PO (10 * 4) = 100
    expect(t.cost).toBeGreaterThanOrEqual(100);
  });

  test('calcSOStatus: no_deco items with stale decoration data do not force in_production', () => {
    // Regression guard: if an item is flipped to no_deco but still carries old decoration entries,
    // the SO should still reach ready_to_invoice when fulfilled.
    const ord = {
      items: [{
        no_deco: true,
        sizes: { S: 10 },
        pick_lines: [{ S: 10, status: 'pulled' }],
        po_lines: [],
        decorations: [{ kind: 'art', art_file_id: 'a1' }]
      }],
      jobs: []
    };
    expect(BL.calcSOStatus(ord)).toBe('ready_to_invoice');
  });

  test('createInvoice line-item rate includes every decoration on the item', () => {
    // Regression guard: if a decoration drops out, the invoiced rate would silently be too low.
    const o = {
      items: [{
        sku: 'TEE-01', name: 'T-Shirt', sizes: { S: 10 }, unit_sell: 20,
        decorations: [
          { kind: 'art', art_file_id: 'a1', position: 'front' },
          { kind: 'outside_deco', sell_each: 3, cost_each: 1.5 }
        ]
      }],
      art_files: [{ id: 'a1', deco_type: 'screen_print', ink_colors: 'Red' }]
    };
    const inv = BL.createInvoice(o, [0], { tax_rate: 0 }, { a1: 10 });
    expect(inv.lineItems).toHaveLength(1);
    // rate = unit_sell (20) + art deco sell + outside_deco sell (3) → strictly > 20 + 3
    expect(inv.lineItems[0].rate).toBeGreaterThan(23);
  });
});

describe('Job Readiness — isJobReady() regression guards', () => {
  test('art approved but missing prod_files keeps job not ready', () => {
    // Regression guard: prod files are the gate before production — art status alone is not enough.
    const j = { art_status: 'art_complete', _art_ids: ['a1'], items: [{ item_idx: 0 }] };
    const o = {
      items: [{ sizes: { S: 5 }, pick_lines: [{ S: 5, status: 'pulled' }], po_lines: [] }],
      art_files: [{ id: 'a1', status: 'approved', prod_files: [] }]
    };
    expect(BL.isJobReady(j, o)).toBe(false);
  });

  test('multi-art job requires ALL art files to have prod_files', () => {
    const j = { art_status: 'art_complete', _art_ids: ['a1', 'a2'], items: [{ item_idx: 0 }] };
    const o = {
      items: [{ sizes: { S: 5 }, pick_lines: [{ S: 5, status: 'pulled' }], po_lines: [] }],
      art_files: [
        { id: 'a1', prod_files: ['sep1.ai'] },
        { id: 'a2', prod_files: [] }
      ]
    };
    expect(BL.isJobReady(j, o)).toBe(false);
  });
});
