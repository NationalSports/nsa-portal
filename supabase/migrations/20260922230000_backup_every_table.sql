-- Server backups that cover EVERY public table and survive database growth.
--
-- Why: the old daily-backup edge function loaded 50 hard-coded tables into one
-- in-memory JSON blob. Once the data outgrew the edge worker's memory it died
-- with WORKER_RESOURCE_LIMIT on every run (last good file: 2026-06-19), and the
-- cron still logged "succeeded" because it only records that the HTTP call was
-- sent. It also never covered ~180 of the 233 tables.
--
-- New design:
--   * backup_start(kind) (pg_cron) snapshots the live table list from the catalog
--     into a backup_runs row — new tables are included automatically.
--   * The daily-backup edge function is now a worker. pg_cron pokes it every
--     minute while a run is in progress; each poke claims a lease, reads pages
--     via backup_read_page (keyset, ~4 MB each), gzips each page to its own file
--     (backups/<kind>/<stamp>/<table>/part-00001.json.gz) and records progress,
--     so memory stays flat and a crash resumes where it left off.
--   * audit_log (3.6 GB, ~80 MB/day) is incremental: each daily run stores the
--     rows added since the previous successful daily run. Intraday runs skip it
--     and the static *_bak_* / *_backup_* tables.
--   * backup_runs is readable by signed-in users so the Backup page can show
--     when the last good backup finished.

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily','intraday')),
  status text not null default 'running' check (status in ('running','ok','failed')),
  prefix text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_until timestamptz,
  tables jsonb not null,                       -- [{name, limit}]
  cursor jsonb not null default '{"ti":0,"after":null,"part":0}'::jsonb,
  table_stats jsonb not null default '{}'::jsonb, -- {table: {rows, parts}}
  files jsonb not null default '[]'::jsonb,
  total_rows bigint not null default 0,
  total_bytes bigint not null default 0,        -- compressed bytes written
  audit_from_id bigint,                         -- audit_log rows with id > from and <= to
  audit_to_id bigint,
  errors int not null default 0,                -- consecutive failed worker attempts
  last_error text,
  pruned_at timestamptz
);
create index if not exists backup_runs_status_created on public.backup_runs (status, created_at);

alter table public.backup_runs enable row level security;
drop policy if exists backup_runs_read on public.backup_runs;
create policy backup_runs_read on public.backup_runs for select to authenticated using (true);
revoke all on public.backup_runs from anon, authenticated;
grant select on public.backup_runs to authenticated;

-- ─── Start a run ──────────────────────────────────────────────────────────
create or replace function public.backup_start(p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tables jsonb;
  v_from bigint;
  v_to bigint;
begin
  if p_kind not in ('daily','intraday') then
    raise exception 'backup_start: unknown kind %', p_kind;
  end if;

  -- A run that is still going after 6 hours is stuck; close it out so it shows as failed.
  update public.backup_runs
     set status = 'failed', finished_at = now(), lease_until = null,
         last_error = concat_ws(' | ', last_error, 'abandoned after 6 hours')
   where status = 'running' and created_at < now() - interval '6 hours';

  -- Intraday runs are best-effort: don't queue one behind an unfinished run.
  if p_kind = 'intraday' and exists (select 1 from public.backup_runs where status = 'running') then
    return null;
  end if;

  select jsonb_agg(jsonb_build_object(
           'name', c.relname,
           -- rows per page, aiming at ~4 MB of on-disk data per page
           'limit', greatest(50, least(20000,
                      (4194304 / greatest(1, pg_table_size(c.oid) / greatest(c.reltuples, 1)))::bigint))::int
         ) order by c.relname)
    into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r','p')
     and not c.relispartition
     and (p_kind = 'daily'
          or (c.relname <> 'audit_log' and c.relname !~ '(_bak_|_backup_)'));

  if p_kind = 'daily' then
    select max(id) into v_to from public.audit_log;
    select audit_to_id into v_from
      from public.backup_runs
     where kind = 'daily' and status = 'ok' and audit_to_id is not null
     order by created_at desc limit 1;
    -- First run: start with roughly the last day of changes (~70k rows).
    if v_from is null then
      select id into v_from from public.audit_log order by id desc offset 70000 limit 1;
      v_from := coalesce(v_from, 0);
    end if;
  end if;

  insert into public.backup_runs (kind, prefix, tables, audit_from_id, audit_to_id)
  values (p_kind,
          p_kind || '/' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24MI') || '/',
          coalesce(v_tables, '[]'::jsonb), v_from, v_to)
  returning id into v_id;
  return v_id;
end;
$$;

-- ─── Read one page of any public table (keyset on the primary key) ───────
-- Returns {"n": <rows>, "last": <cursor for next call>, "rows": [...]}.
-- Tables without a primary key page by ctid (only the static *_bak_* copies).
create or replace function public.backup_read_page(
  p_table text, p_after jsonb, p_limit int, p_min_id bigint default null, p_max_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_oid oid;
  v_pk text[];
  v_types text[];
  v_order text;
  v_key text;
  v_where text := 'true';
  v_res jsonb;
begin
  select c.oid into v_oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = p_table and c.relkind in ('r','p');
  if v_oid is null then
    raise exception 'backup_read_page: unknown table %', p_table;
  end if;

  select array_agg(a.attname::text order by k.ord),
         array_agg(format_type(a.atttypid, a.atttypmod) order by k.ord)
    into v_pk, v_types
    from pg_index x
    cross join lateral unnest(x.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
   where x.indrelid = v_oid and x.indisprimary;

  if v_pk is null then
    v_order := 't.ctid';
    v_key := 'jsonb_build_array(t.ctid::text)';
    if p_after is not null then
      v_where := format('t.ctid > %L::tid', p_after->>0);
    end if;
  else
    select string_agg(format('t.%I', col), ', ' order by i),
           'jsonb_build_array(' || string_agg(format('t.%I::text', col), ', ' order by i) || ')'
      into v_order, v_key
      from unnest(v_pk) with ordinality as u(col, i);
    if p_after is not null then
      v_where := format('(%s) > (%s)', v_order,
        (select string_agg(format('%L::%s', p_after->>(i::int - 1), v_types[i]), ', ' order by i)
           from generate_subscripts(v_pk, 1) as i));
    end if;
  end if;

  if p_min_id is not null or p_max_id is not null then
    if v_pk is distinct from array['id'] then
      raise exception 'backup_read_page: id bounds need a single "id" primary key (%)', p_table;
    end if;
    if p_min_id is not null then v_where := v_where || format(' and t.id > %s', p_min_id); end if;
    if p_max_id is not null then v_where := v_where || format(' and t.id <= %s', p_max_id); end if;
  end if;

  execute format(
    'select jsonb_build_object(''n'', count(*), ''last'', (array_agg(s.k order by s.rn desc))[1],
            ''rows'', coalesce(jsonb_agg(s.j order by s.rn), ''[]''::jsonb))
       from (select to_jsonb(p) - ''__backup_key'' as j, p.__backup_key as k, row_number() over () as rn
               from (select t.*, %s as __backup_key from public.%I t where %s order by %s limit %s) p) s',
    v_key, p_table, v_where, v_order, greatest(1, least(p_limit, 20000)))
  into v_res;
  return v_res;
end;
$$;

-- ─── Worker bookkeeping ───────────────────────────────────────────────────
create or replace function public.backup_claim()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update public.backup_runs r
     set lease_until = now() + interval '2 minutes'
   where r.id = (select id from public.backup_runs
                  where status = 'running' and (lease_until is null or lease_until < now())
                  order by created_at limit 1
                  for update skip locked)
  returning to_jsonb(r.*);
$$;

create or replace function public.backup_advance(
  p_run uuid, p_cursor jsonb, p_table text, p_rows int, p_bytes bigint, p_file text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.backup_runs
     set cursor = p_cursor,
         lease_until = now() + interval '2 minutes',
         errors = 0,
         total_rows = total_rows + p_rows,
         total_bytes = total_bytes + p_bytes,
         files = files || jsonb_build_array(p_file),
         table_stats = jsonb_set(table_stats, array[p_table], jsonb_build_object(
           'rows', coalesce((table_stats->p_table->>'rows')::bigint, 0) + p_rows,
           'parts', coalesce((table_stats->p_table->>'parts')::int, 0) + 1))
   where id = p_run and status = 'running'
     and p_file is not null
     -- a page re-uploaded after a crash must not be counted twice
     and not files @> jsonb_build_array(p_file);
  -- Always move the cursor (covers the re-upload case above and empty-table skips).
  update public.backup_runs
     set cursor = p_cursor, lease_until = now() + interval '2 minutes'
   where id = p_run and status = 'running';
end;
$$;

-- Hand the run back so the next poke can continue right away.
create or replace function public.backup_release(p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.backup_runs set lease_until = null where id = p_run and status = 'running';
$$;

create or replace function public.backup_finish(p_run uuid, p_manifest text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.backup_runs
     set status = 'ok', finished_at = now(), lease_until = null,
         files = case when files @> jsonb_build_array(p_manifest) then files else files || jsonb_build_array(p_manifest) end
   where id = p_run and status = 'running';
$$;

create or replace function public.backup_fail_attempt(p_run uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- Five failures in a row without progress ends the run; otherwise the next poke retries.
  update public.backup_runs
     set errors = errors + 1,
         last_error = left(p_error, 2000),
         lease_until = null,
         status = case when errors + 1 >= 5 then 'failed' else status end,
         finished_at = case when errors + 1 >= 5 then now() else finished_at end
   where id = p_run and status = 'running';
$$;

-- Runs whose files should be deleted: daily after 30 days, intraday after 4,
-- failed (partial) runs after 4.
create or replace function public.backup_prunable()
returns table (id uuid, files jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.files from public.backup_runs r
   where r.pruned_at is null and r.status in ('ok','failed')
     and r.created_at < now() - case when r.kind = 'daily' and r.status = 'ok'
                                     then interval '30 days' else interval '4 days' end
   order by r.created_at
   limit 20;
$$;

create or replace function public.backup_mark_pruned(p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.backup_runs set pruned_at = now() where id = p_run;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'backup_start(text)',
    'backup_read_page(text,jsonb,integer,bigint,bigint)',
    'backup_claim()',
    'backup_advance(uuid,jsonb,text,integer,bigint,text)',
    'backup_release(uuid)',
    'backup_finish(uuid,text)',
    'backup_fail_attempt(uuid,text)',
    'backup_prunable()',
    'backup_mark_pruned(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ─── Schedules ────────────────────────────────────────────────────────────
do $$ begin perform cron.unschedule('daily-backup'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('intraday-backup'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('backup-start-daily'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('backup-start-intraday'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('backup-worker'); exception when others then null; end $$;

-- 07:00 UTC ≈ 2-3am US Eastern, same slot as before.
select cron.schedule('backup-start-daily', '0 7 * * *', $cron$ select public.backup_start('daily'); $cron$);
select cron.schedule('backup-start-intraday', '0 2,5,8,11,14,17,20,23 * * *', $cron$ select public.backup_start('intraday'); $cron$);

-- Poke the worker every minute, but only while a run is in progress.
select cron.schedule('backup-worker', '* * * * *', $cron$
  select net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/daily-backup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  where exists (select 1 from public.backup_runs where status = 'running');
$cron$);
