const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {acquireLock,assertOffline}=require('../runtime-lock');
test('Linux reclaims a lock when a live PID has a different process identity', {skip:process.platform!=='linux'}, async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-lock-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'server.lock');
 acquireLock(dir);
 const lock=JSON.parse(await fs.readFile(file,'utf8'));
 assert.match(lock.linuxIdentity,/^[a-f0-9-]{36}:\d+$/);
 lock.linuxIdentity=lock.linuxIdentity.replace(/:\d+$/, ':0');
 await fs.writeFile(file,JSON.stringify(lock));
 assert.doesNotThrow(()=>assertOffline(dir));
 const release=acquireLock(dir);
 assert.throws(()=>assertOffline(dir),/durdurun/);
 release();
});
test('only one active server can own a data directory and lock is released on close',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-lock-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const release=acquireLock(dir);
 assert.throws(()=>acquireLock(dir),/çalışan/);assert.throws(()=>assertOffline(dir),/durdurun/);release();assert.doesNotThrow(()=>assertOffline(dir));const again=acquireLock(dir);again();
});
test('Windows reclaims a legacy lock whose PID now belongs to another executable', {skip:process.platform!=='win32'}, async t=>{
 const {spawn}=require('node:child_process'),{once}=require('node:events');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-lock-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const child=spawn(path.join(process.env.SystemRoot,'System32','cmd.exe'),['/d','/q','/k'],{windowsHide:true});
 t.after(()=>child.kill());
 await once(child,'spawn');
 await fs.writeFile(path.join(dir,'server.lock'),JSON.stringify({pid:child.pid,id:'legacy',createdAt:'2020-01-01T00:00:00.000Z'}));
 assert.doesNotThrow(()=>assertOffline(dir));
 const release=acquireLock(dir);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'server.lock'),'utf8')).pid,process.pid);
 release();
});
