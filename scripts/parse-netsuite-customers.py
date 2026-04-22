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
    # Per user request 2026-04-22.
    "inderkum",
    "moreau catholic",
]

# Specific NetSuite Internal IDs to drop (duplicates, unwanted rows). Keyed by
# string because that's how they appear in the source file.
EXCLUDED_INTERNAL_IDS: set[str] = {
    "3858",  # NorCal Baseball dup #1
    "3893",  # NorCal Baseball dup #2 — user asked to drop both
}

# Name-level abbreviation expansion — applied globally before classification.
# Keeps the CSV looking clean and helps clustering (e.g. "Flag FB" wasn't in
# the sport-word list; now it becomes "Flag Football" which is).
ABBREVIATION_REWRITES: list[tuple[str, str]] = [
    (r"\bFlag\s*FB\b", "Flag Football"),
    (r"\bWomen'?sLax\b", "Women's Lacrosse"),
    (r"\bMen'?sLax\b", "Men's Lacrosse"),
    (r"\b(LAX|Lax)\b", "Lacrosse"),
    (r"(?<=\s)XC(?=\s|$)", "Cross Country"),
    (r"(?<=\s)VB(?=\s|$)", "Volleyball"),
    (r"(?<=\s)BB(?=\s|$)", "Basketball"),
]

# Specific row renames. Key = name as it appears in the source, Value = new
# name. Applied after abbreviation rewrites so both sides of the key can use
# the expanded form.
MANUAL_RENAMES: dict[str, str] = {
    "Dana Hills HS Flag Football": "Dana Hills High School",
    "Mira Costa HS Hockey": "Mira Costa High School",
    "Hercules HS Flag Football": "Hercules High School",
    "University HS Security": "University High School",
    "Fullerton HS Flag Football": "Fullerton High School",
}

# User-approved invented parents. Key is (root lowercase, city lowercase,
# state lowercase, inst) where `inst` is the institution type to force onto
# the invented parent AND all matching sub rows. Value is the parent name to
# create. Add entries here as the user resolves ambiguous clusters.
INVENTED_PARENTS: dict[tuple[str, str, str, str], str] = {
    ("exeter", "exeter", "ca", "hs"): "Exeter Union High School",
}

# Override the auto-generated name for an invented parent. Key is (root
# lowercase, state lowercase). Value is the exact name to use — whatever the
# clustering decides is the institution type, this wins. Useful when the
# dominant-hint heuristic picks "High School" for a school that's actually a
# College/University.
INVENTED_PARENT_NAME_OVERRIDES: dict[tuple[str, str], str] = {
    ("fresno pacific",   "ca"): "Fresno Pacific University",
    ("long beach state", "ca"): "Long Beach State University",
    ("mission",          "ca"): "Mission Prep High School",
}

# Manual sub assignments. Key = customer Name (exact), Value = parent Name
# (exact). Applied after clustering so user can override specific rows without
# touching the general rules. Great for edge cases where rep/address differs
# from the school's canonical values.
MANUAL_SUB_ASSIGNMENTS: dict[str, str] = {
    "Amador Girls Lacrosse (Boosters)": "Amador Valley High School",
    "Bakersfield Football": "Bakersfield High School",
    "Bakersfield Girls Basketball": "Bakersfield High School",
    "Bakersfield Track": "Bakersfield High School",
    # "OLu" = Orange Lutheran (user nickname for the school)
    "OLu": "Orange Lutheran High School",
    "OLu Creative Worship": "Orange Lutheran High School",
    "OLu Orange Lutheran Beach Volleyball": "Orange Lutheran High School",
    # Orange Lutheran (HS) was a collision fallback; merge its subs into the main.
    "Orange Lutheran High School - Information Technology": "Orange Lutheran High School",
    "Orange Lutheran High School Admissions": "Orange Lutheran High School",
    "Orange Lutheran HS Rugby": "Orange Lutheran High School",
    # Concordia Irvine: pull the Heritage Garden under the Athletics parent.
    "Concordia Heritage Garden": "Concordia University Athletics",
    "Concordia University Track and Field": "Concordia University Athletics",
    # Seton Catholic HS orphans (Vancouver WA).
    "Seton Drama Department": "Seton Catholic High School",
    "Seton Fishing": "Seton Catholic High School",
    "Seton Softball": "Seton Catholic High School",
    "Seton Track and Cross Country": "Seton Catholic High School",
    "Seton Track & Cross Country": "Seton Catholic High School",
    # Mission College (Santa Clara) — merge Saratoga orphan.
    "Mission College Women's Basketball": "Mission College",
    # Ridgeview HS (Bakersfield) — merge the Club orphan into Athletics.
    "The Ridgeview High School Athletics Club": "Ridgeview HS Athletics",
    # Single-token stems (too risky for auto-demote) — explicit manual.
    "Helix Campus Supervision": "Helix High School",
    "Dana Hills Girl's Water Polo": "Dana Hills High School",
    "Dana Hills Boy's Swim Team": "Dana Hills High School",
    # Alemany HS Dance / Girls Volleyball are Bishop Alemany subs — got
    # separated because their root stems to "Alemany" while the anchor stems
    # to "Bishop Alemany".
    "Alemany HS Dance": "Bishop Alemany HS",
    "Alemany HS Girls Volleyball": "Bishop Alemany HS",
}

# Cluster merges flatten a secondary parent into a primary parent.
# Every sub currently pointing to `src` is re-parented to `dst`, and `src`
# itself becomes a sub of `dst`.
CLUSTER_MERGES: dict[str, str] = {
    # Helix HS → one parent
    "Helix High School Athletics": "Helix High School",
    "Helix High School Girls Lacrosse": "Helix High School",
    "Helix (HS)": "Helix High School",  # collision-fallback auto-invent
    # Chapman University — collapse the two anchors + Women's Soccer + the
    # auto-invented "Chapman College" (collision fallback) into one.
    "Chapman University Women's Lacrosse": "Chapman University Athletics",
    "Chapman University Women's Soccer": "Chapman University Athletics",
    "Chapman College": "Chapman University Athletics",
    # Cal Poly — the user wants one parent for SLO + Cal Poly variants
    "Cal Poly Cross Country & Track and Field": "Cal Poly Athletics",
    "Cal Poly Racing": "Cal Poly Athletics",
    "Cal Poly Women's Baseball": "Cal Poly Athletics",
    "Cal Poly Friday Club": "Cal Poly Athletics",
    "Cal Poly Rodeo": "Cal Poly Athletics",
    "Cal Poly SLO Cheer": "Cal Poly Athletics",
    "Cal Poly SLO Dance Team": "Cal Poly Athletics",
    # Concordia — Katy TX is the separate standalone; merge into the main umbrella.
    # (User wants all Concordia together.)
    "Concordia University": "Concordia University Athletics",
    # University of Redlands — zip typo split the Womens rows into their own cluster.
    "University Of Redlands College": "University of Redlands Athletics",
    # College of San Mateo — collapse Athletics + Women's BB into one umbrella.
    "College of San Mateo Athletics": "College of San Mateo",
    "College of San Mateo Women's Basketball": "College of San Mateo",
}

# Tagged name swap: for pairs where the "older" NS ID should be the parent of
# the "newer" one (user confirmed for Santa Ana College).
NAME_SWAP_TAKE_LOWER_ID: set[str] = {
    "Santa Ana College",
}

# Sport/role suffix patterns — strip from a name to get the org root.
SPORT_PATTERNS = [
    r"(Boys|Girls|Boy's|Girl's|Men's|Women's)\s+(Basketball|Volleyball|Soccer|Track(?:\s*&?\s*Field)?|Lacrosse|Golf|Tennis|Swim(?:ming)?|Water Polo|Baseball|Softball|Cross Country|Wrestling|Football|Rugby|Beach Volleyball)$",
    r"(Track\s*&?\s*(?:&|and)?\s*Field|Cross Country|Water Polo|Sports Medicine|Flag Football|Beach Volleyball|Field Hockey|Aquatics)$",
    r"(Football|Basketball|Baseball|Softball|Volleyball|Soccer|Tennis|Golf|Wrestling|Swim(?:ming)?|Cheer(?:\s*&\s*Stunt)?|Dance|Drill Team|Band|Choir|Badminton|Lacrosse|Rugby|Track|Boosters?|Booster Club|Leadership|ASB|Athletics|Stunt|Intramurals?|PE|Store|Student Affairs|Foundation|Maintenance|Fundraiser|Sports|Admissions|Admin|Advancement|ESports|Spirit)$",
]

# Institution tokens — different institution types stay in SEPARATE clusters.
INSTITUTIONS = [
    ("dist", r"Unified School District.*$"),
    ("dist", r"School District$"),
    ("hs",   r"High School\s*-?\s*ASB$"),
    ("hs",   r"High School Athletics$"),
    ("hs",   r"High School$"),
    ("hs",   r"\bHS\b$"),
    ("hs",   r"Academy$"),            # most "X Academy" rows are HS-level charter/magnet schools
    ("hs",   r"Charter School$"),
    ("hs",   r"Charter Academy$"),
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
    ("hs",   r"\bAcademy\b"),
    ("hs",   r"\bCharter School\b"),
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

    # Special form: "University of X" / "College of X" — the institution word
    # leads the name and is part of the org name itself. Root = "University of
    # {WordAfterOf}" plus an optional second word only if that word is NOT a
    # sport/role (otherwise the root over-captures, e.g. "University of
    # Redlands Football"). Keeps "University of California Riverside" intact.
    m = re.match(r"^((?:The\s+)?(?:University|College)\s+of\s+\S+)\b",
                 s, flags=re.IGNORECASE)
    if m:
        head = m.group(1)
        rest = s[len(head):].strip()
        if rest:
            next_word = rest.split()[0]
            if not re.fullmatch(r"(?i)(" + SUB_ROLE_WORDS + r"|women'?s|men'?s|boys?|girls?|high|school|hs|college|university|academy|athletics)", next_word):
                head = head + " " + next_word
        return head.strip(), "col"

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

    # Drop rows by NetSuite Internal ID (user-flagged rows to remove).
    records = [r for r in records
               if (r.get("Internal ID") or "").strip() not in EXCLUDED_INTERNAL_IDS]

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

    # Apply abbreviation rewrites + manual renames NOW — after name recovery so
    # rows whose "Name" was originally blank (and recovered from ID / Address)
    # also get the rewrites.
    for r in records:
        name = (r.get("Name") or "").strip()
        for pat, repl in ABBREVIATION_REWRITES:
            name = re.sub(pat, repl, name)
        if name in MANUAL_RENAMES:
            name = MANUAL_RENAMES[name]
        if name != (r.get("Name") or "").strip():
            r["Name"] = name

    # Colon-split rule: a name like "Bishop Alemany HS: Admissions" means the
    # prefix before ":" is the parent's name and the full row is a sub. Rewrite
    # the row's Name (dropping the colon) and stash the parent hint. Parent will
    # be resolved later (existing anchor, invented parent, or standalone fallback).
    for r in records:
        name = (r.get("Name") or "").strip()
        if ":" not in name:
            continue
        prefix, suffix = name.split(":", 1)
        prefix = prefix.strip()
        suffix = suffix.strip()
        if not prefix or not suffix:
            continue
        if suffix.lower().startswith(prefix.lower()):
            new_name = suffix
        else:
            new_name = f"{prefix} {suffix}"
        r["Name"] = new_name
        r["_colon_parent_hint"] = prefix

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
    by_name_zip = _dd(list)
    by_name = _dd(list)  # same-name regardless of locality (weakest signal)
    for r in records:
        iid = (r.get("Internal ID") or "").strip()
        if iid:
            by_internal[iid].append(r)
        name = (r.get("Name") or "").strip().lower()
        a1 = (r.get("Address 1") or "").strip().lower()
        city = (r.get("City") or "").strip().lower()
        state = (r.get("State/Province") or "").strip().lower()
        zipc = (r.get("Zip Code") or "").strip().lower()
        if name and a1 and city and state:
            by_addr[(name, a1, city, state)].append(r)
        # Secondary: same name + zip + state (catches dupes where one has blank address)
        if name and zipc and state and len(zipc) >= 4:
            by_name_zip[(name, zipc, state)].append(r)
        # Weakest: identical name when at least one row has NO locality info —
        # almost always a true duplicate where one row is just missing data.
        if name:
            by_name[name].append(r)

    drop_set = set()
    dup_log = []
    for key, rows_grp in list(by_internal.items()) + list(by_addr.items()) + list(by_name_zip.items()):
        if len(rows_grp) < 2:
            continue
        ranked = sorted(rows_grp, key=lambda x: (-populated_score(x), x.get("Name", "")))
        keeper = ranked[0]
        for loser in ranked[1:]:
            if id(loser) == id(keeper) or id(loser) in drop_set:
                continue
            drop_set.add(id(loser))
            dup_log.append((loser, keeper, key))

    # Name-only dedup: drop a row when another row has the exact same name
    # AND the other row has real address data while this one has ~none. This
    # catches ghost records like a blank "University High School" that sit
    # alongside the real one.
    for name, rows_grp in by_name.items():
        if len(rows_grp) < 2:
            continue
        ranked = sorted(rows_grp, key=lambda x: (-populated_score(x), x.get("Name", "")))
        keeper = ranked[0]
        keeper_score = populated_score(keeper)
        if keeper_score < 4:
            continue  # not enough signal that the keeper is authoritative
        for loser in ranked[1:]:
            if id(loser) == id(keeper) or id(loser) in drop_set:
                continue
            if populated_score(loser) <= 1:
                drop_set.add(id(loser))
                dup_log.append((loser, keeper, ("name-only", name)))

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
            "_city": proto.get("City", "").strip().lower() or city_l,
            "_state": proto.get("State/Province", "").strip().lower() or state_l,
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

    # Cluster key includes institution + locality. Prefer the zip code as the
    # locality signal when available — sidesteps spelling drift between rows
    # (e.g. "Las Vegas" vs "North Las Vegas" for the same school).
    groups = defaultdict(list)
    for r in records:
        if not r["_root"]:
            continue
        zipc = (r.get("Zip Code") or "").strip()
        locality = zipc if zipc else r["_city"]
        key = (r["_root"].lower(), r["_inst"], locality, r["_state"])
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
            # No anchor. Auto-invent a parent if we have 2+ rows with a clear
            # shared pattern — the user can always re-parent in the UI if wrong.
            if len(rows) >= 2:
                # Pick a parent name from the dominant institution hint.
                names_lower = [r["_name"].lower() for r in rows]
                n_hs       = sum(1 for n in names_lower if re.search(r"\bhigh school\b", n))
                n_hs_abbr  = sum(1 for n in names_lower if re.search(r"\bhs\b", n))
                n_acad     = sum(1 for n in names_lower if re.search(r"\bacademy\b", n))
                n_ms       = sum(1 for n in names_lower if re.search(r"\bmiddle school\b", n))
                n_es       = sum(1 for n in names_lower if re.search(r"\belementary\b", n))
                n_col      = sum(1 for n in names_lower if re.search(r"\b(college|university)\b", n))
                # Pretty-case the root.
                pretty_root = " ".join(w.capitalize() for w in root_l.split())
                # User-supplied override for this (root, state) wins over the hint logic.
                override = INVENTED_PARENT_NAME_OVERRIDES.get((root_l, state))
                if override:
                    invented_name = override
                elif n_col > 0:
                    invented_name = f"{pretty_root} College"
                elif n_acad > 0:
                    # If ANY row calls it an "Academy", prefer that — academy is
                    # the specific institution name (overrides HS majority).
                    invented_name = f"{pretty_root} Academy"
                elif n_ms > 0 and n_ms >= max(n_hs, n_hs_abbr, n_es):
                    invented_name = f"{pretty_root} Middle School"
                elif n_es > 0 and n_es >= max(n_hs, n_hs_abbr, n_ms):
                    invented_name = f"{pretty_root} Elementary"
                else:
                    # Default for HS variants and sport-only rows.
                    invented_name = f"{pretty_root} High School"
                # If a row with the invented name already exists in the data,
                # don't create a duplicate — use that existing row as the anchor
                # and make our cluster rows its subs. Prefer same-state matches.
                invented_lower = invented_name.lower()
                existing_anchor = None
                for r in records:
                    if r.get("_name", "").lower() == invented_lower:
                        if r.get("_state", "") == state or not state or not r.get("_state", ""):
                            existing_anchor = r
                            break
                if existing_anchor:
                    # Promote the existing row to parent role (in case it was standalone)
                    # and attach our cluster rows to it. Skip synthesising a new one.
                    existing_anchor["_role"] = "parent"
                    existing_anchor["_parent_name"] = ""
                    for r in rows:
                        if r is existing_anchor:
                            continue
                        r["_role"] = "sub"
                        r["_parent_name"] = existing_anchor["_name"]
                    cluster_log.append({
                        "root": root_l, "inst": inst, "city": city, "state": state,
                        "parent": existing_anchor["_name"],
                        "subs": [r["_name"] for r in rows if r is not existing_anchor],
                        "reps": sorted({r["_rep"] for r in rows if r["_rep"]}),
                        "decision": "attached to existing same-named row",
                    })
                    continue
                # Build synthetic parent from the best-address member.
                proto = max(rows, key=lambda x: sum(1 for k in ("Address 1","City","State/Province","Zip Code") if x.get(k,"").strip()))
                syn = {
                    "Internal ID": "", "ID": "", "Name": invented_name,
                    "Duplicate": "", "Primary Contact": "", "Category": "",
                    "Primary Subsidiary": proto.get("Primary Subsidiary", ""),
                    "Sales Rep": proto.get("Sales Rep", ""),
                    "Partner": "", "Status": "CUSTOMER-Closed Won", "Phone": "", "Email": "",
                    "Address": "",
                    "Address 1": proto.get("Address 1", ""), "Address 2": proto.get("Address 2", ""),
                    "City": proto.get("City", ""), "State/Province": proto.get("State/Province", ""),
                    "Zip Code": proto.get("Zip Code", ""),
                    "_name": invented_name, "_root": pretty_root,
                    "_inst": inst if inst != "other" else "hs",
                    "_anchor": True,
                    "_city": proto.get("City", "").strip().lower(),
                    "_state": proto.get("State/Province", "").strip().lower(),
                    "_rep": proto.get("Sales Rep", ""),
                    "_real_email": False,
                    "_has_addr": bool(proto.get("Address 1", "").strip() and proto.get("City", "").strip() and proto.get("Zip Code", "").strip()),
                    "_synthetic": True, "_auto_invented": True,
                    "_role": "parent", "_parent_name": "",
                }
                records.append(syn)
                synthetic.append(syn)
                for r in rows:
                    r["_role"] = "sub"
                    r["_parent_name"] = invented_name
                cluster_log.append({
                    "root": root_l,
                    "inst": syn["_inst"],
                    "city": city,
                    "state": state,
                    "parent": invented_name,
                    "subs": [r["_name"] for r in rows],
                    "reps": sorted({r["_rep"] for r in rows if r["_rep"]}),
                    "decision": "auto-invented parent",
                })
            else:
                for r in rows:
                    r["_role"] = "standalone"
                    r["_parent_name"] = ""

    # Apply manual sub-assignment overrides (user has final say on specific rows).
    manual_applied = 0
    for r in records:
        target = MANUAL_SUB_ASSIGNMENTS.get(r.get("_name", ""))
        if target:
            r["_role"] = "sub"
            r["_parent_name"] = target
            manual_applied += 1

    # Cluster merges: demote `src` parent to a sub of `dst`, and re-parent
    # every existing child of `src` directly to `dst` (flatten).
    merges_applied = 0
    for src_name, dst_name in CLUSTER_MERGES.items():
        src = next((r for r in records if r.get("_name") == src_name), None)
        dst = next((r for r in records if r.get("_name") == dst_name), None)
        if not src or not dst:
            continue
        # Re-parent everyone under src → dst
        for r in records:
            if r.get("_parent_name") == src_name:
                r["_parent_name"] = dst_name
        # Demote src to sub of dst
        src["_role"] = "sub"
        src["_parent_name"] = dst_name
        merges_applied += 1

    # Name swap: for specific duplicate names, make the lower-ID row the canonical
    # parent and demote the higher-ID row to a sub of it.
    for dup_name in NAME_SWAP_TAKE_LOWER_ID:
        candidates = [r for r in records if r.get("_name") == dup_name]
        if len(candidates) < 2:
            continue
        candidates.sort(key=lambda x: int(x.get("Internal ID") or "99999999"))
        keeper = candidates[0]
        keeper["_role"] = "parent"
        keeper["_parent_name"] = ""
        for other in candidates[1:]:
            other["_role"] = "sub"
            other["_parent_name"] = keeper["_name"]

    # Within-cluster dedup: when two subs share the same name under the same
    # parent, they're the same team with different NetSuite Internal IDs. Keep
    # the most-populated one, drop the rest.
    from collections import defaultdict as _dd2
    by_name_parent = _dd2(list)
    for r in records:
        if r.get("_role") == "sub":
            k = (r["_name"].strip().lower(), r.get("_parent_name", "").strip().lower())
            if k[0] and k[1]:
                by_name_parent[k].append(r)
    within_dropped = 0
    for k, grp in by_name_parent.items():
        if len(grp) < 2:
            continue
        grp_sorted = sorted(grp, key=lambda x: (-populated_score(x), x.get("Name", "")))
        keeper = grp_sorted[0]
        for loser in grp_sorted[1:]:
            dup_log.append((loser, keeper, ("within-cluster", k[0])))
            within_dropped += 1
    if within_dropped:
        drop_ids_post = set()
        for loser, keeper, key in dup_log:
            if isinstance(key, tuple) and key[0] == "within-cluster":
                drop_ids_post.add(id(loser))
        records = [r for r in records if id(r) not in drop_ids_post]

    # Drop auto-invented parents that end up with zero subs (happens when manual
    # overrides pull all their children elsewhere). Invented parents have no
    # NetSuite Internal ID and _auto_invented flag.
    referenced_parent_names = {r.get("_parent_name", "") for r in records if r.get("_role") == "sub"}
    records = [r for r in records
               if not (r.get("_auto_invented") and r.get("_name") not in referenced_parent_names)]

    # Prefix-based demotion pass: childless "parent" rows whose name starts with
    # an umbrella parent's stem become subs of that umbrella. Catches
    # department-style rows (Creative Worship, Campus Supervision, Hockey,
    # Ambassadors, Formation, Heritage Garden, etc.) that my sport-word list
    # doesn't strip.
    def umbrella_stem(name: str) -> str:
        """Strip trailing institution words from a name to get its stem."""
        stripped = re.sub(
            r"\s+(High School Athletics|High School\s*-?\s*ASB|High School|"
            r"Middle School|Elementary School|Elementary|HS|Academy|College|"
            r"University|Charter School|Charter Academy|School District|"
            r"Unified School District.*)$",
            "",
            name,
            flags=re.IGNORECASE,
        ).strip()
        return stripped if stripped and stripped.lower() != name.lower() else ""

    # Rows that will end up as "account_type=parent" in the CSV = cluster parents
    # AND standalones (both render as parent in the output).
    parents_all = [r for r in records if r.get("_role") in ("parent", "standalone")]
    # Generic single-word stems that cause unrelated orgs to collapse. Skip
    # them for prefix-demotion (use MANUAL_SUB_ASSIGNMENTS for those cases).
    GENERIC_SINGLE_WORDS = {
        "university", "college", "orange", "central", "los", "san", "the",
        "saint", "st", "st.", "west", "east", "north", "south", "cal",
        "new", "academy", "charter", "christian", "public", "community",
    }
    umbrella_parents = []
    for p in parents_all:
        stem = umbrella_stem(p["_name"])
        if not stem:
            continue
        toks = stem.split()
        if len(toks) == 1 and toks[0].lower() in GENERIC_SINGLE_WORDS:
            continue
        umbrella_parents.append((p, stem))

    children_of = defaultdict(int)
    for r in records:
        if r.get("_role") == "sub":
            children_of[r.get("_parent_name", "")] += 1

    demoted = 0
    for r in records:
        if r.get("_role") not in ("parent", "standalone"):
            continue
        if children_of.get(r["_name"], 0) > 0:
            continue  # don't demote parents that already have subs
        if any(stem == r["_name"] for _, stem in umbrella_parents):
            continue  # skip if this row IS someone's stem target
        # Find longest-stem match in same state (+ city when both non-blank).
        best = None
        best_len = 0
        r_name_lower = r["_name"].lower()
        r_state = r.get("_state", "")
        r_city = r.get("_city", "")
        for p, stem in umbrella_parents:
            if p is r:
                continue
            p_state = p.get("_state", "")
            p_city = p.get("_city", "")
            if r_state and p_state and r_state != p_state:
                continue
            if r_city and p_city and r_city != p_city:
                continue
            stem_l = stem.lower()
            if r_name_lower.startswith(stem_l + " ") and len(stem) > best_len:
                best = p
                best_len = len(stem)
        if best:
            r["_role"] = "sub"
            r["_parent_name"] = best["_name"]
            demoted += 1

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
    print(f"manual sub overrides applied: {manual_applied}")
    print(f"cluster merges applied:       {merges_applied}")
    print(f"prefix-demoted to sub:        {demoted}")
    print(f"within-cluster dupes dropped: {within_dropped}")
    print(f"total rows in upload:         {len(upload_rows)}")
    print(f"  parents/standalone:         {pcount}")
    print(f"  subs:                       {scount}")
    print(f"clusters auto-attached:       {len(cluster_log)}")
    print(f"ambiguous clusters:           {len(ambiguous)}")
    print(f"needs-review rows:            {len(review_rows)}")
    print(f"output dir: {OUT_DIR}")


if __name__ == "__main__":
    main()
