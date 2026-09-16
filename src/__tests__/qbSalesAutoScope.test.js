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

test('browser scheduler is disabled when the server owns sales automation',()=>{
  const app=read('App.js');
  expect(app).toContain('createQBSyncEngine(_qbSyncCtxRef.current).syncSalesAuto()');
  expect(app).not.toContain('createQBSyncEngine(_qbSyncCtxRef.current).syncAll()');
  expect(app).toContain('qbConfig.backgroundSalesAutomation===true');
  expect(app).toContain('qbConfig.browserSalesRunnerDisabled===true');
});

test('real-time remains locked and the browser becomes status-only',()=>{
  const page=read('QBPage.js');
  expect(page).toContain("const disabled=serverManaged||v==='realtime'||(v!=='manual'&&!migrationUnlocked)");
  expect(page).toContain('The server owns hourly customer, invoice and verified-payment automation');
  expect(page).toContain('Purchasing, bills, products and inventory remain locked');
});

test('the browser QBO proxy rejects competing sales writes after cutover',()=>{
  const proxy=fs.readFileSync(path.join(__dirname,'..','..','netlify','functions','qb-api.js'),'utf8');
  expect(proxy).toContain("['upsert_customer', 'upsert_invoice', 'upsert_payment'].includes(action)");
  expect(proxy).toContain('Background server sales automation owns customer, invoice, and payment writes.');
});
