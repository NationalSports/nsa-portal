-- Coach self-serve + NSA item catalog for the roster ordering system.
--
-- Model:
--   * NSA staff load the item catalog once per customer — a roster_kit_templates
--     row with is_catalog=true whose items[] carry the product/SKU links used for
--     live inventory availability. Coaches can't do this (needs product knowledge).
--   * Coaches build sessions/teams/rosters themselves and assemble each session's
--     kit by adding items from the catalog into roster_order_sessions.kit_items.
--
-- These columns may already exist from a forward 00146; guarded with IF NOT EXISTS.

alter table public.roster_kit_templates
  add column if not exists is_catalog boolean not null default false;

alter table public.roster_order_sessions
  add column if not exists kit_items jsonb not null default '[]';

-- One catalog per customer (partial unique; ignores non-catalog snapshot rows).
create unique index if not exists roster_kit_templates_one_catalog_per_customer
  on public.roster_kit_templates (customer_id)
  where is_catalog;
