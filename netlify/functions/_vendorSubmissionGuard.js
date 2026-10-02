// Durable, shared guard. A pending reservation never expires automatically: a timeout
// may mean the supplier accepted the order. Verification must precede any release.
const { getSupabaseAdmin } = require('./_shared');

function guardError(message, status = 409) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function submissionSources(lines, vendorLines) {
  if (!Array.isArray(lines) || !lines.length) {
    throw guardError('Reload the portal before ordering: source order details are required for duplicate protection.', 400);
  }
  const sent = new Map();
  if (!Array.isArray(vendorLines) || !vendorLines.length) throw guardError('Missing vendor order lines.', 400);
  for (const line of vendorLines) {
    const key = String(line.sku || '').trim();
    const qty = Number(line.qty);
    if (!key || !Number.isSafeInteger(qty) || qty <= 0) throw guardError('Invalid vendor order quantities.', 400);
    sent.set(key, (sent.get(key) || 0) + qty);
  }
  const mapped = new Map();
  const sources = lines.map(line => {
    const qty = Number(line.quantity);
    const vendorSku = String(line.partId || line.sku || '').trim();
    if (!line.sourceSO || !line.sourcePO || !line.sourceSku || !line.size
        || !vendorSku || !Number.isSafeInteger(qty) || qty <= 0) {
      throw guardError('Reload the portal before ordering: incomplete source order details.', 400);
    }
    mapped.set(vendorSku, (mapped.get(vendorSku) || 0) + qty);
    return { so_id: line.sourceSO, sku: line.sourceSku, color: line.sourceColor || '',
      size: line.sourceSize || line.size, qty, source_po: line.sourcePO, queue_id: line.sourceBatchId || '' };
  });
  if (sent.size !== mapped.size || [...sent].some(([key, qty]) => mapped.get(key) !== qty)) {
    throw guardError('Vendor quantities do not match the source sales orders. Reload before ordering.', 400);
  }
  return sources;
}

async function reserveSubmission({ vendor, poNumber, lines, vendorLines, actor, admin }) {
  const sources = submissionSources(lines, vendorLines);
  const db = admin || getSupabaseAdmin();
  const { data, error } = await db.rpc('reserve_vendor_api_submission', {
    p_vendor: vendor, p_po_number: String(poNumber || '').trim(), p_sources: sources,
    p_actor: actor || null,
  });
  if (error) {
    const conflict = /DUPLICATE_VENDOR_ORDER|STALE_VENDOR_QUEUE|INVALID_VENDOR_SUBMISSION/.test(error.message || '');
    throw guardError(conflict ? error.message : 'Duplicate protection is unavailable. Nothing was sent; reload before ordering.', conflict ? 409 : 503);
  }
  if (!data?.id) throw guardError('Duplicate protection could not reserve this order. Nothing was sent.', 503);
  return { db, id: data.id, poNumber: data.po_number };
}

async function finishSubmission(reservation, status, result) {
  if (!reservation) return true;
  // Accepted/uncertain reservations keep their quantities reserved even if this write fails.
  // Do not turn a vendor success into a retryable UI error when bookkeeping is unavailable.
  try {
    const { error } = await reservation.db.rpc('finish_vendor_api_submission', {
      p_id: reservation.id, p_status: status, p_result: result || {},
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[vendor submission] Receipt update failed; reservation remains blocked:', reservation.id, error.message);
    return false;
  }
}

const blockedResponse = error => ({ statusCode: error.statusCode || 503,
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: error.message }) });
const uncertainMessage = 'The vendor outcome could not be confirmed. This order is blocked against resubmission. Verify it with the vendor before placing another order.';
module.exports = { submissionSources, reserveSubmission, finishSubmission, blockedResponse, uncertainMessage };
