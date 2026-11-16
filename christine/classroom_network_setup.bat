@echo off
REM Christine Classroom network setup. Run once. Needs administrator rights.
REM 1) Lets students' phones reach Christine on port 8800 through Windows Firewall.
REM 2) Raises the Windows Mobile Hotspot device limit from 8 to 100
REM    (the real limit also depends on this laptop's Wi-Fi card).
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo.
echo Allowing Christine Classroom through Windows Firewall (port 8800)...
netsh advfirewall firewall delete rule name="Christine Classroom" >nul 2>&1
netsh advfirewall firewall add rule name="Christine Classroom" dir=in action=allow protocol=TCP localport=8800 profile=any
echo.
echo Raising the Mobile Hotspot device limit to 100...
reg add "HKLM\SYSTEM\CurrentControlSet\Services\icssvc\Settings" /v WifiMaxPeers /t REG_DWORD /d 100 /f
net stop icssvc >nul 2>&1
net start icssvc >nul 2>&1
echo.
echo Done. If the hotspot still stops at 8 devices, this laptop's Wi-Fi card has its own limit;
echo use a portable Wi-Fi router for big classes instead (see the README).
pause
