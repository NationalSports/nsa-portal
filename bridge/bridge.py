"""
NSA Portal -> M&R Hot Folder Bridge

Polls the Supabase `production_queue` table for pending jobs, downloads
the art file (.ai or .dst) plus the job-ticket PDF, then drops the art
into the ColorPRINT (or embroidery) hot folder so ColorPRINT auto-rips
and sends it to the i-Image S. Optionally prints the ticket PDF so the
press operator has a barcode to scan at the press.

Runs in a tight loop on the Windows PC attached to the M&R. Report
liveness into the `bridge_heartbeats` table so the portal admin page
can show a green/red dot for each bridge machine.
"""

import os
import sys
import time
import socket
import logging
import requests
from pathlib import Path
from datetime import datetime, timezone

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase package missing. Run: pip install supabase requests", file=sys.stderr)
    sys.exit(1)


# ── CONFIG ──────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SCREEN_HOT_FOLDER = Path(os.environ.get("SCREEN_HOT_FOLDER", r"C:\ColorPRINT\HotFolder"))
EMB_HOT_FOLDER = Path(os.environ.get("EMB_HOT_FOLDER", r"C:\Embroidery\HotFolder"))
TICKET_PRINT_FOLDER = Path(os.environ.get("TICKET_PRINT_FOLDER", r"C:\NSA-Bridge\TicketsToPrint"))
AUTO_PRINT_TICKETS = os.environ.get("AUTO_PRINT_TICKETS", "1") not in ("0", "false", "False", "")
POLL_INTERVAL_SEC = int(os.environ.get("POLL_INTERVAL_SEC", "30"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
HOSTNAME = socket.gethostname()

LOG_DIR = Path(os.environ.get("LOG_DIR", r"C:\NSA-Bridge\logs"))


# ── LOGGING ─────────────────────────────────────────────────
LOG_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / f"bridge-{datetime.now():%Y%m%d}.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("bridge")


# ── SETUP ───────────────────────────────────────────────────
if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    log.error("SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required")
    sys.exit(1)

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

for folder in (SCREEN_HOT_FOLDER, EMB_HOT_FOLDER, TICKET_PRINT_FOLDER):
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        log.warning(f"Could not ensure folder {folder}: {e}")


# ── HELPERS ─────────────────────────────────────────────────
def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def heartbeat() -> None:
    """Upsert a heartbeat so the admin page can show this bridge is alive."""
    try:
        sb.table("bridge_heartbeats").upsert(
            {"hostname": HOSTNAME, "last_seen": utcnow_iso()},
            on_conflict="hostname",
        ).execute()
    except Exception as e:
        log.warning(f"Heartbeat failed: {e}")


def download_file(url: str, dest: Path) -> bool:
    try:
        r = requests.get(url, timeout=120, stream=True)
        r.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                if chunk:
                    f.write(chunk)
        return True
    except Exception as e:
        log.error(f"Download failed for {url}: {e}")
        return False


def mark_delivered(queue_id: str) -> None:
    try:
        sb.table("production_queue").update({
            "hot_folder_status": "delivered",
            "delivered_at": utcnow_iso(),
            "delivered_by": HOSTNAME,
            "error_message": None,
            "updated_at": utcnow_iso(),
        }).eq("id", queue_id).execute()
    except Exception as e:
        log.error(f"mark_delivered failed for {queue_id}: {e}")


def mark_failed(queue_id: str, error: str) -> None:
    try:
        existing = sb.table("production_queue").select("retry_count").eq("id", queue_id).single().execute()
        retry_count = int((existing.data or {}).get("retry_count") or 0) + 1
        new_status = "failed" if retry_count >= MAX_RETRIES else "pending"
        sb.table("production_queue").update({
            "hot_folder_status": new_status,
            "error_message": (error or "")[:500],
            "retry_count": retry_count,
            "updated_at": utcnow_iso(),
        }).eq("id", queue_id).execute()
    except Exception as e:
        log.error(f"mark_failed bookkeeping failed for {queue_id}: {e}")


def safe_filename(name: str) -> str:
    """Strip characters Windows forbids in filenames."""
    bad = '<>:"/\\|?*'
    return "".join("_" if c in bad else c for c in name)


def process_row(row: dict) -> None:
    queue_id = row["id"]
    file_url = row["file_url"]
    file_name = row["file_name"]
    ticket_url = row.get("ticket_pdf_url")
    deco_type = row["deco_type"]
    barcode = row["barcode_value"]

    target_folder = SCREEN_HOT_FOLDER if deco_type == "screen_print" else EMB_HOT_FOLDER
    safe_name = safe_filename(f"{barcode}__{file_name}")
    dest = target_folder / safe_name

    log.info(f"Processing {queue_id} -> {dest}")

    if not download_file(file_url, dest):
        mark_failed(queue_id, "Art file download failed")
        return

    if ticket_url:
        ticket_dest = TICKET_PRINT_FOLDER / safe_filename(f"{barcode}.pdf")
        if download_file(ticket_url, ticket_dest):
            if AUTO_PRINT_TICKETS:
                try:
                    os.startfile(str(ticket_dest), "print")  # noqa: P201 (Windows-only)
                except Exception as e:
                    log.warning(f"Auto-print failed for {ticket_dest}: {e}")

    mark_delivered(queue_id)
    log.info(f"Delivered {queue_id} ({safe_name})")


def main_loop() -> None:
    log.info(f"Bridge starting on {HOSTNAME}")
    log.info(f"Screen hot folder:     {SCREEN_HOT_FOLDER}")
    log.info(f"Embroidery hot folder: {EMB_HOT_FOLDER}")
    log.info(f"Ticket print folder:   {TICKET_PRINT_FOLDER}")
    log.info(f"Poll interval:         {POLL_INTERVAL_SEC}s")

    while True:
        try:
            heartbeat()
            result = (
                sb.table("production_queue")
                  .select("*")
                  .eq("hot_folder_status", "pending")
                  .order("created_at")
                  .limit(10)
                  .execute()
            )
            rows = result.data or []
            if rows:
                log.info(f"Found {len(rows)} pending row(s)")
                for row in rows:
                    try:
                        process_row(row)
                    except Exception as e:
                        log.exception(f"Unexpected error processing {row.get('id')}: {e}")
                        mark_failed(row["id"], str(e))
        except Exception as e:
            log.exception(f"Main loop error: {e}")

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        log.info("Bridge stopped by user")
