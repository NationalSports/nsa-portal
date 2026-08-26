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

## Follow-up — products created for rows that had nowhere to land

Applied by `scripts/add-encinitas-express-gk-ss-and-socks-2026-08-26.sql`.

Four sheet rows had no `p-exp-*` product, so the first pass left their counts out of the
portal. Those products now exist and carry their counts:

| Product | Sizes loaded | On hand | Cost / retail |
|---|---|---|---|
| `p-exp-JF2875-EXP` — Adult GK Jersey SS | S 3, XL 2 | 5 | 30.93 / $75 |
| `p-exp-JD7358-EXP` — Youth GK Jersey SS | YS 4, YM 2, YL 4, YXL 5 | 15 | 28.87 / $70 |
| `p-exp-JF2880-EXP` — Womens GK Jersey SS | S 2, M 2 | 4 | 30.93 / $75 |
| `p-exp-HT6546-EXP` — Team Sleeve Sock (Navy) | OSFA 158 | 158 | 6.60 / $16 |

**Pricing.** Every Encinitas kit product prices at `retail = nsa_cost × 2.425` off a round
retail ladder, and the sheet carries no cost for any Express row. The sleeve sock takes
the figures already on the general-catalog `HT6546` row ($16 / 6.60) — same garment, same
price, no assumption. The three GK jerseys copy their long-sleeve siblings, which
**assumes the short-sleeve cuts price the same as the long-sleeve ones**; re-price in the
SQL if the club's list says otherwise.

**Size scale** follows the convention already used for this club's GK items
(`JF2887-EXP`, `JF2872-EXP`): the scale is the set of sizes actually counted, not the
garment's full size run.

**Kit catalog untouched.** The roster kit's `keeper_jersey` slot still points at the
long-sleeve products, and its `socks` slot at the general `KB7233` Adisock 26 3S — so the
new rows carry stock but are not yet orderable through the roster flow. Repointing a kit
slot is a business decision, not a data fix.

## Still open

| Sheet row | Counted | Blocker |
|---|---|---|
| Socks `JW6705` Navy (155) / Red (17) | 7/27 | The counts don't line up with the sheet's size header. Navy's 12 / 53 / 90 sit in the `S` `M` `L` columns while the row above labels them `KXXL` / `KXL`; red's 6 / 11 sit in `XS` / `S`. Which sizes these are needs a human call before the stock is loaded. |
| `AE152` Astra Tee (Navy / Columbia Blue / Red), `AE153Y` (Columbia Blue) | 8/10 | No product rows. `AE153Y`'s Total (31) also disagrees with its own size cells (sum 35) — worth a recount before loading. |
| `JW1322` soccer balls | 8/6 | Out of scope by request. |

Also worth a look in the sheet itself: the three LS GK rows are still flagged
"needs recount" from 5/5, and row 19 (`JF2871-EXP`) has its Updated date typo'd
as `5026-05-05`.
