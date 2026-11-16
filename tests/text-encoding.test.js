'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{extract}=require('../scanner'),{readDocument}=require('../document-readers'),{inspect}=require('../detector');
test('Office XML with malformed UTF8 or NUL is rejected through isolated document workers',async()=>{
 const JSZip=require('jszip');
 for(const ext of ['.docx','.xlsx'])for(const bad of [Buffer.from([0x3c,0x78,0x3e,0xc3,0x28,0x3c,0x2f,0x78,0x3e]),Buffer.from('<x>a\0b</x>')]){
  const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');
  if(ext==='.docx')zip.file('word/document.xml',bad);
  else{zip.file('xl/workbook.xml','<workbook/>');zip.file('xl/worksheets/sheet1.xml',bad);}
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await assert.rejects(extract(bytes,ext),/Belge okunamadı/);
 }
});
test('text readers reject invalid Unicode and embedded NUL instead of replacing bytes',async()=>{
 for(const bytes of [Buffer.from([0xc3,0x28]),Buffer.from([0xff,0xfe,0x61]),Buffer.from([0xff,0xfe,0,0xd8]),Buffer.from([0xfe,0xff,0xdc,0]),Buffer.from([0xff,0xfe,0,0]),Buffer.from('a\0b')]){
  await assert.rejects(extract(bytes,'.txt'),/kodlama/);await assert.rejects(readDocument(bytes,'.txt'),/kodlama/);
 }
});
test('UTF16 little and big endian readers preserve sensitive digits',async()=>{
 const text='Türkçe 4242424242424242',le=Buffer.from(text,'utf16le'),be=Buffer.from(le);be.swap16();
 for(const bytes of [Buffer.concat([Buffer.from([255,254]),le]),Buffer.concat([Buffer.from([254,255]),be])]){
  const result=await extract(bytes,'.txt');assert.equal(result,text);assert.equal(inspect(result,['card']).length,1);assert.equal(await readDocument(bytes,'.txt'),text);
 }
});
