-- Server-only packet message context; existing RLS and grants remain unchanged.
alter table public.production_packet_message_shares add column if not exists metadata jsonb not null default '{}'::jsonb;
