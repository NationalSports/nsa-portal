-- ════════════════════════════════════════════════════════════════════
-- Migration 00166 — archive legacy-keyed Agron product rows
--
-- products carries Agron (adidas accessories) items under THREE legacy
-- keyings — numeric colorway (5160708), per-size suffix (5159078B), and
-- adidas-article (JJ7433). The agron sync converges on the bare numeric
-- colorway code (= agron_inventory.sku), so the 430 per-size / article-keyed
-- rows can NEVER match an inventory row: they sat in the active catalog as
-- permanently-stockless duplicates (the "458 Agron products with no inventory
-- rows" from the 2026-07-03 LiveLook audit; none carry in-house stock either).
-- This is the supervised cleanup the agron sync reference deferred.
--
-- Soft + reversible: is_archived=true, is_active untouched. Properly-keyed
-- numeric colorways (28, incl. 8 with in-house warehouse stock) stay active —
-- the sync fills them, and the LiveLook fix in this branch shows in-house
-- stock for Agron items even without vendor rows.
--
-- Applied to project hpslkvngulqirmbstlfx via supabase apply_migration.
-- ════════════════════════════════════════════════════════════════════

update public.products p
   set is_archived = true, updated_at = now()
 where p.inventory_source = 'agron'
   and coalesce(p.is_active, true) and not coalesce(p.is_archived, false)
   and p.sku !~ '^[0-9]+$'
   and not exists (select 1 from public.agron_inventory ai where ai.sku = p.sku);
