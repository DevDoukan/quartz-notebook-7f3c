param([string]$Compiler,[string]$CertificateThumbprint,[string]$SignTool,[string]$TimestampUrl='http://timestamp.digicert.com')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not $Compiler){$Compiler=Join-Path $root '.build\tools\inno\ISCC.exe'}
$receipt=Get-Content -LiteralPath (Join-Path $root '.build\latest-central-build.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$node=Join-Path $root '.build\tools\node.exe'
$current=(& $node (Join-Path $root 'tools\source-fingerprint.cjs') $root | ConvertFrom-Json).sha256
if($receipt.sourceFingerprint -ne $current){throw 'Build the central package from current source before building server setup.'}
if($CertificateThumbprint -and -not $receipt.signed){throw 'Build and sign the central package before signing the server setup.'}
& $node (Join-Path $root 'tools\verify-package.cjs') $receipt.stage
if($LASTEXITCODE -ne 0){throw 'Central package integrity failed.'}
$product=Get-Content -LiteralPath (Join-Path $root 'product-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$compilerArgs=@('/Q',('/DStageDir='+$receipt.stage),('/DProductVersion='+$receipt.version),('/DPublisher='+$product.publisher),('/DOutputDir='+(Join-Path $root 'release')))
if($CertificateThumbprint){
 if(-not $SignTool){throw 'Provide the Windows SDK SignTool when signing the server installer.'}
 $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe';$signScript=Join-Path $root 'tools\Sign-File.ps1'
 $signCommand='$q'+$ps+'$q -NoProfile -ExecutionPolicy Bypass -File $q'+$signScript+'$q -Path $f -CertificateThumbprint '+$CertificateThumbprint+' -SignTool $q'+$SignTool+'$q -TimestampUrl $q'+$TimestampUrl+'$q'
 $compilerArgs+='/DSignRelease=1';$compilerArgs+=('/SMTBSign='+$signCommand)
}
& $Compiler @compilerArgs (Join-Path $root 'installer\server.iss')
if($LASTEXITCODE -ne 0){throw 'Server setup compilation failed.'}
$final=(& $node (Join-Path $root 'tools\source-fingerprint.cjs') $root | ConvertFrom-Json).sha256
if($current -ne $final){throw 'Source changed during server setup build.'}
$suffix=if($CertificateThumbprint){'signed'}else{'unsigned'};$installer=Join-Path $root ('release\Kalkan-DLP-'+$receipt.version+'-Server-Setup-'+$suffix+'.exe')
@{version=$receipt.version;stage=$receipt.stage;installer=$installer;sourceFingerprint=$current;sha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant();deployment='central-service-setup';signed=[bool]$CertificateThumbprint} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root '.build\latest-server-build.json') -Encoding UTF8
