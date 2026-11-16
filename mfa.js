'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),OTPAuth=require('otpauth');
function openMfa(store,dir,{now=Date.now}={}){
 const db=store.db,file=path.join(dir,'mfa-key.bin');
 const existed=!!db.prepare("SELECT name FROM sqlite_master WHERE name='mfa_accounts'").get();
 if(!fs.existsSync(file)){if(existed&&db.prepare('SELECT count(*) n FROM mfa_accounts').get().n)throw Error('MFA anahtarı eksik. Doğrulanmış merkez yedeğinden kurtarma gerekir.');fs.writeFileSync(file,crypto.randomBytes(32),{mode:0o600,flag:'wx'});}
 const key=fs.readFileSync(file);if(key.length!==32)throw Error('MFA anahtarı geçersiz.');
 db.exec('CREATE TABLE IF NOT EXISTS mfa_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT,pending TEXT,pending_until INTEGER NOT NULL,last_counter INTEGER NOT NULL,recovery TEXT NOT NULL)');
 function seal(value,id){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')});}
 function unseal(value,id){const input=JSON.parse(value),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(input.iv,'hex'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(input.tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(input.data,'hex')),decipher.final()]).toString('utf8');}
 const securityEvent=(id,summary)=>({id:crypto.randomUUID(),time:new Date(now()).toISOString(),kind:'auth',actor:id,summary});
 const totp=(secret,label)=>new OTPAuth.TOTP({issuer:'Kalkan DLP Merkez',label,algorithm:'SHA1',digits:6,period:30,secret});
 function counter(secret,token){if(typeof token!=='string'||!/^\d{6}$/.test(token))return null;const delta=totp(secret,'').validate({token,timestamp:now(),window:1});return delta===null?null:Math.floor(now()/30000)+delta;}
 const hash=(id,code)=>crypto.createHash('sha256').update(id+'\n'+code).digest('hex');
 function limited(id){const row=db.prepare('SELECT attempts,reset_at FROM login_limits WHERE identity=?').get('mfa:'+id);return row&&row.reset_at>now()&&row.attempts>=8;}
 function failed(id){const identity='mfa:'+id,row=db.prepare('SELECT attempts,reset_at FROM login_limits WHERE identity=?').get(identity);db.prepare('INSERT OR REPLACE INTO login_limits VALUES (?,?,?)').run(identity,row&&row.reset_at>now()?row.attempts+1:1,row&&row.reset_at>now()?row.reset_at:now()+900000);return false;}
 function verify(id,token,consume=true){const row=db.prepare('SELECT * FROM mfa_accounts WHERE user_id=?').get(id);if(!row?.secret)return true;
   if(limited(id))return false;
   const value=counter(unseal(row.secret,id),token);
   if(value!==null&&value>row.last_counter){if(!consume)return true;const result=db.prepare('UPDATE mfa_accounts SET last_counter=? WHERE user_id=? AND last_counter<?').run(value,id,value);return !!result.changes;}
   if(typeof token!=='string'||!/^[a-fA-F0-9-]{32,40}$/.test(token))return failed(id);
   const codes=JSON.parse(row.recovery),index=codes.indexOf(hash(id,token.replaceAll('-','').toLowerCase()));if(index<0)return failed(id);if(!consume)return true;codes.splice(index,1);const result=db.prepare('UPDATE mfa_accounts SET recovery=? WHERE user_id=? AND recovery=?').run(JSON.stringify(codes),id,row.recovery);return !!result.changes;
 }
 return {
  verifyIntegrity(){for(const row of db.prepare('SELECT * FROM mfa_accounts').all()){for(const value of [row.secret,row.pending])if(value&&!/^[A-Z2-7]{32}$/.test(unseal(value,row.user_id)))throw Error('MFA sırrı doğrulanamadı.');const recovery=JSON.parse(row.recovery);if(!Array.isArray(recovery)||recovery.length>8||recovery.some(value=>typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value)))throw Error('MFA kurtarma kayıtları geçersiz.');}return true;},
  status(id){const row=db.prepare('SELECT secret,recovery FROM mfa_accounts WHERE user_id=?').get(id);return {enabled:!!row?.secret,recoveryRemaining:row?.secret?JSON.parse(row.recovery).length:0};},verify,
  begin(id,username){if(this.status(id).enabled)throw Error('İki aşamalı doğrulama zaten açık.');const secret=new OTPAuth.Secret({size:20}).base32;store.atomicSecurity(securityEvent(id,'MFA kurulumu başlatıldı'),()=>db.prepare("INSERT INTO mfa_accounts VALUES (?,NULL,?,?, -1,'[]') ON CONFLICT(user_id) DO UPDATE SET pending=excluded.pending,pending_until=excluded.pending_until").run(id,seal(secret,id),now()+600000));return {secret,uri:totp(secret,username).toString(),expires:now()+600000};},
  confirm(id,token){if(limited(id))throw Error('Doğrulama denemesi sınırı aşıldı.');const row=db.prepare('SELECT * FROM mfa_accounts WHERE user_id=?').get(id);if(!row?.pending||row.secret||row.pending_until<=now())throw Error('MFA kurulumu süresi dolmuş veya geçersiz.');const secret=unseal(row.pending,id),value=counter(secret,token);if(value===null){failed(id);throw Error('Doğrulama kodu geçersiz.');}const codes=Array.from({length:8},()=>crypto.randomBytes(16).toString('hex'));store.atomicSecurity(securityEvent(id,'İki aşamalı doğrulama etkinleştirildi'),()=>{db.prepare('UPDATE mfa_accounts SET secret=?,pending=NULL,pending_until=0,last_counter=?,recovery=? WHERE user_id=?').run(seal(secret,id),value,JSON.stringify(codes.map(code=>hash(id,code))),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);});return {recoveryCodes:codes.map(code=>code.match(/.{8}/g).join('-'))};},
  disable(id,token){if(!this.status(id).enabled||!verify(id,token,false))throw Error('Doğrulama kodu geçersiz.');store.atomicSecurity(securityEvent(id,'İki aşamalı doğrulama kapatıldı'),()=>{if(!verify(id,token))throw Error('Doğrulama kodu geçersiz.');db.prepare('DELETE FROM mfa_accounts WHERE user_id=?').run(id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);});}
 };
}
module.exports={openMfa};
