/* Coverage for the pure-deletion guard behind the SO-1468 line losses (2026-07-13/14).
 *
 * Context: the SO save rewrites so_items wholesale (insert-new / delete-old). Its count-mismatch
 * guard waves any shrink through once the session is flagged hydrated, and it counts DISTINCT
 * item_index values — so a line dropped by the loader's index-dedup leaves the counts equal and
 * never reaches that guard at all. unaccountedDroppedItems is what now stands in the way, so it
 * needs to hold two lines at once: catch real drops, and never block ordinary editing.
 *
 * See ORDERS_DATA_LOSS_INVESTIGATION_2026-07-27.md for the incident these pin down.
 */
import { unaccountedDroppedItems } from '../businessLogic';

const row = (sku, color) => ({ sku, color });

// The real SO-1468 item set, in the order it was stored.
const OLU = [
  row('IN1181', 'White'),            // ADIZERO E Tank
  row('KF0972', 'Black'),            // CLUB DRESS
  row('JN1969', 'White'),            // CLUB SKIRT      ← dropped 2026-07-13
  row('JW4303', 'Heather Grey'),     // M Fleece Crew   ← dropped 2026-07-14
  row('JX4499', 'Power Red/White'),  // W SS Pregame
  row('A592-50', 'Black Melange'),   // Space Dyed Polo
];

describe('unaccountedDroppedItems — catches the loss', () => {
  test('reports the line a short client list would delete (the SO-1468 shape)', () => {
    const client = OLU.filter((i) => i.sku !== 'JN1969');
    expect(unaccountedDroppedItems(client, OLU, [])).toEqual(['jn1969|white']);
  });

  test('reports every dropped line, not just the first', () => {
    const client = OLU.filter((i) => i.sku !== 'JN1969' && i.sku !== 'JW4303');
    expect(unaccountedDroppedItems(client, OLU, []).sort())
      .toEqual(['jn1969|white', 'jw4303|heather grey']);
  });

  test('catches a drop even when the client list was re-indexed (indexes are not identity)', () => {
    // The engine re-numbers item_index 0..N-1 on every save, so the dropped line leaves no
    // index gap to notice. Identity has to come from sku+color, which is what this asserts.
    const client = [OLU[0], OLU[1], OLU[3], OLU[4], OLU[5]];
    expect(unaccountedDroppedItems(client, OLU, [])).toEqual(['jn1969|white']);
  });

  test('a duplicated DB row (interrupted save swap) still leaves one copy accounted for', () => {
    // Two rows, same line: the client legitimately holds one. Nothing is being lost, but the
    // leftover copy must not be reported as a drop or every post-swap save would be blocked.
    const db = [...OLU, row('IN1181', 'White')];
    expect(unaccountedDroppedItems(OLU, db, [])).toEqual([]);
  });
});

describe('unaccountedDroppedItems — does not block ordinary work', () => {
  test('an unchanged save reports nothing', () => {
    expect(unaccountedDroppedItems(OLU, OLU, [])).toEqual([]);
  });

  test('a deliberate deletion passes once the editor tombstones it', () => {
    const client = OLU.filter((i) => i.sku !== 'JN1969');
    expect(unaccountedDroppedItems(client, OLU, ['jn1969|white'])).toEqual([]);
  });

  test('a tombstone for one line does not excuse dropping another', () => {
    const client = OLU.filter((i) => i.sku !== 'JN1969' && i.sku !== 'JW4303');
    expect(unaccountedDroppedItems(client, OLU, ['jn1969|white'])).toEqual(['jw4303|heather grey']);
  });

  test('adding a line reports nothing', () => {
    expect(unaccountedDroppedItems([...OLU, row('NEW1', 'Red')], OLU, [])).toEqual([]);
  });

  test('a replace/import (new keys alongside removed ones) is left alone', () => {
    // Not a pure subset, so this guard abstains and the existing guards decide. Blocking here
    // would break conversion and import flows that legitimately swap the whole item set.
    const client = [OLU[0], row('IMPORTED', 'Navy')];
    expect(unaccountedDroppedItems(client, OLU, [])).toEqual([]);
  });

  test('casing differences between the editor copy and the stored row are not drops', () => {
    const client = OLU.map((i) => ({ sku: i.sku.toLowerCase(), color: i.color.toUpperCase() }));
    expect(unaccountedDroppedItems(client, OLU, [])).toEqual([]);
  });

  test('custom lines with no sku still match on color', () => {
    const db = [row('', 'Black'), row('IN1181', 'White')];
    expect(unaccountedDroppedItems([row('', 'Black')], db, [])).toEqual(['in1181|white']);
    expect(unaccountedDroppedItems(db, db, [])).toEqual([]);
  });
});

describe('unaccountedDroppedItems — defers to the other guards', () => {
  test('an empty client list abstains (the zero-wipe guard owns that case)', () => {
    expect(unaccountedDroppedItems([], OLU, [])).toEqual([]);
  });

  test('an empty DB abstains (nothing to lose — a first save)', () => {
    expect(unaccountedDroppedItems(OLU, [], [])).toEqual([]);
  });

  test('missing / malformed arguments never throw', () => {
    expect(unaccountedDroppedItems(null, null, null)).toEqual([]);
    expect(unaccountedDroppedItems(undefined, OLU, undefined)).toEqual([]);
    expect(unaccountedDroppedItems([{}], [{}], [])).toEqual([]);
  });
});
