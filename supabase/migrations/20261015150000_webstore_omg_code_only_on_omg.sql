-- Only OMG stores (source = 'omg') may carry an OMG sale code.
--
-- The app treats any webstore with omg_sale_code set as an OMG mirror: the Club
-- Webstores list hides it, checkout skips team-store logo choices, and rep/CSR
-- lookups route through omg_stores. Two native club stores (CFVEW, NA3DS) were
-- inserted from outside the portal with a stray code and vanished from the list.
--
-- This guard strips the code from any non-OMG row on insert/update. It runs AFTER
-- trg_webstores_store_code (same-timing triggers fire in name order), so a store
-- created with a code still gets that code as its store number — it just isn't
-- flagged as OMG.

create or replace function public.webstores_strip_non_omg_sale_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.source, '') <> 'omg' then
    new.omg_sale_code := null;
  end if;
  return new;
end
$$;

drop trigger if exists trg_webstores_strip_omg_code on public.webstores;
create trigger trg_webstores_strip_omg_code
  before insert or update of omg_sale_code, source on public.webstores
  for each row execute function public.webstores_strip_non_omg_sale_code();

-- Clean any existing strays (fires the trigger above).
update public.webstores set omg_sale_code = null
where coalesce(source, '') <> 'omg' and omg_sale_code is not null;
