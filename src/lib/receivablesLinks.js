// Shared by the receivables UI and the Friday email renderer.
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number(value || 0).toLocaleString('en-US', {style:'currency', currency:'USD'});

function salesOrderUrl(portal, id) {
  return `${portal.replace(/\/+$/, '')}/?${new URLSearchParams({pg:'orders', so:id})}`;
}

function pastDueInvoicesUrl(portal, repId) {
  return `${portal.replace(/\/+$/, '')}/?${new URLSearchParams({pg:'invoices', aging:'overdue', rep:repId || 'all'})}`;
}

function invoiceFiltersFromSearch(search, defaultRep) {
  const params = new URLSearchParams(search || '');
  const overdue = params.get('pg') === 'invoices' && params.get('aging') === 'overdue';
  return {search:'', status:'open', group:overdue?'list':'customer', aging:overdue?'overdue':'all', rep:overdue?(params.get('rep') || defaultRep):defaultRep};
}

function readyOrdersEmail({rep, rows, portal}) {
  // Always scope again at the email boundary, independently of UI filters.
  const orders = rows.filter(row => row.repId === rep.id);
  const total = orders.reduce((sum, row) => sum + row.openToInvoice, 0);
  const subject = `Ready to invoice — ${orders.length} orders · ${money(total)}`;
  const textContent = `Hi ${rep.name},\n\nYour ready-to-invoice orders (${money(total)} left to invoice):\n\n` + orders.map(row => `${row.id} · ${row.customerName} · ${row.memo || ''}\n${money(row.openToInvoice)} left to invoice · ${row.ageDays == null ? 'Age unavailable' : row.ageDays+' days old'}\n${salesOrderUrl(portal, row.id)}`).join('\n\n');
  const htmlContent = `<p>Hi ${escapeHtml(rep.name)},</p><p>You have ${orders.length} ready-to-invoice orders with <b>${money(total)}</b> left to invoice, including estimated tax. Open each order to review and create or correct its invoice.</p><table width="100%" style="border-collapse:collapse"><thead><tr><th align="left">Order / account</th><th align="right">Left to invoice</th></tr></thead><tbody>` + orders.map(row => `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0"><a href="${escapeHtml(salesOrderUrl(portal, row.id))}">${escapeHtml(row.id)}</a> · ${escapeHtml(row.customerName)}<br/>${escapeHtml(row.memo)}<br/>${row.ageDays == null ? 'Age unavailable' : row.ageDays+' days old'}</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e2e8f0">${money(row.openToInvoice)}</td></tr>`).join('') + '</tbody></table>';
  return {subject, textContent, htmlContent};
}

module.exports = {salesOrderUrl, pastDueInvoicesUrl, invoiceFiltersFromSearch, readyOrdersEmail};
