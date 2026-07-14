@echo off
REM Double-click this to start Availo's fake DVSA practice site (no installs needed).
REM Keep the window that opens OPEN while you test. Close it when you are done.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-practice.ps1"
