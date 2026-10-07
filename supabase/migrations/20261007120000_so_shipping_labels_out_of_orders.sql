-- Shipping-label PDFs out of the sales_orders row.
--
-- WHY: ShipStation label PDFs were stored inline in sales_orders._shipments[].label_url as
-- base64 data URLs (~50 KB each). Measured 2026-10-07: 417 labels on 170 orders = 21 MB of
-- the 25 MB sales_orders payload. Every portal tab downloads every order at boot, again on
-- every tab focus, and on each poll/realtime reload of the sales_orders group — so these PDFs
-- were most of what a new tab waited on, although nobody needs one until they click Print.
--
-- WHAT: each PDF moves to so_shipping_labels (staff-read only). label_url keeps a short
-- 'nsa-label:<md5 of the data URL>' reference, so every "has a label?" truthiness check in the
-- app is unchanged. The client fetches the PDF on click (src/lib/shippingLabels.js).
--
-- HOW EVERY WRITER IS COVERED: a BEFORE INSERT/UPDATE OF _shipments trigger externalizes any
-- data URL as it is written — the atomic SO save RPC, ups-pickup-sync, the production-packet
-- RPC, and tabs still running pre-deploy code that write an old data URL back. The id is the
-- md5 of the data URL, so a label written again maps to the same row (on conflict do nothing).
-- The trigger edits NEW in place: no extra UPDATE, so no extra _version bump on normal saves.
--
-- DEPLOY ORDER: ship the client (which prints both data URLs and references) BEFORE applying
-- this migration, or tabs on the old build will try to open 'nsa-label:…' as a URL.
--
-- BACKFILL SIDE EFFECTS (deliberate): the ~170 affected orders get the normal _version bump,
-- updated_at = now(), and one audit_log row each via their existing triggers. Open tabs adopt
-- the newer rows through their usual realtime/poll merge. A rep with an UNSAVED edit on one of
-- those orders at that moment gets the standard "reload" conflict card (STALE_SO_WRITE), so
-- apply outside working hours.

create table if not exists public.so_shipping_labels (
  id text primary key,                 -- md5(data_url)
  so_id text,
  shipment_id text,
  data_url text not null,
  created_at timestamptz not null default now()
);
create index if not exists so_shipping_labels_so_id_idx on public.so_shipping_labels (so_id);

-- Labels carry customer names and addresses: staff read only. Writes happen only through the
-- SECURITY DEFINER function below, so no client role gets insert/update/delete.
alter table public.so_shipping_labels enable row level security;
drop policy if exists so_shipping_labels_staff_read on public.so_shipping_labels;
create policy so_shipping_labels_staff_read on public.so_shipping_labels
  for select to authenticated using (public.is_team_member());
revoke all on public.so_shipping_labels from public, anon, authenticated;
grant select on public.so_shipping_labels to authenticated;
grant all on public.so_shipping_labels to service_role;

-- Returns p_shipments with every data-URL label_url replaced by its reference, storing each PDF
-- once. Order, every other field, and non-data label_urls (ShipStation https links, null) are
-- left exactly as they were. Non-array input is returned untouched.
create or replace function public.externalize_so_label_pdfs(p_so_id text, p_shipments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_url  text;
  v_id   text;
begin
  if p_shipments is null or jsonb_typeof(p_shipments) <> 'array' then
    return p_shipments;
  end if;
  for v_elem in
    select e.value from jsonb_array_elements(p_shipments) with ordinality as e(value, ord) order by e.ord
  loop
    v_url := case when jsonb_typeof(v_elem) = 'object' and jsonb_typeof(v_elem->'label_url') = 'string'
                  then v_elem->>'label_url' end;
    if v_url like 'data:%' then
      v_id := md5(v_url);
      insert into public.so_shipping_labels (id, so_id, shipment_id, data_url)
        values (v_id, p_so_id, v_elem->>'id', v_url)
        on conflict (id) do nothing;
      v_elem := jsonb_set(v_elem, '{label_url}', to_jsonb('nsa-label:' || v_id));
    end if;
    v_out := v_out || jsonb_build_array(v_elem);
  end loop;
  return v_out;
end;
$$;

create or replace function public.so_shipments_externalize_labels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new._shipments) = 'array'
     and jsonb_path_exists(new._shipments, '$[*].label_url ? (@ starts with "data:")') then
    new._shipments := public.externalize_so_label_pdfs(new.id, new._shipments);
  end if;
  return new;
end;
$$;

-- Internal helpers: never callable over PostgREST /rpc.
revoke all on function public.externalize_so_label_pdfs(text, jsonb) from public, anon, authenticated;
revoke all on function public.so_shipments_externalize_labels() from public, anon, authenticated;

drop trigger if exists trg_sales_orders_externalize_labels on public.sales_orders;
create trigger trg_sales_orders_externalize_labels
  before insert or update of _shipments on public.sales_orders
  for each row execute function public.so_shipments_externalize_labels();

-- Backfill. Setting _shipments fires the trigger above, which does the externalizing.
update public.sales_orders
   set _shipments = _shipments
 where jsonb_typeof(_shipments) = 'array'
   and jsonb_path_exists(_shipments, '$[*].label_url ? (@ starts with "data:")');

do $$
begin
  if exists (
    select 1 from public.sales_orders
     where jsonb_typeof(_shipments) = 'array'
       and jsonb_path_exists(_shipments, '$[*].label_url ? (@ starts with "data:")')
  ) then
    raise exception 'so_shipping_labels backfill incomplete: inline label PDFs remain';
  end if;
end $$;
