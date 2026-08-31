-- Migration 20260824120000: building-move check-in (September move).
-- Every physical box entering the new building gets scanned at /move-checkin.
-- Rides on the existing boxes table (00185): check-in is a stamp on the box,
-- shelf placement uses the `bin` column that 00185 already reserved. Legacy
-- (pre-QR) boxes are hand-entered as kind='legacy' rows and get `assigned_to`
-- ('job' — so_id holds the SO — or 'inventory'), then a printed BX label.
-- Additive only; the client degrades gracefully while this isn't applied.

alter table public.boxes add column if not exists checked_in_at timestamptz;  -- when the box arrived at the new building
alter table public.boxes add column if not exists checked_in_by text;         -- staff email who scanned it
alter table public.boxes add column if not exists assigned_to  text;          -- 'job' | 'inventory' (legacy/manual boxes)

create index if not exists boxes_checked_in_at_idx on public.boxes(checked_in_at);
