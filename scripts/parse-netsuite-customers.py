#!/usr/bin/env python3
"""
Parse a NetSuite customer export (SpreadsheetML .xls or CSV) and emit:
  - customers_upload.csv         -> ready for the portal bulk importer
  - customers_needs_review.csv   -> rows missing email / address for reps to fix
  - cluster_decisions.md         -> parent/sub clusters with confidence notes
  - ambiguous_clusters.md        -> clusters that need a human decision

Clustering is deliberately conservative:
  - An "anchor parent" (e.g. "Atascadero High School Athletics") must already
    exist in the list before we attach >=2 sub rows to it.
  - We do NOT invent new parents; those candidates are listed in
    ambiguous_clusters.md for the user to review.
  - Shawn McHugh's rows keep rep blank (pending reassignment).
  - NSA-internal emails (*@nationalsportsapparel.com) are treated as missing.
"""

import csv
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

NS = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
SS = "{urn:schemas-microsoft-com:office:spreadsheet}"

XML_PATH = Path("/tmp/customers575.xml")
OUT_DIR = Path("/home/user/nsa-portal/data/customer-import")
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ---------- parse the NetSuite XML export ----------

def _row_cells(row):
    out, idx = {}, 0
    for c in row.findall("ss:Cell", NS):
        ix = c.attrib.get(SS + "Index")
        idx = int(ix) if ix else idx + 1
        d = c.find("ss:Data", NS)
        out[idx] = (d.text or "").strip() if d is not None else ""
    return out


def load_records():
    tree = ET.parse(XML_PATH)
    ws = tree.getroot().find("ss:Worksheet", NS)
    rows = ws.find("ss:Table", NS).findall("ss:Row", NS)
    header = _row_cells(rows[0])
    headers = [header.get(i + 1, "") for i in range(max(header))]
    records = []
    for r in rows[1:]:
        d = _row_cells(r)
        records.append({h: d.get(i + 1, "") for i, h in enumerate(headers)})
    return records


# ---------- normalization helpers ----------

INTERNAL_DOMAIN = "@nationalsportsapparel.com"

# Customer names to exclude entirely (case-insensitive substring match on the
# row's Name). Excluded rows are written to customers_excluded.csv so they're
# not lost silently.
EXCLUDED_NAME_SUBSTRINGS = [
    # Per user request 2026-04-20.
    "christian brothers",
    "st. mary's",
    "st mary's",
    "st marys",
    "saint mary's",
    "saint marys",
    "dominican",
]

# User-approved invented parents. Key is (root lowercase, city lowercase,
# state lowercase, inst) where `inst` is the institution type to force onto
# the invented parent AND all matching sub rows. Value is the parent name to
# create. Add entries here as the user resolves ambiguous clusters.
INVENTED_PARENTS: dict[tuple[str, str, str, str], str] = {
    ("exeter", "exeter", "ca", "hs"): "Exeter Union High School",
}

# Sport/role suffix patterns — strip from a name to get the org root.
SPORT_PATTERNS = [
    r"(Boys|Girls|Boy's|Girl's|Men's|Women's)\s+(Basketball|Volleyball|Soccer|Track(?:\s*&?\s*Field)?|Lacrosse|Golf|Tennis|Swimming|Water Polo|Baseball|Softball|Cross Country|Wrestling|Football|Rugby)$",
    r"(Track\s*&?\s*Field|Cross Country|Water Polo|Sports Medicine|Flag Football|Beach Volleyball)$",
    r"(Football|Basketball|Baseball|Softball|Volleyball|Soccer|Tennis|Golf|Wrestling|Swimming|Cheer(?:\s*&\s*Stunt)?|Dance|Drill Team|Band|Choir|Badminton|Lacrosse|Rugby|Track|Boosters?|Booster Club|Leadership|ASB|Athletics|Stunt|Intramurals?|PE|Store|Student Affairs|Foundation|Maintenance|Fundraiser|Sports)$",
]

# Institution tokens — different institution types stay in SEPARATE clusters.
INSTITUTIONS = [
    ("dist", r"Unified School District.*$"),
    ("dist", r"School District$"),
    ("hs",   r"High School\s*-?\s*ASB$"),
    ("hs",   r"High School Athletics$"),
    ("hs",   r"High School$"),
    ("hs",   r"\bHS\b$"),
    ("ms",   r"Middle School$"),
    ("es",   r"Elementary School$"),
    ("es",   r"Elementary$"),
    ("col",  r"College Foundation$"),
    ("col",  r"College$"),
    ("col",  r"University$"),
    ("col",  r"Community College$"),
]

# An in-name institution marker. HS markers are checked BEFORE college because
# many high schools have "College" in their proper name (e.g. "St. Mary's
# College High School", "Orange Lutheran HS").
INSTITUTION_IN_NAME = [
    ("dist", r"\bSchool District\b"),
    ("ms",   r"\bMiddle School\b"),
    ("es",   r"\bElementary\b"),
    ("hs",   r"\bHigh School\b"),
    ("hs",   r"\bHS\b"),
    ("col",  r"\b(College|University)\b"),
]

# Words that mean this row is a *department / sub / activity* — never an anchor
# umbrella even if the name also contains "High School" / "University" etc.
SUB_ROLE_WORDS = (
    "football|basketball|baseball|softball|volleyball|soccer|tennis|golf|wrestling|"
    "swim|swimming|cheer|dance|drill team|badminton|lacrosse|rugby|track|"
    "boosters?|leadership|asb|stunt|intramurals?|pe|sports medicine|water polo|"
    "cross country|flag football|band|choir|store|foundation|maintenance|"
    "admin(?:istration)?|admissions|advancement|alumni relations|athletic training|"
    "development|financial aid|facilities|operations|services|student affairs|"
    "spiritual development|information technology|its department|registar|registrar|"
    "marketing(?: and communications)?|communications|event services|special events|"
    "student advisory|residential ed|saac|moon international center|esports|"
    "student development|strength|aquatics|field hockey|jr\\.? falcons|"
    "athletic trainers|women'?s basketball|men'?s basketball|women'?s soccer|"
    "men'?s soccer|women'?s volleyball|men'?s volleyball|women'?s water polo|"
    "men'?s water polo|women'?s lacrosse|women'?s golf|men'?s golf|women'?s tennis|"
    "women'?s beach volleyball|beach volleyball|track and field"
)


def _strip_once(s: str, patterns) -> tuple[str, str | None]:
    """If any pattern matches the tail, return (stripped, tag). Else (s, None)."""
    for tag, pat in patterns:
        new = re.sub(r"\s*:?\s*" + pat, "", s, flags=re.IGNORECASE).strip(" -:,")
        if new and new.lower() != s.lower():
            return new, tag
    return s, None


def classify(name: str) -> tuple[str, str]:
    """
    Returns (root, institution) where:
      root        = name with institution + sport/role suffixes stripped
      institution = 'hs' | 'ms' | 'es' | 'col' | 'dist' | 'other'
    """
    s = name.strip()

    # 1) Try to strip a single institution suffix (from the tail) — that tells us the type.
    stripped, inst = _strip_once(s, INSTITUTIONS)
    if inst:
        s = stripped
    else:
        # 2) No institution at the tail — see if one appears in the middle of the name.
        for tag, pat in INSTITUTION_IN_NAME:
            if re.search(pat, s, flags=re.IGNORECASE):
                inst = tag
                # Strip everything from the institution word to the end.
                s = re.sub(pat + r".*$", "", s, flags=re.IGNORECASE).strip(" -:,")
                break

    # 3) Strip sport/role suffixes iteratively.
    changed = True
    while changed:
        changed = False
        for pat in SPORT_PATTERNS:
            new = re.sub(r"\s*:?\s*" + pat, "", s, flags=re.IGNORECASE).strip(" -:,")
            if new and new != s:
                s = new
                changed = True
                break

    if not inst:
        inst = "other"
    return s.strip(), inst


def is_anchor_parent(name: str, institution: str) -> bool:
    """A row is an 'anchor' if it names an institution with no sport/role tail."""
    if institution not in ("hs", "ms", "es", "col", "dist"):
        return False
    n = name.lower()
    # "...High School Athletics" and "...High School - ASB" are legitimate umbrellas.
    if re.search(r"\bhigh school athletics\b", n):
        return True
    if re.search(r"\bhigh school\s*-\s*asb\b", n):
        return True
    # If any sub/role word appears, this row is a sub — not an anchor.
    if re.search(r"\b(" + SUB_ROLE_WORDS + r")\b", n):
        return False
    return True


def is_real_email(email: str) -> bool:
    e = (email or "").strip().lower()
    if not e or "@" not in e:
        return False
    if INTERNAL_DOMAIN in e:
        return False
    return True


def has_address(rec: dict) -> bool:
    return bool(rec.get("Address 1", "").strip() and rec.get("City", "").strip() and rec.get("Zip Code", "").strip())


def alpha_tag(name: str) -> str:
    letters = [w[0] for w in re.split(r"\s+", name.strip()) if w and w[0].isalnum()]
    return "".join(letters).upper()[:6]


# ---------- main pipeline ----------

def main():
    records = load_records()

    # NetSuite export glitches that leave Name blank. Recover in priority order:
    #   1) ID column contains the name (name landed there, ~864 rows).
    #   2) First line of the free-text "Address" field is the org name (~2 rows).
    for r in records:
        name = r.get("Name", "").strip()
        raw_id = r.get("ID", "").strip()
        if not name and raw_id and not raw_id.isdigit():
            r["Name"] = raw_id
            r["ID"] = ""
            continue
        if not name:
            addr_blob = (r.get("Address") or "").replace("\r", "\n")
            first = next((ln.strip() for ln in addr_blob.split("\n") if ln.strip()), "")
            if first and first.lower() != "united states":
                r["Name"] = first
                r["_name_recovered_from_address"] = True

    # Dedup pass — collapse obvious duplicates BEFORE clustering.
    # Key 1: NetSuite Internal ID when present.
    # Key 2: (name_lower, address1_lower, city_lower, state_lower) when all non-empty.
    # Within a duplicate group, keep the row with the most populated fields.
    def populated_score(r):
        fields = ["Primary Contact", "Phone", "Email", "Address", "Address 1",
                  "Address 2", "City", "State/Province", "Zip Code"]
        return sum(1 for k in fields if (r.get(k) or "").strip())

    from collections import defaultdict as _dd
    by_internal = _dd(list)
    by_addr = _dd(list)
    for r in records:
        iid = (r.get("Internal ID") or "").strip()
        if iid:
            by_internal[iid].append(r)
        name = (r.get("Name") or "").strip().lower()
        a1 = (r.get("Address 1") or "").strip().lower()
        city = (r.get("City") or "").strip().lower()
        state = (r.get("State/Province") or "").strip().lower()
        if name and a1 and city and state:
            by_addr[(name, a1, city, state)].append(r)

    drop_set = set()
    dup_log = []
    for key, rows_grp in list(by_internal.items()) + list(by_addr.items()):
        if len(rows_grp) < 2:
            continue
        ranked = sorted(rows_grp, key=lambda x: (-populated_score(x), x.get("Name", "")))
        keeper = ranked[0]
        for loser in ranked[1:]:
            if id(loser) == id(keeper) or id(loser) in drop_set:
                continue
            drop_set.add(id(loser))
            dup_log.append((loser, keeper, key))

    if drop_set:
        records = [r for r in records if id(r) not in drop_set]

    # Exclusion filter
    def excluded(name: str) -> str | None:
        n = name.lower()
        for sub in EXCLUDED_NAME_SUBSTRINGS:
            if sub in n:
                return sub
        return None

    kept, excluded_rows = [], []
    for r in records:
        tag = excluded(r.get("Name", "").strip())
        if tag:
            r["_excluded_reason"] = f"matched '{tag}'"
            excluded_rows.append(r)
        else:
            kept.append(r)
    records = kept

    # Tag rows
    for r in records:
        r["_name"] = r.get("Name", "").strip()
        root, inst = classify(r["_name"])
        r["_root"] = root
        r["_inst"] = inst
        r["_anchor"] = is_anchor_parent(r["_name"], inst)
        r["_city"] = r.get("City", "").strip().lower()
        r["_state"] = r.get("State/Province", "").strip().lower()
        r["_rep"] = r.get("Sales Rep", "").strip()
        r["_real_email"] = is_real_email(r.get("Email", ""))
        r["_has_addr"] = has_address(r)

    # User-approved invented parents: synthesize an anchor row and force every
    # matching (root, city, state) row into the same institution type.
    synthetic = []
    for (root_l, city_l, state_l, inst_target), parent_name in INVENTED_PARENTS.items():
        matches = [r for r in records
                   if r["_root"].lower() == root_l
                   and r["_city"] == city_l
                   and r["_state"] == state_l]
        if not matches:
            continue
        # Pull a representative address from the fullest matching row.
        proto = max(matches, key=lambda x: sum(1 for k in ("Address 1","City","State/Province","Zip Code") if x.get(k,"").strip()))
        syn = {
            "Internal ID": "",
            "ID": "",
            "Name": parent_name,
            "Duplicate": "",
            "Primary Contact": "",
            "Category": "",
            "Primary Subsidiary": proto.get("Primary Subsidiary", ""),
            "Sales Rep": proto.get("Sales Rep", ""),
            "Partner": "",
            "Status": "CUSTOMER-Closed Won",
            "Phone": "",
            "Email": "",
            "Address": "",
            "Address 1": proto.get("Address 1", ""),
            "Address 2": proto.get("Address 2", ""),
            "City": proto.get("City", ""),
            "State/Province": proto.get("State/Province", ""),
            "Zip Code": proto.get("Zip Code", ""),
            "_name": parent_name,
            "_root": root_l.title(),
            "_inst": inst_target,
            "_anchor": True,
            "_city": city_l,
            "_state": state_l,
            "_rep": proto.get("Sales Rep", ""),
            "_real_email": False,
            "_has_addr": bool(proto.get("Address 1", "").strip() and proto.get("City", "").strip() and proto.get("Zip Code", "").strip()),
            "_synthetic": True,
        }
        synthetic.append(syn)
        # Force matching rows into the same institution type so they cluster.
        for m in matches:
            m["_inst"] = inst_target
    records.extend(synthetic)

    # Promote: a plain sport row ("Atascadero Football", inst=other) should live
    # in the HS cluster IFF a HS anchor with the same root+city exists in the
    # data AND no MS/ES/COL/DIST anchor with the same root+city competes for it.
    # Build a lookup of (root, city, state) -> set of institution types with anchors.
    anchor_types_at = defaultdict(set)
    for r in records:
        if r["_anchor"] and r["_root"]:
            anchor_types_at[(r["_root"].lower(), r["_city"], r["_state"])].add(r["_inst"])

    for r in records:
        if r["_inst"] == "other" and r["_root"]:
            types = anchor_types_at.get((r["_root"].lower(), r["_city"], r["_state"]), set())
            # Only promote when HS is the sole institution type present for this root+location.
            # If multiple (e.g. both HS and MS anchors exist), leave as "other" — ambiguous.
            if types == {"hs"}:
                r["_inst"] = "hs"
            elif types == {"col"}:
                r["_inst"] = "col"

    # Cluster key now includes institution, so MS / HS / College stay separate.
    groups = defaultdict(list)
    for r in records:
        if r["_root"]:
            key = (r["_root"].lower(), r["_inst"], r["_city"], r["_state"])
            groups[key].append(r)

    # Decide parent per group
    # rec["_role"] = "parent" | "sub" | "standalone"
    # rec["_parent_name"] = name of parent (for subs)
    ambiguous = []  # groups >=3 without an anchor — ask user
    cluster_log = []  # every multi-row group decision

    # Default every row to standalone; clustering overrides below.
    for r in records:
        r["_role"] = "standalone"
        r["_parent_name"] = ""

    for key, rows in groups.items():
        root_l, inst, city, state = key
        if len(rows) < 2:
            for r in rows:
                r["_role"] = "standalone"
                r["_parent_name"] = ""
            continue

        anchors = [r for r in rows if r["_anchor"]]
        if anchors:
            # Pick the anchor with shortest name (most umbrella-like) as parent.
            anchor = sorted(anchors, key=lambda x: (len(x["_name"]), x["_name"]))[0]
            for r in rows:
                if r is anchor:
                    r["_role"] = "parent"
                    r["_parent_name"] = ""
                else:
                    r["_role"] = "sub"
                    r["_parent_name"] = anchor["_name"]
            reps = sorted({r["_rep"] for r in rows if r["_rep"]})
            cluster_log.append({
                "root": root_l,
                "inst": inst,
                "city": city,
                "state": state,
                "parent": anchor["_name"],
                "subs": [r["_name"] for r in rows if r is not anchor],
                "reps": reps,
                "decision": "auto-attached (anchor exists)",
            })
        else:
            # No anchor in this cluster.
            if inst == "other":
                # Sports-only cluster with no school row present.
                # Conservative: leave flat, flag if >=3 similar rows (user wants to review).
                for r in rows:
                    r["_role"] = "standalone"
                    r["_parent_name"] = ""
                if len(rows) >= 3:
                    ambiguous.append({
                        "root": root_l,
                        "inst": inst,
                        "city": city,
                        "state": state,
                        "rows": [r["_name"] for r in rows],
                        "reps": sorted({r["_rep"] for r in rows if r["_rep"]}),
                        "reason": f"{len(rows)} sport/activity rows share root '{root_l}' in {city}/{state} but no school anchor exists",
                    })
            else:
                # Rows all marked with same institution type (e.g. all 'hs') but no anchor
                # row exists (no "{root} High School" record). Could create one, but
                # conservative policy says ask the user.
                for r in rows:
                    r["_role"] = "standalone"
                    r["_parent_name"] = ""
                if len(rows) >= 2:
                    ambiguous.append({
                        "root": root_l,
                        "inst": inst,
                        "city": city,
                        "state": state,
                        "rows": [r["_name"] for r in rows],
                        "reps": sorted({r["_rep"] for r in rows if r["_rep"]}),
                        "reason": f"{len(rows)} {inst.upper()} rows for '{root_l}' — no umbrella record exists; consider creating one",
                    })

    # ---------- build output rows ----------

    UPLOAD_COLS = [
        "name", "alpha_tag", "account_type", "parent_name",
        "contact_name", "contact_email", "contact_phone", "contact_role",
        "billing_address_line1", "billing_address_line2", "billing_city", "billing_state", "billing_zip",
        "shipping_address_line1", "shipping_address_line2", "shipping_city", "shipping_state", "shipping_zip",
        "adidas_ua_tier", "catalog_markup", "payment_terms", "tax_rate",
        "sales_rep_name",  # importer auto-maps to primary_rep_id via fuzzy match
        "netsuite_internal_id", "netsuite_id", "notes",
    ]

    REVIEW_COLS = [
        "netsuite_internal_id", "netsuite_id", "name", "sales_rep_name",
        "missing_email", "missing_address", "internal_nsa_email",
        "email_raw", "phone", "address_raw",
        "city", "state", "zip", "parent_name", "reasons",
    ]

    upload_rows = []
    review_rows = []

    for r in records:
        name = r["_name"]
        if not name:
            continue

        # Rep handling — Shawn McHugh → blank
        rep_name = "" if r["_rep"].strip().lower() == "shawn mchugh" else r["_rep"]

        email = r.get("Email", "").strip()
        email_is_internal = INTERNAL_DOMAIN in email.lower() if email else False
        email_out = "" if email_is_internal else email

        missing_email = not r["_real_email"]
        missing_addr = not r["_has_addr"]

        reasons = []
        if missing_email:
            reasons.append("no customer email")
        if email_is_internal:
            reasons.append("had NSA-internal email (" + email + ")")
        if missing_addr:
            reasons.append("missing structured address")
        if r["_rep"].strip().lower() == "shawn mchugh":
            reasons.append("rep=Shawn McHugh (pending reassignment)")

        account_type = r["_role"] if r["_role"] in ("parent", "sub") else "parent"
        parent_name = r["_parent_name"] if r["_role"] == "sub" else ""

        upload_rows.append({
            "name": name,
            "alpha_tag": alpha_tag(name),
            "account_type": account_type,
            "parent_name": parent_name,
            "contact_name": "",
            "contact_email": email_out,
            "contact_phone": r.get("Phone", ""),
            "contact_role": "",
            "billing_address_line1": r.get("Address 1", ""),
            "billing_address_line2": r.get("Address 2", ""),
            "billing_city": r.get("City", ""),
            "billing_state": r.get("State/Province", ""),
            "billing_zip": r.get("Zip Code", ""),
            "shipping_address_line1": r.get("Address 1", ""),
            "shipping_address_line2": r.get("Address 2", ""),
            "shipping_city": r.get("City", ""),
            "shipping_state": r.get("State/Province", ""),
            "shipping_zip": r.get("Zip Code", ""),
            "adidas_ua_tier": "",
            "catalog_markup": "",
            "payment_terms": "",
            "tax_rate": "",
            "sales_rep_name": rep_name,
            "netsuite_internal_id": r.get("Internal ID", ""),
            "netsuite_id": r.get("ID", ""),
            "notes": "; ".join(reasons) if reasons else "",
        })

        if missing_email or missing_addr:
            review_rows.append({
                "netsuite_internal_id": r.get("Internal ID", ""),
                "netsuite_id": r.get("ID", ""),
                "name": name,
                "sales_rep_name": rep_name or r["_rep"],
                "missing_email": "yes" if missing_email else "",
                "missing_address": "yes" if missing_addr else "",
                "internal_nsa_email": "yes" if email_is_internal else "",
                "email_raw": email,
                "phone": r.get("Phone", ""),
                "address_raw": r.get("Address", ""),
                "city": r.get("City", ""),
                "state": r.get("State/Province", ""),
                "zip": r.get("Zip Code", ""),
                "parent_name": parent_name,
                "reasons": "; ".join(reasons),
            })

    # ---------- write files ----------

    with (OUT_DIR / "customers_upload.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=UPLOAD_COLS)
        w.writeheader()
        w.writerows(upload_rows)

    with (OUT_DIR / "customers_needs_review.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=REVIEW_COLS)
        w.writeheader()
        w.writerows(review_rows)

    # Excluded list — things we dropped on purpose (per user rules + dedup).
    with (OUT_DIR / "customers_excluded.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["netsuite_internal_id", "netsuite_id", "name", "sales_rep",
                    "city", "state", "excluded_reason"])
        for r in excluded_rows:
            w.writerow([
                r.get("Internal ID", ""),
                r.get("ID", ""),
                r.get("Name", ""),
                r.get("Sales Rep", ""),
                r.get("City", ""),
                r.get("State/Province", ""),
                r.get("_excluded_reason", ""),
            ])
        for loser, keeper, key in dup_log:
            w.writerow([
                loser.get("Internal ID", ""),
                loser.get("ID", ""),
                loser.get("Name", ""),
                loser.get("Sales Rep", ""),
                loser.get("City", ""),
                loser.get("State/Province", ""),
                f"dedup drop (keeper name: {keeper.get('Name','')})",
            ])

    # Cluster decisions report
    cluster_log.sort(key=lambda x: (-len(x["subs"]), x["parent"]))
    with (OUT_DIR / "cluster_decisions.md").open("w") as f:
        f.write("# Parent/Sub Cluster Decisions\n\n")
        f.write(f"Total clusters auto-attached: **{len(cluster_log)}**\n\n")
        for c in cluster_log:
            f.write(f"## {c['parent']}  *({c['inst'].upper()}, {c['city'] or '?'}/{c['state'] or '?'})*\n\n")
            f.write(f"- Reps: {', '.join(c['reps']) or '(none)'}\n")
            f.write(f"- Subs ({len(c['subs'])}): " + ", ".join(c["subs"]) + "\n\n")

    with (OUT_DIR / "ambiguous_clusters.md").open("w") as f:
        f.write("# Clusters needing human decision\n\n")
        f.write("These are look-alike groups where the conservative rule left rows as\n")
        f.write("standalone. Review and tell Claude which should become parent/sub.\n\n")
        ambiguous.sort(key=lambda x: -len(x["rows"]))
        for a in ambiguous:
            f.write(f"## {a['root']} ({a['inst'].upper()}) — {a['city'] or '?'}, {a['state'] or '?'}\n\n")
            f.write(f"- Reason: {a['reason']}\n")
            f.write(f"- Reps: {', '.join(a['reps']) or '(none)'}\n")
            f.write(f"- Rows ({len(a['rows'])}):\n")
            for row in a["rows"]:
                f.write(f"  - {row}\n")
            f.write("\n")

    # Summary
    pcount = sum(1 for x in upload_rows if x["account_type"] == "parent")
    scount = sum(1 for x in upload_rows if x["account_type"] == "sub")
    print(f"excluded rows (by name rule): {len(excluded_rows)}")
    print(f"duplicates dropped:           {len(dup_log)}")
    print(f"synthetic parents added:      {len(synthetic)}")
    print(f"total rows in upload:         {len(upload_rows)}")
    print(f"  parents/standalone:         {pcount}")
    print(f"  subs:                       {scount}")
    print(f"clusters auto-attached:       {len(cluster_log)}")
    print(f"ambiguous clusters:           {len(ambiguous)}")
    print(f"needs-review rows:            {len(review_rows)}")
    print(f"output dir: {OUT_DIR}")


if __name__ == "__main__":
    main()
