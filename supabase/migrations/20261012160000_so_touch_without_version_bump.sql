-- Header "touch" for art/job-only order saves, without an optimistic-version bump.
--
-- Art Dashboard actions (file uploads, production-files confirmation, status moves, artist
-- assignment) save only so_art_files / so_jobs rows. Every other session learns that an order
-- changed through its sales_orders row: realtime watches only that table, the client poll merge
-- skips an order whose updated_at is unchanged, and an open order editor syncs on
-- updated_at/_version. So after such a save the client calls touch_sales_order(), which moves
-- updated_at and nothing else.
--
-- The touch must NOT advance _version. _version is the order's edit base: save_sales_order_atomic
-- rejects any save whose base is behind (STALE_SO_WRITE). Bumping it for an artist's upload is
-- exactly what rejected a rep's first edit on SO-2444 (2026-10-12) — the rep's open tab was still
-- valid; nothing the rep edits was touched.
--
-- Mechanism: touch_sales_order sets a transaction-local flag around a single
-- `update ... set updated_at = now()`. The sales_orders version trigger keeps _version only when
-- that flag is on AND the row is otherwise byte-for-byte unchanged (so a BEFORE trigger that
-- rewrites a real column during the touch still produces a normal bump). Every other UPDATE —
-- including full saves that change only child rows — bumps exactly as before.
--
-- Additive and backward compatible: nothing sets the flag except touch_sales_order, and clients
-- that never call it see no difference.

create or replace function public.sales_orders_version_bump()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  if current_setting('nsa.so_touch_only', true) = 'on' then
    if (to_jsonb(new) - 'updated_at' - '_version') = (to_jsonb(old) - 'updated_at' - '_version') then
      new._version := old._version;
      return new;
    end if;
  end if;
  new._version := coalesce(old._version, 0) + 1;
  return new;
end;
$$;

-- Same name, timing and level as the trigger it replaces (00049: BEFORE UPDATE FOR EACH ROW
-- EXECUTE FUNCTION increment_version()); only the function changes. increment_version() itself
-- is untouched and still serves estimates, invoices, customers, so_jobs and the art tables.
drop trigger if exists trg_sales_orders_version on public.sales_orders;
create trigger trg_sales_orders_version
  before update on public.sales_orders
  for each row execute function public.sales_orders_version_bump();

-- search_path matches _so_save_row (which performs the header writes for save_sales_order_atomic):
-- the UPDATE fires sales_orders' BEFORE triggers with this function's path, and some of them
-- (enforce_so_estimate_customer: `from estimates`) reference tables unqualified with no path of
-- their own. An empty path here would make every touch of an order with an estimate fail.
create or replace function public.touch_sales_order(p_so_id text)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_updated timestamptz;
  v_version integer;
  v_hit boolean;
begin
  if current_user not in ('postgres', 'service_role') and not coalesce(public.is_team_member(), false) then
    raise exception 'STAFF_REQUIRED' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('nsa.so_touch_only', 'on', true);
  update public.sales_orders set updated_at = pg_catalog.now()
   where id = p_so_id
   returning updated_at, _version into v_updated, v_version;
  v_hit := found;
  perform pg_catalog.set_config('nsa.so_touch_only', 'off', true);
  if not v_hit then
    return jsonb_build_object('touched', false);
  end if;
  return jsonb_build_object('touched', true, 'updated_at', v_updated, 'version', v_version);
end;
$$;

revoke all on function public.touch_sales_order(text) from public, anon;
grant execute on function public.touch_sales_order(text) to authenticated, service_role;
