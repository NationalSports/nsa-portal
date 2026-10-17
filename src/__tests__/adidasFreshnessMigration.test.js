import fs from 'fs';
import path from 'path';

test('projects only successful adidas sync finish times to the browser-readable table', () => {
  const sql = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20261017170511_adidas_click_cart_planning.sql',
  ), 'utf8');

  expect(sql).toContain('create table if not exists public.adidas_inventory_freshness');
  expect(sql).toContain("new.status in ('success', 'completed')");
  expect(sql).toContain('new.error_count = 0');
  expect(sql).toContain('new.finished_at is not null');
  expect(sql).toContain('trg_adidas_inventory_run_freshness');
  expect(sql).toContain('create or replace function public.refresh_adidas_inventory_freshness()');
  expect(sql).toContain("'refresh-adidas-inventory-freshness'");
  expect(sql).toContain("'*/15 * * * *'");
  expect(sql).toContain('grant select on table public.adidas_inventory_freshness to anon, authenticated');
  expect(sql).not.toContain('grant select on table public.adidas_inventory_sync_runs to anon');
});
