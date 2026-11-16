param([ValidateSet('Client','Server','Both')][string]$Role='Both')
$ErrorActionPreference='Stop'
# Deliberate allowlist: never read configuration, databases, logs or credentials.
$report=[ordered]@{schema=1;createdAt=[DateTime]::UtcNow.ToString('o');role=$Role;os=$null;services=@();errors=@()}
try{$os=Get-CimInstance Win32_OperatingSystem -ErrorAction Stop;$report.os=[ordered]@{version=$os.Version;build=$os.BuildNumber;architecture=$os.OSArchitecture;lastBootUtc=$os.LastBootUpTime.ToUniversalTime().ToString('o')}}catch{$report.errors+= 'OS_QUERY_FAILED'}
$names=if($Role -eq 'Client'){@('KalkanDlpAgent')}elseif($Role -eq 'Server'){@('KalkanDlpCentral')}else{@('KalkanDlpAgent','KalkanDlpCentral')}
foreach($name in $names){
 try{
  $svc=Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction Stop
  if(!$svc){$report.services+= [ordered]@{name=$name;installed=$false};continue}
  $report.services+= [ordered]@{name=$name;installed=$true;state=[string]$svc.State;startMode=[string]$svc.StartMode;exitCode=[int]$svc.ExitCode;serviceExitCode=[int]$svc.ServiceSpecificExitCode;dedicatedIdentity=($svc.StartName -eq ('NT SERVICE\'+$name))}
 }catch{$report.services+= [ordered]@{name=$name;queryFailed=$true};$report.errors+= ('SERVICE_QUERY_FAILED:'+ $name)}
}
$report|ConvertTo-Json -Depth 6
if($report.errors.Count -gt 0){exit 1}
