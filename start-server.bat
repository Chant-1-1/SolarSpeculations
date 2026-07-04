@echo off
cd /d "%~dp0"
echo SolarSpeculations - Server laeuft auf http://localhost:5599
echo Beenden mit Strg + C
start "" http://localhost:5599
npx --yes http-server . -p 5599 -c-1