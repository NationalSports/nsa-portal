-- Personal/team notes and dated reminders for the portal dashboard.
-- This intentionally lives outside assigned_todos: that legacy table retains an
-- anonymous read policy, while workspace notes can contain customer context.

create table if not exists public.workspace_items (
  id text primary key default gen_random_uuid()::text,
  item_kind text not null
    constraint workspace_items_kind_check check (item_kind in ('note', 'reminder')),
  title text not null
    constraint workspace_items_title_check check (
      char_length(btrim(title)) between 1 and 180
    ),
  body text
    constraint workspace_items_body_check check (
      body is null or char_length(body) <= 5000
    ),
  label text not null
    constraint workspace_items_label_check check (
      char_length(btrim(label)) between 1 and 40
    ),
  created_by text not null references public.team_members(id) on delete cascade,
  visibility text not null default 'personal'
    constraint workspace_items_visibility_check check (visibility in ('personal', 'team')),
  customer_id text references public.customers(id) on delete set null,
  so_id text references public.sales_orders(id) on delete set null,
  -- Portal POs are assembled from inventory, batch, and SO sources, so this
  -- remains a stable external identifier instead of pointing at one PO table.
  po_id text,
  remind_on date,
  is_pinned boolean not null default false,
  status text not null default 'open'
    constraint workspace_items_status_check check (status in ('open', 'completed', 'archived')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_items_reminder_date_check check (
    item_kind <> 'reminder' or remind_on is not null
  ),
  constraint workspace_items_single_link_check check (
    num_nonnulls(customer_id, so_id, po_id) <= 1
  )
);

create index if not exists workspace_items_owner_open_idx
  on public.workspace_items (created_by, status, remind_on)
  where status = 'open';

create index if not exists workspace_items_open_reminders_idx
  on public.workspace_items (remind_on, created_by)
  where item_kind = 'reminder' and status = 'open';

create index if not exists workspace_items_customer_idx
  on public.workspace_items (customer_id)
  where customer_id is not null;

create index if not exists workspace_items_so_idx
  on public.workspace_items (so_id)
  where so_id is not null;

create index if not exists workspace_items_po_idx
  on public.workspace_items (po_id)
  where po_id is not null;

alter table public.workspace_items enable row level security;

revoke all on table public.workspace_items from anon;
grant select, insert, update, delete on table public.workspace_items to authenticated;

drop policy if exists "workspace_items_staff_read" on public.workspace_items;
create policy "workspace_items_staff_read"
  on public.workspace_items
  for select
  to authenticated
  using (
    public.is_team_member()
    and (
      visibility = 'team'
      or created_by = (
        select tm.id
        from public.team_members tm
        where tm.auth_id = (select auth.uid())
          and tm.is_active is not false
        limit 1
      )
    )
  );

drop policy if exists "workspace_items_staff_create" on public.workspace_items;
create policy "workspace_items_staff_create"
  on public.workspace_items
  for insert
  to authenticated
  with check (
    public.is_team_member()
    and created_by = (
      select tm.id
      from public.team_members tm
      where tm.auth_id = (select auth.uid())
        and tm.is_active is not false
      limit 1
    )
  );

drop policy if exists "workspace_items_creator_update" on public.workspace_items;
create policy "workspace_items_creator_update"
  on public.workspace_items
  for update
  to authenticated
  using (
    public.is_team_member()
    and created_by = (
      select tm.id
      from public.team_members tm
      where tm.auth_id = (select auth.uid())
        and tm.is_active is not false
      limit 1
    )
  )
  with check (
    public.is_team_member()
    and created_by = (
      select tm.id
      from public.team_members tm
      where tm.auth_id = (select auth.uid())
        and tm.is_active is not false
      limit 1
    )
  );

drop policy if exists "workspace_items_creator_delete" on public.workspace_items;
create policy "workspace_items_creator_delete"
  on public.workspace_items
  for delete
  to authenticated
  using (
    public.is_team_member()
    and created_by = (
      select tm.id
      from public.team_members tm
      where tm.auth_id = (select auth.uid())
        and tm.is_active is not false
      limit 1
    )
  );

-- Keep dashboard clients in sync when a teammate shares or changes an item.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_items'
  ) then
    alter publication supabase_realtime add table public.workspace_items;
  end if;
end
$$;
