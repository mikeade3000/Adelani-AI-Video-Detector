@echo off
title Christine - set API key
cd /d "%~dp0"
"%LOCALAPPDATA%\Christine\venv\Scripts\python.exe" -m christine --setup
pause
