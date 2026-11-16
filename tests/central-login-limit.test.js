'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createCentralApp}=require('../central-server');
test('central login reports throttling without disclosing account existence and permits login after expiry',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-login-limit-'));let now=Date.now();
 const app=createCentralApp({dataDir:dir,now:()=>now});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 async function post(route,input){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};}
 const username='testadmin',password='Central-test-password2026';
 assert.equal((await post('/api/auth/setup',{setupKey:(await fs.readFile(path.join(dir,'setup-key.txt'),'utf8')).trim(),username,password})).status,200);
 for(let i=0;i<8;i++)assert.equal((await post('/api/auth/login',{username:'unknownaccount',password:'invalid'})).status,401);
 const blocked=await post('/api/auth/login',{username,password});
 assert.equal(blocked.status,429);assert.equal(blocked.body.error,'İstek sınırı aşıldı. Bir süre bekleyip tekrar deneyin.');
 now+=15*60*1000+1;
 assert.equal((await post('/api/auth/login',{username,password})).status,200);
});
