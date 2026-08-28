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

## Follow-up 2 — socks and Astra tees (2026-08-27)

Applied by `scripts/add-encinitas-express-socks-and-astra-tees-2026-08-27.sql`.
Staff confirmed the size scales that had blocked these two, so the Express tab is now
fully loaded — every row on it has a product carrying its count.

| Product | Sizes loaded | On hand | Cost / retail |
|---|---|---|---|
| `p-exp-JW6705-EXP-N` — Team Sock (Navy) | S 12, M 53, L 90 | 155 | 10.31 / $25 |
| `p-exp-JW6705-EXP-R` — Team Sock (Red) | XS 6, S 11 | 17 | 10.31 / $25 |
| `p-exp-AE153Y-EXP` — Astra Tee Youth (Columbia Blue) | YS 2, YM 1, YL 19, YXL 13 | 35 | **unset** |
| `p-exp-AE152-EXP-CB` — Astra Tee (Columbia Blue) | XS 1, S 18, M 13, L 9 | 41 | **unset** |
| `p-exp-AE152-EXP-N` — Astra Tee (Navy) | M 13, L 7 | 20 | **unset** |
| `p-exp-AE152-EXP-R` — Astra Tee (Red) | L 2 | 2 | **unset** |

**The sock ambiguity resolved in favour of the header columns.** The counts sat under the
sheet's main `XS`–`XL` header while the block's own label row read `KXXL` / `KXL`; staff
confirmed the header is right — navy is S/M/L, red is XS/S. Both colours now reconcile
exactly with the sheet's own Total cells (155 and 17), which is the check the earlier
ambiguity had made impossible.

**`AE153Y`'s stale Total.** The sheet's Total cell reads 31 but its size cells sum to 35.
The staff-confirmed per-size counts (2 / 1 / 19 / 13 = 35) were loaded; the Total cell in
the sheet is stale and worth correcting there.

**Astra tee cost and brand are deliberately NULL.** `AE152` / `AE153Y` appear nowhere else
in the catalog, the sheet carries no cost for any Express row, and there is no sibling to
inherit from — so no cost was invented (693 catalog rows, 361 active, already sit this
way). Set `nsa_cost` and `retail_price` when the club's price list is to hand. Brand is
likewise unset: "Astra Sport" is a screen-print **decoration vendor** elsewhere in this
codebase, not a garment label, so the sheet's name probably refers to who decorated the
tee rather than who made it.

The socks took the figures already on the general-catalog `JW6705` row
("Adidas adisock 25 Custom", $25 / 10.31) — same garment, no assumption.

## Club stock sheet

`Encinitas_Express_Stock_On_Hand_2026-08-27.pdf` — a co-branded (NSA + Express) stock
sheet, 33 items / 1,548 units, grouped into Adult & Women's, Youth and One Size grids
because the two size scales don't share a header row. Generated from the database and
diffed cell-by-cell against it.

It carries **no cost or retail figures**: it is branded for the club as well as NSA, so
NSA's cost basis has no business being on it. It does carry a per-row **Counted** date,
because the rows were not all counted on the same day.

## Still open

- **The three long-sleeve keeper jerseys** (`JF2881`, `JF2871`, `JF2887`) are still flagged
  "needs recount" in the sheet from 5 May and should be recounted before the stock sheet
  goes to the club.
- **Short-sleeve keeper jersey pricing** copies the long-sleeve siblings — confirm against
  the club's price list (see Follow-up 1).
- **Astra tee cost, retail and brand** are unset, as above.
- **Kit catalog** still points its `keeper_jersey` slot at the long-sleeve products and its
  `socks` slot at the general `KB7233` Adisock 26 3S rather than the club's own `JW6705`.
  Those 11 products are now *visible* to the club (see below) but still aren't *orderable*
  through the roster flow; repointing a kit slot changes what coaches order, so it stays a
  business decision.

## Club stock panel (2026-08-28)

Of the 33 products, only the 22 the kit catalog references were ever loaded by the roster
view — the other 11 (both socks, the sleeve sock, all four Astra tees, the three
short-sleeve keeper jerseys, the all-weather jacket), **457 of the 1,548 units**, were
invisible to the club. And the availability figure a coach saw was `in-house + vendor`
summed into one number, so club-owned stock couldn't be told apart from what adidas could
still supply.

Both are addressed:

- `products.customer_id` attributes a stock pool to a club (migration
  `20260828120000_club_stock_visibility.sql`), so a club's stock no longer has to be
  reachable through the kit to be shown. The 33 Encinitas rows are backfilled.
- `getStock` now returns `mine` and `vendor` alongside `avail`. **`avail` is still exactly
  `mine + vendor`** — every covered/short/colour decision keys off it and must not move
  because the breakdown was added.
- A new `ClubStockPanel` shows the club its own stock, grouped the same way as the PDF.
  It deliberately shows only `mine`; folding vendor supply back in would undo the split.
- Gated per account by `customers.coach_stock`, default **false** — no club sees it until
  someone turns it on. Encinitas is not switched on yet.

`products` and `product_inventory` both carry `anon read = true` policies, so
`customer_id` decides what a club is *shown*, not what the anon key could reach. Real
isolation would need those policies tightened first — worth knowing before this is sold
as a privacy feature.
- **Soccer balls `JW1322`** — out of scope by request.

Row 19 (`JF2871-EXP`) also still has its Updated date typo'd as `5026-05-05` in the sheet.
