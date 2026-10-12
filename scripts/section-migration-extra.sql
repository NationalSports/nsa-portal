-- The roster exposes only a safe directory through an RPC; only Team editors can read raw identities/grants.
create policy portal_team_read on public.team_members as restrictive for select to anon,authenticated
 using ((select auth.uid()) is not null and (auth_id=(select auth.uid()) or private.has_staff_section('team')));
create policy portal_team_write on public.team_members as restrictive for all to authenticated
 using (private.has_staff_section('team')) with check (private.has_staff_section('team'));
-- A restrictive FOR ALL would also restrict reading one's own row. Use separate write guards instead.
drop policy portal_team_write on public.team_members;
create policy portal_team_insert on public.team_members as restrictive for insert to authenticated with check (private.has_staff_section('team'));
create policy portal_team_update on public.team_members as restrictive for update to authenticated using (private.has_staff_section('team')) with check (private.has_staff_section('team'));
create policy portal_team_delete on public.team_members as restrictive for delete to authenticated using (private.has_staff_section('team'));
create or replace function public.get_staff_directory()
returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(case when private.has_staff_section('team') then to_jsonb(t) else jsonb_build_object('id',t.id,'name',t.name,'role',t.role,'email',t.email,'phone',t.phone,'is_active',t.is_active,'access',case when t.auth_id=auth.uid() then to_jsonb(t.access) else null end) end order by t.name),'[]'::jsonb)
 from public.team_members t where t.is_active is not false and public.is_team_member();
$fn$;
revoke all on function public.get_staff_directory() from public,anon;
grant execute on function public.get_staff_directory() to authenticated;
-- Verified first-time setup no longer depends on downloading the anonymous staff roster.
create or replace function public.link_my_team_auth()
returns void language plpgsql security definer set search_path='' as $fn$
declare uid uuid:=auth.uid(); member_id text; verified_email text;
begin
 select email into verified_email from auth.users where id=uid and email_confirmed_at is not null;
 if verified_email is null then raise exception 'Verified email required' using errcode='42501'; end if;
 select id into member_id from public.team_members where lower(trim(email))=lower(trim(verified_email)) and is_active is not false and (auth_id is null or auth_id=uid);
 if member_id is null then raise exception 'No active staff profile matches this verified email' using errcode='42501'; end if;
 perform public.link_team_auth(member_id,uid);
end $fn$;
revoke all on function public.link_my_team_auth() from public,anon;
grant execute on function public.link_my_team_auth() to authenticated;
-- Retire profile-role escalation: helper roles come only from the protected staff roster.
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path='' as $fn$
 select role from public.team_members where auth_id=auth.uid() and is_active is not false limit 1;
$fn$;
create policy portal_profile_update on public.user_profiles as restrictive for update to anon,authenticated
 using (private.has_staff_section('team')) with check (private.has_staff_section('team'));
create policy portal_profile_insert on public.user_profiles as restrictive for insert to anon,authenticated with check (private.has_staff_section('team'));
create policy portal_profile_delete on public.user_profiles as restrictive for delete to anon,authenticated using (private.has_staff_section('team'));
create policy portal_profile_read on public.user_profiles as restrictive for select to anon,authenticated
 using ((select auth.uid()) is not null and (auth_id=(select auth.uid()) or private.has_staff_section('team')));
-- Personal commission snapshots are scoped by stable rep ID, including after role changes.
create policy portal_commission_scope on public.commission_snapshots as restrictive for all to anon,authenticated
 using ((private.has_staff_section('commission_admin') or (private.has_staff_section('commissions') and rep_id=(select id from public.team_members where auth_id=auth.uid() limit 1))))
 with check ((private.has_staff_section('commission_admin') or (private.has_staff_section('commissions') and rep_id=(select id from public.team_members where auth_id=auth.uid() limit 1))));

-- app_state is not a public configuration dump. Unknown keys default to Settings access.
create or replace function private.app_state_sections(p_key text)
returns text[] language sql immutable set search_path='' as $fn$
 select case
 when p_key='comm_rep_comp' then array['commission_admin']
 when p_key like 'comm_%' then array['commission_admin']
 when p_key='qb_config' or left(p_key,4)='_qb_' or left(p_key,4)='qbo_' then array['qb']
 when p_key like '_pimg_%' then array['products','inventory','orders','estimates']
 when p_key in ('company_info','portal_settings') then array['dashboard','orders','estimates','invoices','customers']
 when p_key in ('so_history') then array['orders']
 when p_key in ('est_history') then array['estimates']
 when p_key in ('batch_pos','batch_counter','batch_vendor_counters','submitted_batches') then array['batch_pos','orders']
 when p_key in ('inv_pos','inv_po_counter') then array['purchase_orders']
 when p_key='inv_adj_log' then array['inventory','warehouse']
 when p_key in ('omg_first_seen','omg_tax_remit') then array['omg']
 when p_key in ('active_art_timers','art_time_logs') then array['art']
 when p_key in ('active_timers') then array['production','jobs']
 when p_key in ('labor_rates','deco_rates','labor_costs') then array['financials']
 when p_key in ('job_time_logs') then array['production','jobs']
 when p_key in ('wh_recent_actions','wh_recent') then array['warehouse']
 when p_key like 'methodic%' then array['methodic']
 when p_key like 'marketing%' then array['marketing']
 else array['settings'] end;
$fn$;
revoke all on function private.app_state_sections(text) from public,anon;
grant execute on function private.app_state_sections(text) to anon,authenticated,service_role;
create policy portal_state_read on public.app_state as restrictive for select to anon,authenticated
 using ((select auth.uid()) is not null and private.has_any_staff_section(private.app_state_sections(id)));
create policy portal_state_insert on public.app_state as restrictive for insert to anon,authenticated with check (private.has_any_staff_section(private.app_state_sections(id)));
create policy portal_state_update on public.app_state as restrictive for update to anon,authenticated using (private.has_any_staff_section(private.app_state_sections(id))) with check (private.has_any_staff_section(private.app_state_sections(id)));
create policy portal_state_delete on public.app_state as restrictive for delete to anon,authenticated using (private.has_any_staff_section(private.app_state_sections(id)));
-- Coaches may read only the roster attached to explicitly granted customers, with verified email.
create or replace function private.coach_customer_allowed(p_customer_id text)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.coach_accounts c join auth.users u on u.id=auth.uid()
 where u.email_confirmed_at is not null and c.status in ('active','invited')
 and (c.auth_user_id=u.id or (c.auth_user_id is null and lower(c.email)=lower(u.email)))
 and (c.customer_id=p_customer_id or exists(select 1 from public.coach_customer_access a where a.coach_id=c.id and a.customer_id=p_customer_id)));
$fn$;
revoke all on function private.coach_customer_allowed(text) from public;
grant execute on function private.coach_customer_allowed(text) to anon,authenticated,service_role;
create or replace function private.coach_roster_allowed(p_team_id uuid)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.roster_teams t join public.roster_order_sessions s on s.id=t.session_id
 where t.id=p_team_id and private.coach_customer_allowed(s.customer_id));
$fn$;
revoke all on function private.coach_roster_allowed(uuid) from public;
grant execute on function private.coach_roster_allowed(uuid) to anon,authenticated,service_role;
drop policy portal_section_read on public.roster_order_sessions;
create policy portal_section_read on public.roster_order_sessions as restrictive for select to anon,authenticated using (private.has_any_staff_section(array['customers','orders']) or private.coach_customer_allowed(customer_id));
create policy coach_session_read on public.roster_order_sessions for select to authenticated using (private.coach_customer_allowed(customer_id));
drop policy portal_section_read on public.roster_teams;
create policy portal_section_read on public.roster_teams as restrictive for select to anon,authenticated using (private.has_any_staff_section(array['customers','orders']) or private.coach_roster_allowed(id));
create policy coach_team_read on public.roster_teams for select to authenticated using (private.coach_roster_allowed(id));
drop policy portal_section_read on public.roster_players;
create policy portal_section_read on public.roster_players as restrictive for select to anon,authenticated using (private.has_any_staff_section(array['customers','orders']) or private.coach_roster_allowed(team_id));
create policy coach_player_read on public.roster_players for select to authenticated using (private.coach_roster_allowed(team_id));
create or replace function private.coach_player_allowed(p_player_id uuid)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.roster_players p where p.id=p_player_id and private.coach_roster_allowed(p.team_id));
$fn$;
revoke all on function private.coach_player_allowed(uuid) from public;
grant execute on function private.coach_player_allowed(uuid) to anon,authenticated,service_role;
drop policy portal_section_read on public.roster_player_sizes;
create policy portal_section_read on public.roster_player_sizes as restrictive for select to anon,authenticated using (private.has_any_staff_section(array['customers','orders']) or private.coach_player_allowed(player_id));
create policy coach_size_read on public.roster_player_sizes for select to authenticated using (private.coach_player_allowed(player_id));
drop policy portal_section_read on public.roster_team_coaches;
create policy portal_section_read on public.roster_team_coaches as restrictive for select to anon,authenticated using (private.has_any_staff_section(array['customers','orders']) or private.coach_roster_allowed(team_id));
create policy coach_team_coach_read on public.roster_team_coaches for select to authenticated using (private.coach_roster_allowed(team_id));
drop policy portal_section_read on public.roster_kit_templates;
create policy portal_section_read on public.roster_kit_templates as restrictive for select to anon,authenticated using (private.has_any_staff_section(array['customers','orders']) or private.coach_customer_allowed(customer_id));
create policy coach_kit_read on public.roster_kit_templates for select to authenticated using (private.coach_customer_allowed(customer_id));
-- Keep the original coach-account self policy; intersect staff access with Customers.
drop policy portal_section_read on public.coach_accounts;
create policy portal_section_read on public.coach_accounts as restrictive for select to anon,authenticated
 using (private.has_staff_section('customers') or (auth.uid() is not null and (auth_user_id=auth.uid() or private.coach_customer_allowed(customer_id))));
-- History entries carry the document type; Orders access must not expose estimate history.
create policy portal_history_kind on public.document_history_snapshots as restrictive for select to authenticated
 using ((kind='so' and private.has_staff_section('orders')) or (kind='est' and private.has_staff_section('estimates')) or private.has_staff_section('backup'));
create or replace function public.staff_section_for_auth(p_auth_id uuid,p_page text)
returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.team_members t where t.auth_id=p_auth_id and t.is_active is not false and private.portal_section_allowed(t.id,t.role,t.access,p_page));
$fn$;
revoke all on function public.staff_section_for_auth(uuid,text) from public,anon,authenticated;
grant execute on function public.staff_section_for_auth(uuid,text) to service_role;
-- Preserve coach-owned saved drafts/favorites without granting access to staff-owned accounts.
do $coach$ declare t text; op text; begin
 foreach t in array array['coach_saved_orders','coach_favorite_items'] loop
  execute format('drop policy portal_section_read on public.%I',t);
  execute format('create policy portal_section_read on public.%I as restrictive for select to anon,authenticated using (private.has_staff_section(''customers'') or private.coach_customer_allowed(customer_id))',t);
  execute format('drop policy portal_section_insert on public.%I',t);
  execute format('create policy portal_section_insert on public.%I as restrictive for insert to anon,authenticated with check (private.has_staff_section(''customers'') or private.coach_customer_allowed(customer_id))',t);
  execute format('drop policy portal_section_update on public.%I',t);
  execute format('create policy portal_section_update on public.%I as restrictive for update to anon,authenticated using (private.has_staff_section(''customers'') or private.coach_customer_allowed(customer_id)) with check (private.has_staff_section(''customers'') or private.coach_customer_allowed(customer_id))',t);
  execute format('drop policy portal_section_delete on public.%I',t);
  execute format('create policy portal_section_delete on public.%I as restrictive for delete to anon,authenticated using (private.has_staff_section(''customers'') or private.coach_customer_allowed(customer_id))',t);
 end loop;
end $coach$;

-- Reduced admins cannot enumerate another user's privacy request.
create policy portal_deletion_request_read on public.account_deletion_requests as restrictive for select to authenticated
 using (auth_user_id=(select auth.uid()) or private.has_staff_section('team'));

create policy portal_omg_commission_scope on public.omg_store_commission_months as restrictive for select to anon,authenticated
 using (private.has_staff_section('commission_admin') or (private.has_staff_section('commissions') and rep_id=(select id from public.team_members where auth_id=auth.uid() limit 1)));
