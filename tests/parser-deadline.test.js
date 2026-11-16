'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{extract}=require('../scanner');
test('document reader validates its time budget and terminates a worker that exceeds it',async()=>{
 for(const timeoutMs of [0,-1,NaN,Infinity,30001,1.5])await assert.rejects(extract(Buffer.from('text'),'.txt',{timeoutMs}),/süresi/);
 const zip=new(require('jszip'))();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<document><p>ordinary text</p></document>');
 const buffer=await zip.generateAsync({type:'nodebuffer'});
 await assert.rejects(extract(buffer,'.docx',{timeoutMs:1}),/süresi aşıldı/);
 // No sleep/retry: rejected timed-out calls must have released their actual
 // child-process slots before the next parser operation can start.
 for(let round=0;round<3;round++){
  const results=await Promise.allSettled([extract(buffer,'.docx',{timeoutMs:1}),extract(buffer,'.docx',{timeoutMs:1})]);
  for(const result of results){assert.equal(result.status,'rejected');assert.match(result.reason.message,/süresi aşıldı/);}
 }
 assert.match(await extract(buffer,'.docx'),/ordinary text/);
 const preCancelled=new AbortController();preCancelled.abort();
 await assert.rejects(extract(buffer,'.docx',{signal:preCancelled.signal}),/iptal/);
 const running=new AbortController(),pending=extract(buffer,'.docx',{signal:running.signal});running.abort();
 await assert.rejects(pending,/iptal/);
 assert.match(await extract(buffer,'.docx'),/ordinary text/);
});
