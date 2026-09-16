const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('automatic QBO runner is limited to customers, invoices and payments',()=>{
  const engine=read('qbSyncEngine.js');
  const start=engine.indexOf('const syncSalesAuto=async()=>');
  const end=engine.indexOf('// ── SYNC ALL ──',start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const scoped=engine.slice(start,end);
  expect(scoped).toContain('syncCustomers()');
  expect(scoped).toContain('syncInvoices(');
  expect(scoped).toContain('syncPaidFromQB()');
  expect(scoped).not.toMatch(/syncSalesOrders|syncPurchaseOrders|syncBillsFromQB|syncInventory/);
});

test('browser scheduler uses the scoped sales runner',()=>{
  const app=read('App.js');
  expect(app).toContain('createQBSyncEngine(_qbSyncCtxRef.current).syncSalesAuto()');
  expect(app).not.toContain('createQBSyncEngine(_qbSyncCtxRef.current).syncAll()');
});

test('real-time remains locked while reviewed hourly and daily modes are available',()=>{
  const page=read('QBPage.js');
  expect(page).toContain("const disabled=v==='realtime'||(v!=='manual'&&!migrationUnlocked)");
  expect(page).toContain('Purchasing, bills, products and inventory remain locked');
});
