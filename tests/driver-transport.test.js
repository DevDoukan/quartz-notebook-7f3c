'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{PassThrough}=require('node:stream'),{once}=require('node:events');
const {attachDriverTransport}=require('../agent/driver-transport.cjs');
test('receiver lifecycle reports the actual child exit and close waits for process completion',{skip:process.platform!=='win32'||!require('node:fs').existsSync(require('node:path').join(__dirname,'../.build/kalkan-driver/PipeTransportTest.exe')),timeout:10000},async()=>{
 const {startDriverReceiver}=require('../agent/driver-transport.cjs');
 const receiver=startDriverReceiver({receiverPath:require('node:path').join(__dirname,'../.build/kalkan-driver/PipeTransportTest.exe'),central:{scanPolicy:()=>({revision:1,mode:'block',enabled:['card']})}});
 a.ok(receiver.processId>0);const result=await receiver.done;a.equal(result.code,0);a.equal(result.error,null);a.deepEqual(await receiver.close(),result);
});
test('native Windows pipe roundtrip uses the same receiver code and parses a real scanner reply',{skip:process.platform!=='win32'||!require('node:fs').existsSync(require('node:path').join(__dirname,'../.build/kalkan-driver/PipeTransportTest.exe')),timeout:10000},async()=>{
 const child=require('node:child_process').spawn(require('node:path').join(__dirname,'../.build/kalkan-driver/PipeTransportTest.exe'),[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const transport=attachDriverTransport({input:child.stdout,output:child.stdin,central:{scanPolicy:()=>({revision:1,mode:'block',enabled:['card']})}});
 const [code]=await once(child,'exit');transport.close();a.equal(code,0);
});
test('native pipe rejects mismatched response identity and times out an unanswered request',{skip:process.platform!=='win32'||!require('node:fs').existsSync(require('node:path').join(__dirname,'../.build/kalkan-driver/PipeTransportTest.exe')),timeout:10000},async()=>{
 for(const respond of [true,false]){
  const child=require('node:child_process').spawn(require('node:path').join(__dirname,'../.build/kalkan-driver/PipeTransportTest.exe'),[],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  child.stdin.on('error',()=>{});
  let incoming=Buffer.alloc(0),scanSeen=false;
  child.stdout.on('data',part=>{
   incoming=Buffer.concat([incoming,part]);if(!respond||incoming.length<4||incoming.length<incoming.readUInt32LE()+4)return;
   const length=incoming.readUInt32LE();incoming=Buffer.alloc(0);
   if(length===16){const ready=Buffer.alloc(36);ready.writeUInt32LE(32);ready.writeUInt32LE(2,4);ready.writeUInt32LE(32,8);ready.writeUInt32LE(5,12);ready.writeUInt32LE(1,16);ready.writeBigUInt64LE(1n,20);child.stdin.write(ready);}
   else{scanSeen=true;const wrong=Buffer.alloc(52);wrong.writeUInt32LE(48);wrong.writeUInt32LE(2,4);wrong.writeUInt32LE(48,8);wrong.writeUInt32LE(2,12);wrong.writeUInt32LE(1,16);child.stdin.write(wrong);}
  });
  child.stdout.resume();const [code]=await once(child,'exit');child.stdin.destroy();a.equal(code,1);if(respond)a.equal(scanSeen,true);
 }
});
function request(){const b=Buffer.alloc(81);b.writeUInt32LE(2);b.writeUInt32LE(81,4);b.writeUInt32LE(4,8);b.writeUInt32LE(1,12);for(const off of [16,24,32,72])b.writeBigUInt64LE(1n,off);b[48]=1;b[80]=97;const frame=Buffer.alloc(85);frame.writeUInt32LE(81);b.copy(frame,4);return frame;}
test('policy control channel reports unavailable on missing entitlement or policy provider error',async()=>{
 for(const getPolicy of [()=>({revision:7,mode:'block',enabled:['card']}),()=>null,()=>{throw Error('expired');}]){
  const input=new PassThrough(),output=new PassThrough(),link=attachDriverTransport({input,output,central:{scanPolicy:getPolicy}});
  const query=Buffer.alloc(20);query.writeUInt32LE(16);query.writeUInt32LE(2,4);query.writeUInt32LE(16,8);query.writeUInt32LE(6,12);
  const ready=once(output,'data');input.write(query);const [response]=await ready;
  a.equal(response.readUInt32LE(),32);a.equal(response.readUInt32LE(12),5);
  let valid=false;try{valid=!!getPolicy();}catch{}
  a.equal(response.readUInt32LE(16),valid?1:2);a.equal(response.readBigUInt64LE(20),valid?7n:0n);link.close();
 }
});
test('private driver transport accepts fragmented binary frames and gates clean replies on central authorization',async()=>{
 for(const allowed of [true,false]){
  const input=new PassThrough(),output=new PassThrough();const link=attachDriverTransport({input,output,central:{scanPolicy:()=>allowed?{revision:1,mode:'block',enabled:['card']}:null}});
  const result=once(output,'data'),bytes=request();input.write(bytes.subarray(0,2));input.write(bytes.subarray(2,19));input.write(bytes.subarray(19));
  const [reply]=await result;a.equal(reply.readUInt32LE(0),48);a.equal(reply.readUInt32LE(16),allowed?1:2);a.equal(reply.readBigUInt64LE(44),allowed?1n:0n);link.close();
 }
});
test('private driver transport closes on unbounded or malformed frames without producing a reply',()=>{
 for(const bytes of [Buffer.alloc(4,255),Buffer.alloc(200)]){
  const input=new PassThrough(),output=new PassThrough();let closed=0,replies=0;output.on('data',()=>replies++);
  attachDriverTransport({input,output,central:{scanPolicy:()=>null},onClose:()=>closed++});input.write(bytes);a.equal(closed,1);a.equal(replies,0);
 }
});
