@echo off
REM One-click start for Windows: installs packages, crawls kiu.ac.ug the first time, starts the server.
cd /d "%~dp0"

if "%ANTHROPIC_API_KEY%"=="" (
  set /p ANTHROPIC_API_KEY=Paste your Anthropic API key and press Enter: 
)

if not exist .venv (
  python -m venv .venv || (echo Python is not installed. Get it from https://www.python.org/downloads/ & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt

if not exist data\pages.jsonl (
  echo Reading kiu.ac.ug for the first time. This takes 20-30 minutes...
  python crawler.py
)

echo.
echo Open http://localhost:8000 in Chrome or Edge. Press Ctrl+C here to stop.
start "" http://localhost:8000
uvicorn server:app --port 8000
