# AI Bill-Matcher Mining Report — 2026-07-21

Production data pulled 2026-07-21 from `ai_bill_matches` (478 calls, 2026-06-23 →
2026-07-20), `applied_bills` (124 pushed), `supplier_bill_holds` (35), and
`bill_sku_aliases` (60). Purpose: find where the AI bill pipeline for the Sports Inc
(SportsLink) and S&S feeds wins, loses, and wastes, and pick the next improvements
from evidence instead of guesses.

## Headline numbers

| Pass | Model | Calls | Lines | high | medium | low | dropped* | unmatched | avg ms |
|---|---|---|---|---|---|---|---|---|---|
| reconcile | claude-sonnet-4-6 | 429 | 1,553 | 1,288 (83%) | 215 (14%) | 50 (3%) | 195 (13%) | 61 (4%) | 8.4s |
| find_po | claude-sonnet-4-6 | 49 | 212 | 93 (44%) | 24 (11%) | 95 (45%) | 0 | 90 (42%) | 14.1s |

\* dropped = the server-side closed-set validation rejected the model's pick
("SKU/size not on order") — the hallucination guard doing its job.

## Finding 1 — 79% of all calls were identical repeats (~695k wasted tokens)

379 of 478 calls were byte-identical re-runs: same doc, same bill lines, same order
state. Seven documents were each sent **24–26 times** over multiple weeks (e.g. docs
6165614440, 6165724818, 030458890). Cause: the client's `_aiReconcilePass` re-sweeps
every still-failing bill on each pull, client-side `_aiTried` flags don't survive a
re-pull, and the edge function had no cache. Of 978k total tokens, ~695k bought
answers we already had.

**Fixed in this branch:** migration `00230` adds `input_hash` + `response` to
`ai_bill_matches`; the edge function now hashes exactly what the model would see
(mode + context block) and replays the stored validated result on a hit
(`cached: true`), with `body.force = true` as the explicit fresh-opinion bypass.
Order-state changes change the hash, so staleness self-invalidates. No client change
needed — this works regardless of client state.

## Finding 2 — the eternal repeaters are a *deterministic* gap, not an AI gap

The top drop reasons are all the same shape: shoe-size bills against a bulk order
line — "dropped size: 11/10/9/8/7 not a bucket on JR9291" (24× each). The order
carries ONE bulk line with no size breakdown; the vendor bills by size; no size-label
mapping can ever succeed, so the bill fails over-billing forever and got re-sent to
the AI on every pull. `billResolve.js` already has the exact answer (the `bulk`
rollup tier — "bought in bulk, billed by size") but the reconcile path doesn't
consult it before calling AI. Second cluster: parser garbage reaching the model as a
size ("dropped size: QTY:2 not a bucket on KE5765/66/68") — an S&S/Sports Inc line
parser bug upstream of AI entirely.

**Next step (needs App.js — deferred until PR #1757 merges to avoid conflicting in
the same file):** run the deterministic bulk-rollup check before `_billNeedsAi`
queues an AI call, and fix the `QTY:n`-as-size parse. Cache already stops the cost
bleed in the meantime.

## Finding 3 — reconcile is easy for the model; find_po is the hard pass

Reconcile: 83% high-confidence, mechanical label mapping, guarded by closed-set
validation and a human approve. Find-PO: 45% of line mappings low-confidence, 42%
unmatched, ~14s/call — genuine judgment over candidate orders.

**Changed in this branch (per owner request to use lower tiers where appropriate):**
per-pass model defaults — reconcile → `claude-haiku-4-5-20251001`, find_po stays on
`claude-sonnet-4-6`. `AI_BILL_MATCHER_MODEL` still overrides both (existing-deploy
behavior preserved); `AI_BILL_MATCHER_MODEL_RECONCILE` / `_FINDPO` override per pass.
Watch the next ~2 weeks of `ai_bill_matches`: if Haiku's dropped/low rates on
reconcile exceed Sonnet's baseline (13% dropped / 3% low), flip
`AI_BILL_MATCHER_MODEL_RECONCILE` back — one env var, no redeploy of intent.
If find_po stays weak, the same var pattern makes a Sonnet 5 upgrade trivial.

## Finding 4 — the accept/override feedback loop has a missing wire

`applied_bills.resolution` is NULL on **all 124** pushed rows — the ledger never
records which proposal/AI mapping the human accepted or overrode, so "widen the
`cleanAutoAccept` gate" (the biggest labor win) can't be sized from data yet.
Aliases work (60 `bill_sku_aliases` rows since 2026-07-20 order-time learning,
#1740). **Next step:** populate `resolution` at push time with the accepted
proposal's basis/confidence and any human edits; re-run this mining in 2–3 weeks
to size the auto-accept widening.

## Vendor mix (pushed bills, for context)

Adidas 54 · SanMar 22 · Agron 12 · Augusta 9 · Richardson 7 · S&S 7 · Schutt 3 ·
UA 3 · others 7. Holds: 33 parked, 1 pushed, 1 error.

## Relationship to PR #1757

Consistent, no conflict: #1757 (CrossRef seeder → optional) removes a push-based
sync into S&S's broken endpoint in favor of the passive order-time alias learning
this report confirms is working (Finding 4). This branch touches only
`supabase/functions/ai-bill-matcher/index.ts`, migration `00230`, and this doc —
none of #1757's files.
