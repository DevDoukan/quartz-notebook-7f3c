'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{DriverScanner}=require('../agent/driver-scanner.cjs');
function chunk(text,{id=1n,offset=0n,size=BigInt(Buffer.byteLength(text)),generation=1n,identity=1}={}){
 const content=Buffer.from(text),b=Buffer.alloc(80+content.length);b.writeUInt32LE(2);b.writeUInt32LE(b.length,4);b.writeUInt32LE(4,8);b.writeUInt32LE(content.length,12);b.writeBigUInt64LE(id,16);b.writeBigUInt64LE(1n,24);b.writeBigUInt64LE(generation,32);b[48]=identity;b.writeBigUInt64LE(offset,64);b.writeBigUInt64LE(size,72);content.copy(b,80);return b;
}
const policy=()=>({revision:'1',mode:'block',enabled:['card']});
test('concurrent files may arrive out of global ID order while replays and per-file reversal are denied',async()=>{
 const s=new DriverScanner({getPolicy:policy,scan:async()=>false});
 await s.accept(chunk('a',{id:2n,identity:2,size:2n}));
 await s.accept(chunk('a',{id:1n,identity:1,size:2n}));
 a.equal((await s.accept(chunk('b',{id:4n,identity:1,size:2n,offset:1n}))).readUInt32LE(12),1);
 a.equal((await s.accept(chunk('b',{id:3n,identity:2,size:2n,offset:1n}))).readUInt32LE(12),1);
 a.equal((await s.accept(chunk('a',{id:3n,identity:3}))).readUInt32LE(12),2);
 await s.accept(chunk('a',{id:20n,identity:4,size:2n}));
 a.equal((await s.accept(chunk('b',{id:19n,identity:4,size:2n,offset:1n}))).readUInt32LE(12),2);
 await s.accept(chunk('a',{id:2048n,identity:5}));
 a.equal((await s.accept(chunk('a',{id:1024n,identity:6}))).readUInt32LE(12),2);
 a.ok(s.seenIds.size<=1024);s.close();a.equal(s.seenIds.size,0);
});
test('driver transport agrees with the native 10 MiB file bound',()=>{
 const {decode}=require('../agent/driver-scanner.cjs');
 a.equal(decode(chunk('a',{size:10n*1024n*1024n})).size,10n*1024n*1024n);
 a.throws(()=>decode(chunk('a',{size:10n*1024n*1024n+1n})),/Invalid request/);
});
test('closing the scanner aborts its active parser and never returns a clean completion',async()=>{
 let started=false,aborted=false;
 const s=new DriverScanner({getPolicy:policy,scan:async(bytes,enabled,{signal})=>{
  started=true;await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));return false;
 }});
 const pending=s.accept(chunk('ordinary text'));a.equal(started,true);s.close();
 const reply=await pending;a.equal(aborted,true);a.equal(reply.readUInt32LE(12),2);a.equal(reply.readBigUInt64LE(40),0n);a.equal(s.allocated,0);
});
test('document parser receives only the remaining whole-file budget',async()=>{
 let now=100,received;const s=new DriverScanner({getPolicy:policy,clock:()=>now,scan:async(bytes,enabled,options)=>{received=options.timeoutMs;return false;}});
 await s.accept(chunk('a',{size:2n}));now=1600;
 const result=await s.accept(chunk('b',{id:2n,offset:1n,size:2n}));
 a.equal(received,500);a.equal(result.readUInt32LE(12),1);s.close();
});
test('driver scanner identifies Office bytes, scans Word comments and Excel cells, and blocks ambiguous archives',async()=>{
 const JSZip=require('jszip');
 async function archive(files){const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');for(const [name,value]of Object.entries(files))zip.file(name,value);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
 const s=new DriverScanner({getPolicy:policy});let id=1n;
 async function scan(bytes){const b=chunk('x',{id:id++});const request=Buffer.concat([b.subarray(0,80),bytes]);request.writeUInt32LE(request.length,4);request.writeUInt32LE(bytes.length,12);request.writeBigUInt64LE(BigInt(bytes.length),72);return s.accept(request);}
 const word=await archive({'word/document.xml':'<document><p><r><t>ordinary text</t></r></p></document>','word/comments.xml':'<comments><p><r><t>42424242</t></r><r><rPr lang="tr"/><t>42424242</t></r></p></comments>'});
 const found=await scan(word);a.equal(found.readUInt32LE(12),2);a.equal(found.readBigUInt64LE(40),1n);
 const clean=await scan(await archive({'word/document.xml':'<document><p><t>ordinary text</t></p></document>'}));a.equal(clean.readUInt32LE(12),1);a.equal(clean.readBigUInt64LE(40),1n);
 const excel=await scan(await archive({'xl/workbook.xml':'<workbook/>','xl/worksheets/sheet1.xml':'<worksheet><c t="inlineStr"><is><t>4242424242424242</t></is></c></worksheet>'}));a.equal(excel.readUInt32LE(12),2);a.equal(excel.readBigUInt64LE(40),1n);
 for(const files of [{'word/document.xml':'<document/>','xl/workbook.xml':'<workbook/>'},{'word/document.xml':'<document/>','word/media/image.png':'fake image'},{'word/document.xml':'<!DOCTYPE document [<!ENTITY x "secret">]><document>&x;</document>'}]){
  const denied=await scan(await archive(files));a.equal(denied.readUInt32LE(12),2);a.equal(denied.readBigUInt64LE(40),0n);
 }
 s.close();
});
test('driver buffer scanner finds sensitive data across chunks and only completes whole-file clean results',async()=>{
 const s=new DriverScanner({getPolicy:policy});
 const first=await s.accept(chunk('42424242',{size:16n}));a.equal(first.readUInt32LE(12),1);a.equal(first.readBigUInt64LE(40),0n);
 const last=await s.accept(chunk('42424242',{id:2n,offset:8n,size:16n}));a.equal(last.readUInt32LE(12),2);a.equal(last.readBigUInt64LE(40),1n);a.equal(s.allocated,0);
 const clean=await s.accept(chunk('ordinary text',{id:3n}));a.equal(clean.readUInt32LE(12),1);a.equal(clean.readBigUInt64LE(40),1n);
 a.equal((await s.accept(chunk('ordinary text',{id:3n}))).readUInt32LE(12),2);
 const binary=await s.accept(chunk('a\0b',{id:4n}));a.equal(binary.readUInt32LE(12),2);a.equal(binary.readBigUInt64LE(40),0n);
 s.close();
});
test('driver buffer scanner rejects gaps, policy changes, timeout and malformed input',async()=>{
 let now=0,current=policy();const s=new DriverScanner({getPolicy:()=>current,clock:()=>now});
 await s.accept(chunk('a',{size:2n}));a.equal((await s.accept(chunk('b',{id:2n,size:2n,offset:0n}))).readUInt32LE(12),2);
 await s.accept(chunk('a',{id:3n,size:2n}));now=2000;a.equal((await s.accept(chunk('b',{id:4n,size:2n,offset:1n}))).readUInt32LE(12),2);
 await s.accept(chunk('a',{id:5n,size:2n}));current={...current,enabled:['iban']};a.equal((await s.accept(chunk('b',{id:6n,size:2n,offset:1n}))).readUInt32LE(12),2);
 await a.rejects(s.accept(Buffer.alloc(80)));a.equal(s.allocated,0);s.close();
});
test('expired in-flight parsers retain admission slots and cannot allow after cancellation',async()=>{
 let now=0;const waiting=[];const s=new DriverScanner({getPolicy:policy,clock:()=>now,scan:()=>new Promise(resolve=>waiting.push(resolve))});
 const pending=[];for(let i=1;i<=8;i++)pending.push(s.accept(chunk('a',{id:BigInt(i),identity:i})));
 now=2001;const blocked=await s.accept(chunk('a',{id:9n,identity:9}));a.equal(blocked.readUInt32LE(12),2);a.equal(s.allocated,8);
 waiting.forEach(resolve=>resolve(false));for(const response of await Promise.all(pending))a.equal(response.readUInt32LE(12),2);
 a.equal(s.allocated,0);s.close();
});
