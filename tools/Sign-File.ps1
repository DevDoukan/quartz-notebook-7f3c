param(
 [Parameter(Mandatory=$true)][string]$Path,
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$CertificateThumbprint,
 [string]$SignTool,
 [string]$TimestampUrl='http://timestamp.digicert.com'
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$product=Get-Content -LiteralPath (Join-Path $root 'product-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if(-not $product.signing.validatedSubject){throw 'Register the CA-validated public certificate Subject in product-config.json before signing.'}
$certificate=Get-Item -LiteralPath ('Cert:\CurrentUser\My\'+$CertificateThumbprint)
if(-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)){throw 'The signing certificate or hardware key is unavailable or not currently valid.'}
if($certificate.Subject -ne $product.signing.validatedSubject){throw 'The certificate does not match the approved publisher identity.'}
if($certificate.Subject -eq $certificate.Issuer){throw 'Self-signed certificates are not accepted for release signing.'}
$eku=$certificate.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.37'} | Select-Object -First 1
if(-not $eku){throw 'A Code Signing certificate is required.'}
$usages=[Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku,$eku.Critical)
if(-not($usages.EnhancedKeyUsages | Where-Object {$_.Value -eq '1.3.6.1.5.5.7.3.3'})){throw 'A Code Signing certificate is required.'}
$target=(Resolve-Path -LiteralPath $Path).Path
if([IO.Path]::GetExtension($target) -eq '.ps1'){
 $result=Set-AuthenticodeSignature -LiteralPath $target -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
 if($result.Status -ne 'Valid'){throw ('PowerShell signature verification failed: '+$result.Status)}
}else{
 if(-not $SignTool -or -not(Test-Path -LiteralPath $SignTool -PathType Leaf)){throw 'Provide the Windows SDK SignTool executable path.'}
 & $SignTool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $target
 if($LASTEXITCODE -ne 0){throw 'Hardware-backed signing or timestamping failed.'}
 & $SignTool verify /pa /all $target
 if($LASTEXITCODE -ne 0){throw 'Authenticode trust verification failed.'}
}
$signature=Get-AuthenticodeSignature -LiteralPath $target
if($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate -or $signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint){throw 'The final file does not have the expected trusted, timestamped signature.'}
