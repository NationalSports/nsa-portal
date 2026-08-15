/* Club transfer auto-art (migration 00235) characterization.
 *
 * Static pins over the migration SQL, following clubStoreSoConversion
 * .characterization.test.js's approach: the club conversion RPC births
 * 'xfer:<code>' heat-transfer jobs art_complete when (and only when) the store
 * has a webstore_transfers row for that code, and stamps auto_art in the
 * job_stage_events payload so the 00208 auto-release sweep's 'auto_art_only'
 * scope covers these jobs. A transfer job never carries an art-library file, so
 * art_file_id/_art_ids must stay keyed to v_auto_art alone.
 */
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/00235_club_transfer_auto_art.sql'),
  'utf8'
);

describe('00235 club transfer auto-art', () => {
  test('replaces create_club_sales_order and stays service_role-only', () => {
    expect(SQL).toMatch(/create or replace function public\.create_club_sales_order/);
    expect(SQL).toMatch(/grant execute on function public\.create_club_sales_order\(uuid\) to service_role;/);
    expect(SQL).toMatch(/revoke all on function public\.create_club_sales_order\(uuid\) from anon;/);
  });

  test('v_xfer_ready requires an existing webstore_transfers row for THIS store + code', () => {
    expect(SQL).toMatch(/v_xfer_ready := v_job\.logo_ref like 'xfer:%'/);
    expect(SQL).toMatch(/from webstore_transfers t\s*\n\s*where t\.store_id = v_ord\.store_id\s*\n\s*and t\.code = substring\(v_job\.logo_ref from 6\)/);
  });

  test('birth art_status and event include v_xfer_ready; payload flags auto_art for the sweep', () => {
    const birth = /case when v_auto_art or v_xfer_ready then 'art_complete' else 'needs_art' end/g;
    // Once in the so_jobs INSERT, once in the job_stage_events to_state.
    expect((SQL.match(birth) || []).length).toBe(2);
    expect(SQL).toMatch(/'auto_art', v_auto_art or v_xfer_ready/);
    expect(SQL).toMatch(/'xfer_ready', v_xfer_ready/);
  });

  test('art_file_id/_art_ids/art_name stay keyed to v_auto_art only (no fake art file for transfers)', () => {
    expect(SQL).toMatch(/case when v_auto_art then v_art_id else null end,\s*\n\s*case when v_auto_art then jsonb_build_array\(v_art_id\) else '\[\]'::jsonb end/);
    expect(SQL).toMatch(/'art_file_id', case when v_auto_art then v_art_id else null end/);
  });

  test('the logo auto-art predicate keeps 00219 tightened form (no loose prod_files-non-empty arm)', () => {
    // prod_files_attached explicit true, or approved embroidery with a .dst —
    // the "jsonb_array_length(prod_files) > 0" arm 00219 removed must not return.
    expect(SQL).toMatch(/\(v_art_entry->>'prod_files_attached'\)::boolean is true/);
    expect(SQL).not.toMatch(/jsonb_array_length\(coalesce\(v_art_entry->'prod_files', '\[\]'::jsonb\)\) > 0/);
  });
});
