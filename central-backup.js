'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{promisify}=require('node:util'),{DatabaseSync}=require('node:sqlite');
const {openStore}=require('./store'),{openMfa}=require('./mfa'),{acquireLock}=require('./runtime-lock');
const {openCentral}=require('./central-store');
const derive=promisify(crypto.scrypt),names=['dlp.sqlite','central.sqlite','audit-key.bin','audit-head.json','mfa-key.bin','policy-signing-key.pem'],MAX=256*1024*1024;
function cleanup(dir,parent,prefix){if(path.dirname(path.resolve(dir))!==path.resolve(parent)||!path.basename(dir).startsWith(prefix))throw Error('Geçici klasör sınırı doğrulanamadı.');fs.rmSync(dir,{recursive:true,force:true});}
function password(value){if(typeof value!=='string'||value.length<12||value.length>128||/[\r\n]/.test(value))throw Error('Yedek parolası 12–128 karakter olmalı.');}
function ordinary(file){if(!fs.lstatSync(file).isFile())throw Error('Yedek kaynağı normal dosya olmalı.');}
function checkDb(db){if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Merkez veritabanı bütünlük denetimi başarısız.');}
function clearOutlookCredentials(db){
 if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outlook_credentials'").get()){
  db.exec('DELETE FROM outlook_credentials');
 }
}
function verify(dir){
 for(const name of names){const file=path.join(dir,name);ordinary(file);if(fs.statSync(file).size>MAX)throw Error('Yedek dosyası boyut sınırını aşıyor.');}
 if(fs.readFileSync(path.join(dir,'audit-key.bin')).length!==32||fs.readFileSync(path.join(dir,'mfa-key.bin')).length!==32)throw Error('Merkez anahtar dosyası geçersiz.');
 const key=crypto.createPrivateKey(fs.readFileSync(path.join(dir,'policy-signing-key.pem')));if(key.asymmetricKeyType!=='ed25519')throw Error('Politika imzalama anahtarı geçersiz.');
 const store=openStore(dir);try{checkDb(store.db);openMfa(store,dir).verifyIntegrity();const central=openCentral(dir,{auditKey:fs.readFileSync(path.join(dir,'audit-key.bin'))});try{central.flushAudit(store.recordOnce);}finally{central.close();}}finally{store.close();}
 const db=new DatabaseSync(path.join(dir,'central.sqlite'),{readOnly:true});try{checkDb(db);
   // Cross-database memberships must point to real authentication identities.
   const auth=new DatabaseSync(path.join(dir,'dlp.sqlite'),{readOnly:true});try{const users=new Set(auth.prepare('SELECT id FROM users').all().map(row=>row.id));if(db.prepare('SELECT actor FROM memberships').all().some(row=>!users.has(row.actor)))throw Error('Şirket üyeliğinde eksik kullanıcı var.');}finally{auth.close();}
 }finally{db.close();}
 return true;
}
async function createCentralBackup(dir,secret){
 password(secret);if(!path.isAbsolute(dir)||!fs.existsSync(dir))throw Error('Mevcut merkez veri klasörünün tam yolunu belirtin.');
 for(const name of names)ordinary(path.join(dir,name));
 const unlock=acquireLock(dir);let snapshot;
 try{
  verify(dir);snapshot=fs.mkdtempSync(path.join(dir,'.central-backup-'));
  for(const name of names){if(name.endsWith('.sqlite')){const db=new DatabaseSync(path.join(dir,name),{readOnly:true});try{db.prepare('VACUUM INTO ?').run(path.join(snapshot,name));}finally{db.close();}}else fs.copyFileSync(path.join(dir,name),path.join(snapshot,name),fs.constants.COPYFILE_EXCL);}
  const auth=new DatabaseSync(path.join(snapshot,'dlp.sqlite'));try{auth.exec("DELETE FROM sessions; DELETE FROM login_limits; DELETE FROM mfa_accounts WHERE secret IS NULL; UPDATE mfa_accounts SET pending=NULL,pending_until=0; PRAGMA wal_checkpoint(TRUNCATE)");}finally{auth.close();}
  const db=new DatabaseSync(path.join(snapshot,'central.sqlite'));try{clearOutlookCredentials(db);db.exec('DELETE FROM enrollments; DELETE FROM enrollment_receipts; PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close();}
  verify(snapshot);
  const files={};let total=0;for(const name of names){const data=fs.readFileSync(path.join(snapshot,name));total+=data.length;if(total>MAX)throw Error('Merkez yedeği 256 MB sınırını aşıyor.');files[name]=data.toString('base64');}
  const raw=Buffer.from(JSON.stringify({schema:1,version:require('./package.json').version,createdAt:new Date().toISOString(),files})),salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=await derive(secret,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  try{const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('kalkan-central-backup-v1'));const data=Buffer.concat([cipher.update(raw),cipher.final()]);return {format:'kalkan-central-backup',version:1,kdf:'scrypt-v1',salt:salt.toString('base64'),iv:iv.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')};}finally{key.fill(0);raw.fill(0);}
 }finally{try{if(snapshot)cleanup(snapshot,dir,'.central-backup-');}finally{unlock();}}
}
async function restoreCentralBackup(document,secret,target){
 password(secret);if(!path.isAbsolute(target)||fs.existsSync(target)||!fs.statSync(path.dirname(target)).isDirectory())throw Error('Var olmayan yeni hedef klasörün tam yolunu belirtin. Üst klasör önceden oluşturulmuş olmalı.');
 if(!document||document.format!=='kalkan-central-backup'||document.version!==1||document.kdf!=='scrypt-v1'||typeof document.data!=='string'||document.data.length>512*1024*1024)throw Error('Desteklenmeyen merkez yedeği.');
 const salt=Buffer.from(document.salt||'','base64'),iv=Buffer.from(document.iv||'','base64'),tag=Buffer.from(document.tag||'','base64');if(salt.length!==16||iv.length!==12||tag.length!==16)throw Error('Geçersiz yedek başlığı.');
 const key=await derive(secret,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});let raw;
 try{const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from('kalkan-central-backup-v1'));decipher.setAuthTag(tag);raw=Buffer.concat([decipher.update(Buffer.from(document.data,'base64')),decipher.final()]);}catch{throw Error('Parola yanlış veya merkez yedeği değiştirilmiş.');}finally{key.fill(0);}
 let value;try{value=JSON.parse(raw.toString('utf8'));}finally{raw.fill(0);}
 const major=Number(String(value.version).split('.')[0]);
 if(value.schema!==1||!value.files||Object.keys(value.files).length!==names.length||names.some(name=>typeof value.files[name]!=='string')||!Number.isInteger(major)||major<1||major>Number(require('./package.json').version.split('.')[0]))throw Error('Merkez yedek içeriği geçersiz veya daha yeni sürüm gerektiriyor.');
 const staging=fs.mkdtempSync(path.join(path.dirname(target),'.kalkan-restore-'));let promoted=false;
 try{let total=0;for(const name of names){const data=Buffer.from(value.files[name],'base64');total+=data.length;if(total>MAX)throw Error('Merkez yedeği boyut sınırını aşıyor.');fs.writeFileSync(path.join(staging,name),data,{mode:0o600,flag:'wx',flush:true});}
  verify(staging);
  const auth=new DatabaseSync(path.join(staging,'dlp.sqlite'));try{auth.exec('DELETE FROM sessions; DELETE FROM login_limits; DELETE FROM mfa_accounts WHERE secret IS NULL; UPDATE mfa_accounts SET pending=NULL,pending_until=0; PRAGMA wal_checkpoint(TRUNCATE)');}finally{auth.close();}
  const db=new DatabaseSync(path.join(staging,'central.sqlite'));try{clearOutlookCredentials(db);db.exec('DELETE FROM enrollments; DELETE FROM enrollment_receipts; PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close();}
  const store=openStore(staging);try{store.record({id:crypto.randomUUID(),time:new Date().toISOString(),kind:'central',summary:'Merkez şifreli yedekten çevrimdışı geri yüklendi',actor:'offline-recovery'});}finally{store.close();}
  if(fs.existsSync(target))throw Error('Hedef klasör işlem sırasında oluşturuldu. Üzerine yazılmadı.');fs.renameSync(staging,target);promoted=true;return {restored:true,version:value.version};
 }finally{if(!promoted)cleanup(staging,path.dirname(target),'.kalkan-restore-');}
}
module.exports={createCentralBackup,restoreCentralBackup};
