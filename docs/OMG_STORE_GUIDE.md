# OMG Team Store — Step-by-Step Guide

How to take an OrderMyGear (OMG) pop-up store from "closed" to a finished
Sales Order with parent order tracking. Work the store page **top to bottom** —
the **Create Sales Order** button at the very bottom unlocks only once every
step is complete.

> Two different OMG reports are used here, and they are **not** the same thing:
> - **Store / Product report** → the catalog of products (sizes, colors, art).
> - **Player report** → one row per player/parent order (names, addresses, items).
> Plus two financial reports: the **Dollar Report** (revenue) and the
> **Accounting Report** (the fees NSA pays).

---

## Before you start (in OMG)

1. **Wait for the store to close.** Orders must be final.
2. When you **share the Store/Product report**, check **"Include product images"**.
   Without it, products import with no photos and you'll have to re-share and
   re-import.

---

## Step 1 — Add the store from the OMG Report

1. In the NSA portal go to **OMG Stores** → **Add Store from OMG Report** (or open
   an existing store).
2. Paste the **Store/Product report** link (`report.ordermygear.com/…`) and click
   **Import**.
3. If you see a **"products are missing images"** warning, go back to OMG, re-share
   the report **with images checked**, and click **Re-import**.

## Step 2 — Link the customer & pick the delivery method

At the top of the store, click **⚠ Link a customer…** and pick the club/team.
This enables the art library and sets the customer on the Sales Order.

Then choose the **🚚 Delivery method** (required before the Sales Order):

- **🏠 Ship to home** — each parent order ships to their address; a ShipStation
  label is created **per player**.
- **🏫 Deliver to school** — everything is bulk-delivered to the school/club, so
  **no per-player shipping labels** are needed (the Push-to-ShipStation buttons
  in the portal are hidden).

## Step 3 — Enter the financials (two reports)

Two side-by-side boxes near the top. Each accepts a **screenshot or a PDF
printout**, or you can type the numbers.

- **① Dollar Report (green = Revenue)** — money collected from parents. Shipping,
  processing fee and sales tax are charges added to each order, so they count as
  revenue. Drop the OMG **Dollar Report**.
- **② Accounting Report (red = Costs)** — the fees **NSA pays** (OMG fees + credit
  card fees). These become **costs** on the Sales Order. Drop the OMG
  **Accounting Report** (top-right of that page).

The panel cross-checks the two: **Total Collected** must equal the Dollar
Report **Grand Total**, and **Collected − fees = Net Revenue**. Fix any number
the import got wrong (e.g. a digit clipped off a PDF) before moving on.

## Step 4 — Assign decoration to every product

In the **Store Products** table, each product must either have an **art group**
assigned or be marked **No Deco** (shoes, socks, equipment).

- Use **Bulk assign art** to apply a logo to several items at once.
- Use **Select items needing art** to jump to the ones still missing it.
- Pull existing customer logos from the **Customer logo…** dropdown.

## Step 5 — Set up the Parent Order Portal

Scroll to **📦 Parent Order Portal** (or use the button at the top). Three steps,
shown as cards:

1. **Player report** — paste the OMG **Player Report** link and **Import orders**.
   This creates a trackable order per parent (name + shipping address come from
   the report).
2. **Packing slip** — drag the packing-slip **PDF** in. It adds each parent's
   **email** (the one thing the player report doesn't have) and is cross-checked
   against the orders by order number + name. Review the grid, then **Save**.
3. **Email parents** *(optional)* — click **Send processing emails**. A
   confirmation popup lists every recipient first. Use **🧪 Test mode** (enter
   your own email) to rehearse without contacting real parents. This step is
   **not required** to create the Sales Order — you can email parents now or any
   time later.

Each parent gets a private tracking link (`/shop/order/…`) that updates as the
warehouse advances status and can show shipping/tracking.

## Step 6 — Create the Sales Order

At the very bottom, the **Create Sales Order** card shows a checklist. The button
turns green and unlocks only when **all** are done:

- Customer linked
- Delivery method chosen (ship to home / deliver to school)
- Dollar Report entered (revenue)
- Accounting Report entered (fees)
- Reports match (Total Collected = Grand Total)
- Every item has deco or "No Deco"
- Parent orders imported
- Parents emailed *(optional — send now or later, not required to create the SO)*

Click **Create Sales Order**. Items, art, financials and parent tracking all
carry over. On the SO:
- **Revenue** = the full Grand Total (product + shipping + processing + tax).
- **Costs** = OMG fees + credit card fees (on the Costs tab).
- Margin reflects NSA's true net (matches the Accounting Report's Net Revenue).

> **This step links the parent orders to the SO** — which turns on automatic
> status. From here you don't status parents by hand; the Sales Order drives it.

## After the SO is created — parent status updates automatically

Work the Sales Order normally. Each parent's tracking advances on its own as you
go (you do **not** click anything in the Parent Order Portal):

7. **Create POs** for blanks not in stock (Batch PO). 
8. **Receive blanks** → parents auto-advance to **Received**. Backordered
   SKU+sizes stay at **On order** until their stock arrives.
9. **Production & decoration** — send jobs to the board; when the jobs are
   **completed**, parents auto-advance to **Bagging**.
10. **Ship** — for **ship-to-home** stores, push to ShipStation and create the
    label → parents auto-advance to **Shipped** and each gets a tracking email.
    Partial shipments show **Partially shipped**. For **deliver-to-school**
    stores there are no per-player labels — mark **Shipped** when the bulk
    delivery goes out. Then invoice from the SO.

The stages — **On order → Received → In production → Bagging → Shipped** — are
driven by the SO's receiving + jobs + ShipStation. The **Move all** / per-order
buttons in the portal are manual overrides for edge cases only.

---

### Money model, in one line

Parents pay the **Grand Total**. The **processing fee and sales tax are revenue**
(charges added to cover costs / remit tax), and the **OMG + credit card fees are
the real costs** NSA pays. `Revenue − fees = Net Revenue` = the SO margin.
