'use strict';
const {extract,MAX_FILE}=require('../scanner'),{inspect,rules}=require('../detector');
const VERSION=2,HEADER=80,CHUNK=65536,BUDGET=2000;
function decode(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<HEADER||bytes.length>HEADER+CHUNK)throw Error('Invalid request size');
 const length=bytes.readUInt32LE(12),id=bytes.readBigUInt64LE(16),revision=bytes.readBigUInt64LE(24),generation=bytes.readBigUInt64LE(32),offset=bytes.readBigUInt64LE(64),size=bytes.readBigUInt64LE(72);
 if(bytes.readUInt32LE(0)!==VERSION||bytes.readUInt32LE(4)!==bytes.length||bytes.readUInt32LE(8)!==4||length!==bytes.length-HEADER||!id||!revision||!generation||size>BigInt(MAX_FILE)||offset>size||BigInt(length)>size-offset||(!length&&size!==0n)||!bytes.subarray(48,64).some(v=>v))throw Error('Invalid request');
 return {id,revision,generation,offset,size,identity:bytes.subarray(40,64).toString('hex'),content:bytes.subarray(HEADER)};
}
function reply(request,decision=2,complete=false){
 const out=Buffer.alloc(48);out.writeUInt32LE(VERSION,0);out.writeUInt32LE(48,4);out.writeUInt32LE(2,8);out.writeUInt32LE(decision,12);
 out.writeBigUInt64LE(request.id,16);out.writeBigUInt64LE(request.revision,24);out.writeBigUInt64LE(request.generation,32);out.writeBigUInt64LE(complete?1n:0n,40);return out;
}
async function scanContent(buffer,enabled,{timeoutMs,signal}){
 const started=performance.now();
 // Identify supported content from bytes; never reopen a user-mode path.
 let ext='.txt';const pdf=buffer.indexOf(Buffer.from('%PDF-'));
 if(pdf>=0&&pdf<1024)ext='.pdf';
 else if(buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,3,4])))ext=await require('./driver-format.cjs').officeFormat(buffer);
 const remaining=Math.floor(timeoutMs-(performance.now()-started));
 if(remaining<1)throw Error('Scan deadline expired');
 const text=await extract(buffer,ext,{timeoutMs:remaining,signal});
 if(ext==='.pdf'&&!text.trim())throw Error('OCR required');
 return inspect(text,enabled).length>0;
}
// The caller must supply an already authenticated, verified policy snapshot.
// This component is not a port listener or a policy signature verifier.
class DriverScanner {
 constructor({getPolicy,clock=()=>performance.now(),scan=scanContent}={}){
  if(typeof getPolicy!=='function')throw Error('Verified policy provider required');
  this.getPolicy=getPolicy;this.clock=clock;this.scan=scan;this.sessions=new Map();this.lastId=0n;this.seenIds=new Set();this.closed=false;this.allocated=0;
 }
 release(state){if(!state.released){state.buffer.fill(0);state.released=true;this.allocated--;}}
 drop(key){const state=this.sessions.get(key);if(state){state.buffer.fill(0);state.cancelled=true;this.sessions.delete(key);state.controller.abort();if(!state.busy)this.release(state);}}
 close(){this.closed=true;for(const key of this.sessions.keys())this.drop(key);this.seenIds.clear();}
 async accept(bytes){
  const request=decode(bytes),blocked=()=>reply(request),now=this.clock();
  for(const [key,state]of this.sessions)if(now<state.started||now-state.started>=BUDGET)this.drop(key);
  const key=request.identity+':'+request.revision+':'+request.generation;
  // Different kernel threads can deliver assigned IDs out of order. Retain
  // a bounded replay window; per-file order remains strict below.
  if(this.closed||this.seenIds.has(request.id)||request.id+1024n<=this.lastId)return blocked();
  if(request.id>this.lastId){this.lastId=request.id;for(const id of this.seenIds)if(id+1024n<=this.lastId)this.seenIds.delete(id);}
  this.seenIds.add(request.id);
  let policy;try{policy=this.getPolicy();}catch{this.drop(key);return blocked();}
  const valid=p=>p&&String(p.revision)===String(request.revision)&&['block','audit'].includes(p.mode)&&Array.isArray(p.enabled)&&p.enabled.length>0&&p.enabled.every(id=>rules.some(r=>r.id===id));
  if(!valid(policy)){this.drop(key);return blocked();}
  const policyStamp=JSON.stringify([String(policy.revision),policy.mode,policy.enabled]);
  let state=this.sessions.get(key);
  if(!state){
   if(request.offset!==0n||this.allocated>=8)return blocked();
   state={buffer:Buffer.alloc(Number(request.size)),next:0n,lastId:0n,size:request.size,started:now,policyStamp,busy:false,cancelled:false,controller:new AbortController()};this.allocated++;this.sessions.set(key,state);
  }
  if(state.busy||request.id<=state.lastId||state.size!==request.size||state.next!==request.offset||state.policyStamp!==policyStamp){this.drop(key);return blocked();}
  state.lastId=request.id;
  request.content.copy(state.buffer,Number(state.next));state.next+=BigInt(request.content.length);
  if(state.next!==state.size)return reply(request,1,false);
  state.busy=true;
  try{
   const remaining=Math.floor(BUDGET-(this.clock()-state.started));
   if(remaining<1||remaining>BUDGET)return blocked();
   const found=await this.scan(state.buffer,[...policy.enabled],{timeoutMs:remaining,signal:state.controller.signal});
   const finished=this.clock(),latest=this.getPolicy();
   if(state.cancelled||this.closed||finished<state.started||finished-state.started>=BUDGET||!valid(latest)||JSON.stringify([String(latest.revision),latest.mode,latest.enabled])!==policyStamp||typeof found!=='boolean')return blocked();
   return reply(request,found&&policy.mode==='block'?2:1,true);
  }catch{return blocked();}finally{if(this.sessions.get(key)===state)this.drop(key);this.release(state);}
 }
}
module.exports={DriverScanner,decode};
