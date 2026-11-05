@echo off
rem Double-click to set up / update the Y2027 Eligibility Portal on Cloudflare.
rem To also load a backup, drag the backup .json file onto this file.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again. & pause & exit /b 1)
echo Installing tools (first run only takes a minute)...
call npm install --no-audit --no-fund || (echo npm install failed. & pause & exit /b 1)
if "%~1"=="" (node scripts\deploy.mjs) else (node scripts\deploy.mjs --backup "%~1")
pause
