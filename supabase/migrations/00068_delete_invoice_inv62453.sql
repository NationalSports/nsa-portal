-- One-off cleanup: remove invoice INV62453 from customer_invoices.
-- Already voided/deleted in NetSuite, so the next sync won't re-create it.
-- Scoped to type='invoice' because document_number is not unique
-- (credit memos can share numbers).
DELETE FROM customer_invoices
WHERE document_number = 'INV62453'
  AND type = 'invoice';
