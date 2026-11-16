param([Parameter(Mandatory=$true)][ValidateSet('Initialize','Configure','Provision','Install','Remove','Stop','Status','Validate')][string]$Action,[string]$AppRoot,[string]$Origin,[string]$CertificateFile,[string]$PrivateKeyFile,[string]$CAFile)
$ErrorActionPreference='Stop'
$createdConfiguration=$null
$createdConfigurationText=$null
trap {
 if($createdConfiguration -and [IO.File]::Exists($createdConfiguration)){
  if([IO.File]::ReadAllText($createdConfiguration) -ceq $createdConfigurationText){[IO.File]::Delete($createdConfiguration)}
 }
 throw $_
}
$name='KalkanDlpCentral'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
$programRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'KalkanDLPCentral'
$common=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'KalkanDLPCentral'
$data=Join-Path $common 'Data'
$config=Join-Path $common 'central-service.json'
function Get-OwnService {
 $service=Get-CimInstance Win32_Service -Filter "Name='KalkanDlpCentral'"
 if($service -and $service.StartName -ne 'NT SERVICE\KalkanDlpCentral'){throw 'The existing service identity is not owned by this installation.'}
 $expectedImage='^"'+[regex]::Escape($programRoot)+'\\[^"\r\n]+\\agent\\KalkanDlpCentral\.exe" --config "'+[regex]::Escape($config)+'"$'
 if($service -and $service.PathName -notmatch $expectedImage){throw 'The existing service is not owned by this installation.'}
 return $service
}
if($Action -eq 'Status'){Get-OwnService | Select-Object Name,State,StartMode,StartName,PathName | ConvertTo-Json;exit}
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'An elevated Windows administrator is required.'}
if(-not [Environment]::Is64BitProcess){throw '64-bit PowerShell is required.'}
$existing=Get-OwnService
if($Action -eq 'Stop'){if($existing){Stop-Service -Name $name -Force -ErrorAction Stop};Write-Host 'Central service stopped; data preserved.';exit}
if($Action -eq 'Initialize'){
 if($existing -or (Test-Path -LiteralPath $common)){throw 'Central service state already exists. Nothing was changed.'}
 $parent=Get-Item -LiteralPath (Split-Path -Parent $common) -Force
 while($parent){if($parent.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Central state ancestors cannot contain reparse points.'};$parent=$parent.Parent}
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544')
 foreach($trusted in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$trusted,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
 [IO.Directory]::CreateDirectory($common,$acl) | Out-Null
 [IO.Directory]::CreateDirectory((Join-Path $common 'TLS')) | Out-Null
 [IO.Directory]::CreateDirectory($data) | Out-Null
 Write-Host 'Private central directories created. Place your TLS files and server-config.json there before Validate/Install. No service was created.';exit
}
if($Action -eq 'Remove'){
 if($existing){Stop-Service -Name $name -Force -ErrorAction Stop;$result=Invoke-CimMethod -InputObject (Get-OwnService) -MethodName Delete;if($result.ReturnValue -ne 0){throw 'Service removal failed.'}}
 Write-Host 'Service removed. Central databases and TLS configuration were preserved.';exit
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
if(-not $AppRoot.StartsWith($programRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'The central service must be installed below Program Files\KalkanDLPCentral.'}
$current=Get-Item -LiteralPath $AppRoot
while($current -and $current.FullName.Length -ge $programRoot.Length){if($current.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse points are not allowed in machine installation paths.'};$current=$current.Parent}
$hostExe=Join-Path $AppRoot 'agent\KalkanDlpCentral.exe'
foreach($file in @($hostExe,(Join-Path $AppRoot 'runtime\node.exe'),(Join-Path $AppRoot 'central-server.js'))){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'Machine installation files are incomplete.'}}
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
$serverConfig=Join-Path $common 'server-config.json'
if($Action -in @('Configure','Provision')){
 if($existing -or (Test-Path -LiteralPath $serverConfig)){throw 'Configuration or service already exists. Nothing was changed.'}
 if(-not(Test-Path -LiteralPath $common -PathType Container)){throw 'Run Initialize before Configure.'}
 if(!$Origin -or !$CertificateFile -or !$PrivateKeyFile){throw 'Origin, CertificateFile and PrivateKeyFile are required.'}
 $address=[Uri]$Origin
 if(!$address.IsAbsoluteUri -or $address.Scheme -ne 'https'){throw 'An absolute HTTPS origin is required.'}
 $settings=@{dataDir=$data;port=$address.Port;origin=$Origin;tlsCertFile=$CertificateFile;tlsKeyFile=$PrivateKeyFile;requireMfa=$true}
 if($CAFile){$settings.caFile=$CAFile}
 $createdConfigurationText=$settings|ConvertTo-Json
 $stream=[IO.File]::Open($serverConfig,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{
  $createdConfiguration=$serverConfig
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes($createdConfigurationText)
  $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)
 }catch{
  $stream.Dispose();[IO.File]::Delete($serverConfig);$createdConfiguration=$null;throw
 }finally{$stream.Dispose()}
}
if(-not(Test-Path -LiteralPath $serverConfig -PathType Leaf)){throw 'Prepare administrator-protected server-config.json and TLS files in ProgramData\KalkanDLPCentral before installing.'}
if((Get-Item -LiteralPath $serverConfig).Length -gt 16384){throw 'Server configuration is too large.'}
$serverSettings=Get-Content -LiteralPath $serverConfig -Raw -Encoding UTF8 | ConvertFrom-Json
$port=[int]$serverSettings.port
if($port -lt 1 -or $port -gt 65535 -or $serverSettings.requireMfa -ne $true){throw 'A valid port and mandatory MFA are required.'}
foreach($field in @('tlsCertFile','tlsKeyFile')){
 $tlsFile=[string]$serverSettings.$field
 if(-not [IO.Path]::IsPathRooted($tlsFile)){throw 'Absolute TLS paths are required.'}
 $tlsFile=[IO.Path]::GetFullPath($tlsFile)
 if(-not $tlsFile.StartsWith($common+'\TLS\',[StringComparison]::OrdinalIgnoreCase) -or -not(Test-Path -LiteralPath $tlsFile -PathType Leaf)){throw 'TLS certificate and key must be in the protected Common TLS directory.'}
 if((Get-Item -LiteralPath $tlsFile).Length -gt 65536){throw 'TLS file is too large.'}
}
if($serverSettings.caFile){$ca=[IO.Path]::GetFullPath([string]$serverSettings.caFile);if(-not $ca.StartsWith($common+'\TLS\',[StringComparison]::OrdinalIgnoreCase) -or -not(Test-Path -LiteralPath $ca -PathType Leaf) -or (Get-Item -LiteralPath $ca).Length -gt 65536){throw 'Custom CA must be a bounded public certificate in the protected TLS directory.'}}
if(-not [string]::Equals([IO.Path]::GetFullPath([string]$serverSettings.dataDir),$data,[StringComparison]::OrdinalIgnoreCase)){throw 'Central service data must use the protected Data directory.'}
foreach($variable in @(Get-ChildItem Env: | Where-Object {$_.Name -like 'DLP_*' -or $_.Name -in @('NODE_OPTIONS','NODE_PATH','PSModulePath')})){Remove-Item -LiteralPath ('Env:'+ $variable.Name)}
$env:DLP_CENTRAL_SERVER_CONFIG=$serverConfig
$node=Join-Path $AppRoot 'runtime\node.exe'
if((Get-AuthenticodeSignature -LiteralPath $node).Status -ne 'Valid'){throw 'Bundled Node Authenticode signature is not valid.'}
& $node (Join-Path $AppRoot 'tools\verify-package.cjs') $AppRoot | Out-Null
if($LASTEXITCODE -ne 0){throw 'Central package manifest verification failed.'}
Push-Location $AppRoot
try{& $node -e "const c=require('./central-config').loadCentralConfig();if(!c.tls||!c.requireMfa)throw Error('TLS and MFA required');";if($LASTEXITCODE -ne 0){throw 'Central TLS configuration failed validation.'}}finally{Pop-Location}

if($Action -eq 'Validate'){Write-Host 'Central package, protected paths and TLS configuration validated. No service or files were changed.';exit}
if($Action -eq 'Configure'){Write-Host 'HTTPS configuration created and validated. No service was started. Run Install next.';exit}
$oldConfig=$null;if(Test-Path -LiteralPath $config){$oldConfig=Get-Content -LiteralPath $config -Raw}
$oldImage=$existing.PathName
$oldWasRunning=$existing -and $existing.State -eq 'Running'
$created=$false
try {
 if($existing){Stop-Service -Name $name -Force -ErrorAction Stop}
 $probe=[Net.Sockets.TcpClient]::new()
 try{$connection=$probe.ConnectAsync('127.0.0.1',$port);if($connection.Wait(500) -and $probe.Connected){throw 'Central port is occupied. Stop the other instance first.'}}catch [AggregateException]{}finally{$probe.Dispose()}
 $image='"'+$hostExe+'" --config "'+$config+'"'
 if(-not $existing){$result=Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{Name=$name;DisplayName='Kalkan DLP Central';PathName=$image;ServiceType=[byte]16;ErrorControl=[byte]1;StartMode='Automatic';StartName='NT SERVICE\KalkanDlpCentral'};if($result.ReturnValue -ne 0){throw ('Service creation failed: '+$result.ReturnValue)};$created=$true}
 else{$result=Invoke-CimMethod -InputObject $existing -MethodName Change -Arguments @{PathName=$image;StartName='NT SERVICE\KalkanDlpCentral';StartMode='Automatic'};if($result.ReturnValue -ne 0){throw 'Service update failed.'}}
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
 @{AppRoot=$AppRoot;DataDir=$data;Port=$port;MemoryLimitMb=1024;ServerConfigFile=$serverConfig} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
 if(-not [Diagnostics.EventLog]::SourceExists($name)){New-EventLog -LogName Application -Source $name}
 Start-Service -Name $name
 $ready=$false
 for($attempt=0;$attempt -lt 30;$attempt++){
  Start-Sleep -Milliseconds 500
  try{
   $output=& $node (Join-Path $AppRoot 'tools\central-control.cjs') status 2>$null
   if($LASTEXITCODE -ne 0){continue}
   $health=$output | ConvertFrom-Json
   $status=Get-Content -LiteralPath (Join-Path $data 'central-service-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
   $owner=Get-OwnService
   if($health.running -and $health.deployment -eq 'windows-service' -and $health.processId -eq $status.childPid -and $status.hostPid -eq $owner.ProcessId){$ready=$true;break}
  }catch{}
 }
 if(-not $ready){throw 'Central service health/identity check failed. Inspect protected logs.'}
 Write-Host 'Central service installed with its dedicated virtual account. Real reboot and separate-user acceptance is still required.'
} catch {
 $failure=$_
 Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
 if($created){Invoke-CimMethod -InputObject (Get-OwnService) -MethodName Delete | Out-Null}
 elseif($oldConfig -and $oldImage){Set-Content -LiteralPath $config -Value $oldConfig -Encoding UTF8;Invoke-CimMethod -InputObject (Get-OwnService) -MethodName Change -Arguments @{PathName=$oldImage} | Out-Null;if($oldWasRunning){Start-Service -Name $name -ErrorAction SilentlyContinue}}
 throw $failure
}
