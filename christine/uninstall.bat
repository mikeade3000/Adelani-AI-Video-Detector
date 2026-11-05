@echo off
REM Removes Christine's program files and shortcuts.
REM Your memories and settings in %APPDATA%\Christine are kept unless you delete that folder yourself.
echo This will remove Christine from this computer.
set /p ok=Type YES to continue: 
if /I not "%ok%"=="YES" exit /b
del "%USERPROFILE%\Desktop\Christine.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Christine.lnk" 2>nul
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Christine" 2>nul
cd /d "%TEMP%"
rmdir /s /q "%LOCALAPPDATA%\Christine"
echo Christine has been removed.
pause
