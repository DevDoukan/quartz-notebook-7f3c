'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{fingerprint}=require('./source-fingerprint.cjs');
const root=path.join(__dirname,'..'),before=fingerprint(root),steps=[];
const {checks,complete}=require('./release-checks.cjs');
for(const [name,args]of checks){
 const started=Date.now(),result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
 steps.push({name,passed:result.status===0,status:result.status,durationMs:Date.now()-started,stdout:result.stdout,stderr:result.stderr,error:result.error?.message});
 console.log(`${result.status===0?'PASS':'FAIL'} ${name}`);if(result.status!==0)break;
}
const after=fingerprint(root),report={version:require('../package.json').version,sourceFingerprint:before.sha256,sourceFiles:before.fileCount,createdAt:new Date().toISOString(),unchangedDuringTests:before.sha256===after.sha256,passed:complete(steps)&&before.sha256===after.sha256,steps};
const output=path.join(root,'.test-artifacts','release-tests.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
