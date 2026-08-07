-- Mixed-media jobs declare every decoration method they carry in deco_types[] (primary method
-- stays in deco_type). Without this column the client's deco_types was silently dropped on save,
-- so a reloaded released mixed job lost its declared method set and the frozen-claim drift healer
-- could judge its secondary-method claims as drift. Applied to production 2026-08-07.
alter table so_jobs add column if not exists deco_types jsonb;
