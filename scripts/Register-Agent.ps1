[CmdletBinding()]
param([string]$Origin,[string]$DeviceName=$env:COMPUTERNAME,[string]$CAFile,[string]$EnrollmentFile,[switch]$Resume,[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'An elevated Windows administrator is required.'}
if(-not [Environment]::Is64BitProcess){throw 'Use 64-bit Windows PowerShell.'}
if($EnrollmentFile -and ($Resume -or $Origin -or $CAFile -or $PSBoundParameters.ContainsKey('DeviceName'))){throw 'EnrollmentFile cannot be combined with Resume, Origin, CAFile or DeviceName.'}
$name='KalkanDlpAgent'
$common=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'KalkanDLP'
$programRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'KalkanDLP'
$configFile=Join-Path $common 'agent-config.json'
$connection=Join-Path $common 'central-connection.json'
$service=Get-CimInstance Win32_Service -Filter "Name='KalkanDlpAgent'"
if(-not $service -or $service.StartName -ine 'NT SERVICE\KalkanDlpAgent'){throw 'The dedicated installed agent service was not found.'}
$serviceSid=([Security.Principal.NTAccount]('NT SERVICE\'+$name)).Translate([Security.Principal.SecurityIdentifier]).Value
$administrators=@('S-1-5-18','S-1-5-32-544')
$trustedInstaller='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$writeBits=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$readBits=[Security.AccessControl.FileSystemRights]::ReadData -bor [Security.AccessControl.FileSystemRights]::ReadExtendedAttributes
function Assert-Protected([string]$Path,[switch]$Code,[switch]$Secret){
 $item=Get-Item -LiteralPath $Path -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse points are not allowed in protected installation paths.'}
 $acl=Get-Acl -LiteralPath $Path
 $owners=$administrators;if($Code){$owners+=@($trustedInstaller)}
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $owners){throw ('An ordinary user or unexpected account owns a protected path: '+$Path)}
 foreach($rule in $acl.Access){
  if($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)){continue}
  $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if(($rule.FileSystemRights -band $writeBits) -and $sid -notin $owners){throw ('Untrusted write access on protected path: '+$Path)}
  if($Secret -and ($rule.FileSystemRights -band $readBits) -and $sid -notin ($administrators+@($serviceSid))){throw ('Unexpected read access to enrollment secrets: '+$Path)}
 }
}
function Assert-Ancestors([string]$Path){$item=Get-Item -LiteralPath $Path -Force;while($item){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Protected path ancestors cannot be reparse points.'};$item=$item.Parent}}
Assert-Ancestors $common
Assert-Protected $common -Secret
. (Join-Path $PSScriptRoot 'EnrollmentRequest.ps1')
if($EnrollmentFile){
 $requestFile=[IO.Path]::GetFullPath($EnrollmentFile)
 if(-not $EnrollmentFile.StartsWith([IO.Path]::GetPathRoot($requestFile),[StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetDirectoryName($requestFile)).Equals($common,[StringComparison]::OrdinalIgnoreCase)){throw 'EnrollmentFile must be an absolute file path directly inside the protected ProgramData KalkanDLP folder.'}
 Assert-Protected $requestFile -Secret
 $stream=[IO.File]::Open($requestFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try{
  if($stream.Length -gt 131072){throw 'Enrollment request file is too large.'}
  $reader=[IO.StreamReader]::new($stream,[Text.UTF8Encoding]::new($true,$true),$false,4096,$true)
  try{try{$requestJson=$reader.ReadToEnd()}catch{throw 'Enrollment request file must contain valid UTF-8.'}}finally{$reader.Dispose()}
  $fileRequest=ConvertFrom-KalkanEnrollmentJson -Json $requestJson
 }finally{$requestJson=$null;$stream.Dispose()}
}
Assert-Protected $configFile
if((Get-Item -LiteralPath $configFile).Length -gt 16384){throw 'Agent configuration is too large.'}
$agent=Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
$appRoot=[IO.Path]::GetFullPath([string]$agent.AppRoot).TrimEnd('\')
$expectedData=Join-Path $common 'Data'
if(-not $appRoot.StartsWith($programRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or -not ([string]$agent.DataDir).Equals($expectedData,[StringComparison]::OrdinalIgnoreCase) -or $agent.Port -ne 4317){throw 'Unexpected protected agent paths or port.'}
$expectedImage='"'+(Join-Path $appRoot 'agent\KalkanDlpAgent.exe')+'" --config "'+$configFile+'"'
if(-not $service.PathName.Equals($expectedImage,[StringComparison]::OrdinalIgnoreCase)){throw 'Service executable/configuration ownership does not match.'}
Assert-Ancestors $appRoot
foreach($item in @((Get-Item -LiteralPath $programRoot),(Get-Item -LiteralPath (Join-Path $programRoot 'versions')),(Get-Item -LiteralPath $appRoot))+@(Get-ChildItem -LiteralPath $appRoot -Recurse -Force)){Assert-Protected $item.FullName -Code}
$node=Join-Path $appRoot 'runtime\node.exe'
$verify=Join-Path $appRoot 'tools\verify-package.cjs'
$cli=Join-Path $appRoot 'tools\enroll-agent.cjs'
if(-not(Test-Path -LiteralPath $verify) -or -not(Test-Path -LiteralPath $cli)){throw 'Upgrade to an agent package containing the enrollment tools.'}
if((Get-AuthenticodeSignature -LiteralPath $node).Status -ne 'Valid'){throw 'Bundled Node runtime signature is invalid.'}
$savedOptions=$env:NODE_OPTIONS;$savedNodePath=$env:NODE_PATH
try{Remove-Item Env:NODE_OPTIONS,Env:NODE_PATH -ErrorAction SilentlyContinue;& $node $verify $appRoot | Out-Null;if($LASTEXITCODE -ne 0){throw 'Machine package manifest verification failed.'}}finally{$env:NODE_OPTIONS=$savedOptions;$env:NODE_PATH=$savedNodePath}
if(Test-Path -LiteralPath $connection){Assert-Protected $connection -Secret;throw 'An agent identity already exists. It will not be overwritten.'}
$pending=$connection+'.pending.json'
if(Test-Path -LiteralPath $pending){Assert-Protected $pending -Secret;if(-not $Resume){throw 'Enrollment is pending; use -Resume instead of creating a new identity.'}}
elseif($Resume){throw 'No pending enrollment was found.'}
if($ValidateOnly){Write-Host 'Machine enrollment preflight passed. No service or identity was changed.';exit}
if($EnrollmentFile){
 $request=$fileRequest;$fileRequest=$null
}elseif($Resume){
 if((Get-Item -LiteralPath $pending).Length -gt 131072){throw 'Pending enrollment is too large.'}
 $request=Get-Content -LiteralPath $pending -Raw -Encoding UTF8 | ConvertFrom-Json
}else{
 if(-not $Origin){$Origin=Read-Host 'Central HTTPS origin'}
 $uri=[Uri]$Origin
 if($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment){throw 'A plain HTTPS origin is required.'}
 $request=@{origin=$Origin;name=$DeviceName}
 if($CAFile){if((Get-Item -LiteralPath $CAFile).Length -gt 65536){throw 'CA file is too large.'};$request.caPem=Get-Content -LiteralPath $CAFile -Raw -Encoding UTF8;if($request.caPem -match 'PRIVATE KEY'){throw 'Only the public CA certificate may be provided.'}}
 $secure=Read-Host 'One-time agent enrollment key (hidden input)' -AsSecureString
 $pointer=[IntPtr]::Zero
 try{$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$request.token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);if($request.token -notmatch '^[a-f0-9]{64}$'){throw 'Invalid enrollment key format.'}}finally{if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)};$secure.Dispose()}
}
$required=Join-Path $common 'central-enrollment.required'
if(Test-Path -LiteralPath $required){Assert-Protected $required -Secret}else{$marker=[IO.File]::Open($required,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$markerBytes=[Text.Encoding]::UTF8.GetBytes('managed-enrollment-required-v1');$marker.Write($markerBytes,0,$markerBytes.Length);$marker.Flush($true)}finally{$marker.Dispose()}}
Stop-Service -Name $name -ErrorAction Stop
(Get-Service -Name $name).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(20))
$start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$node;$start.Arguments='"'+$cli+'" "'+$connection+'"';$start.WorkingDirectory=$appRoot;$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
foreach($key in @($start.EnvironmentVariables.Keys)){if($key -like 'NODE_*'){$start.EnvironmentVariables.Remove($key)}}
$process=[Diagnostics.Process]::new();$process.StartInfo=$start;$bytes=$null;$started=$false
try{
 if(-not $process.Start()){throw 'Enrollment tool could not start.'};$started=$true
 $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
 $bytes=[Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Compress -Depth 4));$process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length);$process.StandardInput.BaseStream.Flush();$process.StandardInput.Close()
 if(-not $process.WaitForExit(20000)){$process.Kill();$process.WaitForExit();throw 'Enrollment timed out. The service remains stopped; resume the pending request.'}
 $stdout.GetAwaiter().GetResult() | Out-Null;$stderr.GetAwaiter().GetResult() | Out-Null
 if($process.ExitCode -ne 0){throw 'Enrollment did not complete. The service remains stopped; inspect protected state and use -Resume.'}
}catch{if($started -and -not $process.HasExited){$process.Kill();$process.WaitForExit()};throw}finally{if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};$request=$null;$process.Dispose()}
Assert-Protected $connection -Secret
Start-Service -Name $name
$ready=$false
for($attempt=0;$attempt -lt 30;$attempt++){
 Start-Sleep -Milliseconds 500
 try{
  $status=Get-Content -LiteralPath (Join-Path $expectedData 'agent-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $currentService=Get-CimInstance Win32_Service -Filter "Name='KalkanDlpAgent'"
  $health=Invoke-RestMethod 'http://127.0.0.1:4317/api/health' -TimeoutSec 1
  if($health.application -eq 'Kalkan DLP' -and $health.deployment -eq 'service' -and $status.mode -eq 'windows-service' -and $status.hostPid -eq $currentService.ProcessId -and $health.processId -eq $status.childPid){$ready=$true;break}
 }catch{}
}
if(-not $ready){throw 'The registered service did not pass its protected process/health check.'}
Write-Host 'Machine agent enrollment completed. Verify central policy and agent status in the administrator panel.'
