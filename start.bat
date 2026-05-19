@echo off
REM ---------------------------------------------------------------------------
REM  FileOrganizer launcher for Windows.
REM  Double-click this file to start the app. The console window will print a
REM  URL like http://127.0.0.1:<port>/  — open it in your browser.
REM
REM  First run installs dependencies and builds the UI (takes a few minutes).
REM  Subsequent runs are fast.
REM ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"

REM --- Check Node.js is available ---------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js was not found on PATH.
  echo Install Node 22 or 24 LTS from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

REM --- Wipe node_modules if it wasn't populated by this script --------------
REM  The marker file below is written only at the end of a successful setup
REM  run. Missing marker means something else (typically a WSL `npm install`
REM  on the shared bind mount) populated node_modules, so the native
REM  bindings may be the wrong OS/arch. Easier to wipe than to chase down
REM  each mismatched package.
set "OWN_MARKER=node_modules\.installed-by-start-bat"
if exist "node_modules" if not exist "%OWN_MARKER%" (
  echo node_modules was not populated by start.bat ^(WSL install?^).
  echo Wiping and reinstalling for Windows...
  rmdir /s /q node_modules
)

REM --- First-time setup if dependencies are missing --------------------------
if not exist "node_modules\.package-lock.json" (
  echo First-time setup. This takes a few minutes...
  echo.
  echo [1/3] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. See messages above.
    pause
    exit /b 1
  )

  echo.
  echo [2/3] Downloading MediaInfo for video metadata...
  call npm run fetch-binaries
  REM fetch-binaries is best-effort: a corporate proxy can block the download.
  REM The engine tolerates a missing MediaInfo binary by emitting null video
  REM metadata. If you want the metadata, see the README troubleshooting steps.

  echo.
  echo [3/3] Building UI and engine...
  call :ensure_native_modules
  call npm run build
  if errorlevel 1 (
    echo.
    echo ERROR: npm run build failed. See messages above.
    pause
    exit /b 1
  )

  echo.
  echo Setup complete.
  echo.
  REM Stamp the marker so future runs know start.bat owns this node_modules.
  echo built-by-start-bat > "%OWN_MARKER%"
)

REM On every run, double-check native modules are intact for this platform.
REM Fast no-op if everything is already correct.
call :ensure_native_modules

REM --- Run the server ---------------------------------------------------------
echo Starting FileOrganizer. The URL to open in your browser will appear below.
echo Press Ctrl+C in this window to stop the server.
echo.
call npm run start

REM --- Keep the window open after exit (so error messages stay visible) -----
echo.
echo Server stopped.
pause
exit /b 0

REM ---------------------------------------------------------------------------
REM  :ensure_native_modules
REM
REM  Two known landmines when node_modules was originally populated on a
REM  different OS (typical when you develop in WSL but run on Windows):
REM
REM   1. better-sqlite3's compiled .node file is the wrong architecture
REM      ("not a valid Win32 application" at runtime).
REM
REM   2. npm bug #4828 — the platform-specific optional dep for rollup's
REM      native binding gets skipped (vite build fails with "Cannot find
REM      module @rollup/rollup-<platform>-<arch>").
REM
REM  This subroutine detects both and fixes them in place, no full reinstall
REM  required. Idempotent: fast no-op when everything is correct.
REM ---------------------------------------------------------------------------
:ensure_native_modules
REM 1) better-sqlite3 — try to require it. If load fails, reinstall the package.
node -e "try{require('better-sqlite3');process.exit(0)}catch(e){process.exit(1)}" >nul 2>&1
if errorlevel 1 (
  echo better-sqlite3 native binding is the wrong arch ^(WSL/Linux build^?^). Reinstalling...
  if exist "node_modules\better-sqlite3" rmdir /s /q "node_modules\better-sqlite3"
  call npm install --no-save better-sqlite3
)

REM 2) rollup platform-specific optional dep (npm bug #4828).
set "ROLLUP_PKG=@rollup/rollup-win32-x64-msvc"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ROLLUP_PKG=@rollup/rollup-win32-arm64-msvc"
set "ROLLUP_DIR=%ROLLUP_PKG:/=\%"
if not exist "node_modules\%ROLLUP_DIR%\package.json" (
  echo Installing %ROLLUP_PKG% ^(npm optional-dep workaround^)...
  call npm install --no-save %ROLLUP_PKG%
)
goto :eof
