# All School stores

All School is a separate, year-round store type. Existing team and club stores retain their workflows. New school stores default to home shipping, a 14-day target to **shipment**, and optional fundraising added on top at 10%, excluding tax and shipping. Existing webstore pricing remains the source of truth.

## Store setup

1. Create an All School store in Webstores and set school branding and contact details.
2. Configure programs and the School Spirit assortment. Program assignments are explicit; shared products are an explicit choice. Disabling a program hides its navigation entry, not its individually published products.
3. Preview and confirm core assortment copies into each program. Copies share the blank product but retain separate artwork, color groups, and overrides. Choose the exact sport decoration inventory and its web preview artwork. Save the garment mock, then review and approve each exact production setup; copies start unapproved, and artwork/template changes clear approval.
4. Set garment weights and package dimensions before selecting live UPS shipping. Flat shipping is the initial setting. Live UPS uses existing ShipStation credentials and the Orange warehouse address. Quotes are rechecked on the server; carrier adjustments can still change the final billed amount.
5. Configure optional names/numbers, their limits, capitalization, placement, and production template. The screen preview shows entered text; it is not a print proof or a generated individual Illustrator file.

The school storefront uses the supplied athletic visual direction, local fonts, sport photo tiles, mobile navigation, and existing product/cart/Showcase features. Showcase remains under **Store detail → More → Store Appearance → Showcase**.

## Decoration inventory and supplier orders

Decoration type and application method are separate. Save the exact supplier, dimensions, version, instructions, and private `.ai` production file. DTF, chenille, embroidered/woven patches and other supported inventory use reservations so two orders cannot claim the same physical pieces.

Paid order lines freeze their production recipe, artwork metadata, and source offering. Orders for the same blank with different sport art or personalization stay distinct. Production packets automatically render approved purchased setups with their exact names/numbers; incomplete setups remain references until manually approved. Batch demand uses the frozen recipe, with exact names/numbers and shortages. Stocked digits count every occurrence in each selected set ("11" consumes two "1" transfers per garment). Custom names and numbers can use separate template files, dimensions, and costs. Pulling decorations consumes physical inventory once; merely reserving it does not.

The DTF queue groups work by supplier and sends a CSV manifest plus the saved production `.ai` files. Personalized work supplies the approved base template and exact text/quantities for the supplier to render. Missing files/specifications block sending. Delivery with an uncertain result stays held for reconciliation rather than sending a duplicate. Receiving purchased stock updates physical inventory once; production still waits for the required materials.

Sewn and combined heat/sew applications require manual production routing; they must not be treated as a heat-only job. Recipe-managed production jobs are preserved by both order editors rather than regrouped from mutable catalog art.

## Garment purchasing

Per-store controls configure automatic purchasing, the $200 minimum in unmet blank cost per vendor, weekly cutoff, whether to combine with a compatible unsubmitted regular batch, and what to do when no batch exists. Warehouse stock is reserved before evaluating the minimum. SanMar and S&S use their existing API payload builders and resolvers; DTF suppliers use the separate email queue.

Durable database allocations protect additions to the older regular-batch queue from stale browser saves. Submission claims bind the source quantities and destination; an uncertain supplier result is not automatically retried. A maximum-wait deadline moves still-unsubmitted school allocations into dedicated purchasing if the regular batch has not gone out. Store and vendor automation controls must both permit submission.

## Deployment order

Apply these additive migrations **before deploying the updated purchase proxies or enabling a school store**:

1. `20261002183605_all_school_store_foundation.sql`
2. `20261002183729_all_school_order_conversion.sql`
3. `20261002184054_all_school_purchasing_runtime.sql`
4. `20261002184500_all_school_dtf_batches.sql`
5. `20261002223226_all_school_permissions_hardening.sql`

The new supplier guards fail closed without their database tables/functions. The column parity baseline acknowledges the two pending sales-order snapshot columns; it does not imply the live database has been migrated.

Deploy functions and frontend together. Both school workers run every 15 minutes. Automatic garment purchasing starts disabled in new stores. DTF sending additionally requires `ALL_SCHOOL_DTF_SEND_ENABLED=true` and each store's DTF auto-send setting. Configure real supplier email addresses (including Astra Sport if selected); no recipient is guessed. Live UPS needs `SHIPSTATION_API_KEY` and `SHIPSTATION_API_SECRET` plus a usable UPS carrier account. Keep existing supplier API credentials and internal function authentication configured.

Before enabling live automation, exercise one paid school order in staging, stock pull, shortage purchase, supplier receipt, and cancellation. Check a below-minimum weekly merge with a regular batch and a supplier timeout. A live carrier quote, supplier acceptance, actual email delivery, and production database migration were not exercised during the local build.

## Local verification

The regression suite uses `TZ=America/Los_Angeles CI=true npm test -- --runInBand`; the existing close-date test assumes the warehouse timezone. Build with `CI=true GENERATE_SOURCEMAP=false npm run build`.

Optional isolated PostgreSQL scenarios use `@electric-sql/pglite` (install outside this repository and set `NODE_PATH` to that installation's `node_modules`). Run `node scripts/pgtest/verify_all_school_fulfillment.cjs` and `node scripts/pgtest/verify_all_school_purchasing.cjs`. These execute the new migrations and exercise refunds, recipe changes, repeated digits, physical stock consumption, duplicate receipts/submissions, weekly merges, maximum-wait promotion, and stale browser submissions without connecting to Supabase.

## Preview

The screenshots use fixture products and branding to demonstrate layout; they do not represent a published store or live inventory.

- [Desktop storefront](all-school-preview/desktop.jpg)
- [Mobile storefront](all-school-preview/mobile.jpg)
- [Store administration](all-school-preview/admin.jpg)

## Production migration verification — October 2, 2026

The four feature migrations and permission hardening were applied to NationalSports production (`hpslkvngulqirmbstlfx`) through the Supabase migration tool. Each application used a 3-second lock timeout and a 30-second statement timeout. The foundation's internal transaction boundaries were consolidated so its entire SQL ran in one transaction. No existing orders were edited and no external supplier/shipping actions were executed.

Verified: all six All School tables have RLS; client roles cannot write directly; the artwork bucket is private; conversion and supplier submission RPCs are backend-only; staff RPCs check `is_team_member()`. Repeated-digit demand for three garments numbered “11” returns six ones, and number “0” is retained. Both per-store automation enablement counts are zero and the DTF send-candidate list is empty.

Supabase generated remote migration timestamps on application. Match by migration name before future CLI deployment; do not rerun the feature SQL solely because its repository timestamp differs from the remote history. The security advisor's remaining All School notices cover the intentionally backend-only scan table and three staff-authorized RPCs, whose authorization checks were reviewed.

The frontend/functions PR remains unmerged. Live carrier quotes, supplier delivery, and an end-to-end paid school order still require configured integrations and rollout verification.
