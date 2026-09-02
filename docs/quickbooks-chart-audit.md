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
| OrderMyGear vendor invoice fee | 57000 OMG Fee | Debit on a real OMG vendor bill, such as store-creation or chargeback invoices; bill control side is 21100 A/P |
| OrderMyGear fee withheld from a deposit | 57000 OMG Fee | Separate negative Bank Deposit line |
| OrderMyGear processing fee withheld | 71400 Bank Charges | Separate negative Bank Deposit line |
| OrderMyGear payout | Configured bank account (currently 10100) | Gross linked QBO Payment(s) less the two withheld-fee lines; must equal the real bank deposit |
| In-house decoration labor | 55200 Decoration:Decoration Labor | Reference only; daily labor is not posted by Connect |
| In-house art labor | 55400 In House Art | Reference only; daily labor is not posted by Connect |
| Outbound UPS/FedEx shipping cost | 40100 Shipping Expense | Debit when a future Connect expense source is implemented; 67000 is DO NOT USE |
| Customer payment | 11010 Undeposited Funds | Debit; 11000 A/R is credited |
| CA / AZ / CO / NV / TX / WA sales tax | 25200 / 25205 / 25215 / 25220 / 25225 / 25230 | State liability; the portal supplies the exact tax amount |
| Quarterly sales-tax payment | Matching state subaccount | Reduces the individual state balance, not only parent 25201 |

Account 67000 Freight Expenses is retired and must not be used. Account 21000 Accounts Payable - Trade is not the QBO bill control account; QBO bills use 21100 Accounts Payable (A/P).

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

- Account 57000 applies to OMG/webstore fees, including actual OMG vendor invoices and the `OMG Fee Withheld` amount on a Deposit Statement. The supplied invoice `584-1L7K7QA` is a paid $8.91 vendor invoice with nine $0.99 OMG-fee lines.
- The supplied Deposit Statement is one bank deposit: statement `MRBHQRB6G`, dated 08/18/26, containing 28 stores. It reconciles $8,963.02 collected - $369.90 OMG fee withheld to 57000 - $288.81 processing fee withheld to 71400 = $8,304.31 net.
- OMG customer invoices are settled by the gross customer collection. The 57000 and 71400 fees are separate deposit deductions and never reduce the customer payment or leave fee-sized A/R open.
- Invoice `credit_amount` is persisted and sent as a QBO discount line to 40200; ordinary sales remain in 40000.
- Accounts 55200 and 55400 remain visible as chart references, but accounting confirmed that Connect does not post daily labor. No labor journal is part of the initial migration or production sync.

The safe QBO method is: record the customer payment in full to 11010 Undeposited Funds, then create the configured-bank Deposit by linking the gross QBO Payment(s) and subtracting each confirmed withheld fee separately. The deposit is blocked unless every Payment ID is unique and the line total exactly equals the net amount received. The bank mapping is configuration because 10100 will change when NSA changes banks.

One OMG Deposit Statement corresponds to one bank deposit, but it can contain many stores, payments, and refunds. The supplied statement contains 29 refund rows. Deposit writes remain blocked until refunds/credit memos are linked and the statement's unique ID, date, status, gross, fees, and net all reconcile. The old single-store report upload now rejects Deposit Statements so a company-level payout cannot be silently assigned to one store.

## Sales-tax implementation findings

- The portal currently uses TaxCloud, but existing customer rates are not automatically kept current: scheduled refresh jobs were disabled and the UI normally refreshes only missing rates.
- TaxCloud capture is wired as a manual action on paid taxable invoices. It is not an automatic completion control, so a paid taxable invoice can remain unfiled.
- Capture performs a new tax lookup at payment time but does not compare the result with the tax stored on the invoice. The current request supplies only state/ZIP, omits separately stored invoice shipping, and has no wired Portal caller for TaxCloud's return/refund action. Those gaps can make filed tax differ from collected tax.
- The TaxCloud functions contain placeholder origin-address fallbacks. Production tax calls must fail closed when the real NSA origin configuration is missing.
- Most lines default to the apparel taxability code. Freight, decoration, art, and other taxable/non-taxable categories need explicit taxability rules before relying on portal-calculated tax.
- Therefore QBO Automated Sales Tax must not be turned off yet. Taxable QBO invoice writes remain blocked until the portal calculation/capture controls and live QBO tax configuration are proven in a test company.

## Remaining source gap

The current Connect sync has no UPS/FedEx/outbound-shipping expense feed. When a portal or carrier source is added, it must route to 40100 Shipping Expense. Account 67000 Freight Expenses is DO NOT USE and is automatically migrated to 40100 in saved mappings.

## Chart observations that do not block the portal

- 25215 CO has QBO detail type Payroll Tax Payable even though its account type is Other Current Liabilities. Accounting said no change is required.
- 14700 IT & Software uses Vehicles detail type. Accounting said no change is required.
- 13000 Bad Debt is Bank/Checking. Accounting said no change is required; the separate bad-debt expense account is used for expense reporting.
