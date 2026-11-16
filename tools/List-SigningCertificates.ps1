$ErrorActionPreference='Stop'
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object Subject,Issuer,Thumbprint,NotBefore,NotAfter,HasPrivateKey | ConvertTo-Json
