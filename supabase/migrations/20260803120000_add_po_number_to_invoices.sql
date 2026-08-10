-- School / customer PO number on invoices.
-- Sales orders already carry po_number (00022_alt_billing_and_po_number.sql); invoices only
-- inherited it transiently from the linked SO (inv._po_number, never persisted) and had no way
-- to set one directly — a problem for standalone invoices and for schools that issue their PO at
-- invoicing time. Add the column so an invoice can hold its own PO, shown on the invoice PDF.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_number TEXT;
