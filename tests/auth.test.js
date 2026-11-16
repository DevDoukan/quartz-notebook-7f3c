const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
async function harness(t,options={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-auth-')),app=createApp({dataDir:dir,...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function request(route,input,session){const response=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:session?.cookie||'','X-DLP-Token':session?.token||''},body:input===undefined?undefined:JSON.stringify(input)});const data=await response.json();return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],token:data.token};}
  const setupKey=await fs.readFile(path.join(dir,'setup-key.txt'),'utf8');return {dir,app,request,setupKey};
}
test('first-run setup is secret-gated, one-time, and creates no default password',async t=>{
  const f=await harness(t);assert.equal((await f.request('/api/state')).status,401);assert.equal((await f.request('/api/auth/status')).data.configured,false);
  assert.equal((await f.request('/api/auth/setup',{username:'admin',password:'Test-password-2026',setupKey:'wrong'})).status,400);
  assert.equal((await f.request('/api/auth/setup',{username:'admin',password:'short',setupKey:f.setupKey})).status,400);
  const admin=await f.request('/api/auth/setup',{username:'admin',password:'Test-password-2026',setupKey:f.setupKey});assert.equal(admin.status,200);assert.match(admin.cookie,/kalkan_session=/);assert.equal((await f.request('/api/state',undefined,admin)).data.user.role,'admin');
  await assert.rejects(fs.access(path.join(f.dir,'setup-key.txt')));
  assert.equal((await f.request('/api/auth/setup',{username:'other',password:'Test-password-2026',setupKey:f.setupKey})).status,400);
  const row=f.app.store.db.prepare('SELECT * FROM users').get();assert.notEqual(row.password_hash,'Test-password-2026');assert.equal(row.password_hash.length,128);
  assert.ok(!JSON.stringify(f.app.store.events()).includes('Test-password'));
});
test('RBAC rejects operator administration and auditor writes; disabling user revokes sessions',async t=>{
  const f=await harness(t),admin=await f.request('/api/auth/setup',{username:'admin',password:'Test-password-2026',setupKey:f.setupKey});
  const created=await f.request('/api/users',{username:'operator',password:'Operator-password-2026',role:'operator'},admin);assert.equal(created.status,201);
  const operator=await f.request('/api/auth/login',{username:'operator',password:'Operator-password-2026'});
  assert.equal((await f.request('/api/policy',{mode:'block',enabled:[]},operator)).status,403);assert.equal((await f.request('/api/users',undefined,operator)).status,403);
  assert.equal((await f.request('/api/state',undefined,operator)).data.extensionKey,undefined);
  assert.equal((await f.request('/api/agent/roots',{roots:[]},operator)).status,403);
  assert.equal((await f.request('/api/inspect',{channel:'web',text:'test'},operator)).status,200);
  await f.request('/api/users',{username:'auditor',password:'Auditor-password-2026',role:'auditor'},admin);
  const auditor=await f.request('/api/auth/login',{username:'auditor',password:'Auditor-password-2026'});assert.equal((await f.request('/api/state',undefined,auditor)).status,200);assert.equal((await f.request('/api/inspect',{channel:'web',text:'test'},auditor)).status,403);
  await f.request('/api/users/update',{id:created.data.user.id,role:'operator',enabled:false},admin);assert.equal((await f.request('/api/state',undefined,operator)).status,401);
  assert.equal((await f.request('/api/users/update',{id:admin.data.user.id,role:'operator',enabled:true},admin)).status,400);
});
test('logout, password replacement, idle timeout and absolute expiry invalidate sessions',async t=>{
  let clock=Date.now();const f=await harness(t,{now:()=>clock});let admin=await f.request('/api/auth/setup',{username:'admin',password:'Test-password-2026',setupKey:f.setupKey});
  assert.equal((await f.request('/api/auth/password',{currentPassword:'bad',newPassword:'Replacement-password-2026'},admin)).status,400);
  assert.equal((await f.request('/api/auth/password',{currentPassword:'Test-password-2026',newPassword:'Replacement-password-2026'},admin)).status,200);
  assert.equal((await f.request('/api/state',undefined,admin)).status,401);assert.equal((await f.request('/api/auth/login',{username:'admin',password:'Test-password-2026'})).status,401);
  admin=await f.request('/api/auth/login',{username:'admin',password:'Replacement-password-2026'});clock+=31*60*1000;assert.equal((await f.request('/api/state',undefined,admin)).status,401);
  admin=await f.request('/api/auth/login',{username:'admin',password:'Replacement-password-2026'});for(let i=0;i<16;i++){clock+=29*60*1000;await f.request('/api/state',undefined,admin);}clock+=17*60*1000;assert.equal((await f.request('/api/state',undefined,admin)).status,401);
  admin=await f.request('/api/auth/login',{username:'admin',password:'Replacement-password-2026'});assert.equal((await f.request('/api/auth/logout',{},admin)).status,200);assert.equal((await f.request('/api/state',undefined,admin)).status,401);
});
test('repeated login failures are throttled without exposing account existence',async t=>{
  const f=await harness(t);await f.request('/api/auth/setup',{username:'admin',password:'Test-password-2026',setupKey:f.setupKey});
  for(let i=0;i<8;i++)assert.equal((await f.request('/api/auth/login',{username:i%2?'unknown':'admin',password:'wrong'})).status,401);
  assert.equal((await f.request('/api/auth/login',{username:'admin',password:'Test-password-2026'})).status,429);
});
