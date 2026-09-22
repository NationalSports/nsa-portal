// Match the rep shown on the portal's quote/order lists: the customer's current
// primary rep, falling back to the document creator. Admin/CSR roles do not
// expand this personal notification scope. Filtering never deletes a draft.
export function createRepSaveNoticeFilter({repId, customers = [], salesOrders = [], estimates = [], invoices = []}) {
  const customerById = new Map(customers.map(row => [String(row.id), row]));
  const documents = {
    sales_orders: new Map(salesOrders.map(row => [String(row.id), row])),
    estimates: new Map(estimates.map(row => [String(row.id), row])),
    invoices: new Map(invoices.map(row => [String(row.id), row])),
  };
  return entry => {
    if (!repId || !entry) return false;
    const rawId = String(entry.id || entry.payload?.id || '');
    const id = rawId.startsWith('memo:') ? rawId.slice(5) : rawId;
    let table = entry.table;
    if (table === 'sales_order_memos') table = 'sales_orders';
    if (!table) table = id.startsWith('SO-') ? 'sales_orders' : id.startsWith('EST-') ? 'estimates' : id.startsWith('INV-') ? 'invoices' : null;
    // Leave non-document failures (for example product edits) in their existing
    // session scope; they do not have a sales-rep assignment.
    if (!documents[table]) return true;
    const document = documents[table].get(id) || entry.payload;
    if (!document) return false;
    const customer = customerById.get(String(document.customer_id));
    const assignedRep = customer?.primary_rep_id || document.created_by;
    return Boolean(assignedRep) && String(assignedRep) === String(repId);
  };
}
