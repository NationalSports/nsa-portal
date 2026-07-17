# Decoration Price Sheet (Screen Print + Embroidery)

`NSA_Price_Sheet_1.6x.pdf` — a one-page customer price sheet with screen print and
embroidery pricing at **1.6× the portal's decoration cost**.

## Pricing basis

- **Price = 1.6 × cost**, rounded to the nearest **$0.10** (the same rounding the
  portal applies to charged prices — `decoPricing.rT`).
- **Embroidery** honors the portal's **$8.00 / piece minimum** (`EM.fl`). Cells sitting
  at the floor are flagged with `*` (their raw 1.6× would be lower). Because the portal
  already sells embroidery at 1.6× cost with an $8 floor, this table equals current
  portal embroidery pricing.
- **Screen print** here is 1.6× cost. Note the portal currently *sells* screen print at
  **1.5×** (`SP.mk`), so these numbers are intentionally a bit higher than portal quotes.
- **Under-12 screen print** is a flat per-order charge (`SP` bracket 0), shown at 1.6× its
  implied cost `(flat / SP.mk) × 1.6`, rounded to the dollar — not a per-piece rate.
- **Small embroidery** is a separate, owner-set **flat rate** (not the 1.6×-cost matrix and
  exempt from the $8 minimum): **$5.00 ea at 12+ pieces**, **$6.00 ea under 12** (cost
  $3 / $4). Its quantity break is at 12, so it's shown as its own callout rather than in the
  stitch × qty matrix. Edit `EM_SMALL` in the generator to change it.

## Source of truth

Costs and bracket boundaries are parsed directly from
[`src/lib/decoPricing.js`](../../src/lib/decoPricing.js) (`SP` and `EM`) at generation
time, so the sheet cannot drift from the real matrix. The generator fails loudly if that
file's shape changes.

> These are the committed **default** cost tables. If deco pricing has been overridden
> under **Settings** in the portal, that override lives only in that browser's
> `localStorage` (`nsa_settings`) and is **not** reflected here.

## Regenerate

```bash
python3 docs/pricing/gen_price_sheet.py
```

Needs a Chromium/Chrome binary for HTML→PDF (auto-detected; override with `$CHROME`).
To change the markup, edit `MARKUP` at the top of the script. Re-commit the regenerated
`NSA_Price_Sheet_1.6x.pdf`.
