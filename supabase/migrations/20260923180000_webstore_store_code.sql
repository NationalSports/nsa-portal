-- Store reference code on every webstore.
--
-- OMG stores already carry OMG's 5-character sale code (e.g. VR2G8) and the team
-- quotes it to find a store. Club webstores and the Team Shop had nothing short
-- to reference. store_code gives EVERY store one, in the same format: OMG stores
-- keep their OMG code; everything else gets a random 5-character code from an
-- alphabet without look-alikes (no 0/O, 1/I/L).
--
-- The database owns the code, not the client: it is assigned on insert and never
-- changes afterwards. A caller-supplied value is ignored, so copying a store (or a
-- template) can never carry another store's code across.

alter table public.webstores add column if not exists store_code text;

create or replace function public.webstore_gen_store_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..5 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.webstores w
      where w.store_code = code or upper(w.omg_sale_code) = code
    );
  end loop;
  return code;
end
$$;

create or replace function public.webstores_assign_store_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Permanent once set.
  if tg_op = 'UPDATE' and old.store_code is not null then
    new.store_code := old.store_code;
    return new;
  end if;
  if new.omg_sale_code is not null and not exists (
    select 1 from public.webstores w
    where w.store_code = upper(new.omg_sale_code) and w.id is distinct from new.id
  ) then
    new.store_code := upper(new.omg_sale_code);
  else
    new.store_code := public.webstore_gen_store_code();
  end if;
  return new;
end
$$;

drop trigger if exists trg_webstores_store_code on public.webstores;
create trigger trg_webstores_store_code
  before insert or update on public.webstores
  for each row execute function public.webstores_assign_store_code();

-- Backfill existing stores (fires the trigger; touches no other column).
update public.webstores set store_code = null where store_code is null;

create unique index if not exists webstores_store_code_key on public.webstores (store_code);
alter table public.webstores alter column store_code set not null;

comment on column public.webstores.store_code is
  'Short reference code for the store (e.g. VR2G8). OMG stores use their OMG sale code; others get a random 5-char code. Assigned by trigger, never changes.';
