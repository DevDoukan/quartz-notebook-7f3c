'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util'),scrypt=promisify(crypto.scrypt),{DatabaseSync}=require('node:sqlite');
const {openStore}=require('./store');
const enrollmentNames=['agent-central.json','agent-central.json.pending.json'];
function validateEnrollment(files,store){
  if(!files||typeof files!=='object'||Array.isArray(files)||Object.keys(files).some(name=>!enrollmentNames.includes(name)))throw Error('Yedek merkez kimliği geçersiz.');
  for(const [name,text] of Object.entries(files)){
    if(typeof text!=='string'||Buffer.byteLength(text)>131072)throw Error('Yedek merkez kimliği geçersiz.');
    const config=JSON.parse(text);
    if(config.caFile)throw Error('Harici CA dosyası otomatik yedeklenemez; açık CA sertifikasını yapılandırmaya ekleyin.');
    require('./central-client').transport(config.origin);
    if(config.caPem){const blocks=typeof config.caPem==='string'&&config.caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);if(!blocks?.length||config.caPem.length>65536||config.caPem.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,'').trim())throw Error('Yedek CA sertifikası geçersiz.');for(const block of blocks)new crypto.X509Certificate(block);}
    if(name===enrollmentNames[0]){
      const identity=crypto.createHash('sha256').update(config.origin+'\n'+config.id+'\n'+config.policyPublicKey).digest('hex');
      if(store.get('centralIdentity',null)!==identity)throw Error('Yedek merkez kimliği veritabanıyla uyuşmuyor.');
      // Validates the cached signed policy without starting a timer or making requests.
      require('./central-client').openCentralLink(store,config);
    }else if(config.version!==1||typeof config.name!=='string'||!config.name.trim()||config.name.length>120||/[\x00-\x1f]/.test(config.name)||['token','requestId','credential'].some(key=>typeof config[key]!=='string'||!/^[a-f0-9]{64}$/.test(config[key])))throw Error('Bekleyen merkez kaydı geçersiz.');
  }
  if(files[enrollmentNames[0]]&&files[enrollmentNames[1]]){const active=JSON.parse(files[enrollmentNames[0]]),pending=JSON.parse(files[enrollmentNames[1]]);if(active.origin!==pending.origin||active.credential!==pending.credential)throw Error('Merkez kayıt dosyaları uyuşmuyor.');}
}
function readEnrollment(dir,store){
  const files={};
  for(const name of enrollmentNames){const file=path.join(dir,name);if(!fs.existsSync(file))continue;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>131072)throw Error('Merkez kimlik dosyası güvenli biçimde yedeklenemedi.');files[name]=fs.readFileSync(file,'utf8');}
  validateEnrollment(files,store);return files;
}
function validatePassword(password){if(typeof password!=='string'||password.length<12||password.length>128||/[\r\n]/.test(password))throw Error('Yedek parolası 12–128 karakter olmalı ve satır sonu içermemeli.');}
const derive=(password,salt)=>scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
async function createBackup(store,dir,password,{includeEnrollment=true}={}){
  validatePassword(password);if(!store.verifyAudit().valid)throw Error('Kayıt bütünlüğü bozuk. Yedek oluşturulmadı.');
  const enrollment=includeEnrollment?readEnrollment(dir,store):{};
  const snapshot=path.join(dir,'.backup-'+crypto.randomUUID()+'.sqlite');let raw;
  try{
    store.db.prepare('VACUUM INTO ?').run(snapshot);
    const db=new DatabaseSync(snapshot);try{db.exec('DELETE FROM sessions; DELETE FROM login_limits; PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close();}
    if(fs.statSync(snapshot).size>256*1024*1024)throw Error('Yedek 256 MB sınırını aşıyor. Destek ile görüşün.');
    raw=Buffer.from(JSON.stringify({schema:1,product:'kalkan-dlp',version:require('./package.json').version,createdAt:new Date().toISOString(),enrollment,database:fs.readFileSync(snapshot).toString('base64'),auditKey:fs.readFileSync(path.join(dir,'audit-key.bin')).toString('base64'),auditHead:JSON.parse(fs.readFileSync(path.join(dir,'audit-head.json'),'utf8'))}));
  }finally{if(fs.existsSync(snapshot))fs.unlinkSync(snapshot);}
  const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=await derive(password,salt),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('kalkan-backup-v1'));const encrypted=Buffer.concat([cipher.update(raw),cipher.final()]);key.fill(0);raw.fill(0);
  return {format:'kalkan-backup',version:1,kdf:'scrypt-v1',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')};
}
async function restoreBackup(document,password,target){
  validatePassword(password);
  if(!document||document.format!=='kalkan-backup'||document.version!==1||document.kdf!=='scrypt-v1'||typeof document.data!=='string'||document.data.length>512*1024*1024)throw Error('Desteklenmeyen veya fazla büyük yedek dosyası.');
  const salt=Buffer.from(document.salt||'','base64'),iv=Buffer.from(document.iv||'','base64'),tag=Buffer.from(document.tag||'','base64');if(salt.length!==16||iv.length!==12||tag.length!==16)throw Error('Yedek başlığı geçersiz.');
  const key=await derive(password,salt);let raw;
  try{const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from('kalkan-backup-v1'));decipher.setAuthTag(tag);raw=Buffer.concat([decipher.update(Buffer.from(document.data,'base64')),decipher.final()]);}catch{throw Error('Yedek parolası yanlış veya yedek dosyası değiştirilmiş.');}finally{key.fill(0);}
  let value;try{value=JSON.parse(raw.toString('utf8'));}finally{raw.fill(0);}
  if(value.schema!==1||value.product!=='kalkan-dlp'||typeof value.database!=='string'||Buffer.from(value.auditKey||'','base64').length!==32)throw Error('Yedek içeriği doğrulanamadı.');
  const currentMajor=Number(require('./package.json').version.split('.')[0]),backupMajor=Number(String(value.version).split('.')[0]);if(!Number.isInteger(backupMajor)||backupMajor>currentMajor)throw Error('Daha yeni ürün sürümünün yedeğini bu sürüme yükleyemezsiniz.');
  if(!path.isAbsolute(target))throw Error('Geri yükleme için tam klasör yolu girin.');
  if(fs.existsSync(target)&&fs.readdirSync(target).length)throw Error('Hedef klasör boş olmalı. Mevcut verinin üzerine yazılmaz.');
  const destination=target;fs.mkdirSync(path.dirname(destination),{recursive:true});target=fs.mkdtempSync(path.join(path.dirname(destination),'.kalkan-restore-'));
  let restored,completed=false;
  try{
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'dlp.sqlite'),Buffer.from(value.database,'base64'),{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(target,'audit-key.bin'),Buffer.from(value.auditKey,'base64'),{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(target,'audit-head.json'),JSON.stringify(value.auditHead),{mode:0o600,flag:'wx'});
  restored=openStore(target);
    if(restored.db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Yedek veritabanı bütünlük denetimini geçmedi.');
    const enrollment=value.enrollment??{};validateEnrollment(enrollment,restored);
    for(const [name,text] of Object.entries(enrollment))fs.writeFileSync(path.join(target,name),text,{mode:0o600,flag:'wx',flush:true});
    if(enrollment[enrollmentNames[1]]&&!enrollment[enrollmentNames[0]])restored.set('centralEnrollmentPending',true);
    restored.db.exec('DELETE FROM sessions; DELETE FROM login_limits');restored.set('extensionKey',crypto.randomBytes(32).toString('hex'));
    restored.record({id:crypto.randomUUID(),time:new Date().toISOString(),kind:'system',summary:'Şifreli yedekten geri yüklendi',actor:'offline-recovery'});
    const result={restored:true,version:value.version,audit:restored.verifyAudit()};
    restored.close();restored=null;
    // Only publish a fully verified directory. Never recursively remove the destination.
    if(fs.existsSync(destination))fs.rmdirSync(destination);
    fs.renameSync(target,destination);completed=true;return result;
  }finally{restored?.close();if(!completed)fs.rmSync(target,{recursive:true,force:true});}
}
module.exports={createBackup,restoreBackup};
