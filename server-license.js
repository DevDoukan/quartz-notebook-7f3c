'use strict';
const crypto=require('node:crypto');
// Separate product and schema: endpoint/offline licenses cannot grant server seats.
function verifyServerLease(document,publicKey,serverId,now=Date.now()){
 if(!document||typeof document.payload!=='string'||document.payload.length>16384||typeof document.signature!=='string'||document.signature.length>256)throw Error('Sunucu lisans yanıtı geçersiz.');
 const raw=Buffer.from(document.payload,'base64url');if(!crypto.verify(null,raw,publicKey,Buffer.from(document.signature,'base64url')))throw Error('Üretici lisans imzası doğrulanamadı.');
 const value=JSON.parse(raw.toString('utf8'));
 if(value.schema!==1||value.product!=='kalkan-dlp-server'||value.serverId!==serverId||typeof value.licenseId!=='string'||!value.licenseId||typeof value.customer!=='string'||!value.customer.trim()||value.customer.length>200||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.deviceLimit)||value.deviceLimit<0||value.deviceLimit>100000||!['active','revoked'].includes(value.state))throw Error('Lisans bu sunucu veya ürün için geçerli değil.');
 const issued=Date.parse(value.issuedAt),expires=Date.parse(value.expiresAt);
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+60000||expires<=issued||expires-issued>7*86400000)throw Error('Lisans kiralama tarihleri geçersiz.');
 return {...value,allowed:value.state==='active'&&expires>now};
}
function openServerLicense(store,{publicKey,now=Date.now}={}){
 const serverId=store.get('serverLicenseId',null)||crypto.randomUUID();store.set('serverLicenseId',serverId);
 function status(){const document=store.get('serverLicenseLease',null);if(!document)return {serverId,state:'unlicensed',allowed:false,deviceLimit:0};try{const claims=verifyServerLease(document,publicKey,serverId,now()),last=store.get('serverLicenseLastSeen',0);if(now()<last-60000)return {serverId,state:'clock-error',allowed:false,deviceLimit:0};if(now()>last)store.set('serverLicenseLastSeen',now());return {serverId,state:claims.allowed?'active':claims.state==='revoked'?'revoked':'expired',allowed:claims.allowed,deviceLimit:claims.deviceLimit,expiresAt:claims.expiresAt,revision:claims.revision,customer:claims.customer};}catch{return {serverId,state:'invalid',allowed:false,deviceLimit:0};}}
 function accept(document){const claims=verifyServerLease(document,publicKey,serverId,now()),saved=store.get('serverLicenseLease',null);if(saved){const previous=verifyServerLease(saved,publicKey,serverId,now());if(claims.revision<previous.revision||(claims.revision===previous.revision&&JSON.stringify(document)!==JSON.stringify(saved)))throw Error('Eski veya çelişkili üretici lisansı reddedildi.');}store.set('serverLicenseLease',document);return status();}
 function document(){const saved=store.get('serverLicenseLease',null);if(!saved)return null;verifyServerLease(saved,publicKey,serverId,now());return saved;}
 return {status,accept,document};
}
module.exports={verifyServerLease,openServerLicense};
