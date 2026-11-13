@echo off
rem KIU CBT - put the latest version live on Cloudflare. Double-click this file.
title KIU CBT - updating the live site
cd /d "%~dp0"
echo.
echo  KIU CBT - updating the live examination site
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\wrangler\package.json" goto build
echo  Step 1 of 3: first time in this folder - installing the Cloudflare tools (about 1 minute)...
call npm install --no-fund --no-audit
if errorlevel 1 goto failed

:build
echo.
echo  Step 2 of 3: preparing the pages and the exam engine...
call node tools\build.mjs
if errorlevel 1 goto failed

echo.
echo  Step 3 of 3: uploading to Cloudflare...
echo  (If a browser window opens asking you to allow Wrangler, click Allow, then come back here.)
echo.
call npx wrangler deploy --env=""
if not errorlevel 1 goto done

rem Usually an expired Cloudflare sign-in: sign in again once, then retry.
echo.
echo  The upload did not go through. Signing in to Cloudflare again...
echo  (A browser window opens: click Allow, then come back here.)
echo.
call npx wrangler login
if errorlevel 1 goto failed
echo.
echo  Trying the upload again...
call npx wrangler deploy --env=""
if errorlevel 1 goto failed

:done

echo.
echo  ============================================
echo   DONE. The new version is live.
echo   Open https://kiu-cbt.portals.com.ng/admin.html
echo   and press Ctrl + F5 to load the new pages.
echo  ============================================
echo.
pause
exit /b 0

:nonode
echo  Node.js is not installed on this computer.
echo  Install the LTS version from https://nodejs.org , then double-click this file again.
echo.
pause
exit /b 1

:failed
echo.
echo  ============================================
echo   The update did NOT finish. Nothing on the live site was changed.
echo   Check the internet connection (try another network or turn off a VPN),
echo   then double-click deploy.cmd again. If it still fails, send a screenshot.
echo  ============================================
echo.
pause
exit /b 1
