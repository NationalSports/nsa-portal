#!/usr/bin/env python3
"""
Extract A4 and Champro vendor price lists from their PDF price sheets into
products-table rows, and emit an idempotent SQL import file.

Usage:
    pip install pdfplumber
    python3 scripts/extract-pricelist-pdfs.py \
        --a4 "A4 2026 All Star Price List26June.pdf" \
        --champro "CamproMASTER_Price_List_FALL_2026.pdf" \
        [--champro-template "Champro Upload Template.csv"] \
        --out scripts/import-champro-a4-fall2026.sql

How costs are chosen:
    A4      -> the single "ALL STAR" price column.
    Champro -> "Col. 5" (the 25% dealer column, the last of 5 price columns).
               Verified correct because Col.5 == Col.1 * 0.75 on every row.

What is excluded:
    * Champro JUICE custom-sublimated items (Standard/Express/Express+ pricing).
    * Champro decoration tables (WAVE/SURGE/braid/screenprint add-on pricing).

Names get the company name at the beginning ("A4 ..."/"Champro ...") to match the
catalog convention and the app's nameWithBrand() helper.
"""
import argparse, csv, json, re
import pdfplumber

# ---- A4 -------------------------------------------------------------------
A4_SKU = r'(N[A-Z]?\d{3,4}[A-Z]?|S\d{4})'
A4_ROW = re.compile(r'^' + A4_SKU + r'\s+(.+?)\s+\$?\s*([\d]+\.\d{2})\s*\$?$')

def extract_a4(path):
    out = {}
    for page in pdfplumber.open(path).pages:
        for line in (page.extract_text(x_tolerance=1.5) or '').split('\n'):
            m = A4_ROW.match(line.strip())
            if not m:
                continue
            sku, desc, price = m.groups()
            desc = desc.strip()
            if desc.lower() == 'description' or len(desc) < 3:
                continue
            out.setdefault(sku, {'sku': sku, 'desc': desc, 'cost': float(price)})
    return out

# ---- Champro --------------------------------------------------------------
UNIT  = r'(?:Ea\.?|Dz\.?|DZ\.?|Pr\.?|Sets?|Pk\.?|Pc\.?|Doz\.?)'
PRICE = r'(?:\$[\d,]+\.\d{2}|N/A)'
# [<cat page> | "- " clearance prefix] SKU  desc  [packqty] unit  p1 p2 p3 p4 p5
CP_ROW = re.compile(
    r'^(?:\d{1,3}\s+|-\s+)?'
    r'([A-Z0-9][A-Za-z0-9./#\-]{1,20})\s+(.+?)\s+(?:\d{1,4}\s+)?' + UNIT + r'\s+'
    r'(' + PRICE + r')\s+(' + PRICE + r')\s+(' + PRICE + r')\s+(' + PRICE + r')\s+(' + PRICE + r')$')

def _money(s):
    return None if s == 'N/A' else float(s.replace('$', '').replace(',', ''))

def extract_champro(path):
    out = {}
    for page in pdfplumber.open(path).pages:
        for line in (page.extract_text(x_tolerance=1.5) or '').split('\n'):
            m = CP_ROW.match(line.strip())
            if not m:
                continue
            sku, desc, p1, p2, p3, p4, p5 = m.groups()
            if 'JUICE' in desc.upper():        # exclude custom-sublimated items
                continue
            col1, col5 = _money(p1), _money(p5)
            if col5 is None:
                continue
            desc = re.sub(r'\s*-?\s*LIMITED QUANTITIES\s*$', '', desc, flags=re.I)
            desc = desc.strip(" ;-'").replace('  ', ' ')
            out.setdefault(sku, {'sku': sku, 'desc': desc, 'col1': col1, 'col5': col5})
    return out

# ---- SQL emit -------------------------------------------------------------
EXISTING = {'ns_49': {'FV', 'HC7', 'WBCCV'}, 'ns_23': set()}  # leave these untouched

def _sql(s): return "'" + s.replace("'", "''") + "'"
def _id(prefix, sku):
    clean = re.sub(r'\s+', '', sku).replace('/', '-')
    return prefix + '-' + clean

def build_rows(a4, champro, template_names):
    rows, seen = [], {}
    def add(prefix, vid, brand, sku, name, cost):
        if sku in EXISTING.get(vid, set()):
            return
        pid = _id(prefix, sku)
        if pid in seen:
            seen[pid] += 1; pid = f'{pid}-{seen[pid]}'
        else:
            seen[pid] = 0
        rows.append((pid, vid, sku, name, brand, round(float(cost), 2)))
    for sku, it in a4.items():
        add('a4', 'ns_23', 'A4', sku, f"A4 {it['desc']}".strip(), it['cost'])
    for sku, it in champro.items():
        if len(it['desc']) < 5 and sku in template_names:
            name = template_names[sku]                 # repair malformed PDF rows
        else:
            name = f"Champro {it['desc']}".strip()
        if not name.lower().startswith('champro'):
            name = f"Champro {name}".strip()
        add('cp', 'ns_49', 'Champro', sku, name, it['col5'])
    return rows

def emit_sql(rows, batch=400):
    out = []
    for i in range(0, len(rows), batch):
        vals = [f"({_sql(p)},{_sql(v)},{_sql(s)},{_sql(n)},{_sql(b)},{c},true)"
                for p, v, s, n, b, c in rows[i:i+batch]]
        out.append("INSERT INTO products (id,vendor_id,sku,name,brand,nsa_cost,is_active) VALUES\n"
                    + ",\n".join(vals)
                    + "\nON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, "
                      "nsa_cost=EXCLUDED.nsa_cost, brand=EXCLUDED.brand, "
                      "is_active=true, updated_at=now();")
    return "\n\n".join(out) + "\n"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--a4', required=True)
    ap.add_argument('--champro', required=True)
    ap.add_argument('--champro-template', default=None)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    tnames = {}
    if args.champro_template:
        for r in csv.DictReader(open(args.champro_template, newline='', encoding='utf-8', errors='replace')):
            tnames[r['Vendor Code'].strip()] = r['Product Name'].strip()

    a4, champro = extract_a4(args.a4), extract_champro(args.champro)
    rows = build_rows(a4, champro, tnames)
    open(args.out, 'w').write(emit_sql(rows))
    print(f"A4={sum(1 for r in rows if r[1]=='ns_23')} "
          f"Champro={sum(1 for r in rows if r[1]=='ns_49')} "
          f"total={len(rows)} -> {args.out}")

if __name__ == '__main__':
    main()
