-- Stale-payload guard (2026-07-31, SO-1401): follow_up_auto / follow_up_count are
-- NOT NULL with defaults, but a default only applies when the column is OMITTED —
-- an explicit null (what an outbox payload captured before these fields hydrated
-- carries) hard-fails the whole save with a not-null violation. Every stale tab in
-- the fleet holds such payloads, so fix at the DB so their replays succeed without
-- waiting for a client deploy. Coalesce nulls to the column defaults BEFORE write;
-- the NOT NULL invariant in storage (and the sweep's count+1 arithmetic) is kept.
-- Client mirror: src/lib/dbEngine.js _fuDefaults — keep the two in sync.
create or replace function public.fn_coalesce_followup_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.follow_up_auto  := coalesce(new.follow_up_auto,  false);
  new.follow_up_count := coalesce(new.follow_up_count, 0);
  return new;
end;
$$;

drop trigger if exists trg_followup_defaults on public.so_jobs;
create trigger trg_followup_defaults
  before insert or update on public.so_jobs
  for each row execute function public.fn_coalesce_followup_defaults();

drop trigger if exists trg_followup_defaults on public.estimates;
create trigger trg_followup_defaults
  before insert or update on public.estimates
  for each row execute function public.fn_coalesce_followup_defaults();

drop trigger if exists trg_followup_defaults on public.invoices;
create trigger trg_followup_defaults
  before insert or update on public.invoices
  for each row execute function public.fn_coalesce_followup_defaults();

-- Assert the change took (FABLE_WORKING_PROCESS.md §5).
do $$
declare n int;
begin
  select count(*) into n from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where t.tgname = 'trg_followup_defaults'
    and c.relname in ('so_jobs','estimates','invoices') and not t.tgisinternal;
  if n <> 3 then
    raise exception 'expected 3 trg_followup_defaults triggers, found %', n;
  end if;
end $$;
