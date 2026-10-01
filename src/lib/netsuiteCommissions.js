const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const text = value => value == null ? '' : String(value).trim();
const keyOf = value => text(value).toLowerCase().replace(/^invoice\s*#\s*/i, '').replace(/\s+/g, ' ');

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(EXCEL_EPOCH + Math.floor(value) * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = text(value);
  if (!s) return null;
  // Excel exports often stringify the serial; only treat integer-like values as serials.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 0 && n < 100000) return parseDate(n);
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
      ? d.toISOString().slice(0, 10) : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const parts = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    const calendar = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
    if (calendar.getUTCFullYear() !== +parts[1] || calendar.getUTCMonth() !== +parts[2] - 1 || calendar.getUTCDate() !== +parts[3]) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    const d = new Date(Date.UTC(year, +m[1] - 1, +m[2]));
    return d.getUTCFullYear() === year && d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2]
      ? d.toISOString().slice(0, 10) : null;
  }
  return null;
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = text(value);
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/[$,\s]/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
}

const cents = n => Math.sign(n) * Math.round((Math.abs(n) + 1e-9) * 100) / 100;
const isoMonth = iso => iso.slice(0, 7);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Convert paid-in-full NetSuite invoice line exports into invoice-level commission rows. */
export function buildNetSuiteInvoices(rawRows) {
  const errors = [];
  const groups = new Map();
  const seen = new Set();
  (Array.isArray(rawRows) ? rawRows : []).forEach((row, index) => {
    const r = row || {};
    const invoice = text(r['Invoice #']).replace(/^invoice\s*#\s*/i, '').trim().toUpperCase();
    const groupKey = keyOf(invoice) || `__invalid_row_${index + 1}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { rows: [], invalid: false, invoice: invoice || '(missing invoice #)' });
    const group = groups.get(groupKey);
    const signature = JSON.stringify(Object.keys(r).sort().map(k => [k, r[k] instanceof Date ? (Number.isNaN(r[k].getTime()) ? 'Invalid Date' : r[k].toISOString()) : r[k]]));
    if (seen.has(signature)) {
      errors.push(`Row ${index + 2} (${group.invoice}): duplicate source row; invoice excluded.`);
      group.invalid = true;
      return;
    }
    seen.add(signature);

    const problems = [];
    const fields = ['Internal ID', 'SO #', 'Company Name', 'Invoice #', 'Invoice Status', 'Invoice Date', 'Date of Full Payment', 'Sales Rep', 'Item'];
    fields.forEach(f => { if (!text(r[f])) problems.push(`missing ${f}`); });
    if (text(r['Invoice Status']).toLowerCase() !== 'paid in full') problems.push('Invoice Status must be Paid In Full');
    const invoiceDate = parseDate(r['Invoice Date']);
    const paidDate = parseDate(r['Date of Full Payment']);
    if (text(r['Invoice Date']) && !invoiceDate) problems.push('invalid Invoice Date');
    if (text(r['Date of Full Payment']) && !paidDate) problems.push('invalid Date of Full Payment');
    if (invoiceDate && paidDate && paidDate < invoiceDate) problems.push('Date of Full Payment precedes Invoice Date');
    const quantity = parseAmount(r.Quantity);
    const soAmount = parseAmount(r['SO Amount']);
    const revenue = parseAmount(r['Invoice Amount']);
    const cost = parseAmount(r['PO Amount']);
    if (quantity == null) problems.push('missing or invalid Quantity');
    if (soAmount == null) problems.push('missing or invalid SO Amount');
    if (revenue == null) problems.push('missing or invalid Invoice Amount');
    if (cost == null) problems.push('missing or invalid PO Amount (use 0 when there is no PO cost)');
    if (problems.length) {
      errors.push(`Row ${index + 2} (${group.invoice}): ${problems.join(', ')}; invoice excluded.`);
      group.invalid = true;
      return;
    }
    const normalized = {
      soNumber: text(r['SO #']), customer: text(r['Company Name']), repName: text(r['Sales Rep']), invoiceDate, paidDate,
    };
    if (group.rows.length) {
      const first = group.rows[0].normalized;
      const changed = Object.keys(normalized).filter(k => normalized[k].toLowerCase() !== first[k].toLowerCase());
      if (changed.length) {
        errors.push(`Row ${index + 2} (${group.invoice}): ${changed.join(', ')} differs within invoice; invoice excluded.`);
        group.invalid = true;
      }
    }
    group.rows.push({ source: r, normalized, quantity, revenue, cost });
  });

  const invoices = [];
  groups.forEach(group => {
    if (group.invalid || !group.rows.length) return;
    const first = group.rows[0];
    const revenue = cents(group.rows.reduce((sum, line) => sum + line.revenue, 0));
    const cost = cents(group.rows.reduce((sum, line) => sum + line.cost, 0));
    const gp = cents(revenue - cost);
    const daysToPay = dayDiff(first.normalized.invoiceDate, first.normalized.paidDate);
    invoices.push({
      id: group.invoice,
      soNumber: first.normalized.soNumber,
      customer: first.normalized.customer,
      repName: first.normalized.repName,
      invoiceDate: first.normalized.invoiceDate,
      paidDate: first.normalized.paidDate,
      month: isoMonth(first.normalized.paidDate),
      revenue,
      cost,
      gp,
      marginPct: revenue === 0 ? null : gp / revenue * 100,
      daysToPay,
      rate: daysToPay > 90 ? 0.15 : 0.30,
      commission: cents(gp * (daysToPay > 90 ? 0.15 : 0.30)),
      items: group.rows.map(line => ({
        item: text(line.source.Item), quantity: line.quantity, revenue: cents(line.revenue), cost: cents(line.cost), poNumber: text(line.source['Purchase Order']),
      })),
    });
  });
  return { invoices, errors };
}

export { parseDate as parseNetSuiteCommissionDate };
