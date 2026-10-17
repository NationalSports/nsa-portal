import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import { playerReportGroupKey } from '../lib/playerReportGrouping';

// Execute the actual print builders without mounting the staff app or querying
// production. Capture HTML and check the items/contacts within each slip.
function loadBuilder(file, name, helpers) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const fn = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  return new Function(...Object.keys(helpers), `return (${source.slice(fn.start, fn.end)});`)(...Object.values(helpers));
}

const orders = {
  a: { id: 'a', omg_order_number: '1010847', buyer_name: 'Jose Sanchez', buyer_email: 'family@example.com', payment_mode: 'paid', ship_address: { city: 'Los Angeles', state: 'CA' } },
  b: { id: 'b', omg_order_number: '1010853', buyer_name: 'Emanuel Sanchez', buyer_email: 'family@example.com', payment_mode: 'team_tab', ship_address: { city: 'Ashland', state: 'OR' } },
};
const lines = [
  { order_id: 'a', name: 'White jacket', qty: 1 },
  { order_id: 'b', name: 'Royal jacket', qty: 3 },
  { order_id: 'a', name: 'Black tee', qty: 2 },
];

let html;
const helpers = {
  playerReportGroupKey,
  esc: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  printHtml: s => { html = s; },
  _itemName: i => i.name,
  reportSyncBanner: () => '',
  lineFields: i => ({ ...i, size: '3XL' }),
  orderNo: o => String(o.order_number || o.omg_order_number || o.id || ''),
};
const webstore = loadBuilder('Webstores.js', 'buildPlayerReport', helpers);
const salesOrder = loadBuilder('lib/soPlayerReport.js', 'renderReport', helpers);
const builders = [
  ['webstore', ls => webstore({ name: 'San Gabriel', delivery_mode: 'ship_home' }, ls, orders, [], {}, {}), '.slip:not(:first-child)'],
  ['sales order', ls => salesOrder({ so: { id: 'SO-2264' }, storeName: 'San Gabriel', lines: ls, orderById: orders, substitutions: [], unmatched: [] }), '.ord'],
];

describe.each(builders)('%s player report', (label, render, selector) => {
  function slips(ls) {
    render(ls);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll(selector)];
  }

  test('shared buyer email produces separate slips with only each order’s items', () => {
    const blocks = slips(lines);
    expect(blocks).toHaveLength(2);
    const jose = blocks.find(b => b.textContent.includes('1010847'));
    const emanuel = blocks.find(b => b.textContent.includes('1010853'));
    expect(jose.textContent).toContain('White jacket');
    expect(jose.textContent).toContain('Black tee');
    expect(jose.textContent).not.toContain('Royal jacket');
    expect(emanuel.textContent).toContain('Royal jacket');
    expect(emanuel.textContent).not.toContain('White jacket');
    expect(blocks.map(b => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('3 items'), expect.stringContaining('3 items')]));
    if (label === 'webstore') {
      expect(jose.textContent).toContain('Los Angeles');
      expect(jose.textContent).not.toContain('Ashland');
      expect(jose.querySelector('.pay').textContent).toBe('PAID');
      expect(emanuel.textContent).toContain('Ashland');
      expect(emanuel.querySelector('.pay').textContent).toBe('TEAM TAB');
    }
  });

  test('matching player names and numbers still cannot merge separate orders', () => {
    expect(slips(lines.map(l => ({ ...l, player_name: 'Alex', player_number: 7 })))).toHaveLength(2);
  });

  test('two players within one order receive separate slips; repeated player lines stay together', () => {
    const blocks = slips(lines.map((l, i) => ({ ...l, order_id: 'a', player_name: i === 1 ? 'Bo' : ' Ana ', player_number: 0 })));
    expect(blocks).toHaveLength(2);
    expect(blocks.find(b => b.textContent.includes('Ana')).textContent).toContain('3 items');
  });
});

test('order ID is authoritative even if order numbers and contact details match', () => {
  expect(playerReportGroupKey({ order_id: 'a' }, orders.a)).not.toBe(playerReportGroupKey({ order_id: 'b' }, orders.a));
});

test('player names and numbers containing delimiters cannot collide', () => {
  expect(playerReportGroupKey({ order_id: 'a', player_name: 'Alex|7', player_number: '8' })).not.toBe(
    playerReportGroupKey({ order_id: 'a', player_name: 'Alex', player_number: '7|8' }));
});
