@echo off
title PalMap
cd /d "%~dp0"

echo.
echo   PalMap - auto-tracking collectible map for Palworld
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, and PalMap needs it to run.
  echo.
  echo   1. Go to  https://nodejs.org
  echo   2. Download the "LTS" version and install it
  echo   3. Run this file again
  echo.
  pause
  exit /b 1
)

REM First run only: fetch the two small libraries the server needs.
if not exist "node_modules" (
  echo   First-time setup, this takes a minute...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

echo   Starting... your browser will open automatically.
echo   Keep this window open while you use the map.
echo   Close it, or press Ctrl+C, when you're done.
echo.

REM The server opens the browser itself, so it always uses the port it
REM actually got (5173 may be taken, in which case it moves to 5174).
set PALMAP_OPEN=1
node server.mjs

echo.
echo   PalMap has stopped.
pause
