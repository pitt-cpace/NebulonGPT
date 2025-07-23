@echo off
echo 🐳 Starting NebulonGPT with Vosk Server in Docker...
echo.

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not running. Please start Docker and try again.
    pause
    exit /b 1
)

REM Check if docker-compose is available
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ docker-compose is not installed. Please install docker-compose and try again.
    pause
    exit /b 1
)

echo 🔧 Building and starting services...
echo.

REM Build and start all services
docker-compose up --build -d

echo.
echo ✅ Services started successfully!
echo.
echo 📋 Service Status:
echo   🌐 NebulonGPT Web UI: http://localhost:3000
echo   🎤 Vosk Speech Server: ws://localhost:2700
echo.
echo 📊 To view logs:
echo   docker-compose logs -f nebulon-gpt
echo   docker-compose logs -f vosk-server
echo.
echo 🛑 To stop services:
echo   docker-compose down
echo.
echo 🔄 To restart services:
echo   docker-compose restart
echo.

REM Show running containers
echo 🐳 Running containers:
docker-compose ps

echo.
echo Press any key to exit...
pause >nul
