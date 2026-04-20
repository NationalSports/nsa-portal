# Unmapped Sales Reps

These NetSuite sales-rep names appear on customer rows in `customers_upload.csv`
but do **not** match any active `user_profiles` row in the portal. Their
`primary_rep_id` will be left `NULL` on import unless you decide otherwise.

Decide per rep: **(a) create a user_profile**, **(b) map to someone else**, or
**(c) leave NULL**.

| Rep name (NetSuite) | Customer rows | Decision |
|---|---:|---|
| Tim Kelly        | 36 | ? |
| Juliet Leon      |  8 | ? |
| Denis Bobarykin  |  7 | ? |
| John Morris      |  2 | ? |

## Notes on the rest (already decided)
- **SBS**, **John Miller**, **Jabari Carr** → Steve Peterson (per user, 2026-04-20)
- **Aaron Mason**, **Rob Candelaria** → creating new `user_profiles` rows (per user, 2026-04-20)
- **Andrea** → Andrea Jung (fuzzy match, confirmed)
- **Rachel Najera** → Rachel Najara (spelling variant, confirmed)
- **Shawn McHugh** → `primary_rep_id = NULL`, flagged for reassignment
