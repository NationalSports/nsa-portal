const fs = require('fs');
const path = require('path');

describe('webstore report downloads', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Webstores.js'), 'utf8');

  test('player report is the established SO-scoped CSV export', () => {
    expect(source).toContain('const playerReport = useCallback(async () =>');
    expect(source).toContain('selectFulfillmentReportScope(lines)');
    expect(source).toContain('⬇ Player report CSV');
    expect(source).not.toContain('⬇ Player PDF');
  });

  test('product report is the SO-scoped Silver Screen XLSX', () => {
    expect(source).toContain('const productReport = useCallback(async () =>');
    expect(source).toContain("downloadSilverScreenFulfillment({ store: sel");
    expect(source).toContain('Create a batch / Sales Order before downloading the Silver Screen XLSX.');
    expect(source).not.toContain('⬇ Product PDF');
  });

  test('Players CSV reuses the established SO player CSV exporter', () => {
    expect(source).toContain('downloadPlayerReportCsv({ so: { id: scope.label }');
  });
});
