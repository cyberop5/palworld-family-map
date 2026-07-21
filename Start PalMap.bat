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
  echo   2. Download the big green "LTS" button and install it
  echo   3. Run this file again
  echo.
  pause
  exit /b 1
)

echo   Starting... your browser will open automatically.
echo   Keep this window open while you use the map.
echo   Close it when you're done.
echo.

REM The server opens the browser itself, so it lands on the port it actually
REM got (5173 may be taken, in which case it moves to 5174).
set PALMAP_OPEN=1
node server.mjs

echo.
echo   PalMap has stopped.
pause
