/* Printable job tickets (src/teamshopqueue/ticket.js): scan-code derivation
 * (same DG/DST families _jobScanResolver resolves), the print-ready HTML with
 * its inline Code 128 barcode SVG (barcodeSvg from utils — jsbarcode, an
 * existing dependency), and the open→write→print window flow.
 * Canvas stub matches embDesigns.test.js: jsdom has no canvas and JsBarcode
 * only uses it to measure label text. */

const { ticketCodeFor, buildTicketHtml, openTicket } = require('../teamshopqueue/ticket');

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: String(t || '').length * 7 }) });
});

const ARTS = [
  {
    so_id: 'SO-1', id: 'a1', name: 'Eagles',
    prod_files: [{ name: 'EAGLES_DG12345.dst', url: 'https://cdn/EAGLES_DG12345.dst' }],
    files: [{ name: 'eagles.png', url: 'https://cdn/eagles.png' }],
  },
  { so_id: 'SO-1', id: 'a2', name: 'Other art', prod_files: [], files: [] },
];

const EMB_JOB = {
  so_id: 'SO-1', id: 'JOB-1', art_file_id: 'a1', _art_ids: null,
  art_name: 'Eagles LC', deco_type: 'embroidery', positions: 'Left Chest', total_units: 24,
};

describe('ticketCodeFor', () => {
  test('prefers the DG code, reports the DST filename', () => {
    expect(ticketCodeFor(EMB_JOB, ARTS)).toEqual({ code: 'DG12345', dst: 'EAGLES_DG12345.dst' });
  });
  test('falls back to the DST filename when files carry no DG number', () => {
    const arts = [{ so_id: 'SO-1', id: 'a1', name: 'Eagles', prod_files: [{ name: 'EAGLES.dst', url: 'u' }], files: [] }];
    expect(ticketCodeFor(EMB_JOB, arts)).toEqual({ code: 'EAGLES.dst', dst: 'EAGLES.dst' });
  });
  test('null when the job has nothing scannable yet', () => {
    expect(ticketCodeFor({ ...EMB_JOB, art_file_id: 'a2' }, ARTS)).toEqual({ code: null, dst: null });
  });
  test('only reads arts linked to THIS job on THIS so (art ids repeat across SOs)', () => {
    const foreign = [{ so_id: 'SO-2', id: 'a1', name: 'x', prod_files: [{ name: 'WRONG_DG777777.dst', url: 'u' }], files: [] }];
    expect(ticketCodeFor(EMB_JOB, foreign)).toEqual({ code: null, dst: null });
  });
});

describe('buildTicketHtml', () => {
  test('renders a Code 128 barcode SVG for the DG code plus the job facts', () => {
    const html = buildTicketHtml(EMB_JOB, { buyer_name: 'Coach Jones' }, ARTS);
    expect(html).toContain('<svg'); // real jsbarcode output, not a placeholder
    expect(html).toContain('DG12345'); // barcode label text
    expect(html).toContain('SO-1');
    expect(html).toContain('JOB-1');
    expect(html).toContain('Eagles LC');
    expect(html).toContain('embroidery');
    expect(html).toContain('Left Chest');
    expect(html).toContain('24');
    expect(html).toContain('EAGLES_DG12345.dst'); // DST filename on embroidery tickets
    expect(html).toContain('Coach Jones');
  });
  test('non-embroidery ticket has no DST row; no code → loud no-code note, no svg', () => {
    const dtfJob = { ...EMB_JOB, deco_type: 'dtf', art_file_id: 'a2' };
    const html = buildTicketHtml(dtfJob, null, ARTS);
    expect(html).not.toContain('class="lbl">DST file'); // no DST row (the no-code note may mention DSTs)
    expect(html).not.toContain('<svg');
    expect(html).toContain('No scan code yet');
  });
  test('escapes HTML in job fields', () => {
    const html = buildTicketHtml({ ...EMB_JOB, art_name: '<script>x</script>' }, null, ARTS);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('openTicket', () => {
  test('writes the ticket into a new window and returns false when blocked', () => {
    const w = { document: { write: jest.fn(), close: jest.fn() }, focus: jest.fn(), print: jest.fn() };
    const openSpy = jest.spyOn(window, 'open').mockReturnValue(w);
    expect(openTicket(EMB_JOB, null, ARTS)).toBe(true);
    expect(w.document.write).toHaveBeenCalledWith(expect.stringContaining('DG12345'));
    openSpy.mockReturnValue(null); // popup blocked
    expect(openTicket(EMB_JOB, null, ARTS)).toBe(false);
    openSpy.mockRestore();
  });
});
