'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function verifyPackage(root){
 root=fs.realpathSync(root);const manifestPath=path.join(root,'RELEASE-MANIFEST.json');
 if(!fs.lstatSync(manifestPath).isFile()||fs.lstatSync(manifestPath).isSymbolicLink())throw Error('Paket manifesti normal dosya olmalı.');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,'')),expected=new Set();
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Paket manifesti geçersiz.');
 for(const file of manifest.files){
  if(!file||typeof file.path!=='string'||path.isAbsolute(file.path)||/[\x00-\x1f:]/.test(file.path))throw Error('Manifestte izin verilmeyen dosya var.');
  const parts=file.path.split(/[\\/]/),key=parts.join('/').toLowerCase();
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p))||key==='release-manifest.json'||
   /^(data|\.vendor)\//i.test(key)||parts.some(p=>/^(vendor-private\.pem|vendor-signing\.seed|setup-key\.txt|control-token\.txt|audit-key\.bin|server\.lock|vendor-activation\.json)$/i.test(p))||
   expected.has(key)||!Number.isSafeInteger(file.bytes)||file.bytes<0||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Manifestte izin verilmeyen veya yinelenen dosya var.');
  expected.add(key);
  const full=fs.realpathSync(path.join(root,file.path));if(!full.startsWith(root+path.sep))throw Error('Paket dosyası kök dışına çıkıyor.');
  const bytes=fs.readFileSync(full);if(bytes.length!==file.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Paket dosyası değiştirilmiş: '+file.path);
  if(/^(public|central-public|extension)\//.test(key)&&
    /Bearer\s+(?:o1_)?[a-f0-9]{64}\b/i.test(bytes.toString('utf8'))) {
    throw Error('Herkese açık paket dosyasında sabit cihaz kimliği var: '+file.path);
  }
 }
 const observed=new Set();
 function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const full=path.join(directory,entry.name),stat=fs.lstatSync(full),relative=path.relative(root,full).split(path.sep).join('/'),key=relative.toLowerCase();
  if(stat.isSymbolicLink())throw Error('Paket içinde bağlantı noktası var: '+relative);
  if(stat.isDirectory()){walk(full);continue;}
  if(!stat.isFile())throw Error('Paket içinde normal olmayan dosya var: '+relative);
  if(relative==='RELEASE-MANIFEST.json')continue;
  if(!expected.has(key)||observed.has(key))throw Error('Paket içinde listelenmeyen veya yinelenen dosya var: '+relative);
  observed.add(key);
 }}
 walk(root);if(observed.size!==expected.size)throw Error('Paket dosya listesi eksik.');
 return {valid:true,files:manifest.files.length,version:manifest.version,sourceFingerprint:manifest.sourceFingerprint};
}
if(require.main===module){try{console.log(JSON.stringify(verifyPackage(process.argv[2])));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verifyPackage};
