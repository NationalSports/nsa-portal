-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 077: General Ledger / financial statements
-- Run this in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
-- Backs the Accounting section. Until now the portal held sales data only
-- (customer_invoices = NetSuite invoice headers, customer_invoice_lines =
-- line detail). Neither one is a financial statement: there is no chart of
-- accounts, no expense side, and no way to produce a P&L, balance sheet or
-- trial balance for a tax year. These three tables close that gap.
--
-- Everything here is IMPORTED from NetSuite reports — nothing in the portal
-- posts to these tables. They are a reporting mirror, not a ledger of record.
-- That is why a re-import is allowed to replace rows outright (see below).
--
-- ─── Sign convention (the load-bearing rule) ───────────────────────
-- gl_entries.amount is stored as DEBIT MINUS CREDIT, i.e. raw GL sign:
--     asset / expense / COGS balances are POSITIVE
--     liability / equity / income balances are NEGATIVE
-- This is NetSuite's own convention and it makes the arithmetic checkable:
-- a correct trial balance sums to zero across every account. Flipping income
-- to "positive revenue" is a PRESENTATION step and happens in the statement
-- builder (src/lib/netsuiteFinancials.js), never at rest in the database.
-- Do not "fix" a negative income balance here — that breaks the zero-sum
-- check that proves the import is complete.

-- ─── 1. Chart of accounts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_accounts (
  -- Deterministic slug of the account number + name (or the NetSuite internal
  -- id when the export carries one), so a re-import updates in place.
  id                    TEXT PRIMARY KEY,

  netsuite_internal_id  TEXT,
  account_number        TEXT,
  name                  TEXT NOT NULL,
  -- Fully-qualified path as NetSuite prints it: "Income : Sales : Apparel".
  full_name             TEXT,
  parent_full_name      TEXT,

  -- NetSuite account type verbatim: Income, Expense, COGS, Bank,
  -- Accounts Receivable, Accounts Payable, Equity, Other Current Asset, ...
  account_type          TEXT,
  -- Derived bucket the statement builder groups on:
  -- 'income' | 'cogs' | 'expense' | 'other_income' | 'other_expense'
  --   -> income statement
  -- 'asset' | 'liability' | 'equity'
  --   -> balance sheet
  statement_group       TEXT,

  -- A NetSuite report prints subtotal rows for parent accounts. They must be
  -- excluded from any sum or every rolled-up dollar is counted twice.
  is_summary            BOOLEAN NOT NULL DEFAULT false,
  is_inactive           BOOLEAN NOT NULL DEFAULT false,

  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gl_accounts_number ON gl_accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_group  ON gl_accounts(statement_group);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gl_accounts_nsid
  ON gl_accounts(netsuite_internal_id) WHERE netsuite_internal_id IS NOT NULL;

-- ─── 2. GL detail lines ────────────────────────────────────────────
-- One row per posting line from a NetSuite GL Detail / Transaction Detail
-- export. This is the grain everything else can be derived from: a trial
-- balance, a P&L and a balance sheet are all just groupings of these rows.
CREATE TABLE IF NOT EXISTS gl_entries (
  -- Content fingerprint (see netsuiteFinancials.entryFingerprint). NetSuite's
  -- GL Detail export has no stable per-line id, so the key is a hash of the
  -- posting's identifying fields plus its occurrence index within the file —
  -- which makes a byte-identical re-import land on the same rows instead of
  -- duplicating, while two genuinely identical postings still both survive.
  id                    TEXT PRIMARY KEY,

  account_id            TEXT REFERENCES gl_accounts(id) ON DELETE SET NULL,
  -- Denormalized account identity, captured at import time. Kept even when
  -- account_id is NULL so an entry whose account has not been imported yet is
  -- still reportable, and so a later chart-of-accounts change cannot silently
  -- restate a filed year.
  account_number        TEXT,
  account_name          TEXT,
  account_full_name     TEXT,
  statement_group       TEXT,

  entry_date            DATE NOT NULL,
  fiscal_year           INTEGER NOT NULL,
  -- Period label as NetSuite prints it ("Jan 2025"), for tie-out against a
  -- monthly report. Not parsed into a date — NetSuite fiscal periods do not
  -- have to align to calendar months.
  period                TEXT,

  transaction_type      TEXT,          -- Invoice | Bill | Journal | Payment | ...
  document_number       TEXT,
  netsuite_internal_id  TEXT,
  entity_name           TEXT,          -- customer or vendor on the posting
  memo                  TEXT,

  -- Both sides kept as reported, plus the signed amount used for arithmetic.
  -- amount = debit - credit. NUMERIC, never float: these are money.
  debit                 NUMERIC,
  credit                NUMERIC,
  amount                NUMERIC NOT NULL,

  subsidiary            TEXT,
  department            TEXT,
  class                 TEXT,
  location              TEXT,

  source_file           TEXT,
  import_batch_id       TEXT,

  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gl_entries_year     ON gl_entries(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_gl_entries_date     ON gl_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_gl_entries_account  ON gl_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_gl_entries_group    ON gl_entries(statement_group);
CREATE INDEX IF NOT EXISTS idx_gl_entries_batch    ON gl_entries(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_gl_entries_doc      ON gl_entries(document_number);
-- The statement builder always slices by year then groups by account.
CREATE INDEX IF NOT EXISTS idx_gl_entries_year_account
  ON gl_entries(fiscal_year, account_full_name);

-- ─── 3. Reported balances (the tie-out reference) ──────────────────
-- Period balances as NetSuite itself printed them, from a Trial Balance,
-- Income Statement or Balance Sheet export. These are NOT used to build the
-- statements — gl_entries is. They exist so the portal can show, side by
-- side, "derived from GL detail" vs "what NetSuite reported" and flag any
-- difference. An unexplained difference means the detail import is short
-- rows, which is exactly the failure that would otherwise pass silently
-- into a tax return.
CREATE TABLE IF NOT EXISTS gl_account_balances (
  id                    TEXT PRIMARY KEY,

  account_id            TEXT REFERENCES gl_accounts(id) ON DELETE SET NULL,
  account_number        TEXT,
  account_name          TEXT,
  account_full_name     TEXT,
  statement_group       TEXT,

  fiscal_year           INTEGER NOT NULL,
  -- NULL period = the full-year figure. A month label scopes it to that month.
  period                TEXT,
  -- 'trial_balance' | 'income_statement' | 'balance_sheet'
  report_type           TEXT NOT NULL,

  -- Same sign convention as gl_entries: debit-positive.
  debit                 NUMERIC,
  credit                NUMERIC,
  amount                NUMERIC NOT NULL,

  source_file           TEXT,
  import_batch_id       TEXT,

  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gl_balances_unique
  ON gl_account_balances(report_type, fiscal_year, COALESCE(period, ''), COALESCE(account_full_name, account_name));
CREATE INDEX IF NOT EXISTS idx_gl_balances_year ON gl_account_balances(fiscal_year);

-- ─── 4. Import audit trail ─────────────────────────────────────────
-- Every import writes one row here first. It records what the file claimed,
-- what was written, and what a period-replace deleted — so a number in the
-- Accounting section can always be traced back to a file and a person.
CREATE TABLE IF NOT EXISTS gl_import_batches (
  id                    TEXT PRIMARY KEY,

  -- 'gl_detail' | 'trial_balance' | 'income_statement' | 'balance_sheet'
  -- | 'chart_of_accounts' | 'invoice_totals'
  report_type           TEXT NOT NULL,
  source_file           TEXT,
  fiscal_year           INTEGER,
  period_start          DATE,
  period_end            DATE,

  rows_parsed           INTEGER,
  rows_written          INTEGER,
  rows_replaced         INTEGER,
  -- Sum of the signed amounts written. For a complete GL detail import of a
  -- closed period this is ~0; a non-zero value is surfaced in the UI.
  total_amount          NUMERIC,
  -- Parser warnings (unmapped columns, skipped summary rows, sign anomalies).
  warnings              JSONB,

  imported_by           TEXT,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gl_batches_at ON gl_import_batches(imported_at DESC);

-- ─── Triggers ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER trg_gl_accounts_updated BEFORE UPDATE ON gl_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_gl_entries_updated BEFORE UPDATE ON gl_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_gl_balances_updated BEFORE UPDATE ON gl_account_balances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── RLS ───────────────────────────────────────────────────────────
-- Company-wide P&L and expense detail is admin/GM data — tighter than the
-- sales tables, which every rep can read. Matches the gate on the Accounting
-- page itself (App.js RESTRICTED_PAGES + role access lists).
ALTER TABLE gl_accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_import_batches   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gl_accounts_admin ON gl_accounts;
CREATE POLICY gl_accounts_admin ON gl_accounts FOR ALL
  TO authenticated USING (is_admin_or_gm()) WITH CHECK (is_admin_or_gm());

DROP POLICY IF EXISTS gl_entries_admin ON gl_entries;
CREATE POLICY gl_entries_admin ON gl_entries FOR ALL
  TO authenticated USING (is_admin_or_gm()) WITH CHECK (is_admin_or_gm());

DROP POLICY IF EXISTS gl_balances_admin ON gl_account_balances;
CREATE POLICY gl_balances_admin ON gl_account_balances FOR ALL
  TO authenticated USING (is_admin_or_gm()) WITH CHECK (is_admin_or_gm());

DROP POLICY IF EXISTS gl_batches_admin ON gl_import_batches;
CREATE POLICY gl_batches_admin ON gl_import_batches FOR ALL
  TO authenticated USING (is_admin_or_gm()) WITH CHECK (is_admin_or_gm());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON gl_accounts, gl_entries, gl_account_balances, gl_import_batches
  TO authenticated;
