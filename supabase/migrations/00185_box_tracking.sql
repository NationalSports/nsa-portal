-- Migration 00185: box tracking v1 — global BX-#### license plates
-- (BOX_TRACKING_PLAN.md, "design approved"). A box is a physical container whose
-- contents change (combine, add, send to deco), so the id is an opaque plate;
-- the human context (team, IF#, SO#) lives on the printed label, not in the id.
--
-- Plates are minted through the existing next_counter() RPC (00181) with key
-- 'box_plate' → client renders BX-(2000+n), so two machines can never mint the
-- same plate. No seeding needed: first mint returns 1 → BX-2001.
--
-- The client degrades gracefully while this isn't applied (missing-table checks
-- around every read/write): pulls keep printing today's IF-coded labels and the
-- ephemeral ship-step boxes keep working.

create table if not exists public.boxes (
  id           text primary key,                      -- 'BX-2001'
  kind         text not null default 'fulfillment',   -- 'fulfillment' | 'receiving' | 'consolidation'
  contents     jsonb not null default '[]'::jsonb,    -- [ {sku,name,color,so_id,if_id,sizes:{S:3,M:2}} ] — authoritative SKUs×sizes physically in the box
  source_refs  jsonb not null default '[]'::jsonb,    -- [ {type:'IF',id:'IF-1071'}, {type:'PO',id:'NSA-4501'} ]
  so_id        text,                                  -- convenience refs (nullable)
  if_id        text,
  po_id        text,
  status       text not null default 'staged',        -- 'staged' | 'at_deco' | 'shipped' | 'combined'
  merged_into  text,                                  -- surviving plate when this box was absorbed
  bin          text,                                  -- bin/location (free text now, bin phase later)
  weight       numeric,
  dimensions   jsonb,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists boxes_so_id_idx on public.boxes(so_id);
create index if not exists boxes_if_id_idx on public.boxes(if_id);
create index if not exists boxes_status_idx on public.boxes(status);

-- Staff-only RLS (the 00173–00176/00179 pattern): only authenticated team
-- members read or write; anon gets nothing. Service role bypasses RLS as usual.
alter table public.boxes enable row level security;
drop policy if exists boxes_staff_all on public.boxes;
create policy boxes_staff_all on public.boxes
  for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
revoke select, insert, update, delete on public.boxes from anon;
