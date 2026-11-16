'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const receiver=path.join(__dirname,'../.build/kalkan-driver/PipeTransportTest.exe');
test('Client lifecycle denies driver requests without central entitlement and waits for receiver shutdown',{skip:process.platform!=='win32'||!fs.existsSync(receiver),timeout:10000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-driver-lifecycle-')),{createApp}=require('../server');let app;
 t.after(async()=>{await app?.close();fs.rmSync(dir,{recursive:true,force:true});});
 app=createApp({dataDir:dir,driverReceiverPath:receiver,env:{}});
 a.equal(app.driverStatus().protectionActive,false);
 const deadline=Date.now()+5000;
 while(app.driverStatus().receiverState!=='stopped'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
 a.equal(app.driverStatus().receiverState,'stopped');a.equal(app.driverStatus().exitCode,1,'Local policy must not authorize a kernel scan');
 await app.close();app=createApp({dataDir:dir,env:{}});a.equal(app.driverStatus().receiverState,'disabled');await app.close();
});
