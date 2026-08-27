# Club stock sheets

Co-branded, customer-facing PDFs showing a club's own inventory held at NSA.
Same shape as [`docs/pricing/`](../pricing/): the PDF, its generator, and its
logo asset live together so the sheet can be regenerated rather than re-made.

## `Encinitas_Express_Stock_On_Hand_2026-08-26.pdf`

Encinitas Express Soccer Club (`c-ns-3978`) — 1,278 units across 27 items,
from the 2026-08-26 physical recount loaded by
[`scripts/sync-encinitas-express-inventory-2026-08-26.sql`](../../scripts/sync-encinitas-express-inventory-2026-08-26.sql)
and [`scripts/add-encinitas-express-gk-ss-and-socks-2026-08-26.sql`](../../scripts/add-encinitas-express-gk-ss-and-socks-2026-08-26.sql).

### Quantities only — no cost, no retail

**The club sees this document.** `products.nsa_cost` is NSA's margin basis and
must not appear on it; retail is left off too so the sheet can't be mistaken for
a quote. If an internal copy is ever wanted, add both in the generator and give
it a filename that can't be confused with the customer one.

### Layout decisions worth keeping

- **Three grids, not one.** Adult/Women's run `XS–2XL` and youth run `YXS–YXL`;
  one grid would need a header row that means two different things. One-size
  items (backpack, sleeve sock) get their own short table.
- **A `Counted` column.** The Express tab is not counted all at once — the kit
  items were recounted 8/26, but the keeper shorts, backpack and sleeve sock are
  from late July, and the three long-sleeve keeper jerseys from **May 5**. Those
  three carry a `*` and are called out as due for a recount. A sheet that implied
  one uniform count date would be misleading.
- **Dash vs. red zero.** `–` = the size isn't carried in that item; a red `0` =
  carried but out of stock. Two of those today (women's shorts XS, women's
  jacket L).
- **Brand colors are sampled from the logos themselves**, not guessed: NSA navy
  `#1B2C54` / red `#A62B2B`, Express gold `#C4B382` / blue `#5178C2`. Gold is
  darkened to `#8A7A45` for text on white — the logo gold is unreadable at body
  contrast.
- The Express mark is the club's `customers.logo_url` in the portal, cached here
  as `express-logo.png`; the NSA mark is read from `public/`.

### Regenerate

```bash
python3 docs/stock-sheets/gen_express_stock_sheet.py   # needs reportlab, pillow
```

Counts are a **snapshot embedded in the generator** (`D` / `Y` / `O`), not a live
query — the script has no DB credentials. The SQL to refresh them is in the
module docstring. After editing, verify against the database before sending:

```sql
select p.sku || '|' ||
       (select string_agg(i.size || ':' || i.quantity, ',' order by i.size)
          from product_inventory i where i.product_id = p.id) || '|' ||
       (select sum(i.quantity) from product_inventory i where i.product_id = p.id)
  from products p where p.id like 'p-exp-%' order by 1;
```

That per-SKU signature is what the committed PDF was diffed against — all 27
items matched exactly, including the 1,278 total.
