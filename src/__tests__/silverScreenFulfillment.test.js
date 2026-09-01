import { buildSilverScreenDomesticRows, SILVER_SCREEN_DOMESTIC_HEADERS } from '../lib/silverScreenFulfillment';

const STORE = { name: 'SJM Volleyball', delivery_mode: 'deliver_club', shipstation_carrier: 'ups' };
const CUSTOMER = {
  name: 'St. Joseph School', shipping_attention: 'Athletics Office',
  shipping_address_line1: '123 School Rd', shipping_address_line2: 'Gym',
  shipping_city: 'Reno', shipping_state: 'NV', shipping_zip: '89501',
};

describe('Silver Screen Domestic fulfillment export', () => {
  test('uses the supplied template headers in the exact order', () => {
    expect(SILVER_SCREEN_DOMESTIC_HEADERS).toEqual([
      'REFERENCE # (if applicable)', 'SHIP TO ATTENTION (required)', 'COMPANY NAME (if applicable)',
      'QUANTITY (required)', 'SIZE (required)', 'COLOR (required)', 'STYLE # (required)',
      'ITEM DESCRIPTION (required)', 'SHIP TO ADDRESS LINE 1 (required)',
      'SHIP TO ADDRESS LINE 2 (if applicable)', 'CITY (required)', 'STATE (required)',
      'POSTAL CODE (required)', 'SHIP METHOD (required)',
      'BILLING - 3RD PARTY SHIPPING ACCOUNT # (if applicable)',
      'BILLING - 3RD PARTY POSTAL CODE (if applicable)',
    ]);
  });

  test('writes current SO replacement fields and the order destination', () => {
    const order = {
      id: 'o1', order_number: 1010525, ship_method: 'ship_home', buyer_name: 'Stacy Tyler',
      ship_address: { name: 'Stacy Tyler', street1: '12 Oak St', street2: 'Apt 4', city: 'Reno', state: 'NV', zip: '89502', country: 'US' },
    };
    const line = {
      order_id: 'o1', sku: 'OLD-1', name: 'Old Item', color: 'White', size: 'XS', qty: 2,
      player_name: 'Alexandra Spitzer',
      _sku: 'NEW-2', _name: 'Current SO Item', _color: 'Black', _size: 'S', _wasSku: 'OLD-1', _wasSize: 'XS',
    };
    const built = buildSilverScreenDomesticRows({ store: STORE, lines: [line], orderById: { o1: order }, customer: CUSTOMER });
    expect(built.issues).toEqual([]);
    expect(built.rows[0]).toEqual([
      '1010525', 'Alexandra Spitzer', '', 2, 'S', 'Black', 'NEW-2', 'Current SO Item',
      '12 Oak St', 'Apt 4', 'Reno', 'NV', '89502', 'UPS Ground', '', '',
    ]);
  });

  test('uses the linked customer shipping address for deliver-to-club orders', () => {
    const order = { id: 'o2', order_number: 88, ship_method: 'deliver_club', buyer_name: 'Parent' };
    const line = { order_id: 'o2', sku: 'TEE-1', name: 'Team Tee', color: 'Navy', size: 'M', qty: 1, player_name: 'Jamie Player' };
    const built = buildSilverScreenDomesticRows({ store: STORE, lines: [line], orderById: { o2: order }, customer: CUSTOMER });
    expect(built.issues).toEqual([]);
    expect(built.rows[0].slice(0, 14)).toEqual([
      '88', 'Jamie Player', 'St. Joseph School', 1, 'M', 'Navy', 'TEE-1', 'Team Tee',
      '123 School Rd', 'Gym', 'Reno', 'NV', '89501', 'UPS Ground',
    ]);
  });

  test('sorts numerically by order and keeps every order together', () => {
    const orders = {
      early: { id: 'early', order_number: 99, ship_method: 'deliver_club' },
      first: { id: 'first', order_number: 1010394, ship_method: 'deliver_club' },
      later: { id: 'later', order_number: 1010410, ship_method: 'deliver_club' },
    };
    const lines = [
      { order_id: 'later', sku: 'C', name: 'C', color: 'Navy', size: 'M', qty: 1, player_name: 'Later Player' },
      { order_id: 'first', sku: 'B', name: 'B', color: 'White', size: 'S', qty: 1, player_name: 'Example Player' },
      { order_id: 'early', sku: 'D', name: 'D', color: 'Black', size: 'L', qty: 1, player_name: 'Early Player' },
      { order_id: 'first', sku: 'A', name: 'A', color: 'White', size: 'M', qty: 1, player_name: 'Example Player' },
    ];
    const built = buildSilverScreenDomesticRows({ store: STORE, lines, orderById: orders, customer: CUSTOMER });
    expect(built.issues).toEqual([]);
    expect(built.rows.map((row) => row[0])).toEqual(['99', '1010394', '1010394', '1010410']);
    expect(built.rows.slice(1, 3).every((row) => row[1] === 'Example Player')).toBe(true);
    expect(built.rows.slice(1, 3).every((row) => row.slice(8, 14).join('|') === '123 School Rd|Gym|Reno|NV|89501|UPS Ground')).toBe(true);
  });

  test('blocks incomplete or unreconciled rows instead of producing a misleading file', () => {
    const order = { id: 'o3', order_number: 99, ship_method: 'ship_home', ship_address: { name: 'Buyer' } };
    const line = { order_id: 'o3', sku: '', name: 'Item', color: '', size: 'L', qty: 1, _unmatched: true };
    const built = buildSilverScreenDomesticRows({ store: STORE, lines: [line], orderById: { o3: order }, customer: CUSTOMER });
    expect(built.issues.join(' ')).toMatch(/not matched/i);
    expect(built.issues.join(' ')).toMatch(/missing color/i);
    expect(built.issues.join(' ')).toMatch(/missing style/i);
    expect(built.issues.join(' ')).toMatch(/missing address line 1/i);
  });
});
