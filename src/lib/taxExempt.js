// Per-document tax exemption.
//
// A customer can be marked tax exempt on their record, which exempts EVERYTHING they
// ever buy. That's wrong for the common case: a school district is exempt on a
// district-funded uniform order but not on the spirit-wear order the booster club pays
// for, and a resale certificate covers goods bought for resale and nothing else. Marking
// the customer exempt to get one order right silently un-taxes every later order.
//
// So exemption also lives on the individual estimate / sales order, and when it's set
// there it carries a REASON — an auditor asking "why was no tax charged on SO-1481?"
// needs an answer attached to that document, not a rep's memory. The reason is required
// at the point of marking, stamped with who marked it and when, and printed on the
// document itself.
//
// The effective flag stays `tax_exempt`, which every tax calculation already reads
// (calcOrderTotals, the editors' totals, the invoice and QuickBooks sync), so nothing
// downstream has to learn about this. These helpers only decide what goes IN the flag
// and the fields beside it.

// The exemptions a team dealer actually writes. A picklist rather than free text so the
// same exemption reads the same way on every document and can be reported on later;
// "Other" carries the detail the rep types.
export const TAX_EXEMPT_REASONS = [
  'Resale certificate on file',
  'School / district purchase order',
  'Government or public-school entity',
  '501(c)(3) nonprofit',
  'Shipped out of state',
  'Other',
];

export const TAX_EXEMPT_OTHER = 'Other';

// Build the stored reason string from the picked preset plus the rep's note. "Other"
// is only meaningful with a note, so it collapses to the note alone rather than
// recording the useless word "Other". Returns '' when there's nothing to record, which
// is what callers gate the save on.
export function composeTaxExemptReason(preset, note) {
  const p = String(preset || '').trim();
  const n = String(note || '').trim();
  if (p === TAX_EXEMPT_OTHER) return n;
  if (!p) return n;
  return n ? `${p} — ${n}` : p;
}

// A reason is required, so this is what the dialog's save button gates on.
export const canSaveTaxExempt = (preset, note) => composeTaxExemptReason(preset, note).length > 0;

// Mark THIS document exempt. Stamps who and when so the exemption is auditable; the
// caller supplies `by` (the signed-in rep) and may supply `at` for a deterministic test.
export function applyTaxExempt(order, { reason, by, at } = {}) {
  const clean = String(reason || '').trim();
  if (!clean) return order; // never record an exemption with no justification
  return {
    ...order,
    tax_exempt: true,
    tax_exempt_reason: clean,
    tax_exempt_by: String(by || '').trim() || null,
    tax_exempt_at: at || new Date().toISOString(),
  };
}

// Drop the document-level exemption. Clears the whole stamp, not just the flag, so a
// stale reason can't sit on a taxable order and read as though it were still exempt.
export function clearTaxExempt(order) {
  return { ...order, tax_exempt: false, tax_exempt_reason: null, tax_exempt_by: null, tax_exempt_at: null };
}

// Why is this document untaxed? Three different things zero the tax and they are NOT
// interchangeable to a rep reading the screen:
//   omg      — an OMG store order; OMG collected and remits the tax itself.
//   order    — somebody exempted this one document, with a reason (what this file adds).
//   customer — the customer record is exempt, so every one of their orders is.
// A promo-funded order also rides the `tax_exempt` flag with no reason recorded; it
// reports as 'order' with a null reason, which is exactly how it should read — flagged,
// unexplained. Returns exempt:false when tax applies normally.
export function taxExemptInfo(order, customer) {
  const o = order || {};
  const reason = o.tax_exempt_reason ? String(o.tax_exempt_reason).trim() : '';
  if (o.tax_exempt) {
    if (o.omg_store_id) return { exempt: true, scope: 'omg', reason, by: o.tax_exempt_by || '', at: o.tax_exempt_at || '' };
    return { exempt: true, scope: 'order', reason, by: o.tax_exempt_by || '', at: o.tax_exempt_at || '' };
  }
  if (customer && customer.tax_exempt) return { exempt: true, scope: 'customer', reason: '', by: '', at: '' };
  return { exempt: false, scope: null, reason: '', by: '', at: '' };
}

// Short label for the money strip / PDF, e.g. "EXEMPT · Resale certificate on file".
export function taxExemptLabel(order, customer) {
  const info = taxExemptInfo(order, customer);
  if (!info.exempt) return '';
  if (info.scope === 'omg') return 'OMG remits';
  if (info.scope === 'customer') return 'EXEMPT · customer record';
  return info.reason ? `EXEMPT · ${info.reason}` : 'EXEMPT · no reason recorded';
}
