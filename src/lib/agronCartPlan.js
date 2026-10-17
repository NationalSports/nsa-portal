export const AGRON_VENDOR_ID = 'v1777312659133';
export const AGRON_CART_TASK_TYPE = 'vendor_cart_v1';
export const AGRON_CART_CONTRACT_VERSION = 1;

const text = (value) => String(value || '').trim();
const norm = (value) => text(value).toUpperCase();

export function isAgronVendor(value) {
  const vendor = text(value).toLowerCase();
  return vendor === AGRON_VENDOR_ID.toLowerCase() || /(^|[^a-z0-9])agron([^a-z0-9]|$)/i.test(vendor);
}

export function isAgronCartPayload(payload) {
  return payload?.task_type === AGRON_CART_TASK_TYPE
    || payload?.target === 'agron'
    || isAgronVendor(payload?.vendor_name)
    || isAgronVendor(payload?.vendor_id);
}

// Tie the queue's audit lines back to durable PO rows. The batch snapshot has
// SO/item/PO identity; the database rows supply the numeric po_line_id and the
// vendor value that is authoritative for routing.
export function attachAgronPoLineMetadata(lines = [], itemRows = [], poRows = []) {
  const itemByKey = new Map();
  (itemRows || []).forEach((item) => {
    itemByKey.set(`${item.so_id}|${item.item_index}`, item);
  });

  return (lines || []).map((line) => {
    const item = itemByKey.get(`${line.so_id}|${line.item_idx}`);
    const candidates = (poRows || []).filter((po) =>
      item && po.so_item_id === item.id && text(po.po_id) === text(line.source_po_id));
    const exact = candidates.find((po) =>
      text(po.sizes?.batch_queue_id) && text(po.sizes?.batch_queue_id) === text(line.source_batch_id));
    const ambiguous = !exact && candidates.length > 1;
    const po = exact || (candidates.length === 1 ? candidates[0] : null);
    return {
      ...line,
      po_line_id: po?.id ?? null,
      po_vendor: po?.vendor ?? null,
      expected_date: po?.expected_date || null,
      po_line_match: ambiguous ? 'ambiguous' : (po ? 'resolved' : 'missing'),
    };
  });
}

function inventoryIndex(rows = []) {
  const index = new Map();
  rows.forEach((row) => {
    const key = `${norm(row.sku)}|${norm(row.size)}`;
    if (key !== '|') index.set(key, row);
  });
  return index;
}

const positiveSizes = (sizes) => Object.entries(sizes || {})
  .filter(([, qty]) => Number.isFinite(Number(qty)) && Number(qty) > 0);

const oneValue = (values) => {
  const unique = [...new Set(values.map(text).filter(Boolean))];
  return unique.length === 1 ? unique[0] : null;
};

export function buildAgronCartTask({
  sourcePayload,
  inventoryRows = [],
  poLines = [],
  customerPo = null,
  shipVia = null,
  arriveOn = null,
  cancelOn = null,
} = {}) {
  const lines = attachAgronPoLineMetadata(
    sourcePayload?.lines || [],
    poLines.itemRows || [],
    poLines.poRows || [],
  );
  const inventory = inventoryIndex(inventoryRows);
  const rows = [];
  const issues = [];

  lines.forEach((line, lineIndex) => {
    if (line.po_line_match === 'ambiguous') {
      issues.push({
        code: 'po_line_ambiguous',
        line_index: lineIndex,
        sku: line.sku || null,
        message: `${line.sku || 'PO line'} matched multiple so_item_po_lines rows.`,
      });
    } else if (line.po_line_id == null) {
      issues.push({
        code: 'po_line_missing',
        line_index: lineIndex,
        sku: line.sku || null,
        message: `${line.sku || 'PO line'} could not be tied to so_item_po_lines.`,
      });
    } else if (!isAgronVendor(line.po_vendor)) {
      issues.push({
        code: 'po_vendor_mismatch',
        line_index: lineIndex,
        po_line_id: line.po_line_id,
        vendor: line.po_vendor,
        message: `${line.sku || 'PO line'} is not assigned to the Agron vendor.`,
      });
    }

    positiveSizes(line.sizes).forEach(([size, rawQty]) => {
      const match = inventory.get(`${norm(line.sku)}|${norm(size)}`) || null;
      const row = {
        sku: text(line.sku),
        size: text(size),
        upc: text(match?.upc) || null,
        product_number: text(match?.product_number) || null,
        color_code: text(match?.color_code) || null,
        qty: Number(rawQty),
        unit_cost: Number(line.size_costs?.[size] ?? line.unit_cost) || 0,
        so_id: line.so_id || null,
        po_line_id: line.po_line_id,
      };
      rows.push(row);
      if (!row.upc) {
        issues.push({
          code: 'upc_missing',
          row_index: rows.length - 1,
          sku: row.sku,
          size: row.size,
          po_line_id: row.po_line_id,
          message: `${row.sku}/${row.size} has no Agron UPC match.`,
        });
      }
    });
  });

  const dropShip = sourcePayload?.drop_ship === true
    || lines.some((line) => line.drop_ship || line.ship_to_deco_id || line.ship_to);
  const expectedDate = oneValue(lines.map((line) => line.expected_date));
  const address = dropShip ? (sourcePayload?.ship_to || null) : null;

  return {
    task_type: AGRON_CART_TASK_TYPE,
    vendor: 'agron',
    target: 'agron',
    contract_version: AGRON_CART_CONTRACT_VERSION,
    customer_po: text(customerPo ?? sourcePayload?.po_number) || null,
    ship_to: { type: dropShip ? 'drop_ship' : 'default', address },
    ship_via: text(shipVia) || null,
    arrive_on: text(arriveOn) || expectedDate,
    cancel_on: text(cancelOn) || null,
    plan: { rows },
    issues,
    // Audit only. Runners must execute plan.rows and never reinterpret lines.
    lines,
  };
}
