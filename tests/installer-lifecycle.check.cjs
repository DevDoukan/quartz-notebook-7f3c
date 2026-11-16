'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {verifyPackage}=require('../tools/verify-package.cjs'),{fingerprint}=require('../tools/source-fingerprint.cjs');
const root=path.join(__dirname,'..'),testRoot=path.join(root,'.test-artifacts','installer-smoke'),appRoot=path.join(testRoot,'App'),dataDir=path.join(testRoot,'Data'),base='http://127.0.0.1:4317';
const build=JSON.parse(fs.readFileSync(path.join(root,'.build','latest-build.json'),'utf8').replace(/^\uFEFF/,'')),previous='1.1.0-rc.1',env={...process.env,DLP_DATA_DIR:dataDir};
function run(file,args){const result=spawnSync(file,args,{env,stdio:'ignore',windowsHide:true,timeout:120000});if(result.status!==0)throw Error(`İşlem başarısız (${result.status}): ${path.basename(file)} ${result.error?.message||''}`);}
function install(file,label){run(file,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/DIR='+appRoot,'/LOG='+path.join(testRoot,label+'.log')]);}
function serviceScript(version,file){run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(appRoot,'versions',version,'scripts',file),...(file==='Start.ps1'?['-NoBrowser']:[])]);}
async function login(){const configured=(await(await fetch(base+'/api/auth/status',{headers:{Connection:'close'}})).json()).configured;const response=await fetch(base+(configured?'/api/auth/login':'/api/auth/setup'),{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({username:'installeradmin',password:'Installed-test-password-2026',setupKey:configured?undefined:fs.readFileSync(path.join(dataDir,'setup-key.txt'),'utf8')})});assert.equal(response.status,200);const result=await response.json();return {cookie:response.headers.get('set-cookie').split(';')[0],token:result.token};}
async function api(route,session,input){const response=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Connection:'close',Cookie:session.cookie,'X-DLP-Token':session.token},body:input===undefined?undefined:JSON.stringify(input)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
(async()=>{
 if(!appRoot.startsWith(path.join(root,'.test-artifacts')+path.sep))throw Error('Test kurulum hedefi çalışma alanının dışında.');
 const prior=spawnSync('powershell.exe',['-NoProfile','-Command',"Get-ItemPropertyValue 'HKCU:\\Software\\KalkanDLP' -Name CurrentPath -ErrorAction SilentlyContinue"],{encoding:'utf8',windowsHide:true});
 if(prior.stdout.trim())throw Error('Başka bir kayıtlı kurulum var. Test mevcut kuruluma dokunmayacak.');
 fs.mkdirSync(testRoot,{recursive:true});let installed=false,complete=false;
 if(fs.existsSync(dataDir)){const source=path.resolve(dataDir),destination=path.resolve(testRoot,'prior-data-'+require('node:crypto').randomUUID()),boundary=path.resolve(testRoot)+path.sep;if(!source.startsWith(boundary)||!destination.startsWith(boundary))throw Error('Test veri taşıma sınırı doğrulanamadı.');fs.renameSync(source,destination);}
 try{
  install(path.join(root,'release',`Kalkan-DLP-${previous}-Setup-unsigned.exe`),'install-previous');installed=true;serviceScript(previous,'Start.ps1');
  let session=await login();await api('/api/policy',session,{mode:'block',enabled:['card']});const old=await api('/api/state',session);serviceScript(previous,'Stop.ps1');
  install(build.installer,'upgrade-current');serviceScript(build.version,'Start.ps1');session=await login();const current=await api('/api/state',session);
  assert.equal(current.version,build.version);assert.equal(current.license.installationId,old.license.installationId);assert.equal(current.policy.mode,'block');assert.deepEqual(current.policy.enabled,['card']);assert.equal((await api('/api/audit/verify',session)).valid,true);
  const inspect=await api('/api/inspect',session,{text:'4242424242424242',channel:'web'});assert.equal(inspect.decision,'block');
  const packageResult=verifyPackage(path.join(appRoot,'versions',build.version));assert.equal(packageResult.sourceFingerprint,fingerprint(root).sha256);
  const lock=JSON.parse(fs.readFileSync(path.join(dataDir,'server.lock'),'utf8')),processPath=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${lock.pid}).Path`],{encoding:'utf8',windowsHide:true}).stdout.trim();assert.equal(processPath.toLowerCase(),path.join(appRoot,'versions',build.version,'runtime','node.exe').toLowerCase());
  run(path.join(appRoot,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG='+path.join(testRoot,'uninstall-current.log')]);installed=false;
  assert.equal(fs.existsSync(path.join(appRoot,'versions',build.version,'runtime','node.exe')),false);assert.equal(fs.existsSync(path.join(dataDir,'dlp.sqlite')),true);
  fs.writeFileSync(path.join(root,'.test-artifacts','installer-lifecycle.json'),JSON.stringify({passed:true,version:build.version,fromVersion:previous,sourceFingerprint:fingerprint(root).sha256,checkedAt:new Date().toISOString(),checks:['install','bundled-runtime','upgrade-preserves-users-policy-license','audit-chain','package-checksums','uninstall-preserves-data']},null,2));complete=true;
  console.log('PASS: real Windows install, bundled runtime, upgrade preservation, package checksums and uninstall');
 }finally{if(installed&&fs.existsSync(path.join(appRoot,'unins000.exe'))){try{run(path.join(appRoot,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART']);}catch{}}if(!complete)console.error('Kurulum yaşam döngüsü testi tamamlanamadı.');}
})().catch(error=>{console.error(error);process.exitCode=1;});
