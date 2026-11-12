@echo off
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\start-menu-daemon.ps1" -Bundled
