@echo off
REM Starts the CPS backend (serves the built React + Three.js app on http://localhost:5000).
cd /d %~dp0
if "%PYTHON%"=="" set PYTHON=python
node cps\backend\server.js
