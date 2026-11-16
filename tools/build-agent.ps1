param([string]$OutputDirectory,[switch]$CentralOnly,[switch]$WithoutEnrollmentGui)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not $OutputDirectory){$OutputDirectory=Join-Path $root '.build\agent'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$framework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler=Join-Path $framework 'csc.exe'
if(-not $CentralOnly){
 & $compiler /nologo /optimize+ /platform:x64 /target:exe (('/out:')+(Join-Path $OutputDirectory 'KalkanFileBroker.exe')) /reference:System.Web.Extensions.dll (Join-Path $root 'agent\FileBroker.cs')
 if($LASTEXITCODE -ne 0){throw 'Guvenli dosya okuyucusu derlenemedi.'}
 if(-not $WithoutEnrollmentGui){
  & $compiler /nologo /warn:4 /warnaserror+ /codepage:65001 /optimize+ /platform:x64 /target:winexe (('/out:')+(Join-Path $OutputDirectory 'KalkanDlpEnrollment.exe')) (('/win32manifest:')+(Join-Path $root 'agent\EnrollmentGui.manifest')) /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (Join-Path $root 'agent\EnrollmentRequest.cs') (Join-Path $root 'agent\EnrollmentHost.cs') (Join-Path $root 'agent\EnrollmentGui.cs')
  if($LASTEXITCODE -ne 0){throw 'Client enrollment GUI build failed.'}
 }
}
if(Test-Path -LiteralPath (Join-Path $root 'agent\ServiceHost.cs')){
 if(-not $CentralOnly){
 & $compiler /nologo /optimize+ /platform:x64 /target:exe (('/out:')+(Join-Path $OutputDirectory 'KalkanDlpAgent.exe')) /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll (Join-Path $root 'agent\ServiceHost.cs')
 if($LASTEXITCODE -ne 0){throw 'Windows hizmeti derlenemedi.'}
 }
 & $compiler /nologo /optimize+ /platform:x64 /target:exe /define:CENTRAL_HOST (('/out:')+(Join-Path $OutputDirectory 'KalkanDlpCentral.exe')) /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll (Join-Path $root 'agent\ServiceHost.cs')
 if($LASTEXITCODE -ne 0){throw 'Central Windows service host build failed.'}
}
