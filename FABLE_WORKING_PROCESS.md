# Working like Fable — a process playbook for high-stakes changes

**Audience:** any capable model (Opus especially) picking up big or risky work in this
repo. Fable is the top tier and gets reserved for the hardest, longest-horizon,
most-ambiguous work; when a cheaper model takes on one of those tasks, this doc is how to
get to the same result. It is not about being slower — it's about *where* to spend effort:
on verification you can point to, not on confidence.

This is a companion to `CLAUDE.md` (read that first — branch/PR workflow, the "Working
with Claude Fable 5" habits, scope discipline). This doc is the *process* for the two
shapes of work that go wrong most often here: **large mechanical refactors** and
**changes to money/security/persistence paths**. It's distilled from the App.js
decomposition and the roster-lockdown review in the 2026-07-06 session.

---

## 1. The one idea, if you read nothing else

**Ground every claim in something you can point to.** Not "this should be
behavior-identical" — instead: "I ran a scope analysis; it reports zero writes to
outer-scope variables; here is the command and the output." The difference between a
Fable-quality result and a plausible-looking one is almost never intelligence — it's
whether the confident-sounding sentence is backed by a tool result or by vibes.

Corollary: **the codebase's dominant failure mode is hand-synced duplicate logic that
drifts** (see `FABLE_SYSTEM_AUDIT_2026-07-03.md` — ~half of recent PRs were fixing
regressions, mostly from copies falling out of sync). Every change should reduce the
number of copies that must be kept in step by hand, or at minimum not add one. When you
must add a copy (a security allow-list, a mirror), leave a pointer comment naming the
other copy so the next editor knows to sync it.

---

## 2. Altitude: match the depth of the fix to the depth of the problem

- A special case layered onto shared infrastructure is a smell — prefer generalizing the
  mechanism. (The roster review flagged a per-site dual-write pattern that repeats the same
  write twice; the deeper fix is one data-access layer, not ten paired copies.)
- A client-side guard is not a security boundary. If a service-role endpoint is the new
  authority, it must re-enforce every invariant the UI assumed — ownership *and* state
  (locked/submitted), not just ownership.
- Don't "fix" a symptom whose cause is elsewhere. Before a state-changing action (restart,
  migration apply, delete), check the evidence actually supports *that specific* action.

But also: **act when you have enough to act.** Altitude is not an excuse to over-plan.
Give a recommendation, not an exhaustive survey. The judgment is: bounded, reversible,
follows from the request → just do it. Destructive, outward-facing, or a real scope change
→ confirm first.

---

## 3. Playbook A — large mechanical refactor (e.g. extracting a page from a 30k-line file)

The App.js decomposition is the archetype: pull a page closure out of a giant component
into its own file, behind a stable interface, **provably behavior-identical**, one page
per PR. The reason it needs care: state is shared implicitly via closure, so moving code
silently changes what it can see. The safe method:

1. **Measure coupling before choosing what to move.** Use a Babel scope analysis (parse
   the file, find the target function's binding, walk its body, and for each referenced
   identifier ask whether it resolves to the enclosing scope vs module scope). Output: the
   exact set of outer bindings the closure reads. Rank extraction candidates by that count
   — smallest coupling first. Don't eyeball it; a 1,600-line function's real dependency
   surface is not readable by scanning.

2. **Prove the two safety preconditions mechanically, per target:**
   - **Hook-free / state-free:** grep the closure body for `useState/useEffect/useMemo/
     useRef/useCallback`. If the page owns no hooks and no local state (all state lives in
     the parent and flows through context), then mount/unmount on a page switch is
     behavior-identical. If it *does* own hooks, extraction is a different, harder task —
     stop and reconsider.
   - **Zero writes to outer scope:** a second AST pass for assignments/updates whose target
     binds to the parent or module scope. If the closure only reads outer state and mutates
     via setters, a context that passes the same setters through is transparent. A single
     outer-scope write means the closure is not cleanly liftable.

3. **Introduce the interface once, extend it per page.** A single context
   (`AppContext.js` / `useAppData()`) that the parent fills from its existing state each
   render. Extracted pages consume it instead of closing over scope. Each new page adds its
   bindings to the context value — keep the keys ES6-shorthand so they're literally the
   same parent bindings.

4. **Extract verbatim.** Move the function body unchanged; the only additions are the
   import header and a `const { ...deps } = useAppData()` destructure generated from the
   measured dependency set. Do not "improve" while moving — a refactor that changes
   behavior while relocating 1,600 lines is unreviewable.

5. **Machine-verify the result before building:**
   - Every identifier in the new file resolves (import, context destructure, local, or a
     known browser/React global) — an AST pass that lists unresolved references. Zero, or
     you've got a runtime `ReferenceError` waiting.
   - Every context key you added is a real parent-scope binding (a typo is a silent
     `undefined` prop).
   - The parent still parses clean.

6. **Then the human-visible gates:** production build clean, full unit suite green. Commit
   with the numbers in the message ("30,836 → 29,209 lines; 34/34 suites, 725 tests").

7. **One page per PR, e2e-green between each.** The blast radius of a mistake is one page,
   and each PR is small enough to actually review. Resist bundling.

> These AST checks are worth committing as reusable scripts under `scripts/` rather than
> rebuilt from scratch each session. If they're not there yet, that's a good first commit.

**Why this beats "just move it carefully":** past attempts at files like this stall because
each step requires holding dozens of closed-over variables in mind. The scope analysis does
that bookkeeping exactly, so the human/model judgment goes into *sequencing and safety*, not
into remembering which of 320 state variables a page touches.

---

## 4. Playbook B — reviewing a PR (or your own change) on a money/security/persistence path

This is the fan-out-then-adversarially-verify method used on the roster-lockdown PR. It
found 8 real issues (and correctly *refuted* 3 plausible-looking ones) precisely because
finding and judging were separated.

1. **Fan out independent finder angles**, each returning candidates with a *concrete
   failure scenario* (inputs → wrong output), not vibes. The angles that earn their keep:
   line-by-line diff scan; **removed-behavior auditor** (for every deleted line, name the
   invariant it enforced and find where it's re-established — or flag it); cross-file tracer
   (callers/callees of every changed signature); reuse/duplication; simplification;
   efficiency; **altitude** (is the fix deep enough?); conventions (CLAUDE.md violations,
   quoted exactly). Tell each finder to pass through every candidate with a nameable failure
   scenario — finders that self-censor half-beliefs are the main cause of misses.

2. **Dedupe, then verify each candidate with a *separate* adversarial pass.** The verifier's
   job is to *refute*: return CONFIRMED (name the trigger, quote the line), PLAUSIBLE
   (mechanism real, trigger uncertain), or REFUTED (quote the guarding line). This is where
   plausible-but-wrong findings die — three of the roster findings were refuted here (e.g. a
   "reopen submitted session" worry that a server function already guarded; a cross-family
   id injection into a column nothing reads). Separating find from judge is the whole trick.

3. **Report survivors most-severe-first, with the refutations noted.** A review that only
   lists hits, with no evidence of what was checked and cleared, isn't trustworthy. State
   what you traced.

The same structure works on your *own* big change before you call it done — you are not the
best judge of code you just wrote; spawn the skeptic.

---

## 5. Rollout & migration safety

- **A migration committed is not a migration applied.** Staged cutovers (reroute writes,
  *then* revoke the old path) must say so loudly and enforce ordering where possible. Apply
  the revoke only after the new path is deployed and verified — at a low-activity hour,
  because tabs opened on the old bundle still write the old way.
- **Make failures loud, not silent.** RLS-filtered UPDATE/DELETE from a now-unauthorized
  role "succeeds" affecting 0 rows — silent data loss. A table-privilege `REVOKE` turns that
  into a hard error the user actually sees. Prefer the loud failure.
- **Assert the change took.** A policy drop-loop that matches by pretty-printed expression
  can silently no-op against a differently-rendered live policy. Add a post-condition that
  raises if the intended end-state isn't true — a migration that reports success while
  changing nothing is worse than one that fails.
- **OAuth / external redirects don't round-trip through deploy previews** (they return to
  the whitelisted production origin). Don't diagnose that as a bug; test those flows on
  production, test everything else on the preview.

---

## 6. Communication

- Lead with the outcome in a plain sentence, then the detail. The reader stepped away and
  is catching up; they don't know the shorthand you invented mid-task.
- Everything the user needs — findings, numbers, the recommendation — goes in the final
  message of the turn, in prose. Don't make them reconstruct it from tool calls.
- Report faithfully: if a check was skipped or a test is red, say so with the output. "Done
  and verified" is only for things you verified.
- When you finish a big item, say what's *actually left* — don't round "much better" up to
  "done." End with a recommendation and, if useful, an offer; not a permission-request that
  blocks the work.

---

## 7. Anti-patterns (all observed causing regressions in this repo)

- Adding another hand-synced copy of a rule/table/column-list without a pointer to its twin.
- "Optimistic UI + swallowed write error" — updating state as if a save succeeded without
  checking it did. When a write path gains real failure modes (an HTTP hop, RLS), every site
  that ignored the old always-succeeds write is now a silent-data-loss bug.
- Testing a *mirror* module while production runs a different copy (green tests, wrong code).
  Verify the test imports the same module the runtime does.
- Improving code while relocating it in the same diff — makes a large move unreviewable.
- Trusting a confident sentence over a tool result. If you can check it, check it.
