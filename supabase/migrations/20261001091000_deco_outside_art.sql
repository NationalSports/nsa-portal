-- Opt-in art flow for outside decoration. When true, a design routed to an outside
-- decorator (fulfillment='outside' or on a deco PO) gets an art-only job so it goes through
-- Request Art → mockup → customer approval → production files (see src/lib/outsideArt.js).
-- Default false: every existing outside decoration keeps today's behavior (no job).
alter table public.so_item_decorations add column if not exists outside_art boolean not null default false;
alter table public.estimate_item_decorations add column if not exists outside_art boolean not null default false;
