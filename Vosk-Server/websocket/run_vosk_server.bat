@echo off
title Vosk ASR Server
color 0A

cls
echo ===============================================
echo           VOSK ASR SERVER
echo ===============================================
echo.
echo Starting Vosk ASR Server with models directory...
echo.

:: Check if models folder exists
if not exist "models" (
    echo Error: Models folder not found!
    echo Please create a "models" folder and place your Vosk models inside.
    pause
    exit
)

python asr_server_with_models.py models

echo.
echo Server stopped. Press any key to exit...
pause
