#!/usr/bin/env python3
# Polls the NSA Portal machine manifest and keeps a local folder of DST files in
# sync with it. Meant to run as a systemd service on the shop-floor Raspberry Pi
# (see emb-bridge.service) — the folder it writes into is the FAT32 backing image
# the Pi exports to the Barudan via g_mass_storage.
#
# Stdlib only, no pip install needed on a fresh Raspberry Pi OS Lite image.

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request

PORTAL_URL = os.environ.get(
    'EMB_PORTAL_URL',
    'https://nsa-portal.netlify.app/.netlify/functions/emb-machine-manifest',
)
TOKEN = os.environ.get('EMB_MACHINE_TOKEN', '')
TARGET_DIR = os.environ.get('EMB_TARGET_DIR', '/mnt/usbdrive')
POLL_SECONDS = int(os.environ.get('EMB_POLL_SECONDS', '30'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('emb-bridge')


def fetch_manifest():
    req = urllib.request.Request(PORTAL_URL, headers={'x-machine-token': TOKEN})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def download(url, dest_path):
    # Download to a temp name and rename into place — rename is atomic on the
    # same filesystem, so the Barudan never sees a half-written DST file.
    tmp_path = dest_path + '.part'
    with urllib.request.urlopen(url, timeout=60) as resp, open(tmp_path, 'wb') as f:
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, dest_path)


def sync_once():
    manifest = fetch_manifest()
    designs = manifest.get('designs', [])
    wanted = {d['dst_name']: d for d in designs if d.get('dst_name') and d.get('url')}

    have = {f for f in os.listdir(TARGET_DIR) if f.upper().endswith('.DST')}

    added = skipped = failed = 0
    for name, design in wanted.items():
        if name in have:
            skipped += 1
            continue
        try:
            download(design['url'], os.path.join(TARGET_DIR, name))
            added += 1
            log.info('downloaded %s (%s)', name, design.get('dg') or design.get('art_name') or '')
        except Exception as e:
            failed += 1
            log.warning('failed to download %s: %s', name, e)

    stale = have - set(wanted)
    removed = 0
    for name in stale:
        try:
            os.remove(os.path.join(TARGET_DIR, name))
            removed += 1
            log.info('removed stale design %s', name)
        except OSError as e:
            log.warning('failed to remove %s: %s', name, e)

    log.info(
        'sync complete: %d active, %d added, %d skipped, %d removed, %d failed',
        len(wanted), added, skipped, removed, failed,
    )


def main():
    if not TOKEN:
        log.error('EMB_MACHINE_TOKEN is not set — refusing to start')
        sys.exit(1)
    os.makedirs(TARGET_DIR, exist_ok=True)
    log.info('emb-bridge starting: portal=%s target=%s interval=%ss', PORTAL_URL, TARGET_DIR, POLL_SECONDS)
    while True:
        try:
            sync_once()
        except urllib.error.HTTPError as e:
            log.warning('manifest fetch failed: HTTP %s', e.code)
        except Exception as e:
            log.warning('sync failed: %s', e)
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
