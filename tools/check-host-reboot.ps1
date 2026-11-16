$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$before=Get-Content -LiteralPath (Join-Path $root '.test-artifacts\host-before-reboot.json') -Raw -Encoding UTF8|ConvertFrom-Json
$boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
$oldBoot=if($before.bootTime -is [DateTime]){$before.bootTime.ToUniversalTime()}else{[DateTime]::Parse([string]$before.bootTime,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()}
$rebooted=$boot -gt $oldBoot
$services=@(Get-CimInstance Win32_Service -Filter "Name='KalkanDlpAgent' OR Name='KalkanDlpCentral'"|Select-Object Name,State,StartMode,StartName)
$failures=@()
if(!$rebooted){$failures+='No newer Windows boot was observed.'}
foreach($name in @('KalkanDlpAgent','KalkanDlpCentral')){
 $svc=$services|Where-Object Name -eq $name
 if(!$svc -or $svc.State -ne 'Running' -or $svc.StartMode -ne 'Auto' -or $svc.StartName -ne ('NT SERVICE\'+$name)){$failures+=('Unexpected service state: '+$name)}
}
$health=$null
try{$health=Invoke-RestMethod http://127.0.0.1:4317/api/health -TimeoutSec 5;if($health.application -ne 'Kalkan DLP' -or $health.deployment -ne 'service'){$failures+='Client health identity mismatch.'}}catch{$failures+='Client health unavailable.'}
$report=@{checkedAt=[DateTime]::UtcNow.ToString('o');newBootObserved=$rebooted;bootTime=$boot.ToString('o');services=$services;clientHealth=$health;passed=($failures.Count -eq 0);failures=$failures;scope='Post-login observation only. Does not prove pre-login startup, Server TLS health, USB enforcement or clean-machine acceptance.'}
$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $root '.test-artifacts\host-after-reboot.json') -Encoding UTF8
$report|ConvertTo-Json -Depth 6
if($failures.Count){exit 1}
