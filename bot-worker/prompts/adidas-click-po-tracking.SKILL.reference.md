---
name: adidas-click-po-tracking
description: >
  Track the live Adidas order status for a Sales Order's open purchase orders on the Adidas
  CLICK B2B portal (My Orders), then email the SO's rep a detailed per-item update. Use when the
  user says "track the POs on this SO", "check CLICK order status", "where are my Adidas orders",
  or when a `track_po_status` task is queued from the portal SO page. Reads order status only —
  never places or modifies an order.
---

# Adidas CLICK — Sales Order PO Tracking

> Version-controlled reference copy of the live skill. Diff against the installed
> `~/.claude/skills/adidas-click-po-tracking/SKILL.md` when changing it. Runs on the Mac mini in a
> logged-in `claude-in-chrome` session — the SAME CLICK access `adidas-inventory-sync` uses.

Goal: for one NSA Sales Order, look up every **open** Adidas PO in CLICK **My Orders**, read the
live per-item ship status (ordered / shipped / to-be-shipped / cancelled / delivery date /
tracking), and email the SO's rep a per-item update. **Read-only — never touches a cart, never
submits anything.**

All secrets stay server-side: the skill talks only to (a) CLICK in the browser and (b) the
portal's **`so-po-tracker`** Netlify function, which holds the service-role + Brevo keys. The skill
holds **no** database or email credentials.

Config to fill in on install:
- `TRACKER_URL` = `https://<nsa-portal-netlify-host>/.netlify/functions/so-po-tracker` (the portal's own origin).
- `BOT_TASK_TOKEN` (optional) — if the function is configured with one, send it as header `x-bot-token`.

---

## Step 0 — Auth (reuse the inventory-sync entry — do NOT reinvent)

Follow `adidas-inventory-sync` Step 0 exactly: `tabs_context_mcp` → find/create the
`b2bportal.adidas-group.com` tab; confirm `localStorage.getItem('sid')`; if on `/login`, let
Chrome autofill and click submit (`mcp__claude-in-chrome__computer` screenshot to confirm), wait
5–6s, re-check. Keep `token = 'Bearer ' + localStorage.getItem('sid')`.

**Token expiry:** `sid` expires ~10–15 min idle. On HTTP 401 mid-run: stop cleanly and call
`complete` with `status:"blocked"` ("CLICK session expired — re-login needed"); do NOT mark done.

---

## Step 1 — Claim the work (the function hands you everything)

POST `TRACKER_URL` with `{"action":"claim"}` (header `x-bot-token` if configured). The response is:

```json
{ "ok": true, "tasks": [
  { "task_id": "...", "so_id": "SO-1333", "po_numbers": ["PO 3522 CMSF"], "notify": true,
    "roster": [ { "po": "PO 3522 CMSF", "sku": "IX7612", "name": "...", "color": "Black",
                  "sizes": { "S": 4, "M": 8, "L": 6 } } ] } ] }
```

`roster` is the authoritative list of **what to look for** — every open Adidas PO line on the SO
with its ordered sizes. If `tasks` is empty, there's nothing queued — stop. Process each task.

---

## Step 2 — Read CLICK My Orders for each PO

**Try the API first (reliable, structured); fall back to the UI (the manual flow).**

### 2A — Orders JSON API  ⚠️ DISCOVER THE ENDPOINT ON THE FIRST RUN, THEN RECORD IT HERE
CLICK almost certainly backs My Orders with a `clapp-v2.whs.adidas.com/service/...` endpoint (same
host as catalog + materials). On the first run: open My Orders, type a PO into **"Search in My
orders"**, and capture the request the page fires (Network panel /
`performance.getEntriesByType('resource')`). Record the confirmed shape here:

```
POST/GET  https://clapp-v2.whs.adidas.com/service/order/<...>          ⚠️ fill in on first run
Headers:  Authorization: Bearer <sid>, Content-Type: application/json,
          request-id: <UUID v4>   ← if it mirrors materials/information, this is REQUIRED (else HTTP 500)
Search key: the customer PO string (the NSA po_id)
```

Reuse inventory-sync resilience: UUID `request-id`, retry ≤6 with backoff, 401 → stop.

### 2B — My Orders UI (guaranteed fallback — the flow the SO-page button describes)
1. Click **My Orders** (storefront icon, top nav).
2. In **"Search in My orders"**, type the PO string. No rows → retry with just the numeric core
   (e.g. `3522` from `PO 3522 CMSF`); still nothing → record the PO in `pos_not_found` and continue.
3. Read each matching order row via `read_page`: adidas order # (`B-#######`), Order Status, Ship
   To, PO, Created, RDD, and **Total / Cancelled / Shipped / To be shipped**.
4. Open each order for per-article, per-size shipped vs to-be-shipped + tracking / ship date.
   ⚠️ Align each size value to its exact column header (sizes may not start at XS; footwear
   differs) — the per-size grid is the least reliable read; confirm on first run.

**One PO can return multiple Adidas orders** (e.g. two `B-...` share one PO) — aggregate them.

---

## Step 3 — Map CLICK lines back to the roster

Join CLICK order lines to `roster` by **article number (SKU) + size**. If CLICK returns numeric
size codes, map them with the same `adidas_size_maps` labels the inventory sync uses. Per roster
item/size compute `ordered` (from roster), `shipped`, `to_ship`, `cancelled`, an `eta` (RDD /
restock), `tracking`, and a `state`: `shipped` | `partial` | `backordered` (0 shipped, future RDD)
| `open`. Flag any roster item with no matching CLICK line.

---

## Step 4 — Report back (the function emails the rep)

POST `TRACKER_URL` with `{"action":"complete", ...}` per task:

```json
{ "action": "complete", "task_id": "...", "status": "done", "notify": true,
  "summary": "2 of 3 POs fully shipped; 1 item backordered to Aug 4.",
  "po_reports": [ { "po": "PO 3522 CMSF", "adidas_orders": ["B-0005661873"], "order_status": "Open",
      "items": [ { "sku": "IX7612", "color": "Black", "size": "L", "ordered": 6, "shipped": 6,
                   "to_ship": 0, "cancelled": 0, "state": "shipped", "eta": "2026-07-23",
                   "tracking": "1Z..." } ] } ],
  "pos_not_found": [], "issues": [] }
```

The function updates the SO task, posts a comment, and (if `notify`) emails the rep. The email is a
**full order status** — every PO on the SO across all vendors, with ordered/received/stage assembled
server-side from the portal, and your CLICK `po_reports` layered onto the Adidas POs. So you only
supply the CLICK read; the portal-side status and the rep recipient (`customers.primary_rep_id` →
else `created_by`) are resolved server-side — you never handle rep addresses or the Brevo key. Use
`status`: `done` when compiled; `blocked` on a 401 / login wall; `needs_input` if a PO can't be
matched and the rep must clarify; `failed` on an unrecoverable error.

---

## Step 5 — Tab cleanup
After reporting, close every tab opened this run (`tabs_context_mcp` → `tabs_close_mcp`),
unconditionally.

## Notes
- Read-only: no cart, no order actions, never submit.
- CLICK is slow — wait/retry the same action (30–60s); 3-strike kill switch per action.
- Dates normalize to `YYYY-MM-DD`.
- The PO typed into CLICK at order time is the NSA `po_id` (that's why searching it in "Search in
  My orders" works); manually-placed orders may differ — hence the numeric-core fallback in 2B.
- Phase 2 (not yet enabled): the function could also write the discovered Adidas order # + ship
  status back onto `so_item_po_lines` (reusing the `api_order_id` convention) so the portal's own
  receiving reflects CLICK. Leave off until the read path is validated on real orders.
