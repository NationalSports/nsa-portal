# Claude Code Instructions

## Branch Naming

- At the start of each session, rename the current branch to `claude/<short-kebab-description-of-task>` based on what's being worked on (e.g., `claude/add-user-authentication`, `claude/fix-login-bug`).
- Use `git branch -m <new-name>` to rename, then push with `git push origin -u HEAD:<new-name>`.
- Keep names short (3-5 words max) and descriptive.

## Git Workflow

- Always show a summary of changes (diff or description) before pushing.
- After showing changes, push automatically without asking for confirmation.
- Push to the designated feature branch.
- After pushing, create a PR to merge into `main` but do NOT merge it automatically.
- After creating a PR, immediately subscribe to its activity so you can react to CI failures and review comments.
- Let the user review the deploy preview and test before merging.
- Only merge when the user explicitly approves.

## General

- Keep changes focused and minimal.
- Test that the app still runs after making changes.
