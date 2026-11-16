'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
let brokerActive=0;
function normalizeLocal(value){
  if(typeof value!=='string'||value.length>30000||! /^[a-z]:[\\/]/i.test(value)||value.slice(2).includes(':'))throw Error('Tam, yerel bir Windows klasör yolu girin. Ağ ve aygıt yolları desteklenmez.');
  const normalized=path.win32.resolve(value);
  if(normalized.length<=3)throw Error('Tüm sürücü yerine belirli bir klasör seçin.');
  return normalized.replace(/[\\/]+$/,'');
}
function within(value,root){value=value.toLowerCase();root=root.toLowerCase();return value===root||value.startsWith(root+path.sep);}
function openAccess(store,{mode=false,dataDir,appRoot=__dirname,protectedRoots=[],brokerPath=path.join(__dirname,'agent','KalkanFileBroker.exe')}={}){
  const denied=[path.resolve(dataDir),path.resolve(appRoot),...protectedRoots.map(root=>path.resolve(root))];
  const roots=()=>store.get('trustedRoots',[]);
  async function setRoots(input){
    if(!Array.isArray(input)||input.length>20)throw Error('En fazla 20 güvenilen klasör tanımlayın.');
    const resolved=[];
    for(const value of input){const local=normalizeLocal(value),canonical=await fs.realpath(local);if(denied.some(root=>within(canonical,root)))throw Error('Uygulama ve veri klasörleri güvenilen kaynak olarak kullanılamaz.');const stat=await fs.stat(canonical);if(!stat.isDirectory())throw Error('Yalnızca klasörler eklenebilir.');resolved.push(canonical);}
    store.set('trustedRoots',[...new Set(resolved)]);return roots();
  }
  async function broker(action,filename){
    normalizeLocal(filename);
    const trusted=roots();
    if(!trusted.length)throw Error('Hizmet taraması için yönetici önce güvenilen klasörleri tanımlamalı.');
    if(brokerActive>=4)throw Error('Güvenli dosya erişimi meşgul. Biraz sonra tekrar deneyin.');
    brokerActive++;
    return new Promise((resolve,reject)=>{
      const child=spawn(brokerPath,[],{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[];let size=0,errorText='',done=false;
      const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);brokerActive--;error?reject(error):resolve(result);};
      const timer=setTimeout(()=>{child.kill();finish(Error('Güvenli dosya erişim süresi aşıldı.'));},20000);
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>24*1024*1024){child.kill();finish(Error('Dosya erişimi çıktı sınırını aştı.'));}else chunks.push(chunk);});
      child.stderr.on('data',chunk=>{if(errorText.length<2048)errorText+=chunk.toString('utf8');});
      child.on('error',()=>finish(Error('Güvenli Windows dosya okuyucusu başlatılamadı. Kurulumu onarın.')));
      child.stdin.on('error',()=>{});
      child.on('close',code=>{
        if(code!==0){let failure;try{failure=JSON.parse(errorText);}catch{failure={error:errorText};}const error=Error(failure.error||'Güvenli dosya erişimi reddedildi.');if([2,3].includes(failure.win32))error.code='ENOENT';else if(failure.win32===5)error.code='EACCES';return finish(error);}
        try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')));}catch{finish(Error('Güvenli okuyucunun yanıtı doğrulanamadı.'));}
      });
      child.stdin.end(JSON.stringify({action,path:filename,roots:trusted,denied}));
    });
  }
  async function list(filename){
    const result=await broker('list',filename);
    return {path:result.path,truncated:!!result.truncated,entries:result.entries.map(e=>({name:e.name,isDirectory:()=>e.directory,isFile:()=>!e.directory&&!e.reparse,isSymbolicLink:()=>e.reparse}))};
  }
  async function read(filename){const result=await broker('read',filename);return Buffer.from(result.data,'base64');}
  return {mode,roots,setRoots,denied,read,list};
}
module.exports={openAccess,normalizeLocal,within};
