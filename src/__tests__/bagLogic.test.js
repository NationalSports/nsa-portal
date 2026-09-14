/* Bagging Station pure logic (src/baggingstation/bagLogic.js). */

import {
  claimIsStale, lineSatisfied, lineOnOrder, orderProgress, sortLinesForBag,
  playerHeader, shortSummary, nextOrderPick, batchItemTotals, sortOrders, dominantSize, orderInDeco, CLAIM_STALE_MS,
  styleNumber, garmentName, itemDisplay, logoText,
} from '../baggingstation/bagLogic';

const NOW = Date.parse('2026-08-12T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe('claimIsStale', () => {
  test('fresh claim holds, old claim is stale, garbage is stale', () => {
    expect(claimIsStale(iso(60 * 1000), NOW)).toBe(false);
    expect(claimIsStale(iso(CLAIM_STALE_MS + 1000), NOW)).toBe(true);
    expect(claimIsStale(null, NOW)).toBe(true);
    expect(claimIsStale('not-a-date', NOW)).toBe(true);
  });
});

describe('lineSatisfied — mirrors server bagging_line_satisfied', () => {
  test('tapped-off line satisfies', () => {
    expect(lineSatisfied({ qty: 2, bagged_qty: 2 })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1 })).toBe(false);
  });
  test('open/backordered/refunded shorts cover the gap; found/pulled do not', () => {
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'open' })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'backordered' })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'refunded' })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'found' })).toBe(false);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'pulled' })).toBe(false);
  });
  test('cancelled line is always satisfied', () => {
    expect(lineSatisfied({ qty: 5, bagged_qty: 0, line_status: 'cancelled' })).toBe(true);
  });
});

describe('orderProgress', () => {
  test('unit math across qty>1, shorts, waiting, cancelled', () => {
    const items = [
      { qty: 3, bagged_qty: 2 },
      { qty: 1, bagged_qty: 0, short_qty: 1, short_status: 'open' },
      { qty: 2, bagged_qty: 0, line_status: 'on_order' },
      { qty: 9, bagged_qty: 0, line_status: 'cancelled' }, // excluded entirely
    ];
    const p = orderProgress(items);
    expect(p).toEqual({ total: 6, checked: 2, short: 1, waiting: 2, complete: false });
  });
  test('complete only when every live line is satisfied; empty order is not complete', () => {
    expect(orderProgress([{ qty: 1, bagged_qty: 1 }]).complete).toBe(true);
    expect(orderProgress([]).complete).toBe(false);
  });
});

describe('sortLinesForBag', () => {
  test('bundle parent leads its children; loose lines sorted by size then name', () => {
    const items = [
      { id: 'l2', name: 'Pant', size: 'L' },
      { id: 'c1', name: 'Bundle Sock', size: 'M', bundle_ref: 'b1' },
      { id: 'l1', name: 'Jersey', size: 'YM' },
      { id: 'p1', name: 'Bundle Kit', size: 'M', is_bundle_parent: true, bundle_ref: 'b1' },
    ];
    expect(sortLinesForBag(items).map((i) => i.id)).toEqual(['p1', 'c1', 'l1', 'l2']);
  });
});

describe('playerHeader', () => {
  test('prefers item player fields, falls back to buyer', () => {
    expect(playerHeader({ buyer_name: 'Parent Name' }, [
      { player_name: ' ', player_number: '' },
      { player_name: 'Jimmy Smith', player_number: '23' },
    ])).toEqual({ name: 'Jimmy Smith', number: '23' });
    expect(playerHeader({ buyer_name: 'Parent Name' }, [{}])).toEqual({ name: 'Parent Name', number: '' });
  });
});

describe('shortSummary', () => {
  test('lists only counting shorts', () => {
    const s = shortSummary([
      { id: 'a', name: 'Hoodie', size: 'YS', short_qty: 1, short_status: 'open' },
      { id: 'b', name: 'Jersey', size: 'M', short_qty: 1, short_status: 'found' }, // resolved → excluded
      { id: 'c', name: 'Pant', size: 'L', short_qty: 0, short_status: null },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe('1× Hoodie YS');
  });
});

describe('batchItemTotals — the staging start page', () => {
  const orders = [
    { webstore_order_items: [
      { sku: 'JR1', name: 'Jersey', color: 'Navy', size: 'YM', qty: 2, bagged_qty: 1 },
      { sku: 'JR1', name: 'Jersey', color: 'Navy', size: 'M', qty: 1, bagged_qty: 0 },
      { sku: 'KIT', name: 'Bundle Kit', size: 'M', qty: 1, is_bundle_parent: true }, // skipped
    ] },
    { webstore_order_items: [
      { sku: 'JR1', name: 'Jersey', color: 'Navy', size: 'YM', qty: 1, bagged_qty: 0, short_qty: 1, short_status: 'open' },
      { sku: 'PT2', name: 'Pant', color: 'Black', size: 'YM', qty: 1, bagged_qty: 1 },
      { sku: 'XX', name: 'Cancelled thing', size: 'S', qty: 5, line_status: 'cancelled' }, // skipped
    ] },
  ];
  test('aggregates per product × size with bagged/short, sizes in wear order', () => {
    const { sizes, rows, totals } = batchItemTotals(orders);
    expect(sizes).toEqual(['YM', 'M']); // wear order, not alphabetical
    expect(rows.map((r) => r.name)).toEqual(['Jersey', 'Pant']);
    const jersey = rows[0];
    expect(jersey.sizes.get('YM')).toEqual({ total: 3, bagged: 1, short: 1 });
    expect(jersey.sizes.get('M')).toEqual({ total: 1, bagged: 0, short: 0 });
    expect(totals).toEqual({ total: 5, bagged: 2, short: 1, remaining: 2 });
  });
});

describe('orderInDeco — deco gate mirrors server bagging_order_ready', () => {
  test('blocks while any live line is pre-bagging; on_order does not block', () => {
    expect(orderInDeco({}, [{ line_status: 'in_production' }])).toBe(true);
    expect(orderInDeco({}, [{ line_status: 'received' }])).toBe(true);
    expect(orderInDeco({}, [{}])).toBe(true); // missing status = pending
    expect(orderInDeco({}, [{ line_status: 'bagging' }, { line_status: 'on_order' }])).toBe(false);
    expect(orderInDeco({}, [{ line_status: 'shipped' }])).toBe(false);
    expect(orderInDeco({}, [{ line_status: 'pending', is_bundle_parent: true }, { line_status: 'bagging' }])).toBe(false);
  });
  test('backorder child orders are exempt', () => {
    expect(orderInDeco({ backorder_of: 'parent' }, [{ line_status: 'pending' }])).toBe(false);
  });
});

describe('sortOrders / dominantSize — board sort modes', () => {
  const o = (id, created, size, player) => ({
    id, created_at: created,
    webstore_order_items: [{ size, qty: 1, player_name: player }],
  });
  const orders = [
    o('a', '2026-08-03', 'L', 'Zoe'),
    o('b', '2026-08-01', 'YM', 'Adam'),
    o('c', '2026-08-02', 'M', 'Mia'),
  ];
  test('oldest / size / name orderings', () => {
    expect(sortOrders(orders, 'oldest').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortOrders(orders, 'size').map((x) => x.id)).toEqual(['b', 'c', 'a']); // YM < M < L wear order
    expect(sortOrders(orders, 'name').map((x) => x.id)).toEqual(['b', 'c', 'a']); // Adam, Mia, Zoe
  });
  test('dominantSize picks the highest-qty size, wear order breaking ties', () => {
    expect(dominantSize([{ size: 'M', qty: 1 }, { size: 'YM', qty: 2 }])).toBe('YM');
    expect(dominantSize([{ size: 'L', qty: 1 }, { size: 'YS', qty: 1 }])).toBe('YS'); // tie → earlier wear order
    expect(dominantSize([])).toBeNull();
  });
});

describe('nextOrderPick', () => {
  test('skips bagged and freshly-claimed-by-others; oldest first; own claim ok', () => {
    const orders = [
      { id: 'done', bagged_at: iso(0), created_at: '2026-08-01' },
      { id: 'held', bagging_claimed_by: 'other', bagging_claimed_at: iso(60 * 1000), created_at: '2026-08-02' },
      { id: 'stale', bagging_claimed_by: 'other', bagging_claimed_at: iso(CLAIM_STALE_MS * 2), created_at: '2026-08-04' },
      { id: 'mine', bagging_claimed_by: 'me', bagging_claimed_at: iso(1000), created_at: '2026-08-03' },
    ];
    expect(nextOrderPick(orders, 'me', NOW).id).toBe('mine');
    expect(nextOrderPick(orders.filter((o) => o.id !== 'mine'), 'me', NOW).id).toBe('stale');
    expect(nextOrderPick([], 'me', NOW)).toBeNull();
  });
});

describe('styleNumber — peel the color off the storefront sku', () => {
  test('strips a trailing run of tokens that IS the color', () => {
    expect(styleNumber('PC55-JetBlack', 'Jet Black')).toBe('PC55');
    expect(styleNumber('PC55-Jet-black', 'Jet Black')).toBe('PC55');
    expect(styleNumber('NEA200-TrueNavy', 'True Navy')).toBe('NEA200');
    expect(styleNumber('LST484-IronGrey', 'Iron Grey')).toBe('LST484');
    expect(styleNumber('64000 BLACK', 'Black')).toBe('64000');
  });

  test('pulls the style off a free-text sku when the rest is plainly the color', () => {
    expect(styleNumber('18500 SPORT GREY', 'Sport Grey')).toBe('18500');
    expect(styleNumber('1379806 (BLACK 001) - 5', 'Black (001)')).toBe('1379806'); // substring
    expect(styleNumber('A557 NAVY', 'Collegiate Navy')).toBe('A557');              // the other way
    expect(styleNumber('112 BLACK/RED/WHITE - 5', 'Black/White/Red')).toBe('112'); // same words, reordered
    expect(styleNumber('112 -5 BLACK/WHITE/RED', 'Black/White/Red')).toBe('112');  // pack marker dropped too
  });

  test('leaves the sku alone when the suffix is not the color', () => {
    // a wrong style number on a bag label is worse than a noisy one
    expect(styleNumber('JST488', 'True Navy')).toBe('JST488');
    expect(styleNumber('229162.080', 'Black')).toBe('229162.080');
    expect(styleNumber('1387011-001', 'Black')).toBe('1387011-001');
    expect(styleNumber('1382622 (GREY 011) - 5', 'Mod Gray (011)')).toBe('1382622 (GREY 011) - 5');
    expect(styleNumber('ST485', '')).toBe('ST485');
    expect(styleNumber(null, 'Black')).toBe('');
  });
});

describe('garmentName — what the vendor feed actually meant', () => {
  test('drops the doubled brand and the repeated style number', () => {
    expect(garmentName('Port & Co Port & Co Core Blend Tee. PC55', 'PC55-Navy', 'Navy'))
      .toBe('Port & Co Core Blend Tee');
    expect(garmentName('Sport-Tek Posi-UV Pro Tee. ST420 ST420', 'ST420', 'Black'))
      .toBe('Sport-Tek Posi-UV Pro Tee');
    expect(garmentName('A4 A4 Sprint 7" Mesh Short A4N5293', 'A4N5293-Black', 'Black'))
      .toBe('A4 Sprint 7" Mesh Short');
  });

  test('drops a trailing "- <color>", including the catalog\'s shorter spelling', () => {
    expect(garmentName('Gildan Softstyle® T-Shirt - Black', '64000 BLACK', 'Black'))
      .toBe('Gildan Softstyle® T-Shirt');
    // catalog says "- Navy", the line says "Collegiate Navy" — same color
    expect(garmentName("adidas Women's Blended T-Shirt - Navy", 'A557 NAVY', 'Collegiate Navy'))
      .toBe("adidas Women's Blended T-Shirt");
    // ...but never a trailing word the color merely resembles
    expect(garmentName('Trucker - Black/Red/White', '112', 'Black/White/Red'))
      .toBe('Trucker - Black/Red/White');
  });

  test('never strips itself down to nothing', () => {
    expect(garmentName('ST485', 'ST485', 'Black')).toBe('ST485');
    expect(garmentName('', 'PC55-Navy', 'Navy')).toBe('');
  });
});

describe('itemDisplay — the three things the packer needs', () => {
  test('splits a storefront line into style / garment / color', () => {
    const d = itemDisplay({ sku: 'PC55-JetBlack', color: 'Jet Black', name: 'Port & Co Port & Co Core Blend Tee. PC55' });
    expect(d).toMatchObject({ style: 'PC55', garment: 'Port & Co Core Blend Tee', color: 'Jet Black' });
    expect(d.text).toBe('PC55 · Port & Co Core Blend Tee · Jet Black');
  });

  test('never repeats the style number as its own description', () => {
    expect(itemDisplay({ sku: 'ST485', name: 'ST485', color: 'Black' }).text).toBe('ST485 · Black');
  });

  test('an un-enriched line still reads as something', () => {
    expect(itemDisplay({ sku: 'NEA200-TrueNavy', color: 'True Navy', name: null }).text).toBe('NEA200 · True Navy');
    expect(itemDisplay({}).text).toBe('Item');
  });
});

describe('itemDisplay — head/desc, the two lines the label and the screen share', () => {
  test('style number leads, garment + color underneath', () => {
    const d = itemDisplay({ sku: 'PC55-JetBlack', color: 'Jet Black', name: 'Port & Co Port & Co Core Blend Tee. PC55' });
    expect(d.head).toBe('PC55');
    expect(d.desc).toBe('Port & Co Core Blend Tee · Jet Black');
  });

  test('a sku left as free text never becomes the big line — the garment name does', () => {
    // "1382622 (GREY 011) - 5" against a catalog color of "Mod Gray (011)": the
    // style can't be pulled out safely, so the packer reads the name instead.
    const d = itemDisplay({ sku: '1382622 (GREY 011) - 5', color: 'Mod Gray (011)', name: 'Under Armour Mens Ua Launch Unlined 7" Shorts - Grey' });
    expect(d.head).toBe('Under Armour Mens Ua Launch Unlined 7" Shorts - Grey');
    expect(d.desc).toBe('Mod Gray (011)');
  });
});

describe('logoText — which logo, and where it goes', () => {
  test('reads the label and the placement the store recorded', () => {
    expect(logoText({ _logo: { label: 'Cougar Head', placement: 'full_front' } }))
      .toBe('Cougar Head · full front');
    expect(logoText({ _logo: { label: 'Academy', placement: '' } })).toBe('Academy');
    expect(logoText({})).toBe('');
  });

  test('itemDisplay carries the logo into the line every surface prints', () => {
    const d = itemDisplay({
      sku: 'HR8473', color: 'Black', name: 'Adidas Fleece Hood',
      _logo: { label: 'Cougars Football', placement: 'full_front' },
    });
    expect(d.desc).toBe('Adidas Fleece Hood · Black · Cougars Football · full front');
  });
});

describe('batchItemTotals — two logos are two stacks on the table', () => {
  const line = (pid, logo, size) => ({
    id: pid + size, sku: 'HR8473', product_id: pid, name: 'Adidas Fleece Hood', color: 'Black',
    size, qty: 2, image_url: 'https://art/' + logo + '.png', _image_kind: 'logo',
    _logo: { label: logo, placement: 'full_front' },
  });

  test('the same sku and color in two logos never merge into one row', () => {
    const { rows } = batchItemTotals([{ webstore_order_items: [
      line('smb-HOOD-A', 'Cougar Head', 'M'),
      line('smb-HOOD-B', 'Cougars Football', 'M'),
    ] }]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.logo).sort())
      .toEqual(['Cougar Head · full front', 'Cougars Football · full front']);
    expect(rows[0].image).not.toBe(rows[1].image);
  });

  test('the same logo in two sizes is still one row', () => {
    const { rows } = batchItemTotals([{ webstore_order_items: [
      line('smb-HOOD-A', 'Cougar Head', 'M'),
      line('smb-HOOD-A', 'Cougar Head', 'L'),
    ] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sizes.size).toBe(2);
  });
});
