#!/usr/bin/env python3
"""
Merge one or more NetSuite Saved Search exports (line-level, i.e. Main Line =
False) into a single tidy CSV. Adds a `year` column and normalizes column names
so the output is pivot-table-ready in Excel or Google Sheets.

Expected input columns (any subset, any order — case-insensitive):
  Date, Type, Document Number, Customer (Name), Customer: Internal ID,
  Item, Description, Quantity, Rate, Amount, Status, Memo

Inputs may be CSV or NetSuite SpreadsheetML (.xls / .xml).

Usage:
    python scripts/merge-netsuite-transactions.py \
        exports/sales_orders_2023.xls \
        exports/sales_orders_2024.xls \
        exports/sales_orders_2025.xls \
        exports/invoices_2023-2025.csv \
        --out all_transactions.csv
"""

import argparse
import csv
from datetime import datetime
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

NS = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
SS = "{urn:schemas-microsoft-com:office:spreadsheet}"

COLUMN_ALIASES = {
    "date":             ["date", "trandate"],
    "type":             ["type", "transaction type"],
    "document_number":  ["document number", "document #", "tranid", "number"],
    "txn_nsid":         ["internal id", "transaction internal id"],
    "customer_nsid":    ["customer : internal id", "customer internal id",
                         "customer:internal id"],
    "customer_name":    ["customer", "customer name", "name"],
    "item":             ["item", "item name", "item: name"],
    "description":      ["description", "memo (main)", "item description"],
    "quantity":         ["quantity", "qty"],
    "rate":             ["item rate", "unit price", "rate", "price"],
    "amount":           ["amount", "line amount", "total"],
    "status":           ["status", "transaction status"],
    "memo":             ["memo", "notes"],
    "header_memo":      ["header memo", "document memo", "memo (main)",
                         "transaction memo", "main memo"],
}

OUTPUT_COLUMNS = [
    "year", "date", "type", "document_number",
    "customer_name", "customer_nsid", "txn_nsid", "line_seq",
    "item", "description", "quantity", "rate", "amount",
    "status", "header_memo", "memo", "source_file",
]


def _row_cells(row):
    out, idx = {}, 0
    for c in row.findall("ss:Cell", NS):
        ix = c.attrib.get(SS + "Index")
        idx = int(ix) if ix else idx + 1
        d = c.find("ss:Data", NS)
        out[idx] = (d.text or "").strip() if d is not None else ""
    return out


def _dedupe_headers(raw_headers):
    """NetSuite saved-search exports often ship multiple 'Internal ID' columns:
    the transaction's id (sometimes duplicated) and the customer's. The
    customer one is always last — rename it to 'Customer Internal ID' so
    auto-mapping can tell them apart, and disambiguate any other duplicates."""
    cleaned = [h.strip() for h in raw_headers]
    last_iid = max(
        (i for i, h in enumerate(cleaned) if h.lower() == "internal id"),
        default=-1,
    )
    seen: dict[str, int] = {}
    out = []
    for i, h in enumerate(cleaned):
        if i == last_iid and sum(1 for x in cleaned if x.lower() == "internal id") > 1:
            out.append("Customer Internal ID")
            continue
        if h in seen:
            seen[h] += 1
            out.append(f"{h} ({seen[h]})")
        else:
            seen[h] = 1
            out.append(h)
    return out


def load_spreadsheetml(path: Path):
    """Stream-parse SpreadsheetML so memory stays bounded on huge exports
    (300MB+ files would otherwise inflate to several GB as a DOM)."""
    headers: list[str] | None = None
    out: list[dict] = []
    row_tag = SS + "Row"
    context = ET.iterparse(path, events=("end",))
    for event, elem in context:
        if elem.tag != row_tag:
            continue
        cells = _row_cells(elem)
        if headers is None:
            raw_headers = [cells.get(i + 1, "") for i in range(max(cells) if cells else 0)]
            headers = _dedupe_headers(raw_headers)
        else:
            out.append({h: cells.get(i + 1, "") for i, h in enumerate(headers)})
        elem.clear()
    return headers or [], out


def load_csv(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        sniff = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sniff, delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel
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
    substring. Without this, 'Item Rate' would steal the 'item' alias and
    'Order Type' would steal the 'type' alias."""
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


def parse_date(s: str):
    s = (s or "").strip()
    if not s:
        return None
    if "T" in s:
        s = s.split("T", 1)[0]
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%d-%b-%Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def normalize_type(raw: str) -> str:
    r = (raw or "").strip().lower()
    if "credit" in r or r == "cm":
        return "credit_memo"
    if "sales order" in r or r == "so":
        return "sales_order"
    if "invoice" in r or r == "inv":
        return "invoice"
    return raw.strip().lower().replace(" ", "_")


def load_any(path: Path):
    suffix = path.suffix.lower()
    if suffix in (".xls", ".xml"):
        return load_spreadsheetml(path)
    if suffix in (".csv", ".tsv", ".txt"):
        return load_csv(path)
    sys.exit(f"unsupported input type: {path.suffix} ({path})")


def parse_num(s: str):
    s = (s or "").replace("$", "").replace(",", "").strip()
    if not s:
        return None
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return None


def sql_str(v):
    if v is None or v == "":
        return "NULL"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def sql_num(v):
    n = parse_num(v) if isinstance(v, str) else v
    return "NULL" if n is None else repr(n)


def emit_sql(merged: list[dict], out_path: Path):
    """Emit an idempotent upsert: delete all lines for the transaction ids in
    this batch, then insert fresh, then JOIN to fill customer_id from
    customers.netsuite_internal_id. Re-running with a fresh export replaces
    in place per-transaction."""
    txn_ids = sorted({r["txn_nsid"] for r in merged if r["txn_nsid"]})
    cols = ["id", "netsuite_internal_id", "line_seq", "raw_customer_nsid",
            "raw_customer_name", "transaction_type", "document_number",
            "transaction_date", "status", "item", "description", "quantity",
            "rate", "amount", "header_memo", "line_memo", "source_file"]

    lines = ["BEGIN;"]
    if txn_ids:
        # Chunk the IN-list so we don't blow past statement size limits on
        # very large batches.
        for i in range(0, len(txn_ids), 5000):
            chunk = txn_ids[i:i + 5000]
            in_list = ", ".join(sql_str(t) for t in chunk)
            lines.append(
                f"DELETE FROM customer_invoice_lines "
                f"WHERE netsuite_internal_id IN ({in_list});"
            )

    # Insert in batches — Postgres handles big multi-row inserts fine but
    # smaller chunks make the SQL file easier to spot-check and recover from.
    BATCH = 1000
    for i in range(0, len(merged), BATCH):
        batch = merged[i:i + BATCH]
        lines.append(f"INSERT INTO customer_invoice_lines ({', '.join(cols)}) VALUES")
        value_rows = []
        for r in batch:
            row_id = f"cil-ns-{r['txn_nsid']}-{r['line_seq']}"
            vals = [
                sql_str(row_id),
                sql_str(r["txn_nsid"]),
                str(r["line_seq"]),
                sql_str(r["customer_nsid"] or None),
                sql_str(r["customer_name"] or None),
                sql_str(r["type"]),
                sql_str(r["document_number"] or None),
                sql_str(r["date"]),
                sql_str(r["status"] or None),
                sql_str(r["item"] or None),
                sql_str(r["description"] or None),
                sql_num(r["quantity"]),
                sql_num(r["rate"]),
                sql_num(r["amount"]),
                sql_str(r["header_memo"] or None),
                sql_str(r["memo"] or None),
                sql_str(r["source_file"]),
            ]
            value_rows.append("(" + ", ".join(vals) + ")")
        lines.append(",\n".join(value_rows) + ";")

    # Fill customer_id from the customers table for every newly inserted row
    # (and for any older rows that were orphans waiting on a customer import).
    lines.append("""
UPDATE customer_invoice_lines cil
SET customer_id = c.id
FROM customers c
WHERE cil.customer_id IS NULL
  AND cil.raw_customer_nsid IS NOT NULL
  AND c.netsuite_internal_id = cil.raw_customer_nsid;
""")
    lines.append("COMMIT;")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("all_transactions.csv"))
    ap.add_argument("--out-sql", type=Path, default=None,
                    help="If set, also emit an upsert SQL file targeting "
                         "customer_invoice_lines (idempotent re-imports).")
    ap.add_argument("--include-tax", action="store_true",
                    help="Keep tax-detail lines (Name starts with 'Tax Agency'). "
                         "Off by default — these rows show the tax agency as the "
                         "entity, not the actual customer.")
    ap.add_argument("--sample", type=int, default=0,
                    help="If >0, only process the first N rows per file (preview).")
    args = ap.parse_args()

    merged: list[dict] = []
    per_file_stats = []
    seq_by_txn: dict[str, int] = {}

    for path in args.inputs:
        headers, rows = load_any(path)
        mapping = auto_map(headers)
        if args.sample:
            rows = rows[: args.sample]
        kept = 0
        skipped_no_date = 0
        skipped_tax = 0
        skipped_no_txn = 0
        for r in rows:
            customer_name = r.get(mapping.get("customer_name", ""), "").strip()
            if not args.include_tax and customer_name.lower().startswith("tax agency"):
                skipped_tax += 1
                continue
            d = parse_date(r.get(mapping.get("date", ""), ""))
            if not d:
                skipped_no_date += 1
                continue
            txn_nsid = r.get(mapping.get("txn_nsid", ""), "").strip()
            if not txn_nsid:
                skipped_no_txn += 1
                continue
            seq_by_txn[txn_nsid] = seq_by_txn.get(txn_nsid, 0) + 1
            merged.append({
                "year": d.year,
                "date": d.isoformat(),
                "type": normalize_type(r.get(mapping.get("type", ""), "")),
                "document_number": r.get(mapping.get("document_number", ""), "").strip(),
                "customer_name":   customer_name,
                "customer_nsid":   r.get(mapping.get("customer_nsid", ""), "").strip(),
                "txn_nsid":        txn_nsid,
                "line_seq":        seq_by_txn[txn_nsid],
                "item":            r.get(mapping.get("item", ""), "").strip(),
                "description":     r.get(mapping.get("description", ""), "").strip(),
                "quantity":        r.get(mapping.get("quantity", ""), "").strip(),
                "rate":            r.get(mapping.get("rate", ""), "").strip(),
                "amount":          r.get(mapping.get("amount", ""), "").strip(),
                "status":          r.get(mapping.get("status", ""), "").strip(),
                "header_memo":     r.get(mapping.get("header_memo", ""), "").strip(),
                "memo":            r.get(mapping.get("memo", ""), "").strip(),
                "source_file":     path.name,
            })
            kept += 1
        per_file_stats.append((path.name, kept, skipped_no_date, skipped_tax, skipped_no_txn, mapping))

    # Sort the CSV output for human readability; line_seq is already locked in.
    merged_csv = sorted(
        merged,
        key=lambda x: (x["customer_name"].lower(), x["date"], x["document_number"], x["line_seq"]),
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        w.writeheader()
        w.writerows(merged_csv)

    print(f"wrote: {args.out} ({len(merged)} rows)")
    if args.out_sql:
        emit_sql(merged, args.out_sql)
        print(f"wrote: {args.out_sql} (upserts {len(merged)} lines across "
              f"{len({r['txn_nsid'] for r in merged})} transactions)")
    for name, kept, skipped, skipped_tax, skipped_no_txn, mapping in per_file_stats:
        print(f"  {name}: kept={kept}, skipped_no_date={skipped}, "
              f"skipped_tax={skipped_tax}, skipped_no_txn={skipped_no_txn}")
        unmapped = [k for k in COLUMN_ALIASES if k not in mapping]
        if unmapped:
            print(f"    (no column matched for: {', '.join(unmapped)})")


if __name__ == "__main__":
    main()
