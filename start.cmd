@echo off
cd /d "%~dp0"
node -e "process.exit(+process.versions.node.split('.')[0] >= 24 ? 0 : 1)" 2>nul || (
  echo Handled needs Node 24 or newer. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if not exist desktop\node_modules call npm install --prefix desktop
if not exist .env copy .env.example .env >nul
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0desktop\node_modules\electron\dist\electron.exe" "%~dp0desktop"
