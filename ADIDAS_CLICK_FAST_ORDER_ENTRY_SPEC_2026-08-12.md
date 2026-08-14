# Adidas CLICK — fast cart entry (discovery spec)

**Status:** proposed, not built. Phase 1 is a read-only capture run; nothing here submits an order.
**Goal:** cut the cost and wall-clock of filling a CLICK cart, keeping the human review gate.
**Non-goal:** submitting/checking out on CLICK. That stays a human action, permanently.

## Why today's flow is slow

`bot-worker/` drives CLICK with Playwright *through an LLM*: `prompts/add_to_cart.md` walks an
agent through 8 stages (login → search → add → cart → PO → address → sizes → verify). Every
click is a model turn, so a routine 6-line PO costs minutes of wall-clock and a large share of
the tokens this account spends on ordering. The agent is doing two different jobs at once:

1. **Deciding** things — which colorway matches, what to do about a backorder date, whether the
   cart already holds these lines. This genuinely needs a model.
2. **Typing** things — putting 4 into the XS box, 7 into S, entering a PO number, picking an
   address. This is mechanical and does not need a model at all.

The win is separating them: keep the model for (1), replace it with deterministic calls for (2).

## Phase 1 findings (captured 2026-08-14, PO 57073 SFVB, 1 line / 15 pcs)

**CLICK has a clean JSON API.** The portal is a Salesforce-backed SPA on
`clapp-v2.whs.adidas.com`; every cart operation is a discrete REST call. Verified bodies:

| Operation | Call | Body |
|---|---|---|
| Search | `POST /service/catalog/products/{salesOrg}/{soldTo}/adidas/reorder` | `{searchTerm}` or `{articleNumbers:[…]}`, `page`, `pageSize`, `orderType:"OR"` |
| Add to cart | `POST /service/cart/{acct}/cart/{cartId}/materials/add` | `[{context:"default", materialNumber}]` — **an array: all lines in one call** |
| Enter sizes | `PUT /service/cart/{acct}/cart/{cartId}/materials/sizes` | `[{context, materialNumber, requestedDeliveryDate, quantity, technicalSize}]` — **also an array** |
| PO number | `PATCH /service/cart/{acct}/cart/{cartId}` → 204 | `{personalReference:"PO 57073 SFVB"}` |
| Ship-to list | `POST /service/cart/{acct}/shiptos` | `{soldToList:[soldTo], storefrontId:1}` (a *query*, not the setter) |
| Read cart | `GET /service/cart/{acct}/cart/{cartId}/materials` | — |
| Size names | `GET https://b2bportal.adidas-group.com/translations/api/sizes/US` | — |

Identifiers seen: sales org `6040`, soldTo `6017364000`, account `0000270384`, cart `26182980`.
Account and soldTo are stable for NSA; **the cart id is per-cart** and must be read from
`GET /service/cart/{acct}/storefronts/1/cart`, never hardcoded.

**Sizes are adidas technical codes, not our labels.** The 15 pcs went in as `210:2, 230:9, 250:2,
270:2` — so a size mapping is required (per-material size grid from the cart's `materials`
response and/or the `translations/api/sizes/US` endpoint). Do NOT assume XS/S/M/L strings work.

**Where the time went** (8 m 40 s total for ONE line):

| Stage | Time |
|---|---|
| Login | 1 m 31 s |
| Search + add + open cart | 0 m 45 s |
| PO number | 0 m 25 s |
| **Sizes + address** | **4 m 11 s** |
| Verify + report | 0 m 20 s |

The 4-minute block is four `PUT`s the API would accept as one, driven by an LLM typing into a grid.

**Auth is browser-shaped.** Login is `POST b2bportal.adidas-group.com/login` → 302 into Salesforce
SSO (`adidas-b2b.my.site.com/secur/frontdoor.jsp`), and Akamai is present (`/akam/13/pixel_…`).
So credentials can't simply be replayed — Playwright logs in, and its cookies are then reused. This
is the hybrid in Phase 2, now confirmed as the right shape rather than assumed.

### Still unknown

- **The ship-to setter.** `/shiptos` only lists them; the call that assigns one to the cart wasn't
  isolated (that run may have used the default). Candidates seen nearby:
  `POST /service/cart/{acct}/contacts`, `POST /service/cart/{acct}/overview`, or another `PATCH` on
  the cart. Needs one capture of a run that changes the address.
- **Availability/backorder semantics** — which response field says a size is unavailable vs.
  future-dated, so the client can flag rather than silently drop.
- Whether `materials/sizes` accepts rows for several `materialNumber`s in one call (the array shape
  suggests yes; only one line was in this cart).

## The original question (now answered — see findings above)

Whether CLICK's cart operations are reachable as direct HTTP calls. They are: discrete JSON
endpoints, with browser-shaped auth that the hybrid design already accounts for.

## Phase 1 — capture run (read-only, no writes to CLICK)

Instrument the existing worker rather than writing anything new: add network capture to the
Playwright context in `bot-worker/`, run one ordinary 2-line cart task, and keep the trace.

- Attach `page.on('request')` / `page.on('response')` (or `recordHar`) over the whole run.
- Record for each call: method, URL, request headers (names only — **redact cookie/auth values**),
  request body, response status, response body shape (keys, not full payloads).
- Capture `context.storageState()` at the end — that shows whether the session is cookie-based.
- **Denylist, enforced in code, not prose:** abort any request whose URL matches
  `/checkout|placeOrder|submitOrder|payment|confirm/i`. The capture run must be structurally
  incapable of submitting.
- Save to `bot-worker/captures/<timestamp>/` and **gitignore it** — HARs contain session
  material and dealer pricing.

**Deliverable:** a short endpoint map — for each of the six operations, the call that performs it,
or "browser-only" where no HTTP call is identifiable.

### Cart-safety gate (must hold before the run)

CLICK's cart is **shared account state**. Test lines sitting in it can be swept into a real
submission by anyone at NSA.

1. Confirm the cart is empty first. Open item as of 2026-08-12: the `PO 56050 MISSW` cart
   (51 pcs, incl. JW6602×23, JW4304×20) may never have been checked out. **Do not run the
   capture while any real cart is pending.**
2. Use a PO number that cannot be mistaken for real: `ZZ-TEST-DISCOVERY`.
3. Empty the cart at the end of the run and report its before/after contents.
4. Two SKUs, small quantities. Enough to exercise per-size entry, cheap to clean up.

## Phase 2 — build to whatever Phase 1 found

Phase 1 settled this: the hybrid is the design. Concrete sequence, all against
`https://clapp-v2.whs.adidas.com` with the browser's cookies:

1. **Playwright logs in** (SSO + Akamai) and yields `storageState`. Headed, so a human can clear a
   challenge once; the session is then reused for every call below.
2. `GET /service/cart/{acct}/storefronts/1/cart` → the current **cart id**.
3. `GET /service/cart/{acct}/cart/{cartId}/materials` → what's already in the cart (the audit step
   the prompt does by eye today) **and** each material's valid `technicalSize` values.
4. `POST …/materials/add` — **one call**, array of every `materialNumber` on the PO.
5. `PUT …/materials/sizes` — **one call**, array of every `{materialNumber, technicalSize, quantity,
   requestedDeliveryDate}` row. This is the 4-minute block, done in a single request.
6. `PATCH /service/cart/{acct}/cart/{cartId}` with `{personalReference: "<PO number>"}`.
7. Ship-to: the setter still needs identifying (see Still unknown).
8. `GET …/materials` again and **diff against what we intended** — same-shaped verification the
   Silver Screen integration does, so a partial write is reported rather than assumed good.

Failures name the endpoint, status and payload field involved, exactly as
`netlify/functions/silverscreen-job.js` does, so a portal change is diagnosable from one message.

The model stays in the loop only for real decisions: which colorway matches an ambiguous line,
what to do about a backordered size, and any cart-audit conflict. Everything mechanical becomes
five HTTP calls.

**Still stops at a filled cart.** No submit endpoint is called, and the capture sidecar's denylist
stays in force during development.

**Either way, unchanged:** the run stops at a filled cart, sets `bot_status = needs_review`, and a
human submits. No code path calls checkout.

## Phase 3 — verification before it's trusted

Run old and new paths against the same PO and diff the resulting cart: every SKU, colorway, and
per-size quantity must match, plus PO number and delivery address. Ship only on an exact match,
and keep the LLM path available as a fallback.

## Success criteria

- A 6-line PO reaches review-ready in well under a minute.
- Token cost per PO drops by an order of magnitude.
- No code path can submit an order on CLICK.
- Failures name the endpoint/field that broke, as the Silver Screen integration now does.

## Open question for the ask

Whether adidas offers EDI or a partner ordering API for dealers. If they do, it beats automating
their web UI on stability, error reporting, and confirmation of what was actually saved — worth
asking the rep before investing in Phase 2.
