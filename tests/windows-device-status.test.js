'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{devices}=require('../windows');
test('partial USB inventory preserves unknown protection and both failure warnings',{skip:process.platform!=='win32'},async()=>{
 let calls=0;
 const result=await devices({executeFile:async(file,args)=>{
  if(++calls===1){
   const script=args.at(-1);assert.equal((script.match(/Get-CimInstance/g)||[]).length,1);assert.doesNotMatch(script,/Get-Disk/);assert.match(script,/-OperationTimeoutSec 3/);
   return {stdout:JSON.stringify({devices:[{DeviceID:'Z:'}],supported:true,writeProtected:null,writeProtectionKnown:false})};
  }
  throw Error('Storage timeout');
 }});
 assert.equal(result.devices.length,1);assert.equal(result.writeProtected,null);assert.equal(result.writeProtectionKnown,false);
 assert.match(result.warning,/bilinmiyor/);assert.match(result.warning,/Ek USB/);
});
