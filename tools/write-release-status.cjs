'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {fingerprint}=require('./source-fingerprint.cjs'),{complete}=require('./release-checks.cjs');
const root=path.resolve(__dirname,'..'),read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
function artifact(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid release artifact');return {path:file,bytes:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};}
function generate(){
 const output=path.join(root,'release','RELEASE-STATUS.json');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({readyForSale:false,reportComplete:false,checkedAt:new Date().toISOString(),note:'Release audit started; no completed result recorded for this invocation.'},null,2)+'\n');
 const before=fingerprint(root).sha256,version=read('package.json').version;
 const gateRun=spawnSync(process.execPath,[path.join(__dirname,'commercial-gate.cjs')],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
 if(gateRun.error||![0,1].includes(gateRun.status))throw Error('Commercial gate could not finish');
 const gates=read('.test-artifacts/commercial-readiness.json');
 if(gates.version!==version||!Array.isArray(gates.gates))throw Error('Invalid commercial gate report');
 const tests=read('.test-artifacts/release-tests.json'),sourceCurrent=tests.sourceFingerprint===before;
 const packages=[['client','machine'],['server','server']].map(([role,kind])=>{const build=read('.build/latest-'+kind+'-build.json');return {role,version:build.version,installer:build.installer,...artifact(build.installer)};});
 const central=read('.build/latest-central-build.json'),license=artifact(path.join(root,'release','Kalkan-License-Service-'+version+'.zip'));
 let reboot=null,driver=null;
 try{reboot=require('./reboot-evidence.cjs').assessReboot(read('.test-artifacts/host-before-reboot.json'),read('.test-artifacts/host-after-reboot.json'),version);}catch(error){reboot={passed:false,reason:error.message};}
 try{const report=read('.test-artifacts/kalkan-driver-build.json');driver={...require('./verify-driver-build.cjs').verifyDriverBuild(report,path.join(root,'.build','kalkan-driver'),before),loaded:false,protectionAcceptance:false};}catch(error){driver={passed:false,reason:error.message,loaded:false,protectionAcceptance:false};}
 if(fingerprint(root).sha256!==before)throw Error('Source changed while writing release status');
 const report={version,reportComplete:true,checkedAt:new Date().toISOString(),sourceFingerprint:before,readyForSale:gates.readyForSale===true&&gates.gates.every(g=>g.passed===true)&&sourceCurrent&&tests.passed===true&&complete(tests.steps),
  releaseTestsPassed:tests.passed===true&&complete(tests.steps),testsRunOnCurrentSource:sourceCurrent,sourceModifiedAfterRecordedTests:!sourceCurrent,
  unitTests:Number(tests.steps?.[0]?.stdout?.match(/tests (\d+)/)?.[1])||null,recordedTestVersion:tests.version,
  releaseSteps:tests.steps.map(({name,passed})=>({name,passed})),packages,centralArchive:artifact(central.archive),licenseService:license,
  hostRebootObservation:reboot,driverBuild:driver,openGates:gates.gates.filter(g=>g.passed!==true).map(({name,reason})=>({name,reason:reason||null})),
  note:'Build integrity and source tests do not prove real Windows service, driver, USB or commercial acceptance.'};
 const out=path.join(root,'release','RELEASE-STATUS.json'),temp=out+'.tmp';fs.writeFileSync(temp,JSON.stringify(report,null,2)+'\n');fs.renameSync(temp,out);
 return report;
}
if(require.main===module){try{const r=generate();console.log(JSON.stringify({version:r.version,testsRunOnCurrentSource:r.testsRunOnCurrentSource,readyForSale:r.readyForSale,openGates:r.openGates.length}));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={generate};
