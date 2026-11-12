@echo off
set "NODE=%~dp0resources\runtime\node\node.exe"
if not exist "%NODE%" set "NODE=%~dp0.dsh\runtime-cache\node\node.exe"
"%NODE%" "%~dp0runtime\unified-control.cjs" settings
