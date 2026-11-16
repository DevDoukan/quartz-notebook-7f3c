param([string]$ReportPath,[string]$EwdkRoot)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not $ReportPath){$ReportPath=Join-Path $root '.test-artifacts\driver-toolchain.json'}
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsPath=$null
if(Test-Path -LiteralPath $vswhere){$vsPath=(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)}
if($EwdkRoot){
 $EwdkRoot=[IO.Path]::GetFullPath($EwdkRoot)
 if(!(Test-Path -LiteralPath (Join-Path $EwdkRoot 'BuildEnv\SetupBuildEnv.cmd'))){throw 'EWDK root does not contain SetupBuildEnv.cmd.'}
 $vsBase=Join-Path $EwdkRoot 'Program Files\Microsoft Visual Studio'
 $vsPath=$null
 foreach($major in Get-ChildItem -LiteralPath $vsBase -Directory|Where-Object Name -Match '^\d+$'|Sort-Object {[int]$_.Name} -Descending){$candidate=Join-Path $major.FullName 'BuildTools';if(Test-Path -LiteralPath $candidate){$vsPath=$candidate;break}}
}
$msbuild=$null
$compiler=$null
if($vsPath){
 $candidate=Join-Path $vsPath 'MSBuild\Current\Bin\MSBuild.exe'
 if(Test-Path -LiteralPath $candidate){$msbuild=$candidate}
 $versions=Join-Path $vsPath 'VC\Tools\MSVC'
 if(Test-Path -LiteralPath $versions){foreach($version in Get-ChildItem -LiteralPath $versions -Directory | Sort-Object Name -Descending){$candidate=Join-Path $version.FullName 'bin\Hostx64\x64\cl.exe';if(Test-Path -LiteralPath $candidate){$compiler=$candidate;break}}}
}
$kitRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
if($EwdkRoot){$kitRoot=Join-Path $EwdkRoot 'Program Files\Windows Kits\10'}
$kitVersion=$null
$includes=Join-Path $kitRoot 'Include'
if(Test-Path -LiteralPath $includes){foreach($version in Get-ChildItem -LiteralPath $includes -Directory | Sort-Object Name -Descending){
 $header=Join-Path $version.FullName 'km\fltKernel.h'
 $library=Join-Path $kitRoot ('Lib\'+$version.Name+'\km\x64\FltMgr.lib')
 if((Test-Path -LiteralPath $header) -and (Test-Path -LiteralPath $library)){$kitVersion=$version.Name;break}
}}
$missing=@()
if(-not $msbuild){$missing+='Visual Studio MSBuild with C++ tools'}
if(-not $compiler){$missing+='MSVC x64 compiler'}
if(-not $kitVersion){$missing+='Matching WDK kernel headers and x64 FltMgr library'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{$elevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}finally{$identity.Dispose()}
$report=[ordered]@{checkedAt=[DateTime]::UtcNow.ToString('o');platform='Windows-x64';msbuild=$msbuild;compiler=$compiler;wdkVersion=$kitVersion;elevated=$elevated;prerequisitesDetected=($missing.Count -eq 0);missing=$missing;driverBuildVerified=$false;driverLoadVerified=$false;productionAltitudeVerified=$false;driverSignatureVerified=$false;systemWideProtectionAccepted=$false;note='Read-only discovery. Detected tools do not prove a successful driver build, signature, installation or protection.'}
$parent=Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 4
if($missing.Count -gt 0){exit 1}
