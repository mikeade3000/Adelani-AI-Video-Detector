@echo off
title Christine
cd /d "%~dp0"
"%LOCALAPPDATA%\Christine\venv\Scripts\python.exe" -m christine
if errorlevel 1 pause
