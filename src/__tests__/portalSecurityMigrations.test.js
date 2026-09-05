const fs = require('fs');
const path = require('path');

const migration = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', name), 'utf8');

describe('portal security migrations', () => {
  const credentials = migration('20260904224715_portal_access_credentials.sql');
  const lockdown = migration('20260904224722_lock_core_reads_to_staff.sql');
  const appState = migration('20260904230554_restrict_public_app_state.sql');

  test('stores only domain-separated credential hashes and does not rotate customer data', () => {
    expect(credentials).toContain("'portal-legacy-v1:' || lower(btrim(c.alpha_tag))");
    expect(credentials).toContain("credential_kind in ('legacy_alpha_tag', 'token')");
    expect(credentials).toContain('revoke all on public.portal_access_credentials from public, anon, authenticated');
    expect(credentials).not.toMatch(/update\s+public\.customers/i);
  });

  test('drops the live policy set, revokes anon grants, and retains staff authorization', () => {
    expect(lockdown).toContain("select policyname from pg_policies");
    expect(lockdown).toContain("revoke all on public.%I from public, anon");
    expect(lockdown).toContain('to authenticated using ((select public.is_team_member()))');
    expect(lockdown).toContain('revoke all on function public.search_customers');
    expect(lockdown).toContain("has_table_privilege('anon'");
  });

  test('limits public app_state reads to non-sensitive portal configuration', () => {
    expect(appState).toContain("id in ('company_info', 'portal_settings')");
    expect(appState).toContain('drop policy if exists app_state_read');
    expect(appState).not.toContain('drop policy if exists app_state_staff_write');
  });
});
