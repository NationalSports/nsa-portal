-- Bridge job production stages → customer-visible line_status.
--
-- THE GAP (verified against live): for a Team Shop / club order run through the
-- Production HQ queue, webstore_order_items.line_status jumps straight from
-- 'pending' to 'shipped'. The two existing writers of line_status never fire
-- for the queue workflow:
--   * webstore_sync_status() (the live 'monotonic' trigger on sales_orders)
--     only advances line_status when sales_orders.status is written to
--     in_production/needs_pull/staging/in_process/items_received/complete — but
--     teamshop/club SOs are born status='need_order' and NOTHING ever persists
--     status=calcSOStatus back onto the row, so that trigger's in-production
--     arms are dead for these orders.
--   * the client _applyWebstoreStageSync (App.js) fires only from savSO, i.e.
--     only when staff work the SO through the LEGACY App.js Kanban board — which
--     the Production HQ queue deliberately does not use (it drives every stage
--     move through advance_job_stage, 00205).
-- So advance_job_stage moves so_jobs.prod_status hold→staging→in_process→
-- completed, but that never reaches line_status. The customer's tracker
-- (/shop/order/<token>, OrderTrack.js) shows only "Received/On order" while the
-- AI assistant — which reads so_jobs.prod_status LIVE (summarizeProdStage) —
-- correctly says "in production". This closes that inconsistency at the one hook
-- every writer of prod_status passes through.
--
-- THE HOOK: an AFTER UPDATE OF prod_status trigger on so_jobs. Every current and
-- future writer of prod_status — advance_job_stage (via TeamShopQueue, job-scan,
-- teamshop-auto-release) AND the legacy App.js dbEngine path — passes through
-- it, without touching advance_job_stage's contract/latency or the client sync.
--
-- COMPOSES SAFELY WITH THE EXISTING WRITERS: this is a THIRD writer of
-- line_status, alongside webstore_sync_status() (sales_orders trigger) and the
-- client _applyWebstoreStageSync. All three use the SAME ordinal ladder
-- (received=1, in_production=2, bagging=3, shipped=4/complete=4) and the SAME
-- monotonic "advance only if current_idx < target_idx" gate copied verbatim from
-- the live webstore_sync_status() body — so no writer can regress another's
-- progress; they race harmlessly to furthest-wins. In particular a line already
-- 'shipped' (4) is never pulled back by this trigger (target here maxes at
-- bagging=3), and 'cancelled' lines are never touched.
--
-- COARSENESS (inherited, not new): like webstore_sync_status()'s own
-- sales_orders arm, this is SO-WIDE — it derives one stage from all of the SO's
-- so_jobs and applies it to every line, with no per-SKU/size receiving gate (the
-- granular backorder hold lives only in the client _applyWebstoreStageSync). It
-- can therefore, in principle, advance a line whose specific goods aren't in yet
-- if ANOTHER job on the same SO is in production. This is bounded by 00205's
-- release gate, which already requires item_status <> 'need_to_order' before a
-- job can leave 'hold' at all — so a job is only ever 'staging'/'in_process'
-- once its own goods are accounted for. Acceptable for a customer-facing coarse
-- status; the granular client sync still refines it on any App.js save.
--
-- STAGE DERIVATION (mirror of calcSOStatus's job half):
--   * all of the SO's jobs 'completed'            -> 'bagging'       (idx 3)
--   * any job 'staging'/'in_process', or some (not all) 'completed'
--                                                  -> 'in_production' (idx 2)
--   * all jobs still 'hold'                        -> no-op (null; never regress)
-- It never sets 'received'/'shipped' — 'received' is the goods-receiving domain
-- (item_status), and 'shipped' is ShipStation's writer; the monotonic gate means
-- setting in_production already implies "past received", and shipped(4) > bagging(3)
-- so ShipStation's stamp is never regressed.
--
-- Not SECURITY DEFINER (matches the live webstore_sync_status posture): the sole
-- automated caller, advance_job_stage, is itself SECURITY DEFINER and runs as
-- owner (owner bypasses RLS); the legacy App.js path runs as staff, who hold
-- write RLS on webstore_order_items (is_team_member). No path needs elevation.
--
-- Rollback:
--   drop trigger if exists trg_line_status_from_jobs on public.so_jobs;
--   drop function if exists public.webstore_sync_status_from_jobs();

create or replace function public.webstore_sync_status_from_jobs()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  ls          text;
  target_idx  int;
  v_total     int;
  v_active    int;   -- staging or in_process
  v_completed int;
begin
  if NEW.so_id is null then return NEW; end if;

  -- Only bridge SOs that back a webstore/teamshop/club order (else the UPDATE
  -- below matches zero rows anyway — this is a cheap early-out).
  if not exists (select 1 from webstore_orders where so_id = NEW.so_id) then
    return NEW;
  end if;

  select
    count(*),
    count(*) filter (where coalesce(prod_status, 'hold') in ('staging', 'in_process')),
    count(*) filter (where prod_status = 'completed')
  into v_total, v_active, v_completed
  from so_jobs
  where so_id = NEW.so_id;

  if v_total = 0 then return NEW; end if;

  ls := case
          when v_completed = v_total          then 'bagging'
          when v_active > 0 or v_completed > 0 then 'in_production'
          else null   -- all still 'hold' → don't advance, don't regress
        end;
  if ls is null then return NEW; end if;

  target_idx := case ls
    when 'received'      then 1
    when 'in_production' then 2
    when 'bagging'       then 3
    when 'shipped'       then 4
    when 'complete'      then 4
    else 0
  end;

  -- Monotonic, advance-only — copied verbatim from the live webstore_sync_status()
  -- body so the two triggers share one ladder and never fight.
  update webstore_order_items i
     set line_status = ls
   where i.order_id in (select id from webstore_orders where so_id = NEW.so_id)
     and coalesce(i.line_status, 'pending') <> 'cancelled'
     and (case coalesce(i.line_status, 'pending')
            when 'received'      then 1
            when 'in_production' then 2
            when 'bagging'       then 3
            when 'shipped'       then 4
            when 'complete'      then 4
            else 0
          end) < target_idx;

  return NEW;
end;
$$;

drop trigger if exists trg_line_status_from_jobs on public.so_jobs;
create trigger trg_line_status_from_jobs
  after update of prod_status on public.so_jobs
  for each row
  when (NEW.prod_status is distinct from OLD.prod_status)
  execute function public.webstore_sync_status_from_jobs();
