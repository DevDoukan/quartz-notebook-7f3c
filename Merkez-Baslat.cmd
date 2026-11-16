@echo off
cd /d "%~dp0"
if exist "runtime\node.exe" ("runtime\node.exe" tools\central-control.cjs start) else (node tools\central-control.cjs start)
if errorlevel 1 pause
