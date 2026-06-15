# NestIQ full-stack launcher with watchdog auto-restart.
# Usage:  powershell -ExecutionPolicy Bypass -File start-all.ps1
# Logs:   .logs\*.log     Stop: Ctrl+C

$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$logs  = Join-Path $root ".logs"
$npx   = (Get-Command npx.cmd).Source
$redis = Join-Path $root ".redis\Redis-8.8.0-Windows-x64-msys2\redis-server.exe"

New-Item -ItemType Directory -Force $logs | Out-Null

function Test-Port([int]$p) {
    return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

function Clear-PgliteLocks {
    $pb   = "$env:LOCALAPPDATA\prisma-dev-nodejs\Data\default"
    $ds   = "$env:LOCALAPPDATA\prisma-dev-nodejs\Data\durable-streams\default"
    $tmp  = "$env:LOCALAPPDATA\Temp\@prisma"

    # Core state files
    Remove-Item "$pb\server.json"             -Force -ErrorAction SilentlyContinue
    Remove-Item "$pb\.pglite\postmaster.pid"  -Force -ErrorAction SilentlyContinue
    Remove-Item "$pb\.pglite\postmaster.opts" -Force -ErrorAction SilentlyContinue

    # proper-lockfile artifacts — the .lock.lock is the one that blocks restarts
    Remove-Item "$ds\server.lock"      -Force -ErrorAction SilentlyContinue
    Remove-Item "$ds\server.lock.lock" -Force -Recurse -ErrorAction SilentlyContinue

    # Any stray lock files under temp/@prisma and ~/.prisma
    if (Test-Path $tmp) {
        Get-ChildItem $tmp -Recurse -Filter "*.lock" -ErrorAction SilentlyContinue |
            Where-Object { -not $_.PSIsContainer } |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
    Get-ChildItem "$env:USERPROFILE\.prisma" -Recurse -Filter "*.lock" -ErrorAction SilentlyContinue |
        Where-Object { -not $_.PSIsContainer } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

function Start-Svc([string]$Name, [string]$Exe, [string[]]$Args, [int]$Port = 0) {
    if ($Port -gt 0 -and (Test-Port $Port)) { Write-Host "[$Name] already up on :$Port"; return }
    Start-Process -FilePath $Exe -ArgumentList $Args -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\$Name.log" -RedirectStandardError "$logs\$Name.err.log"
    Write-Host "[$Name] starting..."
}

function Wait-Port([string]$Name, [int]$Port, [int]$Sec = 90) {
    $dl = (Get-Date).AddSeconds($Sec)
    while (-not (Test-Port $Port)) {
        if ((Get-Date) -gt $dl) { throw "[$Name] not ready after ${Sec}s — check .logs\$Name.err.log" }
        Start-Sleep -Milliseconds 400
    }
    Write-Host "[$Name] ready :$Port"
}

# ── 1. Clear ALL pglite locks (runs unconditionally — prevents server.lock.lock buildup)
Write-Host "[locks] clearing pglite lock files..."
Clear-PgliteLocks
Write-Host "[locks] done"

# ── 2. Backing services
Start-Svc "postgres" $npx   @("prisma","dev")                        51214
Start-Svc "redis"    $redis @("--port","6379","--save",'""')          6379
Wait-Port "postgres" 51214 90
Wait-Port "redis"    6379   30

# ── 3. Apply schema (idempotent — safe every boot)
Write-Host "[schema] syncing Prisma schema..."
& $npx prisma db push --accept-data-loss --skip-generate 2>&1 | Out-Null
Write-Host "[schema] done"

# ── 4. App processes
Start-Svc "dashboard" $npx @("next","dev")                           3000
Start-Svc "worker"    $npx @("tsx","--env-file=.env","src/worker.ts") 0
Wait-Port "dashboard" 3000 120
Write-Host ""
Write-Host "  NestIQ is up  →  http://localhost:3000"
Write-Host ""

# ── 5. Watchdog — checks every 15s, restarts any crashed process
Write-Host "Watchdog active. Ctrl+C to stop."
while ($true) {
    Start-Sleep -Seconds 15

    if (-not (Test-Port 3000)) {
        Write-Host "$(Get-Date -f HH:mm:ss) [watchdog] dashboard down — restarting"
        Start-Process -FilePath $npx -ArgumentList @("next","dev") -WorkingDirectory $root -WindowStyle Hidden `
            -RedirectStandardOutput "$logs\dashboard.log" -RedirectStandardError "$logs\dashboard.err.log"
    }

    if (-not (Test-Port 6379)) {
        Write-Host "$(Get-Date -f HH:mm:ss) [watchdog] redis down — restarting"
        Start-Process -FilePath $redis -ArgumentList @("--port","6379","--save",'""') -WorkingDirectory $root `
            -WindowStyle Hidden -RedirectStandardOutput "$logs\redis.log" -RedirectStandardError "$logs\redis.err.log"
    }

    if (-not (Test-Port 51214)) {
        Write-Host "$(Get-Date -f HH:mm:ss) [watchdog] postgres down — restarting"
        Clear-PgliteLocks
        Start-Process -FilePath $npx -ArgumentList @("prisma","dev") -WorkingDirectory $root -WindowStyle Hidden `
            -RedirectStandardOutput "$logs\postgres.log" -RedirectStandardError "$logs\postgres.err.log"
    }
}
