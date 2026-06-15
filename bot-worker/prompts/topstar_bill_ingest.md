# Top Star Invoice → SO Cost + QuickBooks Bill — task instructions

Goal: when Top Star (TSD Sportwear) sends its periodic digitizing / vectorizing
invoice — forwarded to us by `accounting@nationalsportsapparel.com` — apply each
billed line as a **cost on the matching sales order's Top Star deco PO**, and post
**one QuickBooks bill** for the invoice. Runs as a Cowork/Claude task using Gmail
(read), Supabase (read/write), and the QuickBooks proxy. **Always start a run in
`DRY_RUN` mode** (read everything, write nothing) and review before going live.

## What it matches (and what it deliberately doesn't)

The match key is the portal's Top Star deco PO number — `TS <counter> <tag>`
(e.g. `TS 3067 Vist`) — stored in `sales_orders.deco_pos[].po_id` with
`vendor = "Topstar"`. That PO is minted when a rep clicks **🧵 Topstar Digitizing
PO** on a sales order, and the number is emailed to Top Star, who echoes it on the
invoice line's **Order Name** column. (Confirmed on invoice 97212: the line
`PO TS 3067-V Panther` → `TS 3067 Vist` on `SO-1077`.)

- Match on the **`TS <digits>` token only** — ignore the trailing tag. The portal
  stored `Vist`; the invoice said `Panther`; the `TS 3067` number is the reliable key.
- Lines with **no `TS <digits>` token** are not Top Star portal POs — they are
  NetSuite SO#/PO# numbers (`SO135512`, `PO8525`, …) or bare logo names
  (`Air Strike`, `Cougars`, …). These are reported as **UNMATCHED** and are never
  written and never guessed. There is **no NetSuite integration — by design.**

## Coverage reality (read before expecting big numbers)

Validated against invoice **97212** (92 lines, $1,043 total): exactly **1 line
matched** ($15); the other **91 lines ($1,028)** were never created in the portal,
so there is nothing to bill against.

This is an **origination** characteristic, not a matcher limitation. Coverage grows
only as Top Star digitizing / vector orders are created through the portal's 🧵
button so each one gets a `TS#`. The behaviour with partial adoption:

- **Additive & go-forward.** Each newly portal-native order starts matching the
  month it is invoiced. Orders that were never in the portal stay in the unmatched
  report — exactly how 100% of them are handled today (manually). Turning this on is
  strictly an improvement and is safe with any mix of in-portal / not-in-portal.
- **Idempotent.** A line whose invoice number is already present in the deco PO's
  `_bill_details` is skipped, so re-runs and growing coverage never double-bill.
- **No retroactive matches.** A past invoice (e.g. 97212) will not gain matches as
  you migrate later orders — those 91 jobs were billed before they existed in the
  portal. The wins come from *future* invoices for portal-native orders.

The unmatched report doubles as a migration checklist: watch it shrink as the team
adopts the 🧵 button.

## The task (paste into Cowork — DRY_RUN first)

```
COWORK TASK — Apply Top Star (TSD) digitizing/vector invoices → SO cost tab + QuickBooks bill
Tools: Gmail (read), Supabase (read/write), HTTP (QuickBooks). First run: DRY_RUN=true (do everything
EXCEPT the Supabase/QB writes and the Gmail label; just report what you would do).

1) FIND THE INVOICE EMAIL — it arrives FORWARDED by accounting, not from Top Star, and the subject may
   not say "invoice" (a real one was "WE DO HAVE YOUR CC INFO ON FILE…"). Match on sender/content, not subject.
   - Gmail search: from:(accounting@nationalsportsapparel.com) (topstar OR "top star" OR digitizing OR invoice)
     has:attachment newer_than:45d -label:TopstarBilled     (also accept from:(topstardigitizing.com))
   - Newest matching thread not labeled TopstarBilled; if none → stop: "No new Topstar invoices."
   - Extract: Invoice # (e.g. 97212), Invoice Date (2026-06-11), and every Orders Detail row {order_name, amount}.
   - SANITY CHECK: the line amounts must sum to the printed Grand Total; if not, stop and report the gap.

2) EXTRACT THE PORTAL PO# FROM EACH ORDER NAME (token match, NOT whole-string)
   - Pull the first "TS <digits>" token from order_name, case-insensitive: "PO TS 3067-V Panther" → "TS 3067".
   - Match on the TS number ONLY — ignore the trailing tag (portal stores "TS 3067 Vist", invoice said "Panther").
   - Any line with no "TS <digits>" token → UNMATCHED. These are NetSuite numbers (SO135xxx / PO8xxx) or
     descriptive names; they are NOT in the portal. Never guess-match a dollar amount.

3) MATCH IN SUPABASE — public.sales_orders, JSONB column deco_pos
   - Find the row + array element whose po_id (uppercased, spaces collapsed) starts with the TS token, and
     whose vendor = "Topstar".  Query: select id, deco_pos from sales_orders where deco_pos::text ilike '%TS 3067%';

4) APPLY AS A COST ON THE SO (idempotent) — this is the cost-tab write
   - On the matched deco_pos element:
       • If _bill_details already has an entry with doc == "<Invoice #>" → SKIP (already billed).
       • else: _bill_cost = round((_bill_cost||0) + amount, 2)
               _bill_details += {doc:"<Invoice #>", date:"<Invoice Date>", supplier:"Top Star (TSD Sportwear)",
                                 cost: amount, freight:0, tracking:""}
               status = "billed"
       • Write the WHOLE updated deco_pos array back:
         update sales_orders set deco_pos=<new>, updated_at=now() where id=<so_id>.

5) SYNC TO QUICKBOOKS — one Bill per invoice
   - First query QBO for a Bill with DocNumber == "<Invoice #>"; if it exists, skip.
   - else POST <PORTAL_URL>/.netlify/functions/qb-api with QB_ACCESS_TOKEN + QB_REALM_ID, creating a Bill:
     Vendor="<Top Star vendor in QBO>", DocNumber="<Invoice #>", TxnDate="<Invoice Date>",
     one line per MATCHED order (Account="<Digitizing/Outside-Deco expense acct>",
     Description = order_name+" · "+po_id+" · "+so_id, Amount = amount). Default: bill matched lines only,
     so QuickBooks stays reconciled with the portal.

6) CLOSE OUT
   - Label the thread "TopstarBilled".
   - Report: Invoice #, total, #lines, #applied + $ applied (with so_id/po_id), #skipped (already billed),
     and #UNMATCHED with each order_name + amount + reason. Flag unmatched loudly — they need a human or need
     to be created in the portal first.

CONFIG:  PORTAL_URL · QB_ACCESS_TOKEN + QB_REALM_ID · QBO vendor + expense-account names · DRY_RUN=true (first run)
```

## What gets written (the SO "cost tab")

On the matched `deco_pos` element:

- `_bill_cost` += line amount — this is what the portal sums into the SO cost
  (`OrderEditor.js` deco-cost roll-up) and shows in the PO / cost views.
- `_bill_details` gets `{doc, date, supplier, cost, freight, tracking}` appended.
- `status` → `"billed"`.

QuickBooks gets **one Bill per invoice** (DocNumber = invoice #, matched lines only)
via `netlify/functions/qb-api.js`. A GET-by-DocNumber precedes creation so a
re-run never duplicates the bill.

## Config

| Key | Notes |
|---|---|
| `PORTAL_URL` | Netlify site base, for the QuickBooks proxy call |
| `QB_ACCESS_TOKEN` + `QB_REALM_ID` | QuickBooks Online auth (see dependency below) |
| QBO vendor name | Top Star / TSD Sportwear, exactly as it reads in QuickBooks |
| QBO expense account | Digitizing / Outside-Decoration expense account |
| `DRY_RUN` | `true` on the first run of every invoice |

## Known dependency / deferred

- **QuickBooks token.** QB tokens are held client-side only (`qb-auth.js` returns
  them to the browser; access tokens expire ~1h). For a *scheduled, unattended* run
  the QB **refresh** token must be persisted somewhere the task can reach. That work
  is **deferred** until Top Star ordering has moved into the portal and monthly
  matched-line volume justifies it. Until then: paste a current token at run time, or
  let the task apply the SO cost automatically and post the QuickBooks bill from the
  portal.
- **Email discovery** keys off the `accounting@` forward — *not* Top Star's sender
  address, and *not* a subject containing "invoice" (a real one was subject
  `WE DO HAVE YOUR CC INFO ON FILE…`).
