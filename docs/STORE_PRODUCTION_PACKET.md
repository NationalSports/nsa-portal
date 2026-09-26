# Store production packet

Status: release verification completed on 2026-09-26; see validation notes below.

The same server-side projection feeds a six-tab web page and a paginated PDF. Entry points are native-store Orders, the OMG store header (after its shadow store is linked), and the linked SO. `/production-packet` accepts a staff store/SO reference or a recipient token in the URL fragment.

## Included

- SO-aware player projection reuses `resolveWebstoreReportLines`, including substitution and quantity reconciliation. Garment quantities come from current SO lines; awaiting-batch demand is separate. Split decoration quantities and name/number maps are included.
- Garment-specific mocks reuse canonical slot keys and cleared-slot behavior. Approved art does not automatically satisfy missing garment mock coverage.
- Explicit shared instructions can target store, SO, garment, decoration, or player. Existing internal SO/garment/decoration/art notes are staff-only candidates to copy into a reviewed instruction. Archived instructions leave issued snapshots unchanged.
- Shared-page messages are actual `messages` rows on the selected SO. Visibility is recorded separately; historical internal conversation is not shared automatically. Replies validate their shared parent and SO. Sharing an existing message also shares its attachments. Source labels distinguish decorator messages.
- Questions/actions stay visible until resolved and block production issuance while open.
- Links expire after 90 days, are revocable, and can be scoped to one SO. Only token hashes are stored. Recipients cannot issue revisions, manage links, or publish instructions.
- Issued revisions store the projected snapshot. PDF downloads validate the live fingerprint or load the exact issued snapshot. Current-versus-issued differences are shown online. Draft PDFs are labeled unreleased.
- QR codes are generated locally using qrcode. A PDF downloaded through a recipient link includes that same online link; a staff-only download links to staff access. Creating a recipient link in the page selects that link for subsequent downloads in that tab.
- Buyer contact/address and financial fields are omitted from the decorator projection. Existing shared artwork/attachment URLs are reused; this feature does not change their underlying storage ACLs.

## Storage and deployment

Apply `supabase/migrations/20260923153844_store_production_packets.sql` before enabling the route. All four new tables enable RLS and revoke anonymous/authenticated Data API access. Netlify functions verify active staff or validate a hashed recipient token, then access these tables with the server role. Revisions grant that role SELECT/INSERT only.

The deployed database has all four packet tables with RLS enabled and anonymous/authenticated SELECT denied. A temporary packet message was created on SO-2649 for integration verification and removed afterward, including its sharing row.

Functions use Netlify esbuild; PDF generation uses the existing Chromium/Puppeteer dependencies. The renderer accepts a verified packet, not arbitrary HTML. Mock images are restricted to existing Cloudinary/Supabase sources. The primary download runs in the browser. The server renderer remains available and substitutes an explicit unavailable-image notice for failed images.

## Before marking ready / merging

- Apply migration in a disposable preview database and inspect database advisors. Local PGlite migration/privilege checks have passed; live Supabase behavior remains to verify.
- Open one native store and one imported OMG store with a linked shadow store. Check source table compatibility and both entry points.
- Verify a SKU swap, size-specific swap, quantity reduction, cancellation, additional SO units, and a multi-batch store against the existing player report.
- Confirm a shared-page message appears in the portal SO thread, then reply/share from the portal. Verify the public link cannot see unshared notes, messages, buyer contacts, or another SO's snapshot. Exercise revoke and expiration.
- Inspect PDF mock images, QR/link, page breaks, headers, and all player lines with a large store. The PDF renderer bundles successfully; full visual PDF acceptance is still pending.
- Review specialized decoration cases (reversible, multiple personalized-job anchors, split runs, name/number partial quantities). Unsupported/ambiguous cases should block issuance rather than guessing.
- Confirm the desired handling of unassigned SO extras and whether condensed player summaries/individual packing sheets need a separate appendix.

Revision acknowledgment, per-recipient unread tracking, outbound message notifications, and decorator-specific subsets within one SO are not part of this initial draft.

## Validation run

36 tests passed across packet projection, packet access, and existing SO-substitution suites. Local migration check verified RLS/client privilege denial and immutable revision grants. Both serverless functions bundled. Browser fixture verified overview rendering, player search, and the shared/internal message controls. Final production build passed after the refinements.

## Release verification — 2026-09-26

- Live token API loaded the current SO-2649 packet. Packet-created test message was verified in the portal's `messages` table with both `so_id` and `entity_id`, and its public share row. Updating that test message was reflected on the next packet request. Test rows were removed.
- Portal subscribes to `messages` via Supabase Realtime with a coalesced reload; database publication includes `messages`. Portal replies require explicit **Share with decorator** to appear publicly. Private conversation is not automatically exposed.
- The live page requests fresh data every 30 seconds while visible, on focus, and on Refresh. An issued revision and downloaded PDF remain snapshots. SO art is authoritative for batched orders; master store artwork edits do not propagate into an existing copied SO art record through this feature.
- Regression coverage includes source artwork dimension/thread/stitch changes, partial personalization size totals, substitutions, quantity mismatches, public access boundaries, and PDF verification/message metadata.
- Recipient identity is not inferred from a majority of line names; supplied row names remain intact, including orders containing multiple people.

## Decorator email

Copy link is available in the packet header, including on recipient-token pages. Email decorator requires an authenticated staff session; public links do not expose vendor contacts or grant sending access. Staff select a current DPO attached to the store's SOs, then review a draft. The recipient resolves through the DPO's deco_vendor_id to the decorator's linked vendor contact_email (an explicit DPO contact overrides the vendor default). Missing emails remain editable rather than guessed.

Preparing creates a revocable 90-day link scoped to the selected DPO's SO and a dated DPO reference PDF with saved terms, covered garment sizes, rates, and DPO notes. The email uses the existing staff-only Brevo proxy, includes that attachment and link, and sends only after Send email is clicked. No customer-facing invoice or SO prices are included in the DPO PDF. Provider acceptance is reported separately from delivery.
