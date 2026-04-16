# NSA Portal → M&R Hot Folder Bridge

Python watcher that runs on the Windows PC physically attached to the M&R
i-Image S (and optionally the embroidery machine PC). Polls the portal's
`production_queue` table and drops `.ai` sep files into the ColorPRINT hot
folder (or `.dst` files into the embroidery hot folder) so the RIP picks
them up and auto-burns the screens.

## One-time setup

1. **Install Python 3.11+** from python.org. During install, check
   **“Add Python to PATH.”**
2. Copy this `bridge/` folder to the M&R PC (e.g. `C:\NSA-Bridge\`).
3. Install dependencies:

   ```cmd
   cd C:\NSA-Bridge
   pip install supabase requests
   ```

4. Find the ColorPRINT hot folder:
   ColorPRINT → Printer Settings → Device Settings → Configure Port.
   Note this path; it goes into `SCREEN_HOT_FOLDER` below. Do the same
   for the embroidery machine (`EMB_HOT_FOLDER`). If the embroidery
   machine is on a different PC, either:
   - Run this bridge on both PCs (each one only picks up its own
     `deco_type`), **or**
   - Set `EMB_HOT_FOLDER` to a UNC path like `\\EMB-PC\HotFolder`.

5. Edit `run-bridge.bat` and fill in:
   - `SUPABASE_URL` — your project URL (Supabase → Settings → API)
   - `SUPABASE_SERVICE_KEY` — the **service role** key (NOT the anon key)
   - `SCREEN_HOT_FOLDER`, `EMB_HOT_FOLDER`, `TICKET_PRINT_FOLDER`

   Do **not** commit `run-bridge.bat` with the service key filled in.

6. Double-click `run-bridge.bat` to smoke test. A console window opens
   and within a few seconds you should see:

   ```
   Bridge starting on M&R-PC
   Screen hot folder:     C:\ColorPRINT\HotFolder
   …
   ```

   Leave it running. Upload an `.ai` prod file from the portal and watch
   the log — the file should land in the hot folder within ~60 seconds.

## Run at Windows startup

### Option A — Task Scheduler (simplest)

1. Task Scheduler → Create Task…
2. General: name **NSA Bridge**, select
   *Run whether user is logged on or not*.
3. Triggers: At startup.
4. Actions: Start a program → `C:\NSA-Bridge\run-bridge.bat`.
5. Settings: *Restart the task if it fails* every 1 minute, up to 99x.

### Option B — NSSM (true Windows service)

Download NSSM from https://nssm.cc, then:

```cmd
nssm install NSABridge "C:\NSA-Bridge\run-bridge.bat"
nssm set NSABridge AppStdout C:\NSA-Bridge\logs\stdout.log
nssm set NSABridge AppStderr C:\NSA-Bridge\logs\stderr.log
nssm start NSABridge
```

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | yes | — | Service role key — full DB access |
| `SCREEN_HOT_FOLDER` | yes | `C:\ColorPRINT\HotFolder` | Path the ColorPRINT RIP watches |
| `EMB_HOT_FOLDER` | yes | `C:\Embroidery\HotFolder` | Path the embroidery software watches |
| `TICKET_PRINT_FOLDER` | no | `C:\NSA-Bridge\TicketsToPrint` | Where ticket PDFs are saved before printing |
| `AUTO_PRINT_TICKETS` | no | `1` | Set to `0` to skip auto-printing |
| `POLL_INTERVAL_SEC` | no | `30` | Seconds between DB polls |
| `MAX_RETRIES` | no | `3` | Failed attempts before status flips to `failed` |
| `LOG_DIR` | no | `C:\NSA-Bridge\logs` | One log file per day |

## Verifying end-to-end

1. Artist uploads an `.ai` sep file from the portal as a production file.
2. Within ~60s the file should appear in the ColorPRINT hot folder and
   ColorPRINT should start ripping it automatically.
3. A matching ticket PDF should print on the default printer.
4. Press operator scans the printed barcode on the **Scan at Press**
   page of the portal — full job card shows up.
5. In the portal under **Hot Folder Queue** (admin), the row should
   show status **Delivered** with the bridge hostname.

## Troubleshooting

- **No rows show up in the portal queue.** Make sure the art file type
  was `.ai` (screen print) or `.dst` (embroidery) and the art group's
  `deco_type` was set correctly before upload. Other file types are
  intentionally skipped to keep junk out of the RIP.
- **Row stays "pending" forever.** Bridge isn't running or can't see
  the service key. Open `C:\NSA-Bridge\logs\bridge-YYYYMMDD.log`.
- **Row flips to "failed" quickly.** Check `error_message` in the
  admin queue page — usually a Cloudinary URL that got rotated, or
  the hot folder path doesn't exist.
- **Auto-print doesn't print.** Confirm the ticket PDF saved to
  `TICKET_PRINT_FOLDER`, then open a PDF manually and confirm the
  default printer works. The bridge uses `os.startfile(path, "print")`
  which respects Windows' default app for PDFs.
- **Embroidery file goes to the screen folder (or vice versa).** Check
  that the art group's `deco_type` is `embroidery` (for `.dst`) vs
  `screen_print` (for `.ai`) in the portal before uploading.
