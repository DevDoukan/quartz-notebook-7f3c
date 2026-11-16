'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createCentralApp}=require('../central-server');
test('central HTTP API isolates companies and separates agent and user credentials',async t=>{
 let outlookLicenseAllowed=true;const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-central-api-')),app=createCentralApp({dataDir:dir,serverLicense:{status:()=>({allowed:outlookLicenseAllowed,deviceLimit:10})}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 async function call(route,input,session,extra={}){const res=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie,'X-DLP-Token':session.token}:{}),...extra},body:input===undefined?undefined:JSON.stringify(input)});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 const setup=await call('/api/auth/setup',{setupKey:(await fs.readFile(path.join(dir,'setup-key.txt'),'utf8')).trim(),username:'centraladmin',password:'Central-test-password2026'});assert.equal(setup.status,200);
 assert.match(setup.cookie,/^kalkan_central_session=/);const admin={cookie:setup.cookie,token:setup.body.token};
 const a=await call('/api/tenants',{name:'Customer A'},admin),b=await call('/api/tenants',{name:'Customer B'},admin);assert.equal(a.status,201);assert.equal(b.status,201);
 const created=await call('/api/users',{username:'customeradmin',password:'Customer-test-password2026',role:'operator'},admin);assert.equal(created.status,201);
 assert.equal((await call(`/api/tenants/${a.body.id}/grant`,{actor:created.body.id,role:'admin'},admin)).status,200);
 const login=await call('/api/auth/login',{username:'customeradmin',password:'Customer-test-password2026'}),customer={cookie:login.cookie,token:login.body.token};
 assert.equal((await call('/api/tenants',undefined,customer)).body.tenants.length,1);
 assert.equal((await call(`/api/tenants/${b.body.id}/devices`,undefined,customer)).status,403);
 assert.equal((await call(`/api/tenants/${b.body.id}/policy`,undefined,customer)).status,403);
 assert.equal((await call(`/api/tenants/${b.body.id}/audit`,undefined,customer)).status,403);
 assert.equal((await call(`/api/tenants/${b.body.id}/storage`,undefined,customer)).status,403);
 assert.equal((await call(`/api/tenants/${b.body.id}/storage`,{retentionDays:0,maxEvents:100},customer)).status,403);
 assert.equal((await call(`/api/tenants/${a.body.id}/storage`,{retentionDays:0,maxEvents:100},customer,{'X-DLP-Token':''})).status,403);
 const managementAudit=await call(`/api/tenants/${a.body.id}/audit`,undefined,customer);assert.equal(managementAudit.status,200);assert.ok(managementAudit.body.events.length>=2);assert.ok(managementAudit.body.events.every(event=>event.tenant===a.body.id));
 assert.equal((await call(`/api/tenants/${b.body.id}/policy`,{mode:'block',enabled:['card']},customer)).status,403);
 assert.equal((await call('/api/tenants',{name:'forbidden'},customer)).status,403);
 assert.equal((await call(`/api/tenants/${a.body.id}/policy`,{mode:'block',enabled:['unknown-rule']},customer)).status,400);
 assert.equal((await call(`/api/tenants/${a.body.id}/policy`,{mode:'block',enabled:['card'],usbWriteProtection:'true'},customer)).status,400);
 assert.equal((await call(`/api/tenants/${a.body.id}/policy`,{mode:'block',enabled:['card']},customer)).status,200);
 const ticket=await call(`/api/tenants/${a.body.id}/enrollment`,{},customer);assert.equal(ticket.status,200);
 const agent=await call('/api/agent/enroll',{name:'PC-01',token:ticket.body.token,tenant:b.body.id});assert.equal(agent.status,201);assert.equal(agent.body.tenant,a.body.id);
 assert.equal((await call('/api/agent/enroll',{name:'replay',token:ticket.body.token})).status,401);
 assert.equal((await call('/api/agent/heartbeat',{},customer)).status,401);
 assert.equal((await call('/api/agent/identity',{},customer)).status,401);
 const bearer={Authorization:'Bearer '+agent.body.credential};assert.equal((await call('/api/tenants',undefined,null,bearer)).status,401);
 const identity=await call('/api/agent/identity',{},null,bearer);assert.equal(identity.status,200);assert.equal(identity.body.id,agent.body.id);assert.equal(identity.body.tenant,a.body.id);assert.equal('credential' in identity.body,false);
 assert.equal((await call('/api/agent/heartbeat',{},null,bearer)).body.policy.mode,'block');
 const outlookMessage={sender:'sender@corp.example',to:['recipient@example.org'],cc:[],bcc:[],subject:'Test',body:'4111 1111 1111 1111',attachments:[],tenant:b.body.id};
 assert.equal((await call('/api/agent/outlook/inspect',outlookMessage,customer)).status,401);
 const outlookResult=await call('/api/agent/outlook/inspect',outlookMessage,null,bearer);
 assert.equal(outlookResult.status,200);assert.equal(outlookResult.body.decision,'block');
 outlookLicenseAllowed=false;assert.equal((await call('/api/agent/outlook/inspect',outlookMessage,null,bearer)).status,402);outlookLicenseAllowed=true;
 const outlookEvents=(await call(`/api/tenants/${a.body.id}/events`,undefined,customer)).body.events;
 assert.equal(outlookEvents.length,1);assert.equal(outlookEvents[0].data.kind,'outlook');
 assert.equal(JSON.stringify(outlookEvents).includes(outlookMessage.body),false);
 const attachmentMessage={...outlookMessage,body:'Clean text',attachments:[
   {name:'data.txt',base64:Buffer.from('clean '.repeat(4000)+'4111 1111 1111 1111').toString('base64')}
 ]};
 assert.equal((await call('/api/agent/outlook/inspect',attachmentMessage,null,bearer)).body.decision,'block');
 assert.equal((await call('/api/agent/events',{id:'event-1',kind:'usb',count:1,decision:'block',tenant:b.body.id},null,bearer)).status,200);
 assert.equal((await call(`/api/tenants/${a.body.id}/events`,undefined,customer)).body.events.length,3);assert.equal((await call(`/api/tenants/${b.body.id}/events`,undefined,admin)).body.events.length,0);
 assert.equal((await call(`/api/tenants/${a.body.id}/revoke`,{id:agent.body.id},customer,{'X-DLP-Token':''})).status,403);
 assert.equal((await call('/api/tenants',undefined,admin,{Origin:'https://evil.example'})).status,403);
 assert.equal((await call(`/api/tenants/${a.body.id}/revoke`,{id:agent.body.id},customer)).status,200);
 assert.equal((await call('/api/agent/heartbeat',{},null,bearer)).status,401);
 const outstanding=await call(`/api/tenants/${a.body.id}/enrollment`,{},customer);
 assert.equal((await call(`/api/tenants/${b.body.id}/members`,undefined,customer)).status,403);
 assert.equal((await call(`/api/tenants/${a.body.id}/remove-member`,{actor:created.body.id},customer)).status,400);
 // Even a central administrator must not strand a company without an active admin.
 assert.equal((await call(`/api/tenants/${a.body.id}/remove-member`,{actor:setup.body.user.id},customer)).status,200);
 assert.equal((await call('/api/agent/enroll',{token:outstanding.body.token,name:'removed-member-ticket'})).status,401);
 assert.equal((await call('/api/users/update',{id:created.body.id,enabled:false},admin)).status,400);
 assert.equal((await call(`/api/tenants/${a.body.id}/grant`,{actor:setup.body.user.id,role:'admin'},customer)).status,200);
 const disableTicket=await call(`/api/tenants/${a.body.id}/enrollment`,{},customer);
 assert.equal((await call('/api/users/update',{id:created.body.id,enabled:false},customer)).status,403);
 assert.equal((await call('/api/users/update',{id:created.body.id,enabled:false},admin)).status,200);
 assert.equal((await call('/api/tenants',undefined,customer)).status,401);
 assert.equal((await call('/api/agent/enroll',{token:disableTicket.body.token,name:'revoked-ticket'})).status,401);
 assert.equal((await call('/api/users/update',{id:created.body.id,enabled:true},admin)).status,200);
 assert.equal((await call('/api/tenants',undefined,customer)).status,401);
 const again=await call('/api/auth/login',{username:'customeradmin',password:'Customer-test-password2026'}),newCustomer={cookie:again.cookie,token:again.body.token};
 assert.equal((await call(`/api/tenants/${a.body.id}/remove-member`,{actor:created.body.id},admin)).status,200);
 assert.equal((await call(`/api/tenants/${a.body.id}/events`,undefined,newCustomer)).status,403);
 assert.equal((await call('/api/tenants',undefined,newCustomer)).body.tenants.length,0);
 const mfaSetup=await call('/api/mfa/begin',{password:'Central-test-password2026'},admin);assert.equal(mfaSetup.status,200);
 const OTPAuth=require('otpauth'),otp=new OTPAuth.TOTP({secret:mfaSetup.body.secret}).generate();const confirmation=await call('/api/mfa/confirm',{otp},admin);assert.equal(confirmation.status,200);assert.equal(confirmation.body.recoveryCodes.length,8);
 assert.equal((await call('/api/tenants',undefined,admin)).status,401);
 assert.equal((await call('/api/auth/login',{username:'centraladmin',password:'Central-test-password2026'})).status,401);
 const recovered=await call('/api/auth/login',{username:'centraladmin',password:'Central-test-password2026',otp:confirmation.body.recoveryCodes[0]});assert.equal(recovered.status,200);
 assert.equal((await call('/api/auth/login',{username:'centraladmin',password:'Central-test-password2026',otp:confirmation.body.recoveryCodes[0]})).status,401);
 const recoveredSession={cookie:recovered.cookie,token:recovered.body.token};assert.equal((await call('/api/mfa/status',undefined,recoveredSession)).body.recoveryRemaining,7);
 assert.equal((await call('/api/mfa/disable',{password:'Central-test-password2026',otp:confirmation.body.recoveryCodes[1]},recoveredSession)).status,200);
 assert.equal((await call('/api/tenants',undefined,recoveredSession)).status,401);
});
test('remote central endpoint refuses plaintext configuration',()=>{
 assert.throws(()=>createCentralApp({publicOrigin:'http://central.example.com'}),/TLS/);
 assert.throws(()=>createCentralApp({publicOrigin:'https://central.example.com'}),/TLS/);
 assert.throws(()=>createCentralApp({publicOrigin:'http://127.0.0.1/path'}),/Geçersiz/);
});
test('mandatory MFA blocks authenticated management until verified enrollment and a new login',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-required-mfa-')),app=createCentralApp({dataDir:dir,requireMfa:true});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='',token='';
 async function call(route,input){const res=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-DLP-Token':token},body:input===undefined?undefined:JSON.stringify(input)}),body=await res.json();if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];if(body.token)token=body.token;return {status:res.status,body};}
 assert.equal((await call('/api/auth/setup',{setupKey:(await fs.readFile(path.join(dir,'setup-key.txt'),'utf8')).trim(),username:'requiredadmin',password:'Required-MFA-test2026'})).status,200);
 assert.equal((await call('/api/auth/status')).body.mfaRequired,true);assert.equal((await call('/api/tenants')).body.code,'MFA_REQUIRED');assert.equal((await call('/api/tenants',{name:'must not create'})).status,403);
 const begun=await call('/api/mfa/begin',{password:'Required-MFA-test2026'}),OTPAuth=require('otpauth'),confirmation=await call('/api/mfa/confirm',{otp:new OTPAuth.TOTP({secret:begun.body.secret}).generate()});assert.equal(confirmation.status,200);
 assert.equal((await call('/api/tenants')).status,401);assert.equal((await call('/api/auth/login',{username:'requiredadmin',password:'Required-MFA-test2026',otp:confirmation.body.recoveryCodes[0]})).status,200);assert.equal((await call('/api/auth/status')).body.mfaRequired,false);assert.equal((await call('/api/tenants',{name:'Allowed company'})).status,201);
});
test('central HTTPS validates trust and issues Secure session cookies',async t=>{
 const https=require('node:https'),sync=require('node:fs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-central-tls-'));
 const cert=sync.readFileSync(path.join(__dirname,'fixtures','central-test-cert.pem')),key=sync.readFileSync(path.join(__dirname,'fixtures','central-test-key.pem'));
 const app=createCentralApp({dataDir:dir,publicOrigin:'https://localhost:4417',tls:{cert,key}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});
 function request(ca,input){return new Promise((resolve,reject)=>{const data=input?JSON.stringify(input):null;const req=https.request({hostname:'127.0.0.1',port:app.server.address().port,path:input?'/api/auth/setup':'/api/health',method:input?'POST':'GET',ca,headers:{Host:'localhost:4417',...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{})}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));});req.on('error',reject);req.end(data);});}
 await assert.rejects(request(undefined),e=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code));
 assert.equal((await request(cert)).body.tls,true);
 const setup=await request(cert,{setupKey:(await fs.readFile(path.join(dir,'setup-key.txt'),'utf8')).trim(),username:'tlsadmin',password:'TLS-test-password-2026'});assert.equal(setup.status,200);assert.match(setup.headers['set-cookie'][0],/; Secure/);
});
