'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function openSigning(dir){
 const file=path.join(dir,'policy-signing-key.pem');
 if(!fs.existsSync(file)){const pair=crypto.generateKeyPairSync('ed25519');fs.writeFileSync(file,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});}
 const privateKey=crypto.createPrivateKey(fs.readFileSync(file)),publicKey=crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'});
 if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Merkez politika anahtarı geçersiz.');
 return {publicKey,sign(value){const payload=JSON.stringify(value);return {payload,signature:crypto.sign(null,Buffer.from(payload),privateKey).toString('base64')};}};
}
module.exports={openSigning};
