# Stops every NestIQ process started by start-all.ps1 (by listening port,
# plus any tsx worker started from this project directory).

foreach ($port in 3000, 6379, 51214, 51215, 51216) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        Write-Host "Stopping pid $_ (port $port)"
        Stop-Process -Id $_ -Force -Confirm:$false -ErrorAction SilentlyContinue
    }
}

# The worker has no listening port - find node processes running tsx from this project.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
Where-Object { $_.CommandLine -match [regex]::Escape("src/worker.ts") -or $_.CommandLine -match [regex]::Escape("src\worker.ts") } |
ForEach-Object {
    Write-Host "Stopping worker pid $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue
}

Write-Host "Done."
