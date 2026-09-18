@echo off
cd /d "%~dp0"
docker compose up --build -d
if errorlevel 1 exit /b 1
echo.
echo Your marketplace is starting. Only its onion address is exposed.
echo Run Show Onion Address.cmd once Tor has initialized.
pause
