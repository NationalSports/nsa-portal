# Public "Build Your Team Store" — Consumer-Facing Plan (2026-07-16)

**Vision:** a marketed, consumer-facing store builder on **nationalteamshop.com** — anyone picks
colors, drops a logo, adds in-stock items via a Live-Look-style search, and in ~60 seconds has a
**live, shareable** team store. A genuine viral funnel we can market hard.

## Owner model (2026-07-16)

**Instant + live, production gated by review:**
- Public build **publishes fully live immediately** — the store sells and **captures payment on the
  spot**. No upfront gate.
- **Nothing goes to production until staff approve the store, within 24h.**
- **If not approved:** captured orders are **auto-refunded** and the **store is closed**.

This preserves the marketing story (instant, live, takes orders) while the expensive/irreversible
step — production — waits behind a fast human check.

## The safety invariant (load-bearing)

**An order on a not-yet-approved store must be structurally incapable of reaching production.**
Everything else here is UX; this is the one thing that must never leak, because "resize drives
production" + public uploads = producing on unverified (possibly infringing/abusive) art.

- Add `approval_status` to `webstores`: `pending_review` (default for public-built) → `approved` →
  `rejected`, plus `approval_deadline` (created +24h), `approved_by/at`, `rejected_reason`.
- Hook the gate into the **existing release mechanisms — `00205_release_gate` /
  `00220_teamshop_stage_guard`** — do NOT add a parallel gate (the repo already fights hand-synced
  duplication). Every production path must check `approval_status='approved'` before acting:
  auto-art (`00207`), auto-PO (`00202`/`00211` DTF), auto-release (`00208`), pull-transfers
  (`00206`), and manual PO creation. Orders on `pending_review` stores sit in a **"held — awaiting
  store approval"** state.

## Payment flow

- **Capture at checkout** (owner's choice) → order lands **held** (production-blocked) whenever the
  store is `pending_review`.
- **Approve** → release held orders into the normal production flow.
- **Reject** → auto-refund every captured order (reuse `webstore_order_refunds` +
  the refund txn) and set the store closed.
- *Tradeoff to note:* capture-now means refund fees + possible chargebacks on rejects. A lower-cost
  alternative is **authorize-and-hold, capture on approval** — but auth holds expire (~7 days) and
  the owner explicitly wants payment taken immediately. Recorded, not changed.

## Review queue + 24h SLA (operational)

- A staff **"New public stores — review"** queue, sorted by `approval_deadline`, with alerts as the
  window closes.
- **Lapse behavior:** if 24h passes with no decision, orders **stay held and escalate** — do NOT
  auto-approve (auto-approve would defeat the IP/abuse protection). This makes the 24h an ops SLA we
  must staff.

## Cheap auto pre-screen at publish (recommended — no added friction)

Runs in milliseconds at publish, blocks only egregious cases instantly so they never go live, and
shrinks the public brand-exposure window from "up to 24h" to "obvious stuff never appears":
- **Logo quality gate** (resolution / transparency) — already planned.
- **Image moderation** (nudity/violence) via a vision call (reuse the Haiku/enrichment pattern).
- **Trademark/text hint** — flag obvious pro-team / big-brand names for priority human review.
Everything that passes still goes live + into the 24h human review. Egregious content is refused
inline.

## Customer expectation messaging (protects CX)

Order confirmation on a `pending_review` store must say the order is **confirmed and will enter
production once the team store is verified (usually within 24h)** — so a reject-refund reads as a
handled edge case, not a failure. Reduces disputes/chargebacks.

## IP posture

- **Logo-rights attestation** checkbox at publish ("I have the right to use this logo").
- The 24h review is the enforcement; reject → refund + close bounds exposure to <24h, and the auto
  pre-screen catches the obvious cases at second zero.

## Reuse map

| Need | Reuse |
|---|---|
| Public builder UI | `src/storefront/BuildStore.js` `mode="public"` (login-free /team-stores Build flow already exists) |
| Build validation (identity/pool/price-lock/stock-drop) | `supabase/functions/coach-store-submit/index.ts` |
| In-stock product search | Live Look catalog UI + existing in-stock resolver |
| Refunds | `webstore_order_refunds` + refund txn |
| Production gate | existing `release_gate` / `teamshop_stage_guard` |
| Live storefront host | nationalteamshop.com (portal SPA alias) |
| Marketing entry | nsa-website (nationalsportsapparel.com) → builder on nationalteamshop.com |

## Phases
1. **Approval state machine + production gate + held-order state** (the safety invariant — build
   first, before anything is public).
2. **Public build → publish-live + capture** (extend the `public` builder path).
3. **Reject → auto-refund + close; approve → release.**
4. **Review queue + 24h SLA alerting.**
5. **Auto pre-screen (quality + moderation + TM hint) + rights attestation + customer messaging.**
6. **Live-Look in-stock product search + coach resize (from `COACH_SELF_SERVE_STORE_PLAN`).**

Ship order matters: **the production gate (Phase 1) must exist before the public builder (Phase 2)
goes anywhere near production traffic.**
