#!/usr/bin/env python3
"""
Generate the NSA decoration price sheet (Screen Print + Embroidery) as a PDF.

Prices are 1.6x the portal's decoration COST. The cost tables AND the bracket
boundaries are read straight out of ../../src/lib/decoPricing.js (the single
source of truth used by both the webpack client and the Netlify functions), so
this sheet can never drift from the real portal matrix -- re-run after any change
and re-commit the PDF.

Pricing basis (shown in the sheet footnotes):
  sell = 1.6 x cost, rounded to the nearest $0.10 (the same rounding the portal
         applies to charged prices, decoPricing.rT).
  Embroidery honors the portal's $8.00/piece minimum (EM.fl); floored cells are
         flagged with *.
  Under-12 screen print is a flat per-order charge (SP bracket 0), shown at 1.6x
         its implied cost = (flat / SP.mk) x 1.6, rounded to the dollar.

NOTE: these are the committed DEFAULT cost tables. If deco pricing has been
overridden under Settings in the portal, that override lives only in that
browser's localStorage (nsa_settings) and is not visible here.

Usage:  python3 gen_price_sheet.py
Requires a Chromium/Chrome binary for HTML->PDF (auto-detected; override with
$CHROME). Outputs NSA_Price_Sheet_1.6x.pdf next to this script.
"""
import base64, json, math, os, re, shutil, subprocess, sys, tempfile, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DECO_JS = os.path.join(REPO, "src", "lib", "decoPricing.js")
LOGO = os.path.join(HERE, "nsa-logo.png")
OUT_PDF = os.path.join(HERE, "NSA_Price_Sheet_1.6x.pdf")

MARKUP = 1.6          # the one knob: this sheet is MARKUP x cost
OPEN = 99999          # a bracket bound >= OPEN means "and up" (open-ended)

# ── Read SP / EM tables from decoPricing.js (drift-free) ──
def _parse_literal(src, name):
    m = re.search(r'const\s+' + name + r'\s*=\s*(\{.*?\})\s*;', src)
    if not m:
        raise SystemExit(f"could not find `const {name}=...` in {DECO_JS}")
    # quote unquoted object keys (identifiers + integer keys) so it parses as JSON
    js = re.sub(r'([{,])\s*([A-Za-z_]\w*|\d+)\s*:', r'\1"\2":', m.group(1))
    try:
        return json.loads(js)
    except json.JSONDecodeError as e:
        raise SystemExit(f"failed to parse `{name}` from decoPricing.js: {e}")

_src = open(DECO_JS, encoding="utf-8").read()
SP = _parse_literal(_src, "SP")
EM = _parse_literal(_src, "EM")

# Fail loudly if the source shape changed, rather than emit wrong prices.
for _k in ("bk", "pr", "mk"):
    if _k not in SP:
        raise SystemExit(f"SP.{_k} missing — decoPricing.js shape changed; update this script.")
for _k in ("sb", "qb", "pr"):
    if _k not in EM:
        raise SystemExit(f"EM.{_k} missing — decoPricing.js shape changed; update this script.")

SP_PR = {int(k): v for k, v in SP["pr"].items()}   # {bracketIdx: [c1..cN cost]}
SP_BK = [(b["min"], b["max"]) for b in SP["bk"]]    # [(min,max), ...]
SP_MK = SP["mk"]
EM_PR = EM["pr"]                                    # [stitchIdx][qtyIdx] cost
EM_SB = EM["sb"]                                    # stitch upper bounds
EM_QB = EM["qb"]                                    # qty upper bounds
EM_FL = EM.get("fl", 0)
N_SP_COLORS = max(len(v) for v in SP_PR.values())
if len(SP_BK) != len(SP_PR):
    raise SystemExit("SP.bk / SP.pr length mismatch — decoPricing.js changed.")
if len(EM_PR) != len(EM_SB) or any(len(r) != len(EM_QB) for r in EM_PR):
    raise SystemExit("EM.pr / EM.sb / EM.qb shape mismatch — decoPricing.js changed.")

# ── Pricing primitives (mirror decoPricing.js rounding exactly) ──
def js_round(x):                     # JS Math.round: .5 rounds toward +inf (values here are positive)
    return math.floor(x + 0.5)

def rT(v):                           # nearest $0.10, same as decoPricing.rT
    return js_round(v * 10) / 10.0

def money(v):
    return "${:,.2f}".format(v)

def is_open(bound):
    return bound is None or bound >= OPEN

# ── Derive bracket labels from the parsed tables ──
def sp_qty_label(mn, mx):
    return f"{mn} +" if is_open(mx) else f"{mn} – {mx}"

def em_stitch_labels(sb):
    out, prev = [], 0
    for b in sb:
        if is_open(b):   out.append(f"Over {prev:,}")
        elif prev == 0:  out.append(f"Up to {b:,}")
        else:            out.append(f"{prev + 1:,} – {b:,}")
        prev = b
    return out

def em_qty_labels(qb):
    out, prev = [], 0
    for b in qb:
        if is_open(b):   out.append(f"{prev + 1} +")
        elif prev == 0:  out.append(f"1 – {b}")
        else:            out.append(f"{prev + 1} – {b}")
        prev = b
    return out

# ── Screen print: per-piece brackets 1..N (bracket 0 is a flat charge) ──
sp_rows = []
for bi in range(1, len(SP_BK)):
    row = SP_PR[bi]
    cells = [None if c is None else rT(c * MARKUP) for c in row]
    cells += [None] * (N_SP_COLORS - len(cells))     # pad short rows defensively
    sp_rows.append((sp_qty_label(*SP_BK[bi]), cells))

# under-12 flat charge (bracket 0): implied cost = flat / SP.mk; sell = *MARKUP, whole-dollar
sp_flat = [(ci, js_round((SP_PR[0][ci] / SP_MK) * MARKUP))
           for ci in range(len(SP_PR[0])) if SP_PR[0][ci] is not None]

# ── Embroidery: per piece, EM.fl floor ──
em_labels = em_stitch_labels(EM_SB)
em_rows, em_floored = [], set()
for si in range(len(EM_PR)):
    cells = []
    for qi in range(len(EM_PR[si])):
        raw = rT(EM_PR[si][qi] * MARKUP)
        sell = max(raw, float(EM_FL))
        if sell > raw:
            em_floored.add((si, qi))
        cells.append(sell)
    em_rows.append((em_labels[si], cells))
em_col_labels = em_qty_labels(EM_QB)

# ── HTML ──
logo_b64 = base64.b64encode(open(LOGO, "rb").read()).decode()
eff = datetime.date(2026, 7, 1).strftime("%B %Y")
NAVY, RED, INK, MUT, LINE, ALT = "#1a2a56", "#9e2033", "#1f2937", "#6b7280", "#e5e7eb", "#f6f7f9"

def sp_cell(v):
    return '<td class="na">—</td>' if v is None else f'<td>{money(v)}</td>'

def em_cell(v, floored):
    star = '<span class="star">*</span>' if floored else ''
    cls = ' class="fl"' if floored else ''
    return f'<td{cls}>{money(v)}{star}</td>'

sp_col_hdrs = "".join(f'<th>{i + 1} Color</th>' for i in range(N_SP_COLORS))
em_col_hdrs = "".join(f'<th>{lbl}</th>' for lbl in em_col_labels)

sp_body_parts = []
for i, (label, cells) in enumerate(sp_rows):
    alt = ' class="alt"' if i % 2 else ''
    tds = "".join(sp_cell(v) for v in cells)
    sp_body_parts.append(f'<tr{alt}><th scope="row">{label}</th>{tds}</tr>')
sp_body = "".join(sp_body_parts)

em_body_parts = []
for i, (label, cells) in enumerate(em_rows):
    alt = ' class="alt"' if i % 2 else ''
    tds = "".join(em_cell(v, (i, qi) in em_floored) for qi, v in enumerate(cells))
    em_body_parts.append(f'<tr{alt}><th scope="row">{label}</th>{tds}</tr>')
em_body = "".join(em_body_parts)

flat_chips = "".join(f'<span class="chip">{ci + 1} color {money(val)}</span>' for ci, val in sp_flat)

html = f"""<!doctype html>
<html><head><meta charset="utf-8"><style>
@page {{ size: Letter portrait; margin: 0.42in 0.5in; }}
@media print {{ body {{ zoom:0.93; }} }}
* {{ box-sizing: border-box; }}
html,body {{ margin:0; padding:0; }}
body {{ font-family:'DejaVu Sans',Arial,Helvetica,sans-serif; color:{INK}; font-size:11px; line-height:1.4; }}
.header {{ display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid {NAVY}; padding-bottom:10px; }}
.header img {{ height:54px; }}
.h-right {{ text-align:right; }}
.h-right .title {{ font-size:21px; font-weight:800; color:{NAVY}; letter-spacing:.3px; }}
.h-right .sub {{ font-size:11px; color:{RED}; font-weight:700; text-transform:uppercase; letter-spacing:2px; margin-top:2px; }}
.h-right .eff {{ font-size:10px; color:{MUT}; margin-top:3px; }}
.section {{ margin-top:16px; }}
.section h2 {{ font-size:14px; color:#fff; background:{NAVY}; margin:0; padding:6px 12px; border-radius:5px 5px 0 0; text-transform:uppercase; letter-spacing:1px; }}
.section .cap {{ font-size:10px; color:{MUT}; padding:5px 12px 0; }}
table {{ width:100%; border-collapse:collapse; }}
thead th {{ background:{ALT}; color:{NAVY}; font-size:10px; text-transform:uppercase; letter-spacing:.5px; padding:7px 6px; border-bottom:2px solid {NAVY}; text-align:center; }}
thead th.corner {{ text-align:left; background:#eef1f6; }}
tbody th {{ text-align:left; font-weight:700; color:{NAVY}; padding:6px 10px; background:#eef1f6; white-space:nowrap; border-bottom:1px solid {LINE}; }}
tbody td {{ text-align:center; padding:6px 6px; border-bottom:1px solid {LINE}; font-variant-numeric:tabular-nums; }}
tbody tr.alt th, tbody tr.alt td {{ background:{ALT}; }}
tbody tr.alt th {{ background:#e8ebf2; }}
td.na {{ color:#c3c7cf; }}
td.fl {{ color:{RED}; font-weight:600; }}
.star {{ color:{RED}; font-weight:700; }}
.spanhdr {{ font-size:9px; color:{MUT}; text-align:center; padding:2px 0 0; font-weight:400; text-transform:none; letter-spacing:0; }}
.notes {{ margin-top:13px; border-top:1px solid {LINE}; padding-top:9px; }}
.notes .row {{ display:flex; gap:22px; }}
.notes .col {{ flex:1; }}
.notes h3 {{ font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:{RED}; margin:0 0 5px; }}
.notes ul {{ margin:0; padding-left:15px; }}
.notes li {{ font-size:9.5px; color:{INK}; margin-bottom:3px; }}
.flatbox {{ background:{ALT}; border:1px solid {LINE}; border-radius:5px; padding:8px 12px; margin-top:8px; display:flex; align-items:center; gap:14px; font-size:10px; }}
.flatbox b {{ color:{NAVY}; }}
.flatbox .chip {{ display:inline-block; background:#fff; border:1px solid {LINE}; border-radius:12px; padding:2px 10px; font-weight:700; color:{NAVY}; }}
.foot {{ margin-top:13px; text-align:center; font-size:9px; color:{MUT}; border-top:1px solid {LINE}; padding-top:7px; }}
.foot b {{ color:{NAVY}; }}
</style></head><body>

<div class="header">
  <img src="data:image/png;base64,{logo_b64}" alt="National Sports Apparel">
  <div class="h-right">
    <div class="title">Decoration Price Sheet</div>
    <div class="sub">Screen Print &amp; Embroidery</div>
    <div class="eff">Per-piece pricing &middot; Effective {eff}</div>
  </div>
</div>

<div class="section">
  <h2>Screen Printing</h2>
  <div class="cap">Price <b>per piece, per print location</b>, by ink colors and order quantity.</div>
  <table>
    <thead>
      <tr><th class="corner" rowspan="2">Quantity</th><th colspan="{N_SP_COLORS}">Number of Ink Colors<div class="spanhdr">price per piece</div></th></tr>
      <tr>{sp_col_hdrs}</tr>
    </thead>
    <tbody>{sp_body}</tbody>
  </table>
  <div class="flatbox">
    <b>Small runs (under 12 pieces):</b>
    <span>flat per order &mdash;</span>
    {flat_chips}
    <span style="color:{MUT}">4+ colors quoted separately</span>
  </div>
</div>

<div class="section">
  <h2>Embroidery</h2>
  <div class="cap">Price <b>per piece, per logo / location</b>, by stitch count and order quantity. A standard left-chest logo runs ~8,000 stitches.</div>
  <table>
    <thead>
      <tr><th class="corner" rowspan="2">Stitch Count</th><th colspan="{len(em_col_labels)}">Order Quantity<div class="spanhdr">price per piece</div></th></tr>
      <tr>{em_col_hdrs}</tr>
    </thead>
    <tbody>{em_body}</tbody>
  </table>
</div>

<div class="notes">
  <div class="row">
    <div class="col">
      <h3>How pricing works</h3>
      <ul>
        <li>Screen print is priced <b>per color, per location, per piece</b> — a 3-color left chest is 3 colors.</li>
        <li>Embroidery is priced <b>per logo / location, per piece</b> by stitch count; <b>{money(EM_FL)} minimum</b> per piece.</li>
        <li>Add <b>15%</b> to screen print for an underbase / white base on dark garments.</li>
        <li>Additional locations price at the same matrix for their own color / stitch count.</li>
      </ul>
    </div>
    <div class="col">
      <h3>Notes</h3>
      <ul>
        <li><span class="star">*</span> Embroidery cell is at the <b>{money(EM_FL)}/piece minimum</b>; the raw rate would be lower.</li>
        <li>&mdash; = not offered at that color count / quantity (quoted on request).</li>
        <li>Small-run screen print (under 12) is a <b>flat charge for the whole order</b>, not per piece.</li>
        <li>Garment cost is separate. Art, digitizing, and rush fees quoted as applicable.</li>
      </ul>
    </div>
  </div>
</div>

<div class="foot"><b>National Sports Apparel</b> &nbsp;&middot;&nbsp; Prices are per piece unless noted &nbsp;&middot;&nbsp; Subject to change &nbsp;&middot;&nbsp; {eff}</div>

</body></html>"""

# ── Render to PDF via Chromium ──
def find_chrome():
    if os.environ.get("CHROME") and os.path.exists(os.environ["CHROME"]):
        return os.environ["CHROME"]
    for name in ("chromium", "chromium-browser", "google-chrome", "chrome"):
        p = shutil.which(name)
        if p:
            return p
    import glob
    for pat in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                "/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None

def main():
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(html)
        html_path = f.name
    try:
        chrome = find_chrome()
        if not chrome:
            alt = os.path.join(HERE, "price_sheet.html")
            shutil.copy(html_path, alt)
            print(f"No Chromium/Chrome found. Wrote HTML to {alt}; open it and Print to PDF, "
                  f"or set $CHROME to a Chromium binary and re-run.", file=sys.stderr)
            return 1
        cmd = [chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
               "--no-pdf-header-footer", f"--print-to-pdf={OUT_PDF}", "file://" + html_path]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("wrote", OUT_PDF)
    finally:
        os.unlink(html_path)

    # console audit of the computed numbers
    print("\n--- SCREEN PRINT (per piece, %gx cost, nearest $0.10) ---" % MARKUP)
    for label, cells in sp_rows:
        print(f"{label:<10} " + "".join(f"{(money(v) if v is not None else chr(8212)):>9}" for v in cells))
    print("Under-12 flat/order: " + "  ".join(f"{ci + 1}c {money(val)}" for ci, val in sp_flat))
    print("\n--- EMBROIDERY (per piece, %gx cost, %s floor) ---" % (MARKUP, money(EM_FL)))
    for label, cells in em_rows:
        print(f"{label:<16} " + "".join(f"{money(v):>9}" for v in cells))
    return 0

if __name__ == "__main__":
    sys.exit(main())
