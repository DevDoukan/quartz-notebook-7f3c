'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const [action,...args]=process.argv.slice(2),origin=process.env.KALKAN_LICENSE_ORIGIN||'https://lisans.kalkandlp.com.tr';
function usage(){console.error('Kullanım: provision <serverId> <müşteri> <cihaz> <YYYY-MM-DD> | renew <licenseId> <cihaz> <YYYY-MM-DD> | revoke <licenseId>');process.exit(2);}
let command;
if(action==='provision'&&args.length===4)command={action,serverId:args[0],customer:args[1],deviceLimit:Number(args[2]),licenseExpiresAt:new Date(args[3]+'T23:59:59.000Z').toISOString()};
else if(action==='renew'&&args.length===3)command={action,licenseId:args[0],deviceLimit:Number(args[1]),licenseExpiresAt:new Date(args[2]+'T23:59:59.000Z').toISOString()};
else if(action==='revoke'&&args.length===1)command={action,licenseId:args[0]};else usage();
const seedPath=process.env.KALKAN_VENDOR_SIGNING_SEED;if(!seedPath||!fs.existsSync(seedPath)){console.error('KALKAN_VENDOR_SIGNING_SEED ortam değişkeni özel anahtar dosyasını göstermeli.');process.exit(2);}
const seed=Buffer.from(fs.readFileSync(seedPath,'utf8').trim(),'base64');if(seed.length!==32)throw Error('Üretici imza anahtarı geçersiz.');
const der=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),key=crypto.createPrivateKey({key:der,format:'der',type:'pkcs8'});
const now=Date.now();command={schema:1,id:crypto.randomUUID(),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString(),...command};
const payload=Buffer.from(JSON.stringify(command)),envelope={payload:payload.toString('base64url'),signature:crypto.sign(null,payload,key).toString('base64url')};
const url=new URL(origin);if(url.protocol!=='https:'||url.hostname!=='lisans.kalkandlp.com.tr'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Lisans merkezi adresi geçersiz.');
(async()=>{const response=await fetch(new URL('/api/v1/admin/command',url),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(15000)});const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw Error('Lisans servisi beklenmeyen yanıt döndürdü.');}if(!response.ok)throw Error('Lisans yönetim isteği reddedildi ('+response.status+').');process.stdout.write(JSON.stringify(result,null,2)+'\n');})().catch(error=>{console.error(error.message);process.exitCode=1;});
