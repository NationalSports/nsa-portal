# NSA Portal — Full QA Testing Plan

**Goal:** Verify all data connections, saves, loads, and UI flows before going live with 20+ users.

**Method:** You test in the browser, I verify the code/DB side. Check the box when each item passes.

---

## Phase 1: Core Data Load & Auth

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 1.1 | App loads without console errors | Open app, check DevTools Console — no red errors | [ ] |
| 1.2 | All 27 tables load on startup | Console should show `[DB] loaded X rows` for each table (or no errors) | [ ] |
| 1.3 | Login works | Log in as each role type (admin, rep, csr, warehouse, production, art, accounting) | [ ] |
| 1.4 | Role-based nav filtering | Non-admin shouldn't see Settings; non-admin/rep shouldn't see Commissions | [ ] |
| 1.5 | Realtime sync | Open app in 2 tabs, change data in one — other tab updates within ~3s | [ ] |

---

## Phase 2: Estimates

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 2.1 | Create new estimate | Click new, fill customer + items, save — no console errors | [ ] |
| 2.2 | Add items with decorations | Add 2+ items each with embroidery/screen print decos — verify all save | [ ] |
| 2.3 | Add art files | Upload art to estimate — verify estimate_art_files row created | [ ] |
| 2.4 | Edit existing estimate | Reopen saved estimate, change qty/price, save — verify update | [ ] |
| 2.5 | Delete estimate | Delete an estimate — verify cascade deletes items, decos, art files | [ ] |
| 2.6 | Promo fields save | Set promo_applied, promo_amount on estimate — verify columns persist | [ ] |
| 2.7 | Send estimate email | Use Send modal — verify email_status changes to 'sent' | [ ] |
| 2.8 | Convert estimate → SO | Convert an estimate to a sales order — verify all data carries over | [ ] |

---

## Phase 3: Sales Orders

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 3.1 | Create new SO | Create from scratch — verify sales_orders row | [ ] |
| 3.2 | SO items save | Add items with sizes/qtys — verify so_items rows | [ ] |
| 3.3 | SO decorations save | Add decorations to items — verify so_item_decorations | [ ] |
| 3.4 | SO jobs auto-create | Save SO — verify so_jobs created for each deco | [ ] |
| 3.5 | SO art files save | Attach art files — verify so_art_files | [ ] |
| 3.6 | Firm dates save | Add firm dates — verify so_firm_dates rows | [ ] |
| 3.7 | Pick lines save | Add pick lines to items — verify so_item_pick_lines | [ ] |
| 3.8 | PO lines save | Add PO lines — verify so_item_po_lines | [ ] |
| 3.9 | Shipping fields save | Set ship_preference, ship_on_date, _shipping_cost — verify persist | [ ] |
| 3.10 | ShipStation fields | Verify _shipstation_order_id, _shipping_status, _tracking_number save | [ ] |
| 3.11 | Delete SO | Delete SO — verify cascade: items, decos, pick lines, PO lines, jobs, art, firm dates | [ ] |
| 3.12 | SO promo fields | Set promo on SO — verify promo_applied, promo_amount persist | [ ] |

---

## Phase 4: Invoices & Payments

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 4.1 | Create invoice from SO | Generate invoice — verify invoices row | [ ] |
| 4.2 | Invoice items populate | Verify invoice_items match SO items | [ ] |
| 4.3 | Record payment | Add payment — verify invoice_payments row | [ ] |
| 4.4 | Send invoice email | Use send modal — verify delivery | [ ] |
| 4.5 | Delete invoice | Delete — verify cascade of items + payments | [ ] |

---

## Phase 5: Messages & Communication

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 5.1 | Send message on SO | Post message — verify messages row (body, created_at mapped correctly) | [ ] |
| 5.2 | Tag team member | Use @ mention — verify tagged_members array saves | [ ] |
| 5.3 | Message read tracking | Open message as another user — verify message_reads row | [ ] |
| 5.4 | Dept filter | Send message to specific dept — verify dept field saves | [ ] |
| 5.5 | FK deferred save | Send message on unsaved SO — verify deferred save retries | [ ] |
| 5.6 | Slack notification | Tag someone — verify slack_notifications row created (if Slack configured) | [ ] |

---

## Phase 6: Customers & Contacts

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 6.1 | Create customer | Add new customer with all address fields — verify customers row | [ ] |
| 6.2 | Add contacts | Add 2+ contacts — verify customer_contacts rows | [ ] |
| 6.3 | Edit customer | Change billing address — verify update persists | [ ] |
| 6.4 | Delete customer | Delete — verify cascade of contacts | [ ] |
| 6.5 | Tax rate / payment terms | Set tax_rate, tax_exempt, payment_terms — verify persist | [ ] |
| 6.6 | Parent/child customers | Set parent_id — verify hierarchy works | [ ] |

---

## Phase 7: Products & Inventory

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 7.1 | Create product | Add product with all fields — verify products row | [ ] |
| 7.2 | Product inventory | Set inventory levels per size — verify product_inventory rows | [ ] |
| 7.3 | Alert thresholds | Set alert_threshold per size — verify persist | [ ] |
| 7.4 | Inventory page loads | Open Inventory page — displays correctly | [ ] |
| 7.5 | Clearance view | Open clearance subpage — loads without errors | [ ] |

---

## Phase 8: Production & Art Workflow

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 8.1 | Jobs page loads | Open Jobs — verify all SO jobs display | [ ] |
| 8.2 | Art Dashboard loads | Open Art Dashboard — verify art files display | [ ] |
| 8.3 | Art request modal | Create art request — verify art_requests field on job | [ ] |
| 8.4 | Assign artist | Assign artist to job — verify assigned_artist saves | [ ] |
| 8.5 | Art approval flow | Approve art → verify art_status changes | [ ] |
| 8.6 | Coach approval modal | Send to coach — verify sent_to_coach_at, email sends | [ ] |
| 8.7 | Production board | Open Production Board — verify jobs render by status | [ ] |
| 8.8 | Decoration page | Open Decoration — verify deco jobs display | [ ] |
| 8.9 | Job splitting | Split a job — verify new job created, quantities correct | [ ] |
| 8.10 | Count discrepancy | Log count discrepancy — verify issue created if mismatch | [ ] |
| 8.11 | Job status transitions | Move job through statuses (art→prod→complete) — verify saves | [ ] |

---

## Phase 9: Warehouse & Shipping

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 9.1 | Warehouse page loads | Open Warehouse — verify pick lists display | [ ] |
| 9.2 | Pick/fulfill items | Mark items picked — verify pick_lines update | [ ] |
| 9.3 | Shipping integration | Verify ShipStation data syncs (_shipments field) | [ ] |
| 9.4 | Batch PO queue | Open Batch POs — verify data loads | [ ] |
| 9.5 | Purchase orders | Create PO — verify renders correctly | [ ] |

---

## Phase 10: Vendors

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 10.1 | Vendor list loads | Open Vendors — all vendors display | [ ] |
| 10.2 | Create vendor | Add vendor with all fields — verify vendors row | [ ] |
| 10.3 | Edit vendor | Change vendor details — verify update | [ ] |
| 10.4 | Vendor detail view | Click vendor — VendDetail renders correctly | [ ] |

---

## Phase 11: OMG Team Stores

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 11.1 | OMG page loads | Open OMG — verify stores display | [ ] |
| 11.2 | Store products | Verify omg_store_products load correctly | [ ] |

---

## Phase 12: Reports, Commissions & Dashboard

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 12.1 | Dashboard loads (admin) | Open Dashboard as admin — all widgets render | [ ] |
| 12.2 | Dashboard loads (rep) | Open as rep — sales-specific view renders | [ ] |
| 12.3 | Dashboard loads (warehouse) | Open as warehouse — warehouse view renders | [ ] |
| 12.4 | Reports page | Open Reports — all charts/analytics render | [ ] |
| 12.5 | Commissions page | Open as rep — verify commission calculations display | [ ] |

---

## Phase 13: External Integrations

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 13.1 | QuickBooks sync | Open QB page — verify token status, sync works | [ ] |
| 13.2 | Brevo email delivery | Send a test email — verify delivery | [ ] |
| 13.3 | Slack notifications | Trigger notification — verify delivery in Slack | [ ] |
| 13.4 | Slack reply function | Reply in Slack thread — verify message syncs back to portal | [ ] |

---

## Phase 14: Import, Backup & Settings

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 14.1 | CSV import | Import a CSV file — verify data loads correctly | [ ] |
| 14.2 | PDF import | Import a PDF — verify parsing works | [ ] |
| 14.3 | Backup/export | Run backup — verify data exports | [ ] |
| 14.4 | Settings page | Open Settings (admin) — all options render and save | [ ] |
| 14.5 | Promo programs | Create/edit/delete customer_promo_programs — verify CRUD | [ ] |
| 14.6 | Promo periods | Create promo period — verify customer_promo_periods | [ ] |
| 14.7 | Promo usage | Log promo usage — verify customer_promo_usage | [ ] |

---

## Phase 15: Error Recovery & Edge Cases

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 15.1 | Offline → online save | Disconnect network, make changes, reconnect — verify data saves | [ ] |
| 15.2 | Failed save retry | Check localStorage for `_dbSaveFailedIds` — verify retries succeed | [ ] |
| 15.3 | Concurrent edits | Two users edit same SO — verify no data loss | [ ] |
| 15.4 | Large data set | Load with 500+ SOs — verify no timeouts or crashes | [ ] |
| 15.5 | 10,000 row limit | Verify tables with >10k rows still load completely (pagination?) | [ ] |

---

## Phase 16: Multi-User & Permissions

| # | Test | How to verify | Pass? |
|---|------|--------------|-------|
| 16.1 | Admin full access | Admin sees all nav items and can edit everything | [ ] |
| 16.2 | Rep access | Rep sees correct nav; can manage own estimates/orders | [ ] |
| 16.3 | CSR access | CSR can manage orders but not commissions/settings | [ ] |
| 16.4 | Warehouse access | Warehouse sees warehouse/jobs pages; limited edit | [ ] |
| 16.5 | Production access | Production sees jobs/production board; can update statuses | [ ] |
| 16.6 | Art access | Artist sees art dashboard; can manage art requests | [ ] |
| 16.7 | Accounting access | Accounting sees invoices/payments; can edit shipping costs | [ ] |
| 16.8 | 20 concurrent users | Simulate 20 tabs/users — verify realtime sync and no degradation | [ ] |

---

## Recommended Testing Order

1. **Phase 1** — Make sure the app loads and auth works first
2. **Phase 6** — Customers (dependency for everything else)
3. **Phase 7** — Products (dependency for estimates/SOs)
4. **Phase 2** — Estimates
5. **Phase 3** — Sales Orders (biggest and most complex)
6. **Phase 5** — Messages
7. **Phase 8** — Production/Art workflow
8. **Phase 4** — Invoices
9. **Phase 9** — Warehouse
10. **Phase 10-12** — Vendors, OMG, Reports, Dashboards
11. **Phase 13** — External integrations
12. **Phase 14** — Import/Backup/Settings
13. **Phase 15-16** — Edge cases and multi-user
