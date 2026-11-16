'use strict';
// Producer-only offline administration. Never include in customer packages.
const fs=require('node:fs'),path=require('node:path'),{openVendorLicenses}=require('../vendor-license-store');
(async()=>{
 const [action,dir,keyFile]=process.argv.slice(2);if(!['provision','revoke','renew'].includes(action)||process.argv.length!==5||!path.isAbsolute(dir||'')||!path.isAbsolute(keyFile||''))throw Error('Kullanım: JSON-stdin | node tools/vendor-license-admin.cjs provision|renew|revoke TAM_VERI_KLASORU TAM_OZEL_ANAHTAR_DOSYASI');
 let input='';for await(const part of process.stdin){input+=part;if(Buffer.byteLength(input)>4096)throw Error('Yönetim girdisi çok büyük.');}let request;try{request=JSON.parse(input);}catch{throw Error('Geçerli JSON girdi gerekir.');}if(!request||Array.isArray(request)||typeof request!=='object')throw Error('Yönetim girdisi nesne olmalı.');
 const stat=fs.lstatSync(keyFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)throw Error('Özel anahtar dosyası geçersiz.');
 const privateKey=fs.readFileSync(keyFile);let store;try{store=openVendorLicenses(dir,{privateKey});if(action==='provision'){const result=store.provision(request);process.stdout.write(JSON.stringify(result)+'\n');}else{if(typeof request.licenseId!=='string'||!/^[a-f0-9-]{36}$/.test(request.licenseId))throw Error('Geçerli lisans kimliği gerekir.');if(action==='renew')store.renew(request.licenseId,request);else store.revoke(request.licenseId);process.stdout.write(JSON.stringify({ok:true,action,licenseId:request.licenseId})+'\n');}}finally{store?.close();privateKey.fill(0);}
})().catch(()=>{console.error('Üretici lisans yönetimi tamamlanamadı. Girdi, dosya izinleri ve kayıt durumunu kontrol edin.');process.exitCode=1;});
