# Embroidery machine bridge (Raspberry Pi)

Turns a Raspberry Pi Zero 2 W into a permanent, WiFi-synced "USB stick" for the
Barudan BEKY-S1506CII. It polls the portal's `emb-machine-manifest` endpoint
over WiFi and keeps a local folder of DST files in sync; that folder is the
backing store the Pi exports to the Barudan over USB via gadget mode
(`g_mass_storage`), so the machine always sees current designs with no manual
USB stick swap.

## One-time Pi setup

Do this once you have a shell on the Pi (`ssh nsa@raspberrypi.local`).

**1. Create the virtual drive's backing file** (1GB FAT32 image — resize
`count=1024` if you need more room):

```bash
sudo dd if=/dev/zero of=/piusb.bin bs=1M count=1024
sudo mkdosfs /piusb.bin -F 32 -I
sudo mkdir -p /mnt/usbdrive
sudo mount -o loop /piusb.bin /mnt/usbdrive
```

**2. Enable the mass-storage gadget.** In `/boot/firmware/config.txt`:

```
dtoverlay=dwc2
```

In `/boot/firmware/cmdline.txt`, append to the single existing line (don't
add a newline — it's all one line):

```
modules-load=dwc2,g_mass_storage g_mass_storage.file=/piusb.bin g_mass_storage.stall=0 g_mass_storage.removable=1
```

This replaces the `g_ether` config we used earlier for USB debugging over the
Mac — the Pi only needs one gadget function at a time, and in production that
port is dedicated to the Barudan.

**3. Install the bridge script:**

```bash
sudo mkdir -p /opt/emb-bridge
sudo cp emb_bridge.py /opt/emb-bridge/
sudo cp emb-bridge.env.example /etc/emb-bridge.env
sudo nano /etc/emb-bridge.env   # fill in EMB_MACHINE_TOKEN (must match Netlify)
sudo cp emb-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now emb-bridge
sudo systemctl status emb-bridge     # confirm it's running
journalctl -u emb-bridge -f          # watch it sync live
```

**4. Set the matching token in Netlify** — Site settings → Environment
variables → add `EMB_MACHINE_TOKEN`. Suggested value (already random, just
use it or generate your own with `openssl rand -hex 24`):

```
4910d172224586e64c4cfa5b51580ff9175070078e654c34
```

Whatever value goes in Netlify must exactly match `/etc/emb-bridge.env` on
the Pi. Redeploy the site (or trigger a env-var-only restart) after adding it
— the manifest function reads it at cold-start.

## Known gap: writing while the Barudan has the drive open

Right now `emb_bridge.py` writes straight into `/mnt/usbdrive` (the same
backing file being exported live to the Barudan). That's fine for the DST
files themselves — writes are atomic (temp file + rename) so the Barudan
never sees a half-downloaded file — but two open writers on one FAT32 image
(the Pi's loop mount and the Barudan's own view over USB) can drift out of
sync, and some machines cache their file listing until the drive is
re-inserted.

The standard fix, once we're on-site and can test against the actual
Barudan's tolerance for it: briefly unbind the gadget's UDC before each sync
and rebind after, so only one side has the file open at a time. From the
Barudan's side this looks like a ~1-2 second drive removal/re-insertion per
sync cycle:

```bash
# unbind (before sync)
echo "" | sudo tee /sys/kernel/config/usb_gadget/*/UDC
# rebind (after sync)
echo "$(ls /sys/class/udc)" | sudo tee /sys/kernel/config/usb_gadget/*/UDC
```

Not wired into `emb_bridge.py` yet — deliberately, since the right blip
duration/timing depends on how the real machine reacts, which we can only
observe with it in front of us. Test this before leaving it running
unattended for a full shift.

## Files

- `emb_bridge.py` — the sync daemon (stdlib-only Python 3, no pip installs needed)
- `emb-bridge.service` — systemd unit, restarts on failure, starts on boot
- `emb-bridge.env.example` — copy to `/etc/emb-bridge.env` on the Pi and fill in the token
