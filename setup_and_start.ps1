$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ProjectDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$Requirements = Join-Path $ProjectDir "requirements.txt"
$LogFile = Join-Path $ProjectDir "server.log"
$ErrorLogFile = Join-Path $ProjectDir "server-error.log"
$Url = "http://127.0.0.1:5000"

Set-Location $ProjectDir

function Test-Server {
    try {
        $response = Invoke-WebRequest -Uri "$Url/api/get_all_data" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Find-Python {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python314\python.exe"),
        (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        return $pythonCommand.Source
    }

    return $null
}

if (Test-Server) {
    Start-Process $Url
    exit 0
}

if (-not (Test-Path -LiteralPath $VenvPython)) {
    $BasePython = Find-Python
    if (-not $BasePython) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            "Python was not found. Install Python 3.12 or newer, enable Add Python to PATH, then run START_SYSTEM.bat again.",
            "Cool Noodle System",
            "OK",
            "Error"
        ) | Out-Null
        exit 1
    }

    & $BasePython -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the Python virtual environment."
    }

    & $VenvPython -m pip install --upgrade pip
    & $VenvPython -m pip install -r $Requirements
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Python packages. Check the network connection."
    }
}

if (Test-Path -LiteralPath $LogFile) {
    Remove-Item -LiteralPath $LogFile -Force
}
if (Test-Path -LiteralPath $ErrorLogFile) {
    Remove-Item -LiteralPath $ErrorLogFile -Force
}

$process = Start-Process `
    -FilePath $VenvPython `
    -ArgumentList "app.py" `
    -WorkingDirectory $ProjectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $ErrorLogFile `
    -PassThru

Set-Content -LiteralPath (Join-Path $ProjectDir ".server.pid") -Value $process.Id

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-Server) {
        Start-Process $Url
        exit 0
    }
    if ($process.HasExited) {
        break
    }
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
    "The server could not start. Check server.log and server-error.log.",
    "Cool Noodle System",
    "OK",
    "Error"
) | Out-Null
exit 1
