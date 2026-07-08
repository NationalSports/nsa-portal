# Claude Code Instructions

## Branch Naming

- At the start of each session, rename the current branch to `claude/<short-kebab-description-of-task>` based on what's being worked on (e.g., `claude/add-user-authentication`, `claude/fix-login-bug`).
- Use `git branch -m <new-name>` to rename, then push with `git push origin -u HEAD:<new-name>`.
- Keep names short (3-5 words max) and descriptive.

## Git Workflow

- Always show a summary of changes (diff or description) before pushing.
- After showing changes, push automatically without asking for confirmation.
- Push to the designated feature branch.
- After pushing, ALWAYS create a PR to merge into `main` automatically — do not wait for the user to ask. NEVER merge it automatically.
- After creating a PR, immediately subscribe to its activity so you can react to CI failures and review comments.
- Let the user review the deploy preview and test before merging.
- Only merge when the user explicitly approves.

## General

- Keep changes focused and minimal.
- Test that the app still runs after making changes.

## Operating Manual

- Before starting any non-trivial task (multi-file change, ambiguous request, or anything
  touching money/security/persistence paths), read `OPUS_OPERATING_MANUAL.md` — the
  working craft: request-reading, decomposition, risk allocation, verification,
  self-attack, communication. For large refactors or risky-path reviews, also read
  `FABLE_WORKING_PROCESS.md` (this repo's specific playbooks).
- Before sending any final answer or pushing any change, run the manual's self-test:
  1. Am I answering the need or the phrasing?
  2. Did I re-derive the most load-bearing claim, or does it just sound right?
  3. Can the reader separate my verified claims from my guesses from the text alone?
  4. What would prove this wrong — and did I actually look for it?
  5. If the reader stops after my first sentence, do they leave with the correct
     takeaway, including bad news and what's left undone?

## Working with Claude Fable 5

This repo is worked with Claude Fable 5. These habits get noticeably better results
(source: Anthropic's "Prompting Claude Fable 5" guide).

### How Claude should work here

- **Match the model to the task; don't burn Fable on easy work.** Fable 5 is the top tier
  and priced accordingly — reserve it for genuinely hard, long-horizon, or ambiguous work.
  For anything a lower tier handles just as well (routine edits, well-scoped changes,
  mechanical or repetitive work), downshift to Haiku or Sonnet. When a cheaper model is
  just as capable, use it. When in doubt, downshift.
- **Scope discipline.** Keep changes focused and minimal. Don't add features, refactor,
  or introduce abstractions beyond what the task requires — a bug fix doesn't need
  surrounding cleanup. This codebase already carries a lot of hand-synced duplicate logic
  (see `FABLE_SYSTEM_AUDIT_2026-07-03.md`); don't add more copies to keep in sync.
- **Act when you have enough to act.** Don't over-plan ambiguous tasks. If weighing a
  choice, give a recommendation, not an exhaustive survey.
- **Ground progress claims in tool results.** If tests fail, say so with the output; if a
  step was skipped, say that. Don't report work you can't point to evidence for.
- **Pause only when genuinely needed** — a destructive/irreversible action, a real scope
  change, or input only the user can provide.
- **Final summaries are for someone who didn't watch the work.** Lead with the outcome in
  a plain sentence, then the detail. Drop working shorthand and arrow-chains.
- **Don't echo internal reasoning as response text.** Instructions to transcribe or
  "explain your reasoning" can trigger a refusal and fall back to a weaker model. If
  reasoning visibility is needed, read the structured thinking blocks instead.

### How to prompt it (for the user)

- **Give the reason, not just the request** — "I'm building X for Y, they need Z; with
  that in mind, …". Intent lets it pull in the right context.
- **Steer with short instructions.** Long prescriptive rule-lists written for older models
  can actually degrade output — trim them.
- **Effort:** `high` is a good default, `xhigh` for the hardest work, `medium`/`low` for
  routine tasks.
