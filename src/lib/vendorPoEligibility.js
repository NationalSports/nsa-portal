// Which vendors may be written a purchase order.
//
// QuickBooks carries overhead accounts as vendors — payroll, rent, insurance,
// utilities, shipping carriers, OrderMyGear. Importing them into the Portal is
// useful (bills reference them) but they are not suppliers: nobody ever writes
// them a PO, and leaving them in the picker means the team scrolls past a dozen
// dead entries every time. `po_eligible=false` keeps a vendor everywhere else
// while removing it from PO selection.
//
// The default is true, so every vendor that predates the flag stays selectable.

export function isVendorPOEligible(vendor) {
  if (!vendor) return false;
  if (vendor.is_active === false) return false;
  return vendor.po_eligible !== false;
}

// Keep the currently-assigned vendor visible even when it is no longer eligible,
// so an existing item does not silently lose the vendor it was ordered from.
export function poEligibleVendors(vendors = [], keepId = '') {
  const keep = String(keepId || '');
  return (vendors || []).filter(v => isVendorPOEligible(v) || (keep && String(v?.id) === keep));
}
