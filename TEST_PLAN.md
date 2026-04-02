# NSA Portal — Full Test Runbook

**Date:** April 2, 2026
**Purpose:** Walk through every section of the portal to verify functionality before broad team testing.

> **How to use:** Go section by section. Mark each checkbox as you complete it. Note any issues in the "Notes" column. Each section starts with the page name from the sidebar.

---

## Pre-Test Setup

- [ ] Open the portal in Chrome (recommended) with DevTools Console open
- [ ] Log in as an **admin** user (tests all access levels)
- [ ] Confirm no red error banner at the top ("Could not load data from Supabase")
- [ ] Confirm no yellow failed-saves banner
- [ ] Open a second tab logged in as a **non-admin** user (to test access control later)

---

## 1. Login & Authentication

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 1.1 | Load portal URL (not logged in) | Login screen appears | |
| 1.2 | Enter wrong password | Error message, stays on login | |
| 1.3 | Enter correct credentials | Logged in, dashboard loads | |
| 1.4 | Refresh the page | Stays logged in (session persists) | |
| 1.5 | Click "Out" (logout) | Returns to login screen | |
| 1.6 | Log back in | Dashboard loads with all data | |

---

## 2. Dashboard

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 2.1 | Dashboard loads | Shows KPIs, recent activity, todos | |
| 2.2 | Click a recent order link | Navigates to that order | |
| 2.3 | Dismiss a todo item | Item disappears, stays dismissed on refresh | |
| 2.4 | Dismiss a notification | Same behavior | |
| 2.5 | Check sidebar badge counts | Messages (unread), Issues (open), Batch POs (pending) show correct counts | |

---

## 3. Global Search

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 3.1 | Type a customer name in top search bar | Dropdown shows matching customers | |
| 3.2 | Type an SO number (e.g., "SO-100") | Shows matching sales order | |
| 3.3 | Type a PO number | Shows matching PO | |
| 3.4 | Type an invoice number | Shows matching invoice | |
| 3.5 | Click a search result | Navigates to that item | |
| 3.6 | Clear search with X button | Results close, search bar empties | |

---

## 4. Estimates

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 4.1 | Click "+ Estimate" in top bar | New estimate form opens | |
| 4.2 | Select a customer from dropdown | Customer populates, contacts load | |
| 4.3 | Add a memo | Text saves | |
| 4.4 | **Add Item — from Catalog** | Search products, click to add, appears in line items | |
| 4.5 | **Add Item — from S&S** | Search by style #, select color, item adds with live inventory | |
| 4.6 | **Add Item — from SanMar** | Same flow, SanMar products | |
| 4.7 | **Add Item — Custom** | Fill in name/SKU/cost/price, item adds | |
| 4.8 | Add sizes to an item | Size columns appear, can enter quantities | |
| 4.9 | Add a custom size | Custom size column adds | |
| 4.10 | Edit qty in a size cell | Value updates, total recalculates | |
| 4.11 | Copy an item | Duplicate item appears with all sizes/decos | |
| 4.12 | Delete an item | Item removed after confirmation | |
| 4.13 | **Add Art Decoration** | Select position (Front/Back/etc.), links to art file | |
| 4.14 | **Add Numbers Decoration** | Select method, size, assign roster numbers | |
| 4.15 | **Add Names Decoration** | Enter names, map to sizes | |
| 4.16 | **Add Outside Deco** | Select vendor, enter cost/price | |
| 4.17 | Upload art file (Art Library tab) | File uploads to Cloudinary, preview shows | |
| 4.18 | Add color ways to art | Ink/thread colors configurable | |
| 4.19 | Change estimate status to Approved | Status badge updates | |
| 4.20 | **Print estimate** | PDF generates, opens in new tab/downloads | |
| 4.21 | **Email estimate** (Send button) | Send modal opens, can select contact, send | |
| 4.22 | **Convert estimate to SO** | Confirmation prompt, SO created with same items | |
| 4.23 | Go back to estimates list | Estimate shows as "converted" | |
| 4.24 | Filter estimates by status | List filters correctly | |
| 4.25 | Search estimates | Filters by keyword | |

---

## 5. Sales Orders

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 5.1 | Open a sales order | SO editor loads with all tabs | |
| 5.2 | Edit memo, school PO #, expected date | Fields save | |
| 5.3 | Change shipping type (Ship as Ready / Wait / Rep Delivery) | Selection persists | |
| 5.4 | Edit line items (same as estimate tests 4.4–4.16) | All item operations work | |
| 5.5 | **Jobs tab** — verify jobs auto-created from decorations | One job per unique deco combo | |
| 5.6 | **Linked tab** — view linked estimates, invoices, picks | Links navigate correctly | |
| 5.7 | **Firm Dates tab** — request a firm date | Date request created | |
| 5.8 | **Tracking tab** — view shipping info | Tracking data displays | |
| 5.9 | **Costs tab** — verify cost breakdown | Revenue, COGS, margin correct | |
| 5.10 | **History tab** — view change audit trail | Shows timestamps, users, actions | |
| 5.11 | **Messages tab** — post a message with @mention | Message appears, tagged user notified | |
| 5.12 | **Create Invoice** from SO | Invoice modal, select items, set type | |
| 5.13 | **Create Pick (IF)** from SO | Pick modal, select items/sizes, assign destination | |
| 5.14 | **Create PO** from SO | PO modal, select vendor, link items | |
| 5.15 | **Print SO** | PDF generates | |
| 5.16 | **Email SO** | Send modal works | |
| 5.17 | **Revert SO to Estimate** | SO deleted, estimate reopened | |
| 5.18 | **Booking order flow** — confirm booking | Booking confirmed flag set | |
| 5.19 | Orders list — filter by status/rep/date | Filters work correctly | |
| 5.20 | Orders list — sort columns | Sorting works | |

---

## 6. Jobs / Production Board

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 6.1 | Navigate to Jobs page | Production board loads | |
| 6.2 | Filter by decoration type | Board filters | |
| 6.3 | Filter by status | Shows matching jobs | |
| 6.4 | Click a job card | Opens job detail or linked SO | |
| 6.5 | Assign job to machine/person | Assignment modal, select assignee | |
| 6.6 | Change job status | Status updates on board | |
| 6.7 | Split a job | Split modal, creates new sub-jobs | |
| 6.8 | Merge compatible jobs | Jobs combine | |

---

## 7. Art / Design

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 7.1 | Navigate to Art page | Art queue loads | |
| 7.2 | Filter by status (Needs Art / Needs Approval / Approved) | Filters work | |
| 7.3 | Click an art item | Opens art detail | |
| 7.4 | Upload mockup file | File uploads, preview displays | |
| 7.5 | Upload production file | File uploads | |
| 7.6 | Change art status | Status updates | |
| 7.7 | Request art (modal) | Artist assignment, instructions | |

---

## 8. Production

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 8.1 | Navigate to Production page | Production view loads | |
| 8.2 | View production queue | Items display with status | |
| 8.3 | Filter/sort production items | Works correctly | |

---

## 9. Warehouse

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 9.1 | Navigate to Warehouse page | Warehouse view loads | |
| 9.2 | Scan/enter a barcode | Lookup matches SO/PO/IF | |
| 9.3 | Log a warehouse action (receive, ship, pull) | Action logged, shows in recent | |
| 9.4 | View recent warehouse actions | History displays correctly | |
| 9.5 | UPS pickup check | Auto-checks daily | |

---

## 10. Purchase Orders

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 10.1 | Navigate to Purchase Orders page | PO list loads | |
| 10.2 | View a PO detail | Shows vendor, items, status | |
| 10.3 | Mark PO items as received | Received quantities update | |
| 10.4 | Filter POs by status/vendor | Filters work | |
| 10.5 | Search POs | Finds matching POs | |

---

## 11. Batch POs

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 11.1 | Navigate to Batch POs page | Queue loads, badge count matches | |
| 11.2 | Edit a queued batch PO | Changes save | |
| 11.3 | Submit a batch | Moves from queue to submitted | |
| 11.4 | Scan/lookup a submitted batch | Finds matching batch | |

---

## 12. Customers

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 12.1 | Click "+ Customer" in top bar | Customer modal opens | |
| 12.2 | Fill in customer name, save | Customer created, appears in list | |
| 12.3 | Search customers | Filters list | |
| 12.4 | Click a customer | Customer detail page opens | |
| 12.5 | **Activity tab** — view order history | Shows estimates, SOs, invoices | |
| 12.6 | **Activity tab** — filter by type/status | Filters work | |
| 12.7 | **Overview tab** — edit school colors (Pantone) | Colors add/remove | |
| 12.8 | **Overview tab** — edit thread colors | Colors add/remove | |
| 12.9 | **Contacts tab** — add a contact | New contact row, fill in, save | |
| 12.10 | **Contacts tab** — edit a contact | Edit inline, save | |
| 12.11 | **Contacts tab** — delete a contact | Contact removed after confirm | |
| 12.12 | **Promo tab** — create promo program | Program created with type/amount | |
| 12.13 | **Promo tab** — allocate budget to period | Period allocation saves | |
| 12.14 | **Promo tab** — make manual adjustment | Adjustment logged, balance updates | |
| 12.15 | **Artwork tab** — view customer art library | Art groups display | |
| 12.16 | **Artwork tab** — add new art | Art group created | |
| 12.17 | **Artwork tab** — upload files | Files upload correctly | |
| 12.18 | **Reporting tab** — view sales analytics | KPIs and charts display | |
| 12.19 | **Send Account Statement** | Email modal, sends to accounting contact | |
| 12.20 | **Copy Portal Link** | Link copied to clipboard | |
| 12.21 | **Delete Customer** | Customer removed after confirmation | |

---

## 13. Vendors

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 13.1 | Navigate to Vendors page | Vendor list loads | |
| 13.2 | Add a vendor | Vendor created | |
| 13.3 | Edit vendor details | Changes save | |
| 13.4 | Search/filter vendors | Works correctly | |

---

## 14. Team

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 14.1 | Navigate to Team page | Team members list | |
| 14.2 | Edit a team member (name, role, email, phone) | Changes save | |
| 14.3 | Toggle active/inactive | Status updates | |

---

## 15. Products

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 15.1 | Navigate to Products page | Product catalog loads | |
| 15.2 | Click "+ Product" in top bar | Product create modal | |
| 15.3 | Fill in product details, save | Product created | |
| 15.4 | Search products by name/SKU | List filters | |
| 15.5 | Toggle column visibility | Columns show/hide, persists on refresh | |
| 15.6 | Reset columns to default | All defaults restore | |
| 15.7 | Change role view filter | View filters by role | |
| 15.8 | Favorite a product (star) | Star fills, persists on refresh | |
| 15.9 | Edit product details | Changes save | |
| 15.10 | Upload product image | Image uploads, displays | |

---

## 16. Inventory

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 16.1 | Navigate to Inventory page | Stock view loads | |
| 16.2 | **Stock tab** — view current stock levels | Quantities display | |
| 16.3 | **Log tab** — view adjustment history | Log entries display | |
| 16.4 | **POs tab** — view inventory POs | PO list loads | |
| 16.5 | Create inventory PO | PO modal, select vendor/items | |
| 16.6 | Receive inventory PO | Received quantities update stock | |
| 16.7 | Make manual stock adjustment | Adjustment logged, stock updates | |
| 16.8 | Search/filter inventory | Filters work | |

---

## 17. Messages

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 17.1 | Navigate to Messages page | Message list loads | |
| 17.2 | Unread count matches sidebar badge | Counts match | |
| 17.3 | Click a message thread | Thread detail opens | |
| 17.4 | Post a reply | Reply appears in thread | |
| 17.5 | @mention a team member | Tag highlights, member notified | |
| 17.6 | Mark message as read | Unread count decreases | |
| 17.7 | Filter by department | Messages filter correctly | |

---

## 18. Invoices

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 18.1 | Navigate to Invoices page | Invoice list loads | |
| 18.2 | Click an invoice | Invoice detail opens | |
| 18.3 | Record a payment | Payment logged, balance updates | |
| 18.4 | **Print invoice** | PDF generates | |
| 18.5 | **Email invoice** | Send modal, email sends | |
| 18.6 | Filter by status (open/paid/overdue) | Filters work | |
| 18.7 | Search invoices | Finds matching invoices | |
| 18.8 | View aging summary | Aging buckets display correctly | |

---

## 19. Commissions

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 19.1 | Navigate to Commissions page | Commission report loads | |
| 19.2 | Filter by rep/date range | Data filters | |
| 19.3 | View commission breakdowns | Numbers calculate correctly | |

---

## 20. OrderMyGear (OMG) Integration

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 20.1 | Navigate to OMG page | OMG stores list loads | |
| 20.2 | Sync OMG stores | Fetch completes, stores update | |
| 20.3 | View a store detail | Orders and products load | |
| 20.4 | Load store detail (on-demand) | Fetches full store data | |

---

## 21. Reports

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 21.1 | Navigate to Reports page | Report options display | |
| 21.2 | Run a sales report | Data generates correctly | |
| 21.3 | Filter by date range | Report updates | |
| 21.4 | Export report data | CSV/Excel downloads | |

---

## 22. Issues

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 22.1 | Click the issue report button (red alert icon in topbar) | Issue modal opens | |
| 22.2 | Fill in description, set priority | Fields accept input | |
| 22.3 | Submit issue | Issue created, appears in list | |
| 22.4 | Navigate to Issues page | Issues list loads with open count | |
| 22.5 | Resolve an issue | Status changes, counter decreases | |
| 22.6 | Export issues CSV | CSV downloads | |

---

## 23. Import

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 23.1 | Navigate to Import page | Import interface loads | |
| 23.2 | **Product bulk import** — upload CSV/Excel | File parses, preview shows | |
| 23.3 | Review parsed products | Correct columns mapped | |
| 23.4 | Confirm import | Products created/updated, counts shown | |
| 23.5 | **Adidas B2B CSV upload** | File parses, inventory upserted | |

---

## 24. QuickBooks Integration

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 24.1 | Navigate to QB page | QB config loads | |
| 24.2 | View connection status | Shows connected/disconnected | |
| 24.3 | Configure account mapping | Mapping fields editable | |
| 24.4 | Set auto-sync interval | Setting persists | |
| 24.5 | Manual sync (if connected) | Sync runs, log updates | |
| 24.6 | **Bill upload** — upload PDF bills | OCR parses, review screen shows | |
| 24.7 | Review parsed bills | Data extracted correctly | |
| 24.8 | Push bills to QB (if connected) | Bills created in QB | |
| 24.9 | View sync log | Past syncs display | |

---

## 25. Backup & Restore

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 25.1 | Navigate to Backup page | Backup options display | |
| 25.2 | **Export manual backup** | JSON file downloads | |
| 25.3 | **Import backup** | File uploads, data restores after confirm | |
| 25.4 | **Restore auto-backup** | Prompts with timestamp, restores after confirm | |
| 25.5 | Verify auto-backup timestamp | Shows recent (within last 5 minutes) | |

---

## 26. Settings

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 26.1 | Navigate to Settings page | Settings tabs load | |
| 26.2 | **Pricing tab** — edit screen print pricing | Values save | |
| 26.3 | **Pricing tab** — edit embroidery pricing | Values save | |
| 26.4 | **Pricing tab** — edit DTF pricing | Values save | |
| 26.5 | Edit markup/margin defaults | Values persist | |
| 26.6 | Edit categories list | Categories add/remove | |
| 26.7 | Edit company info | Info saves | |
| 26.8 | Edit labor rates | Rates save | |

---

## 27. Sales Tools

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 27.1 | Navigate to Sales Tools page | Tools interface loads | |
| 27.2 | **Quote Requests** — view/filter | List displays | |
| 27.3 | **Size Paste** — paste size data | Parses into size rows | |
| 27.4 | **Deco Calculator** — enter qty/colors/stitches | Price calculates | |
| 27.5 | **Number Roster** — enter/paste numbers | Roster populates | |
| 27.6 | **Reorder tool** — lookup customer | Past orders display | |

---

## 28. Barcode / Scan

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 28.1 | Click scan button in topbar | Scan modal opens | |
| 28.2 | Enter a SO/PO/IF number manually | Lookup finds matching record | |
| 28.3 | Scan a barcode (if hardware available) | Same lookup behavior | |

---

## 29. Mobile View

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 29.1 | Click "Mobile" button in sidebar footer | Switches to mobile layout | |
| 29.2 | Navigate between sections | Mobile nav works | |
| 29.3 | View orders/estimates | Data displays in mobile format | |
| 29.4 | Switch back to desktop | Click "Switch to Desktop", layout restores | |

---

## 30. Customer Portal (Coach Portal)

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 30.1 | Copy portal link from customer detail | Link copied | |
| 30.2 | Open portal link in incognito/new browser | Portal loads for that customer | |
| 30.3 | View open orders | Orders display | |
| 30.4 | View art/mockups for approval | Art previews display | |
| 30.5 | Approve artwork | Approval recorded, visible in main portal | |
| 30.6 | Request art revision with notes | Revision request created | |
| 30.7 | View invoices | Invoice list displays | |
| 30.8 | Add a comment | Comment saves, visible in main portal | |

---

## 31. Access Control (Non-Admin User)

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 31.1 | Log in as non-admin (sales rep) | Dashboard loads | |
| 31.2 | Verify restricted pages hidden from sidebar | Admin-only pages not visible | |
| 31.3 | Verify user can only see their assigned data (if applicable) | Data scoped correctly | |
| 31.4 | Verify settings page restricted | Cannot access or limited options | |

---

## 32. Data Persistence & Hardening (NEW)

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 32.1 | Make several edits across estimates/SOs/invoices | All save to Supabase (check DevTools Network) | |
| 32.2 | Refresh the page | All data reloads from Supabase correctly | |
| 32.3 | Close the tab completely, reopen | Data persists (emergency flush → localStorage cache) | |
| 32.4 | Switch to another tab for 30+ seconds, come back | No data loss | |
| 32.5 | **Simulate offline** (DevTools → Network → Offline) | Yellow banner appears: "X items failed to save..." | |
| 32.6 | Make an edit while offline | Edit saves locally, banner shows failed ID | |
| 32.7 | **Go back online** | Auto-retry clears the banner within 30s | |
| 32.8 | Open DevTools Console | No silent errors, no QuotaExceededError | |
| 32.9 | Check localStorage size (DevTools → Application → Local Storage) | Should be reasonable (< 5MB during normal use) | |

---

## 33. Cross-Browser Quick Check

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 33.1 | Open portal in Firefox | Loads and functions | |
| 33.2 | Open portal in Safari (if on Mac) | Loads and functions | |
| 33.3 | Open portal on mobile device (phone) | Mobile view triggers or usable | |

---

## Issue Log

| # | Page | Issue Description | Severity (P0/P1/P2) | Screenshot? |
|---|------|-------------------|----------------------|-------------|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

---

## Sign-Off

- **Tested by:** _______________
- **Date:** _______________
- **Overall status:** Pass / Fail / Pass with issues
- **Blockers found:** _______________
