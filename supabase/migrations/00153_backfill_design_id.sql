-- Backfill design_id for art rows that went NULL after migration 00152.
-- Root cause: 00152 added design_id + put it in the save allowlist, but the SO/estimate
-- loaders weren't updated to read it back, so rows created/saved afterward wrote NULL.
-- The loaders now round-trip design_id; this one-time backfill repairs the existing NULLs
-- so logo-reuse matching (priorMocks, keyed on design_id) works for them too.
-- Same derivation as 00152; idempotent (only touches NULL rows that have a name).

UPDATE so_art_files
   SET design_id = 'design_' || md5(lower(coalesce(name, '')) || '|' || coalesce(deco_type, ''))
 WHERE design_id IS NULL AND coalesce(name, '') <> '';

UPDATE estimate_art_files
   SET design_id = 'design_' || md5(lower(coalesce(name, '')) || '|' || coalesce(deco_type, ''))
 WHERE design_id IS NULL AND coalesce(name, '') <> '';
