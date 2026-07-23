-- PO number claims (owner report 2026-07-22): the Create-PO form displays a concrete
-- number the moment it opens (atomically block-reserved), and reps quote that number
-- to vendors BEFORE clicking Create. Abandon the form and the number is orphaned —
-- the vendor bills against a PO the portal never owned (audit: bill "PO 8050 FPUS" =
-- an unclaimed block start; "PO 3520 CMSF" = shown-but-never-created, a $6k miss).
-- Every displayed number is recorded here, so bill import can route an unmatched PO
-- back to the order that issued it. Claims are breadcrumbs, not POs — nothing reads
-- them for money; the human still creates/matches through the normal flow.
create table if not exists po_number_claims (
  n integer not null,
  alpha_tag text not null default '',
  so_id text,
  customer text,
  claimed_by text,
  claimed_at timestamptz not null default now(),
  primary key (n, alpha_tag)
);
alter table po_number_claims enable row level security;
do $$ begin
  create policy po_claims_select on po_number_claims for select to authenticated using (true);
  create policy po_claims_insert on po_number_claims for insert to authenticated with check (true);
  create policy po_claims_update on po_number_claims for update to authenticated using (true);
exception when duplicate_object then null; end $$;
