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

### Claude CLI login (the bot's own account)

The worker spawns the `claude` CLI, which uses the Claude login stored on this
machine. That OAuth session can expire (tasks then fail with
"401 OAuth access token has expired"). Fix: run `claude` on the worker box and
log in again, or run `claude setup-token` for a long-lived token. For a fully
headless box, set `ANTHROPIC_API_KEY` in the environment instead — the CLI uses
it automatically and it never needs interactive re-login.

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

First find the exact paths on THIS machine (they differ by Mac):

```bash
which node            # e.g. /opt/homebrew/bin/node  (Apple Silicon) or /usr/local/bin/node
which claude          # e.g. /Users/YOU/.local/bin/claude
dirname "$(which node)"; dirname "$(which claude)"   # the two dirs for PATH below
echo $HOME            # your home path for /Users/YOU
```

Create `~/Library/LaunchAgents/com.nsa.botworker.plist`, substituting YOUR
paths. Two gotchas this handles: launchd starts with a bare PATH (so we set one
that includes node, npx, AND claude), and runs can take ~10–15 min (so we raise
`RUN_TIMEOUT_MS`):

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
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/Users/YOU/.local/bin:/usr/bin:/bin</string>
    <key>RUN_TIMEOUT_MS</key><string>1800000</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOU/nsa-portal/bot-worker/worker.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/nsa-portal/bot-worker/worker.log</string>
</dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.nsa.botworker.plist
tail -f ~/nsa-portal/bot-worker/worker.log    # should print "started. bot=bot-claude interval=30000ms"
```

The worker loops on `POLL_INTERVAL_MS` (default 30s), draining any backlog each
cycle. `KeepAlive` restarts it if it ever crashes or the Mac reboots.

**Keep the Mac mini awake** so it keeps polling even with no display attached:
```bash
sudo pmset -a sleep 0 disksleep 0      # never sleep (plug it in)
```

To update the worker later: `cd ~/nsa-portal && git pull`, then
`launchctl kickstart -k gui/$(id -u)/com.nsa.botworker` to restart it.

To stop it: `launchctl unload ~/Library/LaunchAgents/com.nsa.botworker.plist`.

> **Run it in ONE place only.** Don't also run the worker on your laptop — both
> would poll the same queue. (It's safe if they overlap — claims are atomic, so
> a task is only processed once — but keep it to the Mac mini.)

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

## TODO / Backlog

- **Backorder handling (deferred):** When a size/SKU is backordered on Adidas
  CLICK (cell shows 0 now but has a future delivery date, vs. truly
  unavailable), the bot should add what it can and **flag the backordered
  portion as a follow-up TODO/notice on the task** (in its needs_review
  comment) so a human can track it — not silently skip it. Use the Adidas
  availability + future-date info (the portal already stores futureDate/
  futureQty for Adidas inventory). Refine after observing a real backordered
  order. Decide: leave the backordered qty in the cart (approve as backorder)
  vs. remove it and reorder later.
