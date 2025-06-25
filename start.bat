@echo off
REM Windows batch file to start NebulonGPT

echo Checking Docker installation...
docker --version >nul 2>&1
if errorlevel 1 (
    echo Docker is not installed or not in PATH.
    echo Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo Checking if Ollama is running...
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo Ollama doesn't seem to be running on port 11434.
    echo Please start Ollama before running this application.
    echo You can start Ollama by running: ollama serve
    pause
    exit /b 1
)

echo Starting NebulonGPT with Docker Compose...

REM Try docker compose first (newer versions)
docker compose version >nul 2>&1
if not errorlevel 1 (
    echo Using docker compose...
    docker compose up --build -d
    goto :check_status
)

REM Fall back to docker-compose
docker-compose --version >nul 2>&1
if not errorlevel 1 (
    echo Using docker-compose...
    docker-compose up --build -d
    goto :check_status
)

REM If neither is available, use plain docker commands
echo Docker Compose not found. Using plain Docker commands...

echo Building Docker image...
docker build -t nebulon-gpt .

echo Starting container...
docker run -d --name nebulon-gpt ^
    -p 3000:80 ^
    --add-host=host.docker.internal:host-gateway ^
    -v "%cd%\nginx.conf:/etc/nginx/http.d/default.conf" ^
    -e NODE_ENV=production ^
    -e REACT_APP_OLLAMA_API_URL=http://host.docker.internal:11434 ^
    nebulon-gpt

:check_status
echo Waiting for containers to start...
timeout /t 5 /nobreak >nul

REM Check if containers are running
docker ps | findstr nebulon-gpt >nul
if not errorlevel 1 (
    echo.
    echo ========================================
    echo NebulonGPT is now running!
    echo ========================================
    echo.
    echo Web Interface: http://localhost:3000
    echo Vosk Server:   http://localhost:2700
    echo.
    echo To stop the application, run:
    echo   docker compose down
    echo.
    echo To view logs, run:
    echo   docker compose logs -f
    echo.
    pause
) else (
    echo.
    echo Failed to start NebulonGPT containers.
    echo Please check the logs with: docker compose logs
    echo.
    pause
    exit /b 1
)
