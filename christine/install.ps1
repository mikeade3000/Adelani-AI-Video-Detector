# Christine installer for Windows 10/11.
# Run by double-clicking install.bat (which calls this script).
$ErrorActionPreference = "Stop"

$Source     = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:LOCALAPPDATA "Christine"
$AppDir     = Join-Path $InstallDir "app"
$VenvDir    = Join-Path $InstallDir "venv"

Write-Host ""
Write-Host "  Installing Christine, your voice assistant" -ForegroundColor Cyan
Write-Host "  -------------------------------------------"
Write-Host ""

# 1. Find Python 3.11 or 3.12 (best supported by the speech libraries).
function Find-Python {
    foreach ($v in @("3.12", "3.11")) {
        try { $p = & py "-$v" -c "import sys; print(sys.executable)" 2>$null; if ($LASTEXITCODE -eq 0 -and $p) { return $p.Trim() } } catch {}
    }
    try {
        $ver = & python -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>$null
        if ($ver -in @("3.11", "3.12", "3.13")) { return (& python -c "import sys; print(sys.executable)").Trim() }
    } catch {}
    return $null
}

$Python = Find-Python
if (-not $Python) {
    Write-Host "Python 3.12 was not found. Installing it with winget..." -ForegroundColor Yellow
    winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $Python = Find-Python
    if (-not $Python) {
        Write-Host "Please install Python 3.12 from https://www.python.org/downloads/ (tick 'Add to PATH'), then run install.bat again." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Using Python: $Python"

# 2. Copy Christine's files.
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $Source "christine") $AppDir
Copy-Item -Force (Join-Path $Source "requirements.txt") $AppDir
Copy-Item -Force (Join-Path $Source "run_christine.bat") $AppDir
Copy-Item -Force (Join-Path $Source "run_christine_text.bat") $AppDir
Copy-Item -Force (Join-Path $Source "uninstall.bat") $AppDir

# 3. Create a private Python environment and install the libraries.
if (-not (Test-Path (Join-Path $VenvDir "Scripts\python.exe"))) {
    Write-Host "Creating Christine's Python environment..."
    & $Python -m venv $VenvDir
}
$VPy = Join-Path $VenvDir "Scripts\python.exe"
Write-Host "Installing libraries (this takes a few minutes the first time)..."
& $VPy -m pip install --upgrade pip --quiet
& $VPy -m pip install -r (Join-Path $AppDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "Library installation failed. See the messages above." -ForegroundColor Red; exit 1 }

# 4. API key for the cloud brain.
Push-Location $AppDir
& $VPy -m christine --setup
Pop-Location

# 5. Shortcuts.
$Shell = New-Object -ComObject WScript.Shell
function New-Shortcut($Path, $Target, $Desc) {
    $s = $Shell.CreateShortcut($Path)
    $s.TargetPath = $Target
    $s.WorkingDirectory = $AppDir
    $s.Description = $Desc
    $s.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,138"
    $s.Save()
}
$Desktop   = [Environment]::GetFolderPath("Desktop")
$StartMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "Christine"
New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
New-Shortcut (Join-Path $Desktop "Christine.lnk") (Join-Path $AppDir "run_christine.bat") "Christine voice assistant"
New-Shortcut (Join-Path $StartMenu "Christine.lnk") (Join-Path $AppDir "run_christine.bat") "Christine voice assistant"
New-Shortcut (Join-Path $StartMenu "Christine (type instead of talk).lnk") (Join-Path $AppDir "run_christine_text.bat") "Christine in text mode"
New-Shortcut (Join-Path $StartMenu "Uninstall Christine.lnk") (Join-Path $AppDir "uninstall.bat") "Remove Christine"

$answer = Read-Host "Start Christine automatically when Windows starts? (y/n)"
if ($answer -match "^[Yy]") {
    $Startup = [Environment]::GetFolderPath("Startup")
    New-Shortcut (Join-Path $Startup "Christine.lnk") (Join-Path $AppDir "run_christine.bat") "Christine voice assistant"
    Write-Host "Christine will start with Windows."
}

Write-Host ""
Write-Host "Done! Double-click 'Christine' on your Desktop to start." -ForegroundColor Green
Write-Host "Settings: $env:APPDATA\Christine\config.toml"
Write-Host ""
