@echo off
cd /d "%~dp0"
if exist "runtime\node.exe" ("runtime\node.exe" tools\central-control.cjs stop) else (node tools\central-control.cjs stop)
if errorlevel 1 pause
