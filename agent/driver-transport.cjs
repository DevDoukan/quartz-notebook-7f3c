'use strict';
const {DriverScanner}=require('./driver-scanner.cjs');
// Private inherited pipes only. No TCP endpoint, filesystem pipe name or
// client-selected policy is exposed. The native receiver sends one frame,
// waits for a reply, then sends the next request.
function attachDriverTransport({input,output,central,onClose=()=>{}}){
 if(typeof central?.scanPolicy!=='function')throw Error('Authenticated central link required');
 const scanner=new DriverScanner({getPolicy:()=>central.scanPolicy()});
 let buffer=Buffer.alloc(0),busy=false,closed=false,timer=null;
 function close(){
  if(closed)return;closed=true;clearTimeout(timer);scanner.close();buffer.fill(0);buffer=Buffer.alloc(0);
  input.removeListener('data',receive);input.destroy();output.destroy();onClose();
 }
 async function processFrame(frame){
  busy=true;
  if(!timer){timer=setTimeout(close,2000);timer.unref();}
  try{
   let response;
   if(frame.length===16){
    if(frame.readUInt32LE()!==2||frame.readUInt32LE(4)!==16||frame.readUInt32LE(8)!==6||frame.readUInt32LE(12)!==0)throw Error('Invalid control request');
    response=Buffer.alloc(32);response.writeUInt32LE(2);response.writeUInt32LE(32,4);response.writeUInt32LE(5,8);response.writeUInt32LE(2,12);
    let policy;try{policy=central.scanPolicy();}catch{}
    if(policy){const revision=BigInt(policy.revision);if(revision<=0n||revision>0x7fffffffffffffffn)throw Error('Invalid policy revision');response.writeUInt32LE(1,12);response.writeBigUInt64LE(revision,16);}
   }else response=await scanner.accept(frame);
   if(closed)return;
   const packet=Buffer.alloc(4+response.length);packet.writeUInt32LE(response.length);response.copy(packet,4);
   // Busy remains set until the write callback. A second request before its
   // preceding reply has been written is a protocol violation.
   await new Promise((resolve,reject)=>output.write(packet,error=>error?reject(error):resolve()));
  }catch{close();}finally{frame.fill(0);clearTimeout(timer);timer=null;busy=false;}
 }
 function receive(chunk){
  if(closed)return;
  if(!timer){timer=setTimeout(close,2000);timer.unref();}
  if(busy||!Buffer.isBuffer(chunk)||buffer.length+chunk.length>80+65536+4){close();return;}
  const next=Buffer.concat([buffer,chunk]);buffer.fill(0);buffer=next;
  if(buffer.length<4)return;
  const length=buffer.readUInt32LE();
  if((length!==16&&length<80)||length>80+65536||buffer.length>length+4){close();return;}
  if(buffer.length!==length+4)return;
  const frame=Buffer.from(buffer.subarray(4));buffer.fill(0);buffer=Buffer.alloc(0);
  void processFrame(frame);
 }
 input.on('data',receive);input.once('error',close);input.once('end',close);input.once('close',close);output.once('error',close);output.once('close',close);
 return {close};
}
function startDriverReceiver({receiverPath,central}){
 const path=require('node:path');
 if(typeof central?.scanPolicy!=='function')throw Error('Authenticated central link required');
 if(!path.isAbsolute(receiverPath)||path.extname(receiverPath).toLowerCase()!=='.exe')throw Error('An absolute trusted receiver executable is required');
 const child=require('node:child_process').spawn(receiverPath,['--stdio'],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{SystemRoot:process.env.SystemRoot}});
 let failure=null,settle;
 const done=new Promise(resolve=>{settle=resolve;});
 const transport=attachDriverTransport({input:child.stdout,output:child.stdin,central,onClose:()=>child.kill()});
 child.once('error',error=>{failure=error.code||'spawn-failed';transport.close();});
 child.once('exit',()=>transport.close());
 child.once('close',(code,signal)=>{transport.close();settle({code,signal,error:failure});});
 return {close:()=>{transport.close();return done;},done,processId:child.pid};
}
module.exports={attachDriverTransport,startDriverReceiver};
