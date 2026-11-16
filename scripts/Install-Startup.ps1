param([switch]$Remove)
$ErrorActionPreference='Stop'
$startup=[Environment]::GetFolderPath('Startup')
$shortcutPath=Join-Path $startup 'Kalkan DLP.lnk'
if($Remove){if(Test-Path -LiteralPath $shortcutPath){Remove-Item -LiteralPath $shortcutPath};Write-Host 'Otomatik başlatma kaldırıldı.';exit}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath=(Get-Command powershell.exe).Source
$shortcut.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'Start.ps1')+'" -NoBrowser'
$shortcut.WorkingDirectory=Split-Path -Parent $PSScriptRoot
$shortcut.WindowStyle=7
$shortcut.Save()
Write-Host 'Bu kullanıcı için oturum açılışında Kalkan DLP başlatılacak.'
