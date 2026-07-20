# Cowork PO Tracking — task instructions

Goal: drain the queue of "track this SO's open Adidas POs in CLICK" requests that reps fire from
the portal SO page (the **🔎 Track open Adidas POs in CLICK** button), and email each rep a live
per-item order update.

This is a **Cowork / claude-in-chrome** task (not the Playwright add_to_cart worker). It reuses the
exact CLICK access the inventory sync uses — a logged-in `b2bportal.adidas-group.com` tab. It is
**read-only** on CLICK: it looks orders up in My Orders and never touches a cart.

## How it runs

Run the **`adidas-click-po-tracking`** skill. In one pass it:

1. POSTs `{"action":"claim"}` to the portal's `so-po-tracker` Netlify function, which returns any
   queued `track_po_status` tasks — each already enriched with the SO's open Adidas PO roster
   (SKU · color · ordered sizes). It marks them `in_progress` (and re-claims tasks stuck
   `in_progress` > 20 min).
2. For each task, looks each PO up in CLICK **My Orders → "Search in My orders"**, reads per-item
   shipped / to-be-shipped / cancelled / delivery date / tracking, and maps it back to the roster.
3. POSTs `{"action":"complete", ...}` back to the function, which records the result on the task,
   posts a comment, and emails the SO's rep the per-item update (rep + Brevo key resolved
   server-side — never handled here).

If the claim returns no tasks, there's nothing to do — exit cleanly.

## Cadence

The tracker is **event-driven** (a rep clicked the button), so poll on a **short** schedule — every
5–15 minutes is plenty; each run is a no-op when the queue is empty. This gives the rep their email
within a few minutes of clicking, without a long-running watcher.

## Config on the worker box

- `TRACKER_URL` — the portal's `.netlify/functions/so-po-tracker` URL (its own Netlify origin).
- `BOT_TASK_TOKEN` — optional shared secret; if the function has one set, send it as `x-bot-token`.
- CLICK login: same saved `b2bportal.adidas-group.com` session the inventory sync relies on.

## Safety

- Read-only on CLICK — never add to cart, never submit, never use `requestedDeliveryDates` to place
  anything.
- On a CLICK 401 / login wall, `complete` the task as `blocked` ("re-login needed") — do not mark
  it done and do not email a partial update as if complete.
- The rep email recipient is always resolved server-side from the SO; this task supplies only the
  order-status content.

> A version-controlled reference copy of the skill is `adidas-click-po-tracking.SKILL.reference.md`
> — diff the installed skill against it when changing the tracker.
