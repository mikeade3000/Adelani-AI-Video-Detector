@echo off
title Christine (text mode)
cd /d "%~dp0"
"%LOCALAPPDATA%\Christine\venv\Scripts\python.exe" -m christine --text
pause
