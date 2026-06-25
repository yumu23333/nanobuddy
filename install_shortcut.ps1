# NanoBuddy — 桌面快捷方式安装脚本
# 右键点击此文件，选择「使用 PowerShell 运行」

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "NanoBuddy.lnk"
$ExePath = Join-Path $ProjectDir "dist\NanoBuddy.exe"
$BatPath = Join-Path $ProjectDir "启动助手.bat"

# 优先使用打包后的 exe，回退到 bat
if (Test-Path $ExePath) {
    $TargetPath = $ExePath
    $Desc = "NanoBuddy v2.0 (桌面应用)"
    $IconLocation = $ExePath + ",0"
} elseif (Test-Path $BatPath) {
    $TargetPath = $BatPath
    $Desc = "NanoBuddy v2.0 (启动脚本)"
    # Bat 文件可以自身作为图标源
    $IconLocation = "$env:SystemRoot\system32\shell32.dll,21"
} else {
    Write-Host "未找到可执行文件！请先运行 build.bat 打包。" -ForegroundColor Red
    pause
    exit 1
}

$WScript = New-Object -ComObject WScript.Shell
$Shortcut = $WScript.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetPath
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Description = $Desc
$Shortcut.IconLocation = $IconLocation
$Shortcut.Save()

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  NanoBuddy 快捷方式已创建！" -ForegroundColor Green
Write-Host "  桌面快捷方式: $ShortcutPath" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "双击桌面「NanoBuddy」图标即可启动！" -ForegroundColor Yellow

pause
