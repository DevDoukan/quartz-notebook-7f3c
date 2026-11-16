'use strict';
function officeFormat(buffer){
 return new Promise((resolve,reject)=>require('yauzl').fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
  if(error)return reject(error);const names=new Set();let total=0,count=0,done=false;
  const fail=error=>{if(!done){done=true;zip.close();reject(error);}};
  zip.on('error',fail);
  zip.on('entry',entry=>{try{
   if(++count>2000||entry.fileName.length>512||entry.generalPurposeBitFlag&1||entry.uncompressedSize>8*1024*1024||(total+=entry.uncompressedSize)>32*1024*1024||names.has(entry.fileName))throw Error('Unsupported archive');
   names.add(entry.fileName);
   if(!entry.fileName.endsWith('/')&&!/\.(xml|rels)$/i.test(entry.fileName))throw Error('Archive requires a binary content reader');
   zip.readEntry();
  }catch(error){fail(error);}});
  zip.on('end',()=>{
   if(done)return;done=true;
   const word=names.has('word/document.xml'),excel=names.has('xl/workbook.xml');
   if(!names.has('[Content_Types].xml')||word===excel)return reject(Error('Ambiguous or unsupported Office archive'));
   resolve(word?'.docx':'.xlsx');
  });zip.readEntry();
 }));
}
module.exports={officeFormat};
