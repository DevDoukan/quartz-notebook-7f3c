param([Parameter(Mandatory=$true)][ValidateSet('Enable','Disable')][string]$Mode,[switch]$ServiceMode)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if($ServiceMode){
 $serviceSid=([Security.Principal.NTAccount]'NT SERVICE\KalkanDlpAgent').Translate([Security.Principal.SecurityIdentifier])
 if(-not($identity.User.Equals($serviceSid) -or $principal.IsInRole($serviceSid))){throw 'Kalkan DLP hizmet kimliği gerekiyor.'}
}elseif(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Yönetici izni gerekiyor.'}
$registryPath='HKLM:\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies'
if(-not(Test-Path -LiteralPath $registryPath)){New-Item -Path $registryPath -Force | Out-Null}
$expected = [int]($Mode -eq 'Enable')
New-ItemProperty -LiteralPath $registryPath -Name 'WriteProtect' -Value $expected -PropertyType DWord -Force | Out-Null
$actual = Get-ItemPropertyValue -LiteralPath $registryPath -Name 'WriteProtect'
if ($actual -isnot [int] -or $actual -ne $expected) {
 throw 'Windows USB yazma koruması değeri doğrulanamadı.'
}
