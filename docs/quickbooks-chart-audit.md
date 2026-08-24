# QuickBooks chart-of-accounts audit

Source of truth reviewed: `National_Sports Apparel LLC.csv`, exported from the connected QBO company.

## Approved portal posting matrix

| Synced item type | Account | Posting behavior |
|---|---:|---|
| Customer merchandise, decoration, and customer-billed freight | 40000 Sales | Credit; invoice control side is 11000 A/R |
| Customer discounts | 40200 Sales:Discounts | Negative revenue / debit |
| Apparel or equipment bought for a sales order | 51300 Purchases | Debit through a QBO NonInventory item; bill control side is 21100 A/P |
| Supplies with no SKU | 51300 Purchases | Account-based debit; bill control side is 21100 A/P |
| Freight on a vendor bill | 51000 Freight In | Debit; bill control side is 21100 A/P |
| Outside-decoration vendor bill | 52000 Outside Decoration | Debit; vendor category is authoritative |
| Sports Inc fee on a vendor bill | 58000 Sports Inc Fee | Debit; bill control side is 21100 A/P |
| OrderMyGear hosted-store fee | 57000 OMG Fee | Exact `_omg_omg_fees` amount from the OMG Accounting Report; negative Bank Deposit line |
| OrderMyGear credit-card fee | 71400 Bank Charges | Exact `_omg_cc_fees` amount; separate negative Bank Deposit line |
| OrderMyGear payout | 10100 First Foundation Checking | Gross linked QBO Payment(s) less the 57000 and 71400 negative lines; must equal the bank deposit |
| In-house decoration labor | 55100 Decoration | Production/decoration clock minutes × the employee's labor rate; payroll reclass offset and cadence are gated |
| In-house art labor | 55400 In House Art | Art-clock minutes × the artist's labor rate; payroll reclass offset and cadence are gated |
| Outbound UPS/FedEx shipping cost | 67000 Freight Expenses | Debit when a future Connect expense source is implemented |
| Customer payment | 11010 Undeposited Funds | Debit; 11000 A/R is credited |
| CA / AZ / CO / NV / TX / WA sales tax | 25200 / 25205 / 25215 / 25220 / 25225 / 25230 | State liability; the portal supplies the exact tax amount |
| Quarterly sales-tax payment | Matching state subaccount | Reduces the individual state balance, not only parent 25201 |

Account 40100 Shipping Expense is not used by the portal. Account 21000 Accounts Payable - Trade is not the QBO bill control account; QBO bills use 21100 Accounts Payable (A/P).

## Required QBO correction before any live write

The QBO export currently classifies 51300 Purchases as **Expenses / Supplies & Materials**. Accounting confirmed that it should be **Cost of Goods Sold** and may already have changed it in QBO. The preflight intentionally expects Cost of Goods Sold and blocks every transaction if the live QBO account still has the old type. It never substitutes 50000 or another account.

## Product and inventory model

- Create or reuse exactly one active QBO **NonInventory** item per normalized SKU.
- All portal size/color variants of that SKU map to the same QBO item.
- QBO POs and vendor bills carry total quantity per SKU; sizes remain only in the portal.
- The QBO item's purchase account is 51300 and income account is 40000.
- The portal does not send quantity on hand, initial quantity, inventory adjustments, or inventory valuation to QBO.
- Accounts 12000 Inventory Asset, 50000 Cost of Goods Sold, and 52400 Inventory Loss are therefore not used by the portal sync.

This follows accounting's instruction that QBO will not track inventory items or per-size stock and that purchases go straight to 51300 under COGS.

## Sales-tax gate

The state account numbers are approved, but a taxable QBO invoice still needs the live company's QBO TaxCode/TxnTaxDetail configuration. Until the live Sales Tax Center IDs and behavior are inspected, taxable invoice writes remain blocked. The sync must not book tax as 40000 revenue or fake it as a normal line to 25201.

## OMG and internal-labor source findings

- Account 57000 applies only to an OrderMyGear-hosted store (`source='omg'`, `omg_store_id`, or the OMG store record). Its amount is `_omg_omg_fees`, imported from the OMG Accounting Report. Native Portal webstore Stripe/card fees are not OMG fees and must not use 57000.
- Account 55100 has a concrete Portal source: `job_time_logs` minutes multiplied by the current employee rate in `labor_rates`.
- Account 55400 has a separate concrete Portal source: `art_time_logs` minutes multiplied by the current artist rate in `labor_rates`.
- These two labor streams are internal payroll cost, not vendor bills. Posting a new debit without reclassifying an already-booked payroll expense would double-count cost. The Portal therefore exposes them in the mapping/preflight and can produce a dry-run manifest, but does not yet post them.
- The current clock blobs have no stable per-log IDs, rates are looked up at report time rather than snapshotted at clock-out, and idle minutes are tracked but presently included in the displayed cost. Those issues must be resolved before resumable QBO journals are safe.

Accounting approved the gross-payment/negative-deposit method: record the customer payment in full to 11010 Undeposited Funds, then create the 10100 Bank Deposit by linking the gross QBO Payment(s), subtracting `_omg_omg_fees` to 57000 and `_omg_cc_fees` to 71400. The deposit is blocked unless every Payment ID is unique and the line total exactly equals the net amount received.

## Remaining source gap

The current Connect sync has no UPS/FedEx/outbound-shipping expense feed. Account 67000 is validated and reserved, but no transaction is created from it yet. We need to identify the portal record or carrier integration that supplies those charges before wiring that posting.

## Chart observations that do not block the portal

- 25215 CO has QBO detail type Payroll Tax Payable even though its account type is Other Current Liabilities. Accounting said no change is required.
- 14700 IT & Software uses Vehicles detail type. Accounting said no change is required.
- 13000 Bad Debt is Bank/Checking. Accounting said no change is required; the separate bad-debt expense account is used for expense reporting.
