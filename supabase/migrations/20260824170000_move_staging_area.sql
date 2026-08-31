-- Migration 20260824170000: staging stage for the building-move flow.
-- The move is three stages: checked in → staging → on shelf. `bin` (00185)
-- stays the FINAL shelf; staging_area is the temporary drop zone a box waits
-- in before it's shelved. Stage is derived client-side (bin wins over
-- staging_area) — see src/movecheckin/moveLogic.js boxStage(). Additive only.

alter table public.boxes add column if not exists staging_area text;
