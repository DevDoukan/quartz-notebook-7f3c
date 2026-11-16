'use strict';
process.once('message',async workerData=>{
 try {
  const buffer=Buffer.from(workerData.buffer);
  const text=await require('./document-readers').readDocument(buffer,workerData.ext);
  if(text.length>4*1024*1024) throw Error('Belgeden çıkarılan metin 4 MB sınırını aştı.');
  process.send({text},()=>process.exit(0));
 } catch(error) {
  process.send({error:'Belge okunamadı. '+(error.safeForUser?error.message:'Şifreli, bozuk veya desteklenmeyen içerik olabilir.')},()=>process.exit(0));
 }
});
