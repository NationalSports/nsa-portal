// Portal Assistant — an embedded, staff-facing help widget for the NSA portal.
//
// A floating launcher (bottom-right) opens a chat panel that can:
//   1. answer "where is X / what does this screen do / how do I ..." questions
//      via Claude (netlify/functions/portal-assistant.js), and
//   2. run interactive on-screen tutorials that spotlight real elements and
//      walk the user through, step by step.
//
// Design constraints (deliberate for v1):
//   • READ-ONLY / GUIDE-ONLY. The assistant never clicks, submits, or writes
//     anything and never reads customer/order data. It points and explains.
//     The spotlight overlay is click-THROUGH, so the user always drives.
//   • Self-contained. All markup, styles, the screen/tutorial catalog, and the
//     spotlight engine live in this one file, so wiring it into App.js is a
//     one-line mount plus a data-tour-id on the sidebar links. Adding more
//     tutorials = editing the TOURS array below; no other file changes.
//   • Graceful. If the AI endpoint is down/misconfigured it returns
//     { fallback:true } and the widget still runs tutorials and offers the
//     portal tour — it just can't free-form chat.
//
// Element targeting: tutorials/highlights address elements by their
// [data-tour-id] attribute. Today only the sidebar nav links are tagged
// (data-tour-id="nav-<screen id>"), which is enough for navigation tutorials
// and "where is X" highlights on every screen. Steps whose target isn't found
// degrade to a centered callout with the instruction text, so nothing breaks
// as we tag more elements over time.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const ENDPOINT = '/.netlify/functions/portal-assistant';

// ── Screen catalog ──────────────────────────────────────────────────────────
// Conservative, factual one-liners — what each portal screen is for. This is
// the assistant's grounding: it is told to state screen facts only from here
// and never invent specifics. Keep descriptions general and true; when in
// doubt, say less. IDs match App.js's `pg` values and the sidebar nav ids.
const SCREENS = [
  { id: 'dashboard', label: 'Dashboard', desc: 'The home overview you land on — a snapshot of activity across the portal.' },
  { id: 'messages', label: 'Messages', desc: 'Internal messages and order conversations between team members.' },
  { id: 'ai_inbox', label: 'AI Inbox', desc: 'AI-assisted sales inbox for incoming customer emails.' },
  { id: 'ai_tasks', label: 'AI Tasks', desc: 'Queue of AI-generated tasks and requests to review.' },
  { id: 'estimates', label: 'Estimates', desc: 'Create and manage customer quotes/estimates before they become orders.' },
  { id: 'orders', label: 'Sales Orders', desc: 'Sales orders — estimates that have been approved and are being fulfilled.' },
  { id: 'invoices', label: 'Invoices', desc: 'Customer invoices and their payment status.' },
  { id: 'omg', label: 'OMG Team Stores', desc: 'OMG team store orders and management.' },
  { id: 'webstores', label: 'Club Webstores', desc: 'Online team/club stores — build, manage, and process their orders.' },
  { id: 'sales_tools', label: 'Sales Tools', desc: 'Tools that help build and present sales.' },
  { id: 'sales_history', label: 'Sales History', desc: 'A history of past sales for reference.' },
  { id: 'jobs', label: 'Jobs', desc: 'Production jobs — the work items behind orders.' },
  { id: 'uniforms', label: 'Uniform Jobs', desc: 'Uniform-specific production jobs.' },
  { id: 'art', label: 'Art Dashboard', desc: 'Artwork requests and approvals for decoration.' },
  { id: 'production', label: 'Production Board', desc: 'The production board tracking jobs through the shop.' },
  { id: 'warehouse', label: 'Warehouse', desc: 'Warehouse receiving, pulling, and fulfillment.' },
  { id: 'purchase_orders', label: 'Purchase Orders', desc: 'Purchase orders to vendors.' },
  { id: 'batch_pos', label: 'Batch POs', desc: 'A queue for creating purchase orders in batches.' },
  { id: 'customers', label: 'Customers', desc: 'The customer directory — accounts, contacts, and their details.' },
  { id: 'vendors', label: 'Vendors', desc: 'The vendor directory and vendor details.' },
  { id: 'team', label: 'Team', desc: 'The internal team directory of staff members.' },
  { id: 'products', label: 'Products', desc: 'The product catalog — items, colors, and images.' },
  { id: 'inventory', label: 'Inventory', desc: 'Stock levels and inventory information.' },
  { id: 'reports', label: 'Reports', desc: 'Reports and analytics.' },
  { id: 'marketing', label: 'Marketing', desc: 'Marketing tools and activity.' },
  { id: 'commissions', label: 'Commissions', desc: 'Sales rep commission tracking.' },
  { id: 'import', label: 'Import / Upload', desc: 'Import and upload data into the portal, such as spreadsheets.' },
  { id: 'issues', label: 'Issues', desc: 'Tracked issues that need attention.' },
  { id: 'qb', label: 'QuickBooks Sync', desc: 'QuickBooks Online synchronization.' },
  { id: 'backup', label: 'Backup & Data', desc: 'Data backup and export tools.' },
  { id: 'settings', label: 'Settings', desc: 'Portal settings (admin).' },
];

// data-tour-id targets: the sidebar link for each screen (present on every
// screen), kept in lockstep with SCREENS.
const NAV_TARGETS = SCREENS.map((s) => ({ id: `nav-${s.id}`, label: `${s.label} (sidebar link)` }));

// In-screen elements instrumented with data-tour-id in App.js. Each entry MUST have a
// matching data-tour-id="<id>" on a real, always-present, top-level element on that
// `screen`. Grow this list (add the attribute in App.js + an entry here) to widen what
// guided walkthroughs can spotlight. `screen` matches the pg / nav id.
const SCREEN_TARGETS = [
  // screen '' = present on every screen (global). Others match a pg / nav id and are
  // present whenever the user is on that screen. The two oe-* live inside the shared
  // order/estimate editor, so they only spotlight once a record is open (the step's
  // instruction should tell the user to open the record first).
  { id: 'global-search', screen: '', label: 'Global search box (top bar)', desc: 'Searches orders, jobs, POs, invoices, customers, webstore orders; Enter opens the full results page.' },
  { id: 'new-estimate-btn', screen: 'estimates', label: 'New Estimate button', desc: 'Opens a blank estimate to build a new quote.' },
  { id: 'estimates-search', screen: 'estimates', label: 'Estimates search box', desc: 'Filters the estimate list by customer or id.' },
  { id: 'orders-search', screen: 'orders', label: 'Sales Orders search box', desc: 'Filters sales orders by customer, SKU, or PO#.' },
  { id: 'invoices-search', screen: 'invoices', label: 'Invoices search box', desc: 'Filters the invoice list.' },
  { id: 'art-search', screen: 'art', label: 'Art workboard search', desc: 'Filters the art board by customer, SO, or art name.' },
  { id: 'po-search', screen: 'purchase_orders', label: 'Purchase Orders search box', desc: 'Filters the purchase-order list.' },
  { id: 'po-scan-btn', screen: 'purchase_orders', label: 'PO Scan button', desc: 'Opens the barcode scanner to receive goods against a PO.' },
  { id: 'oe-add-product', screen: '', label: 'Add Product button (order/estimate editor)', desc: 'Adds a product line — visible inside an OPEN estimate or sales order with a customer set.' },
  { id: 'oe-convert-so', screen: 'estimates', label: 'Convert to Sales Order button (estimate editor)', desc: 'Converts an OPEN, approved estimate into a sales order — visible inside the open estimate.' },
  { id: 'oe-actions-toggle', screen: '', label: 'Actions menu button (order/estimate editor)', desc: 'At the top of an OPEN estimate or order — opens the menu that holds Apply Promo Funds and Apply Credit.' },
  { id: 'oe-promo-apply', screen: '', label: 'Apply Promo Funds (in the Actions menu)', desc: 'Applies the customer\'s promo funds to the open estimate/order. In the Actions menu; only appears when the customer has promo funds available.' },
  { id: 'oe-tab-items', screen: '', label: 'Line Items tab (order/estimate editor)', desc: 'The tab inside an open estimate/order that holds the product lines and their decorations.' },
  { id: 'oe-expand-all', screen: '', label: 'Expand All line items button', desc: 'Expands every line item so the decoration buttons are visible. Only appears when some lines are collapsed.' },
  { id: 'oe-item-add-art', screen: '', label: 'Add decoration (+ Art) on a line item', desc: 'On an expanded line item, adds an art/logo decoration; beside it sit + Numbers, + Names, and + Twill for the other decoration types.' },
  // Inventory PO flow (restock a vendor, not tied to a sales order). Tab + button live on the
  // Inventory screen; the rest are inside the "New Inventory PO" modal it opens.
  { id: 'inv-pos-tab', screen: 'inventory', label: 'Inventory POs tab', desc: 'On the Inventory screen — switches to the inventory purchase-orders list.' },
  { id: 'inv-new-po-btn', screen: 'inventory', label: '+ New Inventory PO button', desc: 'Opens the modal to create a new inventory (stock) purchase order. On the Inventory POs tab.' },
  { id: 'inv-po-vendor-select', screen: '', label: 'Vendor dropdown (New Inventory PO modal)', desc: 'Pick the PO\'s vendor — inside the New Inventory PO modal.' },
  { id: 'inv-po-product-search', screen: '', label: 'Add Products search (New Inventory PO modal)', desc: 'Search by SKU, name, or color and click a result to add a line — inside the New Inventory PO modal.' },
  { id: 'inv-po-add-custom-item', screen: '', label: '+ Custom Item (New Inventory PO modal)', desc: 'Adds a blank line to type a SKU/name manually — inside the New Inventory PO modal.' },
  { id: 'inv-po-submit-btn', screen: '', label: 'Create PO button (New Inventory PO modal)', desc: 'Saves the inventory purchase order — the last step in the New Inventory PO modal.' },
  // Webstore "extend" flow (change a club store's close/end date). Row button is on the
  // Webstores list; the rest appear as the user opens the store and its settings form.
  { id: 'ws-row-open-store', screen: 'webstores', label: 'Open store button (Store →)', desc: 'On the Webstores list — opens a store\'s detail view. One per store row; open the store you want to extend.' },
  { id: 'ws-launch-store', screen: '', label: '🚀 Launch store button', desc: 'In a store\'s detail header — relaunches a closed or scheduled store so it accepts orders again. Only shown when the store is not currently open.' },
  { id: 'ws-detail-settings', screen: '', label: '⚙ Settings button (store detail)', desc: 'In a store\'s detail header — opens the store settings form, where the close date lives.' },
  { id: 'ws-close-date', screen: '', label: 'Close date field (store settings)', desc: 'The store\'s end date — change it to extend how long the store stays open. On the Setup page of the store settings form.' },
  { id: 'ws-close-time', screen: '', label: 'Close time field (store settings)', desc: 'The Pacific time the store stops taking orders on the close date. Defaults to 11:59 PM so the store runs through the whole day; set it earlier to cut the store off mid-day. Next to the close date on the Setup page.' },
  { id: 'ws-save', screen: '', label: 'Save changes button (store settings)', desc: 'Saves the store settings, including the new close date — the last step of extending a store.' },
];

const TARGETS = [...NAV_TARGETS, ...SCREEN_TARGETS];

// ── Tutorial catalog ─────────────────────────────────────────────────────────
// Each tour is a sequence of steps. A step with `target` spotlights that
// element; a step without one shows a centered callout. Keep step copy honest
// and general — spotlights carry the precise "where", the text carries the
// "what". Grow this list to add tutorials; nothing else needs to change.
const TOURS = [
  {
    id: 'getting-started',
    title: 'Portal tour: the basics',
    desc: 'A quick orientation tour of the main sections of the portal.',
    steps: [
      { target: 'nav-dashboard', title: 'Dashboard', body: 'This is your home base — an overview of what’s happening across the portal. You can always get back here from the sidebar.' },
      { target: 'nav-estimates', title: 'Estimates', body: 'Estimates is where customer quotes start. You build a quote here before it becomes an order.' },
      { target: 'nav-orders', title: 'Sales Orders', body: 'Once an estimate is approved it becomes a Sales Order, which lives here and moves through fulfillment.' },
      { target: 'nav-customers', title: 'Customers', body: 'The Customers directory holds every account and their contacts and details.' },
      { target: 'nav-products', title: 'Products', body: 'The Products catalog is where items, colors, and images live.' },
      { target: 'nav-inventory', title: 'Inventory', body: 'Inventory shows stock levels. That’s the quick tour — open the chat anytime and ask me where to find something.' },
    ],
  },
  {
    id: 'create-estimate',
    title: 'How to create an estimate',
    desc: 'Points you to where estimates are built and the general flow.',
    steps: [
      { target: 'nav-estimates', title: 'Open Estimates', body: 'Estimates are built on the Estimates screen — click here in the sidebar to open it.' },
      { target: null, title: 'Build the quote', body: 'On the Estimates screen, start a new estimate, pick the customer, then add products, sizes, and quantities and save. If a specific step trips you up, ask me here and I’ll point you at it.' },
    ],
  },
  {
    id: 'find-inventory',
    title: 'Where to check stock',
    desc: 'Shows where inventory and stock levels live.',
    steps: [
      { target: 'nav-inventory', title: 'Inventory', body: 'Stock levels live on the Inventory screen — click here to open it and look up what’s on hand.' },
    ],
  },
];

// ── Scoped styles (injected once) ────────────────────────────────────────────
let _stylesInjected = false;
function ensureStyles() {
  if (_stylesInjected || typeof document === 'undefined') return;
  _stylesInjected = true;
  const el = document.createElement('style');
  el.id = 'nsa-assistant-styles';
  el.textContent = `
.nsa-as-launcher{position:fixed;right:24px;bottom:24px;z-index:9000;width:56px;height:56px;border-radius:50%;
  background:#2563eb;color:#fff;border:none;cursor:pointer;box-shadow:0 6px 20px rgba(37,99,235,.4);
  display:flex;align-items:center;justify-content:center;transition:transform .15s ease,box-shadow .15s ease}
.nsa-as-launcher:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(37,99,235,.5)}
/* Mobile: lift the launcher and panel above the bottom tab bar (~56px + safe area). */
.nsa-as-launcher.nsa-as-m{bottom:calc(72px + env(safe-area-inset-bottom));width:52px;height:52px}
.nsa-as-panel.nsa-as-m{bottom:calc(70px + env(safe-area-inset-bottom));max-height:calc(100vh - 96px)}
.nsa-as-panel{position:fixed;right:20px;bottom:20px;z-index:9000;width:392px;height:600px;
  max-width:calc(100vw - 32px);max-height:calc(100vh - 40px);background:#fff;border-radius:16px;
  box-shadow:0 16px 50px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;
  border:1px solid #e2e8f0;animation:nsa-as-pop .16s ease}
@keyframes nsa-as-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.nsa-as-head{background:linear-gradient(120deg,#0f172a,#1e293b);color:#fff;padding:14px 16px;display:flex;
  align-items:center;gap:10px}
.nsa-as-head .nsa-as-avatar{width:34px;height:34px;border-radius:50%;background:#2563eb;display:flex;
  align-items:center;justify-content:center;flex-shrink:0}
.nsa-as-head h3{margin:0;font-size:15px;font-weight:700;line-height:1.1}
.nsa-as-head p{margin:1px 0 0;font-size:11px;color:#94a3b8}
.nsa-as-head .nsa-as-x{margin-left:auto;background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:20px;
  line-height:1;padding:2px 6px;border-radius:6px}
.nsa-as-head .nsa-as-x:hover{background:rgba(255,255,255,.1);color:#fff}
.nsa-as-body{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:10px}
.nsa-as-row{display:flex}
.nsa-as-row.user{justify-content:flex-end}
.nsa-as-bubble{max-width:82%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;
  white-space:pre-wrap;word-wrap:break-word}
.nsa-as-bubble.bot{background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:4px}
.nsa-as-bubble.user{background:#2563eb;color:#fff;border-bottom-right-radius:4px}
.nsa-as-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.nsa-as-chip{background:#fff;border:1px solid #cbd5e1;color:#1e293b;border-radius:14px;padding:6px 11px;
  font-size:12.5px;cursor:pointer;transition:background .12s,border-color .12s}
.nsa-as-chip:hover{background:#eff6ff;border-color:#2563eb;color:#2563eb}
.nsa-as-dots span{display:inline-block;width:6px;height:6px;margin:0 2px;border-radius:50%;background:#94a3b8;
  animation:nsa-as-bounce 1.2s infinite}
.nsa-as-dots span:nth-child(2){animation-delay:.15s}.nsa-as-dots span:nth-child(3){animation-delay:.3s}
@keyframes nsa-as-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
.nsa-as-composer{display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0;background:#fff}
.nsa-as-composer input{flex:1;border:1px solid #cbd5e1;border-radius:20px;padding:9px 14px;font-size:13.5px;outline:none}
.nsa-as-composer input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.nsa-as-send{width:38px;height:38px;border-radius:50%;background:#2563eb;color:#fff;border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;flex-shrink:0}
.nsa-as-send:disabled{background:#cbd5e1;cursor:default}
/* Spotlight overlay */
.nsa-as-spot-ring{position:fixed;z-index:100000;border:2px solid #2563eb;border-radius:8px;pointer-events:none;
  box-shadow:0 0 0 9999px rgba(15,23,42,.55);transition:top .2s,left .2s,width .2s,height .2s}
.nsa-as-spot-dim{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);pointer-events:none}
.nsa-as-callout{position:fixed;z-index:100001;width:300px;max-width:calc(100vw - 24px);background:#fff;
  border-radius:12px;box-shadow:0 12px 40px rgba(15,23,42,.35);padding:14px 16px;pointer-events:auto}
.nsa-as-callout h4{margin:0 0 6px;font-size:14px;font-weight:700;color:#0f172a}
.nsa-as-callout p{margin:0;font-size:13px;line-height:1.5;color:#334155}
.nsa-as-callout .nsa-as-foot{display:flex;align-items:center;gap:8px;margin-top:14px}
.nsa-as-callout .nsa-as-count{font-size:11px;color:#94a3b8;margin-right:auto}
.nsa-as-btn{border:none;border-radius:7px;padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
.nsa-as-btn.primary{background:#2563eb;color:#fff}
.nsa-as-btn.ghost{background:#f1f5f9;color:#475569}
.nsa-as-results{max-width:94%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
.nsa-as-results-head{padding:8px 12px;font-size:12px;font-weight:700;color:#0f172a;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.nsa-as-results-list{display:flex;flex-direction:column}
.nsa-as-results-row{display:flex;gap:6px;align-items:center;border-top:1px solid #f1f5f9}
.nsa-as-results-row:first-child{border-top:none}
.nsa-as-results-cells{flex:1;min-width:0;display:flex;gap:8px;align-items:center;padding:8px 12px;background:none;border:none;cursor:pointer;text-align:left;font-size:12.5px}
.nsa-as-results-cells:hover{background:#eff6ff}
.nsa-as-reorder{flex-shrink:0;margin-right:8px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:8px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.nsa-as-reorder:hover{background:#2563eb;color:#fff;border-color:#2563eb}
.nsa-as-agg{padding:10px 12px;background:#eff6ff;border-bottom:1px solid #e2e8f0;font-size:15px;font-weight:800;color:#1e40af}
.nsa-as-brief-row{display:flex;gap:10px;align-items:center;width:100%;padding:9px 12px;background:none;border:none;border-top:1px solid #f1f5f9;cursor:pointer;text-align:left}
.nsa-as-brief-row:hover{background:#eff6ff}
.nsa-as-brief-count{flex-shrink:0;min-width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;background:#2563eb;color:#fff;border-radius:8px;font-size:12px;font-weight:800}
.nsa-as-brief-label{font-size:12.5px;color:#334155;font-weight:600}
.nsa-as-stock-name{padding:2px 12px 8px;font-size:12px;color:#64748b}
.nsa-as-stock-grid{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px}
.nsa-as-stock-cell{display:flex;flex-direction:column;align-items:center;min-width:38px;padding:5px 6px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px}
.nsa-as-stock-cell.zero{border-color:#e2e8f0;background:#f8fafc}
.nsa-as-stock-cell .sz{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase}
.nsa-as-stock-cell .qty{font-size:14px;font-weight:800;color:#166534}
.nsa-as-stock-cell.zero .qty{color:#94a3b8}
.nsa-as-report-line{display:flex;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #f1f5f9;font-size:12.5px;color:#334155}
.nsa-as-report-line:first-of-type{border-top:none}
.nsa-as-report-line strong{color:#0f172a}
.nsa-as-print-btn{display:block;margin:10px 12px;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer}
.nsa-as-print-btn:hover{background:#1d4ed8}
.nsa-as-rc{color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nsa-as-rc:first-child{font-weight:700;color:#1e40af;flex-shrink:0}
.nsa-as-rc:nth-child(2){flex:1;min-width:0}
.nsa-as-results-more{padding:8px 12px;font-size:11.5px;color:#64748b;background:#f8fafc;border-top:1px solid #f1f5f9}
.nsa-as-confirm-actions{display:flex;gap:8px;justify-content:flex-end;padding:10px 12px;border-top:1px solid #f1f5f9;background:#f8fafc}
.nsa-as-confirm-done{padding:9px 12px;font-size:12.5px;font-weight:700;color:#166534;background:#f0fdf4;border-top:1px solid #dcfce7}
.nsa-as-confirm-err{padding:9px 12px;font-size:12.5px;font-weight:600;color:#b91c1c;background:#fef2f2;border-top:1px solid #fee2e2}
/* Interactive walkthrough: chat stays open (above the dim), each step is a chat card,
   the target pulses, and clicking it (or Next) advances. */
.nsa-as-panel.nsa-as-guiding{z-index:100002}
.nsa-as-guidebar{display:flex;flex-direction:column;gap:6px;padding:9px 12px;background:#0f172a;color:#fff;border-top:1px solid #1e293b}
.nsa-as-guidebar-row{display:flex;align-items:center;gap:8px}
.nsa-as-guidebar-step{font-size:11.5px;font-weight:800;color:#93c5fd;margin-right:auto;letter-spacing:.02em}
.nsa-as-guidebar-status{font-size:11px;line-height:1.35;color:#cbd5e1;display:flex;align-items:center;gap:6px}
.nsa-as-guidebar-status.on{color:#86efac}
.nsa-as-guidebar-dot{width:7px;height:7px;border-radius:50%;background:#64748b;flex-shrink:0}
.nsa-as-guidebar-status.on .nsa-as-guidebar-dot{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)}
.nsa-as-step{max-width:94%;background:#eff6ff;border:1px solid #bfdbfe;border-left:3px solid #2563eb;border-radius:10px;padding:9px 12px}
.nsa-as-step-no{font-size:10.5px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}
.nsa-as-step-title{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:2px}
.nsa-as-step-body{font-size:12.5px;line-height:1.45;color:#334155}
.nsa-as-step-hintline{font-size:11px;color:#2563eb;font-weight:600;margin-top:5px}
.nsa-as-guide-ring{z-index:100000}
.nsa-as-guide-ring::after{content:'';position:absolute;inset:-4px;border-radius:10px;border:2px solid rgba(37,99,235,.55);animation:nsa-as-pulse 1.4s ease-out infinite}
@keyframes nsa-as-pulse{0%{transform:scale(1);opacity:.85}100%{transform:scale(1.14);opacity:0}}
.nsa-as-guide-hint{position:fixed;z-index:100001;background:#2563eb;color:#fff;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:12px;box-shadow:0 4px 14px rgba(37,99,235,.5);pointer-events:none;white-space:nowrap}
`;
  document.head.appendChild(el);
}

// ── Element resolution (data-tour-id OR visible label) ─────────────────────────
// A guide step points at an element either by `target` (a data-tour-id we instrumented)
// or by `find` (the element's visible on-screen text). The label path lets the assistant
// spotlight controls across the whole portal without every one being pre-tagged: it scans
// visible buttons/tabs/links and matches their caption. It fails safe — a weak/ambiguous
// match returns nothing, so the step degrades to a written instruction rather than ringing
// the wrong thing.
function normLabel(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function findByLabel(query) {
  const want = normLabel(query);
  if (!want || want.length < 2 || typeof document === 'undefined') return null;
  let nodes;
  try { nodes = document.querySelectorAll('button, a[href], [role="button"], .tab, .btn, input[type="submit"], input[type="button"], select'); }
  catch (e) { return null; }
  const scored = [];
  nodes.forEach((el) => {
    if (el.closest && el.closest('.nsa-as-panel')) return; // never our own chat UI
    let r; try { r = el.getBoundingClientRect(); } catch (e) { return; }
    if (!r || (r.width === 0 && r.height === 0)) return; // must be visible
    const cands = [];
    const txt = (el.textContent || '').trim(); if (txt && txt.length <= 40) cands.push(txt);
    if (el.getAttribute) { ['aria-label', 'title', 'value', 'placeholder'].forEach((a) => { const v = el.getAttribute(a); if (v) cands.push(v); }); }
    let best = 0;
    cands.forEach((raw) => {
      const cand = normLabel(raw);
      if (!cand) return;
      let score = 0;
      if (cand === want) score = 100;
      else if (cand.startsWith(want) || want.startsWith(cand)) score = 82 - Math.min(Math.abs(cand.length - want.length), 20);
      else if (cand.includes(want)) score = 60 - Math.min(cand.length - want.length, 20);
      else if (want.includes(cand) && cand.length >= 3) score = 48;
      if (score > best) best = score;
    });
    if (best > 0) scored.push({ el, score: best, len: (el.textContent || '').trim().length || 99, top: r.top });
  });
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.len - b.len || a.top - b.top);
  // Ambiguity guard: a weak match that several elements share is unreliable — bail to the
  // written instruction instead of highlighting a guess.
  const top = scored[0];
  if (top.score < 55) return null;
  if (top.score < 82 && scored.filter((s) => s.score === top.score).length > 1) return null;
  return top.el;
}
// Resolve a step's element: prefer the instrumented data-tour-id, then fall back to the label.
function resolveStepEl(step) {
  if (!step) return null;
  if (step.target) { try { const el = document.querySelector(`[data-tour-id="${step.target}"]`); if (el) return el; } catch (e) { /* bad selector */ } }
  if (step.find) return findByLabel(step.find);
  return null;
}

// ── Guide spotlight ───────────────────────────────────────────────────────────
// A pulsing ring + dimmed backdrop around the current step's target element, plus
// a small "click to continue" hint. NO callout box — the step explanation lives in
// the chat (which stays open above the dim). Everything here is click-through, so
// the user actually clicks the highlighted element to advance. If the target isn't
// on screen (an instruction-only step), it renders nothing and the chat carries it.
function GuideSpotlight({ step }) {
  const [rect, setRect] = useState(null);

  const measure = useCallback(() => {
    const el = resolveStepEl(step);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { setRect(null); return; }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    const el = resolveStepEl(step);
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* older browsers */ }
    }
    const t = setTimeout(measure, 60);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const iv = setInterval(measure, 300); // catch navigation / late layout shifts
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [measure, step]);

  if (!rect) return null;
  const pad = 6;
  const ringStyle = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const vh = window.innerHeight || 800;
  const hintTop = (rect.top + rect.height + 8 < vh - 40) ? rect.top + rect.height + 10 : Math.max(rect.top - 28, 8);
  const hintLeft = Math.min(Math.max(rect.left, 12), (window.innerWidth || 1200) - 150);
  return createPortal(
    <>
      <div className="nsa-as-spot-ring nsa-as-guide-ring" style={ringStyle} />
      <div className="nsa-as-guide-hint" style={{ top: hintTop, left: hintLeft }}>Click here to continue →</div>
    </>,
    document.body,
  );
}

// ── Small presentational bits ─────────────────────────────────────────────────
const IconChat = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);
const IconSend = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

// In-chat summary of a search result set. The full, sortable list renders on
// the results page (App's rSearch NL mode); this shows the count + a few
// clickable rows so the answer is right there in the conversation.
function labelFor(entity) {
  return ({ sales_orders: 'sales orders', jobs: 'jobs', invoices: 'invoices', estimates: 'estimates', customers: 'customers', products: 'products', purchase_orders: 'purchase orders' })[entity] || 'results';
}
function ResultsCard({ results, onOpen, onReorder }) {
  const cols = (results.columns || []).slice(0, 3);
  const rows = results.rows || [];
  const shown = rows.slice(0, 6);
  const canReorder = (e) => e === 'sales_orders' || e === 'estimates';
  return (
    <div className="nsa-as-row bot">
      <div className="nsa-as-results">
        <div className="nsa-as-results-head">{results.total} {labelFor(results.entity)}{results.error ? ' · search error' : ' · full list shown behind this panel'}</div>
        {results.aggregate && <div className="nsa-as-agg">{results.aggregate.text}</div>}
        {shown.length > 0 && (
          <div className="nsa-as-results-list">
            {shown.map((r, i) => (
              <div key={(r.id || '') + i} className="nsa-as-results-row">
                <button className="nsa-as-results-cells" onClick={() => onOpen && onOpen(r)}>
                  {cols.map((c) => <span key={c} className="nsa-as-rc">{r.cells[c]}</span>)}
                </button>
                {onReorder && canReorder(r.entity) && (
                  <button className="nsa-as-reorder" title="Reorder into a new draft estimate" onClick={() => onReorder(r)}>↻ Reorder</button>
                )}
              </div>
            ))}
          </div>
        )}
        {results.total > shown.length && <div className="nsa-as-results-more">+{results.total - shown.length} more in the results page →</div>}
        {results.total === 0 && !results.error && <div className="nsa-as-results-more">No matches — try rephrasing.</div>}
      </div>
    </div>
  );
}

// "What needs your attention" summary — one clickable row per flagged bucket.
function BriefCard({ items, onPick, title, showAll }) {
  const rows = (items || []).filter(Boolean);
  const active = rows.filter((r) => (r.count || 0) > 0);
  const list = showAll ? rows : active;
  return (
    <div className="nsa-as-row bot">
      <div className="nsa-as-results">
        <div className="nsa-as-results-head">{title || 'What needs your attention'}</div>
        {!showAll && active.length === 0 && <div className="nsa-as-results-more">You're all clear — nothing flagged right now. 🎉</div>}
        {list.map((r, i) => (
          <button key={i} className="nsa-as-brief-row" onClick={() => onPick && r.spec && onPick(r.spec)}>
            <span className="nsa-as-brief-count">{r.count}</span>
            <span className="nsa-as-brief-label">{r.label}{r.total ? ` · ${r.total}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Live vendor stock for one product — per-size on-hand grid + next delivery.
function StockCard({ stock }) {
  const sizes = (stock.sizes || []).filter((s) => s.qty > 0 || s.futureQty > 0);
  return (
    <div className="nsa-as-row bot">
      <div className="nsa-as-results">
        <div className="nsa-as-results-head">{stock.sku}{stock.color ? ` · ${stock.color}` : ''} — {stock.onHand > 0 ? `${stock.onHand} in stock at vendor` : 'out of stock at vendor'}</div>
        {stock.name && <div className="nsa-as-stock-name">{stock.name}</div>}
        {sizes.length > 0 && (
          <div className="nsa-as-stock-grid">
            {sizes.map((s, i) => (
              <div key={i} className={`nsa-as-stock-cell${s.qty > 0 ? '' : ' zero'}`}>
                <span className="sz">{s.size}</span>
                <span className="qty">{s.qty}</span>
              </div>
            ))}
          </div>
        )}
        {stock.nextDelivery && <div className="nsa-as-results-more">Next delivery: {stock.nextDelivery.qty} unit{stock.nextDelivery.qty === 1 ? '' : 's'} around {stock.nextDelivery.date}</div>}
      </div>
    </div>
  );
}

// A write the user must confirm before it saves (a reminder or a note). Shows
// the resolved draft, then Confirm/Cancel. Nothing is written until Confirm.
function ConfirmCard({ draft, onCommit }) {
  const [state, setState] = useState('pending'); // pending | saving | done | error | cancelled
  const [msg, setMsg] = useState('');
  const confirm = async () => {
    setState('saving');
    let res = null;
    try { res = await onCommit(); } catch { res = null; }
    if (res && res.ok) { setState('done'); setMsg(res.message || 'Saved.'); }
    else { setState('error'); setMsg((res && res.message) || "Couldn't save that — try again."); }
  };
  return (
    <div className="nsa-as-row bot">
      <div className="nsa-as-results">
        <div className="nsa-as-results-head">{draft.title}</div>
        {(draft.lines || []).map((l, i) => (
          <div key={i} className="nsa-as-report-line"><span>{l.label}</span><strong>{l.value}</strong></div>
        ))}
        {state === 'pending' && (
          <div className="nsa-as-confirm-actions">
            <button className="nsa-as-btn ghost" onClick={() => setState('cancelled')}>Cancel</button>
            <button className="nsa-as-btn primary" onClick={confirm}>{draft.confirmLabel || 'Confirm & save'}</button>
          </div>
        )}
        {state === 'saving' && <div className="nsa-as-results-more">Saving…</div>}
        {state === 'done' && <div className="nsa-as-confirm-done">✓ {msg}</div>}
        {state === 'error' && <div className="nsa-as-confirm-err">{msg}</div>}
        {state === 'cancelled' && <div className="nsa-as-results-more">Cancelled — nothing was saved.</div>}
      </div>
    </div>
  );
}

// A computed customer report — headline metrics + a Print/PDF button for the full document.
function ReportCard({ report, onPrint }) {
  return (
    <div className="nsa-as-row bot">
      <div className="nsa-as-results">
        <div className="nsa-as-results-head">{report.title}</div>
        {(report.summary || []).map((s, i) => (
          <div key={i} className="nsa-as-report-line"><span>{s.label}</span><strong>{s.value}</strong></div>
        ))}
        {report.note && <div className="nsa-as-results-more">{report.note}</div>}
        {report.doc && <button className="nsa-as-print-btn" onClick={() => onPrint && onPrint(report.doc)}>🖨 Print / Save PDF</button>}
      </div>
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────
export default function PortalAssistant({ pg, screenTitle, userName, variant, openRecord, onNavigate, onSearch, openResult, onReorder, onAddLine, onBrief, onCustomer360, onVendorStock, onStartEstimate, onReport, onPrintReport, onSetReminder, onAddNote, onFindProducts }) {
  const mCls = variant === 'mobile' ? ' nsa-as-m' : '';
  ensureStyles();
  const [open, setOpen] = useState(() => {
    try { return window.sessionStorage.getItem('nsa_assistant_open') === '1'; } catch { return false; }
  });
  const greeting = () => ({ id: 'greet', from: 'bot', text: `Hi${userName ? ` ${String(userName).split(' ')[0]}` : ''}! I'm your Portal Assistant. I can search anything, build reports, help with estimates, set reminders, leave notes, and walk you through the portal. Try "unpaid invoices past due 30 days", "how much adidas did San Mateo buy this year", "remind me to follow up with FPU on Friday", or "what needs my attention."` });
  const [messages, setMessages] = useState(() => [greeting()]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tour, setTour] = useState(null); // { steps, index }
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const tourRef = useRef(null);
  const advancedFromRef = useRef(-1); // guards against click + Next both advancing the same step
  useEffect(() => { tourRef.current = tour; }, [tour]);

  useEffect(() => { try { window.sessionStorage.setItem('nsa_assistant_open', open ? '1' : '0'); } catch { /* ignore */ } }, [open]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, busy, open]);
  useEffect(() => { if (open && inputRef.current) { try { inputRef.current.focus(); } catch (e) { /* ignore */ } } }, [open]);
  // Cmd/Ctrl+K toggles the assistant open/closed.
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Post one step as a chat card so the walkthrough reads inline and the user can ask
  // questions between steps without losing the thread.
  const postStep = useCallback((step, no, total) => {
    setMessages((prev) => [...prev, {
      id: `gs${Date.now()}-${no}`, from: 'bot', kind: 'step', stepNo: no, stepTotal: total,
      title: step.title, body: step.body, hasTarget: !!step.target,
    }]);
  }, []);

  // Start an interactive walkthrough. Unlike the old modal tour, the chat stays OPEN and
  // docked above the dim; each step is a chat card; the target pulses and the user advances
  // by clicking it (or Next). Used by AI guides, canned tours, and single highlights alike.
  const beginGuide = useCallback((intro, steps) => {
    const list = (steps || [])
      .filter((s) => s && (s.body || s.target || s.target_id || s.find))
      .map((s) => ({ target: s.target || s.target_id || null, find: s.find || null, screen: s.screen || null, title: s.title || '', body: s.body || '' }));
    if (!list.length) return;
    advancedFromRef.current = -1;
    setOpen(true);
    if (intro) setMessages((prev) => [...prev, { id: `gi${Date.now()}`, from: 'bot', text: intro }]);
    postStep(list[0], 1, list.length);
    setTour({ steps: list, index: 0 });
  }, [postStep]);

  const endGuide = useCallback((finished) => {
    advancedFromRef.current = -1;
    if (finished) setMessages((prev) => [...prev, { id: `gd${Date.now()}`, from: 'bot', text: "That's the last step — you're all set! Ask me anything else, or I can walk you through something else." }]);
    setTour(null);
  }, []);

  const goNext = useCallback(() => {
    const t = tourRef.current;
    if (!t) return;
    if (advancedFromRef.current === t.index) return; // click + Next both fired for this step
    advancedFromRef.current = t.index;
    const next = t.index + 1;
    if (next >= t.steps.length) { endGuide(true); return; }
    postStep(t.steps[next], next + 1, t.steps.length);
    setTour({ ...t, index: next });
  }, [postStep, endGuide]);

  const startTour = useCallback((tourId) => {
    const t = TOURS.find((x) => x.id === tourId);
    if (!t || !t.steps.length) return;
    beginGuide(null, t.steps);
  }, [beginGuide]);

  const highlight = useCallback((targetId) => {
    const tgt = TARGETS.find((x) => x.id === targetId);
    const label = tgt ? tgt.label.replace(/ \(sidebar link\)$/, '') : targetId;
    beginGuide(null, [{ target: targetId, screen: (tgt && tgt.screen) || null, title: 'Here it is', body: `This is ${label}. Click it when you're ready.` }]);
  }, [beginGuide]);

  const doSearch = useCallback((spec) => {
    if (!onSearch) return;
    let res = null;
    try { res = onSearch(spec); } catch { res = null; }
    if (!res) return;
    setMessages((prev) => [...prev, { id: `r${Date.now()}`, from: 'bot', kind: 'results', results: res }]);
  }, [onSearch]);

  const doAddLine = useCallback(async (spec) => {
    const pushBot = (text) => setMessages((prev) => [...prev, { id: `a${Date.now()}`, from: 'bot', text }]);
    if (!onAddLine) { pushBot("I can't add items here yet."); return; }
    let res = null;
    try { res = await onAddLine(spec); } catch { res = null; }
    if (!res || res.error === 'no_estimate_open') { pushBot('Open an estimate first, then tell me what to add — e.g. "add adidas navy LS pregame tee at 40% margin".'); return; }
    if (res.error === 'not_found') { pushBot(`I couldn't find a product matching "${spec.description}". Try a SKU or different wording.`); return; }
    if (res.ok) {
      const p = res.product || {};
      let txt = `Added ${p.name || 'the item'}${p.color ? ` (${p.color})` : ''} to the estimate at $${p.unit_sell}`;
      txt += res.applied ? ` — about ${res.margin}% margin.` : (res.noCost ? ` — no cost on file, so I used the default price instead of ${res.margin}% margin.` : '.');
      txt += ' Set the sizes/quantities and Save when it looks right.';
      if (res.others && res.others.length) txt += ` Not the right one? Others: ${res.others.map((o) => o.sku).filter(Boolean).join(', ')}.`;
      pushBot(txt);
    }
  }, [onAddLine]);

  const doBrief = useCallback(() => {
    let items = [];
    try { items = (onBrief && onBrief()) || []; } catch { items = []; }
    setMessages((prev) => [...prev, { id: `br${Date.now()}`, from: 'bot', kind: 'brief', brief: items }]);
  }, [onBrief]);

  const doCustomer360 = useCallback(async (customer) => {
    const pushBot = (t) => setMessages((prev) => [...prev, { id: `c${Date.now()}`, from: 'bot', text: t }]);
    if (!onCustomer360) { pushBot("I can't pull customer summaries yet."); return; }
    let res = null;
    try { res = await onCustomer360(customer); } catch { res = null; }
    if (!res || res.error === 'no_customer') { pushBot('Which customer?'); return; }
    if (res.error === 'not_found') { pushBot(`I couldn't find a customer matching "${customer}".`); return; }
    if (res.ok) { setMessages((prev) => [...prev, { id: `c${Date.now()}`, from: 'bot', kind: 'brief', brief: res.lines, briefTitle: `${res.name}${res.tag ? ` · ${res.tag}` : ''}`, briefAll: true }]); }
  }, [onCustomer360]);

  const doVendorStock = useCallback(async (query) => {
    const pushBot = (t) => setMessages((prev) => [...prev, { id: `s${Date.now()}`, from: 'bot', text: t }]);
    if (!onVendorStock) { pushBot("I can't check vendor stock yet."); return; }
    let res = null;
    try { res = await onVendorStock(query); } catch { res = null; }
    if (!res || res.error === 'no_query') { pushBot('Which product? Give me a SKU or a description.'); return; }
    if (res.error === 'no_db') { pushBot("I can't reach the inventory data right now — try again in a moment."); return; }
    if (res.error === 'no_stock') { pushBot(`No vendor stock on file for ${res.sku || query}${res.name ? ` (${res.name})` : ''} — it may not be a synced vendor item.`); return; }
    if (res.ok) { setMessages((prev) => [...prev, { id: `s${Date.now()}`, from: 'bot', kind: 'stock', stock: res }]); }
  }, [onVendorStock]);

  const doStartEstimate = useCallback(async (spec) => {
    const pushBot = (t) => setMessages((prev) => [...prev, { id: `e${Date.now()}`, from: 'bot', text: t }]);
    if (!onStartEstimate) { pushBot("I can't start estimates yet."); return; }
    let res = null;
    try { res = await onStartEstimate(spec); } catch { res = null; }
    if (!res || res.error === 'no_customer') { pushBot('Which customer should the estimate be for?'); return; }
    if (res.error === 'customer_not_found') { pushBot(`I couldn't find a customer matching "${spec.customer}".`); return; }
    if (res.ok) {
      let t = `Started draft ${res.estId} for ${res.name}`;
      t += (res.added && res.added.length) ? ` with ${res.added.length} item${res.added.length === 1 ? '' : 's'}: ${res.added.map((a) => a.sku).join(', ')}.` : ' (no items yet).';
      t += ' Set sizes/quantities and Save when it looks right.';
      if (res.notFound && res.notFound.length) t += ` I couldn't match: ${res.notFound.join('; ')} — add those manually.`;
      pushBot(t);
    }
  }, [onStartEstimate]);

  const doReport = useCallback(async (spec) => {
    const pushBot = (t) => setMessages((prev) => [...prev, { id: `rp${Date.now()}`, from: 'bot', text: t }]);
    if (!onReport) { pushBot("I can't generate reports yet."); return; }
    let res = null;
    try { res = await onReport(spec); } catch { res = null; }
    if (!res || res.error === 'no_customer') { pushBot('Which customer is the report for?'); return; }
    if (res.error === 'customer_not_found') { pushBot(`I couldn't find a customer matching "${spec.customer}".`); return; }
    if (res.ok) { setMessages((prev) => [...prev, { id: `rp${Date.now()}`, from: 'bot', kind: 'report', report: res }]); }
  }, [onReport]);

  const doSetReminder = useCallback((reminder) => {
    const pushBot = (t) => setMessages((prev) => [...prev, { id: `rm${Date.now()}`, from: 'bot', text: t }]);
    if (!onSetReminder) { pushBot("I can't set reminders yet."); return; }
    let res = null;
    try { res = onSetReminder(reminder); } catch { res = null; }
    if (!res || res.error) { pushBot((res && res.error) || "I couldn't build that reminder — try rephrasing."); return; }
    setMessages((prev) => [...prev, { id: `rm${Date.now()}`, from: 'bot', kind: 'confirm', draft: { title: res.title || 'New reminder', lines: res.lines, confirmLabel: 'Save reminder' }, commit: res.commit }]);
  }, [onSetReminder]);

  const doAddNote = useCallback((note) => {
    const pushBot = (t) => setMessages((prev) => [...prev, { id: `nt${Date.now()}`, from: 'bot', text: t }]);
    if (!onAddNote) { pushBot("I can't add notes yet."); return; }
    let res = null;
    try { res = onAddNote(note); } catch { res = null; }
    if (!res || res.error) { pushBot((res && res.error) || "I couldn't figure out where to put that note — tell me the order number or customer."); return; }
    setMessages((prev) => [...prev, { id: `nt${Date.now()}`, from: 'bot', kind: 'confirm', draft: { title: res.title || 'New note', lines: res.lines, confirmLabel: 'Save note' }, commit: res.commit }]);
  }, [onAddNote]);

  // A dynamic, AI-composed walkthrough. Each step carries an instruction and may spotlight an
  // element (target_id) and/or move the user to a screen (screen). Reuses the Spotlight engine;
  // the per-step navigation effect below drives onNavigate as the steps advance.
  const doFindProducts = useCallback(async (spec) => {
    const pushBot = (t) => setMessages((prev) => [...prev, { id: `fp${Date.now()}`, from: 'bot', text: t }]);
    if (!onFindProducts) { pushBot("I can't pull product options here yet — try it on desktop."); return; }
    let res = null;
    try { res = await onFindProducts(spec); } catch { res = null; }
    if (!res || res.error === 'no_db') { pushBot("I can't reach the product data right now — try again in a moment."); return; }
    if (res.error) { pushBot("That product search didn't work — try different words, a color, or a cost cap."); return; }
    if (res.ok) {
      if (!res.total) { pushBot('No products matched that. Try different words, a color, or a higher cost cap.'); return; }
      pushBot(`Found ${res.total} option${res.total === 1 ? '' : 's'}${res.shown < res.total ? ` (showing ${res.shown})` : ''} — they're on the results page behind this chat, with live vendor stock. Adjust the markup and hit “Download Coach PDF” to send them.`);
    }
  }, [onFindProducts]);

  const doGuide = useCallback((intro, steps) => {
    beginGuide(intro, steps);
  }, [beginGuide]);

  const runActions = useCallback((actions) => {
    if (!Array.isArray(actions)) return;
    // One UI action per turn is plenty; take the first meaningful one.
    const a = actions[0];
    if (!a) return;
    if (a.type === 'start_tutorial' && a.tour_id) startTour(a.tour_id);
    else if (a.type === 'highlight' && a.target_id) highlight(a.target_id);
    else if (a.type === 'search' && a.spec) doSearch(a.spec);
    else if (a.type === 'add_line' && a.description) doAddLine({ description: a.description, margin_pct: a.margin_pct });
    else if (a.type === 'daily_brief') doBrief();
    else if (a.type === 'customer_360' && a.customer) doCustomer360(a.customer);
    else if (a.type === 'vendor_stock' && a.query) doVendorStock(a.query);
    else if (a.type === 'start_estimate' && a.customer) doStartEstimate({ customer: a.customer, items: a.items });
    else if (a.type === 'report' && a.report) doReport(a.report);
    else if (a.type === 'set_reminder' && a.reminder) doSetReminder(a.reminder);
    else if (a.type === 'add_note' && a.note) doAddNote(a.note);
    else if (a.type === 'guide' && a.steps) doGuide(a.intro, a.steps);
    else if (a.type === 'find_products' && a.spec) doFindProducts(a.spec);
  }, [startTour, highlight, doSearch, doAddLine, doBrief, doCustomer360, doVendorStock, doStartEstimate, doReport, doSetReminder, doAddNote, doGuide, doFindProducts]);

  // As a guided walkthrough advances, move the user to each step's screen (desktop nav).
  // onNavigate is kept in a ref so this fires only when the step changes — not on every
  // parent re-render — otherwise it would keep yanking the user back to the step's screen.
  const navRef = useRef(onNavigate);
  useEffect(() => { navRef.current = onNavigate; }, [onNavigate]);
  useEffect(() => {
    if (!tour) return;
    const step = tour.steps[tour.index];
    if (step && step.screen && navRef.current) { try { navRef.current(step.screen); } catch (e) { /* ignore */ } }
  }, [tour]);

  // Advance the walkthrough when the user actually clicks the highlighted element. A
  // document-level capture listener finds the live node each time (robust to re-renders);
  // we let the real click's action run, then move to the next step. Instruction-only steps
  // (no target) advance via the Next button in the guide bar instead.
  const goNextRef = useRef(goNext);
  useEffect(() => { goNextRef.current = goNext; }, [goNext]);
  useEffect(() => {
    if (!tour) return undefined;
    const step = tour.steps[tour.index];
    if (!step || !(step.target || step.find)) return undefined;
    const onClick = (e) => {
      const el = resolveStepEl(step);
      if (el && (el === e.target || el.contains(e.target))) {
        // Clicking a button/tab/link advances. For form fields (a select, a search box),
        // clicking just focuses them — let the user fill it in and advance with Next instead.
        const tag = ((e.target && e.target.tagName) || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'OPTION') return;
        setTimeout(() => { if (goNextRef.current) goNextRef.current(); }, 450);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [tour]);

  // Live tracker: while a walkthrough is active, poll for whether the current step's element
  // is actually on screen (so the guide bar tells the truth instead of claiming a highlight
  // that isn't there). And when a step is instruction-only ("open the estimate"), auto-advance
  // the moment the NEXT step's element appears — i.e. the user did the thing and revealed it.
  // That's what makes the guide move as you move through the portal.
  const [targetPresent, setTargetPresent] = useState(false);
  useEffect(() => {
    if (!tour) { setTargetPresent(false); return undefined; }
    const stepVisible = (step) => {
      const el = resolveStepEl(step);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return !(r.width === 0 && r.height === 0);
    };
    const hasSpec = (step) => !!(step && (step.target || step.find));
    const check = () => {
      const t = tourRef.current;
      if (!t) return;
      const step = t.steps[t.index];
      setTargetPresent(hasSpec(step) && stepVisible(step));
      // Instruction-only step (no element to point at): auto-advance the moment the NEXT
      // step's element appears — i.e. the user did the thing and revealed it.
      if (step && !hasSpec(step)) {
        const nxt = t.steps[t.index + 1];
        if (hasSpec(nxt) && stepVisible(nxt) && goNextRef.current) goNextRef.current();
      }
    };
    check();
    const iv = setInterval(check, 400);
    return () => clearInterval(iv);
  }, [tour]);

  // Escape ends the walkthrough.
  useEffect(() => {
    if (!tour) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') endGuide(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour, endGuide]);

  const send = useCallback(async (rawText) => {
    const text = String(rawText || '').trim();
    if (!text || busy) return;
    const userMsg = { id: `u${Date.now()}`, from: 'user', text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setBusy(true);
    try {
      const apiMessages = history
        .filter((m) => m.text)
        .slice(-12)
        .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', text: m.text }));
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          screen: { id: pg || '', title: screenTitle || '' },
          openRecord: openRecord || null,
          screens: SCREENS,
          tours: TOURS.map((t) => ({ id: t.id, title: t.title, desc: t.desc })),
          targets: TARGETS,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.fallback || !json.ok || !String(json.text || '').trim()) {
        setMessages((prev) => [...prev, {
          id: `b${Date.now()}`, from: 'bot',
          text: "I can't reach the AI right now, but I can still show you around. Try “Take the portal tour,” or tell me which screen you're looking for and I'll point you to it.",
        }]);
      } else {
        setMessages((prev) => [...prev, { id: `b${Date.now()}`, from: 'bot', text: String(json.text) }]);
        runActions(json.actions);
      }
    } catch (e) {
      setMessages((prev) => [...prev, {
        id: `b${Date.now()}`, from: 'bot',
        text: "Something went wrong reaching me just now. You can still start the portal tour from the chip below, or try again.",
      }]);
    } finally {
      setBusy(false);
    }
  }, [busy, messages, pg, screenTitle, openRecord, runActions]);

  // Deterministic quick-actions (work even when the AI endpoint is down).
  const quickChips = [
    { label: 'What needs my attention', run: () => doBrief() },
    { label: 'How do I create an estimate?', run: () => send('walk me through creating an estimate') },
    { label: 'Total value of open orders', run: () => send('total value of my open orders') },
    { label: 'Take the portal tour', run: () => startTour('getting-started') },
  ];

  return (
    <>
      {open ? (
        <div className={`nsa-as-panel${mCls}${tour ? ' nsa-as-guiding' : ''}`} role="dialog" aria-label="Portal Assistant">
          <div className="nsa-as-head">
            <div className="nsa-as-avatar"><IconChat /></div>
            <div>
              <h3>Portal Assistant</h3>
              <p>Ask me anything about the portal</p>
            </div>
            <button className="nsa-as-x" onClick={() => { setMessages([greeting()]); setInput(''); }} aria-label="New conversation" title="New conversation">↺</button>
            <button className="nsa-as-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="nsa-as-body" ref={listRef}>
            {messages.map((m) => (
              m.kind === 'results'
                ? <ResultsCard key={m.id} results={m.results} onOpen={openResult} onReorder={onReorder} />
                : m.kind === 'brief'
                  ? <BriefCard key={m.id} items={m.brief} onPick={doSearch} title={m.briefTitle} showAll={m.briefAll} />
                  : m.kind === 'stock'
                    ? <StockCard key={m.id} stock={m.stock} />
                    : m.kind === 'report'
                      ? <ReportCard key={m.id} report={m.report} onPrint={onPrintReport} />
                    : m.kind === 'confirm'
                      ? <ConfirmCard key={m.id} draft={m.draft} onCommit={m.commit} />
                    : m.kind === 'step'
                      ? (
                        <div key={m.id} className="nsa-as-row bot">
                          <div className="nsa-as-step">
                            <div className="nsa-as-step-no">Step {m.stepNo} of {m.stepTotal}</div>
                            {m.title && <div className="nsa-as-step-title">{m.title}</div>}
                            <div className="nsa-as-step-body">{m.body}</div>
                          </div>
                        </div>
                      )
                      : (
                        <div key={m.id} className={`nsa-as-row ${m.from}`}>
                          <div className={`nsa-as-bubble ${m.from}`}>{m.text}</div>
                        </div>
                      )
            ))}
            {/* Quick chips shown until the user says something. */}
            {messages.length <= 1 && !busy && (
              <div className="nsa-as-chips">
                {quickChips.map((c) => (
                  <button key={c.label} className="nsa-as-chip" onClick={c.run}>{c.label}</button>
                ))}
              </div>
            )}
            {busy && (
              <div className="nsa-as-row bot">
                <div className="nsa-as-bubble bot nsa-as-dots"><span /><span /><span /></div>
              </div>
            )}
          </div>
          {tour && (() => {
            const cur = tour.steps[tour.index] || {};
            const last = tour.index + 1 >= tour.steps.length;
            const curHasSpec = !!(cur.target || cur.find);
            let status;
            if (targetPresent) status = 'Highlighted on screen — click it, or press Next.';
            else if (curHasSpec) status = "Do the step above to get there — I'll highlight it the moment it's on screen.";
            else status = last ? 'Do this, then press Finish.' : 'Do this on screen — it moves on by itself, or press Next.';
            return (
              <div className="nsa-as-guidebar">
                <div className="nsa-as-guidebar-row">
                  <span className="nsa-as-guidebar-step">Step {tour.index + 1} of {tour.steps.length}</span>
                  <button type="button" className="nsa-as-btn ghost" onClick={() => endGuide(false)}>End</button>
                  <button type="button" className="nsa-as-btn primary" onClick={goNext}>{last ? 'Finish' : 'Next ▸'}</button>
                </div>
                <div className={`nsa-as-guidebar-status${targetPresent ? ' on' : ''}`}><span className="nsa-as-guidebar-dot" />{status}</div>
              </div>
            );
          })()}
          <form className="nsa-as-composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              aria-label="Message"
            />
            <button className="nsa-as-send" type="submit" disabled={busy || !input.trim()} aria-label="Send"><IconSend /></button>
          </form>
        </div>
      ) : (
        <button className={`nsa-as-launcher${mCls}`} onClick={() => setOpen(true)} aria-label="Open Portal Assistant" title="Portal Assistant (⌘K)">
          <IconChat />
        </button>
      )}

      {tour && <GuideSpotlight step={tour.steps[tour.index]} />}
    </>
  );
}
