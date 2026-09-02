/** @jest-environment node */

import { allocateMoneyCents } from '../lib/bundleMoney';
import fs from 'fs';
import path from 'path';

const CLUB_BUNDLE_SQL = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/20260902063000_exact_club_bundle_cent_allocation.sql'),
  'utf8',
);

describe('bundle money allocation', () => {
  test('assigns the residual cent instead of losing it', () => {
    const out = allocateMoneyCents(100, [1, 1, 1]);
    expect(out).toEqual([33.34, 33.33, 33.33]);
    expect(out.reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(10000);
  });

  test('uses catalog weights but always reconciles to the parent cents', () => {
    const out = allocateMoneyCents(64.99, [60, 25, 15]);
    expect(out).toEqual([38.99, 16.25, 9.75]);
    expect(out.reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(6499);
  });

  test('falls back to an exact equal split when every weight is unknown', () => {
    expect(allocateMoneyCents(10, [0, 0, 0])).toEqual([3.34, 3.33, 3.33]);
  });

  test('is stable and exact across awkward totals and component counts', () => {
    for (let cents = 0; cents <= 500; cents += 1) {
      for (let count = 1; count <= 7; count += 1) {
        const out = allocateMoneyCents(cents / 100, Array.from({ length: count }, (_, i) => i + 1));
        expect(out).toHaveLength(count);
        expect(out.reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(cents);
      }
    }
  });
});

describe('club bundle SQL allocation', () => {
  test('uses deterministic largest-remainder integer-cent allocation', () => {
    expect(CLUB_BUNDLE_SQL).toMatch(/round\(coalesce\(bp\.parent_val, 0\) \* 100\)::bigint/i);
    expect(CLUB_BUNDLE_SQL).toMatch(/floor\(raw_cents\)::bigint/i);
    expect(CLUB_BUNDLE_SQL).toMatch(
      /row_number\(\) over \(partition by bpid order by fraction desc, item_id\)/i,
    );
    expect(CLUB_BUNDLE_SQL).toMatch(/residual_rank <= residual_cents/i);
  });

  test('preserves guarded transfer auto-art and service-only access', () => {
    expect(CLUB_BUNDLE_SQL).toMatch(/v_xfer_ready/i);
    expect(CLUB_BUNDLE_SQL).toMatch(/security definer[\s\S]*set search_path = public/i);
    expect(CLUB_BUNDLE_SQL).toMatch(
      /revoke all on function public\.create_club_sales_order\(uuid\) from authenticated/i,
    );
    expect(CLUB_BUNDLE_SQL).toMatch(
      /grant execute on function public\.create_club_sales_order\(uuid\) to service_role/i,
    );
  });
});
