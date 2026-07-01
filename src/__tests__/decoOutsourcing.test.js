/* eslint-disable */
/**
 * Regression: a decoration on an item that's covered by a deco PO for a DIFFERENT deco type must still
 * generate an in-house production job.
 *
 * Bug (branch claude/art-sync-job-creation): OrderEditor.syncJobs skipped an item entirely if it was
 * listed on ANY decoration PO (so.deco_pos[].item_idxs) or had an item-level outside-deco PO line. A
 * deco PO, though, is type-specific — the rep picks ONE deco_type plus the items it covers. So after a
 * rep changed an item's art to a screen-print (or DTF) design while that item still sat on an unrelated
 * EMBROIDERY deco PO, no job was auto-created — even after clicking "Sync Jobs" — because the whole
 * item was treated as outsourced.
 *
 * Fix: outsourcedDecoTypes(o) maps item_idx -> Set<deco_type|'*'> from every covering PO, and
 * decoIsOutsourced(set, concreteType) decides PER DECORATION. A decoration whose resolved type matches
 * a covering PO is produced by the vendor (no job); a non-matching type is in-house (job). This mirrors
 * the per-deco gate now used in OrderEditor.syncJobs.
 *
 * SAFE: pure functions from businessLogic.js — no Supabase, no UI, no network.
 */

const { outsourcedDecoTypes, decoIsOutsourced, decoConcreteType, isDecoOutsourced } = require('../businessLogic');

describe('outsourcedDecoTypes — per-item set of outsourced deco types', () => {
  test('SO-level deco PO records its deco_type against every covered item', () => {
    const o = { deco_pos: [{ deco_type: 'embroidery', item_idxs: [0, 1, 4] }] };
    const map = outsourcedDecoTypes(o);
    expect([...map[0]]).toEqual(['embroidery']);
    expect([...map[1]]).toEqual(['embroidery']);
    expect([...map[4]]).toEqual(['embroidery']);
    expect(map[2]).toBeUndefined(); // not covered
  });

  test('an item on two deco POs collects both types', () => {
    const o = { deco_pos: [
      { deco_type: 'embroidery', item_idxs: [0] },
      { deco_type: 'screen_print', item_idxs: [0] },
    ] };
    expect([...outsourcedDecoTypes(o)[0]].sort()).toEqual(['embroidery', 'screen_print']);
  });

  test('a deco PO with no deco_type records a wildcard (legacy whole-item suppression)', () => {
    const o = { deco_pos: [{ item_idxs: [3] }] };
    expect([...outsourcedDecoTypes(o)[3]]).toEqual(['*']);
  });

  test('item-level outside-deco PO lines are folded in by deco_type', () => {
    const o = { items: [
      { po_lines: [{ po_type: 'outside_deco', deco_type: 'dtf' }] },
      { po_lines: [{ po_type: 'garment' }] }, // ordinary garment PO — not outsourced
    ] };
    const map = outsourcedDecoTypes(o);
    expect([...map[0]]).toEqual(['dtf']);
    expect(map[1]).toBeUndefined();
  });

  test('empty / missing deco_pos and items → empty map', () => {
    expect(outsourcedDecoTypes({})).toEqual({});
    expect(outsourcedDecoTypes(null)).toEqual({});
  });
});

describe('decoIsOutsourced — per-decoration gate', () => {
  const emb = new Set(['embroidery']);

  test('an item not covered by any PO is never outsourced', () => {
    expect(decoIsOutsourced(undefined, 'screen_print')).toBe(false);
    expect(decoIsOutsourced(undefined, null)).toBe(false);
  });

  test('a matching deco type is outsourced (vendor produces it — no in-house job)', () => {
    expect(decoIsOutsourced(emb, 'embroidery')).toBe(true);
  });

  test('a NON-matching deco type stays in-house (the reported bug — screen print / DTF on an embroidery PO)', () => {
    expect(decoIsOutsourced(emb, 'screen_print')).toBe(false);
    expect(decoIsOutsourced(emb, 'dtf')).toBe(false);
    expect(decoIsOutsourced(emb, 'heat_press')).toBe(false);
  });

  test('a wildcard PO (no deco_type) suppresses every decoration on the item', () => {
    const wild = new Set(['*']);
    expect(decoIsOutsourced(wild, 'screen_print')).toBe(true);
    expect(decoIsOutsourced(wild, 'embroidery')).toBe(true);
    expect(decoIsOutsourced(wild, null)).toBe(true);
  });

  test('art with no concrete type yet (unassigned) is treated as covered while the item is outsourced', () => {
    // Avoids spawning a mistyped placeholder job; once art is assigned, a non-matching type un-suppresses.
    expect(decoIsOutsourced(emb, null)).toBe(true);
    expect(decoIsOutsourced(emb, undefined)).toBe(true);
  });
});

describe('decoConcreteType — resolve a decoration to its concrete deco type', () => {
  const o = { art_files: [{ id: 'af1', deco_type: 'embroidery' }] };
  test('an art deco resolves to its art file type (source of truth once attached)', () => {
    expect(decoConcreteType(o, { kind: 'art', art_file_id: 'af1' })).toBe('embroidery');
  });
  test('an art deco with no file falls back to its own type hint, else null', () => {
    expect(decoConcreteType(o, { kind: 'art', deco_type: 'dtf' })).toBe('dtf');
    expect(decoConcreteType(o, { kind: 'art' })).toBeNull();
  });
  test('numbers / names resolve to their method (with the same defaults syncJobs uses)', () => {
    expect(decoConcreteType(o, { kind: 'numbers', num_method: 'sublimated' })).toBe('sublimated');
    expect(decoConcreteType(o, { kind: 'numbers' })).toBe('heat_transfer');
    expect(decoConcreteType(o, { kind: 'names', name_method: 'sublimated' })).toBe('sublimated');
    expect(decoConcreteType(o, { kind: 'names' })).toBe('heat_press');
  });
});

describe('isDecoOutsourced — unified job+cost gate (the branch lives on the deco PO)', () => {
  test('legacy kind:outside_deco is always outside', () => {
    expect(isDecoOutsourced({}, 0, { kind: 'outside_deco' })).toBe(true);
  });
  test('a soft fulfillment:outside flag marks it outside (no PO needed yet)', () => {
    expect(isDecoOutsourced({}, 0, { kind: 'art', art_file_id: 'a', fulfillment: 'outside' })).toBe(true);
  });
  test('an explicit deco_po_id marks it outside', () => {
    expect(isDecoOutsourced({}, 0, { kind: 'art', art_file_id: 'a', deco_po_id: 'DPO 1' })).toBe(true);
  });
  test('no flag + no PO + no covering deco PO = in-house', () => {
    expect(isDecoOutsourced({ items: [{}] }, 0, { kind: 'art', art_file_id: 'a' })).toBe(false);
  });
  test('an art deco routed onto a SO-level deco PO of the SAME type is outside (no job, cost comes from the PO)', () => {
    const o = {
      deco_pos: [{ deco_type: 'embroidery', item_idxs: [0] }],
      art_files: [{ id: 'afEMB', deco_type: 'embroidery' }],
      items: [{ decorations: [{ kind: 'art', art_file_id: 'afEMB' }] }],
    };
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[0])).toBe(true);
  });
  test('a different-type deco on the same covered item stays in-house — cost is counted here (SO-1199 fix parity)', () => {
    const o = {
      deco_pos: [{ deco_type: 'embroidery', item_idxs: [0] }],
      art_files: [{ id: 'afSP', deco_type: 'screen_print' }],
      items: [{ decorations: [{ kind: 'art', art_file_id: 'afSP' }] }],
    };
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[0])).toBe(false);
  });
  test('a deco on an item covered by no PO is in-house', () => {
    const o = {
      deco_pos: [{ deco_type: 'embroidery', item_idxs: [1] }],
      art_files: [{ id: 'afSP', deco_type: 'screen_print' }],
      items: [{ decorations: [{ kind: 'art', art_file_id: 'afSP' }] }],
    };
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[0])).toBe(false);
  });
  test('a precomputed outByItem map is honored (the loop optimization the Costs tab uses)', () => {
    const o = {
      deco_pos: [{ deco_type: 'dtf', item_idxs: [0] }],
      art_files: [{ id: 'afDTF', deco_type: 'dtf' }],
      items: [{ decorations: [{ kind: 'art', art_file_id: 'afDTF' }] }],
    };
    const map = outsourcedDecoTypes(o);
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[0], map)).toBe(true);
  });
  test('art with no concrete type yet on an outsourced item is treated as outside (no mistyped placeholder cost/job)', () => {
    const o = { deco_pos: [{ deco_type: 'embroidery', item_idxs: [0] }], items: [{ decorations: [{ kind: 'art' }] }] };
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[0])).toBe(true);
  });
  test('an item-level outside-deco PO line outsources only its own type, not the whole item', () => {
    const o = {
      art_files: [{ id: 'afSP', deco_type: 'screen_print' }, { id: 'afEMB', deco_type: 'embroidery' }],
      items: [{
        po_lines: [{ po_type: 'outside_deco', deco_type: 'embroidery' }],
        decorations: [
          { kind: 'art', art_file_id: 'afEMB' }, // matches the outside-deco line → outside
          { kind: 'art', art_file_id: 'afSP' },  // different type → in-house
        ],
      }],
    };
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[0])).toBe(true);
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[1])).toBe(false);
  });
});

describe('syncJobs gate — end-to-end intent (mirrors OrderEditor.syncJobs deco classification)', () => {
  // Reproduces SO-1199: an EMBROIDERY deco PO (Silver Screen) covers items 0,1,2,3 — but the rep has
  // since changed items 0 & 1 to a screen-print logo and item 2 to a DTF logo. Only item 3 is still
  // embroidery (genuinely outsourced). Item 4 is an ordinary in-house screen print, on no deco PO.
  const order = {
    deco_pos: [{ po_id: 'DPO 3242', vendor: 'Silver Screen', deco_type: 'embroidery', item_idxs: [0, 1, 2, 3] }],
    art_files: [
      { id: 'afSP', deco_type: 'screen_print' },
      { id: 'afDTF', deco_type: 'dtf' },
      { id: 'afEMB', deco_type: 'embroidery' },
    ],
    items: [
      { sku: 'A', decorations: [{ kind: 'art', art_file_id: 'afSP', position: 'Front Center' }] },
      { sku: 'B', decorations: [{ kind: 'art', art_file_id: 'afSP', position: 'Front Center' }] },
      { sku: 'C', decorations: [{ kind: 'art', art_file_id: 'afDTF', position: 'Front Center' }] },
      { sku: 'D', decorations: [{ kind: 'art', art_file_id: 'afEMB', position: 'Front Center' }] },
      { sku: 'E', decorations: [{ kind: 'art', art_file_id: 'afSP', position: 'Front Center' }] },
    ],
  };

  // Classify every art decoration exactly as syncJobs does: resolve the art file's deco_type, then ask
  // decoIsOutsourced. Returns the SKUs that WOULD spawn an in-house job.
  const jobSkus = (o) => {
    const outByItem = outsourcedDecoTypes(o);
    const art = (o.art_files || []);
    const skus = [];
    (o.items || []).forEach((it, ii) => {
      (it.decorations || []).forEach((d) => {
        if (d.kind !== 'art') return;
        const af = d.art_file_id ? art.find(a => a.id === d.art_file_id) : null;
        const concreteDt = af?.deco_type || d.deco_type || null;
        if (decoIsOutsourced(outByItem[ii], concreteDt)) return; // outsourced — no job
        skus.push(it.sku);
      });
    });
    return skus;
  };

  test('screen-print & DTF designs on the embroidery deco PO now generate jobs; the matching embroidery does not', () => {
    expect(jobSkus(order).sort()).toEqual(['A', 'B', 'C', 'E']); // D (embroidery, matches PO) stays outsourced
  });

  test('before the fix the whole item was skipped — every covered item would have had NO job', () => {
    // Demonstrates the old per-item behavior for contrast: any item on the deco PO produced nothing.
    const oldGate = (o) => {
      const skus = [];
      (o.items || []).forEach((it, ii) => {
        const onPO = (o.deco_pos || []).some(dp => (dp.item_idxs || []).includes(ii));
        if (onPO) return;
        (it.decorations || []).forEach((d) => { if (d.kind === 'art') skus.push(it.sku); });
      });
      return skus;
    };
    expect(oldGate(order)).toEqual(['E']); // only the off-PO item — A/B/C/D were all wrongly suppressed
  });
});
