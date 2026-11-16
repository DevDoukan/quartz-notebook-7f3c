'use strict';
const https=require('node:https');
function openVendorLicenseClient(license,{origin,credential,ca,intervalMs=3600000,timeoutMs=10000}={}){
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Üretici lisans adresi geçersiz; HTTPS kök adresi gerekir.');
 if(typeof credential!=='string'||!/^[a-f0-9]{64}$/.test(credential))throw Error('Üretici aktivasyon kimliği geçersiz.');
 if(!Number.isSafeInteger(intervalMs)||intervalMs<1000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Lisans bağlantı aralığı geçersiz.');
 let pending=null,timer=null,closed=false,error=null,lastSuccess=null;
 function request(){return new Promise((resolve,reject)=>{
  const state=license.status(),data=JSON.stringify({schema:1,product:'kalkan-dlp-server',serverId:state.serverId,revision:state.revision||0});
  const req=https.request(new URL('/api/v1/server/lease',url),{method:'POST',ca,rejectUnauthorized:true,headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
   if(res.statusCode!==200){res.resume();return reject(Error('Üretici lisans isteği reddedildi ('+res.statusCode+').'));}
   const chunks=[];let size=0;res.on('error',reject);res.on('aborted',()=>reject(Error('Lisans yanıtı yarıda kesildi.')));res.on('data',part=>{size+=part.length;if(size>32768){res.destroy(Error('Lisans yanıtı çok büyük.'));return;}chunks.push(part);});res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('Üretici lisans yanıtı JSON değil.'));}});
  });
  const deadline=setTimeout(()=>req.destroy(Error('Üretici lisans bağlantısı zaman aşımına uğradı.')),timeoutMs);req.on('close',()=>clearTimeout(deadline));req.on('error',reject);req.end(data);
 });}
 function sync(){if(closed)return Promise.reject(Error('Lisans bağlantısı kapalı.'));if(pending)return pending;pending=request().then(document=>{const state=license.accept(document);lastSuccess=new Date().toISOString();error=null;return state;}).catch(e=>{error=e.message;throw e;}).finally(()=>{pending=null;});return pending;}
 const retryDelays=[15000,30000,60000,120000,300000];
 let started=false,failures=0;
 async function renew(){
  try{await sync();failures=0;}
  catch{failures=Math.min(failures+1,retryDelays.length);}
  if(closed)return;
  const delay=failures?Math.min(intervalMs,retryDelays[failures-1]):intervalMs;
  timer=setTimeout(renew,delay);
  timer.unref();
 }
 return {
  sync,
  status(){return {origin:url.origin,lastSuccess,error,pending:!!pending};},
  start(){if(started||closed)return;started=true;void renew();},
  async close(){closed=true;clearTimeout(timer);if(pending)await pending.catch(()=>{});}
 };
}
module.exports={openVendorLicenseClient};
