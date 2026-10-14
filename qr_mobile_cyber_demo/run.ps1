# Convenience launcher for Windows PowerShell.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
$py = (Get-Command py -ErrorAction SilentlyContinue) ?? (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) {
    Write-Error "Python 3.9+ is required but was not found on PATH."
    exit 1
}
& $py.Source server.py @args
