@echo off
setlocal
cd /d "%~dp0"
set "MARKET_GIT=C:\Program Files\Git\cmd\git.exe"
if not exist "%MARKET_GIT%" set "MARKET_GIT=git"
"%MARKET_GIT%" push https://github.com/agammann/Market.git main:main
if errorlevel 1 (
  echo Upload did not complete. Check GitHub authentication in your normal terminal.
  pause
  exit /b 1
)
echo Committed Market source uploaded. Check GitHub Actions for test and build results.
pause
