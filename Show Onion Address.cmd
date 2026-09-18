@echo off
cd /d "%~dp0"
docker compose exec -T tor cat /onion/hostname
pause
