-- Team Shop — per-customer School PO checkout eligibility.
--
-- Owner-approved: some Team Shop programs are allowed to check out with a
-- School PO instead of a card; that eligibility is rep-gated, not
-- self-service. This adds the flag the staff Settings page (Team Shop
-- Settings, src/teamshopqueue/TeamShopQueue.js) toggles per customer.
--
-- Additive only, default false (no behavior change for any existing
-- customer or checkout path until something actually reads this column —
-- reading/enforcing it in teamshop-checkout.js is a separate follow-up).
--
-- RLS: no policy change needed here. 00174 (RLS lockdown step 2) already
-- granted staff a blanket write policy on public.customers —
--   create policy customers_staff_write on public.customers
--     for all to authenticated using (public.is_team_member())
--     with check (public.is_team_member());
-- — which covers UPDATE on this new column the same as any other customers
-- column; adding a column never widens or narrows an existing row policy.
-- Reads stay as today via customers_read (anon + authenticated, true).

alter table public.customers
  add column if not exists teamshop_po_allowed boolean not null default false;

comment on column public.customers.teamshop_po_allowed is
  'Rep-gated School-PO checkout eligibility for Team Shop (staff-toggled in the Team Shop Settings page). Default false — a program must be explicitly allowed.';

-- ── Rollback ─────────────────────────────────────────────────────────
-- alter table public.customers drop column if exists teamshop_po_allowed;
