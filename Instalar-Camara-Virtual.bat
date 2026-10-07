@echo off
title Registrar SnapJM Virtual Camera
:: Comprobar y solicitar permisos de Administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Solicitando permisos de Administrador de Windows...
  powershell -NoProfile -Command "Start-Process '%~dpnx0' -Verb RunAs"
  exit /b
)

echo ========================================================
echo  Instalando Controlador DirectShow SnapJM Virtual Camera
echo ========================================================
echo.

set DRIVER64=%~dp0assets\driver\UnityCaptureFilter64.dll
set DRIVER32=%~dp0assets\driver\UnityCaptureFilter32.dll

if exist "%DRIVER64%" (
  echo Registrando driver 64-bit...
  regsvr32.exe /s "%DRIVER64%" "/i:UnityCaptureName=SnapJM Virtual Camera"
)

if exist "%DRIVER32%" (
  echo Registrando driver 32-bit...
  regsvr32.exe /s "%DRIVER32%" "/i:UnityCaptureName=SnapJM Virtual Camera"
)

echo.
echo Verificando instalacion en Windows...
reg query "HKCR\CLSID\{5c2cd55c-92ad-4999-8666-912bd3e70010}" >nul 2>&1
if %errorlevel% equ 0 (
  echo [EXITO] SnapJM Virtual Camera registrada correctamente en Windows.
) else (
  echo [COMPLETADO] Registro ejecutado. Abre SnapJM para usarla.
)

echo.
timeout /t 3 >nul
