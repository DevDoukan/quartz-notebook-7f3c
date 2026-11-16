'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process');
async function until(action,timeout=20000){const deadline=Date.now()+timeout;let error;while(Date.now()<deadline){try{const value=await action();if(value)return value;}catch(e){error=e;}await new Promise(r=>setTimeout(r,100));}throw error||Error('Native agent test timed out.');}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
test('native agent supervises real Node server, enforces roots, restarts it and terminates descendants',{skip:process.platform!=='win32',timeout:60000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-native-agent-')),app=path.join(root,'App With Spaces İŞ'),data=path.join(root,'Data'),company=path.join(root,'Şirket Belgeleri İŞ'),source=path.join(__dirname,'..');
 await fs.mkdir(app);await fs.mkdir(data);await fs.mkdir(company);await fs.mkdir(path.join(app,'runtime'));await fs.mkdir(path.join(app,'agent'));
 let host,ended;
 t.after(async()=>{
  if(host&&host.exitCode===null){host.stdin.write('stop\n');await Promise.race([ended,new Promise(r=>setTimeout(r,20000))]);if(host.exitCode===null)host.kill();}
  const debug={};for(const file of ['agent.log','agent-status.json','node-output.log']){try{debug[file]=(await fs.readFile(path.join(data,file),'utf8')).slice(-32000);}catch{}}await fs.mkdir(path.join(source,'.test-artifacts'),{recursive:true});await fs.writeFile(path.join(source,'.test-artifacts','native-agent-debug.json'),JSON.stringify(debug,null,2));
  const link=path.join(app,'node_modules');try{if((await fs.lstat(link)).isSymbolicLink())await fs.unlink(link);}catch{}
  await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 });
 for(const name of ['server.js','detector.js','scanner.js','extract-worker.js','document-readers.js','store.js','audit-queue.js','auth.js','license.js','backup.js','windows.js','runtime-lock.js','agent-access.js','package.json','product-config.json','license-public.pem'])await fs.copyFile(path.join(source,name),path.join(app,name));
 await fs.cp(path.join(source,'public'),path.join(app,'public'),{recursive:true});
 await fs.copyFile(process.execPath,path.join(app,'runtime','node.exe'));await fs.copyFile(path.join(source,'.build','agent','KalkanFileBroker.exe'),path.join(app,'agent','KalkanFileBroker.exe'));
 await fs.symlink(path.join(source,'node_modules'),path.join(app,'node_modules'),'junction');
 await fs.appendFile(path.join(app,'server.js'),`\nif(require.main===module){const fixtureChild=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('node:fs').writeFileSync(require('node:path').join(process.env.DLP_DATA_DIR,'test-grandchild.pid'),String(fixtureChild.pid));}\n`);
 await fs.writeFile(path.join(company,'card.txt'),'Card: 4242424242424242');
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const config=path.join(root,'agent-config.json');await fs.writeFile(config,JSON.stringify({AppRoot:app,DataDir:data,Port:port,MemoryLimitMb:1024}));
 host=spawn(path.join(source,'.build','agent','KalkanDlpAgent.exe'),['--console','--config',config],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let stderr='';host.stderr.on('data',b=>{stderr+=b.toString();});host.stdout.on('data',()=>{});ended=new Promise(resolve=>host.once('close',resolve));
 const base='http://127.0.0.1:'+port;
 await until(async()=>{if(host.exitCode!==null)throw Error(stderr);return (await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;});
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'nativeadmin',password:'Native-test-password-2026',setupKey:await fs.readFile(path.join(data,'setup-key.txt'),'utf8')})});assert.equal(setup.status,200);
 const session=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
 async function api(route,input){const response=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-DLP-Token':session.token},body:input===undefined?undefined:JSON.stringify(input)});return {status:response.status,data:await response.json()};}
 assert.equal((await api('/api/state')).data.agent.mode,'service');assert.equal((await api('/api/shutdown',{})).status,409);
 assert.equal((await api('/api/agent/roots',{roots:[data]})).status,400);assert.equal((await api('/api/agent/roots',{roots:[company]})).status,200);
 const scan=await api('/api/scan',{path:company});assert.equal(scan.status,202);
 const done=await until(async()=>{const job=await api('/api/jobs/'+scan.data.id);return job.data.status==='running'?null:job.data;});assert.equal(done.status,'complete');assert.equal(done.result.findings.length,1);
 const old=JSON.parse(await fs.readFile(path.join(data,'server.lock'),'utf8')),oldGrand=Number(await fs.readFile(path.join(data,'test-grandchild.pid'),'utf8'));assert.ok(alive(oldGrand));process.kill(old.pid);
 const restarted=await until(async()=>{const status=JSON.parse(await fs.readFile(path.join(data,'agent-status.json'),'utf8'));if(status.generation<2||status.childPid===old.pid)return null;const health=await fetch(base+'/api/health',{headers:{Connection:'close'},signal:AbortSignal.timeout(1000)});return health.ok?status:null;});
 assert.notEqual(restarted.childPid,old.pid);await until(()=>!alive(oldGrand));
 const newGrand=Number(await fs.readFile(path.join(data,'test-grandchild.pid'),'utf8'));host.stdin.write('stop\n');assert.equal(await ended,0);assert.equal(alive(restarted.childPid),false);await until(()=>!alive(newGrand));assert.equal(JSON.parse(await fs.readFile(path.join(data,'agent-status.json'),'utf8')).state,'stopped');
});
