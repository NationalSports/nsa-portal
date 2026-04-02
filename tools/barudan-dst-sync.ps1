# ============================================================================
# Barudan DST File Sync — Network Share Edition
# ============================================================================
# Automatically downloads DST embroidery files from NSA Portal to a shared
# folder on this PC. The Barudan BEKY-S connects via Ethernet and reads
# designs from this shared folder. The USB port stays free for the barcode
# scanner.
#
# ── HOW IT ALL WORKS ────────────────────────────────────────────────────────
#
#   Art team uploads DST to portal (Cloudinary)
#        ↓
#   This script auto-downloads to C:\BarudanDesigns (every 5 min)
#        ↓
#   Barudan reads from \\THIS-PC\BarudanDesigns via Ethernet
#        ↓
#   Operator scans barcode on job sheet → design loads on machine
#
# ── ONE-TIME SETUP ──────────────────────────────────────────────────────────
#
#   ON THIS PC (shop floor):
#     1. Create folder: C:\BarudanDesigns
#     2. Right-click folder > Properties > Sharing > Share
#        - Share with "Everyone" (Read permission is enough)
#        - Note the network path shown (e.g. \\SHOP-PC\BarudanDesigns)
#     3. Edit the SETTINGS section below with your portal URL
#     4. Set up as a Scheduled Task (see below)
#
#   ON THE BARUDAN BEKY-S (Sigma panel):
#     1. Plug Ethernet cable into the port on the back of the machine
#     2. On Sigma panel: Menu > Setup > Communication > Network
#        - Set IP address (or DHCP if your network supports it)
#        - Set the design folder path to this PC's shared folder
#          e.g. \\SHOP-PC\BarudanDesigns
#     3. Plug USB barcode scanner into the USB port on the Sigma panel
#
#   SCHEDULED TASK (auto-run every 5 minutes):
#     Open PowerShell as Admin and paste this:
#
#     $action = New-ScheduledTaskAction -Execute "powershell.exe" `
#       -Argument "-WindowStyle Hidden -File C:\BarudanDesigns\barudan-dst-sync.ps1"
#     $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) `
#       -At "00:00" -Daily
#     $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
#       -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
#     Register-ScheduledTask -TaskName "Barudan DST Sync" `
#       -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest `
#       -Description "Downloads new DST files from NSA Portal for Barudan embroidery machines"
#
# ============================================================================

# ── SETTINGS (edit these) ───────────────────────────────────────────────────

# Your NSA Portal site URL (Netlify)
$PORTAL_URL = "https://your-site.netlify.app"

# Local shared folder where DST files are saved
# This is the folder you shared on the network for the Barudan to read from
$DST_FOLDER = "C:\BarudanDesigns"

# Auth token (optional — must match DST_SYNC_TOKEN env var in Netlify)
$AUTH_TOKEN = ""

# ── END SETTINGS ────────────────────────────────────────────────────────────

$syncUrl = "$PORTAL_URL/.netlify/functions/dst-sync"
$lastSyncFile = Join-Path $DST_FOLDER ".last-sync"
$logFile = Join-Path $DST_FOLDER "sync-log.txt"

function Log($msg, $color) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "$ts - $msg"
    if ($color) { Write-Host $line -ForegroundColor $color } else { Write-Host $line }
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

# Create folder if it doesn't exist
if (-not (Test-Path $DST_FOLDER)) {
    New-Item -ItemType Directory -Path $DST_FOLDER -Force | Out-Null
    Log "Created folder: $DST_FOLDER"
}

# Check last sync time for incremental sync
$since = ""
if (Test-Path $lastSyncFile) {
    $since = (Get-Content $lastSyncFile -Raw).Trim()
}

# Build request
$requestUrl = if ($since) { "$syncUrl?since=$since" } else { $syncUrl }
$requestHeaders = @{ "Content-Type" = "application/json" }
if ($AUTH_TOKEN) { $requestHeaders["Authorization"] = "Bearer $AUTH_TOKEN" }

Log "Checking for new DST files..."
if ($since) { Log "  Incremental since: $since" }

try {
    $response = Invoke-RestMethod -Uri $requestUrl -Headers $requestHeaders -Method GET -ErrorAction Stop
} catch {
    Log "ERROR: Could not connect to portal - $_" "Red"
    exit 1
}

if (-not $response.ok) {
    Log "ERROR: API returned error - $($response.error)" "Red"
    exit 1
}

$files = $response.files
$newCount = 0
$totalOnPortal = $response.count

Log "  $totalOnPortal DST file(s) on portal"

foreach ($file in $files) {
    $destPath = Join-Path $DST_FOLDER $file.name

    # Skip if file already exists (same name = same design)
    if (Test-Path $destPath) {
        continue
    }

    Log "  Downloading: $($file.name)  (SO: $($file.so_id), Art: $($file.art_name))" "Green"

    try {
        Invoke-WebRequest -Uri $file.url -OutFile $destPath -ErrorAction Stop
        $newCount++
    } catch {
        Log "  FAILED to download $($file.name): $_" "Red"
    }
}

# Save current timestamp for next incremental sync
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$now | Out-File -FilePath $lastSyncFile -NoNewline -Encoding UTF8

# Summary
$localCount = (Get-ChildItem -Path $DST_FOLDER -Filter "*.dst" -ErrorAction SilentlyContinue).Count
if ($newCount -gt 0) {
    Log "Downloaded $newCount new file(s) — $localCount total DST files in folder" "Green"
} else {
    Log "Up to date — $localCount DST files in folder"
}
