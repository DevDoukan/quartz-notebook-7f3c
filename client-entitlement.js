'use strict';
const crypto=require('node:crypto'),{verifyServerLease}=require('./server-license');
function verifyClientEntitlement(envelope,{deviceId,serverId,serverPublicKey,vendorPublicKey,now=Date.now()}={}){
 if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>32768||typeof envelope.signature!=='string'||envelope.signature.length>256||!crypto.verify(null,Buffer.from(envelope.payload),serverPublicKey,Buffer.from(envelope.signature,'base64')))throw Error('Client yetki imzası doğrulanamadı.');
 const value=JSON.parse(envelope.payload),issued=Date.parse(value.issuedAt),expires=Date.parse(value.expiresAt);
 if(value.schema!==1||value.product!=='kalkan-dlp-client-entitlement'||value.deviceId!==deviceId||value.serverId!==serverId||!Number.isSafeInteger(value.sequence)||value.sequence<1||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+60000||expires<=issued||expires-issued>86400000)throw Error('Client yetki kapsamı geçersiz.');
 const lease=verifyServerLease(value.vendorLease,vendorPublicKey,serverId,now);
 if(expires>Date.parse(lease.expiresAt)||issued<Date.parse(lease.issuedAt))throw Error('Client yetkisi üretici lisans süresini aşamaz.');
 return {allowed:lease.allowed&&expires>now,sequence:value.sequence,vendorRevision:lease.revision,expiresAt:value.expiresAt,licenseId:lease.licenseId,customer:lease.customer,installationId:serverId,daysRemaining:Math.max(0,Math.ceil((expires-now)/86400000)),state:lease.state==='revoked'?'revoked':expires<=now?'expired':lease.allowed?'active':'expired'};
}
function openClientEntitlement(store,{deviceId,serverId,serverPublicKey,vendorPublicKey,now=Date.now}={}){
 const identity=crypto.createHash('sha256').update(deviceId+'\n'+serverId+'\n'+crypto.createPublicKey(typeof serverPublicKey==='string'?serverPublicKey:serverPublicKey.export({format:'pem',type:'spki'})).export({format:'pem',type:'spki'})).digest('hex');
 function read(){const saved=store.get('clientEntitlement',null);if(saved&&saved.identity!==identity)throw Error('Client lisans kimliği değişmiş; kontrollü yeniden kayıt gerekir.');return saved;}
 function verify(envelope){return verifyClientEntitlement(envelope,{deviceId,serverId,serverPublicKey,vendorPublicKey,now:now()});}
 read();
 function status(){try{const saved=read();if(!saved)return {allowed:false,state:'pending'};if(now()<saved.lastSeen-60000)return {allowed:false,state:'clock-error'};const result=verify(saved.envelope);if(now()>saved.lastSeen)store.set('clientEntitlement',{...saved,lastSeen:now()});return result;}catch{return {allowed:false,state:'invalid'};}}
 function accept(envelope){store.db.exec('BEGIN IMMEDIATE');try{const result=verify(envelope),saved=read();if(saved){const previous=verify(saved.envelope);if(now()<saved.lastSeen-60000)throw Error('Client lisans saati geri alınmış.');if(result.vendorRevision<previous.vendorRevision||result.licenseId!==previous.licenseId||result.sequence<previous.sequence||(result.sequence===previous.sequence&&envelope.payload!==saved.envelope.payload))throw Error('Eski veya çelişkili Client yetkisi reddedildi.');}store.set('clientEntitlement',{identity,envelope,lastSeen:now()});store.db.exec('COMMIT');return result;}catch(error){store.db.exec('ROLLBACK');throw error;}}
 return {status,accept};
}
module.exports={verifyClientEntitlement,openClientEntitlement};
