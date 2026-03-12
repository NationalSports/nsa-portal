-- Add alternate billing addresses to customers (stored on parent, applies to sub-accounts)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS alt_billing_addresses JSONB DEFAULT '[]';

-- Add school PO number to sales orders
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS po_number TEXT;

-- Add billing override fields to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_address TEXT;
