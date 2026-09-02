import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260901183337_atomic_omg_product_replace.sql'), 'utf8');

describe('atomic OMG product replacement migration', () => {
  test('runs with caller permissions and a locked-down search path', () => {
    expect(sql).toMatch(/security\s+invoker/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(sql).not.toMatch(/security\s+definer/i);
  });

  test('is staff-authenticated and not executable by public or anon', () => {
    expect(sql).toMatch(/auth\.uid\(\)\s+is\s+null\s+or\s+not\s+public\.is_team_member\(\)/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.replace_omg_store_products\(text,\s*jsonb\)\s+from\s+public,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.replace_omg_store_products\(text,\s*jsonb\)\s+to\s+authenticated/i);
  });

  test('serializes each store and replaces its rows inside one function call', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\(p_store_id\)\)/i);
    const deleteAt = sql.search(/delete\s+from\s+public\.omg_store_products/i);
    const insertAt = sql.search(/insert\s+into\s+public\.omg_store_products/i);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(deleteAt);
  });
});
