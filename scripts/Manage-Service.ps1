param([Parameter(Mandatory=$true)][ValidateSet('Install','Remove','Status')][string]$Action,[string]$AppRoot)
$ErrorActionPreference='Stop'
$name='KalkanDlpAgent'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
$programRoot=Join-Path $env:ProgramW6432 'KalkanDLP'
$common=Join-Path $env:ProgramData 'KalkanDLP'
$data=Join-Path $common 'Data'
$config=Join-Path $common 'agent-config.json'
function Get-OwnService {
 $service=Get-CimInstance Win32_Service -Filter "Name='KalkanDlpAgent'"
 if($service -and -not $service.PathName.StartsWith('"'+$programRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'The existing service is not owned by this installation.'}
 return $service
}
if($Action -eq 'Status'){Get-OwnService | Select-Object Name,State,StartMode,StartName,PathName | ConvertTo-Json;exit}
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'An elevated Windows administrator is required.'}
$existing=Get-OwnService
$productKey='HKLM:\Software\KalkanDLP'
if($Action -eq 'Remove'){
 if($existing){Stop-Service -Name $name -Force -ErrorAction Stop;$result=Invoke-CimMethod -InputObject (Get-OwnService) -MethodName Delete;if($result.ReturnValue -ne 0){throw 'Service removal failed.'}}
 if(Test-Path -LiteralPath $productKey){Remove-ItemProperty -LiteralPath $productKey -Name CurrentPath -ErrorAction SilentlyContinue}
 Write-Host 'Service removed. Company data and USB policy settings were preserved.';exit
}
$sc=Join-Path $env:SystemRoot 'System32\sc.exe'
$sidOutput=(& $sc showsid $name | Out-String)
$expectedSid=[regex]::Match($sidOutput,'S-1-5-80-(?:\d+-){4}\d+').Value
if(-not $expectedSid){throw 'The dedicated service identity could not be resolved.'}
$trustedOwners=@('S-1-5-18','S-1-5-32-544')
$writeBits=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$readBits=[Security.AccessControl.FileSystemRights]::ReadData -bor [Security.AccessControl.FileSystemRights]::ReadExtendedAttributes
function Test-ProtectedItem([string]$Path){
 $item=Get-Item -LiteralPath $Path -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Service data paths cannot contain reparse points.'}
 $security=Get-Acl -LiteralPath $Path
 $allowedOwners=$trustedOwners
 if($Path.Equals($data,[StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($data+'\',[StringComparison]::OrdinalIgnoreCase)){$allowedOwners+=@($expectedSid)}
 $owner=$security.GetOwner([Security.Principal.SecurityIdentifier]).Value
 if($owner -notin $allowedOwners){throw ('Existing service data has an untrusted owner: '+$Path)}
 foreach($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){$writer=$rule.IdentityReference.Value;if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $writeBits) -and $writer -notin $allowedOwners -and -not($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)){throw ('Existing service data is writable by an untrusted account: '+$Path)}}
 foreach($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){$reader=$rule.IdentityReference.Value;if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $readBits) -and $reader -notin ($trustedOwners+@($expectedSid)) -and -not($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)){throw ('Existing private service state is readable by an untrusted account: '+$Path)}}
}
if(Test-Path -LiteralPath $common){Test-ProtectedItem $common;foreach($item in Get-ChildItem -LiteralPath $common -Force -Recurse){Test-ProtectedItem $item.FullName}}
if(-not $AppRoot){throw 'AppRoot is required.'}
$AppRoot=[IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
if(-not $AppRoot.StartsWith($programRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'The machine agent must be installed below Program Files\KalkanDLP.'}
$current=Get-Item -LiteralPath $AppRoot
while($current -and $current.FullName.Length -ge $programRoot.Length){if($current.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse points are not allowed in machine installation paths.'};$current=$current.Parent}
$hostExe=Join-Path $AppRoot 'agent\KalkanDlpAgent.exe'
foreach($file in @($hostExe,(Join-Path $AppRoot 'agent\KalkanFileBroker.exe'),(Join-Path $AppRoot 'runtime\node.exe'),(Join-Path $AppRoot 'server.js'))){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'Machine installation files are incomplete.'}}
$trustedSids=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
$writeBits=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$codeItems=@(Get-Item -LiteralPath $AppRoot)+@(Get-ChildItem -LiteralPath $AppRoot -Recurse -Force)
$ancestor=(Get-Item -LiteralPath $AppRoot).Parent
while($ancestor -and $ancestor.FullName.Length -ge $programRoot.Length){$codeItems+=$ancestor;$ancestor=$ancestor.Parent}
foreach($item in $codeItems){
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Machine packages cannot contain reparse points.'}
 $security=Get-Acl -LiteralPath $item.FullName
 if($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trustedSids){throw ('Untrusted application owner: '+$item.FullName)}
 foreach($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){$sid=$rule.IdentityReference.Value;if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $writeBits) -and $sid -notin $trustedSids -and -not($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)){throw ('Untrusted write access on application file: '+$item.FullName)}}
}
$packageVersion=(Get-Content -LiteralPath (Join-Path $AppRoot 'package.json') -Raw | ConvertFrom-Json).version
if($packageVersion -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$'){throw 'Machine package version is invalid.'}
$oldConfig=$null;if(Test-Path -LiteralPath $config){$oldConfig=Get-Content -LiteralPath $config -Raw}
$oldImage=$existing.PathName
$created=$false
$wasRunning=$existing.State -eq 'Running'
$updated=$false
try {
 if($wasRunning){Stop-Service -Name $name -Force -ErrorAction Stop}
$probe=[Net.Sockets.TcpClient]::new()
try{$connection=$probe.ConnectAsync('127.0.0.1',4317);if($connection.Wait(500) -and $probe.Connected){throw 'Port 4317 is occupied. Stop the other instance first.'}}catch [AggregateException]{}finally{$probe.Dispose()}
 $image='"'+$hostExe+'" --config "'+$config+'"'
 if(-not $existing){$result=Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{Name=$name;DisplayName='Kalkan DLP Agent';PathName=$image;ServiceType=[byte]16;ErrorControl=[byte]1;StartMode='Automatic';StartName='NT SERVICE\KalkanDlpAgent'};if($result.ReturnValue -ne 0){throw ('Service creation failed: '+$result.ReturnValue)};$created=$true}
 else{$result=Invoke-CimMethod -InputObject $existing -MethodName Change -Arguments @{PathName=$image;StartName='NT SERVICE\KalkanDlpAgent';StartMode='Automatic'};if($result.ReturnValue -ne 0){throw 'Service update failed.'};$updated=$true}
 & $sc sidtype $name unrestricted | Out-Null;if($LASTEXITCODE -ne 0){throw 'Service SID configuration failed.'}
 & $sc privs $name SeChangeNotifyPrivilege | Out-Null;if($LASTEXITCODE -ne 0){throw 'Service privilege restriction failed.'}
 & $sc sdset $name 'D:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)' | Out-Null;if($LASTEXITCODE -ne 0){throw 'Service control security configuration failed.'}
 & $sc failure $name reset= 86400 actions= restart/60000/restart/120000/none/0 | Out-Null;if($LASTEXITCODE -ne 0){throw 'Service recovery configuration failed.'}
 & $sc failureflag $name 1 | Out-Null;if($LASTEXITCODE -ne 0){throw 'Service failure-action flag configuration failed.'}
 $sid=([Security.Principal.NTAccount]('NT SERVICE\'+$name)).Translate([Security.Principal.SecurityIdentifier])
 foreach($folder in @($common,$data)){
  if(Test-Path -LiteralPath $folder){Test-ProtectedItem $folder}
  $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544')
  $serviceRights=if($folder -eq $data){'Modify'}else{'ReadAndExecute'}
  foreach($entry in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@($sid.Value,$serviceRights))){$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$entry[0],[Security.AccessControl.FileSystemRights]$entry[1],'ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)}
  if(Test-Path -LiteralPath $folder){Set-Acl -LiteralPath $folder -AclObject $acl}else{[IO.Directory]::CreateDirectory($folder,$acl) | Out-Null}
 }
 $registryKey=[Microsoft.Win32.Registry]::LocalMachine.CreateSubKey('SYSTEM\CurrentControlSet\Control\StorageDevicePolicies',[Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree)
 try {
  $registryAcl=$registryKey.GetAccessControl()
  $registryAcl.AddAccessRule([Security.AccessControl.RegistryAccessRule]::new($sid,([Security.AccessControl.RegistryRights]::ReadKey -bor [Security.AccessControl.RegistryRights]::SetValue),'Allow'))
  $registryKey.SetAccessControl($registryAcl)
 } finally { if($registryKey){$registryKey.Dispose()} }
 @{AppRoot=$AppRoot;DataDir=$data;Port=4317;MemoryLimitMb=1024} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
 if(-not [Diagnostics.EventLog]::SourceExists($name)){New-EventLog -LogName Application -Source $name}
 Start-Service -Name $name
 $ready=$false
 for($attempt=0;$attempt -lt 30;$attempt++){Start-Sleep -Milliseconds 500;try{$health=Invoke-RestMethod 'http://127.0.0.1:4317/api/health' -TimeoutSec 1;if($health.application -eq 'Kalkan DLP' -and $health.deployment -eq 'service' -and $health.version -eq $packageVersion){$ready=$true;break}}catch{}}
 if(-not $ready){throw 'Agent health check failed. Inspect the protected agent log.'}
 if(-not(Test-Path -LiteralPath $productKey)){New-Item -Path $productKey -Force | Out-Null}
 New-ItemProperty -LiteralPath $productKey -Name CurrentPath -PropertyType String -Value $AppRoot -Force | Out-Null
 Write-Host 'Machine service installed with a dedicated virtual account. Configure trusted folders in the administrator panel.'
} catch {
 $failure=$_
 if($created -or $updated){Stop-Service -Name $name -Force -ErrorAction SilentlyContinue}
 if($created){Invoke-CimMethod -InputObject (Get-OwnService) -MethodName Delete | Out-Null}
 elseif($updated -and $oldConfig -and $oldImage){Set-Content -LiteralPath $config -Value $oldConfig -Encoding UTF8;Invoke-CimMethod -InputObject (Get-OwnService) -MethodName Change -Arguments @{PathName=$oldImage} | Out-Null}
 if($wasRunning){Start-Service -Name $name -ErrorAction SilentlyContinue}
 throw $failure
}
