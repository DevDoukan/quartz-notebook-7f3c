'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn,spawnSync}=require('node:child_process');
test('native host bounds repeated crashes and preserves failed status',{skip:process.platform!=='win32',timeout:40000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-crash-budget-')),app=path.join(root,'App'),data=path.join(root,'Data'),source=path.join(__dirname,'..');let host;
 await fs.mkdir(path.join(app,'runtime'),{recursive:true});await fs.mkdir(path.join(app,'agent'));await fs.mkdir(data);
 t.after(async()=>{if(host&&host.exitCode===null)host.kill();await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
 await fs.copyFile(process.execPath,path.join(app,'runtime','node.exe'));await fs.copyFile(path.join(source,'.build','agent','KalkanFileBroker.exe'),path.join(app,'agent','KalkanFileBroker.exe'));
 await fs.writeFile(path.join(app,'server.js'),"const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.appendFileSync(path.join(process.env.DLP_DATA_DIR,'descendants.txt'),child.pid+'\\n');setTimeout(()=>process.exit(7),100);");
 const config=path.join(root,'config.json');await fs.writeFile(config,JSON.stringify({AppRoot:app,DataDir:data,Port:4318,MemoryLimitMb:1024}));
 host=spawn(path.join(source,'.build','agent','KalkanDlpAgent.exe'),['--console','--config',config],{stdio:['pipe','ignore','pipe'],windowsHide:true});let error='';host.stderr.on('data',b=>{error+=b.toString();});const code=await new Promise(resolve=>host.once('close',resolve));assert.equal(code,1,error);
 const status=JSON.parse(await fs.readFile(path.join(data,'agent-status.json'),'utf8'));assert.equal(status.state,'failed');assert.equal(status.generation,4);
 const pids=(await fs.readFile(path.join(data,'descendants.txt'),'utf8')).trim().split('\n').map(Number);assert.equal(pids.length,4);for(const pid of pids){let alive=true;try{process.kill(pid,0);}catch{alive=false;}assert.equal(alive,false,'Orphaned child process: '+pid);}
});
test('machine installation helper refuses non-elevated or untrusted installation roots',{skip:process.platform!=='win32'},()=>{
 const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','scripts','Manage-Service.ps1'),'-Action','Install','-AppRoot',path.join(__dirname,'..')],{encoding:'utf8',windowsHide:true});assert.notEqual(result.status,0);assert.match(result.stderr,/administrator|Program Files/);
});
