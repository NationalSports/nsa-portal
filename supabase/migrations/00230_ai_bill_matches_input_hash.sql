-- ai-bill-matcher result cache: 79% of the function's Claude calls (379/478 as of
-- 2026-07-21) were byte-identical re-runs of the same bill against the same order —
-- the client re-sweeps unresolved bills on every pull and nothing cached server-side.
-- input_hash keys a stored mapping by (doc, exact model inputs) so the edge function
-- can return the prior result instead of re-calling the API.
alter table ai_bill_matches add column if not exists input_hash text;
-- The exact JSON body the function returned, so a cache hit replays it verbatim
-- (mappings alone don't carry find_po's chosen_id/kind/reason).
alter table ai_bill_matches add column if not exists response jsonb;
create index if not exists ai_bill_matches_input_hash_idx
  on ai_bill_matches (input_hash, created_at desc) where input_hash is not null;
