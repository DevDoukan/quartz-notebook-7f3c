'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {transport}=require('./central-client');
async function enrollAgent(input,target,{onPrepared=()=>{},vendorPublicKeyOverride=null}={}){
 if(!path.isAbsolute(target)||fs.existsSync(target))throw Error('Ajan bağlantısı zaten var veya hedef geçersiz. Mevcut kimlik değiştirilmedi.');
 if(!input||typeof input.origin!=='string'||input.origin.length>2048||typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token)||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||/[\x00-\x1f]/.test(input.name))throw Error('Merkez kayıt anahtarı ve cihaz adı geçersiz.');
 let caPem;
 if(input.caPem){if(typeof input.caPem!=='string'||input.caPem.length>65536)throw Error('CA sertifikası çok büyük.');const blocks=input.caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);if(!blocks?.length||input.caPem.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,'').trim())throw Error('Yalnızca açık PEM CA sertifikası kabul edilir.');for(const block of blocks)new crypto.X509Certificate(block);caPem=blocks.join('\n')+'\n';}
 const request=transport(input.origin,{ca:caPem?Buffer.from(caPem):undefined}),origin=new URL(input.origin).origin;
 // Check destination writability before consuming a one-time registration key.
 const probe=path.join(path.dirname(target),'.enrollment-'+crypto.randomUUID());let handle;
 try{handle=fs.openSync(probe,'wx',0o600);fs.fsyncSync(handle);}finally{if(handle!==undefined){fs.closeSync(handle);fs.unlinkSync(probe);}}
 const pendingFile=target+'.pending.json',expected={origin,name:input.name.trim(),token:input.token,...(caPem?{caPem}:{})};let pending;
 const resuming=fs.existsSync(pendingFile);
 if(resuming){const stat=fs.lstatSync(pendingFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)throw Error('Bekleyen kayıt dosyası geçersiz.');pending=JSON.parse(fs.readFileSync(pendingFile,'utf8'));if(pending.version!==1||Object.entries(expected).some(([key,value])=>pending[key]!==value)||pending.caPem!==caPem||typeof pending.requestId!=='string'||!/^[a-f0-9]{64}$/.test(pending.requestId)||typeof pending.credential!=='string'||!/^[a-f0-9]{64}$/.test(pending.credential))throw Error('Başka veya bozuk bir kayıt isteği bekliyor. Mevcut kimlik değiştirilmedi.');}
 else {pending={version:1,...expected,requestId:crypto.randomBytes(32).toString('hex'),credential:crypto.randomBytes(32).toString('hex')};fs.writeFileSync(pendingFile,JSON.stringify(pending),{mode:0o600,flag:'wx',flush:true});}
 onPrepared();
 let registered;
 if(resuming){try{registered={...await request('/api/agent/identity',{},pending.credential),credential:pending.credential};}catch(error){if(error.status!==401)throw error;}}
 if(!registered)registered=await request('/api/agent/enroll',{token:pending.token,name:pending.name,requestId:pending.requestId,credential:pending.credential});
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 if(!uuid.test(registered.id)||!uuid.test(registered.tenant)||registered.credential!==pending.credential||typeof registered.policyPublicKey!=='string')throw Error('Merkez kayıt yanıtı geçersiz veya güvenli tekrar desteği yok.');
 const publicKey=crypto.createPublicKey(registered.policyPublicKey);if(publicKey.asymmetricKeyType!=='ed25519')throw Error('Merkez politika anahtarı geçersiz.');
 let vendorIdentity={};if(registered.serverId!==undefined||registered.vendorLicensePublicKey!==undefined){if(vendorPublicKeyOverride&&!['127.0.0.1','localhost','::1'].includes(new URL(origin).hostname))throw Error('Test lisans anahtarı yalnızca loopback testinde kullanılabilir.');const pinned=vendorPublicKeyOverride?crypto.createPublicKey(vendorPublicKeyOverride).export({type:'spki',format:'pem'}):fs.readFileSync(path.join(__dirname,'vendor-license-public.pem'),'utf8');if(!uuid.test(registered.serverId)||registered.vendorLicensePublicKey!==pinned)throw Error('Üretici lisans anahtarı merkez yanıtıyla eşleşmiyor.');const vendorKey=crypto.createPublicKey(pinned);if(vendorKey.asymmetricKeyType!=='ed25519')throw Error('Üretici lisans açık anahtarı geçersiz.');vendorIdentity={serverId:registered.serverId,vendorLicensePublicKey:vendorKey.export({type:'spki',format:'pem'})};}
 const config={origin,id:registered.id,tenant:registered.tenant,credential:registered.credential,policyPublicKey:publicKey.export({type:'spki',format:'pem'}),...vendorIdentity,...(caPem?{caPem}:{})};
 const temporary=target+'.complete-'+crypto.randomUUID();try{fs.writeFileSync(temporary,JSON.stringify(config,null,2),{mode:0o600,flag:'wx',flush:true});fs.linkSync(temporary,target);}finally{try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch{}}
 try{fs.unlinkSync(pendingFile);}catch{}return config;
}
module.exports={enrollAgent};
