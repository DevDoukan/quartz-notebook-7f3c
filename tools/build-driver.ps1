param([Parameter(Mandatory=$true)][string]$EwdkRoot)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$reportPath=Join-Path $root '.test-artifacts\kalkan-driver-build.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $reportPath) -Force|Out-Null
@{passed=$false;startedAt=[DateTime]::UtcNow.ToString('o');note='No successful result recorded for this invocation. A previous artifact is not build evidence.'}|ConvertTo-Json|Set-Content -LiteralPath $reportPath -Encoding UTF8
$EwdkRoot=[IO.Path]::GetFullPath($EwdkRoot).TrimEnd('\')
foreach($p in @($root,$EwdkRoot)){if($p -match '[%!&|<>"\r\n]'){throw 'Build paths contain unsupported shell characters.'}}
$setup=Join-Path $EwdkRoot 'BuildEnv\SetupBuildEnv.cmd'
if(!(Test-Path -LiteralPath $setup)){throw 'EWDK setup script missing.'}
$kit=Join-Path $EwdkRoot 'Program Files\Windows Kits\10'
$version='10.0.28000.0'
foreach($p in @("Include\$version\km\fltKernel.h","Include\$version\ucrt\stdio.h","Lib\$version\km\x64\FltMgr.lib","Lib\$version\um\x64\FltLib.lib")){if(!(Test-Path -LiteralPath (Join-Path $kit $p))){throw "Missing SDK/WDK input: $p"}}
$out=Join-Path $root '.build\kalkan-driver'
$obj=Join-Path $root '.build\kalkan-driver-obj'
New-Item -ItemType Directory -Path $out,$obj -Force|Out-Null
$command=Join-Path $root '.build\build-kalkan-driver.cmd'
$content=@"
@echo off
call "$setup" amd64
@echo off
if errorlevel 1 exit /b 1
cd /d "$root"
set "INCLUDE=%INCLUDE%;$kit\Include\$version\ucrt;$kit\Include\$version\shared;$kit\Include\$version\um"
set "LIB=%LIB%;$kit\Lib\$version\ucrt\x64;$kit\Lib\$version\um\x64"
cl /nologo /W4 /WX /O2 driver\ProtocolTest.c /Fo"$out\ProtocolTest.obj" /Fe"$out\ProtocolTest.exe"
if errorlevel 1 exit /b 1
"$out\ProtocolTest.exe"
if errorlevel 1 exit /b 1
cl /nologo /W4 /WX /analyze /O2 driver\PortProbe.c /Fo"$out\PortProbe.obj" /Fe"$out\PortProbe.exe" /link FltLib.lib
if errorlevel 1 exit /b 1
cl /nologo /W4 /WX /analyze /O2 driver\ScanReceiver.c /Fo"$out\ScanReceiver.obj" /Fe"$out\ScanReceiver.exe" /link FltLib.lib
if errorlevel 1 exit /b 1
cl /nologo /W4 /WX /analyze /O2 driver\PipeTransportTest.c /Fo"$out\PipeTransportTest.obj" /Fe"$out\PipeTransportTest.exe" /link FltLib.lib
if errorlevel 1 exit /b 1
msbuild driver\KalkanFilter.vcxproj /t:Rebuild /p:Configuration=Release /p:Platform=x64 /p:SignMode=Off /p:RunCodeAnalysis=true /p:OutDir="$out\\" /p:IntDir="$obj\\" /m /v:minimal /nologo
exit /b %errorlevel%
"@
[IO.File]::WriteAllText($command,$content,[Text.UTF8Encoding]::new($false))
& $env:ComSpec /d /c $command
if($LASTEXITCODE -ne 0){throw 'Driver build/test/analysis failed. Existing artifacts are not a successful build.'}
$artifacts=@('KalkanFilter.sys','PortProbe.exe','ProtocolTest.exe','ScanReceiver.exe','PipeTransportTest.exe')|ForEach-Object{$p=Join-Path $out $_;@{name=$_;sha256=(Get-FileHash -LiteralPath $p).Hash;bytes=(Get-Item -LiteralPath $p).Length}}
$report=@{passed=$true;builtAt=[DateTime]::UtcNow.ToString('o');sdkWdkVersion=$version;sourceFingerprint=((& node (Join-Path $root 'tools\source-fingerprint.cjs'))|ConvertFrom-Json).sha256;protocolTestPassed=$true;runCodeAnalysis=$true;artifacts=@($artifacts);loaded=$false;protectionImplemented=$false}
$report|ConvertTo-Json -Depth 6|Set-Content (Join-Path $root '.test-artifacts\kalkan-driver-build.json') -Encoding UTF8
