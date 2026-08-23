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

## Remaining source gap

The current Connect sync has no UPS/FedEx/outbound-shipping expense feed. Account 67000 is validated and reserved, but no transaction is created from it yet. We need to identify the portal record or carrier integration that supplies those charges before wiring that posting.

## Chart observations that do not block the portal

- 25215 CO has QBO detail type Payroll Tax Payable even though its account type is Other Current Liabilities. Accounting said no change is required.
- 14700 IT & Software uses Vehicles detail type. Accounting said no change is required.
- 13000 Bad Debt is Bank/Checking. Accounting said no change is required; the separate bad-debt expense account is used for expense reporting.
