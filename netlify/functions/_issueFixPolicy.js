// Single source of truth for what Claude is allowed to write back when applying an
// issue fix. Deliberately conservative: an ALLOWLIST of safe, descriptive/operational
// columns only. Money, pricing, tax, credits, status, identity/foreign keys, audit
// timestamps, shipping/tracking, and fulfillment fields are intentionally NOT here —
// those carry financial or workflow consequences and must stay human-driven.
//
// Both resolve-issue (to mark a proposed fix "applicable") and apply-issue-fix (to
// actually perform the write) import this, so the rule can never drift between the
// suggestion and the execution.

const ALLOWED = {
  sales_orders: [
    'memo', 'production_notes', 'expected_date', 'expected_ship_date',
    'ship_preference', 'ship_on_date', 'deliver_on_date', 'po_number',
    'order_type', 'booking_alert_days',
  ],
  estimates: ['memo'],
  customers: [
    'notes', 'search_tags', 'alpha_tag', 'shipping_attention',
    'billing_address_line1', 'billing_address_line2', 'billing_city', 'billing_state', 'billing_zip',
    'shipping_address_line1', 'shipping_address_line2', 'shipping_city', 'shipping_state', 'shipping_zip',
  ],
};

// Validate a proposed fix {table, id, changes:{col:val}}. Returns the filtered,
// allow-only change set plus any rejected columns, so callers can both enforce the
// policy and explain what was dropped.
function validateFix(fix) {
  if (!fix || typeof fix !== 'object') return { ok: false, reason: 'No fix provided' };
  const { table, id, changes } = fix;
  if (!table || !ALLOWED[table]) return { ok: false, reason: `Table "${table}" is not editable` };
  if (!id || typeof id !== 'string') return { ok: false, reason: 'Missing record id' };
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
    return { ok: false, reason: 'No changes specified' };
  }
  const allowedCols = new Set(ALLOWED[table]);
  const filtered = {};
  const rejected = [];
  for (const [col, val] of Object.entries(changes)) {
    if (allowedCols.has(col)) filtered[col] = val;
    else rejected.push(col);
  }
  if (!Object.keys(filtered).length) {
    return { ok: false, reason: 'None of the proposed columns are editable', rejected };
  }
  return { ok: true, table, id, changes: filtered, rejected };
}

module.exports = { ALLOWED, validateFix };
