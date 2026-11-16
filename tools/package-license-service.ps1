$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$stage=Join-Path $root ('.build\license-service-'+$version)
if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Path (Join-Path $stage 'public'),(Join-Path $stage 'private') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\public\index.php') -Destination (Join-Path $stage 'public\index.php')
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\public\.htaccess') -Destination (Join-Path $stage 'public\.htaccess')
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\private\.htaccess') -Destination (Join-Path $stage 'private\.htaccess')
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\config.example.php') -Destination (Join-Path $stage 'private\config.php.example')
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\vendor-public.key') -Destination (Join-Path $stage 'vendor-public.key')
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\README.md') -Destination (Join-Path $stage 'README.md')
$out=Join-Path $root ('release\Kalkan-License-Service-'+$version+'.zip')
New-Item -ItemType Directory -Path (Split-Path -Parent $out) -Force | Out-Null
if(Test-Path -LiteralPath $out){Remove-Item -LiteralPath $out -Force}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out -CompressionLevel Optimal
Write-Host ('Created '+$out)
