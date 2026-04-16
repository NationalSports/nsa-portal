@echo off
REM ─── NSA Hot Folder Bridge launcher ─────────────────────────
REM Copy this file next to bridge.py, fill in the values below,
REM and run once to confirm it works. Then schedule via Task
REM Scheduler or NSSM (see README.md).
REM ─────────────────────────────────────────────────────────────

REM Supabase project URL (from Project Settings -> API)
set SUPABASE_URL=https://YOUR-PROJECT.supabase.co

REM Service role key (NOT the anon key) — keep this file off Git.
set SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY_HERE

REM ColorPRINT hot folder — confirmed via Printer Settings -> Device Settings -> Configure Port
set SCREEN_HOT_FOLDER=C:\ColorPRINT\HotFolder

REM Embroidery hot folder (network path OK if on a different PC)
set EMB_HOT_FOLDER=\\EMBROIDERY-PC\HotFolder

REM Where to drop downloaded ticket PDFs before auto-printing
set TICKET_PRINT_FOLDER=C:\NSA-Bridge\TicketsToPrint

REM Set to 0 to disable auto-print of ticket PDFs
set AUTO_PRINT_TICKETS=1

REM Polling interval (seconds)
set POLL_INTERVAL_SEC=30

cd /d "%~dp0"
python bridge.py
