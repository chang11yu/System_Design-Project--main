$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $ProjectDir ".server.pid"
$processIds = @()

if (Test-Path -LiteralPath $PidFile) {
    $serverPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($serverPid -match "^\d+$") {
        $processIds += [int]$serverPid
    }
}

$listeners = netstat -ano |
    Select-String "^\s*TCP\s+\S+:5000\s+\S+\s+LISTENING\s+(\d+)\s*$"
foreach ($listener in $listeners) {
    if ($listener.Matches.Count -gt 0) {
        $processIds += [int]$listener.Matches[0].Groups[1].Value
    }
}

foreach ($processId in ($processIds | Select-Object -Unique)) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
