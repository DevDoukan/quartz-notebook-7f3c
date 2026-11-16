'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'Kalkan-DLP-Kurulum'),manifestName='DOSYA-DOGRULAMA.json';
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const required=[`Kalkan-DLP-${version}-Agent-Setup-unsigned.exe`,`Kalkan-DLP-${version}-Server-Setup-unsigned.exe`,'KURULUM-README.md'];
function entries(){return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name!==manifestName).map(e=>e.name).sort().map(name=>{const bytes=fs.readFileSync(path.join(dir,name));return {name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});}
function verify(){const saved=JSON.parse(fs.readFileSync(path.join(dir,manifestName),'utf8')),actual=entries(),errors=[];
 if(saved.schema!==1||saved.version!==version||!Array.isArray(saved.files))throw Error('Teslim listesi şeması veya sürümü geçersiz.');
 const expected=new Map(saved.files.map(f=>[f.name,f]));
 for(const f of actual){const old=expected.get(f.name);if(!old)errors.push('Listede olmayan dosya: '+f.name);else if(old.bytes!==f.bytes||old.sha256!==f.sha256)errors.push('Değişmiş dosya: '+f.name);expected.delete(f.name);}
 for(const name of expected.keys())errors.push('Eksik dosya: '+name);
 for(const name of required)if(!actual.some(f=>f.name===name))errors.push('Zorunlu dosya eksik: '+name);
 if(errors.length)throw Error(errors.join('\n'));return actual.length;
}
try{if(process.argv[2]==='--verify'){console.log('Teslim dosyaları doğrulandı: '+verify());}else if(process.argv.length===2){const files=entries();for(const name of required)if(!files.some(f=>f.name===name))throw Error('Zorunlu dosya eksik: '+name);
 fs.writeFileSync(path.join(dir,manifestName),JSON.stringify({schema:1,version,createdAt:new Date().toISOString(),authenticodeSigned:false,readyForSale:false,note:'SHA-256 teslim bütünlüğünü denetler; yayıncı imzası veya ticari kabul kanıtı değildir.',files},null,2)+'\n');console.log('Teslim listesi oluşturuldu ve doğrulandı: '+verify());
 }else throw Error('Kullanım: node tools/delivery-manifest.cjs [--verify]');}catch(e){console.error(e.message);process.exitCode=1;}
