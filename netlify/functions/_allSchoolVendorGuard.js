// Enforced by both existing live purchase proxies, including calls from old tabs.
// The SQL claim consumes the supplier request once before any external I/O.
const { getSupabaseAdmin } = require('./_shared');
const deny = (error, statusCode = 409) => ({ ok: false, statusCode, error });
async function guardAllSchoolVendorRequest({ vendor, poNumber, token }, admin) {
  const ref = String(poNumber || '').trim();
  if (!['SanMar', 'S&S Activewear'].includes(vendor) || !ref) return deny('A valid supplier PO reference is required');
  try {
    const db = admin || getSupabaseAdmin();
    if (token) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(token))) return deny('Invalid All School submission claim');
      const result = await db.rpc('claim_all_school_vendor_request', { p_token: token, p_po_number: ref, p_vendor: vendor, p_supplier_account: vendor === 'SanMar'
        ? String(process.env.SANMAR_CUSTOMER_NUMBER || String(process.env.SANMAR_USERNAME || '').replace(/-.*$/, '')).trim() || null
        : String(process.env.SS_ACCOUNT_NUMBER || '').trim() || null });
      if (result.error) return deny('Supplier purchase verification is unavailable', 503);
      if (!result.data?.claimed) return deny('This supplier request was already started or its All School claim is invalid. Verify the PO before another submission.');
      return { ok: true };
    }
    // An old bundle cannot bypass the durable virtual queue by omitting the token.
    const key = vendor === 'SanMar' ? 'sanmar' : 'sss';
    const queued = await db.from('all_school_batch_allocations').select('id').eq('vendor_key', key).in('state', ['queued', 'submitting', 'unknown']).limit(1);
    if (queued.error) return deny('Supplier purchase verification is unavailable', 503);
    if (queued.data?.length) return deny('This vendor batch includes All School quantities. Reload the portal and reserve the complete batch before submitting.');
    // Combined batches retain their external reference on the allocation even
    // after completion. A stale tab must not resend an already-started request.
    const started = await db.from('all_school_batch_allocations').select('id').eq('vendor_key', key).eq('submitted_po_number', ref).not('vendor_request_started_at', 'is', null).limit(1);
    if (started.error) return deny('Supplier purchase verification is unavailable', 503);
    if (started.data?.length) return deny('This supplier batch was already started. Verify the PO before another submission.');
    const dedicated = await db.from('purchase_orders').select('id').eq('vendor', vendor).eq('po_number', ref).not('all_school_store_id', 'is', null).limit(1);
    if (dedicated.error) return deny('Supplier purchase verification is unavailable', 503);
    if (dedicated.data?.length) return deny('This All School PO requires its durable submission claim. Verify the PO before another submission.');
    return { ok: true };
  } catch (_) { return deny('Supplier purchase verification is unavailable', 503); }
}
module.exports = { guardAllSchoolVendorRequest };
