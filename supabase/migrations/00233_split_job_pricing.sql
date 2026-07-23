-- Split-job pricing (JOB-1393-05): when a production job is split, the halves are separate
-- press runs, so the design bills each run at its own screen-print quantity tier instead of
-- the combined qty (a 1-pc run pays the bracket-0 flat setup; a 24-pc run pays the 24-tier
-- rate), blended into the line's per-piece price.
--
--  so_jobs.priced_separately  — stamped TRUE on both halves at split time (forward-only:
--                               pre-existing splits without the flag keep combined pricing).
--  so_jobs.price_override     — rep-requested / admin-approved combined-pricing override
--                               (warehouse-fault splits): {status:'requested'|'approved'|
--                               'denied', reason, requested_by/at, approved_by/at, ...}.
--  so_item_decorations.split_runs — the per-run qty partition [1,24] stamped onto the
--                               design's decorations (read by decoPricing.dP via
--                               decoSplitRuns; re-validated against live qty at price time).

ALTER TABLE so_jobs ADD COLUMN IF NOT EXISTS priced_separately BOOLEAN DEFAULT FALSE;
ALTER TABLE so_jobs ADD COLUMN IF NOT EXISTS price_override JSONB;
ALTER TABLE so_item_decorations ADD COLUMN IF NOT EXISTS split_runs JSONB;
