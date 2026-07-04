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

## Working with Claude Fable 5

This repo is worked with Claude Fable 5. These habits get noticeably better results
(source: Anthropic's "Prompting Claude Fable 5" guide).

### How Claude should work here

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
