# Encinitas Express — in-house stock sync (2026-08-26)

Source: **National Sports Inventory** Google Sheet, `Express` tab (gid `2145104444`),
recounted 2026-08-26.
Target: `public.product_inventory` for the 23 `p-exp-*` products linked from the
Encinitas Express roster kit catalog (`roster_kit_templates`, customer `c-ns-3978`).
Applied by `scripts/sync-encinitas-express-inventory-2026-08-26.sql`.

## Applied

23 products, 86 size rows. **39 quantities changed** across 14 products; the other
9 products already matched. After the run, every product's total on hand equals the
sheet's own per-row Total column.

| Product | Change |
|---|---|
| Womens Jersey Navy `JD7370-EXP-N` | XS **+14 (new size)**, S 33→8, M 28→10, L 13→8 |
| Womens Jersey White `JD7370-EXP-W` | XS **+12 (new)**, S 33→3, M 28→11, L 13→8, XL **+4 (new)** |
| Adult Jersey Navy `JD7371-EXP-N` | S 85→34, M 61→17, L 47→6 |
| Adult Jersey White `JD7371-EXP-W` | S 92→47, M 64→8, L 47→9, XL 4→3 |
| Youth Jersey Navy `JD7373-EXP-N` | YXS 0→2, YS 21→20 |
| Youth Shorts `KB4028-EXP` | YXS 4→10, YS 42→40, YM 48→37 |
| Adult Shorts `KB4029-EXP` | M 5→11, L 0→4, XL 5→1 |
| Womens Shorts `KB4032-EXP` | XS 3→**0**, S 3→5, M 61→52, L 12→9 |
| Womens Jacket `KB4037-EXP` | S **+7 (new)**, M 11→9, L 1→**0** |
| Adult Jacket `KB4042-EXP` | S 53→50, M 32→30, L 14→12 |
| Youth Jacket `JY5390-EXP` | YM 11→2, YL 55→50 |
| Womens Pant `JY5389-EXP` | S 3→2 |
| Adult Pant `KE9910-EXP` | S 21→20, L 2→1 |

Unchanged: both youth-jersey White counts, Youth Pant, all four GK items, backpack,
Adult All Weather Jacket.

### Notes on the mapping

- **Youth rows.** The sheet labels its size columns `XS S M L XL` for every row; on the
  youth rows those are youth sizes and map to the portal's `YXS YS YM YL YXL` scale.
  Confirmed against products whose existing DB counts already matched the sheet
  (`JF2872-EXP`, `JY5395-EXP`, `JD7373-EXP-W`).
- **Column alignment** was verified row-by-row against the sheet's own `Total` column
  before generating the SQL — every row with a Total reconciles.
- **Blank = zero.** The tab is a full physical count, so a size the sheet leaves blank
  is zero on hand, not unknown. Two sizes went to 0 this way (womens shorts XS,
  womens jacket L). Sizes are kept on the product's scale rather than removed.
- **Size scale widened** for three products that were counted this pass in a size
  outside their recorded scale: `JD7370-EXP-N` (+XS), `JD7370-EXP-W` (+XS, +XL),
  `KB4037-EXP` (+S).
- **Prior data issue, now corrected.** Both womens jerseys (Navy and White) previously
  carried *identical* stock — S 33 / M 28 / L 13 — which is why their swing is the
  largest here. The sheet distinguishes the two colors; they now differ.

## Not applied — sheet rows with no Express product to write to

These rows are in the `Express` tab but have no `p-exp-*` product row, so their counts
are not in the portal. Each needs a decision before it can be loaded.

| Sheet row | Counted | Blocker |
|---|---|---|
| `JF2875-EXP` Red SS Adult GK Jersey | S 3, XL 2 (8/20) | No product row. Kit catalog's keeper-jersey slot points only at the **LS** versions. Needs a row + cost. |
| `JD7358-EXP` Red SS Youth GK Jersey | YS 4, YM 2, YL 4, YXL 5 (8/18) | Same. |
| `JF2880-EXP` Red SS Womens GK Jersey | S 2, M 2 (8/18) | Same. |
| `AE152` Astra Tee (Navy / Columbia Blue / Red), `AE153Y` (Columbia Blue) | see sheet (8/10) | No product rows at all. Also `AE153Y`'s Total (31) disagrees with its own size cells (sum 35) — needs a recount before loading. |
| Socks `JW6705` Navy (155) / Red (17), sleeveless sock `HT6546` Navy (158) | 7/27 | DB rows exist but as generic `CUSTOM` catalog items with no size scale, and the Express kit catalog points at a *different* sock (`KB7233` Adisock 26 3S). Which product these counts belong to is a call for staff. |
| `JW1322` soccer balls, size 4 (115) / size 5 (216) | 8/6 | DB row is the generic Adidas MLS Club with `inventory_source='click'` (vendor stock). Writing house counts there would mix club stock into general catalog stock. |

Also worth a look in the sheet itself: the three LS GK rows are still flagged
"needs recount" from 5/5, and row 19 (`JF2871-EXP`) has its Updated date typo'd
as `5026-05-05`.
