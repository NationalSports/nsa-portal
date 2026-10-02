// Preserve the existing portal API; implementation is shared with server purchasing.
import * as SHARED from './vendorOrderGuards.shared';
export const { exactVendorLineQuantities, vendorLineLabel, mergeRepeatsOrderLine, collapseVendorLines, reconcileVendorLines, freeShipGap } = SHARED;
