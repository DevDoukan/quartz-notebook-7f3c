'use strict';
const crypto=require('node:crypto');
const DAY=24*60*60*1000;
function verifyLicense(document,publicKey,installationId,now=Date.now()){
  if(!document||typeof document.payload!=='string'||typeof document.signature!=='string'||document.payload.length>8192)throw Error('Lisans dosyası geçersiz.');
  const raw=Buffer.from(document.payload,'base64url');
  if(!crypto.verify(null,raw,publicKey,Buffer.from(document.signature,'base64url')))throw Error('Lisans imzası doğrulanamadı.');
  const claims=JSON.parse(raw.toString('utf8'));
  if(claims.schema!==1||claims.product!=='kalkan-dlp'||claims.installationId!==installationId||typeof claims.customer!=='string'||!claims.customer.trim()||claims.customer.length>200||typeof claims.licenseId!=='string'||!Number.isFinite(Date.parse(claims.issuedAt))||!Number.isFinite(Date.parse(claims.expiresAt))||claims.plan!=='Business')throw Error('Lisans bu kurulum veya ürün için geçerli değil.');
  if(Date.parse(claims.issuedAt)>now+60*60*1000||Date.parse(claims.expiresAt)<=Date.parse(claims.issuedAt))throw Error('Lisans tarihleri geçersiz.');
  return claims;
}
function openLicense(store,{publicKey,now=Date.now}={}){
  const installation=store.get('installation',null)||{id:crypto.randomUUID(),trialStartedAt:new Date(now()).toISOString(),lastSeen:now()};
  store.set('installation',installation);
  function status(){
    const at=now(),last=store.get('installation',installation);
    if(at<last.lastSeen-60*60*1000)return {state:'clock-error',allowed:false,installationId:installation.id,message:'Sistem saati önceki çalışmadan geri. Tarih ve saati doğrulayın.'};
    if(at>last.lastSeen+60*1000){last.lastSeen=at;store.set('installation',last);}
    let claims=null;const saved=store.get('license',null);
    if(saved){try{claims=verifyLicense(saved,publicKey,installation.id,at);}catch{return {state:'invalid',allowed:false,installationId:installation.id,message:'Kayıtlı lisans doğrulanamadı.'};}}
    const expiresAt=claims?.expiresAt||new Date(Date.parse(installation.trialStartedAt)+14*DAY).toISOString();
    const remainingMs=Date.parse(expiresAt)-at,allowed=remainingMs>0;
    return {state:allowed?(claims?'active':'trial'):'expired',allowed,installationId:installation.id,customer:claims?.customer,plan:claims?.plan||'14 günlük deneme',expiresAt,daysRemaining:Math.max(0,Math.ceil(remainingMs/DAY)),licenseId:claims?.licenseId};
  }
  function activate(document){const claims=verifyLicense(document,publicKey,installation.id,now());if(Date.parse(claims.expiresAt)<=now())throw Error('Bu lisansın süresi dolmuş.');store.set('license',document);return status();}
  function requireActive(){const current=status();if(!current.allowed){const e=Error(current.message||'Lisans veya deneme süresi sona erdi. Mevcut kayıtları okuyabilir ve raporları indirebilirsiniz.');e.status=402;e.code='LICENSE_INACTIVE';throw e;}return current;}
  return {status,activate,requireActive};
}
module.exports={openLicense,verifyLicense};
