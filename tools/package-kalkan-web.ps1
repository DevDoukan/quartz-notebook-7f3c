$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$release=Join-Path $root 'Kalkan-DLP-Kurulum'
$site=Join-Path $root 'marketing-site'
$panel=Join-Path $root 'licensing-php\panel'
$stage=Join-Path $root '.build\kalkan-web'
$panelDoc=Join-Path $stage 'panel-docroot'
$panelPrivate=Join-Path $stage 'private'
if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Path $stage,$panelDoc,$panelPrivate -Force|Out-Null
Get-ChildItem -LiteralPath $site -Force|Where-Object Name -ne 'TRACKING-KURULUM.md'|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force}
Copy-Item -LiteralPath (Join-Path $panel '.htaccess') -Destination (Join-Path $panelDoc '.htaccess')
Copy-Item -LiteralPath (Join-Path $panel 'index.php') -Destination (Join-Path $panelDoc 'index.php')
Copy-Item -LiteralPath (Join-Path $panel 'README.md') -Destination (Join-Path $panelDoc 'README-DEPLOYMENT.md')
Copy-Item -Path (Join-Path $panel 'ui\*') -Destination $panelDoc -Recurse -Force
$configTemplate=@'
<?php
return [
  // Use the same SQLite file configured by lisans.kalkandlp.com.tr.
  'database' => '/home/ACCOUNT/domains/kalkandlp.com.tr/private/kalkan-licenses.sqlite',
  // Replace with the SHA-256 digest from your protected local install notes.
  'setup_token_hash' => 'REPLACE_WITH_64_HEX_SHA256',
];
'@
Set-Content -LiteralPath (Join-Path $panelPrivate 'panel-config.example.php') -Value $configTemplate -Encoding utf8
$siteZip=Join-Path $release 'Kalkan-DLP-Ana-Site-Yayin.zip'
$panelZip=Join-Path $release 'Kalkan-DLP-Panel-Yayin.zip'
foreach($file in @($siteZip,$panelZip)){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}}
Compress-Archive -Path (Get-ChildItem -LiteralPath $stage -Force|Where-Object{$_.Name -notin @('panel-docroot','private')}|ForEach-Object FullName) -DestinationPath $siteZip -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $stage 'panel-docroot\*'),(Join-Path $stage 'panel-docroot\.htaccess') -DestinationPath $panelZip -CompressionLevel Optimal
Copy-Item -LiteralPath (Join-Path $panel 'README.md') -Destination (Join-Path $release 'PANEL-YAYIN.md') -Force
Copy-Item -LiteralPath (Join-Path $site 'TRACKING-KURULUM.md') -Destination (Join-Path $release 'SEO-GEO-ADS-KURULUM.md') -Force
Write-Host "Created $siteZip"
Write-Host "Created $panelZip"
