@echo off
title Agent Allowance
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required. Opening the download page... & start https://nodejs.org & pause & exit /b 1)
if not exist .env if exist .env.example copy .env.example .env >nul
if exist merchant\state\merchant.lock del /q merchant\state\merchant.lock
echo Starting Agent Allowance. Keep this window open. Close it to stop the app.
start "" /min cmd /c "npm run merchant"
start "" cmd /c "timeout /t 25 >nul & start http://localhost:5173"
call npm start
