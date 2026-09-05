# QBO vendors into the Portal

QuickBooks Sync → Vendors offers a read-only review followed by Import Reviewed Vendors to Portal. This is a manual migration step; it does not enable scheduled synchronization or write to QBO.

The review reads all Portal vendors and active QBO vendors, matches saved company-scoped links first, then exact names (case and whitespace insensitive). Ambiguous names, conflicting links, and inactive Portal vendors are blocked. New vendors have deterministic company/QBO-scoped IDs so retries do not create another record.

Existing Portal names, populated contacts, purchasing terms, API settings, and decoration classifications are preserved. Only missing email and phone fields are filled. New records use the Portal's upload vendor type. Existing records are never deactivated or deleted by this import.

Before applying, both lists are read again and must match the review. Each saved vendor is read back from the database before a vendorQBMap receipt is saved in the existing company-scoped durable link ledger. A failed write/read-back/receipt is reported as an error. Retry starts with a new review. POs and both bill upload paths consult the saved vendor map.

Validation: vendor matcher/import tests cover ambiguous names on either side, inactive records, existing contacts, QBO renames, deterministic IDs, failed read-back, stale review, and retry behavior. Existing ledger tests cover persistence across config replacement and company isolation. No schema migration is required.
