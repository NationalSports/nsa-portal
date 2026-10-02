const {salesOrderUrl, pastDueInvoicesUrl, invoiceFiltersFromSearch, readyOrdersEmail} = require('../lib/receivablesLinks');

test('Friday full-list link opens the overdue invoice list for the intended rep', () => {
  const url = new URL(pastDueInvoicesUrl('https://connect.nationalsportsapparel.com/', 'R 1'));
  expect(url.searchParams.get('pg')).toBe('invoices');
  expect(invoiceFiltersFromSearch(url.search, 'R2')).toEqual({search:'', status:'open', group:'list', aging:'overdue', rep:'R 1'});
});

test('ordinary navigation keeps the existing invoice defaults', () => {
  expect(invoiceFiltersFromSearch('?pg=reports&rep=R2&aging=overdue', 'R1')).toEqual({search:'', status:'open', group:'customer', aging:'all', rep:'R1'});
});

test('order links encode IDs and open the orders section', () => {
  const url = new URL(salesOrderUrl('https://connect.nationalsportsapparel.com', 'SO-1 & 2'));
  expect(url.searchParams.get('pg')).toBe('orders');
  expect(url.searchParams.get('so')).toBe('SO-1 & 2');
});

test('a rep email contains only their orders, totals, and safe clickable links', () => {
  const email = readyOrdersEmail({rep:{id:'R1', name:'Rep <One>'}, portal:'https://connect.nationalsportsapparel.com', rows:[
    {id:'SO-1', repId:'R1', customerName:'Alpha & Beta', memo:'<script>bad</script>', ageDays:42, openToInvoice:750.25},
    {id:'SO-2', repId:'R2', customerName:'Another rep account', openToInvoice:999},
  ]});
  expect(email.subject).toContain('$750.25');
  expect(email.htmlContent).toContain('Alpha &amp; Beta');
  expect(email.htmlContent).toContain('&lt;script&gt;');
  expect(email.htmlContent).toContain('href="https://connect.nationalsportsapparel.com/?pg=orders&amp;so=SO-1"');
  expect(email.textContent).toContain('https://connect.nationalsportsapparel.com/?pg=orders&so=SO-1');
  expect(email.htmlContent).not.toContain('Another rep account');
  expect(email.textContent).not.toContain('SO-2');
});
