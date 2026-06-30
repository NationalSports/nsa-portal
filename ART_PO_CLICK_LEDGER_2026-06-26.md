# Art PO + Art Application — Click-by-Click Ledger

**Date:** 2026-06-26 · **Companion to** `ART_PO_AUDIT_2026-06-26.md` (current-state).
**Model:** *one unified decoration flow; the in-house ↔ decorator branch happens when the
**PO is created / items are ordered** — never up front.*

---

## 0. The model in one line

> Today: a decoration is **born** in-house (`+ Add Art`) or outside (`+ Outside Deco`) and the
> fork is baked in at creation.
> **Proposed:** every decoration is just a **design** (placement + deco type + complexity + sell
> price). *Nothing* about who makes it is decided until the **ordering / PO step**, where the rep
> routes items: **leave it → in-house job**, or **drop it on a deco PO → decorator.**

```
  CREATE (estimate/SO)                       ORDER  ← the branch lives HERE
  ┌──────────────────────────┐               ┌───────────────────────────────────┐
  │ + Add Art / Numbers / Names│   ───────▶   │  Build & Order                     │
  │  • placement              │               │   each deco: ┌─ leave  → IN-HOUSE JOB│
  │  • deco type + complexity │               │              └─ Send… → DECO PO     │
  │  • sell price (customer)  │               │  (PO = the single in/out switch)   │
  └──────────────────────────┘               └───────────────────────────────────┘
   no in/out thought at all                    decide once, when it actually matters
```

**One rule downstream:** a decoration is in-house **unless it carries a `deco_po_id`**.
`buildJobs()` skips any decoration that's on a deco PO; everything else becomes a job. That's
the whole branch — presence of a PO link is the switch (`businessLogic.js:136`).

---

## 1. Counting convention

| Symbol | Means | Counts as |
|---|---|---|
| **●** | one pointer click | **1 click** |
| **▾** | native `<select>` (open **+** choose) | **2 clicks** — `(→1 as chips)` where a chip/segment halves it |
| **⌨** | one typed field | **1 entry** (tracked apart from clicks) |
| **⇄** | a board-lane drag | **1 click** |
| **↗** | leaves the app (manual email) | flagged, not a click |

**R** = irreducible decision · **O** = optimizable ceremony (defaulted/bulk/auto away in §6).
The **Eff.** column is the count after every **O** lever is applied.

> Reference order — **Servite Friars basketball**
> **Line 1:** 24 × Adidas Squadra25 → front logo *(existing art)* + back numbers + back names → **kept in-house**
> **Line 2:** 6 × embroidered polos → left-chest crest *(new art)* → **routed to a decorator at order time**
>
> Grounded controls: `addArtDeco` default placement `Front Center` (`OrderEditor.js:2028`);
> art picker `⚠️ Select / 🎨 Art TBD / ➕ New Art TBD / <files>` (`:3753-3755`);
> vendors auto-load + cost auto-fills (`:401`, `:6668-6676`); deco PO modal (`:6660-6744`).

---

## 2. Phase A — Create (estimate or SO line) · **no in/out decision exists here**

```
A1 new  A2 cust │ LINE 1 jerseys: garment → logo → numbers → names │ LINE 2 polos: garment → crest │ send
 ●        ●●       ●●● ⌨⌨⌨    ●●●     ●          ●                   ●●● ⌨⌨     ●●●●●               ●
```

| # | Actor | What they actually do | Naïve | Eff. | Flag | Note |
|---|------|----------------------|:---:|:---:|:--:|------|
| A1 | Rep | **New Estimate** | ●1 | 1 | R | |
| A2 | Rep | Customer → type "Servite" → pick | ●2 ⌨1 | 2 | R | |
| A3 | Rep | **Add Item** → "Squadra25" → pick | ●2 ⌨1 | 2 | R | |
| A4 | Rep | Color Maroon2/White | ▾2 | 1 | O | swatch chips |
| A5 | Rep | Price tier | ▾2 | 0 | O | auto from qty break |
| A6 | Rep | Size grid L=12 / XL=12 | ⌨2 | ⌨2 | R | |
| A7 | Rep | **+ Add Art** (front logo) | ●1 | 1 | R | placement auto Front Center → 0 |
| A8 | Rep | Picker → existing **Friars logo** | ▾2 | 2 | R | type + thumbnail + status inherited |
| A9 | Rep | **+ Numbers** (back) | ●1 | 1 | R | smart default placement Back → 0 |
| A10 | Rep | **+ Names** (back) | ●1 | 1 | R | smart default Back; default method |
| A11 | Rep | **Add Item** → "polo" → pick | ●2 ⌨1 | 2 | R | |
| A12 | Rep | Color | ▾2 | 1 | O | swatch chip |
| A13 | Rep | Size grid M=6 | ⌨1 | ⌨1 | R | |
| A14 | Rep | **+ Add Art** (crest) | ●1 | 1 | R | |
| A15 | Rep | Placement → Left Chest | ▾2 | 2 | R | not the default — a real choice |
| A16 | Rep | Picker → **➕ New Art TBD** (type captured inline) | ▾2 | 2 | R | creates `ART TBD 2`, Waiting for Art |
| A17 | Rep | Stitch bracket (prices the embroidery) | ▾2 | 2 | R | |
| A18 | Rep | **Send** estimate | ●2 | 1 | O | drop extra confirm |
| | | **Phase A** | **●27 ⌨5** | **●22 ⌨3** | | |

**Notice what's *gone* vs the old plan:** no `+ Outside Deco` button, no routing toggle, no
"TBD routing" chip. The rep never thinks about in-house vs outside while building the order.
Line 2's crest is created **identically** to an in-house design — same picker, same art file,
same approval lifecycle. (This is your "outside items behave just like Art TBD items.")

---

## 3. Phase B — Convert to SO · **one click; everything defaults in-house**

| # | Actor | What they do | Naïve | Eff. | Flag |
|---|------|-------------|:---:|:---:|:--:|
| B1 | Rep | **Convert to SO** | ●1 | 1 | R |

`buildJobs()` fires → logo, numbers, names **and** crest all become in-house jobs by default.
No "resolve routing" prompt — undecided just means in-house until a PO says otherwise. The
crest will leave that default the moment it's put on a PO (Phase C). If the rep *never* sends
it out, it simply stays an in-house job. **Zero ceremony for the common case.**

---

## 4. Phase C — Build & Order · **the branch**

Two independent tracks per decoration: **(a) route it** and **(b) art it** — in any order.

### 4a — Route the crest to a decorator (the in/out branch)

| # | Actor | What they do | Naïve | Eff. | Flag | Effect |
|---|------|-------------|:---:|:---:|:--:|------|
| C1 | Rep | On the crest, **Send to decorator** | ●1 | 1 | R | opens deco PO modal, that deco **pre-checked** |
| C2 | Rep | Vendor → Olympic *(cost/ea auto-fills)* | ▾2 | 2 | R | |
| C3 | Rep | Confirm qty (auto) → return date / notes → **Create** | ●1 ⌨2 | ●1 ⌨2 | R | stamps `deco_po_id` + `cost_each` |
| | | **Route-outside cost** | **●4 ⌨2** | **●4 ⌨2** | | crest job auto-removed; PO + Costs tab updated |

> The entire in-house→outside decision is **4 clicks at the PO step** — exactly "branch when the
> PO is created." Leaving a decoration in-house is **0 clicks** (the default).

### 4b — Art + approval (same for in-house and outside decorations)

| # | Actor | What they do | Naïve | Eff. | Flag |
|---|------|-------------|:---:|:---:|:--:|
| C4 | Rep | Logo reused art was **already approved** | ●3 | 0 | O — reuse-approved skips the loop |
| C5 | Rep | Mark production files (seps) | ●2 | 0 | O — gate auto-resolves by deco type (`:5700-5717`) |
| C6 | Rep | Crest: **apply real art** (vendor's digitized file) onto `ART TBD 2` | ●2 | 2 | R |
| C7 | Rep | **Send mockup for approval** → recipients (Select-All) → Send | ●3 | 2 | O — default-all (`:8955-8959`) |
| C8 | Coach | Open → **✅ Approve** | ●2 | 2 | R |
| | | **Art/approval** | **●12** | **●6** | |

**Headline behavior:** C6–C8 give the crest a real art file *and* full customer sign-off, yet
because C1–C3 put it on a PO, `buildJobs()` skips it — **approval without a job.** Impossible
today (today, attaching art forces a job; an outside item can't be approved at all because it
has no art file).

---

## 5. Scoreboard — the Servite order

```
                                CLICKS  ENTRIES  manual emails  real customer approval on outside item?
 ── TODAY (current code) ──────────────────────────────────────────────────────────────────────────
   crest via outside_deco flat ..  ~6      3          —          ✗ no art file
   + separate Deco PO ...........  ~6      3          1 ↗        ✗
   crest total ..................  ~12     6          1 ↗        ✗ broken / faked
 ── PROPOSED · efficient ──────────────────────────────────────────────────────────────────────────
   create crest (Phase A) .......  ~7      1          0          (same clicks as any in-house design)
   route to decorator (Phase C) .   4      2          0          —
   art + approval ...............   4      0          0          ✓ full mockup sign-off
   crest total ..................  ~15     3          0          ✓
```

The proposed crest costs a few more *clicks* than today's broken flow — but those clicks now
buy a **real art file, a tracked placeholder, a customer-approved mockup, auto-priced cost, and
zero manual emails or double entry.** And the **route-outside decision itself is only 4 clicks**,
made once, where the user wants it — at the PO.

---

## 6. Efficiency levers (every **O** → a design rule)

| Lever | Removes | Where |
|---|---|---|
| **No routing field at creation** | the entire old toggle (≥4 clicks/order) | branch lives at the PO instead |
| **In-house is the silent default; outside only via PO** | the conversion "resolve" step | `buildJobs` reads `deco_po_id` |
| **`Send to decorator` pre-checks the deco; qty + cost auto** | PO ceremony | `deco_refs` + auto-stamp (`:6731-6736`) |
| **Smart placement defaults** (logo⇒Front, numbers/names⇒Back) | A9/A10 placement | seed in `addArtDeco`/`addNumbers` |
| **Per-customer default method** | names/numbers method | item/customer prefs |
| **Color/tier as chips + auto-tier** | A4/A5/A12 (5 clicks) | swatch row vs `<select>` |
| **New-Art-TBD captures deco type inline** | a dropdown | fold type into the picker action |
| **Reuse-approved art skips approval** | C4 (3 clicks) | inherit `status:'approved'` |
| **Approval gate auto-resolves by deco type** | C5 (2 clicks) | EMB⇒auto-complete on .dst, SP⇒seps |
| **Recipients default to all + Select-All** | C7 | `OrderEditor.js:8955-8959` |
| **Drop redundant confirm modals** | 1/occurrence | inline banner vs `window.confirm` (`App.js:20877`) |
| **Coach "Approve all on order"** | N→1 | `CoachPortal.js:985` |

---

## 7. Decision tree, annotated with click cost

```
 NODE                              EFFICIENT CLICKS   IRREDUCIBLE?  WHAT THE REP IS DECIDING
 ─────────────────────────────────────────────────────────────────────────────────────────
 1  Decoration kind                ● 1                R   art vs numbers vs names
 2  Which design                   ▾ 2                R   existing / New-TBD / pricing-only
 2a   complexity (colors/stitch)   ▾ 2 (new art)      R   drives price
 2b   placement                    0 default / ▾ 2    R*  only when ≠ smart default
 ── (no in/out decision exists until ordering) ──
 3  Order: route this deco?        0 in-house / ● 1   R*  only to send out; default = job
 4  If outside: vendor + cost       ▾ 2 (cost auto)   R   who + cost of record
 5  Create / Link PO                ● 1               R   the single in/out switch
 6  Apply real art (any time)       ● 2               R   independent of routing → approval, not forced into a job
```

Nodes **3–5 are the branch**, and they only exist when the rep actually sends work out. The
common path (everything in-house) adds **zero** decisions beyond designing the art.

---

## 8. Data-model deltas (smaller than the old plan)

| Change | Detail |
|---|---|
| **`deco_po_id` on `*_item_decorations`** | nullable text. **Presence = outside.** Sole switch `buildJobs()` reads. |
| **`fulfillment` enum** | **Dropped from v1.** Not needed — there's no pre-PO "outside intent" anymore. (Optional later as a soft "planned outside" hint.) |
| **`deco_pos.deco_refs:[{item_idx,deco_index}]`** | target specific designs, not whole items (an item can have an outside logo + in-house numbers). `item_idxs` kept, derived. |
| **`buildJobs()` skip** | change `kind==='outside_deco'` → `d.deco_po_id || kind==='outside_deco'` (legacy rows still skip). |
| **`dP()` cost** (both `businessLogic.js` + `pricing.js`) | for a deco with `deco_po_id`: sell unchanged (customer price), cost from `cost_each` (PO unit cost). |
| **Costs tab** (`OrderEditor.js:4978`) | exclude `deco_po_id` decos from in-house deco cost (PO sum adds them). |
| **`+ Outside Deco` button** | becomes redundant — remove, or alias it to "open the PO step." Legacy `kind:'outside_deco'` rows keep rendering. |

---

## 9. Build order

1. **Phase 1 — branch core (no UI change):** `deco_po_id` column; `buildJobs` skip on
   `deco_po_id`; `dP` cost source; costs-tab predicate; `Send to decorator` stamps the deco;
   tests. *This alone delivers the unify+branch behavior on existing cards.*
2. **Phase 2 — Build & Order surface:** per-deco **Send to decorator** / **Keep in-house**
   control at the PO step; `deco_refs` precision; Outside lane on Jobs; smart defaults + chips.
3. **Phase 3 — ergonomics:** reuse-approved skip, auto-gate, Select-All recipients, coach
   approve-all, MobilePortal parity, drop confirm modals.
