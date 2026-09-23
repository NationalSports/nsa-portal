// ── The totals block every invoice document prints ──
//
// Seven document builders (both order editors' review + email copies, the invoices page's
// download / send / print copies, the customer detail page and the coach portal) used to
// carry their own hand-copied Subtotal / Shipping / Tax / Total / Paid / Balance markup.
// They drifted: NONE of them printed `cc_fee`, so the 66 invoices carrying a credit-card
// surcharge printed a totals block whose own numbers did not add up to the Total beneath
// them. One definition here means a component can never again be folded into the total but
// left off the document.
//
// `fmt` formats a number as a currency string — each caller passes its own, so the money
// on the page keeps that document's formatting.
const n = (v) => { const x = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(x) ? x : 0 };

// What the printed lines must add up to. Every component that moves the invoice's total
// belongs here AND in the rows below; a component in one but not the other is exactly the
// drift this module exists to prevent.
export const invoiceDocReconcile = ({ subtotal, shipping, tax, ccFee, credit, depositApplied, total }) => {
  const expected = n(subtotal) + n(shipping) + n(tax) + n(ccFee) - n(credit) - n(depositApplied);
  const diff = Math.round((expected - n(total)) * 100) / 100;
  // A cent of tolerance: each component is already rounded to the cent, so a sum of them
  // can sit a rounding step away from a total that was rounded once.
  return { expected, diff, ok: Math.abs(diff) <= 0.01 };
};

const blank = { value: '', style: 'border:none' };
const row = (label, value, opts = {}) => ({
  ...(opts._class ? { _class: opts._class } : {}),
  ...(opts._style ? { _style: opts._style } : {}),
  cells: [blank, blank, blank,
    { value: label, style: 'text-align:right' + (opts.plain ? ';border:none' : '') },
    { value, style: 'text-align:right' + (opts.plain ? ';border:none' : '') }],
});

// The totals rows, in print order. Optional components (shipping, tax, the card surcharge,
// an applied credit or deposit, a payment) print only when they are actually carrying money,
// so an ordinary invoice still reads as Subtotal / Total / Balance Due.
export const invoiceTotalsRows = ({ subtotal, shipping, tax, ccFee, credit, depositApplied, total, paid, balance }, fmt) => {
  const rec = invoiceDocReconcile({ subtotal, shipping, tax, ccFee, credit, depositApplied, total });
  const rows = [
    row('<strong>Subtotal</strong>', '<strong>' + fmt(n(subtotal)) + '</strong>',
      { _class: 'subtotal-row' }),
  ];
  const topBorder = 'text-align:right;border-top:2px solid #ccc;padding-top:8px';
  rows[0].cells[3].style = topBorder; rows[0].cells[4].style = topBorder;
  if (n(shipping) > 0) rows.push(row('<strong>Shipping</strong>', fmt(n(shipping)), { plain: true }));
  if (n(tax) > 0) rows.push(row('<strong>Tax</strong>', fmt(n(tax)), { plain: true }));
  // Folded into the invoice's total when a card payment was taken, so it has to print or
  // the customer cannot add the document up.
  if (n(ccFee) > 0) rows.push(row('<strong>Credit Card Fee</strong>', fmt(n(ccFee)), { plain: true }));
  if (n(credit) > 0) rows.push(row('<strong style="color:#065f46">Credit</strong>',
    '<strong style="color:#065f46">-' + fmt(n(credit)) + '</strong>', { plain: true }));
  if (n(depositApplied) > 0) rows.push(row('<strong style="color:#065f46">Deposit Applied</strong>',
    '<strong style="color:#065f46">-' + fmt(n(depositApplied)) + '</strong>', { plain: true }));
  // An invoice whose printed lines do not add up to its total is a bug in the document, not
  // a number the customer should be left to reconcile. Say so on the page rather than
  // printing a Total that silently contradicts the lines above it.
  if (!rec.ok) rows.push({
    _style: 'background:#fef2f2',
    cells: [blank, blank,
      { value: '<strong style="color:#dc2626">⚠ These amounts do not add up — do not send this invoice.</strong>'
        + '<br/><span style="font-size:10px;color:#991b1b">Lines and adjustments total ' + fmt(rec.expected)
        + ', but the invoice total is ' + fmt(n(total)) + '. Report this before sending.</span>' },
      { value: '<strong style="color:#dc2626">Off by</strong>', style: 'text-align:right' },
      { value: '<strong style="color:#dc2626">' + fmt(Math.abs(rec.diff)) + '</strong>', style: 'text-align:right' }],
  });
  rows.push(row('<strong>Total</strong>', '<strong style="font-size:14px">' + fmt(n(total)) + '</strong>',
    { _class: 'totals-row' }));
  if (n(paid) > 0) rows.push(row('<span style="color:#166534">Paid</span>',
    '<span style="color:#166534">' + fmt(n(paid)) + '</span>', { plain: true }));
  if (n(balance) > 0) rows.push(row('<strong style="color:#dc2626">Balance Due</strong>',
    '<strong style="color:#dc2626;font-size:14px">' + fmt(n(balance)) + '</strong>',
    { _style: 'background:#fef2f2' }));
  return rows;
};
