@echo off
REM Double-click to start Agent Allowance: the API, the dashboard, and the merchant
REM when its keys are in .env. npm start does the installs and clears a leftover
REM merchant lock. Close this window to stop all of it.
title Agent Allowance
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required. Opening the download page... & start https://nodejs.org & pause & exit /b 1)
if not exist .env if exist .env.example copy .env.example .env >nul
echo Starting Agent Allowance. Keep this window open. Close it to stop the app.
call npm start
if errorlevel 1 pause
