const fs = require('fs');
const path = require('path');
const sync = require('../../netlify/functions/omg-order-sync-background')._test;

describe('OMG operational order sync', () => {
  test('groups the unfiltered order feed by explicit sale relationship', () => {
    const rows = [
      { id: 'o1', relationships: { sale: { data: { id: 'sale_6PH2A' } }, customer_info: { data: { id: 'c1' } } } },
      { id: 'o2', relationships: { sale: { data: { id: '6ph2a' } }, customer_info: { data: { id: 'c1' } } } },
      { id: 'o3', relationships: { sale: { data: { id: 'sale_P7E6D' } }, customer_info: { data: { id: 'c2' } } } },
    ];
    const result = sync.summarizeOrders(rows);
    expect(result.get('6PH2A')).toEqual({ orders: 2, uniqueBuyers: 1 });
    expect(result.get('P7E6D')).toEqual({ orders: 1, uniqueBuyers: 1 });
  });

  test('fills stable sale id and refresh metadata without touching money', () => {
    const result = sync.buildStoreUpdate({ _omg_sale_code: '6PH2A', _omg_id: null, orders: 0 }, { orders: 16, uniqueBuyers: 15 }, '2026-09-03T14:00:00.000Z');
    expect(result).toEqual({
      held: false,
      values: { orders: 16, unique_buyers: 15, _omg_id: 'sale_6PH2A', _last_synced: '2026-09-03T14:00:00.000Z' },
    });
    expect(result.values).not.toHaveProperty('total_sales');
    expect(result.values).not.toHaveProperty('net_profit');
  });

  test('holds a regressive count instead of erasing known orders', () => {
    const result = sync.buildStoreUpdate({ _omg_sale_code: '6PH2A', orders: 16 }, { orders: 2, uniqueBuyers: 2 }, '2026-09-03T14:00:00.000Z');
    expect(result.held).toBe(true);
    expect(result.reason).toMatch(/preserved stored values/);
  });

  test('production wiring stays isolated from accounting tables', () => {
    const fn = fs.readFileSync(path.join(__dirname, '../../netlify/functions/omg-order-sync-background.js'), 'utf8');
    const cron = fs.readFileSync(path.join(__dirname, '../../netlify/functions/omg-order-sync-cron.js'), 'utf8');
    const config = fs.readFileSync(path.join(__dirname, '../../netlify.toml'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
    expect(fn).not.toMatch(/omg_store_profit_snapshots|omg_store_commission_months|omg_store_profit_daily_snapshots/);
    expect(cron).toContain('/.netlify/functions/omg-order-sync-background');
    expect(config).toContain('[functions."omg-order-sync-cron"]');
    expect(config).toContain('schedule = "15 8 * * *"');
    expect(app).toContain("authFetch('/.netlify/functions/omg-order-sync-background'");
    expect(app).toContain('Sync 24/7 orders now');
  });
});
