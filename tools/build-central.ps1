param([switch]$LinuxSaas,[string]$NodeExe,[string]$NodeLicense,[string]$NodeChecksums,[string]$CertificateThumbprint,[string]$SignTool,[string]$TimestampUrl='http://timestamp.digicert.com')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not $NodeExe){$NodeExe=Join-Path $root '.build\tools\node.exe'}
if(-not $NodeLicense){$NodeLicense=Join-Path $root '.build\tools\NODE-LICENSE.txt'}
if(-not $NodeChecksums){$NodeChecksums=Join-Path $root '.build\tools\node-shasums.txt'}
$nodeLine=Get-Content -LiteralPath $NodeChecksums | Where-Object {$_ -match ' win-x64/node.exe$'}
$expected=($nodeLine -split '\s+')[0]
if((Get-FileHash -LiteralPath $NodeExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Node checksum mismatch.'}
$startingFingerprint=(& $NodeExe (Join-Path $root 'tools\source-fingerprint.cjs') $root | ConvertFrom-Json).sha256
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$stage=Join-Path $root ($(if($LinuxSaas){'.build\saas-'}else{'.build\central-'})+$version+'-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $stage,(Join-Path $stage 'runtime'),(Join-Path $stage 'tools') -Force | Out-Null
$files=@('server-license-runtime.js','server-license.js','vendor-license-client.js','vendor-license-profile.json','vendor-license-public.pem','license-public.pem','package.json','package-lock.json','product-config.json','central-server.js','central-config.js','central-store.js','central-signing.js','central-backup.js','store.js','audit-queue.js','auth.js','mfa.js','detector.js','runtime-lock.js','CENTRAL-MANAGEMENT.md','CENTRAL-RECOVERY.md','CENTRAL-DEPLOYMENT.md','SECURITY.md','CHANGELOG.md')
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage}
foreach($file in @('outlook-central.js','outlook-inspection.js','document-readers.js','policy-domains.js','outlook-send.js','OUTLOOK-DEPLOYMENT.md')){
 Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $root 'KURULUM-README.md') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'central-public') -Destination $stage -Recurse
foreach($tool in @('build-outlook-runtime.cjs','outlook-manifest.cjs')){
 Copy-Item -LiteralPath (Join-Path $root ('tools\'+$tool)) -Destination (Join-Path $stage 'tools')
}
if(-not $LinuxSaas){
 New-Item -ItemType Directory -Path (Join-Path $stage 'deploy') -Force | Out-Null
 Copy-Item -LiteralPath (Join-Path $root 'deploy\outlook') -Destination (Join-Path $stage 'deploy') -Recurse
}
if($LinuxSaas){
 $output=Join-Path $root ('release\Kalkan-DLP-Central-'+$version+'-Linux-SaaS.zip')
 if(Test-Path -LiteralPath $output){throw 'Linux SaaS archive already exists; increment release version before rebuilding.'}
 Copy-Item -LiteralPath (Join-Path $root 'deploy') -Destination $stage -Recurse
 foreach($tool in @('central-backup.cjs','verify-package.cjs')){
  Copy-Item -LiteralPath (Join-Path $root ('tools\'+$tool)) -Destination (Join-Path $stage 'tools')
 }
 $fingerprint=(& $NodeExe (Join-Path $root 'tools\source-fingerprint.cjs') $root | ConvertFrom-Json).sha256
 if($fingerprint -ne $startingFingerprint){throw 'Source changed during the Linux SaaS build.'}
 $manifest=@{product='Kalkan DLP Central';version=$version;sourceFingerprint=$fingerprint;files=@()}
 foreach($file in Get-ChildItem -LiteralPath $stage -File -Recurse){
  $relative=$file.FullName.Substring($stage.Length+1).Replace('\','/')
  $manifest.files+=@{path=$relative;sha256=(Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant();bytes=$file.Length}
 }
 $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'RELEASE-MANIFEST.json') -Encoding utf8
 & $NodeExe (Join-Path $stage 'tools\verify-package.cjs') $stage
 if($LASTEXITCODE -ne 0){throw 'Linux SaaS package integrity verification failed.'}
 Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $output -CompressionLevel Optimal
 Write-Host $output
 return
}
foreach($file in @('Merkez-Baslat.cmd','Merkez-Durdur.cmd')){Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage}
& (Join-Path $root 'tools\build-agent.ps1') -OutputDirectory (Join-Path $stage 'agent') -CentralOnly
if(-not(Test-Path -LiteralPath (Join-Path $stage 'agent\KalkanDlpCentral.exe'))){throw 'Central service host build failed.'}
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'scripts\Manage-CentralService.ps1') -Destination (Join-Path $stage 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts\Get-SupportStatus.ps1') -Destination (Join-Path $stage 'scripts')
if($CertificateThumbprint){
 if(-not $SignTool){throw 'Provide the Windows SDK SignTool when signing the central release.'}
 & (Join-Path $root 'tools\Sign-File.ps1') -Path (Join-Path $stage 'agent\KalkanDlpCentral.exe') -CertificateThumbprint $CertificateThumbprint -SignTool $SignTool -TimestampUrl $TimestampUrl
 foreach($script in Get-ChildItem -LiteralPath (Join-Path $stage 'scripts') -Filter *.ps1 -File){
  & (Join-Path $root 'tools\Sign-File.ps1') -Path $script.FullName -CertificateThumbprint $CertificateThumbprint -SignTool $SignTool -TimestampUrl $TimestampUrl
 }
}
foreach($tool in @('central-control.cjs','central-backup.cjs','verify-package.cjs')){Copy-Item -LiteralPath (Join-Path $root ('tools\'+$tool)) -Destination (Join-Path $stage 'tools')}
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $stage 'runtime\node.exe')
Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $stage 'runtime\LICENSE.txt')
Push-Location $stage
try{& npm.cmd ci --omit=dev --ignore-scripts; if($LASTEXITCODE -ne 0){throw 'Production dependency installation failed.'}}finally{Pop-Location}
& $NodeExe (Join-Path $root 'tools\dependency-inventory.cjs') $stage
if($LASTEXITCODE -ne 0){throw 'Dependency inventory failed.'}
$sourceFingerprint=(& $NodeExe (Join-Path $root 'tools\source-fingerprint.cjs') $root | ConvertFrom-Json).sha256
if($sourceFingerprint -ne $startingFingerprint){throw 'Source changed during the central build. No archive receipt was created.'}
$manifest=@{product='Kalkan DLP Central';version=$version;sourceFingerprint=$sourceFingerprint;createdAt=[DateTime]::UtcNow.ToString('o');nodeSha256=$expected;files=@()}
foreach($file in Get-ChildItem -LiteralPath $stage -File -Recurse){$relative=$file.FullName.Substring($stage.Length+1).Replace('\','/');$manifest.files+=@{path=$relative;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$file.Length}}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'RELEASE-MANIFEST.json') -Encoding UTF8
& $NodeExe (Join-Path $root 'tools\verify-package.cjs') $stage
if($LASTEXITCODE -ne 0){throw 'Central package integrity verification failed.'}
$output=Join-Path $root ('release\Kalkan-DLP-Central-'+$version+'-Windows-x64.zip')
if(Test-Path -LiteralPath $output){throw 'Central archive already exists; increment release version before rebuilding.'}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $output -CompressionLevel Optimal
@{stage=$stage;archive=$output;version=$version;sourceFingerprint=$sourceFingerprint;deployment='central-portable';signed=[bool]$CertificateThumbprint;archiveSha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root '.build\latest-central-build.json') -Encoding UTF8
Write-Host 'Central preview package created; production deployment acceptance is still required.'
