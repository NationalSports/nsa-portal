-- Preserve split-shipment history and make void recording retryable. Previously
-- both staff UIs deleted every shipment for an order and reset every shipped line
-- when only the latest ShipStation label was voided.

alter table public.webstore_shipments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text;

create index if not exists webstore_shipments_active_order_idx
  on public.webstore_shipments(order_id, created_at)
  where voided_at is null;

create or replace function public.mark_webstore_shipment_voided(
  p_order_id uuid,
  p_ss_shipment_id text,
  p_actor text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.webstore_shipments;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_order_id is null or nullif(btrim(p_ss_shipment_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_order_or_shipment');
  end if;

  select * into v_row
    from public.webstore_shipments
   where order_id = p_order_id
     and ss_shipment_id = p_ss_shipment_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'shipment_not_recorded');
  end if;

  if v_row.voided_at is null then
    update public.webstore_shipments
       set voided_at = now(), voided_by = nullif(btrim(p_actor), '')
     where id = v_row.id;

    -- A not-yet-sent tracking email must not leave after its label is voided.
    update public.webstore_notification_outbox
       set status = 'dead', locked_at = null, updated_at = now(),
           last_error = 'Shipment label voided before notification delivery'
     where shipment_id = v_row.id
       and status in ('pending', 'processing');
  end if;

  return jsonb_build_object(
    'ok', true,
    'shipment_id', v_row.id,
    'replayed', v_row.voided_at is not null
  );
end;
$$;

revoke all on function public.mark_webstore_shipment_voided(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_webstore_shipment_voided(uuid, text, text)
  to service_role;

comment on function public.mark_webstore_shipment_voided(uuid, text, text) is
  'Service-only, idempotent void marker for one ShipStation shipment. Preserves sibling shipment history and cancels any unsent tracking email.';
