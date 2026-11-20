@echo off
setlocal
title Air Game
cd /d "%~dp0"

rem On cherche un vrai Python 3 (le raccourci "python" du Microsoft Store ne compte pas).
set "PY="
py -3 -c "import http.server" >nul 2>&1 && set "PY=py -3"
if not defined PY (python -c "import http.server" >nul 2>&1 && set "PY=python")
if not defined PY (python3 -c "import http.server" >nul 2>&1 && set "PY=python3")

if defined PY goto :python

echo Python introuvable : on utilise le serveur integre a Windows (PowerShell).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serveur.ps1"
if errorlevel 1 pause
goto :eof

:python
%PY% serveur.py %*
if errorlevel 1 pause
