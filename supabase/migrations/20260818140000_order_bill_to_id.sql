-- Bill To on estimates, sales orders and invoices — plus the two invoice ship-to
-- columns the client has been writing all along with nothing to write them into.
--
-- 1. bill_to_id (estimates, sales_orders)
--    The docs already carry ship_to_id, which lets a rep point one order at an address
--    other than the customer default; billing had no equivalent, so an org that invoices
--    to a district office had to be corrected by hand on every invoice. bill_to_id is the
--    same shape and the same contract as ship_to_id:
--      NULL / 'default'         -> the customer's own billing address (unchanged behavior)
--      '<customer_id>_bill_<i>' -> the i-th billing entry in customers.alt_billing_addresses
--    See getBillAddrs / resolveOrderBillTo in src/components.js.
--
-- 2. bill_to_id (invoices)
--    Invoices already snapshot the resolved address into billing_name/billing_address.
--    Keeping the id too is what lets the Bill To picker reopen on the address that was
--    actually chosen instead of falling back to "customer default".
--
-- 3. shipping_name / shipping_address (invoices)
--    _invCols in src/lib/dbEngine.js has written these since the SO ship-to snapshot
--    landed, but neither column was ever created. PostgREST rejected the row, the save
--    layer's recovery stripped every _invExtraCols field and re-sent, and the write
--    "succeeded" with the ship-to silently gone — so an invoice for an order shipping to
--    a coach's house has been reloading with the customer default address. Creating the
--    columns is what makes that snapshot stick. Existing rows stay NULL and keep falling
--    back to the customer address exactly as they do today.
--
-- All additive and nullable: no existing row changes, no document prints differently
-- until someone picks a non-default address.
alter table public.estimates    add column if not exists bill_to_id text;
alter table public.sales_orders add column if not exists bill_to_id text;
alter table public.invoices     add column if not exists bill_to_id text;
alter table public.invoices     add column if not exists shipping_name text;
alter table public.invoices     add column if not exists shipping_address text;
