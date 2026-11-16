'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=process.argv[2];
if(!dir){console.error('Kullanım: node tools/create-vendor-key.cjs <özel-anahtar-klasörü>');process.exit(1);}
fs.mkdirSync(dir,{recursive:true});
const keyPath=path.join(dir,'vendor-private.pem'),publicPath=path.join(__dirname,'..','license-public.pem');
if(fs.existsSync(keyPath)||fs.existsSync(publicPath))throw Error('Mevcut lisans anahtarının üzerine yazılmaz. Anahtar değişimi için ayrı sürüm ve göç gerekir.');
const pair=crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(keyPath,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
fs.writeFileSync(publicPath,pair.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});
console.log('Satıcı anahtarı oluşturuldu. Özel anahtarı müşteriye gönderilecek pakete EKLEMEYİN. Güvenli yedeğini alın.');
