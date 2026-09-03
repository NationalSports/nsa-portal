// A purchase order's recorded supplier is authoritative. The catalog/item supplier
// describes where the product normally comes from, but it must never silently relabel
// a real PO: a disagreement is an integrity warning that callers should surface.
export function resolvePoDisplayVendor(item, po, vendors = []) {
  if (!po) return '';
  if (po.po_type === 'outside_deco') return po.deco_vendor || po.vendor || '';

  const recordedVendor = po.vendor || '';
  const recordedVendorRow = recordedVendor && vendors.find(v => v && v.id === recordedVendor);
  if (recordedVendorRow && recordedVendorRow.name) return recordedVendorRow.name;
  if (recordedVendor) return recordedVendor;

  const itemVendorKey = item && (item.vendor_id || item.brand);
  const itemVendor = itemVendorKey && vendors.find(v => v && v.id === itemVendorKey);
  if (itemVendor && itemVendor.name) return itemVendor.name;
  return (item && item.brand) || '';
}
