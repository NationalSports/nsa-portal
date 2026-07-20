-- bill_sku_aliases — learned vendor-number → portal-SKU mappings.
--
-- Vendors bill with their OWN catalog numbers (S&S "B199E2655", SanMar "2649531",
-- UA invoice numbers) that exist nowhere on our orders. Every PUSHED bill line whose
-- bill SKU differs from the portal SKU it paid for — and whose billed price agreed
-- with the order cost (±2¢, the learn gate) — becomes a durable alias here. The
-- resolver replays them at pull time as an exact-grade tie tier, so the same vendor
-- number matches instantly on every future bill.
--
-- Written fire-and-forget on push (a failed save never blocks money); read once per
-- session at bill pull. DDL-only, mirroring the netsuite_pos staff gate.

create table if not exists public.bill_sku_aliases (
  vendor     text not null,               -- lower(trim(bill.vendor || supplier))
  vendor_sku text not null,               -- the number the vendor bills with, as printed
  portal_sku text not null,               -- the SKU our order carries
  size       text not null default '',    -- observed on the learning bill (context, not key)
  color      text not null default '',
  created_at timestamptz not null default now(),
  primary key (vendor, vendor_sku, portal_sku)
);

alter table public.bill_sku_aliases enable row level security;

-- Same staff gate as si_documents / netsuite_pos: active team members read/write.
drop policy if exists bill_sku_aliases_staff_all on public.bill_sku_aliases;
create policy bill_sku_aliases_staff_all
  on public.bill_sku_aliases
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
