'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {verifyDriverBuild}=require('../tools/verify-driver-build.cjs');
test('driver build evidence rejects stale source, altered binaries and substituted artifact lists',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-driver-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const artifacts=['KalkanFilter.sys','PortProbe.exe','ProtocolTest.exe','ScanReceiver.exe','PipeTransportTest.exe'].map(name=>{const bytes=Buffer.from(name);fs.writeFileSync(path.join(dir,name),bytes);return {name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 const report={passed:true,protocolTestPassed:true,runCodeAnalysis:true,sourceFingerprint:'current',artifacts};
 a.equal(verifyDriverBuild(report,dir,'current').passed,true);
 a.throws(()=>verifyDriverBuild(report,dir,'old'),/stale/);
 for(const patch of [{passed:false},{protocolTestPassed:false},{runCodeAnalysis:false},{artifacts:artifacts.slice(1)},{artifacts:[artifacts[0],...artifacts.slice(0,4)]}])a.throws(()=>verifyDriverBuild({...report,...patch},dir,'current'));
 fs.writeFileSync(path.join(dir,'KalkanFilter.sys'),Buffer.alloc(artifacts[0].bytes,1));
 a.throws(()=>verifyDriverBuild(report,dir,'current'),/hash mismatch/);
});
