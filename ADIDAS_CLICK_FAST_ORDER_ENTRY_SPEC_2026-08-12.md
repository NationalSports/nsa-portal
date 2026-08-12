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

## What we don't know yet

Whether CLICK's cart operations are reachable as direct HTTP calls. Silver Screen was easy
because it server-renders HTML forms (see `netlify/functions/silverscreen-job.js`). CLICK is an
enterprise SPA, so the cart is probably built by JavaScript calling JSON endpoints — which would
be *better* to drive than HTML forms, if we can authenticate. Unknowns, in the order that
decides the design:

- **Auth.** Is the session a replayable cookie set, or SSO/token with short expiry, device trust,
  or MFA? If it can't be replayed outside the browser, HTTP-only is dead and the answer is
  deterministic Playwright instead.
- **Endpoint shape.** Do search / availability / add-to-cart / size-entry / PO / address each
  have a clean JSON call, and are they idempotent enough to retry?
- **Bot protection.** Do non-browser clients get challenged even with valid cookies?

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

**If the session replays as cookies (best case).** Playwright logs in once (it already handles
whatever SSO/MFA exists), export `storageState`, then do per-line adds and size entry as direct
HTTP calls — the same pattern as `silverscreen-job.js`, including its self-describing failures:
report the fields/endpoints actually seen so a break is diagnosable from one screenshot. Expect
seconds instead of minutes, and near-zero tokens for the mechanical part.

**If it doesn't replay.** Keep Playwright but take the model out of the typing: a fixed script for
search → add → sizes → PO → address, with the model invoked only for the genuine decisions
(colorway ambiguity, backorder dates, cart-audit conflicts). Slower than HTTP, still a large
cost drop from 8 LLM stages.

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
