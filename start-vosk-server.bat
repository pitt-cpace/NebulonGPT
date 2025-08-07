@echo off
echo Starting Vosk Speech Recognition Server...
echo.
echo Make sure you have Python and the required dependencies installed:
echo   pip install vosk websockets
echo.
echo Starting server on localhost:2700 (internal, accessible via localhost:3000/vosk)...
cd Vosk-Server\websocket
python asr_server_with_models.py models
