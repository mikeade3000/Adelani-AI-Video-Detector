@echo off
title Christine Classroom
cd /d "%~dp0"
"%LOCALAPPDATA%\Christine\venv\Scripts\python.exe" -m christine --classroom
pause
