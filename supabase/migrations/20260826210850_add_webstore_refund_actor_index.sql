-- Cover the staff-actor foreign key added by item_linked_webstore_refunds.
-- This keeps team-member deletes/updates from scanning the refund ledger.
create index if not exists webstore_order_refunds_actor_idx
  on public.webstore_order_refunds(actor_team_member_id)
  where actor_team_member_id is not null;
