import fs from 'fs';
import path from 'path';

describe('QBO vendor-credit queries', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../QBPage.js'), 'utf8');

  test('uses the QBO VendorCredit entity for preflight and payable review', () => {
    expect(source).toContain("'Bill','VendorCredit','BillPayment'");
    expect(source).toContain("loadAllQBEntities(qbApi,'VendorCredit'");
    expect(source).not.toContain("loadAllQBEntities(qbApi,'BillCredit'");
  });
});
