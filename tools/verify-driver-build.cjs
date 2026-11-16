'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const required=['KalkanFilter.sys','PortProbe.exe','ProtocolTest.exe','ScanReceiver.exe','PipeTransportTest.exe'];
function verifyDriverBuild(report,directory,sourceFingerprint){
 if(!report||report.passed!==true||report.protocolTestPassed!==true||report.runCodeAnalysis!==true||report.sourceFingerprint!==sourceFingerprint)throw Error('Driver build evidence is missing, stale or unsuccessful.');
 if(!Array.isArray(report.artifacts)||report.artifacts.length!==required.length)throw Error('Driver artifact set mismatch.');
 for(const name of required){
  const entries=report.artifacts.filter(item=>item?.name===name);
  if(entries.length!==1)throw Error('Missing or duplicate driver artifact: '+name);
  const entry=entries[0],file=path.join(directory,name),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||stat.size!==entry.bytes||!/^([a-f0-9]{64})$/i.test(entry.sha256||''))throw Error('Driver artifact metadata mismatch: '+name);
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256.toLowerCase())throw Error('Driver artifact hash mismatch: '+name);
 }
 return {passed:true,files:required.length,scope:'Build/test artifact integrity only; no signature, loaded driver or enforcement acceptance is implied.'};
}
module.exports={verifyDriverBuild};
