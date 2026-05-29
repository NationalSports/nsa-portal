-- Migration 033: Link jobs that share a decoration so they can be run together.
--
-- Production often has multiple jobs getting the SAME decoration (same screen / same
-- digitized file) but sitting on different sales orders — frequently under different
-- sub-customers of the same parent. Running them together avoids re-creating the screen.
--
-- Two mechanisms, both additive and nullable:
--   * link_group     — manual override. Jobs sharing the same link_group id are explicitly
--                       grouped together, even when their art is named differently across
--                       sub-customers (so the name+deco auto-match would miss them).
--   * auto_group_off — manual override the other direction. Set true to exclude a job from
--                       the automatic "same artwork (name + deco type)" grouping, for the
--                       rare case where two different designs happen to share a name.
--
-- Automatic grouping (same art_name + deco_type within a parent customer) is computed in the
-- app and needs no stored column; these two columns only capture manual corrections.

ALTER TABLE so_jobs ADD COLUMN IF NOT EXISTS link_group TEXT;
ALTER TABLE so_jobs ADD COLUMN IF NOT EXISTS auto_group_off BOOLEAN DEFAULT false;
