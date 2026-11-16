$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$stage=Join-Path $root '.build\kalkan-hosting-stack'
$site=Join-Path $root 'marketing-site'
$panel=Join-Path $root 'licensing-php\panel'
$licensePublic=Join-Path $root 'licensing-php\public'
$privateSource=Join-Path $root 'licensing-php\private'
$siteRoot=Join-Path $stage 'domains\kalkandlp.com.tr\public_html'
$panelDomain=Join-Path $stage 'domains\panel.kalkandlp.com.tr'
$panelRoot=Join-Path $panelDomain 'public_html'
$panelPrivate=Join-Path $panelDomain 'private'
$licenseDomain=Join-Path $stage 'domains\lisans.kalkandlp.com.tr'
$licenseRoot=Join-Path $licenseDomain 'public_html'
$licensePrivate=Join-Path $licenseDomain 'private'
if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Path $siteRoot,$panelRoot,$panelPrivate,$licenseRoot,$licensePrivate -Force|Out-Null
Get-ChildItem -LiteralPath $site -Force|Where-Object Name -ne 'TRACKING-KURULUM.md'|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination $siteRoot -Recurse -Force}
Get-ChildItem -LiteralPath (Join-Path $panel 'ui') -Force|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination $panelRoot -Recurse -Force}
Copy-Item -LiteralPath (Join-Path $panel '.htaccess') -Destination (Join-Path $panelRoot '.htaccess')
Copy-Item -LiteralPath (Join-Path $panel 'index.php') -Destination (Join-Path $panelRoot 'index.php')
Get-ChildItem -LiteralPath $licensePublic -Force|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination $licenseRoot -Recurse -Force}
Copy-Item -LiteralPath (Join-Path $privateSource '.htaccess') -Destination (Join-Path $licensePrivate '.htaccess')
Copy-Item -LiteralPath (Join-Path $privateSource '.htaccess') -Destination (Join-Path $panelPrivate '.htaccess')
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\config.example.php') -Destination (Join-Path $licensePrivate 'config.php.example')
Copy-Item -LiteralPath (Join-Path $root 'licensing-php\vendor-public.key') -Destination (Join-Path $licenseDomain 'vendor-public.key')
$hash=(Get-Content -LiteralPath (Join-Path $root '.vendor\kalkan-panel-setup.sha256') -Raw).Trim()
$panelConfig=@"
<?php
return [
  'database' => dirname(__DIR__, 2) . '/lisans.kalkandlp.com.tr/private/kalkan-licenses.sqlite',
  'setup_token_hash' => '$hash',
];
"@
Set-Content -LiteralPath (Join-Path $panelPrivate 'panel-config.php.example') -Value $panelConfig -Encoding utf8
$zip=Join-Path $root 'Kalkan-DLP-Kurulum\Kalkan-DLP-Web-Stack-Yayin.zip'
if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
Copy-Item -LiteralPath (Join-Path $root 'Kalkan-DLP-Kurulum\WEB-YAYIN-DURUMU.md') -Destination (Join-Path $root 'Kalkan-DLP-Kurulum\WEB-STACK-KURULUM.md') -Force
Write-Host "Created $zip"
