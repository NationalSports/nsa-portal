# Vendor price lists

Every saved vendor has a Price lists section, whether or not it has catalog products, catalog attachments, or an API integration. Staff can upload PDF (including scanned pages), XLS, and XLSX files, set optional effective/expiry dates, search by SKU or product keywords, download originals, and archive superseded files. Uploading a replacement does not silently archive another list: vendors may maintain separate seasonal or category lists.

The portal assistant's `vendor_pricing` action searches these same documents. For example: “Find the Adidas price-list price and availability for JY6033” or “Search Acme's price list for fleece.” It displays source excerpts with vendor, filename, page or sheet/row location, effective date, and upload date. Currency, cost/retail distinctions, and quantity breaks remain as printed in the source. It does not change catalog pricing or write an order.

Adidas and UA availability is read from `adidas_inventory` and `ua_inventory` for exact full SKU tokens from the query or matched document sections. Results keep each supplier/SKU/size separate and show sync timestamps, feed source, and incoming quantities/dates. A missing row or failed sync lookup means unknown availability, not zero. Data older than 24 hours is labelled stale. UA requires its style-color code. Other Adidas-branded vendors, such as Adidas Golf, do not inherit the main Adidas vendor's feed.

## Storage and indexing

- `vendor-price-lists` is a private 20 MB bucket. Only the staff-authenticated `vendor-price-lists` Netlify function issues upload tokens and two-minute download URLs. It uses the existing active-team-member authorization helper.
- Documents and extracted chunks have RLS enabled with no direct browser grants. The search and publication RPCs are security invoker functions executable only by `service_role`.
- PDFs are extracted in the browser with PDF.js, with evaluation disabled. Pages with little text or raster images are automatically rendered at up to 216 dpi (8 megapixel cap) and read with a lazy Tesseract.js English OCR worker, reused across pages and terminated after the upload. Page references include OCR confidence and a reminder to verify prices/SKUs; confidence below 85% is flagged. Selectable text is retained alongside OCR on mixed pages. Excel uses the existing SheetJS dependency, preserves formatted values, and records physical source rows. Files are never sent to the assistant model.
- The browser extracts before upload. The server validates section limits and confirms that the stored original exists with its expected size. A transaction publishes the chunks and ready state together. Interrupted uploads remain nonsearchable and can be archived.
- Search uses PostgreSQL full-text matching (`simple`, AND between query terms). The assistant strips question wording and vendor names from the product query. The UI provides direct vendor-scoped search. Archived, incomplete, future, expired, and inactive-vendor lists are excluded.
- Maximums: 20 MB original, 300 PDF pages, 2,000 sections, 2 million extracted characters, and 20 result sections. OCR runs in the browser, so keep the tab open while processing. Each loading/rendering/OCR operation has a two-minute timeout rather than a document-wide timeout. If a page remains unreadable or processing fails, the whole extraction fails before upload; no partial index is published. Semantic/fuzzy search is not part of this implementation.

## Rollout and verification

Apply `20261011075229_vendor_price_lists.sql` before enabling this code in production. No new environment secrets are needed. This change has not applied the migration to the live database or uploaded vendor documents.

Focused Jest tests cover file/date validation, active-staff authorization, incomplete uploads, exact vendor/SKU selection, feed errors, actual XLSX parsing, PDF page citations, automatic scanned/mixed-page OCR, low-confidence labels, unreadable-page rejection, worker cleanup and operation timeouts, and panel behavior. The existing assistant write-tool suite remains green.

The migration was also executed in isolated PostgreSQL (PGlite) with synthetic vendors and documents. Verified vendor scoping; archive/effective/expiry filters; exclusion of unpublished documents; atomic publication; rejection of republishing; private bucket configuration; and denial of direct table/RPC access to anon and authenticated roles. Live vendor IDs, inventory columns, and existing bucket policies were checked read-only. A production storage upload/download smoke test remains for rollout.

After deploying, upload one known PDF and one Excel price list through Vendors → vendor → Price lists. Search a known SKU both there and through the assistant; compare prices with the original, stock quantities with the sync screen, and archive a superseded list to confirm its exclusion.

## Price list panel

Search and uploaded files appear together, alongside a drop zone for one PDF/XLS/XLSX at a time. Browse files is keyboard accessible. Optional dates apply to the next upload and must be set before choosing or dropping the file. Uploads reject multiple files, unsupported extensions, empty/oversized files, and reversed dates. Processing locks out additional uploads. Files display Searchable, Scheduled, Expired, Upload incomplete, or Archived status; only current ready files count as searchable. The layout stacks on narrow screens.

For Athletic Specialties, try “Search Athletic Specialties’s price list for AA70” in the portal assistant, or enter `AA70` in the vendor's price list search. Review the cited row and open the original before using its price in an estimate or order. A zero source price needs vendor confirmation; it should not be assumed to mean free. Athletic Specialties does not have the Adidas/UA stock feed, so this price list alone does not establish availability.

Search results now display recognized spreadsheet sections as tables using original column labels and values. Rows containing every search term are shown first; surrounding rows remain in collapsed source details. When no single row contains all terms, the whole section remains visible. Ambiguous layouts and PDFs retain their source text instead of guessed price fields. The shared renderer also serves the portal assistant, and non-Adidas/UA matches omit unrelated stock-feed panels.

## Use a price-list SKU on an estimate or sales order

In the order editor, choose Add Product and search the SKU (for example `JRL`). The Vendor price lists section searches current uploaded lists alongside catalog/live supplier results. Select Use item to fill the Custom Item form with vendor, SKU, description, and a source price. Review the per-unit USD cost and sell price, then Add Item. Save to product catalog remains off by default. The resulting line has no product ID, uses normal custom-item cost/sell fields, starts at quantity 1 with quantity-only entry, and retains its source filename/row reference in saved notes. Edit quantity on the line and save the document normally.

Recognized spreadsheet headers are required for order lookup. A single cost/wholesale/net-cost column is preferred; an unqualified Price column can prefill only for review, since it may not represent dealer cost. Retail-only, foreign-currency, ambiguous, zero, and nonnumeric prices require manual cost entry. PDFs and unrecognized tables remain searchable in vendor/assistant results and can be entered manually as Custom Items. Price-list updates never automatically reprice existing orders.
