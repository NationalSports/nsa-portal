-- Portal staff (team_members linked via auth_id) can manage coach accounts
-- from the portal UI. Coaches keep self-read only (00112).
CREATE POLICY coach_accounts_staff_all ON public.coach_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.auth_id = auth.uid() AND COALESCE(tm.is_active, true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.auth_id = auth.uid() AND COALESCE(tm.is_active, true)));
