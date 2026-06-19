-- "Split by Received Inventory" now keeps the received/producible units on the original job and
-- peels the NOT-yet-received units off into a new -S backorder job. That backorder slice is flagged
-- split_open so allocateJobFulfillment apportions the shared line-item receipts to it LAST (the
-- received units stay counted on the parent; the backorder fills only as its own units arrive).
--
-- The flag lives on the slice (which syncJobs preserves as-is rather than regenerating), so it has to
-- persist — unlike the job-level split_group, which is re-derived from the decorations every sync.
-- Without this column it is stripped on every save (see _jobExtraCols) and the backorder slice would
-- wrongly claim the parent's receipts again on reload.

ALTER TABLE so_jobs ADD COLUMN IF NOT EXISTS split_open boolean NOT NULL DEFAULT false;
