# Decoration Vendor Pricing & Deco PO Enhancement Plan

## Overview
Add decoration vendor pricing settings, improve the Deco PO creation flow to pre-fill costs from vendor pricing, update outside deco line item costs accordingly, and show purple badges on items with Deco POs.

---

## 1. Database: Deco Vendor Pricing Tables

### New table: `deco_vendors`
Replaces the hardcoded `DECO_VENDORS` array. Stores decoration vendor info and their pricing.

```sql
CREATE TABLE deco_vendors (
  id TEXT PRIMARY KEY,             -- e.g., 'dv_1234'
  name TEXT NOT NULL,              -- e.g., 'Silver Screen'
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

### New table: `deco_vendor_pricing`
Stores pricing matrices per vendor, per deco type.

```sql
CREATE TABLE deco_vendor_pricing (
  id SERIAL PRIMARY KEY,
  deco_vendor_id TEXT NOT NULL REFERENCES deco_vendors(id) ON DELETE CASCADE,
  deco_type TEXT NOT NULL,          -- 'embroidery', 'screen_print', 'dtf'
  pricing_tiers JSONB NOT NULL,     -- the full pricing matrix (structure varies by deco_type)
  upcharges JSONB DEFAULT '{}',     -- e.g., {"underbase": 0.10, "fleece": 0.10, "mesh": 0.15}
  updated_at TEXT
);
```

**`pricing_tiers` JSONB structure by deco type:**

**Embroidery** (stitch count × qty breaks):
```json
{
  "tiers": [
    { "label": "0-5k", "min_stitches": 0, "max_stitches": 5000, "qty_breaks": [
      { "min_qty": 1, "max_qty": 11, "price": 6.00 },
      { "min_qty": 12, "max_qty": 23, "price": 5.00 },
      { "min_qty": 24, "max_qty": 47, "price": 4.50 },
      { "min_qty": 48, "max_qty": null, "price": 4.00 }
    ]},
    { "label": "5k-10k", "min_stitches": 5001, "max_stitches": 10000, "qty_breaks": [...] }
  ]
}
```

**Screen Print** (color count × qty breaks + % upcharges):
```json
{
  "tiers": [
    { "label": "1 color", "colors": 1, "qty_breaks": [
      { "min_qty": 1, "max_qty": 11, "price": 4.00 },
      { "min_qty": 12, "max_qty": 23, "price": 3.00 },
      ...
    ]},
    { "label": "2 colors", "colors": 2, "qty_breaks": [...] }
  ]
}
// upcharges: {"underbase": 0.10, "fleece": 0.10, "mesh": 0.15}
```

**DTF** (size category × qty breaks):
```json
{
  "tiers": [
    { "label": "Small", "size_key": "small", "qty_breaks": [
      { "min_qty": 1, "max_qty": 11, "price": 5.00 },
      ...
    ]},
    { "label": "Medium", "size_key": "medium", "qty_breaks": [...] },
    { "label": "Large", "size_key": "large", "qty_breaks": [...] },
    { "label": "Gang Sheet", "size_key": "gang_sheet", "qty_breaks": [...] }
  ]
}
```

---

## 2. Settings UI: Deco Vendor Management

**Location:** Add a "Deco Vendors" section in the existing Settings area.

### Features:
- **Vendor list** — add, edit, deactivate decoration vendors
- **Per-vendor pricing editor** — for each vendor, configure pricing for embroidery, screen print, and DTF:
  - **Embroidery tab**: Editable table — rows = stitch count tiers, columns = qty breaks, cells = price
  - **Screen print tab**: Editable table — rows = color counts (1-6+), columns = qty breaks, cells = price. Plus upcharge toggles with percentages (underbase, fleece, mesh)
  - **DTF tab**: Editable table — rows = size categories, columns = qty breaks, cells = price

### UI Mockup:
```
Deco Vendors
┌──────────────────────────────────────────────────────────┐
│ Silver Screen          [Edit Pricing] [Deactivate]       │
│ Olympic Embroidery     [Edit Pricing] [Deactivate]       │
│ WePrintIt              [Edit Pricing] [Deactivate]       │
│ [+ Add Vendor]                                           │
└──────────────────────────────────────────────────────────┘

Edit Pricing — Silver Screen
  [Embroidery] [Screen Print] [DTF]

  Embroidery Pricing:
  ┌────────────┬────────┬────────┬────────┬────────┐
  │ Stitches   │ 1-11   │ 12-23  │ 24-47  │ 48+    │
  ├────────────┼────────┼────────┼────────┼────────┤
  │ 0-5k       │ $6.00  │ $5.00  │ $4.50  │ $4.00  │
  │ 5k-10k     │ $7.50  │ $6.50  │ $5.50  │ $5.00  │
  │ 10k-15k    │ $9.00  │ $8.00  │ $7.00  │ $6.00  │
  │ 15k-20k    │ $11.00 │ $9.50  │ $8.50  │ $7.50  │
  │ 20k+       │ $13.00 │ $11.00 │ $10.00 │ $9.00  │
  ├────────────┴────────┴────────┴────────┴────────┤
  │ [+ Add Stitch Tier]        [+ Add Qty Break]   │
  └────────────────────────────────────────────────┘
```

---

## 3. Deco PO Modal Enhancement

### Current flow:
Create PO → Outside Decoration PO → Select vendor → Shows ALL items → Create

### Updated flow:
1. Create PO → Outside Decoration PO → Select vendor (from `deco_vendors` table instead of hardcoded list)
2. Show all items with checkboxes to select which to include
3. **Pre-fill Unit Cost** per item from vendor pricing:
   - Look up the vendor's pricing for the deco type
   - For embroidery: use stitch count from the art file + SO qty to find price
   - For screen print: use color count from art/decoration + SO qty, apply upcharges
   - For DTF: use selected size category + SO qty
4. Allow manual override of pre-filled costs
5. Create PO lines only for selected items

### Item selection UI:
```
┌──────────────────────────────────────────────────────────┐
│ ☑ 229527 Holloway Potomac Jacket — Black    SO Qty: 4   │
│   Send Qty: OSFA [4]    Unit Cost: [$5.00] (auto)       │
│                                                          │
│ ☐ JW6604 Adidas M Fleece Pant — Black       SO Qty: 2   │
│   (unchecked — not included)                             │
│                                                          │
│ ☑ JW6620 Adidas W Fleece Pant — Black       SO Qty: 2   │
│   Send Qty: S [1] M [1]  Unit Cost: [$5.00] (auto)      │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Outside Deco Line Item Cost Integration

When a vendor is selected on an outside_deco decoration line, auto-lookup the vendor's pricing and pre-fill `cost_each` based on:
- The deco type selected
- Relevant parameters (stitch count, color count, or DTF size)
- The item quantity on the SO

User can still manually override.

---

## 5. Purple Badge on Items

After a Deco PO is created, show a small purple badge on each item that's included in a deco PO.

**Location:** On the item card, near the item header (next to SKU/color).

```
229527  Holloway Potomac Jacket    Black   [DPO-3056-LH]  Custom
                                            ^^^^^^^^^^^^
                                            purple badge
```

- Clicking the badge could scroll to / highlight the PO in the PO section
- If an item is on multiple Deco POs, show multiple badges

---

## 6. Implementation Steps

### Step 1: Migration — create `deco_vendors` and `deco_vendor_pricing` tables
### Step 2: Data loading — load deco vendors + pricing on app init, replace hardcoded `DECO_VENDORS`
### Step 3: Settings UI — deco vendor list + pricing matrix editor
### Step 4: Price lookup helper — function that takes (vendor_id, deco_type, params, qty) → price
### Step 5: Outside deco line — auto-fill cost_each when vendor/deco_type changes
### Step 6: Deco PO modal — add item checkboxes, pre-fill costs from vendor pricing
### Step 7: Purple badges — show DPO badge on items included in deco POs

---

## Files Modified
- `src/App.js` — Settings UI, Deco PO modal, outside deco line, badges, data loading
- `supabase/migrations/00030_deco_vendor_pricing.sql` — new tables + seed DECO_VENDORS data
