# Reporting Section — Design Handoff

**Prepared:** 2026-07-06
**Purpose:** A briefing doc for a designer (Claude design) to redesign / improve the NSA Portal **Reports** section.
**Audience:** Someone who has *not* seen the codebase. Everything you need to design against is here.

---

## 1. What this is

The NSA Portal is an internal operations app for a custom sportswear / team-apparel business (National Sports). It runs sales orders, estimates, art/production, warehouse, invoicing, and web stores. **Reports** is one page in the left-nav (URL: `?pg=reports`). It's the analytics hub — the place staff go to answer "how are we doing?" across sales, customers, production, and labor.

It is **not** a single dashboard. It's a tabbed workspace with **12 tabs**, each holding several collapsible report "widgets." Today there are ~30 distinct report widgets in total.

### Who uses it (and what they see)
Access is role-gated. Roles that can open Reports and roughly what they care about:

| Role | Primary interest |
|---|---|
| **Admin / Super Admin / GM** | Everything — full financial + ops picture. Only these roles see the **Warehouse** tab. |
| **Sales Rep** | Their own pipeline, customers, commissions, reorder timing. Defaults to *their own* numbers. |
| **Accounting** | Sales tax, AR aging, invoices. |
| **Production Manager / Assistant / Production** | Production throughput, decorator workload, time & labor. |

A **rep filter** (top-right dropdown: "All Reps" or a specific rep) scopes most financial widgets. Reps/admins default to seeing themselves; they can switch to "All Reps."

---

## 2. The core design problem (why we want help)

The Reports section **grew organically** — widgets were added one at a time as needs came up. The result works but has real design debt:

1. **Everything is styled inline, ad hoc.** There's no reporting design system. Colors, spacings, font sizes, table styles, and "chip/pill" badges are hand-written per widget. Two widgets showing the same kind of data often look slightly different.
2. **Very high data density with tiny type.** Table text is frequently 10–12px, some labels 8px. It's information-rich but visually punishing, especially on the tabs that are all tables.
3. **Inconsistent visualization vocabulary.** One widget (historical sales) is a real SVG bar chart with hover tooltips; everything else is either a plain HTML table or a hand-built CSS `<div>` progress bar. There's no charting library and no shared chart style.
4. **Weak information hierarchy.** Every tab is a vertical stack of same-looking white cards. Nothing signals "this is the headline number" vs. "this is supporting detail." The KPI tiles at the top are the only strong hierarchy and they're the same on every tab.
5. **Tab overload.** 12 tabs in one horizontal row of buttons, each an emoji + label. No grouping (sales vs. ops vs. finance), no overflow handling on narrow screens.
6. **Collapsible-widget pattern is under-designed.** Each card has a ▼/▶ toggle to collapse it ("Toggle widgets to customize your view"), but preferences aren't obviously persisted and the affordance is a tiny gray button in the corner.

**What we'd love from design:** a cohesive visual language for the whole section — type scale, card/section hierarchy, a consistent chart + table + KPI-tile system, better tab organization, and thoughtful empty/loading states — that we can then implement across all the widgets. Concrete redesigns of the 2–3 highest-traffic tabs (Overview, Customers, Pipeline) would be the most valuable starting point.

---

## 3. Current visual system (what exists today)

So the redesign stays implementable, here's the current CSS vocabulary (from `src/portal.css`). These are the shared building blocks; most report internals override them inline.

**Palette (as used today)**
- App background `#f1f5f9` (slate-100); cards white `#fff` with `1px` border `#e2e8f0` and `10px` radius.
- Text: primary `#0f172a` / `#334155`, muted `#64748b`, faint `#94a3b8`.
- Accent blue `#3b82f6` / `#1e40af`; sidebar navy `#0f172a`.
- Semantic status colors, used loosely and inconsistently:
  - green `#166534` / bg `#dcfce7` (good / active / paid),
  - amber `#d97706` / bg `#fef3c7` (warning / warm / open),
  - orange `#ea580c` / `#ffedd5` (cooling),
  - red `#dc2626` / bg `#fecaca` / `#fee2e2` (at-risk / overdue / low-margin).

**Type**
- System font stack (`-apple-system, Segoe UI, …`), base 13px, line-height 1.5.
- Card titles 14–15px/700. Table body 11–12px. Micro-labels 8–10px uppercase.

**Shared components**
- `.stats-row` → responsive grid of `.stat-card` KPI tiles (label 11px uppercase muted, value 24px/800). This is the strongest existing pattern.
- `.card` / `.card-header` / `.card-body` — the universal container.
- `.btn` (+ `.btn-sm`, `.btn-primary`, `.btn-secondary`) — tabs and controls are all buttons.
- Tables are raw `<table>` with inline styles per widget.
- **`Bar`** — an inline CSS progress-bar component (a `#e2e8f0` track with a colored fill and a tiny `$Xk` label). Used everywhere a "chart" is implied.
- **`WH`** — the collapsible widget header (icon + title + ▼/▶ collapse toggle).
- Status is shown as small rounded "pills" (`padding:1px 6px; border-radius:8px`) in semantic colors — reinvented inline each time.

**The one real chart:** the Overview "Sales Performance — This Year vs Last Year" widget is a custom **SVG grouped bar chart** (this-year vs last-year by month) with a hover tooltip, delta pills (▲/▼ +N%), and an optional team overlay when a single rep is selected. It's the visual high-water mark of the section and a good reference for where the rest could go.

**Implementation constraints for the designer to respect**
- React app, **inline styles** (no Tailwind, no CSS modules, no component library). Redesign should express as reusable inline-style patterns or additions to `portal.css`.
- **No charting library is installed.** Charts today are hand-rolled SVG or CSS bars. A proposal can assume we'd add a lightweight chart approach, but flag it — keeping it dependency-free (SVG) is preferred.
- Must stay **dense and scannable** — this is a power-user internal tool, not a marketing dashboard. Whitespace is welcome but staff review long tables daily; don't trade away scannability.
- Desktop-first (staff on laptops). A responsive breakpoint exists (`stats-row` collapses to 2-up, cards to tighter padding) but tables are not truly responsive today.

---

## 4. Full inventory of tabs & widgets

Every tab, every widget, with what it shows and how it's currently drawn. This is the redesign surface.

### Global controls (top of every tab)
- **Tab bar** — 12 buttons (emoji + label). Warehouse only for admin/GM.
- **Rep filter** — dropdown ("All Reps" / individual rep).
- **KPI tile row** — 4 tiles, same on all tabs: **Pipeline Revenue**, **Active SOs**, **Total Units**, **Avg Order**.
- Hint text: "Toggle widgets to customize your view."

---

### 📊 Overview
The default landing tab — a curated mix pulled from the other tabs. Widgets:
- **Sales Performance — This Year vs Last Year** — the SVG grouped bar chart (see above). YTD & MTD delta pills, team overlay for single-rep view.
- **Estimate → SO Conversion Funnel** — funnel: Draft → Sent → Approved → Converted counts.
- **Pipeline by Status** — SOs grouped by status with revenue bars.
- **Quote Win/Loss Analysis** — win rate, avg days-to-close, won revenue.
- **Booking Orders** — pre-season/booking POs.
- **Rep Leaderboard** — reps ranked by revenue (also on Reps tab).
- **Product Mix & Popularity** — top products by units/revenue.
- **Margin Analysis — Where to Improve** — margin by category with bars.
- **Low Margin Alert — Under 25%** — red-flag list of thin-margin orders.
- **OMG Team Stores** — team-store rollup.
- **Customer Health & Retention** — health-scored customer list (also on Customers).
- **At-Risk Customers — Retention Watch** — customers going cold.

### 💰 Pipeline
- **Estimate → SO Conversion Funnel**, **Pipeline by Status**, **Quote Win/Loss**, **Booking Orders**, **Margin Analysis**, **Low Margin Alert** — the sales-pipeline deep dive (several shared with Overview).

### 👥 Customers
- **New vs Returning Customers** — split by period (YTD default), with a period selector.
- **Same-Season Customers — Retention Tracker** — did last-year's same-season buyers reorder? Sortable/searchable/filterable (reordered / pending).
- **Customer Health & Retention** — health tiers: Active / Warm / Cooling / At-Risk by days-since-last-order.
- **Avg Days to Pay Invoices** — per-customer payment speed vs. their terms; overdue flag. Sortable/searchable.
- **Customer Reorder Forecast** — predicts next order date from historical order cadence; status: on-track / upcoming / due / overdue. Sortable/searchable/filterable.
- **Open AR Aging by Customer** — outstanding balances by customer. Sortable/searchable.

### 📦 Products
- **Product Mix & Popularity** — top styles by units & revenue.

### 🗃️ Inventory
- **Inventory by Category**, **Inventory by Vendor** (both drill-down), **Top 20 SKUs by Inventory Value**, **Low Stock (≤10 units)**, **Out of Stock**, **Recent Inventory Adjustments**.

### 🏆 Reps
- **Rep Leaderboard** — full ranking: revenue, margin, SO count, estimates, collected, open AR, unique customers, conversion rate, MTD-vs-last-year.

### 🏭 Production
- **Production Throughput** — jobs by status (Hold / Staging / In-Process / Completed / Shipped) as KPI tiles, plus breakdowns **by decoration type** and **by machine**, and an overall fulfillment-rate summary.
- **Decorator Workload** — per-decorator open jobs / units / ready / in-process, plus an "Unassigned" row flagged red.

### 👤 Decorator
- A focused decorator view (completed jobs, filterable by time window: today / yesterday / week / month / this-month / last-month / YTD / all, and by person). Decorators see only themselves; managers see everyone.

### ⏱️ Time & Labor
- **Labor Rates Key** — hourly rate chips per person (set in Settings).
- **Art Department Time** — minutes/idle/jobs per artist and per job, costed at labor rates.
- **Production/Decoration Time** — same for the print/deco floor.
- **Combined Labor Summary** — total labor cost rollup.

### 🧾 Sales Tax
- Tax **collected** (from invoices) for current month / quarter / year, plus **expected** tax from open SOs.
- **Quarterly breakdown by state + city jurisdiction** for filing (current + prior year, most-recent-first).
- **Tax-exempt customers** list.
- A **TaxCloud reconciliation** strip: how many invoices reported vs. paid-but-unreported (with uncaptured tax $).

### 📌 CSR Tasks
- KPI tiles: Total Tasks / Open / Completed / Active CSRs.
- **CSR Task Summary** — per-CSR: who they're primary/secondary for, open, high-priority, completed, total, created, avg completion hours.
- **All Open Tasks** — sortable task table (click opens the task).
- **Recently Completed** — last 25.

### 📦 Warehouse *(admin/GM only)*
- Warehouse-staff productivity over a time window (30d default, selectable): actions/quantities by person, completed tasks, task turnaround time, and current open tasks.

---

## 5. Interaction patterns in play
- **Collapsible widgets** — every widget can be collapsed via its ▼/▶ header toggle (state in `rptWidgets`).
- **Rep scoping** — global dropdown re-filters financial widgets.
- **Per-widget sort / search / filter** — the Customers tab widgets (pay-days, reorder, AR aging, same-season) each have their own sort direction, search box, and status filter.
- **Time-window filters** — Decorator tab (8 presets) and Warehouse tab (day-count) have their own range pickers.
- **Drill-down** — Inventory by-vendor/by-category rows open a detail view; CSR/task rows open the task.
- **Print/export** — commissions has a printable monthly statement flow, but the Reports widgets themselves have **no CSV/PDF export today** (a likely design opportunity).

---

## 6. Suggested focus for the designer (open questions)

Ranked by expected impact:

1. **A unified reporting design system** — type scale (fix the 8–12px sprawl), a card/section hierarchy that distinguishes headline metrics from detail, one badge/pill spec, one table spec, one KPI-tile spec. This is the foundation everything else builds on.
2. **A consistent chart language** — decide the handful of chart types we actually need (bar, grouped bar, trend line, funnel, distribution) and give each a single visual spec, dependency-free (SVG) if possible. Retire the ad-hoc CSS `Bar` where a real chart reads better.
3. **Tab organization** — group 12 tabs into a sensible IA (e.g., *Sales · Customers · Production · Finance*), handle overflow, and make the current tab obvious.
4. **Redesign the top 3 tabs end-to-end** — Overview, Customers, Pipeline — as worked examples of the system.
5. **States** — empty ("no data yet"), loading, and role-gated views deserve real treatment; today they're bare text.
6. **Export & print** — a consistent "export this report" affordance.

**Constraints to honor:** internal power-user tool → keep it dense and fast to scan; React + inline styles / `portal.css` → no new heavy dependencies; desktop-first but don't break the existing responsive collapse.

---

*Source of truth for everything above: `src/App.js` — the reporting section is the `rReports()` render function (~line 13260 onward); shared styles are in `src/portal.css`.*
