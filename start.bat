@echo off
REM Double-click this file, or run it from the repo root. Same as npm start.
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Agent Allowance needs Node.js 22. Node is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(!(major>22||(major===22&&minor>=13))){console.log('Agent Allowance needs Node.js 22.13 or newer. You have Node '+process.versions.node+'. Install Node 22 from https://nodejs.org and try again.'); process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)

node scripts\start.js
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
