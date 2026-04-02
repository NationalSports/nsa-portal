# ============================================================================
# Barudan DST File Sync
# ============================================================================
# Automatically downloads DST files from NSA Portal to a local folder
# for the Barudan BEKY-S to read from (USB drive or network share).
#
# SETUP:
#   1. Edit the 3 settings below
#   2. Right-click this file > "Run with PowerShell"
#   3. Or set up as a Windows Scheduled Task to run every 5 minutes
#
# SCHEDULED TASK (run every 5 min):
#   Open PowerShell as Admin and run:
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-File C:\path\to\barudan-dst-sync.ps1"
#   $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -At "00:00" -Daily
#   Register-ScheduledTask -TaskName "Barudan DST Sync" -Action $action -Trigger $trigger -RunLevel Highest
# ============================================================================

# ── SETTINGS (edit these) ───────────────────────────────────────────────────

# Your NSA Portal site URL (Netlify)
$PORTAL_URL = "https://your-site.netlify.app"

# Local folder where DST files are saved (USB drive or network share for Barudan)
# Examples:
#   "E:\Designs"              ← USB flash drive plugged into this PC
#   "D:\BarudanDesigns"       ← Local folder shared to Barudan via network
#   "\\SERVER\Designs"        ← Network share
$DST_FOLDER = "E:\Designs"

# Auth token (must match DST_SYNC_TOKEN env var in Netlify — leave empty if not set)
$AUTH_TOKEN = ""

# ── END SETTINGS ────────────────────────────────────────────────────────────

$syncUrl = "$PORTAL_URL/.netlify/functions/dst-sync"
$lastSyncFile = Join-Path $DST_FOLDER ".last-sync"

# Create folder if it doesn't exist
if (-not (Test-Path $DST_FOLDER)) {
    New-Item -ItemType Directory -Path $DST_FOLDER -Force | Out-Null
    Write-Host "Created folder: $DST_FOLDER"
}

# Check last sync time for incremental sync
$since = ""
if (Test-Path $lastSyncFile) {
    $since = Get-Content $lastSyncFile -Raw
    $since = $since.Trim()
}

# Build request URL
$requestUrl = $syncUrl
if ($since) {
    $requestUrl = "$syncUrl?since=$since"
}

# Build headers
$requestHeaders = @{ "Content-Type" = "application/json" }
if ($AUTH_TOKEN) {
    $requestHeaders["Authorization"] = "Bearer $AUTH_TOKEN"
}

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Checking for new DST files..."
if ($since) { Write-Host "  Since: $since" }

try {
    $response = Invoke-RestMethod -Uri $requestUrl -Headers $requestHeaders -Method GET -ErrorAction Stop
} catch {
    Write-Host "ERROR: Could not connect to portal - $_" -ForegroundColor Red
    exit 1
}

if (-not $response.ok) {
    Write-Host "ERROR: API returned error - $($response.error)" -ForegroundColor Red
    exit 1
}

$files = $response.files
$newCount = 0

Write-Host "  Found $($response.count) DST file(s)"

foreach ($file in $files) {
    $destPath = Join-Path $DST_FOLDER $file.name

    # Skip if file already exists (same name = same design)
    if (Test-Path $destPath) {
        continue
    }

    Write-Host "  Downloading: $($file.name) (SO: $($file.so_id))" -ForegroundColor Green

    try {
        Invoke-WebRequest -Uri $file.url -OutFile $destPath -ErrorAction Stop
        $newCount++
    } catch {
        Write-Host "  FAILED to download $($file.name): $_" -ForegroundColor Red
    }
}

# Save current timestamp for next incremental sync
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$now | Out-File -FilePath $lastSyncFile -NoNewline -Encoding UTF8

if ($newCount -gt 0) {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Downloaded $newCount new DST file(s)" -ForegroundColor Green
} else {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Up to date"
}
