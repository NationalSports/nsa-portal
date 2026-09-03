/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('webstore delivery window → sales order due date', () => {
  const webstores = read('src/Webstores.js');
  const app = read('src/App.js');
  const migration = read('supabase/migrations/20260903201521_add_webstore_delivery_window.sql');

  test('the staff batch path passes its calculated date into SO creation', () => {
    expect(webstores).toMatch(/const expectedDate = salesOrderDueDate\(sel\.close_at, sel\.delivery_window_weeks\)/);
    expect(webstores).toMatch(/onCreateSO\([\s\S]{0,1000}expected_date: expectedDate/);
    expect(app).toMatch(/webstoreCreateSO=async\(\{[^}]*expected_date/);
    expect(app).toMatch(/expected_date:expected_date\|\|''/);
  });

  test('the database fills every other webstore SO creation path', () => {
    expect(migration).toMatch(/before insert or update of webstore_id on public\.sales_orders/i);
    expect(migration).toMatch(/v_close_at at time zone 'America\/Los_Angeles'/i);
    expect(migration).toMatch(/split_part\(coalesce\(v_window, '4-5'\), '-', 2\)::integer \* 7/i);
    expect(migration).toMatch(/nullif\(btrim\(coalesce\(new\.expected_date, ''\)\), ''\) is not null/i);
  });
});
