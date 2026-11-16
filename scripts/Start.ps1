param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$machine=Test-Path -LiteralPath (Join-Path $projectRoot 'machine-install.json')
$bundledNode=Join-Path $projectRoot 'runtime\node.exe'
if(Test-Path -LiteralPath $bundledNode){$nodePath=$bundledNode}else{$nodePath=(Get-Command node.exe -ErrorAction Stop).Source}
if($machine){$dataDir=Join-Path $env:ProgramData 'KalkanDLP\Data'}elseif($env:DLP_DATA_DIR){$dataDir=$env:DLP_DATA_DIR}elseif(Test-Path -LiteralPath $bundledNode){$dataDir=Join-Path $env:LOCALAPPDATA 'KalkanDLP\Data'}else{$dataDir=Join-Path $projectRoot 'data'}
$env:DLP_DATA_DIR=$dataDir
function Open-DlpPanel {
  if($NoBrowser){return}
  $panelUrl='http://127.0.0.1:4317'
  $setupFile=Join-Path $dataDir 'setup-key.txt'
  $canReadSetup=-not $machine -or ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if($canReadSetup -and (Test-Path -LiteralPath $setupFile)){$panelUrl+='/#setup='+[Uri]::EscapeDataString((Get-Content -LiteralPath $setupFile -Raw).Trim())}
  Start-Process $panelUrl
}
try {
  $response=Invoke-RestMethod 'http://127.0.0.1:4317/api/health' -TimeoutSec 2
  if($response.application -eq 'Kalkan DLP' -and (-not $machine -or $response.deployment -eq 'service')){Open-DlpPanel;exit}
} catch {}
if($machine){throw 'Windows ajanı çalışmıyor. Hizmeti yetkili Windows yöneticisi başlatmalı veya kurulumu onarmalıdır.'}
if(-not(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))){throw 'Uygulama bağımlılıkları eksik. Kaynak sürümde npm ci, kurulu üründe onarım kurulumu çalıştırın.'}
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
Start-Process -FilePath $nodePath -ArgumentList @('"'+(Join-Path $projectRoot 'server.js')+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataDir 'server.log') -RedirectStandardError (Join-Path $dataDir 'server-error.log')
for($attempt=0;$attempt -lt 30;$attempt++){
  Start-Sleep -Milliseconds 300
  try{$ready=Invoke-RestMethod 'http://127.0.0.1:4317/api/health' -TimeoutSec 1;if($ready.application -eq 'Kalkan DLP'){Open-DlpPanel;exit}}catch{}
}
throw 'Sunucu başlatılamadı. Veri klasöründeki server-error.log dosyasını inceleyin.'
