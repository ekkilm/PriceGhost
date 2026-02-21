@echo off
REM === PriceGhost Docker Build Script ===
REM
REM Usage:
REM   build_docker.bat              - Build all images normally
REM   build_docker.bat clean        - Build with --no-cache
REM   build_docker.bat backend      - Build only backend
REM   build_docker.bat frontend     - Build only frontend
REM

setlocal enabledelayedexpansion

set BASE_PATH=%~dp0
set BACKEND_DOCKERFILE=%BASE_PATH%backend\Dockerfile
set FRONTEND_DOCKERFILE=%BASE_PATH%frontend\Dockerfile
set BACKEND_IMAGE=priceghost-backend
set FRONTEND_IMAGE=priceghost-frontend

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not running. Please start Docker Desktop and try again.
    exit /b 1
)

echo ========================================
echo PriceGhost Docker Build Script
echo ========================================
echo.

REM Parse command
set COMMAND=%1
if "%COMMAND%"=="" set COMMAND=build

if "%COMMAND%"=="clean" goto :clean
if "%COMMAND%"=="backend" goto :backend_only
if "%COMMAND%"=="frontend" goto :frontend_only
if "%COMMAND%"=="build" goto :build
goto :usage

:build
echo [BUILD] Building all Docker images...
echo.
call :build_backend normal
if %errorlevel% neq 0 exit /b 1
echo.
call :build_frontend normal
if %errorlevel% neq 0 exit /b 1
goto :end

:clean
echo [CLEAN] Removing old images and building with --no-cache...
docker rmi %BACKEND_IMAGE%:latest 2>nul
docker rmi %FRONTEND_IMAGE%:latest 2>nul
echo.
call :build_backend clean
if %errorlevel% neq 0 exit /b 1
echo.
call :build_frontend clean
if %errorlevel% neq 0 exit /b 1
echo [SUCCESS] Clean build completed!
goto :end

:backend_only
echo [BUILD] Building backend only...
call :build_backend normal
if %errorlevel% neq 0 exit /b 1
goto :end

:frontend_only
echo [BUILD] Building frontend only...
call :build_frontend normal
if %errorlevel% neq 0 exit /b 1
goto :end

:build_backend
echo [BACKEND] Building backend image...
if "%1"=="clean" (
    docker build --no-cache -t %BACKEND_IMAGE%:latest -f %BACKEND_DOCKERFILE% %BASE_PATH%backend
) else (
    docker build -t %BACKEND_IMAGE%:latest -f %BACKEND_DOCKERFILE% %BASE_PATH%backend
)
if %errorlevel% neq 0 (
    echo [ERROR] Backend build failed!
    exit /b 1
)
echo [SUCCESS] Backend image built: %BACKEND_IMAGE%:latest
exit /b 0

:build_frontend
echo [FRONTEND] Building frontend image...
if "%1"=="clean" (
    docker build --no-cache -t %FRONTEND_IMAGE%:latest -f %FRONTEND_DOCKERFILE% %BASE_PATH%frontend
) else (
    docker build -t %FRONTEND_IMAGE%:latest -f %FRONTEND_DOCKERFILE% %BASE_PATH%frontend
)
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed!
    exit /b 1
)
echo [SUCCESS] Frontend image built: %FRONTEND_IMAGE%:latest
exit /b 0

:usage
echo Usage:
echo   build_docker.bat              - Build all images normally
echo   build_docker.bat clean        - Build with --no-cache
echo   build_docker.bat backend      - Build only backend
echo   build_docker.bat frontend     - Build only frontend
goto :end

:end
echo.
echo ========================================
echo Available images:
docker images | findstr priceghost
echo ========================================
endlocal
