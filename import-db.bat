@echo off
REM Imports database\smartfarm.sql into the XAMPP MySQL server (root, no password by default).
cd /d %~dp0
set MYSQL=C:\xampp\mysql\bin\mysql.exe
if not exist "%MYSQL%" set MYSQL=mysql
"%MYSQL%" -u root < database\smartfarm.sql
if errorlevel 1 (echo Import failed & exit /b 1)
echo Database smartfarm imported.
