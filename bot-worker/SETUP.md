# NSA Bot Worker — Mac mini setup

This is the "always-on CSR." It runs on your Mac mini, watches Supabase for
tasks assigned to **Claude (Bot)** in the portal, and uses Claude Code + a
browser (Playwright) to add a PO's items to a vendor cart and enter the PO#.
It **stops before submitting** — you approve and submit in the portal.

```
Portal: "🤖 Assign to Claude"  ──▶  assigned_todos (bot_status='queued')
                                          │  (same Supabase project)
Mac mini: worker.js polls ────────────────┘
   claims it → runs Claude Code w/ Playwright → fills the vendor cart
   → bot_status='needs_review' + posts a comment ──▶ you review & submit
```

## 1. Prerequisites (on the Mac mini)

- **Node.js 18+** — `brew install node`
- **Claude Code** — install and sign in once interactively so the worker can
  run it headlessly: see https://docs.claude.com/claude-code. Verify `claude --version`.
- Playwright's bundled Chromium. If a run stalls with no browser activity,
  install it once explicitly: `npx -y playwright install chromium`. We use the
  bundled browser (not your installed Chrome) so macOS doesn't prompt to grant
  Terminal "App Management" permission.

## 2. Configure

```bash
cd bot-worker
npm install
cp .env.example .env
# then edit .env
```

Fill in `.env`:

- `SUPABASE_URL` — the **same** URL the portal uses (`REACT_APP_SUPABASE_URL`).
- `SUPABASE_SERVICE_ROLE_KEY` — the **service-role** key (Supabase dashboard →
  Project Settings → API). This is what lets the worker read/update
  `assigned_todos` and bypass RLS. Treat it like a password.
- `BOT_MEMBER_ID` — leave as `bot-claude` (created by migration 00099).
- `ADIDAS_CLICK_URL` / `_USER` / `_PASS` — the vendor login the agent uses.

> **This is the "connection."** The worker and the portal aren't linked
> directly — they share one Supabase project. Point this `.env` at the same
> project your portal uses and the worker will see exactly the tasks you
> assign to Claude (and nothing else — it filters on `assigned_to = bot-claude`).

### Credentials & security

- `chmod 600 .env` at minimum. The vendor user/pass are injected into the
  agent's prompt at runtime.
- For real security, store secrets in the **macOS Keychain** and export them in
  the launchd job (below) instead of keeping them in `.env`:
  `security add-generic-password -a nsa -s adidas_click_pass -w` then read with
  `security find-generic-password -a nsa -s adidas_click_pass -w`.
- `--dangerously-skip-permissions` is used so the agent can drive the browser
  without interactive prompts. That's appropriate for a dedicated, locked-down
  worker box; `--allowedTools mcp__playwright__*` keeps it to browser tools.

## 3. Test it

1. In the portal, open a Sales Order, trigger a batch, and click
   **🤖 Assign to Claude** (or assign any task to "Claude (Bot)").
2. Run one pass and watch:

   ```bash
   npm run once
   ```

   It should claim the task, open a browser, log in, fill the cart, and post a
   comment back on the task in the portal with `bot_status = needs_review`.

## 4. Run it always-on (launchd)

Create `~/Library/LaunchAgents/com.nsa.botworker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nsa.botworker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/YOU/nsa-portal/bot-worker/worker.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/nsa-portal/bot-worker</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOU/nsa-portal/bot-worker/worker.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/nsa-portal/bot-worker/worker.log</string>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/com.nsa.botworker.plist
launchctl start com.nsa.botworker
tail -f bot-worker/worker.log
```

The worker loops on `POLL_INTERVAL_MS` (default 30s), draining any backlog each
cycle. `KeepAlive` restarts it if it ever crashes or the Mac reboots.

## Task lifecycle (bot_status)

`queued` → `in_progress` → `needs_review` (cart filled, awaiting your OK)
→ you submit on the vendor site and **close the task** in the portal.
On problems the worker sets `blocked` (e.g. CAPTCHA/2FA) or `failed` and explains
in a comment.

## Adding more vendors / task types

- New portal: add its creds to `.env` and a branch in `credsForTarget()` in
  `worker.js`. The vendor name → target slug mapping lives in
  `src/lib/botTasks.js` (`botTargetForVendor`).
- New task type (beyond `add_to_cart`): add a prompt template under `prompts/`
  and branch on `bot_payload.task_type` in `worker.js`.
