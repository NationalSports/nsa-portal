# Decoration Price Sheet (Screen Print + Embroidery)

`NSA_Price_Sheet_1.6x.pdf` — a one-page customer price sheet. It carries **two
independent pricing models**:

## Screen printing — 1.6× cost (data-driven)

- **Price = 1.6 × cost**, rounded to the nearest **$0.10** (`decoPricing.rT` rounding).
- The cost table and quantity/color brackets are parsed straight from
  [`src/lib/decoPricing.js`](../../src/lib/decoPricing.js) (`SP`) at generation time, so
  the screen-print side can't drift from the real portal matrix. The generator fails
  loudly if that file's shape changes.
- The portal currently *sells* screen print at **1.5×** (`SP.mk`), so these numbers are
  intentionally a bit higher than current portal quotes.
- **Under-12** is a flat per-order charge (`SP` bracket 0), shown at 1.6× its implied
  cost `(flat / SP.mk) × 1.6`, rounded to the dollar — not a per-piece rate.

> These are the committed **default** cost tables. If deco pricing has been overridden
> under **Settings** in the portal, that override lives only in that browser's
> `localStorage` (`nsa_settings`) and is **not** reflected here.

## Embroidery — flat owner-set rates

Embroidery is **not** 1.6×-cost. It's hand-set in `EM_CATEGORIES` in the generator, by
size category × quantity tier:

| Type | 1–11 | 12–47 | 48+ |
|------|------|-------|-----|
| Small — small logo / text, ≤5,000 stitches | $6 | $5 | $5 |
| Standard — ≤20,000 stitches | $9 | $8 | $7 |
| Large — over 20,000 stitches | $12 | $11 | $10 |

`cost` in `EM_CATEGORIES` is margin reference only (Small is cost $4 / $3 / $3) and is not
shown on the sheet. To reprice embroidery, edit `EM_CATEGORIES` / `EM_QTY_TIERS`.

> The Small ≤5,000-stitch cutoff and the Large (20k+) prices are working defaults, not
> owner-confirmed — adjust in `EM_CATEGORIES` as needed.

## Regenerate

```bash
python3 docs/pricing/gen_price_sheet.py
```

Needs a Chromium/Chrome binary for HTML→PDF (auto-detected; override with `$CHROME`).
Screen-print markup is the `MARKUP` constant; embroidery is `EM_CATEGORIES`. Re-commit
the regenerated `NSA_Price_Sheet_1.6x.pdf`.
