# Order-Aware Matching — Design (Sports Inc bill ↔ vendor API order)

Status: **design draft for review.** Complements the size/PO **normalization** work
(round-1 #1384, round-2) rather than replacing it.

---

## TL;DR

For suppliers we **place the order with through a vendor API** — **Momentec (→ Augusta),
SanMar, and S&S** — we can stop *guessing* how a bill's labels map to ours and instead
**match on the vendor's own keys, captured when we place the order.** Store what the vendor
says it will bill (their order #, item #, size/color codes); when the Sports Inc bill comes
back, match on those exact strings. `MEDIU` on the bill meets `MEDIU` on the order →
identical string, zero normalization, exact cost tie-out.

The biggest single win is **Augusta**: it routes through Momentec, and Augusta's 5-char
size truncation (`MEDIUM`→`MEDIU`, `EXTRA LARGE`→`EXTRA`…) was the *entire* size mess.
Capture the Momentec order and that problem disappears at the root.

---

## Why this is worth doing (on top of normalization)

Today every inbound bill is reconciled by **fuzzy normalization** — we infer that `MEDIU`
means `M`, that `3083 OLuSPL` is `PO 3083 OLuSPL`, etc. Round-1/round-2 cut the size-label
failure rate to **~0.5%** and recovered the no-`PO`-prefix matches, which is great for the
suppliers we *don't* control the order channel for. But it is still pattern-matching against
a feed (Sports Inc) that truncates and reformats.

For suppliers we order via API, we have a better source of truth: the **order acknowledgment**.
Match against that and the labels are identical by construction.

## Coverage (important — this is additive, not a replacement)

- ✅ **Solves:** Momentec/Augusta, SanMar, S&S — the API-ordered suppliers.
- ❌ **Does NOT cover:** adidas (~half the volume — 2,458 of 4,947 docs in the last pull),
  Richardson, Champro, Agron, Rawlings, etc. Those are not API-ordered and keep the
  normalization path (and already send mostly clean sizes).

So order-aware matching layers **on top of** the fuzzy path: vendor-key match first, fall
through to normalization for everything else. Nothing regresses.

---

## The flow

**1. At order time (outbound).** When an order is submitted via `momentecSubmitOrder` /
`sanmarSubmitPO` / `ssSubmitOrder` (all already in `src/vendorApis.js`), capture the vendor's
acknowledgment and persist it on the PO line:

- `vendor_order_no` — the vendor's order/confirmation number.
- per line: `vendor_item` (their item #), `vendor_size` (the size **code as they will bill it**),
  `vendor_color`, `vendor_unit_cost`, ordered qty.

**2. At bill time (inbound).** Add a `vendor_key` match tier that runs **first** in
`rematchBill` / `_matchLineToItems`:

- If the bill's `(supplierItemNumber, size, color)` — or its `poNumber` + the stored vendor
  order # — matches a stored `vendor_keys` entry, it's an **exact, high-confidence match**.
  Apply directly, bypassing `_canonBillSize` / `_alignSize` entirely.
- Tag it `matchedPOSource: 'vendor_order'` so the UI can show "matched by vendor order" and
  it becomes an auto-approve candidate.

**3. Fallback.** No vendor-key hit → fall through to today's normalization path. Suppliers
without an API order (adidas et al.) are unaffected.

---

## Data model

**Option A (minimal):** add `vendor_keys jsonb` to `so_item_po_lines`:

```json
{
  "order_no": "MMT-2026-…",
  "lines": [
    { "item": "506CR", "size": "MEDIU", "color": "CARDINAL", "qty": 8, "unit_cost": 5.06 }
  ]
}
```

**Option B (cleaner if one order spans several POs):** a `po_vendor_lines` table
`(po_id, vendor, order_no, item, size, color, qty, unit_cost)`, indexed on `(vendor, item, size)`.

Start with A; promote to B only if a single submit fans out across POs.

## Where it hooks (code)

- **Capture:** extend each submit fn in `vendorApis.js` to return the normalized
  acknowledgment, and persist it on the PO line where the submit is invoked in `App.js`.
- **Match:** `_matchByVendorKeys(bill)` checked at the top of `rematchBill`, plus a per-line
  vendor-key branch in `_matchLineToItems` so size/qty land exactly.
- **Apply:** unchanged — `applyBillToSO` writes billed qty/cost as today.

---

## Phase 0 — verify first (make-or-break)

1. **Do the vendor order responses actually carry the billing keys?** Confirm each of
   `momentecSubmitOrder` / `sanmarSubmitPO` / `ssSubmitOrder` returns the vendor order #,
   item #, and size code **in the form the Sports Inc bill will later use.** (Momentec is the
   Augusta route; SanMar/S&S have their own APIs.) If the codes don't round-trip identically,
   the gain shrinks to "cleaner PO #" only.
2. **PO join:** the bill's `poNumber` is already *our* dealer PO, so sending a clean PO via the
   API order already fixes the PO side — the vendor line keys add the *line-level* precision.
3. **Stability:** vendor item/size codes must be identical between the order ack and the bill
   (same system, so they should be).

## Phase 0 — findings (verified against the code + a 4,947-doc pull)

**The submit functions exist and each returns an order identifier:** `sanmarSubmitPO` →
`transactionId` (and we already resolve a per-line `Unique_Key`/partId before submit);
`ssSubmitOrder` → `{ orderNumber, invoiceNumber }`; `momentecSubmitOrder` → `orderId`. So the
*capture* side is buildable.

**Cross-system numbering caveat — corrects the optimistic "identical string" line in the TL;DR:**
we place the order with the *distributor/vendor* (Momentec, SanMar, S&S) in *their* numbering, but
the Sports Inc bill is keyed in the *brand/SI* numbering (e.g. a Momentec SKU `design.color.size`
is not the Augusta style the SI bill carries). So the **PO number is the reliable cross-system
join** — we control it and it round-trips on the bill — **not** the item #. Size still routes
through normalization on the bill side (the SI feed truncates no matter how we order), now reliable
via round-1/2 and constrained to the order's real sizes. Net: order-aware capture makes the **PO
exact and the expected lines/qtys known**; it does not literally bypass size normalization.

**Per-supplier verdict:**

| Supplier | SI bill quality (4,947-doc pull) | Verdict |
|---|---|---|
| **SanMar** | 4,113 / 4,137 usable EDI lines; item# + **clean** size + color | ✅ **Solid** — already clean+complete; capture per-line `Unique_Key` for exact PO+line. |
| **Augusta (Momentec)** | 1,411 / 1,433 usable; item# + size + color, size/color **truncated** | ✅ **Solid in practice** — PO# join exact, truncation handled by round-1/2; capture `orderId` + qtys for reconciliation. |
| **S&S** | **200 / 200 docs scanned — 0 usable lines** (header-only) | ⚠️ **Blocked on the bill side** — SI bill carries no item/size/qty, and there is **no S&S order/invoice endpoint** today (`ssApiCall` is catalog-only). |

**S&S path to solid:** we already capture `invoiceNumber` at order time, so the options are
(a) **build an S&S invoice/shipment-detail call** (if S&S's API / PromoStandards exposes it) and pull
lines from S&S directly, bypassing the scanned SI doc, or (b) wait for **S&S → EDI** on SportsLink
(the adapter auto-promotes it once real lines arrive). Until then S&S reconciles at document-total
level only.

## Phasing

- **Phase A — Capture (no behavior change).** Persist vendor keys at order time. Pure write;
  nothing reads it yet → zero risk. Lets us measure how often keys round-trip before relying on them.
- **Phase B — Match.** Add the vendor-key tier ahead of the fuzzy path for the three suppliers.
  Metric: % of their bills that hit an exact vendor-key match.
- **Phase C — Auto-approve + UI.** Surface "matched by vendor order"; let clean vendor-key
  matches auto-approve (they're exact), with cost tie-out shown.

## Expected payoff

- Augusta/SanMar/S&S bills match with **no normalization, no `(verify)` flags, exact cost
  reconciliation** — auto-approvable.
- The normalization path (round-1/2) becomes a **fallback** for adidas and the long tail.
- The two approaches are complementary: **vendor-key for what you order via API, normalization
  for everything else.**
