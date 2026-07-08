@echo off
title LINK - WiFi File Transfer
echo.
echo   Starting LINK file transfer server...
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   Node.js is not installed.
    echo   Download it from https://nodejs.org ^(choose the LTS version^), install it, then run this file again.
    echo.
    pause
    exit /b
)

if not exist "node_modules" (
    echo   First run: installing dependencies...
    call npm install
)

echo   Checking Windows Firewall...
netsh advfirewall firewall show rule name="LINK File Transfer" >nul 2>nul
if %errorlevel% neq 0 (
    echo   Adding a firewall rule so your phone can connect ^(needs admin approval^)...
    powershell -Command "Start-Process cmd -ArgumentList '/c netsh advfirewall firewall add rule name=\"LINK File Transfer\" dir=in action=allow protocol=TCP localport=8080 profile=any' -Verb RunAs" 
    timeout /t 2 >nul
)

echo   Opening in your browser...
start "" http://localhost:8080

node server.js
pause
