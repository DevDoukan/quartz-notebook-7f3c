'use strict';
const fs=require('node:fs'),path=require('node:path'),{openServerLicense}=require('./server-license'),{openVendorLicenseClient}=require('./vendor-license-client');
function openServerLicenseRuntime(store,dir,{profile=require('./vendor-license-profile.json'),root=__dirname,now=Date.now,publicKey,ca}={}){
 const key=publicKey||fs.readFileSync(path.join(root,profile.publicKeyFile)),keyPem=Buffer.isBuffer(key)?key.toString('utf8'):typeof key==='string'?key:key.type==='public'?key.export({type:'spki',format:'pem'}):require('node:crypto').createPublicKey(key).export({type:'spki',format:'pem'}),license=openServerLicense(store,{publicKey:key,now});let client=null,configurationError=null;
 const credentialFile=path.join(dir,'vendor-activation.json');
 if(!profile.origin)configurationError='Üretici lisans adresi paket yapılandırmasında henüz tanımlanmadı.';
 else if(!fs.existsSync(credentialFile))configurationError='Üretici aktivasyon kimliği kurulmadı.';
 else{const stat=fs.lstatSync(credentialFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)throw Error('Üretici aktivasyon dosyası geçersiz.');const input=JSON.parse(fs.readFileSync(credentialFile,'utf8').replace(/^\uFEFF/,''));if(Object.keys(input).some(key=>key!=='credential'))throw Error('Aktivasyon dosyası yalnızca üretici kimliğini içermeli; adres/anahtar değiştirilemez.');client=openVendorLicenseClient(license,{origin:profile.origin,credential:input.credential,ca});}
 return {vendorPublicKey:keyPem,document:license.document,status(){return {...license.status(),renewal:client?client.status():{error:configurationError}};},start(){client?.start();},sync(){return client?client.sync():Promise.reject(Error(configurationError));},async close(){await client?.close();}};
}
module.exports={openServerLicenseRuntime};
