import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/00197_comm_rep_comp_admin_only.sql'),
  'utf8',
);
const commissionsPage = fs.readFileSync(path.join(root, 'src/CommissionsPage.js'), 'utf8');

describe('commission settings authorization', () => {
  test('a non-admin is rejected by both direct-table RLS and the CAS write RPC', () => {
    expect(migration).toMatch(/tm\.role in \('admin','super_admin'\)/);
    expect(migration).toMatch(
      /for all to authenticated[\s\S]*id <> 'comm_rep_comp' or public\.is_admin_member\(\)[\s\S]*with check[\s\S]*id <> 'comm_rep_comp' or public\.is_admin_member\(\)/,
    );
    expect(migration).toMatch(
      /if p_key = 'comm_rep_comp' and not public\.is_admin_member\(\) then[\s\S]*raise exception 'app_state_cas: admin only/,
    );
  });

  test('the commission UI has no unversioned app_state write fallback', () => {
    expect(commissionsPage).toContain("supabase.rpc('app_state_cas'");
    expect(commissionsPage).not.toMatch(
      /from\('app_state'\)\.upsert\(\{id:'comm_rep_comp'/,
    );
  });
});
