# Stale garment-cost repair — 2026-08-18

## Symptom

SO-1048 (Concordia, "Imported from NetSuite #SO133624") showed `6% margin` on its
Adidas Fresh Tee lines. The badge was correct arithmetic on a wrong input: the line
carried `nsa_cost 11.25` against `unit_sell 12.00`.

## Root cause

`so_items.nsa_cost` is a **snapshot** taken when the line is added (`addP`,
`copyIWithSku`, the NetSuite import's `it.catMatch?.nsa_cost`). It is never re-synced
from the catalog afterwards — by design, so a quoted job keeps its quoted cost.

The catalog cost for the KV21xx / KV22xx / KV46xx Fresh Tee family was wrong
(`11.25` on a $20-retail tee, where the Adidas contract gives `20 x 0.375 = 7.50`).
It was corrected in the catalog on 2026-07-20. Every line added *before* that date
kept the bad number, so those orders have been reporting ~6% garment margin instead
of ~37.5% ever since.

Ground truth: Adidas invoices bill this style at **$7.50** — `applied_bills`
doc `6165868701` (KV2186, 4 bills) and `24580424` (KV2196), `unit_price: 7.50`.

## What was changed

Only lines meeting **all** of these were touched:

- brand in (Adidas, Agron, Under Armour, New Balance), not custom, not clearance
- catalog cost agrees with the contract formula for the line's own retail
  (`retail x 0.375 / 0.4125 / 0.425 / 0.4675`), within $0.03
- line retail matches catalog retail
- line cost is **above** both the catalog and the formula
- colour not `CUSTOM` (custom sublimated uniform programs are hand-costed and were excluded)

| table | rows | phantom cost removed |
|---|---|---|
| `so_items` (12 live orders) | 22 | $1,928.30 |
| `estimate_items` (4 open/approved estimates) | 7 | $722.87 |

SOs: 1023, 1046, 1048, 1131, 1190, 1196, 1351, 1491, 1591, 1708, 1834.
Estimates: EST-1128, EST-1295, EST-1371, EST-1779.

## Rollback

Prior values are preserved in full:

```sql
update so_items i set nsa_cost = b.old_cost
  from so_item_cost_repair_backup_20260818 b where i.id = b.so_item_id;
update estimate_items i set nsa_cost = b.old_cost
  from est_item_cost_repair_backup_20260818 b where i.id = b.est_item_id;
```

## Deliberately NOT changed

- **Completed orders** — SO-1349, SO-1558, SO-1566 carry the same stale cost.
  Restating them changes historical GP and commission figures, so it is a
  business call, not a data fix.
- **Custom uniform programs** (`AD024xx`, `AD031xx`, `IC34xx`, `KB40xx`, `A530`,
  `AT300`) — cost above `retail x 0.375` is normal for these; they are hand-costed
  per program.
- **The catalog itself.** 1,543 active Adidas/UA/NB products carry a cost above the
  contract formula. This is **not** 1,543 bugs: for the 45 such SKUs with real bill
  evidence, the invoice agreed with the catalog 12 times and with the formula only 6
  (27 matched neither). Adidas does not price every line at 50%-off-MSRP-less-25%, so
  a formula-driven catalog sweep would introduce errors. Any catalog cleanup needs
  invoice evidence per SKU.
- **SO-1454** (JJ0566 / JJ0563 at $18.00 vs catalog $22.50) — four real bills say
  $18.00. The line is right and the catalog is high. No change.

## Needs a human decision

**SO-1570** (`need_order`), items 7 and 8 — Adidas Y/M Fleece Pant, 95 units total,
`nsa_cost 0` and `unit_sell 0.01`, and *not* flagged free-promo or customer-supplied.
Catalog cost is $16.88 / $18.75 and three Adidas bills confirm $18.75 for JW6606.
As it stands the order buys ~$1,725 of garments and bills $0.95.
