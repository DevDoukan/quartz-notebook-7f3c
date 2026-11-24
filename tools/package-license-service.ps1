$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$source=Join-Path $root 'licensing-php'
$files=[ordered]@{
 'public/index.php'='public/index.php'
 'public/.htaccess'='public/.htaccess'
 'private/.htaccess'='private/.htaccess'
 'private/config.php.example'='config.example.php'
 'vendor-public.key'='vendor-public.key'
 'README.md'='README.md'
}
$out=Join-Path $root ('release\Kalkan-License-Service-'+$version+'.zip')
New-Item -ItemType Directory -Path (Split-Path -Parent $out) -Force | Out-Null
$temp=$out+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
 $archive=[IO.Compression.ZipFile]::Open($temp,[IO.Compression.ZipArchiveMode]::Create)
 try {
  foreach($entry in $files.Keys){
   [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $archive,(Join-Path $source $files[$entry]),$entry,[IO.Compression.CompressionLevel]::Optimal
   ) | Out-Null
  }
 } finally {
  $archive.Dispose()
 }
 if(Test-Path -LiteralPath $out){Move-Item -LiteralPath $temp -Destination $out -Force}
 else{[IO.File]::Move($temp,$out)}
} finally {
 if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}
}
Write-Host ('Created '+$out)
