'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {fork}=require('node:child_process');
const {inspect}=require('./detector');
const TEXT=new Set(['.txt','.csv','.tsv','.json','.xml','.html','.htm','.md','.log','.yaml','.yml','.ini','.env','.eml','.sql','.js','.ts','.py','.cs','.config']);
const MAX_FILE=10*1024*1024;
let extractionBusy=0;
function extract(buffer,ext,{timeoutMs=30000,signal}={}) {
  if(signal?.aborted)return Promise.reject(Error('Belge okuma iptal edildi.'));
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return Promise.reject(Error('Geçersiz belge okuma süresi.'));
  if(buffer.length>MAX_FILE)return Promise.reject(Error('Dosya 10 MB sınırını aşıyor.'));
  const pdfHeader=buffer.indexOf(Buffer.from('%PDF-'));
  if(pdfHeader>=0&&pdfHeader<1024)ext='.pdf';
  else if(buffer[0]===0x50&&buffer[1]===0x4b&&buffer[2]===3&&buffer[3]===4&&!['.docx','.xlsx'].includes(ext))return Promise.reject(Error('Arşiv içeriği dosya uzantısından farklı. Desteklenen belge türü olarak yeniden seçin.'));
  else if((buffer[0]===0xff&&buffer[1]===0xd8)||buffer.subarray(0,4).equals(Buffer.from([0x89,0x50,0x4e,0x47]))||buffer.subarray(0,4).equals(Buffer.from([0xd0,0xcf,0x11,0xe0])))return Promise.reject(Error('Bu ikili belge türü için uygun okuyucu veya OCR gerekiyor.'));
  if(!['.pdf','.docx','.xlsx','.eml'].includes(ext)) {
    if(!TEXT.has(ext)) return Promise.reject(Error('Desteklenmeyen dosya türü.'));
    try{return Promise.resolve(require('./document-readers').plain(buffer));}
    catch(error){return Promise.reject(error);}
  }
  if(extractionBusy>=2)return Promise.reject(Error('Belge okuyucu meşgul. Biraz sonra tekrar deneyin.'));
  extractionBusy++;
  return new Promise((resolve,reject)=>{
    let worker;
    try{worker=fork(path.join(__dirname,'extract-worker.js'),[],{serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=192'],windowsHide:true});}
    catch{extractionBusy--;reject(Error('Belge okuyucu başlatılamadı.'));return;}
    let failure=null,result,received=false;
    const stop=error=>{if(!failure)failure=error;worker.kill();};
    const timer=setTimeout(()=>stop(Error('Belge okuma süresi aşıldı.')),timeoutMs);
    const abort=()=>stop(Error('Belge okuma iptal edildi.'));
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',message=>{
      if(failure)return;
      if(!message||typeof message!=='object'||typeof message.text!=='string'||message.error){stop(Error(message?.error||'Geçersiz belge okuyucu yanıtı.'));return;}
      received=true;result=message.text;
      // Keep the deadline armed until actual process close, not just IPC reply.
    });
    worker.once('error',()=>stop(Error('Belge okuma işlemi başarısız.')));
    worker.once('close',code=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);extractionBusy--;
      if(failure)reject(failure);
      else if(!received||code!==0)reject(Error('Belge okuyucu sonlandı.'));
      else resolve(result);
    });
    try{worker.send({buffer,ext},error=>{if(error)stop(Error('Belge okuyucusuna veri gönderilemedi.'));});}
    catch{stop(Error('Belge okuyucusuna veri gönderilemedi.'));}
  });
}
async function readFile(filename,access) {
  if(access?.mode)return access.read(filename);
  const stat=await fs.lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink()) throw Error('Normal bir dosya seçin.');
  if(stat.size>MAX_FILE) throw Error('Dosya 10 MB sınırını aşıyor.');
  const file=await fs.open(filename,'r');
  try {const buffer=Buffer.alloc(MAX_FILE+1);const {bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>MAX_FILE)throw Error('Dosya 10 MB sınırını aşıyor.');return buffer.subarray(0,bytesRead);} finally {await file.close();}
}
async function inspectFile(filename,policy,access,{signal}={}) {
  if(signal?.aborted)throw Error('Belge okuma iptal edildi.');
  const buffer=await readFile(filename,access);
  const ext=path.basename(filename)==='.env'?'.env':path.extname(filename).toLowerCase();
  const text=await extract(buffer,ext,{signal});
  if(signal?.aborted)throw Error('Belge okuma iptal edildi.');
  if(!text.trim()&&ext==='.pdf') throw Error('PDF içinde metin bulunamadı. Görüntü belgeleri OCR gerektirir.');
  return {buffer,matches:inspect(text,policy.enabled)};
}
async function scanDirectory(root,policy,{signal,onProgress=()=>{},access}={}) {
  const start=Date.now();
  if(!access?.mode){const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Normal bir klasör yolu girin.');}
  const result={root,files:0,skipped:0,errors:0,findings:[],issues:[],truncated:false,cancelled:false,policy:structuredClone(policy)};
  let visited=0,bytes=0;const queue=[root];
  while(queue.length&&!result.truncated&&!signal?.aborted) {
    const dir=queue.pop();let directory;
    try {
      if(access?.mode){const listing=await access.list(dir);directory=listing.entries;if(listing.truncated)result.truncated=true;}
      else{const current=await fs.lstat(dir);if(current.isSymbolicLink()){result.skipped++;continue;}directory=await fs.opendir(dir);}
    }catch(error){if(dir===root)throw error;result.errors++;if(result.issues.length<50)result.issues.push({file:dir,error:error.message});continue;}
    for await(const entry of directory) {
      if(signal?.aborted) break;
      if(++visited>20000||result.files>=3000||bytes>=100*1024*1024||result.findings.length>=500||Date.now()-start>5*60*1000){result.truncated=true;break;}
      const filename=path.join(dir,entry.name);
      if(entry.isSymbolicLink()){result.skipped++;continue;}
      if(entry.isDirectory()) {if(['node_modules','.git','data','$RECYCLE.BIN','System Volume Information'].includes(entry.name))result.skipped++;else queue.push(filename);continue;}
      const ext=entry.name==='.env'?'.env':path.extname(entry.name).toLowerCase();
      if(!entry.isFile()||(!TEXT.has(ext)&&!['.pdf','.docx','.xlsx'].includes(ext))){result.skipped++;continue;}
      try {const {buffer,matches}=await inspectFile(filename,policy,access,{signal});result.files++;bytes+=buffer.length;if(matches.length)result.findings.push({file:filename,matches:matches.slice(0,100),limited:matches.length>=100});}
      catch(error){if(signal?.aborted)break;result.errors++;if(result.issues.length<50)result.issues.push({file:filename,error:error.message});}
      onProgress({files:result.files,skipped:result.skipped,errors:result.errors,flagged:result.findings.length});
    }
  }
  result.cancelled=!!signal?.aborted;result.durationMs=Date.now()-start;return result;
}
module.exports={scanDirectory,inspectFile,extract,MAX_FILE};
