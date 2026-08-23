# QuickBooks chart-of-accounts audit

Source reviewed: `National_Sports Apparel LLC.csv` supplied from QBO, 107 accounts.

## Portal mappings verified

| Portal item / control | Account | QBO name | QBO account type | Result |
|---|---:|---|---|---|
| Customer sales and customer-billed shipping | 40000 | Sales | Income | Verified |
| Vendor freight in | 51000 | Cost of Goods Sold:Freight In | Cost of Goods Sold | Verified |
| Outside decoration vendor bills | 52000 | Outside Decoration | Cost of Goods Sold | Verified |
| Sports Inc fee | 58000 | Sports Inc Fee | Cost of Goods Sold | Verified |
| Inventory asset | 12000 | Inventory Asset | Other Current Assets | Verified |
| Inventory loss/adjustment | 52400 | Inventory Loss | Expenses | Verified |
| Accounts Receivable control | 11000 | Accounts Receivable (A/R) | Accounts receivable (A/R) | Verified |
| Customer payment deposit | 11010 | Undeposited Funds | Other Current Assets | Verified |
| Accounts Payable control | 21100 | Accounts Payable (A/P) | Accounts payable (A/P) | Verified |
| Sales tax payable | 25201 | Sales Tax Payables | Other Current Liabilities | Verified; locked/QBO-managed |
| Vendor merchandise bills | 51300 | Purchases | Expenses | Verified against the requested bill mapping; reporting decision noted below |
| Inventory-item cost on sale | 50000 | Cost of Goods Sold | Cost of Goods Sold | Verified |

No duplicate account numbers or account names were present in the export.

## Merchandise reporting decision

The supplied worksheet described 51300 as Cost of Goods Sold, but the live QBO export classifies 51300 Purchases as an Expense account with detail type Supplies & Materials. Account 50000 is the actual Cost of Goods Sold account with detail type Supplies & Materials - COGS.

The portal now keeps these two roles separate: vendor merchandise bill lines use 51300, exactly as requested, while QBO inventory items use 50000 as their Cost of Goods Sold account. The owner/accountant should confirm whether that is the intended accounting model or choose one of these alternatives:

1. keep merchandise at 51300 and intentionally report it as operating expense;
2. route merchandise to 50000 Cost of Goods Sold; or
3. reclassify 51300 in QBO to Cost of Goods Sold, if the accountant confirms that change is appropriate.

The portal validates 51300 as Expense and 50000 as Cost of Goods Sold. It will never silently substitute one for the other. If all merchandise purchases should hit gross-profit COGS immediately, the bill mapping must be changed deliberately rather than by fallback.

## Sales-tax warning

25201 is marked locked in the QBO export. It is suitable as the sales-tax liability control account, but the portal must not create a generic invoice line or generic expense line directly against it. Taxable invoices require QBO tax-code/TxnTaxDetail mapping, and quarterly remittances require the QBO sales-tax payment workflow. Both remain gated until the live QBO Sales Tax Center setup is inspected.

## Other chart items to review with the accountant

These accounts are not used by the proposed portal sync, but their QBO detail types look unusual:

- 25215 Sales Tax Payables:CO uses detail type Payroll Tax Payable, while the other states use Sales Tax Payable.
- 14700 Property & Equipment:Information Technology & Software uses detail type Vehicles.
- 13000 Bad Debt is an account type Bank / detail type Checking rather than an expense or contra-receivable account.

No portal routing depends on these three accounts; they are audit observations only.
