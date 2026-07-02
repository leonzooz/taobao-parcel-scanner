@echo off
setlocal

cd /d "%~dp0"

set LIMIT=5
set ITEM_DELAY_MS=8000

echo Starting Taobao product image fetcher...
echo Project: %CD%
echo LIMIT=%LIMIT%
echo ITEM_DELAY_MS=%ITEM_DELAY_MS%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\playwright" (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

npm run fetch-images

echo.
echo Done. Press any key to close this window.
pause >nul
