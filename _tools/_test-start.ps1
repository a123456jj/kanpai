# ============================================================
#  Card Game - One-Click Start
#    Starts the server + public tunnel, then shows the URLs.
#  NOTE: This file is intentionally ASCII-only.
#        Windows PowerShell 5.1 reads .ps1 as GBK by default,
#        so non-ASCII here would break the parser.
# ============================================================
$ErrorActionPreference = "SilentlyContinue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$game = Split-Path -Parent $dir
Set-Location $game

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  CARD GAME  -  one-click start" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. clean up old processes ----------
Write-Host "[1/4] stopping old processes ..." -ForegroundColor Yellow
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
$pids = netstat -ano | Select-String ":3000\s+.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
foreach ($p in $pids) {
    if ($p -match '^\d+$') { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1
Write-Host "      done" -ForegroundColor Gray
Write-Host ""

# ---------- 2. start game server ----------
Write-Host "[2/4] starting game server (port 3000) ..." -ForegroundColor Yellow
$env:NO_OPEN = "1"
Start-Process -FilePath "node" -ArgumentList "server.js" -WindowStyle Minimized
Start-Sleep -Seconds 3

$up = netstat -ano | Select-String ":3000\s+.*LISTENING"
if (-not $up) {
    Write-Host "      [FAIL] server did not start" -ForegroundColor Red
    Write-Host "      maybe node is missing, or port 3000 is taken" -ForegroundColor Red
    Write-Host "(test mode: no pause)"
    exit 1
}
Write-Host "      OK - server is running" -ForegroundColor Green
Write-Host ""

# ---------- 3. start tunnel ----------
Write-Host "[3/4] starting public tunnel (about 15s) ..." -ForegroundColor Yellow
$log = Join-Path $game "tunnel.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue
$cfArgs = @("tunnel", "--url", "http://localhost:3000", "--no-autoupdate", "--protocol", "http2", "--edge-ip-version", "4")
Start-Process -FilePath (Join-Path $game "cloudflared.exe") -ArgumentList $cfArgs -RedirectStandardError $log -WindowStyle Minimized

$tunnelUrl = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches
        if ($m -and $m[0].Matches.Count -gt 0) {
            $tunnelUrl = $m[0].Matches[0].Value.Trim()
            break
        }
    }
    Write-Host "." -NoNewline -ForegroundColor DarkGray
}
Write-Host ""

if ($tunnelUrl) {
    Write-Host "      OK - tunnel connected" -ForegroundColor Green
} else {
    Write-Host "      [WARN] no tunnel url (you can still play locally)" -ForegroundColor Red
}
Write-Host ""

# ---------- 4. show urls ----------
Write-Host "[4/4] YOUR URLS" -ForegroundColor Yellow
Write-Host ""
Write-Host "  --- YOU (local) ---------------------------" -ForegroundColor White
Write-Host "     http://localhost:3000/?p=1" -ForegroundColor Cyan
Write-Host ""
if ($tunnelUrl) {
    Write-Host "  --- SEND TO FRIEND (works on phone) ------" -ForegroundColor White
    Write-Host "     $tunnelUrl/?p=2" -ForegroundColor Green
    Write-Host ""
    Write-Host "  --- SPECTATOR (sees both hands) -----------" -ForegroundColor White
    Write-Host "     $tunnelUrl/" -ForegroundColor Gray
    Write-Host ""
    "$tunnelUrl/?p=2" | Set-Clipboard
    Write-Host "  * friend url copied to clipboard - just paste it" -ForegroundColor Magenta
} else {
    Write-Host "  [!] tunnel failed - local play still works" -ForegroundColor Red
    Write-Host "      run this script again to retry" -ForegroundColor Red
}
Write-Host ""
Write-Host "  --- VS COMPUTER ---------------------------" -ForegroundColor White
Write-Host "     open the local url, click gear icon, pick AI" -ForegroundColor Gray
Write-Host "  --- CARD GALLERY --------------------------" -ForegroundColor White
Write-Host "     http://localhost:3000/cards.html" -ForegroundColor Gray
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  keep this running - closing it stops the game" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "(test mode: no pause)"
