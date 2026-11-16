param([Parameter(Mandatory=$true)][ValidateSet('Backup','Verify')][string]$Action,[Parameter(Mandatory=$true)][string]$BackupPath)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$node=(Get-Command node.exe -ErrorAction Stop).Source
$target=[IO.Path]::GetFullPath($BackupPath)
if($target -match '["\r\n]' -or $target.EndsWith('\')){throw 'Geçersiz yedek dosya yolu.'}
if($Action -eq 'Backup' -and (Test-Path -LiteralPath $target)){throw 'Hedef dosya zaten var; üzerine yazılmaz.'}
$secret=Read-Host 'Yedek parolası (16–128 karakter)' -AsSecureString
$ptr=[IntPtr]::Zero;$process=$null
try{
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 if($plain.Length -lt 16 -or $plain.Length -gt 128 -or $plain -match '[\r\n]'){throw 'Parola 16–128 karakter olmalı.'}
 if($Action -eq 'Backup'){
  $again=Read-Host 'Yedek parolasını tekrar girin' -AsSecureString
  $other=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($again)
  try{if($plain -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($other)){throw 'Parolalar eşleşmiyor.'}}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($other);$again.Dispose()}
 }
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$node;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
 $tool=Join-Path $root 'tools\vendor-key-backup.cjs';$seed=Join-Path $root '.vendor\vendor-signing.seed'
 foreach($p in @($tool,$seed)){if($p -match '["\r\n]'){throw 'Geçersiz araç yolu.'}}
 $info.Arguments=if($Action -eq 'Backup'){'"'+$tool+'" backup "'+$seed+'" "'+$target+'"'}else{'"'+$tool+'" verify "'+$target+'"'}
 $process=[Diagnostics.Process]::Start($info)
 $process.StandardInput.WriteLine($plain);$process.StandardInput.Close();$plain=$null
 $process.WaitForExit();if($process.ExitCode -ne 0){throw 'Yedek işlemi tamamlanamadı.'}
}finally{$plain=$null;if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};$secret.Dispose();if($process){$process.Dispose()}}
