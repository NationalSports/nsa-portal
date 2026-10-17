import { normalizeAdidasSizeName } from './adidasInventory';

export const ADIDAS_CLICK_TASK_TYPE = 'adidas_click_cart_v2';
export const ADIDAS_CLICK_PLAN_VERSION = 2;
export const ADIDAS_CLICK_SOLD_TO = '6017364000';
export const ADIDAS_CLICK_DEFAULT_SHIP_TO = '6017364001';
export const isAdidasClickPayload = (payload) => payload?.target === 'adidas_click';

export const ADIDAS_CLICK_CHOICES = {
  AVAILABLE_NOW: 'available_now',
  COMPLETE_SKU: 'complete_sku',
  EACH_SIZE: 'each_size_when_ready',
  HOLD: 'hold_recheck',
};

export const ADIDAS_CLICK_SHIP_METHODS = [
  'Default',
  'FedEx Ground',
  'FedEx 3 Day',
  'FedEx 2 Day',
  'FedEx Next Business Day',
  'FedEx Next Business Day 10:30',
  'FedEx Saturday Delivery',
  'FedEx Ground - Residential Only',
  'FedEx 3 Day - Residential Only',
  'FedEx 2 Day - Residential Only',
  'FedEx Next Business Day - Residential Only',
  'FedEx Next Business Day 10:30 - Residential Only',
  'FedEx Saturday Delivery - Residential Only',
];

export const ADIDAS_CLICK_LOCATIONS = [
  { number: '6017364001', label: '6017364001 · NSA ATTN: RECEIVING (default)' },
  { number: '6017364000', label: '6017364000' },
  { number: '6017364002', label: '6017364002' },
];

const SIZE_META = new Set([
  'drop_ship', 'unit_cost', 'po_type', 'vendor', 'memo', 'notes', 'status',
  'ship_to', 'attention', 'ship_to_deco_id', 'po_id', 'received', 'shipments',
  'cancelled', 'deco_vendor', 'deco_type', 'created_at', 'expected_date',
  'billed', 'tracking_numbers', 'batch_queue_id', 'batch_po_number',
  'preexisting', 'email_history', 'shipping', 'api_order_id', 'api_ordered_at',
  'vendor_keys',
]);

const pad = (n) => String(n).padStart(2, '0');
export const clickDate = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function sanitizeClickCustomerPo(value) {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/[^A-Za-z0-9 /_.?&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanAdidasOrderSizes(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([size, value]) => {
    if (SIZE_META.has(size) || size.startsWith('_')) return;
    const qty = Number(value);
    if (Number.isInteger(qty) && qty > 0) out[size] = qty;
  });
  return out;
}

// A PO can contain the same article on multiple source lines. CLICK inventory
// is per article+size, so aggregate before evaluating supply; otherwise each
// line can independently spend the same stock.
export function aggregateAdidasOrderLines(lines = []) {
  const grouped = new Map();
  const invalidQuantities = [];
  (lines || []).forEach((line, lineIndex) => {
    const sku = String(line?.sku || '').trim();
    if (!sku) return;
    let groupedLine = grouped.get(sku);
    if (!groupedLine) {
      groupedLine = { ...line, sku, sizes: {}, source_line_indexes: [] };
      grouped.set(sku, groupedLine);
    }
    groupedLine.source_line_indexes.push(lineIndex);
    Object.entries(line?.sizes || {}).forEach(([size, value]) => {
      if (SIZE_META.has(size) || size.startsWith('_') || value == null || value === '' || Number(value) === 0) return;
      const qty = Number(value);
      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
        invalidQuantities.push({ sku, size, value, line_index: lineIndex });
        return;
      }
      groupedLine.sizes[size] = (groupedLine.sizes[size] || 0) + qty;
    });
  });
  return { lines: [...grouped.values()], invalidQuantities };
}

const norm = (value) => String(normalizeAdidasSizeName(value) || '').replace(/\s+/g, '');
const rawNorm = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const variantToken = (value) => norm(value).replace(/"/g, '');

// CLICK labels are inconsistent about spaces and quotes (S 7", XL7", 2XL7).
// Strip only a trailing numeric garment variant; exact labels such as LT/LT2
// still win before this fallback is considered.
export function splitClickSizeLabel(label) {
  const text = String(label || '').trim();
  if (/^[A-Za-z0-9]*T2$/i.test(text.replace(/\s+/g, ''))) return { base: text, variant: null };
  const match = text.match(/^(.*?[A-Za-z])\s*(\d+)"?$/);
  if (!match) return { base: text, variant: null };
  return { base: match[1].trim(), variant: match[2] };
}

export function resolvePortalSize(portalSize, knownClickSizes, preference = null) {
  const sizes = [...new Set((knownClickSizes || []).map((s) => String(s || '').trim()).filter(Boolean))];
  const rawExact = sizes.find((s) => rawNorm(s) === rawNorm(portalSize));
  if (rawExact) return { status: 'resolved', click_size: rawExact, candidates: [rawExact], variant: splitClickSizeLabel(rawExact).variant };
  const exact = sizes.find((s) => {
    const split = splitClickSizeLabel(s);
    return split.variant == null && norm(split.base) === norm(portalSize);
  });
  if (exact) return { status: 'resolved', click_size: exact, candidates: [exact], variant: null };

  const candidates = sizes.filter((s) => norm(splitClickSizeLabel(s).base) === norm(portalSize));
  if (candidates.length && preference) {
    const preferred = candidates.find((s) => variantToken(splitClickSizeLabel(s).variant) === variantToken(preference));
    if (preferred) {
      return { status: 'resolved', click_size: preferred, candidates, variant: splitClickSizeLabel(preferred).variant };
    }
    return { status: 'missing', click_size: null, candidates, variant: null };
  }
  if (candidates.length === 1) {
    const one = candidates[0];
    return { status: 'resolved', click_size: one, candidates, variant: splitClickSizeLabel(one).variant };
  }
  return { status: candidates.length ? 'ambiguous' : 'missing', click_size: null, candidates, variant: null };
}

export function buildAdidasInventoryIndex(rows, freshnessAt = null) {
  const bySku = {};
  let oldestSyncedAt = null;
  let newestSyncedAt = null;
  (rows || []).forEach((row) => {
    const sku = String(row.sku || '').trim();
    const size = String(row.size || '').trim();
    if (!sku || !size) return;
    const entry = {
      stock: Number(row.stock_qty) || 0,
      date: row.future_delivery_date || null,
      future_qty: row.future_delivery_qty == null ? null : Number(row.future_delivery_qty),
      last_synced: row.last_synced || null,
    };
    (bySku[sku] ||= {})[size] = entry;
    if (row.last_synced) {
      if (!oldestSyncedAt || row.last_synced < oldestSyncedAt) oldestSyncedAt = row.last_synced;
      if (!newestSyncedAt || row.last_synced > newestSyncedAt) newestSyncedAt = row.last_synced;
    }
  });
  if (freshnessAt) {
    oldestSyncedAt = freshnessAt;
    newestSyncedAt = freshnessAt;
  }
  return { bySku, oldestSyncedAt, newestSyncedAt };
}

const nextMorning = (dateString) => {
  const d = dateString ? new Date(`${dateString}T12:00:00Z`) : new Date(Date.now() + 86400000);
  if (Number.isNaN(d.getTime())) return new Date(Date.now() + 86400000).toISOString();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
};

export function planAdidasClickOrder({
  lines = [],
  inventoryRows = [],
  inventoryFreshness = null,
  preferences = {},
  defaultChoice = ADIDAS_CLICK_CHOICES.COMPLETE_SKU,
  skuChoices = {},
  today = clickDate(),
  customerPo = '',
  shipMethod = 'Default',
  deliveryLocation = { type: 'saved', number: ADIDAS_CLICK_DEFAULT_SHIP_TO },
  generatedAt = new Date().toISOString(),
} = {}) {
  const inventory = buildAdidasInventoryIndex(inventoryRows, inventoryFreshness);
  const skuPlans = [];
  const importRows = [];
  const issues = [];
  let scheduledFor = null;
  const aggregated = aggregateAdidasOrderLines(lines);
  aggregated.invalidQuantities.forEach((invalid) => {
    issues.push({
      code: 'invalid_quantity',
      sku: invalid.sku,
      portal_size: invalid.size,
      value: invalid.value,
      message: `${invalid.sku} ${invalid.size} must have a whole-number quantity.`,
    });
  });

  aggregated.lines.forEach((line) => {
    const sku = String(line.sku || '').trim();
    if (!sku) return;
    const requestedSizes = cleanAdidasOrderSizes(line.sizes);
    const known = Object.keys(inventory.bySku[sku] || {});
    const choice = skuChoices[sku] || defaultChoice;
    const requested = [];

    Object.entries(requestedSizes).forEach(([portalSize, qty]) => {
      const resolved = resolvePortalSize(portalSize, known, preferences[sku]);
      const item = { portal_size: portalSize, click_size: resolved.click_size, qty, candidates: resolved.candidates };
      requested.push(item);
      if (resolved.status !== 'resolved') {
        issues.push({
          code: resolved.status === 'ambiguous' ? 'size_variant_required' : 'click_size_missing',
          sku,
          portal_size: portalSize,
          candidates: resolved.candidates,
          message: resolved.status === 'ambiguous'
            ? `${sku} ${portalSize} has multiple CLICK variants; choose one.`
            : `${sku} ${portalSize} has no matching CLICK size in the inventory sync.`,
        });
      }
    });

    // A catalog row can temporarily expose both plain and inseam labels (for
    // example S and S 7"). Once both resolve to the same CLICK label, combine
    // them so the import and Hold readiness check never double-count stock.
    const mergedRequested = [];
    requested.forEach((item) => {
      if (!item.click_size) {
        mergedRequested.push(item);
        return;
      }
      const existing = mergedRequested.find((candidate) => candidate.click_size === item.click_size);
      if (existing) {
        existing.qty += item.qty;
        existing.portal_sizes = [...new Set([...(existing.portal_sizes || [existing.portal_size]), item.portal_size])];
        existing.portal_size = existing.portal_sizes.join(' + ');
      } else {
        mergedRequested.push({ ...item, portal_sizes: [item.portal_size] });
      }
    });

    const skuPlan = { sku, choice, requested: mergedRequested, import_rows: [], unfilled: [], ready_date: null };
    if (requested.some((r) => !r.click_size)) {
      skuPlan.status = 'needs_input';
      skuPlans.push(skuPlan);
      return;
    }

    const supply = mergedRequested.map((r) => {
      const inv = inventory.bySku[sku]?.[r.click_size] || {};
      return {
        ...r,
        stock: Math.max(0, Number(inv.stock) || 0),
        restock_date: inv.date || null,
        // CLICK's future quantity is projected ATP at that date, not inbound
        // units to add to today's stock.
        future_atp: Math.max(0, Number(inv.future_qty) || 0),
      };
    });

    if (choice === ADIDAS_CLICK_CHOICES.HOLD) {
      const readyNow = supply.every((r) => r.stock >= r.qty);
      if (readyNow) {
        supply.forEach((r) => skuPlan.import_rows.push({ article: sku, rdd: today, click_size: r.click_size, qty: r.qty }));
        skuPlan.status = 'ready';
        skuPlan.ready_date = today;
      } else {
        const dates = supply.filter((r) => r.stock < r.qty && r.restock_date).map((r) => r.restock_date).sort();
        skuPlan.status = 'scheduled';
        skuPlan.ready_date = dates.length ? dates[dates.length - 1] : null;
        // Keep deterministic rows on the scheduled payload. The database wake-up
        // job refreshes their RDD to the claim date once current stock can fill
        // them, so the external runner never has to reconstruct quantities.
        const heldRdd = skuPlan.ready_date || today;
        supply.forEach((r) => skuPlan.import_rows.push({ article: sku, rdd: heldRdd, click_size: r.click_size, qty: r.qty }));
        const candidate = nextMorning(skuPlan.ready_date);
        if (!scheduledFor || candidate < scheduledFor) scheduledFor = candidate;
      }
    } else if (choice === ADIDAS_CLICK_CHOICES.COMPLETE_SKU) {
      const unavailable = supply.filter((r) => r.stock < r.qty && (!r.restock_date || r.future_atp < r.qty));
      if (unavailable.length) {
        unavailable.forEach((r) => skuPlan.unfilled.push({
          click_size: r.click_size, qty: r.qty, available: Math.max(r.stock, r.future_atp), restock_date: r.restock_date,
        }));
        skuPlan.status = 'unfillable';
        issues.push({ code: 'insufficient_inventory', sku, message: `${sku} cannot be filled completely from current and next-restock inventory.` });
      } else {
        const dates = supply.filter((r) => r.stock < r.qty).map((r) => r.restock_date).sort();
        const rdd = dates.length ? dates[dates.length - 1] : today;
        supply.forEach((r) => skuPlan.import_rows.push({ article: sku, rdd, click_size: r.click_size, qty: r.qty }));
        skuPlan.status = 'ready';
        skuPlan.ready_date = rdd;
      }
    } else if (choice === ADIDAS_CLICK_CHOICES.EACH_SIZE) {
      supply.forEach((r) => {
        const nowQty = Math.min(r.qty, r.stock);
        const remaining = r.qty - nowQty;
        if (nowQty > 0) skuPlan.import_rows.push({ article: sku, rdd: today, click_size: r.click_size, qty: nowQty });
        const laterCapacity = Math.max(0, r.future_atp - nowQty);
        if (remaining > 0 && r.restock_date && laterCapacity > 0) {
          const laterQty = Math.min(remaining, laterCapacity);
          skuPlan.import_rows.push({ article: sku, rdd: r.restock_date, click_size: r.click_size, qty: laterQty });
          if (laterQty < remaining) skuPlan.unfilled.push({ click_size: r.click_size, qty: remaining - laterQty, available: 0, restock_date: null });
        } else if (remaining > 0) {
          skuPlan.unfilled.push({ click_size: r.click_size, qty: remaining, available: 0, restock_date: null });
        }
      });
      skuPlan.status = skuPlan.unfilled.length ? 'partial' : 'ready';
      skuPlan.ready_date = skuPlan.import_rows.map((r) => r.rdd).sort().pop() || null;
    } else {
      supply.forEach((r) => {
        const qty = Math.min(r.qty, r.stock);
        if (qty > 0) skuPlan.import_rows.push({ article: sku, rdd: today, click_size: r.click_size, qty });
        if (qty < r.qty) skuPlan.unfilled.push({ click_size: r.click_size, qty: r.qty - qty, available: 0, restock_date: r.restock_date });
      });
      skuPlan.status = skuPlan.unfilled.length ? 'partial' : 'ready';
      skuPlan.ready_date = skuPlan.import_rows.length ? today : null;
    }
    importRows.push(...skuPlan.import_rows);
    skuPlans.push(skuPlan);
  });

  const safePo = sanitizeClickCustomerPo(customerPo);
  if (!skuPlans.length) issues.push({ code: 'no_order_lines', message: 'This PO has no adidas size quantities to plan.' });
  if (skuPlans.length && !importRows.length && !skuPlans.some((plan) => plan.status === 'scheduled' || plan.status === 'needs_input')) {
    issues.push({ code: 'nothing_orderable', message: 'None of the selected quantities are currently orderable.' });
  }
  if (!safePo) issues.push({ code: 'customer_po_required', message: 'CLICK requires a Customer PO.' });
  if (!ADIDAS_CLICK_SHIP_METHODS.includes(shipMethod)) issues.push({ code: 'invalid_ship_method', message: 'Choose a supported CLICK shipping method.' });
  if (!deliveryLocation || (deliveryLocation.type === 'saved' && !deliveryLocation.number)
    || (deliveryLocation.type === 'one_time'
      && (!deliveryLocation.address?.line1 || !deliveryLocation.address?.city || !deliveryLocation.address?.state || !deliveryLocation.address?.zip))) {
    issues.push({ code: 'delivery_location_required', message: 'Choose a saved CLICK delivery location or enter a one-time address.' });
  }

  return {
    version: ADIDAS_CLICK_PLAN_VERSION,
    generated_at: generatedAt,
    inventory_as_of: inventory.oldestSyncedAt,
    customer_po: safePo,
    ship_method: shipMethod,
    delivery_location: deliveryLocation,
    sku_plans: skuPlans,
    import_rows: importRows,
    scheduled_for: scheduledFor,
    issues,
  };
}

export function clickImportAoa(plan, { cartName = null } = {}) {
  const location = plan?.delivery_location?.type === 'saved'
    ? plan.delivery_location.number
    : ADIDAS_CLICK_DEFAULT_SHIP_TO;
  const rows = [
    [null, null, null, null, 'Cart Name', cartName || sanitizeClickCustomerPo(plan?.customer_po) || 'NSA CLICK Import'],
    [],
    [],
    [null, null, null, null, 'Ship To Location Number', location],
    ['Sold To', 'Article Number', 'RDD', 'Size', 'Comments', 'Qty'],
  ];
  (plan?.import_rows || []).filter((row) => Number(row.qty) > 0).forEach((row) => {
    rows.push([ADIDAS_CLICK_SOLD_TO, row.article, row.rdd, row.click_size, null, Number(row.qty)]);
  });
  return rows;
}

export function buildClickImportWorkbook(plan, options = {}, XLSX) {
  if (!XLSX?.utils) throw new Error('XLSX library is required to build the CLICK import workbook.');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(clickImportAoa(plan, options));
  sheet['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Apparel');
  return workbook;
}

export async function downloadClickImportFile(plan, filename = null) {
  const XLSX = await import('xlsx');
  const safe = sanitizeClickCustomerPo(plan?.customer_po).replace(/\s+/g, '_') || 'adidas_click';
  XLSX.writeFile(buildClickImportWorkbook(plan, {}, XLSX), filename || `${safe}_CLICK_import.xlsx`);
}
