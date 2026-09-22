-- Move SO/estimate recovery history out of the two ever-growing app_state
-- blobs.  The blobs stay in place during the compatibility window: old portal
-- builds still read and overwrite them, and the trigger below copies every new
-- entry into this append-only table before that overwrite commits.

set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.document_history_snapshots (
  seq bigint generated always as identity primary key,
  kind text not null,
  document_id text not null,
  entry jsonb not null,
  captured_at timestamptz not null default statement_timestamp(),
  constraint document_history_snapshots_kind_check
    check (kind in ('so_history', 'est_history')),
  constraint document_history_snapshots_document_id_check
    check (length(btrim(document_id)) > 0),
  constraint document_history_snapshots_entry_check
    check (
      jsonb_typeof(entry) is not distinct from 'object'
      and jsonb_typeof(entry->'snapshot') is not distinct from 'object'
      and entry #>> '{snapshot,id}' is not distinct from document_id
    )
);

-- jsonb::text is canonical for object key order, so old and new clients that
-- serialize the same entry differently still deduplicate.  seq remains an
-- identity because received order, rather than the locale-formatted entry.ts,
-- is the only dependable ordering signal.
create unique index document_history_snapshots_entry_uidx
  on public.document_history_snapshots
  (kind, document_id, (md5(entry::text)));

create index document_history_snapshots_document_captured_idx
  on public.document_history_snapshots (kind, document_id, captured_at desc, seq desc);

create index document_history_snapshots_kind_seq_idx
  on public.document_history_snapshots (kind, seq desc);

alter table public.document_history_snapshots enable row level security;

create policy document_history_snapshots_staff_select
  on public.document_history_snapshots
  for select to authenticated
  using ((select public.is_team_member()));

create policy document_history_snapshots_staff_insert
  on public.document_history_snapshots
  for insert to authenticated
  with check ((select public.is_team_member()));

revoke all on table public.document_history_snapshots from public, anon, authenticated;
grant select, insert on table public.document_history_snapshots to authenticated;
grant select, insert on table public.document_history_snapshots to service_role;
revoke all on sequence public.document_history_snapshots_seq_seq from public, anon, authenticated;
grant usage, select on sequence public.document_history_snapshots_seq_seq to authenticated;
grant usage, select on sequence public.document_history_snapshots_seq_seq to service_role;

create or replace function public.append_document_history(
  p_kind text,
  p_document_id text,
  p_entry jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if p_kind is null or p_kind not in ('so_history', 'est_history') then
    raise exception 'append_document_history: invalid kind %', p_kind
      using errcode = '22023';
  end if;
  if p_document_id is null or length(btrim(p_document_id)) = 0 then
    raise exception 'append_document_history: document id is required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_entry) is distinct from 'object'
     or jsonb_typeof(p_entry->'snapshot') is distinct from 'object'
     or p_entry #>> '{snapshot,id}' is distinct from p_document_id then
    raise exception 'append_document_history: entry snapshot id must match document id'
      using errcode = '22023';
  end if;

  insert into public.document_history_snapshots (kind, document_id, entry, captured_at)
  values (
    p_kind,
    p_document_id,
    p_entry,
    coalesce(nullif(p_entry->>'captured_at', '')::timestamptz, statement_timestamp())
  )
  on conflict (kind, document_id, (md5(entry::text))) do nothing;
end;
$$;

revoke all on function public.append_document_history(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_document_history(text, text, jsonb) to authenticated;
grant execute on function public.append_document_history(text, text, jsonb) to service_role;

-- Compact boot-scan input.  The live document supplies the current item count;
-- this returns the newest retained snapshot that still had at least one item.
create or replace function public.document_history_summary()
returns table (
  kind text,
  document_id text,
  snapshot_count bigint,
  last_good_count integer,
  last_good_ts text
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select grouped.kind,
         grouped.document_id,
         grouped.snapshot_count,
         latest_good.item_count,
         latest_good.snapshot_ts
    from (
      select dhs.kind, dhs.document_id, count(*) as snapshot_count
        from public.document_history_snapshots dhs
       group by dhs.kind, dhs.document_id
    ) grouped
    left join lateral (
      select jsonb_array_length(
               case
                 when jsonb_typeof(dhs.entry #> '{snapshot,items}') = 'array'
                   then dhs.entry #> '{snapshot,items}'
                 else '[]'::jsonb
               end
             ) as item_count,
             dhs.entry->>'ts' as snapshot_ts
        from public.document_history_snapshots dhs
       where dhs.kind = grouped.kind
         and dhs.document_id = grouped.document_id
         and jsonb_array_length(
               case
                 when jsonb_typeof(dhs.entry #> '{snapshot,items}') = 'array'
                   then dhs.entry #> '{snapshot,items}'
                 else '[]'::jsonb
               end
             ) > 0
       order by dhs.captured_at desc, dhs.seq desc
       limit 1
    ) latest_good on true;
$$;

revoke all on function public.document_history_summary() from public, anon, authenticated;
grant execute on function public.document_history_summary() to authenticated;
grant execute on function public.document_history_summary() to service_role;

-- Copy the legacy arrays oldest-first.  App.js stores newest first, so reverse
-- ordinality makes the newest legacy entry receive the greatest seq.
-- SHARE ROW EXCLUSIVE conflicts with app_state INSERT/UPDATE/DELETE.  Supabase
-- runs a migration in one transaction, so this closes the only rollout gap:
-- no old client can commit between this backfill and trigger creation.
lock table public.app_state in share row exclusive mode;

do $$
declare
  source record;
  document record;
  history_entry record;
  history jsonb;
begin
  for source in
    select state.id, state.value
      from public.app_state state
     where state.id in ('so_history', 'est_history')
  loop
    begin
      history := source.value::jsonb;
    exception when invalid_text_representation then
      raise warning 'document history backfill skipped invalid JSON for %', source.id;
      continue;
    end;
    if jsonb_typeof(history) <> 'object' then
      raise warning 'document history backfill skipped non-object value for %', source.id;
      continue;
    end if;

    for document in select key, value from jsonb_each(history) order by key
    loop
      if jsonb_typeof(document.value) <> 'array' then
        raise warning 'document history backfill skipped non-array %.%', source.id, document.key;
        continue;
      end if;
      for history_entry in
        select value, ordinal
          from jsonb_array_elements(document.value) with ordinality entries(value, ordinal)
         order by ordinal desc
      loop
        if jsonb_typeof(history_entry.value) <> 'object'
           or jsonb_typeof(history_entry.value->'snapshot') <> 'object'
           or history_entry.value #>> '{snapshot,id}' is distinct from document.key then
          raise warning 'document history backfill skipped malformed entry %.% at legacy ordinal %',
            source.id, document.key, history_entry.ordinal;
          continue;
        end if;
        insert into public.document_history_snapshots (kind, document_id, entry)
        values (source.id, document.key, history_entry.value)
        on conflict (kind, document_id, (md5(entry::text))) do nothing;
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function public.ingest_legacy_document_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  new_history jsonb;
  old_history jsonb := '{}'::jsonb;
  document record;
  history_entry record;
begin
  if new.id not in ('so_history', 'est_history')
     or (tg_op = 'UPDATE' and new.value is not distinct from old.value) then
    return new;
  end if;

  -- A malformed legacy value must not break an otherwise valid app_state
  -- write.  It contains no usable snapshot arrays, so there is nothing to copy.
  begin
    new_history := new.value::jsonb;
  exception when invalid_text_representation then
    raise warning 'document history compatibility ingest skipped invalid JSON for %', new.id;
    return new;
  end;
  if jsonb_typeof(new_history) <> 'object' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    begin
      old_history := old.value::jsonb;
      if jsonb_typeof(old_history) <> 'object' then
        old_history := '{}'::jsonb;
      end if;
    exception when invalid_text_representation then
      old_history := '{}'::jsonb;
    end;
  end if;

  for document in
    select key, value
      from jsonb_each(new_history)
     where value is distinct from old_history->key
     order by key
  loop
    if jsonb_typeof(document.value) <> 'array' then
      raise warning 'document history compatibility ingest skipped non-array %.%', new.id, document.key;
      continue;
    end if;
    for history_entry in
      select value, ordinal
        from jsonb_array_elements(document.value) with ordinality entries(value, ordinal)
       order by ordinal desc
    loop
      if jsonb_typeof(history_entry.value) <> 'object'
         or jsonb_typeof(history_entry.value->'snapshot') <> 'object'
         or history_entry.value #>> '{snapshot,id}' is distinct from document.key then
        raise warning 'document history compatibility ingest skipped malformed entry %.% at legacy ordinal %',
          new.id, document.key, history_entry.ordinal;
        continue;
      end if;
      insert into public.document_history_snapshots (kind, document_id, entry)
      values (new.id, document.key, history_entry.value)
      on conflict (kind, document_id, (md5(entry::text))) do nothing;
    end loop;
  end loop;

  return new;
end;
$$;

revoke all on function public.ingest_legacy_document_history() from public, anon, authenticated;
grant execute on function public.ingest_legacy_document_history() to service_role;

drop trigger if exists ingest_legacy_document_history on public.app_state;
create trigger ingest_legacy_document_history
after insert or update of value on public.app_state
for each row
when (new.id in ('so_history', 'est_history'))
execute function public.ingest_legacy_document_history();

comment on table public.document_history_snapshots is
  'Append-only SO and estimate recovery snapshots; app_state history blobs remain as a temporary old-client compatibility source.';
