-- The production project has no Slack token/configuration table, so do not
-- enqueue a guaranteed-failing HTTP request for every portal message. The
-- Edge Function stays deployable for a future Slack rollout; re-enable its
-- trigger only after slack_bot_token has been configured.

drop trigger if exists slack_notify_on_message_insert on public.messages;
drop function if exists private.notify_slack_on_message_insert();
