begin;

-- Compatibility guard for browser tabs running bundles from before/around the
-- invoice_line_keys rollout. PostgREST bulk inserts use the union of object keys;
-- when one existing line has this field and a new line omits it, that omitted value
-- arrives as explicit NULL. A column DEFAULT does not apply to explicit NULL, so the
-- NOT NULL constraint rejected the entire SO item batch and autosave retried forever.
create or replace function public.fn_coalesce_so_item_invoice_line_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.invoice_line_keys := coalesce(new.invoice_line_keys, '[]'::jsonb);
  return new;
end;
$$;

drop trigger if exists trg_coalesce_so_item_invoice_line_keys on public.so_items;
create trigger trg_coalesce_so_item_invoice_line_keys
  before insert or update of invoice_line_keys on public.so_items
  for each row execute function public.fn_coalesce_so_item_invoice_line_keys();

comment on function public.fn_coalesce_so_item_invoice_line_keys() is
  'Normalizes legacy or heterogeneous PostgREST SO-item payloads so invoice_line_keys remains a non-null JSON array.';

do $$
declare
  trigger_count integer;
begin
  select count(*) into trigger_count
  from pg_trigger
  where tgrelid = 'public.so_items'::regclass
    and tgname = 'trg_coalesce_so_item_invoice_line_keys'
    and not tgisinternal;

  if trigger_count <> 1 then
    raise exception 'expected invoice_line_keys compatibility trigger, found %', trigger_count;
  end if;
end;
$$;

commit;
