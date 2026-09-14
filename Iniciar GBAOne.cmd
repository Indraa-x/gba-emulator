@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado neste computador.
  echo Instale o Node.js e execute este arquivo novamente.
  pause
  exit /b 1
)

start "GBAOne" /min node "%~dp0local-server.js"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765/"
endlocal
