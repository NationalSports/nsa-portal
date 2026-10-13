-- Webstore settings use updated_at as an optimistic-concurrency revision.
-- Keep it current for every writer, including direct SQL and narrow art updates.
update public.webstores
set updated_at = now()
where updated_at is null;

alter table public.webstores
  alter column updated_at set default now(),
  alter column updated_at set not null;

drop trigger if exists trg_webstores_updated on public.webstores;
create trigger trg_webstores_updated
before update on public.webstores
for each row execute function public.set_updated_at();
