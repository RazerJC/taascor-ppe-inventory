@echo off
title TAASCOR PPE Inventory
cd /d "%~dp0"

:: Quick check for Node.js
where node >nul 2>nul || (echo Node.js not found! Install from https://nodejs.org/ & pause & exit /b)

:: Add Windows Firewall rule for port 3456 (requires admin, but won't error if already exists)
netsh advfirewall firewall show rule name="TAASCOR PPE Inventory" >nul 2>nul
if errorlevel 1 (
    echo Adding firewall rule for network access...
    powershell -Command "Start-Process cmd -ArgumentList '/c netsh advfirewall firewall add rule name=\"TAASCOR PPE Inventory\" dir=in action=allow protocol=TCP localport=3456' -Verb RunAs -WindowStyle Hidden" 2>nul
    timeout /t 3 /nobreak >nul
)

:: If already running, just open browser
netstat -ano | findstr :3456 >nul 2>nul && (start "" http://localhost:3456 & exit /b)

:: Auto-install dependencies if missing
if not exist "%~dp0node_modules" (echo Installing dependencies... & npm install --production --silent)

echo.
echo  ============================================
echo   TAASCOR PPE Inventory - Running on port 3456
echo  ============================================
echo.
echo   LOCAL:  http://localhost:3456
echo.

:: Show network IP addresses for other devices
echo   OTHER DEVICES (use these on phone/tablet):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        echo     http://%%b:3456
    )
)
echo.
echo  Close this window to stop the server.
echo  ============================================
echo.

:: Open browser immediately (don't wait)
start "" http://localhost:3456

:: Start server
node server.js
