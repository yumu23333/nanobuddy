@echo off
chcp 936 >nul
title NanoBuddy 启动助手
cd /d "%~dp0"

set "ARG=%~1"

if /i "%ARG%"=="/?"     goto HELP
if /i "%ARG%"=="-h"     goto HELP
if /i "%ARG%"=="help"   goto HELP
if /i "%ARG%"=="帮助"    goto HELP
if /i "%ARG%"=="-m"     goto MENU
if /i "%ARG%"=="menu"   goto MENU
if /i "%ARG%"=="菜单"    goto MENU
if /i "%ARG%"=="-v"     goto FOREGROUND
if /i "%ARG%"=="log"    goto FOREGROUND
if /i "%ARG%"=="server" goto FOREGROUND
if /i "%ARG%"=="服务"    goto FOREGROUND
if /i "%ARG%"=="setup"  goto DEPLOY
if /i "%ARG%"=="deploy" goto DEPLOY
if /i "%ARG%"=="部署"    goto DEPLOY
if not "%ARG%"=="" goto BADARG

rem ======== 默认：智能启动（双击即用） ========
:SMART
if not exist "venv\Scripts\python.exe" (
    echo [INFO] 首次运行：未检测到虚拟环境，先自动执行一键部署...
    echo.
    call :DEPLOY
    if not exist "venv\Scripts\python.exe" (
        echo.
        echo [ERROR] 部署未成功，请阅读上方输出排查后重试。
        pause
        exit /b 1
    )
    echo.
    echo [INFO] 环境就绪，开始启动助手...
    echo.
)

powershell -NoProfile -Command "exit ([int](-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)))" 2>nul
if %errorlevel%==0 (
    echo [INFO] 服务已在运行，直接打开网页。
    start "" "http://127.0.0.1:8000/"
    exit /b 0
)

echo [INFO] 正在后台启动服务（无窗口）...
start "" /B "venv\Scripts\pythonw.exe" main.py

rem 轮询等待服务就绪：每次睡眠 1 秒并检测端口，最多约 25 秒
set /a TRIES=0
:WAITLOOP
powershell -NoProfile -Command "Start-Sleep -Seconds 1; exit ([int](-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)))" 2>nul
if %errorlevel%==0 goto SERVER_UP
set /a TRIES+=1
if %TRIES% geq 20 goto SERVER_FAIL
goto WAITLOOP

:SERVER_UP
start "" "http://127.0.0.1:8000/"
echo [OK] 启动成功，浏览器已打开。
echo [HINT] 停止服务：任务管理器结束 pythonw.exe 进程。
exit /b 0

:SERVER_FAIL
echo [WARN] 等待约 25 秒后端口 8000 仍未监听，服务可能启动失败。
echo [HINT] 请运行 "启动助手.bat 服务" 查看完整日志定位问题。
pause
exit /b 1

rem ======== 带日志前台启动（排错用） ========
:FOREGROUND
if not exist "venv\Scripts\python.exe" (
    echo [ERROR] 未找到 venv。请先运行: 启动助手.bat 部署
    pause
    exit /b 1
)
echo 正在启动... 请保持本窗口开启，按 Ctrl+C 可停止服务。
echo 网页地址: http://127.0.0.1:8000/
echo.
"venv\Scripts\python.exe" main.py
set "RC=%ERRORLEVEL%"
echo.
echo Exit code: %RC%
pause
exit /b %RC%

rem ======== 一键部署 ========
:DEPLOY
echo [INFO] 开始部署：创建 venv 并安装依赖（首次约需几分钟）...
echo.
call "%~dp0setup_deploy.bat"
exit /b %ERRORLEVEL%

rem ======== 交互菜单 ========
:MENU
echo ==========================================
echo   NanoBuddy 启动助手
echo ==========================================
echo   [1] 后台启动（无窗口，自动打开浏览器）
echo   [2] 带日志启动（排错用，Ctrl+C 停止）
echo   [3] 一键部署（安装 / 修复环境）
echo   [Q] 退出
echo ==========================================
choice /c 123Q /n /t 15 /d 1 /m "请选择（回车或 15 秒无操作默认 [1]）："
if errorlevel 4 exit /b 0
if errorlevel 3 goto DEPLOY
if errorlevel 2 goto FOREGROUND
goto SMART

rem ======== 帮助 ========
:HELP
echo 用法: 启动助手 [模式]  （/? 或 help 查看帮助；无参数 = 智能启动）
echo.
echo   服务 / log     前台运行并显示日志，Ctrl+C 停止（排错用）
echo   部署 / deploy  一键部署：创建 venv 并安装依赖
echo   菜单 / menu    显示交互菜单
echo   help           显示本帮助
echo.
echo 智能启动逻辑：缺环境先自动部署；服务已在运行则直接打开浏览器；
echo                否则后台无窗口启动并打开浏览器。
echo.
echo 网页地址: http://127.0.0.1:8000/
exit /b 0

:BADARG
echo [ERROR] 未知参数: %ARG%
echo.
call :HELP
exit /b 1
