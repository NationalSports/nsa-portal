# Uniform SKU Format

Covers the custom (Methodic) uniform program for the 15 sports we outfit.
Full list: `docs/UNIFORM_SKU_LIST.csv`.

## The format

```
VENDOR - SPORT - GARMENT - OPTION
MTH    - BSB   - JSY     - FBT      →  MTH-BSB-JSY-FBT
                                        (Methodic baseball full-button jersey)
```

Four segments, three characters each, joined by dashes. A rep can read any SKU
out loud and know what it is without looking it up.

The **OPTION** segment is dropped when an item has no variants
(`MTH-WRE-SNG` = wrestling singlet, one cut, done).

### What is NOT in the SKU

- **Size** — sizes are columns in the portal's size grid, not separate SKUs.
  One SKU carries the whole YS–4XL run. (If a barcode ever needs a size-level
  code, append it: `MTH-BSB-JSY-FBT-YM`. Don't build the base list that way.)
- **Color** — these are cut-and-sew custom garments; the colors come from the
  team's artwork, not from a stocked colorway.
- **Team / school** — that lives on the order, not the item.

This keeps the list at ~125 SKUs instead of tens of thousands.

## Segment codes

**Vendor (position 1)** — swap the prefix to run the same structure for another
supplier or for house goods.

| Code | Vendor |
|------|--------|
| MTH | Methodic (custom) |
| NSA | National Sports Apparel house goods |

**Sport (position 2)**

| Code | Sport | Code | Sport | Code | Sport |
|------|-------|------|-------|------|-------|
| ALL | All sports (shared) | VLB | Volleyball | HKY | Hockey |
| BSB | Baseball | SOC | Soccer | GLF | Golf |
| SFB | Softball | WRE | Wrestling | TEN | Tennis |
| FTB | Football | TRK | Track & Field | SWM | Swim & Dive |
| BKB | Basketball | XCT | Cross Country | CHR | Cheer |
| | | LAX | Lacrosse | | |

**Garment (position 3)**

| Code | Garment | Code | Garment |
|------|---------|------|---------|
| JSY | Jersey | SOK | Sock |
| SHT | Short | CAP | Cap / visor / swim cap |
| PNT | Pant | WUJ | Warm-up jacket |
| SNG | Singlet | WUP | Warm-up pant |
| TOP | Top / shell | QTR | Quarter zip |
| TEE | Tee | PLO | Polo |
| SKT | Skirt / skort | TNK | Tank |
| KLT | Kilt | SUT | Swim suit |
| PIN | Pinnie | BRF | Brief |
| TGT | Half tight | | |

**Option (position 4)** — cut, closure, sleeve length, or construction.

| Code | Option | Code | Option |
|------|--------|------|--------|
| VNK | V-neck | REV | Reversible |
| CRW | Crew neck / crew sock | PIP | Piping |
| HEN | 2-button henley | PNL | Side panel |
| FBT | Full button | STD | Standard |
| TWL | Full twill (sewn) | GAM | Game cut |
| SSL | Short sleeve | PRC | Practice |
| LSL | Long sleeve | FIT | Fitted |
| NSL | Sleeveless | ADJ | Adjustable |
| FUL | Full length | VIS | Visor |
| KNK | Knicker | KPR | Keeper |
| SPT | Split | LIB | Libero (contrast) |
| INT | Integrated pad | SHO | Shooting shirt |
| SLT | Slotted (pad pockets) | MEN / WMN | Men's / women's cut |
| KNT | Knit | CNS | Cut & sew |
| FZP / QZP | Full zip / quarter zip | OPN / SNP | Open hem / snap side |
| JAM | Jammer | ONE | One-piece |
| 3IN / 4IN / 5IN | Inseam | BRF | Brief (swim) |
| OTC | Over-the-calf (sock) | | |

## Adding to the list

1. Reuse an existing code before inventing one — the point is that
   `JSY` means jersey in every sport.
2. New sport or garment: pick three letters, add it to the table above, then
   add the rows to the CSV.
3. Rows where the Option column is blank are the **base item**. They carry the
   family SKU so a rep can quote "a baseball jersey" before the coach has picked
   a neck style. Ordered items should always land on a full option SKU.

## Known gaps (deliberate)

- Headwear beyond baseball/softball, bags, and spirit wear are not here —
  this list is game uniforms plus the warm-up/sock package that ships with them.
- Girls'/boys' cuts are only split where the garment actually differs
  (track and cross country singlets). Everywhere else one SKU covers both and
  the cut is a size-run choice.
