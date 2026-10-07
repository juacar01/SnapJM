@echo off
regsvr32.exe /s "D:\proyectos\SnapJM\assets\driver\UnityCaptureFilter64.dll" "/i:UnityCaptureName=SnapJM Virtual Camera"
exit /b %errorlevel%
