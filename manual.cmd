@echo off
rem Gera o Story n com dados ao vivo e copia para Desktop\Stories MCR\data, para postar a mao.
rem Uso: manual.cmd 1   (ou "todos")
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" gerar.js %1
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set HOJE=%%d
set DESTINO=%USERPROFILE%\Desktop\Stories MCR\%HOJE%
if not exist "%DESTINO%" mkdir "%DESTINO%"
copy /y "gerados\%HOJE%\*.jpg" "%DESTINO%\" >nul
start "" "%DESTINO%"
