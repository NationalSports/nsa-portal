# Claude Code Instructions

## Git Workflow

- Always show a summary of changes (diff or description) before pushing.
- After showing changes, push automatically without asking for confirmation.
- Push to the designated feature branch.
- After pushing, create a PR to merge into `main` but do NOT merge it automatically.
- Let the user review the deploy preview and test before merging.
- Only merge when the user explicitly approves.

## General

- Keep changes focused and minimal.
- Test that the app still runs after making changes.
