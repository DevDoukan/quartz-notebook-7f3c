$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(Test-Path -LiteralPath (Join-Path $projectRoot 'machine-install.json')){
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Windows ajanını durdurmak için Windows yönetici izni gerekiyor.'}
 $service=Get-CimInstance Win32_Service -Filter "Name='KalkanDlpAgent'"
 $ownedRoot=(Join-Path $env:ProgramW6432 'KalkanDLP')+'\'
 if($service -and -not $service.PathName.StartsWith('"'+$ownedRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Hizmetin bu ürüne ait olduğu doğrulanamadı.'}
 if($service){Stop-Service -Name KalkanDlpAgent -Force -ErrorAction Stop}
 Write-Host 'Kalkan DLP Windows ajanı durduruldu.';exit
}
if($env:DLP_DATA_DIR){$dataDir=$env:DLP_DATA_DIR}elseif(Test-Path -LiteralPath (Join-Path $projectRoot 'runtime\node.exe')){$dataDir=Join-Path $env:LOCALAPPDATA 'KalkanDLP\Data'}else{$dataDir=Join-Path $projectRoot 'data'}
try {$state=Invoke-RestMethod 'http://127.0.0.1:4317/api/health' -TimeoutSec 3} catch {Write-Host 'Kalkan DLP çalışmıyor veya erişilemiyor.';exit}
if($state.application -ne 'Kalkan DLP'){throw 'Bu porttaki uygulama Kalkan DLP olarak doğrulanamadı.'}
$control=(Get-Content -LiteralPath (Join-Path $dataDir 'control-token.txt') -Raw).Trim()
Invoke-RestMethod 'http://127.0.0.1:4317/api/control/shutdown' -Method Post -Headers @{'X-DLP-Control'=$control} -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
Write-Host 'Kalkan DLP durduruluyor.'
