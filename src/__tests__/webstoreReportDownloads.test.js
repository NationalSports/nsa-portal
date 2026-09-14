const fs = require('fs');
const path = require('path');

describe('webstore report downloads', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Webstores.js'), 'utf8');

  test('player report is the established SO-scoped CSV export', () => {
    expect(source).toContain('const playerReport = useCallback(async () =>');
    expect(source).toContain('selectFulfillmentReportScope(lines)');
  });

  test('product report is the SO-scoped Silver Screen XLSX', () => {
    expect(source).toContain('const productReport = useCallback(async () =>');
    expect(source).toContain("downloadSilverScreenFulfillment({ store: sel");
    expect(source).toContain('Create a batch / Sales Order before downloading the Silver Screen XLSX.');
  });

  test('Players CSV reuses the established SO player CSV exporter', () => {
    expect(source).toContain('downloadPlayerReportCsv({ so: { id: scope.label }');
  });

  // The three per-player handoffs live behind ONE "Player Report" control, and the
  // standalone CSV button is gone. A second entry point is how the formats drift.
  test('Player Report is a single dropdown offering PDF, CSV and Silver Screen XLSX', () => {
    expect(source).toContain('<option value="">👥 Player Report…</option>');
    expect(source).toContain('<option value="pdf">📄 Packing slips PDF</option>');
    expect(source).toContain('<option value="csv">⬇ Player CSV</option>');
    expect(source).toContain('<option value="xlsx">🏷️ Silver Screen XLSX</option>');
    expect(source).not.toContain('⬇ Player report CSV');
  });

  // The PDF must carry the same scope + blocking checks as the CSV, or the paper the
  // packer works from can claim a player is owed something the file says they are not.
  test('packing-slip PDF is gated by the same scope and blocking checks as the CSV', () => {
    const fn = source.slice(source.indexOf('const playerReportPdf = useCallback'));
    const body = fn.slice(0, fn.indexOf('}, [sel, detail, gatherAll, flash]);'));
    expect(body).toContain('selectFulfillmentReportScope(lines)');
    expect(body).toContain('reportBlockingIssues(audit)');
    expect(body).toContain('buildPlayerReport(sel, scope.lines, orderById, roster, stockByPid, audit, scope.label)');
  });

  // One slip per player, page-broken — that is what "as if packing slips" means here.
  test('player report renders one page-broken slip per player', () => {
    const fn = source.slice(source.indexOf('function buildPlayerReport('));
    const body = fn.slice(0, fn.indexOf('\nfunction madeToOrderPids'));
    expect(body).toContain('page-break-after:always');
    expect(body).toContain('${cover}${list.map(slip).join(\'\')}');
  });
});
