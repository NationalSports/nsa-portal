# Under Armour (Armour House) Inventory Sync — COWORK runbook

Operator-facing companion to `ua-inventory-sync.SKILL.reference.md` (the full
skill spec). This is the "how to run it in COWORK" checklist. The portal side
(Supabase `ua_inventory` table, the `/adidas` Team Catalog brand filter, the
order-screen UA B2B grid, the `ss-ua-sync` distributor feed) is already built and
deployed — this sync just fills `ua_inventory` from UA's direct B2B.

## What COWORK is

"COWORK" = Claude running in the Chrome desktop app on the Mac Mini, inside a
logged-in vendor tab, driving the vendor's own HTTP API (no UI clicking). Same
host that runs the adidas CLICK and Agron syncs. The Mac Mini must be on, Chrome
open, and the password manager unlocked for unattended overnight runs.

## First-time setup (one-time, ~30–45 min)

Because Armour House is behind a B2B login, the exact API is not yet captured.
The first run is a **discovery** run — do this once, then the skill runs unattended:

1. In COWORK's Chrome, go to `https://armourhouse.underarmour.com` and **Sign In**
   (let the password manager autofill — never type the password). Complete SSO if prompted.
2. Open DevTools → **Network** → filter **Fetch/XHR**.
3. Do three things and watch the XHR traffic, capturing the request (URL, method,
   headers, body) and the JSON response for each:
   - **Open a product** with multiple sizes → find the call returning per-size
     **stock** (and a next-available/ETA date if present).
   - **Run a catalog search / browse a category** → find the call that lists
     styles (style #, colorway, sizes, price, image URL, description).
   - If there's a "future availability"/"expected" view, open it → find the call
     that returns a **projected quantity for a date**.
4. Paste those captured endpoints/field names into the skill's **§Confirmed API**
   block (replace the `<…>` placeholders), then say "run the UA inventory sync".
5. After the first write, spot-check 3 SKUs in `ua_inventory` against the Armour
   House UI (per-size qty + dates). Fix any field mapping that's off and re-run.

## Routine run (after setup)

Just tell COWORK: **"run the UA inventory sync"** (or schedule it nightly like the
adidas sync). The skill will:

1. Re-query `products` for active `brand='Under Armour'` SKUs (never a cached list).
2. Per SKU: pull per-size stock + next date (+ projected ATP if available), and
   **write zero-stock rows too** so out-of-stock styles still show "inbound".
3. Upsert `ua_inventory` (anon key) on conflict `sku,size`; **verify by row count**.
4. On new/!-in-`products` colorways: write `ua_products_staging` (incl. image),
   then have Claude Code run `select * from promote_ua_products_from_staging();`
   (service role — creates the product rows at `nsa_cost = retail × 0.5 × 0.85`).

## Verify it worked

```sql
select count(*) ua_rows, count(*) filter (where stock_qty > 0) in_stock,
       max(last_synced) last_sync
from public.ua_inventory;
-- and the catalog union (UA should now appear):
select source, count(*) from public.inventory_unified group by source;
```

Then open `/livelook` (or `/adidas`), set the **Brand = Under Armour** filter, and
confirm UA styles render with live size grids. On a sales order, add a UA item and
confirm the green **UA B2B** per-size stock row + the "B2B INV" hover appear.

## Guardrails

- **Read-only.** Never place/submit a UA order or add to a cart.
- **Never type the password** — self-login via the autofilled Sign In button only.
- Token expiry → **stop and pause**: preserve the queue, ask the user to re-auth,
  resume. Do NOT drain the queue as errors (mirrors the adidas 401 handling).
- `ua_inventory` + `ua_products_staging` use the anon key; `products` is written
  only by the service-role promote (Claude Code), never the bot.
