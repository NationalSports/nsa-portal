#!/usr/bin/env python3
"""
Load NetSuite invoice totals into customer_invoices.

Expected input: a NetSuite Saved Search export (CSV or SpreadsheetML .xls) with
one row per invoice (Main Line = True) containing at minimum:
  - Date                   (required)
  - Type                   (Invoice | Credit Memo)
  - Document Number
  - Internal ID            (the transaction's NS internal id — our idempotency key)
  - Customer: Internal ID  (the customer's NS internal id — joins to customers)
  - Name                   (customer display name)
  - Status
  - Amount                 (total — required)
  - Subtotal               (optional)
  - Tax Total              (optional)
  - Subsidiary             (optional)
  - Sales Rep              (optional)
  - Memo                   (optional)

Output: SQL upserts ready to run via the Supabase MCP (no direct DB writes
from this script — easier to audit a sample first).

Usage:
    python scripts/load-netsuite-invoices.py path/to/invoices.csv
    python scripts/load-netsuite-invoices.py path/to/invoices.xls
        --out-sql /tmp/invoice_upserts.sql
        --include-voids=false
        --include-credit-memos=true
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

NS = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
SS = "{urn:schemas-microsoft-com:office:spreadsheet}"

# Column aliases — matches what NetSuite saved-search exports typically look
# like. Case-insensitive substring match; first hit wins.
COLUMN_ALIASES = {
    "date":                 ["date", "invoice date", "trandate"],
    "type":                 ["type", "transaction type"],
    "document_number":      ["document number", "document #", "number", "tranid"],
    "netsuite_internal_id": ["internal id", "transaction internal id"],
    "customer_nsid":        ["customer : internal id", "customer internal id",
                             "customer:internal id"],
    "customer_name":        ["name", "customer", "customer name"],
    "status":               ["status", "transaction status"],
    "subsidiary":           ["subsidiary"],
    "rep_name":             ["sales rep", "rep"],
    "subtotal":             ["subtotal"],
    "tax":                  ["tax total", "total tax", "tax"],
    "total":                ["amount", "total", "amount (gross)", "amount (total)"],
    "open_balance":         ["open balance", "amount remaining", "remaining amount",
                             "amount due", "balance due"],
    "memo":                 ["memo", "notes"],
}

# customer_invoices column -> the canonical field it is sourced from. Used to
# decide which columns an ON CONFLICT re-import is allowed to overwrite: a
# column whose source field never matched a header in this export carries NULL,
# and writing that NULL over existing data loses it.
COLUMN_SOURCE = {
    "id":                   "netsuite_internal_id",
    "customer_id":          "customer_nsid",
    "raw_customer_nsid":    "customer_nsid",
    "raw_customer_name":    "customer_name",
    "netsuite_internal_id": "netsuite_internal_id",
    "document_number":      "document_number",
    "invoice_date":         "date",
    "type":                 "type",
    "status":               "status",
    "subsidiary":           "subsidiary",
    "rep_name":             "rep_name",
    "subtotal":             "subtotal",
    "tax":                  "tax",
    "total":                "total",
    "open_balance":         "open_balance",
    "memo":                 "memo",
}


def _row_cells(row):
    out, idx = {}, 0
    for c in row.findall("ss:Cell", NS):
        ix = c.attrib.get(SS + "Index")
        idx = int(ix) if ix else idx + 1
        d = c.find("ss:Data", NS)
        out[idx] = (d.text or "").strip() if d is not None else ""
    return out


def _dedupe_headers(raw_headers):
    """Resolve duplicate column names. NetSuite exports ship MULTIPLE columns
    named 'Internal ID': the transaction's id (sometimes repeated verbatim) and
    the customer's. The customer one is always last — rename only that one to
    'Customer Internal ID' and disambiguate the rest, so a repeated transaction
    id column can't collide with the customer id and win the lookup."""
    cleaned = [h.strip() for h in raw_headers]
    n_iid = sum(1 for h in cleaned if h.lower() == "internal id")
    last_iid = max(
        (i for i, h in enumerate(cleaned) if h.lower() == "internal id"),
        default=-1,
    )
    seen = {}
    out = []
    for i, h in enumerate(cleaned):
        key = h
        if i == last_iid and n_iid > 1:
            out.append("Customer Internal ID")
            continue
        if key in seen:
            seen[key] += 1
            out.append(f"{key} ({seen[key]})")
        else:
            seen[key] = 1
            out.append(key)
    return out


def load_spreadsheetml(path: Path):
    tree = ET.parse(path)
    ws = tree.getroot().find("ss:Worksheet", NS)
    rows = ws.find("ss:Table", NS).findall("ss:Row", NS)
    header = _row_cells(rows[0])
    raw_headers = [header.get(i + 1, "") for i in range(max(header))]
    headers = _dedupe_headers(raw_headers)
    return headers, [
        {h: _row_cells(r).get(i + 1, "") for i, h in enumerate(headers)}
        for r in rows[1:]
    ]


def load_csv(path: Path):
    with path.open(newline="") as f:
        sniff = f.read(4096)
        f.seek(0)
        dialect = csv.Sniffer().sniff(sniff, delimiters=",\t;")
        reader = csv.reader(f, dialect=dialect)
        raw_headers = next(reader)
        headers = _dedupe_headers(raw_headers)
        out = []
        for row in reader:
            if not any(row):
                continue
            out.append({h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)})
        return headers, out


def auto_map(headers):
    """Pick the best header for each canonical field.

    Three passes — exact match wins over word-boundary which wins over
    substring. Without this, 'Order Type' would steal the 'type' alias from
    the real 'Type' column (and, being blank in NetSuite invoice exports,
    would silently type every credit memo as an invoice)."""
    lowered = [(h, h.lower().strip()) for h in headers]
    claimed: set[str] = set()
    mapping: dict[str, str] = {}

    def try_match(predicate):
        for field, aliases in COLUMN_ALIASES.items():
            if field in mapping:
                continue
            for alias in aliases:
                for orig, low in lowered:
                    if orig in claimed:
                        continue
                    if predicate(alias, low):
                        mapping[field] = orig
                        claimed.add(orig)
                        break
                if field in mapping:
                    break

    try_match(lambda a, h: h == a)
    try_match(lambda a, h: f" {a} " in f" {h} " or h.startswith(a + " ") or h.endswith(" " + a))
    try_match(lambda a, h: a in h)
    return mapping


def parse_date(s: str) -> str | None:
    s = (s or "").strip()
    if not s:
        return None
    # NetSuite XLS export uses ISO with T: "2024-07-01T00:00:00". Strip time.
    if "T" in s:
        s = s.split("T", 1)[0]
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%d-%b-%Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def parse_num(s: str) -> float | None:
    if not s:
        return None
    s = s.replace("$", "").replace(",", "").strip()
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return None


def normalize_type(raw: str) -> str:
    r = (raw or "").strip().lower()
    if "credit" in r or "cm" in r:
        return "credit_memo"
    return "invoice"


def normalize_status(raw: str) -> str:
    r = (raw or "").strip().lower()
    # NetSuite common statuses: "Paid In Full", "Open", "Voided", "Pending Approval"
    if not r:
        return ""
    if "paid" in r:
        return "paid"
    if "void" in r or "cancel" in r:
        return "void"
    if "open" in r:
        return "open"
    if "pending" in r:
        return "pending"
    return r[:40]  # leave unusual statuses free-text


def sql_str(v):
    if v is None or v == "":
        return "NULL"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("--out-sql", type=Path, default=Path("/tmp/invoice_upserts.sql"))
    ap.add_argument("--include-voids", default="false", choices=["true", "false"])
    ap.add_argument("--include-credit-memos", default="true", choices=["true", "false"])
    ap.add_argument("--sample", type=int, default=0,
                    help="If >0, only process the first N rows (for preview)")
    args = ap.parse_args()

    path = args.input
    if path.suffix.lower() in (".xls", ".xml"):
        headers, rows = load_spreadsheetml(path)
    elif path.suffix.lower() == ".csv":
        headers, rows = load_csv(path)
    else:
        sys.exit(f"unsupported input type: {path.suffix}")

    mapping = auto_map(headers)
    required = ["date", "netsuite_internal_id", "customer_nsid", "total"]
    missing = [f for f in required if f not in mapping]
    if missing:
        print(f"! Missing required columns: {missing}", file=sys.stderr)
        print(f"  Available headers: {headers}", file=sys.stderr)
        sys.exit(1)

    if args.sample:
        rows = rows[: args.sample]

    kept, skipped = [], []
    for r in rows:
        typ = normalize_type(r.get(mapping.get("type", ""), ""))
        if typ == "credit_memo" and args.include_credit_memos == "false":
            skipped.append(("excluded_credit_memo", r)); continue
        status = normalize_status(r.get(mapping.get("status", ""), ""))
        if status == "void" and args.include_voids == "false":
            skipped.append(("excluded_void", r)); continue

        ns_txn_id = (r.get(mapping["netsuite_internal_id"], "") or "").strip()
        cust_nsid = (r.get(mapping["customer_nsid"], "") or "").strip()
        inv_date = parse_date(r.get(mapping["date"], ""))
        total = parse_num(r.get(mapping["total"], ""))

        if not ns_txn_id:
            skipped.append(("missing_ns_id", r)); continue
        if not inv_date:
            skipped.append(("bad_date", r)); continue
        if total is None:
            skipped.append(("bad_total", r)); continue

        kept.append({
            "id": f"inv-ns-{ns_txn_id}",
            "netsuite_internal_id": ns_txn_id,
            # Leave customer_id NULL at insert time; a post-load JOIN on
            # raw_customer_nsid populates it for customers that exist now,
            # and re-running the join later picks up any newly imported ones.
            "customer_id": None,
            "raw_customer_nsid": cust_nsid or None,
            "raw_customer_name": r.get(mapping.get("customer_name", ""), "") or None,
            "document_number": r.get(mapping.get("document_number", ""), "") or None,
            "invoice_date": inv_date,
            "type": typ,
            "status": status or None,
            "subsidiary": r.get(mapping.get("subsidiary", ""), "") or None,
            "rep_name": r.get(mapping.get("rep_name", ""), "") or None,
            "subtotal": parse_num(r.get(mapping.get("subtotal", ""), "")),
            "tax": parse_num(r.get(mapping.get("tax", ""), "")),
            "total": total,
            "open_balance": parse_num(r.get(mapping.get("open_balance", ""), "")),
            "memo": r.get(mapping.get("memo", ""), "") or None,
        })

    # Emit one big UPSERT. Idempotent re-runs update-in-place via the unique
    # constraint on netsuite_internal_id.
    cols = ["id", "customer_id", "raw_customer_nsid", "raw_customer_name",
            "netsuite_internal_id", "document_number", "invoice_date", "type",
            "status", "subsidiary", "rep_name", "subtotal", "tax", "total", "open_balance", "memo"]
    lines = []
    lines.append("BEGIN;")
    lines.append(f"INSERT INTO customer_invoices ({', '.join(cols)}) VALUES")
    value_rows = []
    for r in kept:
        vals = [sql_str(r[c]) for c in cols]
        value_rows.append("(" + ", ".join(vals) + ")")
    lines.append(",\n".join(value_rows))
    lines.append("ON CONFLICT (netsuite_internal_id) DO UPDATE SET")
    # Only overwrite columns this export actually supplies. A saved search that
    # omits, say, "Sales Rep" must not blank out rep_name on 8k existing rows —
    # EXCLUDED holds NULL for every unmapped column, so listing them here is a
    # silent data-wipe on re-import. customer_id is never updated either: it is
    # always NULL at insert time and is populated by the post-load join below,
    # which would otherwise drop any manual customer link.
    never_update = {"id", "netsuite_internal_id", "customer_id"}
    update_cols = [
        c for c in cols
        if c not in never_update and COLUMN_SOURCE[c] in mapping
    ]
    dropped = [
        c for c in cols
        if c not in never_update and COLUMN_SOURCE[c] not in mapping
    ]
    lines.append(
        ",\n  ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
    )
    lines.append(";")
    # Post-load: link invoices to their customer by NS Internal ID. Idempotent
    # and safe to re-run — each time more customers get imported, previously
    # orphan invoices get picked up. Preserves any manual overrides (WHERE
    # clause only fills NULLs).
    lines.append("""
UPDATE customer_invoices ci
SET customer_id = c.id
FROM customers c
WHERE ci.customer_id IS NULL
  AND ci.raw_customer_nsid IS NOT NULL
  AND c.netsuite_internal_id = ci.raw_customer_nsid;
""")
    # Second pass: link by customer NAME. The nsid pass above almost never fires
    # -- these exports carry the TRANSACTION internal id in the customer column
    # (raw_customer_nsid = netsuite_internal_id on 9,199 of 9,213 rows), so the
    # join finds nothing and every freshly imported invoice stays orphaned. An
    # invoice with a NULL customer_id is invisible in the portal: the customer
    # page filters with ids.includes(o.customer_id) (CustDetail.js), so it shows
    # on no customer at all. That is what stranded all 131 rows of the
    # 2026-08-20 import until someone backfilled them by hand.
    #
    # NetSuite renders the customer as "<acct#> <Name>" or "<Parent> : <Child>";
    # portal customers.name holds the trailing part. Strip whichever prefix is
    # present and match case-insensitively, and only where exactly ONE customer
    # owns that name so an ambiguous name never picks a side. Checked against
    # the 8,654 rows already linked: this rule reproduces 8,345 of them and
    # disagrees with none of the orphans it would newly fill.
    #
    # Still NULL-only, so a manual override or an nsid match is never rewritten.
    lines.append("""
UPDATE customer_invoices ci
SET customer_id = m.cid
FROM (
  SELECT lower(btrim(name)) AS norm_name, min(id) AS cid
  FROM customers
  WHERE name IS NOT NULL AND btrim(name) <> ''
  GROUP BY 1
  HAVING count(*) = 1
) m
WHERE ci.customer_id IS NULL
  AND ci.raw_customer_name IS NOT NULL
  AND m.norm_name = lower(btrim(
        CASE WHEN position(' : ' IN ci.raw_customer_name) > 0
             THEN regexp_replace(ci.raw_customer_name, '^.* : ', '')
             ELSE regexp_replace(ci.raw_customer_name, '^[0-9]+\\s+', '')
        END));
""")
    lines.append("COMMIT;")

    args.out_sql.write_text("\n".join(lines))

    print(f"read:     {len(rows)} rows")
    print(f"kept:     {len(kept)}")
    print(f"skipped:  {len(skipped)}")
    for reason in ("excluded_credit_memo", "excluded_void", "missing_ns_id",
                   "bad_date", "bad_total"):
        n = sum(1 for k, _ in skipped if k == reason)
        if n:
            print(f"  - {reason}: {n}")
    print(f"wrote:    {args.out_sql}")
    if dropped:
        print(f"note:     export has no column for {', '.join(dropped)} — "
              f"re-import leaves those columns untouched on existing rows")
    print(f"mapping:  {json.dumps(mapping, indent=2)}")


if __name__ == "__main__":
    main()
