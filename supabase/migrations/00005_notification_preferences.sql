-- ============================================================
-- NSA Portal – Notification Preferences
-- Migration: 00005_notification_preferences
-- ============================================================
-- Each user can control:
--   • Which event types trigger notifications
--   • Quiet hours (e.g. no pings after 6pm or before 7am)
--   • Day-of-week schedule (no weekends)
--   • Timezone (so quiet hours work correctly)
--   • Urgency override (urgent messages bypass quiet hours)

create table public.notification_preferences (
  user_id               uuid primary key references public.user_profiles(id) on delete cascade,

  -- Master toggle
  enabled               boolean not null default true,

  -- Channel preferences
  slack_enabled          boolean not null default true,
  email_enabled          boolean not null default false,   -- future: email notifications
  push_enabled           boolean not null default false,   -- future: browser push

  -- Schedule: quiet hours
  timezone               text not null default 'America/Los_Angeles',
  quiet_start            time default '18:00',             -- stop notifications at 6 PM
  quiet_end              time default '07:00',             -- resume at 7 AM
  quiet_hours_enabled    boolean not null default false,   -- opt-in

  -- Schedule: active days (true = notifications active)
  day_sun                boolean not null default false,
  day_mon                boolean not null default true,
  day_tue                boolean not null default true,
  day_wed                boolean not null default true,
  day_thu                boolean not null default true,
  day_fri                boolean not null default true,
  day_sat                boolean not null default false,

  -- Event type toggles
  on_mention             boolean not null default true,    -- someone @mentions you
  on_dept_message        boolean not null default true,    -- message tagged to your dept
  on_so_reply            boolean not null default true,    -- reply on an SO you own
  on_art_status_change   boolean not null default true,    -- art file approved/rejected
  on_job_status_change   boolean not null default true,    -- production job status update
  on_po_received         boolean not null default true,    -- PO items received in warehouse
  on_invoice_paid        boolean not null default true,    -- customer payment received
  on_estimate_viewed     boolean not null default true,    -- coach opened/viewed estimate
  on_firm_date_request   boolean not null default true,    -- firm date requested

  -- Urgency: these bypass quiet hours
  urgent_bypass          boolean not null default true,    -- urgent messages ignore schedule

  -- Department filter (empty = all departments)
  dept_filter            text[] default '{}',              -- e.g. {production, warehouse}

  updated_at             timestamptz not null default now()
);

create trigger trg_notif_prefs_updated
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- RLS: users manage their own prefs, admin can view all
alter table public.notification_preferences enable row level security;

create policy "notif_prefs_own" on public.notification_preferences
  for all using (user_id = public.current_profile_id());

create policy "notif_prefs_admin_read" on public.notification_preferences
  for select using (public.is_admin());

-- Auto-create prefs row when a user profile is created
create or replace function public.create_default_notif_prefs()
returns trigger as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql;

create trigger trg_auto_notif_prefs
  after insert on public.user_profiles
  for each row execute function public.create_default_notif_prefs();

-- Seed prefs for existing demo users
insert into public.notification_preferences (user_id)
select id from public.user_profiles
on conflict (user_id) do nothing;

-- ─── Helper function: should this user be notified right now? ───
-- Called by slack-notify to check schedule before sending.

create or replace function public.should_notify(
  p_user_id uuid,
  p_event_type text default 'mention',
  p_is_urgent boolean default false
)
returns boolean as $$
declare
  prefs public.notification_preferences;
  now_in_tz timestamptz;
  current_time_local time;
  current_dow integer; -- 0=Sun, 6=Sat
  in_quiet boolean;
  day_active boolean;
begin
  select * into prefs
  from public.notification_preferences
  where user_id = p_user_id;

  -- No prefs row = use defaults (notify everything)
  if not found then return true; end if;

  -- Master toggle
  if not prefs.enabled or not prefs.slack_enabled then return false; end if;

  -- Check event type toggle
  if p_event_type = 'mention'           and not prefs.on_mention           then return false; end if;
  if p_event_type = 'dept'              and not prefs.on_dept_message      then return false; end if;
  if p_event_type = 'reply'             and not prefs.on_so_reply          then return false; end if;
  if p_event_type = 'art_status'        and not prefs.on_art_status_change then return false; end if;
  if p_event_type = 'job_status'        and not prefs.on_job_status_change then return false; end if;
  if p_event_type = 'po_received'       and not prefs.on_po_received       then return false; end if;
  if p_event_type = 'invoice_paid'      and not prefs.on_invoice_paid      then return false; end if;
  if p_event_type = 'estimate_viewed'   and not prefs.on_estimate_viewed   then return false; end if;
  if p_event_type = 'firm_date_request' and not prefs.on_firm_date_request then return false; end if;

  -- Urgent messages bypass schedule if user opted in
  if p_is_urgent and prefs.urgent_bypass then return true; end if;

  -- Check day of week
  now_in_tz := now() at time zone prefs.timezone;
  current_dow := extract(dow from now_in_tz);
  day_active := case current_dow
    when 0 then prefs.day_sun
    when 1 then prefs.day_mon
    when 2 then prefs.day_tue
    when 3 then prefs.day_wed
    when 4 then prefs.day_thu
    when 5 then prefs.day_fri
    when 6 then prefs.day_sat
  end;

  if not day_active then return false; end if;

  -- Check quiet hours
  if prefs.quiet_hours_enabled and prefs.quiet_start is not null and prefs.quiet_end is not null then
    current_time_local := (now_in_tz)::time;

    if prefs.quiet_start > prefs.quiet_end then
      -- Overnight quiet period (e.g. 18:00 → 07:00)
      in_quiet := current_time_local >= prefs.quiet_start or current_time_local < prefs.quiet_end;
    else
      -- Same-day quiet period (e.g. 12:00 → 13:00)
      in_quiet := current_time_local >= prefs.quiet_start and current_time_local < prefs.quiet_end;
    end if;

    if in_quiet then return false; end if;
  end if;

  return true;
end;
$$ language plpgsql security definer stable;
