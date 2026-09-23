-- Coach shipping-notice ledger for sales orders.
--
-- One row per (order, set of boxes) that the "your gear is on the way" email
-- covers. Written ONLY by the server (so-shipment-notify / -sweep, service
-- role); the browser never touches it. That matters for two reasons:
--
--   1. The notice must not live on sales_orders itself. Every UPDATE to that
--      row bumps _version (trg_sales_orders_version), and save_sales_order_atomic
--      then rejects the next save from any rep who had the order open
--      (STALE_SO_WRITE). A shipping email must never cost a rep their edit.
--   2. The browser writes sales_orders.sent_history wholesale on every save, so a
--      dedupe marker kept there could be overwritten by a stale tab — and the
--      coach would get the same email twice. This table is clobber-proof.
--
-- first_tracked_at is when the sweep FIRST saw every box in the set carrying a
-- tracking number — the label can be bought days after the box was confirmed
-- (Awaiting Pickup → Create Label), so the box's own date is the wrong clock for
-- the grace window. sent_at is the send; a row with sent_at null is a notice
-- waiting out its grace window.

begin;

create table if not exists public.so_shipment_notices (
  id                bigserial primary key,
  so_id             text not null references public.sales_orders(id) on delete cascade,
  shipment_sig      text not null,                 -- sorted, comma-joined shipment ids
  box_count         integer not null default 0,
  first_tracked_at  timestamptz not null default now(),
  sent_at           timestamptz,
  sent_to           text,
  sent_by           text,                          -- team_members.id, 'shipment-sweep', …
  source            text not null default 'button' check (source in ('button', 'sweep')),
  message_id        text,                          -- Brevo message id
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (so_id, shipment_sig)
);

create index if not exists idx_so_shipment_notices_so
  on public.so_shipment_notices(so_id);
create index if not exists idx_so_shipment_notices_pending
  on public.so_shipment_notices(first_tracked_at)
  where sent_at is null;

alter table public.so_shipment_notices enable row level security;
revoke all on public.so_shipment_notices from public, anon, authenticated;
grant all on public.so_shipment_notices to service_role;
-- Staff may READ the ledger (a future "coach notified" indicator on the Tracking
-- tab); writes stay server-only.
drop policy if exists so_shipment_notices_staff_read on public.so_shipment_notices;
create policy so_shipment_notices_staff_read on public.so_shipment_notices
  for select to authenticated using (coalesce(public.is_team_member(), false));
grant select on public.so_shipment_notices to authenticated;

commit;
