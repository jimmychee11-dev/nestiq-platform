# Runs the BullMQ agent worker pointed at the cloud Neon + Upstash stack.
# Reads DATABASE_URL / REDIS_URL from .env.local (written by `vercel env pull`).
# Reads ANTHROPIC_API_KEY and optional tokens from .env.
#
# Usage:  .\start-worker-cloud.ps1

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Read-EnvFile($path) {
    $vars = @{}
    if (-not (Test-Path $path)) { return $vars }
    foreach ($line in Get-Content $path) {
        $line = $line.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { continue }
        $eq = $line.IndexOf("=")
        if ($eq -lt 0) { continue }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim().Trim('"')
        $vars[$key] = $val
    }
    return $vars
}

# Load cloud URLs from .env.local (DATABASE_URL, REDIS_URL, etc.)
$cloud = Read-EnvFile (Join-Path $scriptDir ".env.local")
# Load secrets from .env (ANTHROPIC_API_KEY, optional integrations)
$local = Read-EnvFile (Join-Path $scriptDir ".env")

# Merge — cloud values win for DATABASE_URL / REDIS_URL
$merged = $local + $cloud

# Override DATABASE_URL with the direct/unpooled URL for the worker
# (avoids PgBouncer pgbouncer=true requirement on long-lived connections)
if ($merged.ContainsKey("DATABASE_URL_UNPOOLED")) {
    $merged["DATABASE_URL"] = $merged["DATABASE_URL_UNPOOLED"]
}

# Apply to current process env
foreach ($kv in $merged.GetEnumerator()) {
    [System.Environment]::SetEnvironmentVariable($kv.Key, $kv.Value, "Process")
}

# Create MCP sandbox dir if it doesn't exist
$fsRoot = $merged["MCP_FS_ROOT"]
if ($fsRoot -and -not (Test-Path $fsRoot)) {
    New-Item -ItemType Directory -Force $fsRoot | Out-Null
    Write-Host "[worker] Created MCP sandbox: $fsRoot"
}

Write-Host "[worker] Starting agent worker (cloud mode)"
Write-Host "  DB  : $($merged['DATABASE_URL'] -replace ':([^:@]+)@', ':***@')"
Write-Host "  Redis: $($merged['REDIS_URL'] -replace ':([^:@]+)@', ':***@')"
Write-Host "  Model: $($merged['AGENT_MODEL'] ?? 'claude-opus-4-8')"

Set-Location $scriptDir
npx tsx src/worker.ts
