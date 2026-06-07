$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $ProjectDir ".server.pid"

if (Test-Path -LiteralPath $PidFile) {
    $serverPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($serverPid -match "^\d+$") {
        Stop-Process -Id ([int]$serverPid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
