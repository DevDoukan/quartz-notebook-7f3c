const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
async function fixture(t,options={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-api-')),app=createApp({dataDir,...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setupKey:await fs.readFile(path.join(dataDir,'setup-key.txt'),'utf8'),username:'testadmin',password:'Test-password-2026'})});
  const cookie=setup.headers.get('set-cookie').split(';')[0],state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();
  async function request(route,input,headers={}){const response=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-DLP-Token':state.token,Cookie:cookie,...headers},body:input===undefined?undefined:JSON.stringify(input)});return {status:response.status,data:await response.json()};}
  return {app,base,state,request,dataDir,cookie};
}
test('local Outlook session requires an administrator and a registered company connection',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/outlook/session',{}, {'X-DLP-Token':''})).status,403);
  const standalone=await f.request('/api/outlook/session',{});
  assert.equal(standalone.status,409);
  for(const role of ['operator','auditor']){
    const username='outlook'+role;
    assert.equal((await f.request('/api/users',{username,password:'Outlook-role-password2026',role})).status,201);
    const login=await fetch(f.base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Outlook-role-password2026'})});
    const cookie=login.headers.get('set-cookie').split(';')[0],state=await login.json();
    const result=await f.request('/api/outlook/session',{}, {Cookie:cookie,'X-DLP-Token':state.token});
    assert.equal(result.status,403);
    assert.equal('credential' in result.data,false);
  }
});
test('policies gate SMTP and attachments before transport, with persistent masked audit records',async t=>{
  const sent=[];const f=await fixture(t,{mailer:{sendMail:async msg=>sent.push(msg)},env:{DLP_SMTP_FROM:'sender@example.com'}});
  assert.equal((await f.request('/api/policy',{mode:'block',enabled:['card']})).status,200);
  const payload={channel:'email',to:'recipient@example.com',subject:'test',text:'Card: 4242424242424242'};
  const blocked=await f.request('/api/email/send',payload);assert.equal(blocked.status,422);assert.equal(sent.length,0);
  const fileBlocked=await f.request('/api/email/send',{...payload,text:'clean',files:[{name:'data.txt',data:Buffer.from('4242424242424242').toString('base64')}]});assert.equal(fileBlocked.status,422);assert.equal(sent.length,0);
  const unsupported=await f.request('/api/email/send',{...payload,text:'clean',files:[{name:'data.zip',data:'YWJj'}]});assert.equal(unsupported.status,400);assert.equal(sent.length,0);
  const encodedMail=Buffer.from('MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('Card: 4242424242424242').toString('base64'));
  const mimeBlocked=await f.request('/api/email/send',{...payload,text:'clean',files:[{name:'forwarded.eml',data:encodedMail.toString('base64')}]});assert.equal(mimeBlocked.status,422);assert.equal(sent.length,0);
  const allowed=await f.request('/api/email/send',{...payload,text:'Meeting at noon'});assert.equal(allowed.status,200);assert.equal(sent.length,1);
  await f.request('/api/policy',{mode:'audit',enabled:['card']});const audit=await f.request('/api/email/send',payload);assert.equal(audit.data.decision,'warn');assert.equal(sent.length,2);
  const current=await f.request('/api/state');assert.ok(!JSON.stringify(current.data.events).includes('4242'));assert.ok(current.data.events.some(e=>e.decision==='block'));
  const {openStore}=require('../store');const second=openStore(f.dataDir);assert.equal(second.policy().mode,'audit');assert.ok(second.events().length>=5);second.close();
});
test('request boundary rejects cross-site, missing token and spoofed host; extension key is required',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/inspect',{text:'test',channel:'web'},{'X-DLP-Token':''})).status,403);
  assert.equal((await f.request('/api/state',undefined,{Origin:'https://evil.example'})).status,403);
  const hostStatus=await new Promise((resolve,reject)=>{const req=require('node:http').get(f.base+'/api/state',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(hostStatus,403);
  assert.equal((await f.request('/api/extension/policy')).status,403);
  const headers={Origin:'chrome-extension://'+'a'.repeat(32),'X-DLP-Key':f.state.extensionKey};
  await f.request('/api/policy',{mode:'block',enabled:['card']});const result=await f.request('/api/extension/check',{text:'4242424242424242'},headers);assert.equal(result.data.decision,'block');
});
test('asynchronous scan completes and report is retrievable; invalid root is an error',async t=>{
  const f=await fixture(t);const root=path.join(f.dataDir,'fixture');await fs.mkdir(root);await fs.writeFile(path.join(root,'data.txt'),'4242424242424242');
  const start=await f.request('/api/scan',{path:root});assert.equal(start.status,202);let result;
  for(let i=0;i<100;i++){result=await f.request('/api/jobs/'+start.data.id);if(result.data.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(result.data.status,'complete');assert.equal(result.data.result.findings.length,1);assert.equal((await f.request('/api/report?id='+start.data.id)).status,200);
  const bad=await f.request('/api/scan',{path:path.join(root,'missing')});for(let i=0;i<100;i++){result=await f.request('/api/jobs/'+bad.data.id);if(result.data.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(result.data.status,'error');
});
test('application shutdown preserves a cancelled partial scan across store reopen',async t=>{
 const f=await fixture(t),root=path.join(f.dataDir,'shutdown-scan');await fs.mkdir(root);
 const zip=new(require('jszip'))();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<document><p>ordinary text</p></document>');
 const bytes=await zip.generateAsync({type:'nodebuffer'});
 await Promise.all(Array.from({length:30},(_,i)=>fs.writeFile(path.join(root,i+'.docx'),bytes)));
 const start=await f.request('/api/scan',{path:root});assert.equal(start.status,202);
 await f.app.close();
 const reopened=require('../store').openStore(f.dataDir);
 try{
  const report=reopened.getScan(start.data.id);assert.ok(report);assert.equal(report.cancelled,true);assert.ok(report.files<30);
  assert.equal(reopened.scanSummaries().find(row=>row.id===start.data.id).cancelled,1);
 }finally{reopened.close();}
});

test('USB flow copies exactly inspected bytes, blocks sensitive data and preserves existing targets',async t=>{
  const removable=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-usb-'));t.after(()=>fs.rm(removable,{recursive:true,force:true}));
  const f=await fixture(t,{deviceProvider:async()=>({devices:[{DeviceID:removable}],supported:true,writeProtected:false})});
  const source=path.join(f.dataDir,'data.txt');await fs.writeFile(source,'4242424242424242');await f.request('/api/policy',{mode:'block',enabled:['card']});
  assert.equal((await f.request('/api/usb/copy',{source,drive:removable})).status,422);assert.equal((await fs.readdir(removable)).length,0);
  await fs.writeFile(source,'Clean meeting agenda');const copied=await f.request('/api/usb/copy',{source,drive:removable});assert.equal(copied.status,200);assert.equal(await fs.readFile(path.join(removable,'data.txt'),'utf8'),'Clean meeting agenda');
  await fs.writeFile(source,'New clean data');assert.equal((await f.request('/api/usb/copy',{source,drive:removable})).status,400);assert.equal(await fs.readFile(path.join(removable,'data.txt'),'utf8'),'Clean meeting agenda');
  assert.equal((await f.request('/api/usb/copy',{source,drive:'Z:'})).status,400);
});
test('dashboard sends summaries instead of complete historical findings',async t=>{
  const f=await fixture(t);const findings=Array.from({length:100},(_,i)=>({file:'test-'+i+'.txt',matches:Array.from({length:100},()=>({type:'card',label:'Kredi kartı',line:1,severity:'high',sample:'maskeli'}))}));
  f.app.store.saveScan({id:'large-history',finishedAt:new Date().toISOString(),root:'test-folder',files:100,errors:0,cancelled:false,truncated:false,findings});
  const result=await f.request('/api/state');assert.equal(result.data.scans[0].flagged,100);assert.equal(result.data.scans[0].findings,undefined);assert.ok(JSON.stringify(result.data).length<15000);
  const report=await f.request('/api/report?id=large-history');assert.equal(report.data.findings.length,100);assert.equal(report.data.findings[0].matches.length,100);
});
