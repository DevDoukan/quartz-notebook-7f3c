'use strict';
const https=require('node:https'),http=require('node:http'),crypto=require('node:crypto');
const {rules}=require('./detector'),{openClientEntitlement}=require('./client-entitlement');
function transport(origin,{ca,testLoopback=false}={}){
 const url=new URL(origin);
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Geçersiz merkez adresi.');
 if(url.protocol!=='https:'&&!(testLoopback&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Merkez bağlantısı HTTPS gerektirir.');
 return (route,input,credential)=>new Promise((resolve,reject)=>{
   const data=JSON.stringify(input);const req=(url.protocol==='https:'?https:http).request(new URL(route,url),{method:'POST',ca,rejectUnauthorized:true,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...(credential?{Authorization:'Bearer '+credential}:{})}},res=>{
     let size=0;const chunks=[];res.on('data',part=>{size+=part.length;if(size>65536){res.destroy(Error('Merkez yanıtı çok büyük.'));return;}chunks.push(part);});res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200&&res.statusCode!==201){const e=Error('Merkez isteği reddedildi.');e.status=res.statusCode;return reject(e);}try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('Geçersiz merkez yanıtı.'));}});
   });
   // An absolute deadline also bounds DNS and slow trickle responses.
   const deadline=setTimeout(()=>req.destroy(Error('Merkez bağlantısı zaman aşımına uğradı.')),10000);req.on('close',()=>clearTimeout(deadline));req.on('error',reject);req.end(data);
 });
}
function openCentralLink(store,config,{ca,testLoopback=false,now=Date.now,testVendorPublicKey,onUsbWriteProtection}={}){
 if(!config||!/^[a-f0-9]{64}$/.test(config.credential)||typeof config.id!=='string'||typeof config.policyPublicKey!=='string')throw Error('Ajan merkez yapılandırması geçersiz.');
 const publicKey=crypto.createPublicKey(config.policyPublicKey);if(publicKey.asymmetricKeyType!=='ed25519')throw Error('Merkez politika anahtarı geçersiz.');
 let clientEntitlement=null,vendorIdentity=null;if(testVendorPublicKey&&(!testLoopback||!['127.0.0.1','localhost','::1'].includes(new URL(config.origin).hostname)))throw Error('Test lisans anahtarı yalnızca loopback testinde kullanılabilir.');const pin=testVendorPublicKey||require('node:fs').readFileSync(require('node:path').join(__dirname,'vendor-license-public.pem')),pinnedVendor=pin?.type==='public'?pin:crypto.createPublicKey(pin);
 function currentIdentity(){return crypto.createHash('sha256').update(config.origin+'\n'+config.id+'\n'+config.policyPublicKey+(vendorIdentity?'\n'+vendorIdentity.serverId+'\n'+vendorIdentity.vendorLicensePublicKey:'')).digest('hex');}
 function bindVendorIdentity(serverId,pem){if(serverId===undefined&&pem===undefined)return;if(!/^[a-f0-9-]{36}$/.test(serverId||'')||typeof pem!=='string')throw Error('Üretici lisans kimliği geçersiz.');const vendorPublicKey=crypto.createPublicKey(pem),sameKey=vendorPublicKey.export({type:'spki',format:'der'}).equals(pinnedVendor.export({type:'spki',format:'der'}));if(vendorPublicKey.asymmetricKeyType!=='ed25519'||!sameKey)throw Error('Üretici lisans anahtarı bu ürüne ait değil.');const saved=store.get('centralVendorIdentity',null),candidate={serverId,vendorLicensePublicKey:vendorPublicKey.export({type:'spki',format:'pem'})};if(config.serverId&&(config.serverId!==serverId||config.vendorLicensePublicKey!==candidate.vendorLicensePublicKey))throw Error('Kayıtlı lisans sunucusu kimliği değişmiş.');if(saved&&(saved.serverId!==serverId||saved.vendorLicensePublicKey!==candidate.vendorLicensePublicKey))throw Error('Merkez lisans sunucusu kimliği değişmiş.');const previous=store.get('centralIdentity',null),next=crypto.createHash('sha256').update(config.origin+'\n'+config.id+'\n'+config.policyPublicKey+'\n'+serverId+'\n'+candidate.vendorLicensePublicKey).digest('hex'),legacy=crypto.createHash('sha256').update(config.origin+'\n'+config.id+'\n'+config.policyPublicKey).digest('hex');if(previous&&previous!==next&&previous!==legacy)throw Error('Merkez kimliği değişmiş. Kontrollü yeniden kayıt gerekiyor.');vendorIdentity=candidate;store.set('centralVendorIdentity',candidate);if(!clientEntitlement)clientEntitlement=openClientEntitlement(store,{deviceId:config.id,serverId,vendorPublicKey,serverPublicKey:publicKey,now});store.set('centralIdentity',next);}
 if(config.serverId!==undefined||config.vendorLicensePublicKey!==undefined)bindVendorIdentity(config.serverId,config.vendorLicensePublicKey);else{const saved=store.get('centralVendorIdentity',null);if(saved)bindVendorIdentity(saved.serverId,saved.vendorLicensePublicKey);}
 const request=transport(config.origin,{ca:ca||(config.caPem?Buffer.from(config.caPem):(config.caFile?require('node:fs').readFileSync(config.caFile):undefined)),testLoopback});
 const identity=currentIdentity(),legacyIdentity=crypto.createHash('sha256').update(config.origin+'\n'+config.id+'\n'+config.policyPublicKey).digest('hex');
 const existing=store.get('centralIdentity',null);if(existing&&existing!==identity&&existing!==legacyIdentity)throw Error('Merkez kimliği değişmiş. Kontrollü yeniden kayıt gerekiyor.');store.set('centralIdentity',identity);
 store.db.exec('CREATE TABLE IF NOT EXISTS central_outbox(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
 let pending=null,stopped=false,timer=null,lastSuccess=null,error=null;
 function verify(envelope){
   if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>32768||typeof envelope.signature!=='string'||!crypto.verify(null,Buffer.from(envelope.payload),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('Merkez politika imzası doğrulanamadı.');
   const state=JSON.parse(envelope.payload),p=state.policy;
   if(state.deviceId!==config.id)throw Error('Politika başka bir cihaza ait.');
   if(state.serverId!==undefined||state.vendorLicensePublicKey!==undefined)bindVendorIdentity(state.serverId,state.vendorLicensePublicKey);
   if(p&&(!Number.isSafeInteger(p.revision)||p.revision<1||!['audit','block'].includes(p.mode)||!Array.isArray(p.enabled)||p.enabled.length>100||p.enabled.some(id=>!rules.some(rule=>rule.id===id))||(p.usbWriteProtection!==undefined&&p.usbWriteProtection!==null&&typeof p.usbWriteProtection!=='boolean')))throw Error('Merkez politikası geçersiz.');
   return p;
 }
 const saved=store.get('centralPolicy',null);if(saved)verify(saved);
 function policy(){const value=store.get('centralPolicy',null);const p=value?verify(value):null;return p?{mode:p.mode,enabled:p.enabled,...(Object.hasOwn(p,'usbWriteProtection')?{usbWriteProtection:p.usbWriteProtection}:{})}:null;}
 let appliedUsbWriteProtection;
 async function applyUsbPolicy(p){if(typeof p?.usbWriteProtection!=='boolean'||appliedUsbWriteProtection===p.usbWriteProtection)return;if(typeof onUsbWriteProtection!=='function')throw Error('Merkez USB yazma politikası için makine hizmeti gerekir.');await onUsbWriteProtection(p.usbWriteProtection);appliedUsbWriteProtection=p.usbWriteProtection;}
 function policyHash(p){const state={revision:p.revision,mode:p.mode,enabled:p.enabled,...(Object.hasOwn(p,'usbWriteProtection')?{usbWriteProtection:p.usbWriteProtection}:{})};return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');}
 async function perform(){
   const cached=store.get('centralPolicy',null),previous=cached?verify(cached):null;
   await applyUsbPolicy(previous);
   const status={protocol:1,agentVersion:require('./package.json').version,policyRevision:previous?.revision||0,policyHash:previous?policyHash(previous):null,queuedEvents:store.db.prepare('SELECT count(*) AS n FROM central_outbox').get().n};
   const response=await request('/api/agent/heartbeat',{status},config.credential),incoming=verify(response.signed);
   if(previous&&(!incoming||incoming.revision<previous.revision))throw Error('Eski merkez politikası reddedildi.');
   if(previous&&incoming.revision===previous.revision&&JSON.stringify(incoming)!==JSON.stringify(previous))throw Error('Aynı sürümde farklı politika reddedildi.');
   if(incoming){await applyUsbPolicy(incoming);store.set('centralPolicy',response.signed);}
   if(clientEntitlement&&response.entitlement)clientEntitlement.accept(response.entitlement);
   for(const row of store.db.prepare('SELECT id,data FROM central_outbox ORDER BY rowid LIMIT 100').all()){
     if(stopped)break;await request('/api/agent/events',JSON.parse(row.data),config.credential);store.db.prepare('DELETE FROM central_outbox WHERE id=?').run(row.id);
   }
   lastSuccess=new Date(now()).toISOString();error=null;
 }
 function sync(){if(stopped)return Promise.resolve();if(pending)return pending;pending=perform().catch(e=>{error=e.status===401?'Ajan kimliği reddedildi.':e.message;throw e;}).finally(()=>{pending=null;});return pending;}
 return {
   policy,sync,entitlementStatus(){return clientEntitlement?.status()||null;},
   async outlookSession(){
     if(stopped||!policy())throw Error('Outlook için etkin şirket bağlantısı ve politika gerekir.');
     const session=await request('/api/agent/outlook/credential',{},config.credential);
     if(stopped||!session||!/^o1_[a-f0-9]{64}$/.test(session.credential)||
       !Number.isSafeInteger(session.expires)||session.expires<=now()||session.expires>now()+15*60*1000){
       throw Error('Şirket Outlook oturumu geçersiz veya süresi dolmuş.');
     }
     return {origin:new URL(config.origin).origin,credential:session.credential,expires:session.expires};
   },
   scanPolicy(){
     if(stopped||!clientEntitlement?.status()?.allowed)return null;
     const envelope=store.get('centralPolicy',null),value=envelope?verify(envelope):null;
     return value?{revision:value.revision,mode:value.mode,enabled:[...value.enabled]}:null;
   },
   enqueue(event){if(!['allow','warn','block'].includes(event.decision)||!Number.isSafeInteger(event.count)||event.count<0)return;const count=store.db.prepare('SELECT count(*) AS n FROM central_outbox').get().n;if(count>=10000)throw Error('Merkez olay kuyruğu dolu.');const summary={id:event.id,kind:event.kind,decision:event.decision,count:event.count};store.db.prepare('INSERT OR IGNORE INTO central_outbox VALUES (?,?)').run(summary.id,JSON.stringify(summary));},
   status(){return {configured:true,origin:new URL(config.origin).origin,deviceId:config.id,serverId:vendorIdentity?.serverId||null,lastSuccess,error,revision:store.get('centralPolicy',null)?verify(store.get('centralPolicy')).revision:null,queued:store.db.prepare('SELECT count(*) AS n FROM central_outbox').get().n,entitlement:clientEntitlement?.status()||null};},
   start(){if(timer||stopped)return;const tick=()=>sync().catch(()=>{});tick();timer=setInterval(tick,30000);timer.unref();},
   async close(){stopped=true;clearInterval(timer);if(pending)await pending.catch(()=>{});}
 };
}
module.exports={transport,openCentralLink};
