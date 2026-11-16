'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
test('unattended enrollment validates deployment JSON without prompting, service changes or secret errors',{skip:process.platform!=='win32'},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-enrollment-request-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const helper=path.join(__dirname,'..','scripts','EnrollmentRequest.ps1'),script=path.join(dir,'check.ps1');
 fs.writeFileSync(script,`
$ErrorActionPreference='Stop'
. '${helper.replace(/'/g,"''")}'
$token='a'*64
$valid=@{origin='https://central.example:9443';token=$token;name='Şirket İŞ-PC'} | ConvertTo-Json -Compress
$parsed=ConvertFrom-KalkanEnrollmentJson -Json $valid -DefaultName 'DEFAULT-PC'
if($parsed.origin -cne 'https://central.example:9443' -or $parsed.name -cne 'Şirket İŞ-PC' -or $parsed.token -cne $token){throw 'Valid deployment request failed'}
$minimal=@{origin='https://central.example';token=$token}|ConvertTo-Json -Compress
if((ConvertFrom-KalkanEnrollmentJson -Json $minimal -DefaultName 'DEFAULT-PC').name -cne 'DEFAULT-PC'){throw 'Default name failed'}
$invalid=@(
 @{origin='http://central.example';token=$token},
 @{origin='https://user:pass@central.example';token=$token},
 @{origin='https://central.example/path';token=$token},
 @{origin='https://central.example/?q=x';token=$token},
 @{origin='https://central.example/#fragment';token=$token},
 @{origin='https://central.example';token=('A'*64)},
 @{origin='https://central.example';token=($token+"\n")},
 @{origin='https://central.example';token=$token;name=12},
 @{origin='https://central.example';token=$token;name=('x'*121)},
 @{origin='https://central.example';token=$token;name="bad\nname"},
 @{origin='https://central.example';token=$token;caFile='C:\\untrusted.pem'},
 @{origin='https://central.example';token=$token;caPem='-----BEGIN PRIVATE KEY-----'},
 @{origin='https://central.example';token=$token;caPem=('X'*65537)},
 @{origin='https://central.example';token=$token;password='forbidden'},
 @{origin='https://central.example';Token=$token}
)
foreach($inputCase in $invalid){$rejected=$false;try{$null=ConvertFrom-KalkanEnrollmentJson -Json ($inputCase|ConvertTo-Json -Compress) -DefaultName 'PC'}catch{$rejected=$true;if($_.Exception.Message.Contains($token)){throw 'Secret leaked in validation error'}};if(-not $rejected){throw 'Unsafe deployment request was accepted'}}
foreach($badJson in @('{"token":"'+$token+'",','[]','null','12')){$rejected=$false;try{$null=ConvertFrom-KalkanEnrollmentJson -Json $badJson -DefaultName 'PC'}catch{$rejected=$true;if($_.Exception.Message.Contains($token)){throw 'Secret leaked in JSON error'}};if(-not $rejected){throw 'Malformed JSON accepted'}}
Write-Output 'PASS deployment request validation'
`,{encoding:'utf8'});
 // Windows PowerShell 5.1 needs a UTF-8 BOM for non-ASCII source text.
 fs.writeFileSync(script,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),fs.readFileSync(script)]));
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS deployment request validation/);assert.equal((result.stdout+result.stderr).includes('a'.repeat(64)),false);
});
