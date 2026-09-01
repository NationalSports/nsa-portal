import * as XLSX from 'xlsx';

// Silver Screen's Domestic import tab is deliberately strict. Keep these labels,
// spelling, and order byte-for-byte aligned with the supplied workbook.
export const SILVER_SCREEN_DOMESTIC_HEADERS = [
  'REFERENCE # (if applicable)',
  'SHIP TO ATTENTION (required)',
  'COMPANY NAME (if applicable)',
  'QUANTITY (required)',
  'SIZE (required)',
  'COLOR (required)',
  'STYLE # (required)',
  'ITEM DESCRIPTION (required)',
  'SHIP TO ADDRESS LINE 1 (required)',
  'SHIP TO ADDRESS LINE 2 (if applicable)',
  'CITY (required)',
  'STATE (required)',
  'POSTAL CODE (required)',
  'SHIP METHOD (required)',
  'BILLING - 3RD PARTY SHIPPING ACCOUNT # (if applicable)',
  'BILLING - 3RD PARTY POSTAL CODE (if applicable)',
];

const clean = (value) => String(value == null ? '' : value)
  .replace(/[\t\r\n]+/g, ' ')
  .replace(/,/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const orderNo = (order) => clean(order && (order.order_number || order.omg_order_number || order.id));
const orderSorter = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const customerDestination = (customer) => ({
  attention: clean(customer && (customer.shipping_attention || customer.contact_name || customer.name)),
  company: clean(customer && customer.name),
  line1: clean(customer && customer.shipping_address_line1),
  line2: clean(customer && customer.shipping_address_line2),
  city: clean(customer && customer.shipping_city),
  state: clean(customer && customer.shipping_state),
  postal: clean(customer && customer.shipping_zip),
  country: 'US',
});

function orderDestination(order, store, customer) {
  const address = (order && order.ship_address) || null;
  const deliveryMode = clean((order && order.ship_method) || (store && store.delivery_mode)).toLowerCase();
  if (deliveryMode === 'ship_home' || (address && (address.street1 || address.city || address.zip))) {
    return {
      attention: clean((address && address.name) || (order && order.buyer_name)), company: '',
      line1: clean(address && address.street1), line2: clean(address && address.street2),
      city: clean(address && address.city), state: clean(address && address.state), postal: clean(address && address.zip),
      country: clean((address && address.country) || 'US').toUpperCase(),
    };
  }
  return customerDestination(customer || (store && store.customer));
}

const SERVICE_LABELS = {
  ups_ground: 'UPS Ground', ups_2nd_day_air: 'UPS 2nd Day Air', ups_next_day_air: 'UPS Next Day Air',
  fedex_ground: 'FedEx Ground', fedex_2day: 'FedEx 2Day', fedex_priority_overnight: 'FedEx Priority Overnight',
  usps_priority_mail: 'USPS Priority Mail', usps_first_class_mail: 'USPS First Class Mail',
};

function shipMethod(order, store) {
  const rawOrder = clean(order && order.ship_method);
  if (rawOrder && !/^(ship|ship_home|deliver_club)$/i.test(rawOrder)) return SERVICE_LABELS[rawOrder.toLowerCase()] || rawOrder;
  const service = clean(store && store.shipstation_service).toLowerCase();
  if (service) return SERVICE_LABELS[service] || clean(store.shipstation_service).replace(/_/g, ' ');
  const carrier = clean(store && store.shipstation_carrier).toUpperCase();
  return carrier === 'FEDEX' ? 'FedEx Ground' : carrier === 'USPS' ? 'USPS Priority Mail' : 'UPS Ground';
}

function effectiveLine(line) {
  const unmatched = !!line._unmatched;
  const style = unmatched ? (line.sku || line._effSku || '') : (line._sku || line._effSku || line.sku || '');
  const description = unmatched ? (line.name || style || '') : (line._name || line.name || style || '');
  const tag = clean(line._adidasTagSku);
  return {
    style: clean(style),
    description: clean(tag && tag !== clean(style) ? `${description} Adidas tag ${tag}` : description),
    color: clean(line._color || line.color),
    size: clean(line._size || line.size || 'OS'),
    quantity: Math.max(0, Number(line.qty) || 0),
    unmatched,
    verify: !!line._verify,
  };
}

const REQUIRED = [
  [1, 'ship-to attention'], [3, 'quantity'], [4, 'size'], [5, 'color'], [6, 'style #'],
  [7, 'item description'], [8, 'address line 1'], [10, 'city'], [11, 'state'],
  [12, 'postal code'], [13, 'ship method'],
];

export function buildSilverScreenDomesticRows({ store = {}, lines = [], orderById = {}, customer = null, audit = null } = {}) {
  const issues = [];
  const fatalAudit = [
    ...(audit?.missingSos || []).map((soId) => `${soId}: linked sales order could not be loaded`),
    ...(audit?.wrongStoreLinks || []).map((x) => `${x.soId}: linked sales order belongs to another store`),
    ...(audit?.unitMismatches || []).map((x) => `${x.soId}: ${x.sourceUnits} active customer units do not match ${x.soUnits} sales-order units`),
    ...(audit?.unmatched || []).map((x) => `${x.soId || 'Order'}: ${x.item || x} is not matched to the sales order`),
  ];
  issues.push(...fatalAudit);

  // Silver Screen bags and researches by the webstore order number. Keep every
  // line for one order contiguous even when the source lines arrive grouped by
  // product/SKU (the normal database fetch order).
  const orderedLines = (lines || []).map((line, index) => ({ line, index })).sort((a, b) => {
    const ao = orderById[a.line.order_id] || {};
    const bo = orderById[b.line.order_id] || {};
    return orderSorter.compare(orderNo(ao), orderNo(bo))
      || orderSorter.compare(clean(a.line.player_name), clean(b.line.player_name))
      || orderSorter.compare(clean(a.line._sku || a.line._effSku || a.line.sku), clean(b.line._sku || b.line._effSku || b.line.sku))
      || orderSorter.compare(clean(a.line._size || a.line.size), clean(b.line._size || b.line.size))
      || a.index - b.index;
  });

  const rows = [];
  orderedLines.forEach(({ line }, index) => {
    const order = orderById[line.order_id] || {};
    const item = effectiveLine(line);
    const destination = orderDestination(order, store, customer);
    // The Domestic template has no extra player column. Its existing required
    // attention field is the import-safe place for the player's name; the full
    // destination remains in the standard address columns on the same row.
    destination.attention = clean(line.player_name) || destination.attention;
    const row = [
      orderNo(order), destination.attention, destination.company, item.quantity,
      item.size, item.color, item.style, item.description,
      destination.line1, destination.line2, destination.city, destination.state,
      destination.postal, shipMethod(order, store), '', '',
    ];
    const ref = row[0] || `row ${index + 2}`;
    if (item.unmatched) issues.push(`${ref}: item is not matched to the current sales order`);
    if (item.verify) issues.push(`${ref}: substituted item or size still needs verification`);
    if (destination.country && !/^(US|USA|UNITED STATES)$/i.test(destination.country)) issues.push(`${ref}: destination is not domestic (${destination.country})`);
    REQUIRED.forEach(([column, label]) => {
      if (row[column] === '' || row[column] == null || (column === 3 && !(row[column] > 0))) issues.push(`${ref}: missing ${label}`);
    });
    rows.push(row);
  });

  return { headers: SILVER_SCREEN_DOMESTIC_HEADERS, rows, issues: [...new Set(issues)] };
}

const SAFE_FILENAME = /[^A-Za-z0-9._-]+/g;
const dateStamp = () => {
  const d = new Date();
  return `${d.getMonth() + 1}.${d.getDate()}.${d.getFullYear()}`;
};

export function downloadSilverScreenFulfillment({ store = {}, lines = [], orderById = {}, customer = null, audit = null, reference = '' } = {}) {
  const built = buildSilverScreenDomesticRows({ store, lines, orderById, customer, audit });
  if (!built.rows.length) throw new Error('No active fulfillment items to export.');
  if (built.issues.length) {
    const shown = built.issues.slice(0, 5).join('; ');
    throw new Error(`Silver Screen file blocked: ${shown}${built.issues.length > 5 ? `; plus ${built.issues.length - 5} more issue(s)` : ''}.`);
  }

  const worksheet = XLSX.utils.aoa_to_sheet([built.headers, ...built.rows]);
  worksheet['!cols'] = [15.285, 21, 17.426, 8.43, 8.43, 8.43, 8.43, 20.141, 18.141, 19.141, 13.141, 13.141, 16.711, 21, 22.426, 18.141].map((wch) => ({ wch }));
  worksheet['!rows'] = [{ hpt: 47.1 }, ...built.rows.map(() => ({ hpt: 18 }))];
  const border = { style: 'thin', color: { rgb: '000000' } };
  for (let r = 0; r <= built.rows.length; r += 1) {
    for (let c = 0; c < built.headers.length; c += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      cell.s = {
        font: { name: 'Arial', sz: 11, bold: r === 0 },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border: { top: border, bottom: border, left: border, right: border },
      };
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Domestic');
  const base = clean(reference || store.name || 'Order').replace(SAFE_FILENAME, '-').replace(/^-+|-+$/g, '') || 'Order';
  const filename = `${base}_Fulfillment_Template_${dateStamp()}.xlsx`;
  XLSX.writeFile(workbook, filename, { compression: true, cellStyles: true });
  return { filename, rowCount: built.rows.length, unitCount: built.rows.reduce((sum, row) => sum + Number(row[3] || 0), 0) };
}
