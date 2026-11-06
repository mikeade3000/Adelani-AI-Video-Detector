@echo off
title Christine connection check
cd /d "%~dp0"
"%LOCALAPPDATA%\Christine\venv\Scripts\python.exe" -m christine --check
pause
