# Multi-Source Products — pooled stock, split fulfillment

**Status:** Draft for review · **Owner:** Steve · **Author:** Claude Code

## 1. Problem & goal

The same physical garment reaches us from more than one source under different
SKUs and slightly different names:

| Garment | Adidas-direct (CLICK) | Agron | S&S Activewear |
|---|---|---|---|
| Men's Pregame Tee | `JX4452` | — | `AT101` |
| Defender 5 Medium Duffel | `AB602-59` (CLICK) | `5159430`, `JJ7406` | (S&S #) |

Today each source is a **separate catalog item** (separate `products` rows,
separate cards), because the live-look / featured / store catalogs group styles
by **name** and the names differ. That's why you see two "Defender 5 Medium
Duffel" cards.

**Goal:**
1. **Show them as one** item, with **pooled availability** — a size counts as
   available if *any* source has it (e.g. M is out at Adidas + our warehouse but
   in stock at S&S → M still shows available).
2. **Split at ordering/fulfillment** — each size routes to the best source that
   actually has it, producing the correct per-vendor PO line.

## 2. Decisions (confirmed)

- **Build approach:** design/plan first (this doc), then phased build.
- **Linking method:** **Assisted** — auto-suggest matches (Adidas model number +
  name/attribute similarity), an admin confirms/rejects. No silent auto-merge.
- **Fulfillment routing:** **In-house first, then cheapest** — always ship what
  NSA physically owns; otherwise pick the lowest landed cost among sources that
  have the size. Manual override still available per line.

## 3. What already exists (so we build less)

- **Per-source inventory is already pooled** in the `inventory_unified` view —
  a `UNION ALL` of `adidas_inventory` (`click`), `agron_inventory` (`agron`),
  `ua_inventory`, `nike_inventory`, `richardson_inventory`, `momentec_inventory`,
  `sanmar_inventory`, and `ss_inventory` (`ss_activewear`). Keyed by `sku`+`size`,
  tagged with `source`. S&S stock already lives here (~16k rows).
- **Orders already carry a vendor per line** and **POs group by `vendor_id`**
  (`OrderEditor.js` `resolveVendor`). The editor can already **re-point a line to
  another vendor's matching product** (`OrderEditor.js:1510` `switchVendor`,
  `copyIWithSku`) — today it only finds equivalents that share the **same SKU**.
- We **already multi-source Adidas** (CLICK + Agron) — the mechanics exist; we're
  formalizing the relationship and automating the routing.

**Gaps to fill:** (a) a durable "these SKUs are the same garment" link, (b)
pooled availability in the catalog/store UIs, (c) automatic source allocation at
PO time, and (d) S&S's Adidas catalog isn't imported yet.

## 4. Data model

Products are stored **per colorway** (one row per `{style, color}` SKU) and a
"style" is just the set of colorways sharing a normalized name within a source.
The link is therefore at the **style** level, with color/size matched inside.

### New tables

```sql
-- One row per logical (cross-source) product.
create table product_groups (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,           -- shown on the merged card
  brand         text,                    -- 'Adidas'
  category      text,
  notes         text,
  created_at    timestamptz default now(),
  created_by    text
);

-- A source-style that belongs to a group. A group has 2+ members.
create table product_group_members (
  group_id   uuid references product_groups(id) on delete cascade,
  source     text not null,              -- 'click' | 'agron' | 'ss_activewear' ...
  style_key  text not null,              -- normalized name (or model #) per source
  vendor_id  text,                       -- the vendor these colorways buy from
  primary key (group_id, source, style_key)
);
```

`style_key` is how we tie a member back to its `products` rows: every product
whose `(inventory_source, normalized_name)` matches a member belongs to the
group. (Normalized name = upper/trimmed, the same key the catalog already groups
by.) We keep the link at style granularity so we don't have to maintain a row
per colorway.

> **Alternative considered:** a `style_group_id` column directly on `products`.
> Simpler to query, but it has to be re-stamped on every sync (syncs rewrite
> `products`), and it muddies the per-colorway table. The side tables above
> survive syncs because they key on `(source, style_key)`, which is stable.

### Runtime matching inside a group
- **Colorways** are matched across sources by **color family** (the existing
  `colorTags`/`COLOR_FAMILIES` logic) with exact color-name as a tiebreaker.
- **Sizes** are matched by normalized size label (existing `sizeRank`).
- Mismatches (a color/size one source has and another doesn't) are fine — they
  simply have fewer contributing sources for that cell.

## 5. Assisted linking (the crux)

A new **Settings → Product Links** admin screen:

1. **Suggestions feed.** For each brand, propose candidate groups by:
   - **Adidas model number** — CLICK names embed it (`"… (AB602)"`) and S&S uses
     it as the SKU (`AT101`/`AB602`). Strongest signal where present.
   - **Normalized-name similarity** — token overlap on the style name
     (e.g. "Defender 5 Medium Duffel" ≈ "Defender 5 Medium Duffel Bag").
   - **Attribute agreement** — same brand, same category, overlapping color set.
   Each suggestion shows the candidate styles side by side (image, source, SKU
   sample, color count, price) with a confidence score.
2. **Confirm / reject / edit.** Admin approves a link, removes a wrong member, or
   merges/splits groups. Approved links write `product_groups` +
   `product_group_members`. Nothing merges without confirmation.
3. **Manual link.** Search two styles and link them directly for cases the
   suggester misses (e.g. Agron's unrelated numbering).

This is the only labor-bearing step; everything downstream is automatic.

## 6. Pooled availability (display)

Wherever a style list is built (LiveLook `buildStyles`, Featured Styles editor,
webstore builder, store size grids), apply a **merge pass**:

- Replace each set of grouped styles with a single **display style** keyed by
  `group_id` (fallback: today's name key when ungrouped).
- The display style's colorways = union of members' colorways by color.
- Per **color+size availability** = the max across member sources of
  `inventory_unified` stock (plus our in-house `product_inventory`). "In stock"
  if any source > 0; show a small source hint on hover (e.g. "via S&S").
- One price on the card (from the **primary/in-house source**; see §8).

Result: one "Pregame Tee" card; its size chips reflect all sources combined.

## 7. Fulfillment routing (in-house → cheapest)

At allocation time (when an order/store is finalized into POs):

For each **color + size + qty** on the line:
1. Fill from **NSA in-house** stock first (`product_inventory`), up to qty.
2. For the remainder, rank the group's sources that have the size in
   `inventory_unified` by **landed cost** (`nsa_cost` for that source's SKU,
   plus any per-size cost / freight rule) and allocate to the cheapest, then the
   next, until filled.
3. Anything still unfilled → backorder on the primary source (flagged).

Each allocation becomes a **PO line against that source's real SKU + vendor**,
which the existing PO-by-vendor builder already groups and emits. Decoration/art
stays attached to the order item, not the purchasing SKU.

**Manual override:** the order editor keeps a per-line "source" picker (it
already has vendor-switching) pre-filled with the auto choice.

## 8. Pricing

- **Customer-facing price:** one number on the merged card — the **primary
  source's** `catalog_sell_price`/`retail_price` (primary = in-house/Adidas-direct
  by default). Avoids the price flickering by which source happens to be cheapest
  that day.
- **Internal cost / margin:** uses the **actual** source `nsa_cost` for the SKU
  ordered, so margin is correct per PO line even when routed to a pricier source.
  Surfacing a margin warning when the only in-stock source erodes margin is a
  nice-to-have.
- **Case packs / MOQ** differ by source (Agron vs S&S) — the allocator must
  respect each source's order multiple; flagged as an edge case (§11).

## 9. UI touch points

- **Settings → Product Links** (new): the assisted linker.
- **Featured Styles editor:** linked styles collapse to one card (with a "linked:
  N sources" chip); star/hide act on the group.
- **LiveLook (`AdidasInventory.js`):** `buildStyles` merge pass; size grid +
  modal show pooled stock with source hints.
- **Coach/webstore builder + storefront:** same merge pass; pooled size grid.
- **Order editor / PO:** auto source allocation + per-line override; PO preview
  shows the split.

## 10. Prerequisite: import S&S's Adidas catalog

S&S Adidas isn't in `products` yet (0 rows; only CLICK + Agron). The S&S plumbing
exists (`ss_inventory`, `ss_activewear` source, `ss-*-sync` functions), so this is
a focused add: an `ss-adidas-sync` that writes `products` (brand Adidas,
`inventory_source='ss_activewear'`) + `ss_inventory`, mapping S&S style/color/size
and the Adidas model number (for matching).

## 11. Edge cases & risks

- **Color/size sets differ** across sources → partial pooling per cell (handled).
- **Pricing drift** between sources → fixed display price, real cost per PO line.
- **Case packs / MOQ** differ (Agron cartons vs S&S) → allocator must round to
  each source's multiple; may overshoot a size.
- **Decoration** ties to the ordered SKU; ensure art/setup follows the allocated
  source, not the display product.
- **Sync timing** — availability is only as fresh as the last per-source sync;
  routing should re-check stock at PO time, not trust a stale merge.
- **Wrong links** → assisted-confirm only; links are editable and reversible.
- **Returns/exchanges** reference the real purchased SKU.
- **Don't double-count** the same physical pool — sources are distinct vendors,
  so summing *availability* is valid, but only in-house counts as "owned."

## 12. Rollout phases

- **Phase 0 — S&S Adidas import.** Gives a real second source to link (§10).
- **Phase 1 — Link layer + admin.** Tables + assisted Product Links screen
  (§4–5). No behavior change yet; just establish links.
- **Phase 2 — Pooled display.** Merge pass in LiveLook + Featured Styles editor
  (§6). Big visible win, low risk (display only).
- **Phase 3 — Pooled display in stores/order editor.** Size grids show combined
  stock; manual source override available.
- **Phase 4 — Auto source allocation at PO.** In-house → cheapest routing (§7),
  with override and margin flags. Highest value, most testing.

Each phase is independently shippable and reversible.

## 13. Open questions

1. **Primary source per group** — default to in-house/Adidas-direct for price &
   display? Or let the linker pick?
2. **Freight in "landed cost"** — include per-source freight/handling in the
   cheapest calc, or compare `nsa_cost` only to start?
3. **Case-pack handling** — overshoot to the next multiple, or prefer a source
   that fills exactly?
4. **Scope after Adidas** — UA (CLICK vs S&S) is the obvious next; confirm the
   model generalizes before widening.
