# Pure request validation. No service, filesystem or network changes.
function ConvertFrom-KalkanEnrollmentJson {
 param([Parameter(Mandatory=$true)][string]$Json,[string]$DefaultName=$env:COMPUTERNAME)
 try {
  $inputRequest=ConvertFrom-Json -InputObject $Json -ErrorAction Stop
  if($null -eq $inputRequest -or $inputRequest -isnot [pscustomobject]){throw 'Invalid object'}
  foreach($property in $inputRequest.PSObject.Properties){if($property.Name -cnotin @('origin','name','token','caPem')){throw 'Unknown property'}}
  if($inputRequest.origin -isnot [string] -or $inputRequest.origin.Length -gt 2048 -or $inputRequest.token -isnot [string] -or $inputRequest.token -cnotmatch '\A[a-f0-9]{64}\z'){throw 'Invalid origin/token'}
  $uri=[Uri]$inputRequest.origin
  if(-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment){throw 'Invalid HTTPS origin'}
  $deviceName=$DefaultName
  if($inputRequest.PSObject.Properties.Name -ccontains 'name'){$deviceName=$inputRequest.name;if($deviceName -isnot [string]){throw 'Invalid name type'}}
  if(-not $deviceName -or -not $deviceName.Trim() -or $deviceName.Length -gt 120 -or $deviceName -match '[\x00-\x1f]'){throw 'Invalid device name'}
  $request=@{origin=$uri.GetLeftPart([UriPartial]::Authority);name=$deviceName.Trim();token=$inputRequest.token}
  if($inputRequest.PSObject.Properties.Name -ccontains 'caPem'){
   if($inputRequest.caPem -isnot [string] -or -not $inputRequest.caPem -or $inputRequest.caPem.Length -gt 65536 -or $inputRequest.caPem -match 'PRIVATE KEY'){throw 'Invalid public CA'}
   $request.caPem=$inputRequest.caPem
  }
  return $request
 }catch{throw 'Enrollment request JSON is invalid. Expected HTTPS origin, one-time token, optional device name and public caPem only.'}
}
