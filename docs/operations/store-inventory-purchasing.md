# Store inventory purchasing

The Inventory tab in a 24/7 store now creates warehouse replenishment POs for garments and stocked artwork. The PO uses the shared NSA number allocator and is a draft; creating or downloading it does not submit anything to a supplier. The supplier CSV includes artwork version, dimensions, and application instructions where configured. Production files still come from Art & Logos.

Receive each delivery line with the quantity actually received and its actual unit cost (including allocated freight). Partial receipts and retries are supported. Closing an unreceived balance preserves all received stock and costs; it does not contact the supplier. PO balances are shown separately from the legacy manually entered Incoming field to prevent double receiving.

Stock is valued at weighted average cost. Existing quantities must have an opening cost before receiving new units. Garment opening costs can be entered in Inventory purchase orders; decoration costs use the existing decoration inventory cost field. A literal zero is supported and differs from an unknown cost.

Warehouse pulls capture garment cost in the same transaction as the stock decrement. Decoration consumption freezes its cost against the allocation. Stable source identifiers preserve those values when an SO is saved or its database item rows are rebuilt. Sales-order costing replaces the estimate only for consumed units not already covered by an order-specific garment PO. The Costs tab shows consumed stock, receipt/PO references, and missing-cost warnings.

## Release

Apply `supabase/migrations/20261008142755_store_inventory_purchase_costs.sql` with this application release. It has not been applied by the implementation branch. It adds receipt and consumption audit tables, RLS and staff-only RPCs, plus costing triggers. Do not enable the new UI against a database without this migration. Existing historical stock usage is not automatically revalued as a current receipt.

Validation:

- `NODE_PATH=<isolated-pglite-install>/node_modules node scripts/pgtest/verify_store_inventory_costs.cjs` executes the real migration and receipt/pull scenarios in a disposable Postgres runtime.
- `src/__tests__/storeInventoryCosts.test.js` checks shared costing, mixed PO/stock orders, zero versus missing cost, duplicate hydration, and logo variants.
- `src/__tests__/inventoryPurchasing.test.js` exercises form submission, retry identity, and invalid quantity validation.

Inventory replenishment POs are not allocations or promises to specific customer orders. Existing automatic purchasing still handles uncovered paid-order demand. Staff should coordinate replenishment timing with customer-order purchasing; an inventory draft is not supplier-confirmed stock.
