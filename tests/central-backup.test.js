'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),OTPAuth=require('otpauth');
const {openStore}=require('../store'),{openAuth}=require('../auth'),{openMfa}=require('../mfa'),{openCentral}=require('../central-store'),{openSigning}=require('../central-signing'),{acquireLock}=require('../runtime-lock');
const {createCentralBackup,restoreCentralBackup}=require('../central-backup');
test('offline central backup preserves tenants, agent and MFA identity while dropping sessions and enrollment tickets',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-central-backup-')),source=path.join(root,'source'),target=path.join(root,'restored'),password='Central-backup-password2026',now=1800000000000;let store=openStore(source),central=openCentral(source),mfa;
 t.after(()=>{store?.close();central?.close();fs.rmSync(root,{recursive:true,force:true});});
 const auth=openAuth(store,source,{now:()=>now,verifySecondFactor:(id,token)=>mfa.verify(id,token)});mfa=openMfa(store,source,{now:()=>now});const setup=await auth.setup({setupKey:fs.readFileSync(path.join(source,'setup-key.txt'),'utf8').trim(),username:'backupadmin',password:'MFA-user-password2026'},{setHeader(){}});
 const pending=mfa.begin(setup.user.id,'backupadmin'),codes=mfa.confirm(setup.user.id,new OTPAuth.TOTP({secret:pending.secret}).generate({timestamp:now})).recoveryCodes;await auth.login({username:'backupadmin',password:'MFA-user-password2026',otp:codes[0]},{setHeader(){}});
 const tenant=central.createTenant(setup.user.id,'Backup company');central.setPolicy(setup.user.id,tenant.id,{mode:'block',enabled:['card']});const device=central.enroll(central.issueEnrollment(setup.user.id,tenant.id).token,'PC-BACKUP'),unused=central.issueEnrollment(setup.user.id,tenant.id);central.ingest(device.credential,{id:'backup-event',kind:'usb',decision:'block',count:1});const outlook=central.issueOutlookCredential(device.credential);const publicKey=openSigning(source).publicKey;
 assert.equal(store.db.prepare('SELECT count(*) n FROM sessions').get().n,1);central.close();central=null;store.close();store=null;
 const unlock=acquireLock(source);try{await assert.rejects(createCentralBackup(source,password),/çalışan/);}finally{unlock();}
 const document=await createCentralBackup(source,password);assert.equal(JSON.stringify(document).includes(device.credential),false);assert.equal(JSON.stringify(document).includes(pending.secret),false);
 await assert.rejects(restoreCentralBackup(document,'Wrong-password-2026',target),/Parola yanlış/);assert.equal(fs.existsSync(target),false);
 const corrupt={...document,data:Buffer.from(document.data,'base64')};corrupt.data[0]^=1;corrupt.data=corrupt.data.toString('base64');await assert.rejects(restoreCentralBackup(corrupt,password,target),/değiştirilmiş/);assert.equal(fs.existsSync(target),false);
 const result=await restoreCentralBackup(document,password,target);assert.equal(result.restored,true);await assert.rejects(restoreCentralBackup(document,password,target),/Var olmayan/);
 store=openStore(target);central=openCentral(target);const restoredMfa=openMfa(store,target,{now:()=>now});assert.equal(store.verifyAudit().valid,true);assert.equal(store.db.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(store.db.prepare('SELECT count(*) n FROM login_limits').get().n,0);
 assert.throws(()=>central.heartbeat(outlook.credential,undefined,true),/kimliği/);assert.equal(central.heartbeat(device.credential).policy.mode,'block');assert.equal(central.events(setup.user.id,tenant.id).length,1);assert.equal(openSigning(target).publicKey,publicKey);assert.throws(()=>central.enroll(unused.token,'replay'),/geçersiz/);
 assert.equal(restoredMfa.verify(setup.user.id,codes[0]),false);assert.equal(restoredMfa.verify(setup.user.id,codes[1]),true);assert.equal(restoredMfa.status(setup.user.id).recoveryRemaining,6);
 assert.equal(fs.readdirSync(root).some(name=>name.startsWith('.kalkan-restore-')),false);assert.equal(fs.readdirSync(source).some(name=>name.startsWith('.central-backup-')),false);
 store.close();store=null;central.close();central=null;
 const {createCentralApp}=require('../central-server'),app=createCentralApp({dataDir:target});
 try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
  const heartbeat=await fetch(base+'/api/agent/heartbeat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+device.credential},body:'{}'});assert.equal(heartbeat.status,200);const state=await heartbeat.json();assert.equal(crypto.verify(null,Buffer.from(state.signed.payload),publicKey,Buffer.from(state.signed.signature,'base64')),true);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'backupadmin',password:'MFA-user-password2026',otp:codes[2]})});assert.equal(login.status,200);
  await assert.rejects(createCentralBackup(target,password),/çalışan/);
 }finally{await app.close();}
 const backupFile=path.join(root,'encrypted central backup.json'),cliTarget=path.join(root,'CLI restored center');fs.writeFileSync(backupFile,JSON.stringify(document));
 const run=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'..','tools','central-backup.cjs'),'restore',backupFile,cliTarget],{input:password+'\n',encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).restored,true);assert.equal(run.stdout.includes(password),false);
});
test('central backup rejects mismatched MFA key and modified audit ledger',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-backup-key-'));let store=openStore(root),central=openCentral(root);const auth=openAuth(store,root),user=await auth.createUser({username:'keyadmin',password:'Key-user-password2026',role:'admin'}),mfa=openMfa(store,root);openSigning(root);const setup=mfa.begin(user.id,user.username);mfa.confirm(user.id,new OTPAuth.TOTP({secret:setup.secret}).generate());store.record({id:crypto.randomUUID(),time:new Date().toISOString(),kind:'test',summary:'Original'});store.close();central.close();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const keyFile=path.join(root,'mfa-key.bin'),original=fs.readFileSync(keyFile);fs.writeFileSync(keyFile,crypto.randomBytes(32));await assert.rejects(createCentralBackup(root,'Key-backup-password2026'));fs.writeFileSync(keyFile,original);
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(root,'dlp.sqlite'));db.exec("UPDATE audit_ledger SET data='{}'");db.close();await assert.rejects(createCentralBackup(root,'Key-backup-password2026'),/bütünlüğü/);
});
