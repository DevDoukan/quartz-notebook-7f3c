param(
 [string]$NodeExe,
 [string]$NodeLicense,
 [string]$NodeChecksums,
 [string]$Compiler,
 [switch]$Machine,
 [string]$CertificateThumbprint,
 [string]$SignTool,
 [string]$TimestampUrl='http://timestamp.digicert.com'
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not $NodeExe){$NodeExe=Join-Path $root '.build\tools\node.exe'}
if(-not $NodeLicense){$NodeLicense=Join-Path $root '.build\tools\NODE-LICENSE.txt'}
if(-not $NodeChecksums){$NodeChecksums=Join-Path $root '.build\tools\node-shasums.txt'}
if(-not $Compiler){$Compiler=Join-Path $root '.build\tools\inno\ISCC.exe'}
$nodeLine=Get-Content -LiteralPath $NodeChecksums | Where-Object {$_ -match ' win-x64/node.exe$'}
$expected=($nodeLine -split '\s+')[0]
if((Get-FileHash -LiteralPath $NodeExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Node SHA256 doğrulanamadı.'}
$startingFingerprint=(& $NodeExe (Join-Path $root 'tools\source-fingerprint.cjs') $root | ConvertFrom-Json).sha256
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$product=Get-Content -LiteralPath (Join-Path $root 'product-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($version -notmatch '^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$'){throw 'Geçersiz sürüm numarası.'}
$stage=Join-Path $root ('.build\package-'+$version+'-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$sourceFiles=@('package.json','package-lock.json','product-config.json','server.js','central-client.js','agent-enrollment.js','client-entitlement.js','server-license.js','detector.js','scanner.js','extract-worker.js','document-readers.js','store.js','audit-queue.js','auth.js','license.js','backup.js','windows.js','runtime-lock.js','agent-access.js','license-public.pem','vendor-license-public.pem','README.md','PRODUCT-READINESS.md','SECURITY.md','CHANGELOG.md','AGENT-DEPLOYMENT.md','DOCUMENT-FORMATS.md','Baslat.cmd','Durdur.cmd')
foreach($source in $sourceFiles){Copy-Item -LiteralPath (Join-Path $root $source) -Destination $stage}
Copy-Item -LiteralPath (Join-Path $root 'KURULUM-README.md') -Destination $stage
foreach($directory in @('public','extension','scripts')){Copy-Item -LiteralPath (Join-Path $root $directory) -Destination $stage -Recurse}
& (Join-Path $root 'tools\build-agent.ps1') -OutputDirectory (Join-Path $stage 'agent') -WithoutEnrollmentGui:(-not $Machine)
if(-not(Test-Path -LiteralPath (Join-Path $stage 'agent\KalkanDlpAgent.exe'))){throw 'Native agent build failed.'}
if($Machine){@{mode='service'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'machine-install.json') -Encoding UTF8}
if($CertificateThumbprint){
 foreach($binary in Get-ChildItem -LiteralPath (Join-Path $stage 'agent') -Filter *.exe){& (Join-Path $root 'tools\Sign-File.ps1') -Path $binary.FullName -CertificateThumbprint $CertificateThumbprint -SignTool $SignTool -TimestampUrl $TimestampUrl}
 foreach($script in Get-ChildItem -LiteralPath (Join-Path $stage 'scripts') -Filter *.ps1){& (Join-Path $root 'tools\Sign-File.ps1') -Path $script.FullName -CertificateThumbprint $CertificateThumbprint -SignTool $SignTool -TimestampUrl $TimestampUrl}
}
New-Item -ItemType Directory -Path (Join-Path $stage 'tools'),(Join-Path $stage 'runtime') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'tools\restore-backup.cjs') -Destination (Join-Path $stage 'tools')
Copy-Item -LiteralPath (Join-Path $root 'tools\enroll-agent.cjs') -Destination (Join-Path $stage 'tools')
Copy-Item -LiteralPath (Join-Path $root 'tools\verify-package.cjs') -Destination (Join-Path $stage 'tools')
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $stage 'runtime\node.exe')
Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $stage 'runtime\LICENSE.txt')
Push-Location $stage
try{& npm.cmd ci --omit=dev --ignore-scripts; if($LASTEXITCODE -ne 0){throw 'Üretim bağımlılıkları kurulamadı.'}}finally{Pop-Location}
$packagedNode=Join-Path $stage 'runtime\node.exe'
& $packagedNode -e "require(process.argv[1]); require(process.argv[2]);" (Join-Path $stage 'server.js') (Join-Path $stage 'central-client.js')
if($LASTEXITCODE -ne 0){throw 'Client package entry points could not load. Setup compilation was skipped.'}
& $NodeExe (Join-Path $root 'tools\dependency-inventory.cjs') $stage
if($LASTEXITCODE -ne 0){throw 'Bağımlılık envanteri oluşturulamadı.'}
$sourceFingerprint=(& $NodeExe (Join-Path $root 'tools\source-fingerprint.cjs') $root | ConvertFrom-Json).sha256
if($sourceFingerprint -ne $startingFingerprint){throw 'Source changed during the package build. No current-build receipt was created.'}
$manifest=@{version=$version; sourceFingerprint=$sourceFingerprint; createdAt=[DateTime]::UtcNow.ToString('o'); nodeSha256=$expected; files=@()}
foreach($file in Get-ChildItem -LiteralPath $stage -File -Recurse){$relative=$file.FullName.Substring($stage.Length+1).Replace('\','/');$manifest.files+=@{path=$relative;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$file.Length}}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'RELEASE-MANIFEST.json') -Encoding utf8
$output=Join-Path $root 'release'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compilerArgs=@('/Q',('/DStageDir='+$stage),('/DProductVersion='+$version),('/DPublisher='+$product.publisher),('/DSupportEmail='+$product.supportEmail),('/DOutputDir='+$output));if($Machine){$compilerArgs+='/DMachineInstall=1'}
if($CertificateThumbprint){
 $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $signScript=Join-Path $root 'tools\Sign-File.ps1'
 $signCommand='$q'+$ps+'$q -NoProfile -ExecutionPolicy Bypass -File $q'+$signScript+'$q -Path $f -CertificateThumbprint '+$CertificateThumbprint+' -SignTool $q'+$SignTool+'$q -TimestampUrl $q'+$TimestampUrl+'$q'
 $compilerArgs+='/DSignRelease=1';$compilerArgs+=('/SMTBSign='+$signCommand)
}
& $Compiler @compilerArgs (Join-Path $root 'installer\kalkan.iss')
if($LASTEXITCODE -ne 0){throw 'Windows kurulum paketi derlenemedi.'}
$suffix=if($Machine){'-Agent-Setup-unsigned.exe'}else{'-Setup-unsigned.exe'}
if($CertificateThumbprint){$suffix=$suffix.Replace('-unsigned','-signed')}
$receipt=if($Machine){'latest-machine-build.json'}else{'latest-build.json'}
@{stage=$stage;installer=(Join-Path $output ('Kalkan-DLP-'+$version+$suffix));version=$version;deployment=$(if($Machine){'service'}else{'desktop'})} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root ('.build\'+$receipt)) -Encoding utf8
Write-Host 'Sürüm adayı kurulum paketi hazır. İmza ve ticari yayın kapıları henüz tamamlanmış değildir.'
