@echo off
REM Starts the MES backend (serves the built React app on http://localhost:4000).
REM Requires: MySQL running in XAMPP with database/smartfarm.sql imported; Node 12+; Python 3.7+ on PATH.
cd /d %~dp0
if "%PYTHON%"=="" set PYTHON=python
node mes\backend\server.js
