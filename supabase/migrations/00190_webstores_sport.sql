-- webstores.sport — free-text sport label (matches the TEMPLATE_SPORTS datalist
-- convention already used by store_templates.sport; no CHECK, same as created_via).
--
-- Set by the rep Quick Build flow on the created store, and usable on template
-- stores (is_template=true) so a sport can map to its starter template. Part of
-- the auto-store-creation program — see COACH_AUTO_STORE_PLAN_2026-07-10.md.
alter table public.webstores add column if not exists sport text;
