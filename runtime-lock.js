'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
function processAlive(pid){if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
function linuxProcessIdentity(pid){
  try{
    const bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
    const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');
    // The process name can contain spaces and closing parentheses.
    const startTicks=stat.slice(stat.lastIndexOf(')')+2).split(/\s+/)[19];
    if(/^[a-f0-9-]{36}$/.test(bootId)&&/^\d+$/.test(startTicks))return bootId+':'+startTicks;
  }catch{}
}
function lockOwnerAlive(lock){
  if(!processAlive(lock.pid))return false;
  if(process.platform==='linux'&&typeof lock.linuxIdentity==='string'){
    const identity=linuxProcessIdentity(lock.pid);
    if(identity)return identity===lock.linuxIdentity;
  }
  if(process.platform!=='win32'||lock.pid===process.pid||!Number.isFinite(Date.parse(lock.createdAt))||
    path.basename(process.execPath).toLowerCase()!=='node.exe'||!process.env.SystemRoot)return true;
  // Shipped Windows services run under node.exe. Reclaim a legacy lock only
  // when the PID belongs to a different process image. Reading its start time
  // could require access that the dedicated service account does not have.
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',
    `[Console]::WriteLine((Get-Process -Id ${lock.pid} -ErrorAction Stop).ProcessName)`
  ],{encoding:'utf8',windowsHide:true,timeout:5000});
  if(result.status!==0)return true;
  const name=result.stdout.trim();
  return !/^[\w.-]+$/.test(name)||name.toLowerCase()==='node';
}
function acquireLock(dir){
  fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'server.lock'),id=crypto.randomBytes(16).toString('hex');
  const linuxIdentity=process.platform==='linux'?linuxProcessIdentity(process.pid):undefined;
  for(let attempt=0;attempt<2;attempt++){
    try{fs.writeFileSync(file,JSON.stringify({pid:process.pid,id,createdAt:new Date().toISOString(),linuxIdentity}),{mode:0o600,flag:'wx'});return ()=>{try{if(JSON.parse(fs.readFileSync(file,'utf8')).id===id)fs.unlinkSync(file);}catch{}};}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      let previous;try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Sunucu kilidi okunamadı. Uygulamanın kapalı olduğunu doğrulayıp destek ile kilit dosyasını inceleyin.');}
      if(lockOwnerAlive(previous))throw Error('Bu veri klasörü başka bir çalışan Kalkan DLP örneği tarafından kullanılıyor.');
      if(JSON.parse(fs.readFileSync(file,'utf8')).id!==previous.id)continue;
      fs.unlinkSync(file);
    }
  }
  throw Error('Veri klasörü kilitlenemedi.');
}
function assertOffline(dir){const file=path.join(dir,'server.lock');if(fs.existsSync(file)){const value=JSON.parse(fs.readFileSync(file,'utf8'));if(lockOwnerAlive(value))throw Error('Önce Kalkan DLP sunucusunu durdurun.');}}
module.exports={acquireLock,assertOffline};
