'use strict';
const {promisify}=require('node:util');
const run=promisify(require('node:child_process').execFile);
const path=require('node:path');
async function devices({executeFile=run}={}){
  if(process.platform!=='win32')return {devices:[],supported:false,writeProtected:false};
  const basic=`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop';
    $items=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' -OperationTimeoutSec 3 | Select-Object DeviceID,VolumeName,Size,FreeSpace);
    $wp=$null; $wpKnown=$true;
    try { $key='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\StorageDevicePolicies'; if(Test-Path -LiteralPath $key -ErrorAction Stop){ $wp=(Get-ItemProperty -LiteralPath $key -ErrorAction Stop).WriteProtect } } catch { $wpKnown=$false }
    @{devices=$items; supported=$true; writeProtected=$(if($wpKnown){$wp -eq 1}else{$null}); writeProtectionKnown=$wpKnown} | ConvertTo-Json -Depth 4 -Compress`;
  const env={...process.env};delete env.PSModulePath;
  const execute=async(command,timeout)=>{const {stdout}=await executeFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{env,windowsHide:true,timeout,maxBuffer:1024*1024});return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());};
  // The Storage provider can stall on mapped or disconnected disks. Keep it
  // separate so that a timeout cannot discard the basic removable-drive list.
  let result;
  try{result=await execute(basic,10000);}catch{throw Error('Windows USB aygıt listesi alınamadı. Windows Yönetim Araçları hizmetini kontrol edip yeniden deneyin.');}
  const warnings=[];
  if(result.writeProtectionKnown===false)warnings.push('Windows USB yazma koruması okunamadı; koruma durumu bilinmiyor.');
  try{
    const extra=await execute(`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; $letters=@(Get-Disk | Where-Object BusType -eq 'USB' | Get-Partition | Where-Object DriveLetter | ForEach-Object { [string]$_.DriveLetter + ':' }); $items=@(Get-CimInstance Win32_LogicalDisk -OperationTimeoutSec 3 | Where-Object { $_.DeviceID -in $letters } | Select-Object DeviceID,VolumeName,Size,FreeSpace); ConvertTo-Json -InputObject $items -Depth 4 -Compress`,5000);
    result.devices=[...new Map([...result.devices,...extra].map(item=>[item.DeviceID,item])).values()];
  }catch{warnings.push('Ek USB disk sorgusu tamamlanamadı. Bazı harici diskler listede görünmeyebilir; bağlantıyı kontrol edip yenileyin.');}
  if(warnings.length)result.warning=warnings.join(' ');
  return result;
}
async function setWriteProtection(enabled,{serviceMode=false}={}){
  if(process.platform!=='win32')throw Error('Bu işlem Windows gerektirir.');
  const script=path.join(__dirname,'scripts','Set-UsbWriteProtection.ps1').replace(/'/g,"''");
  if(serviceMode){const env={...process.env};delete env.PSModulePath;await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'scripts','Set-UsbWriteProtection.ps1'),'-Mode',enabled?'Enable':'Disable','-ServiceMode'],{env,windowsHide:true,timeout:20000});return;}
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','"${script}"','-Mode','${enabled?'Enable':'Disable'}') -Wait -PassThru; if($p.ExitCode -ne 0){exit 1}`],{windowsHide:true,timeout:120000});
}
module.exports={devices,setWriteProtection};
