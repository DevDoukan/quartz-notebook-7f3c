'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.join(__dirname,'..'),dir=path.resolve(process.argv[2]||path.join(root,'.vendor'));
const seedPath=path.join(dir,'vendor-signing.seed'),publicPath=path.join(root,'vendor-license-public.pem'),phpPublicPath=path.join(root,'licensing-php','vendor-public.key');
if(fs.existsSync(seedPath)||fs.existsSync(publicPath)||fs.existsSync(phpPublicPath))throw Error('Satıcı imza anahtarı zaten var; üzerine yazılmaz.');
fs.mkdirSync(dir,{recursive:true});const seed=crypto.randomBytes(32),privateKey=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'}),publicKey=crypto.createPublicKey(privateKey);
fs.writeFileSync(seedPath,seed.toString('base64')+'\n',{flag:'wx',mode:0o600});fs.writeFileSync(publicPath,publicKey.export({format:'pem',type:'spki'}),{flag:'wx'});fs.writeFileSync(phpPublicPath,publicKey.export({format:'jwk'}).x+'\n',{flag:'wx'});
if(process.platform==='win32'){const account=cp.execFileSync('whoami.exe',[],{encoding:'utf8'}).trim(),acl=cp.spawnSync('icacls.exe',[seedPath,'/inheritance:r','/grant:r',account+':(F)','SYSTEM:(F)'],{encoding:'utf8'});if(acl.status!==0)throw Error('Anahtar oluşturuldu ancak NTFS ACL ayarlanamadı. '+(acl.stderr||'icacls hata verdi.'));}
console.log('Satıcı Ed25519 anahtarı oluşturuldu. Özel tohum .vendor/vendor-signing.seed içinde kalır; yedekleyin ve yayımlamayın.');
