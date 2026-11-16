'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{scanDirectory}=require('../scanner');
test('cancellation after a protected read prevents document parsing and is not recorded as a corrupt file',async()=>{
 const controller=new AbortController();let reads=0,progress=0;
 const entry={name:'document.docx',isSymbolicLink:()=>false,isDirectory:()=>false,isFile:()=>true};
 const access={mode:true,list:async()=>({entries:[entry,entry],truncated:false}),read:async()=>{reads++;controller.abort();return Buffer.from('not a Word document');}};
 const report=await scanDirectory('C:\\Test',{enabled:['card']},{signal:controller.signal,access,onProgress:()=>progress++});
 assert.equal(report.cancelled,true);assert.equal(reads,1);assert.equal(report.files,0);assert.equal(report.errors,0);assert.deepEqual(report.issues,[]);assert.equal(progress,0);
});
