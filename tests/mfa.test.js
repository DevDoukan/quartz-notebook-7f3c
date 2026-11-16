'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),OTPAuth=require('otpauth');
const {openStore}=require('../store'),{openAuth}=require('../auth'),{openMfa}=require('../mfa');
test('MFA encrypts secrets, rejects replay, consumes recovery once and persists counters',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-mfa-'));let now=1800000000000,store=openStore(dir),mfa;let auth=openAuth(store,dir,{now:()=>now,verifySecondFactor:(id,token)=>mfa.verify(id,token)});mfa=openMfa(store,dir,{now:()=>now});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const response=()=>({setHeader(){}});const setup=await auth.setup({setupKey:fs.readFileSync(path.join(dir,'setup-key.txt'),'utf8').trim(),username:'mfaadmin',password:'MFA-test-password-2026'},response()),id=setup.user.id;
 const begun=mfa.begin(id,'mfaadmin'),totp=new OTPAuth.TOTP({secret:begun.secret,algorithm:'SHA1',digits:6,period:30});
 assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM mfa_accounts').get()).includes(begun.secret),false);
 const codes=mfa.confirm(id,totp.generate({timestamp:now})).recoveryCodes;assert.equal(codes.length,8);assert.equal(mfa.verify(id,totp.generate({timestamp:now})),false);
 await assert.rejects(auth.login({username:'mfaadmin',password:'MFA-test-password-2026'},response()),/doğrulama/);
 const login=await auth.login({username:'mfaadmin',password:'MFA-test-password-2026',otp:codes[0]},response());assert.equal(login.user.id,id);assert.equal(mfa.verify(id,codes[0]),false);assert.equal(mfa.status(id).recoveryRemaining,7);
 const stored=JSON.stringify(store.db.prepare('SELECT * FROM mfa_accounts').get());assert.equal(stored.includes(codes[1].replaceAll('-','')),false);
 now+=30000;const used=totp.generate({timestamp:now});assert.equal(mfa.verify(id,used),true);store.close();store=openStore(dir);auth=openAuth(store,dir,{now:()=>now});mfa=openMfa(store,dir,{now:()=>now});assert.equal(mfa.verify(id,used),false);
 assert.equal(mfa.verify(id,codes[1]),true);mfa.disable(id,codes[2]);assert.equal(mfa.status(id).enabled,false);
});
test('MFA setup expires and confirmation throttle survives replacement of pending secret',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-mfa-limit-'));let now=1800000000000;const store=openStore(dir),auth=openAuth(store,dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});const user=await auth.createUser({username:'mfauser',password:'MFA-test-password-2026',role:'operator'}),mfa=openMfa(store,dir,{now:()=>now});
 const pending=mfa.begin(user.id,user.username);now+=600000;assert.throws(()=>mfa.confirm(user.id,new OTPAuth.TOTP({secret:pending.secret}).generate({timestamp:now})),/süresi/);
 const second=mfa.begin(user.id,user.username);for(let i=0;i<8;i++)assert.throws(()=>mfa.confirm(user.id,'invalid'),/geçersiz/);const replaced=mfa.begin(user.id,user.username);assert.throws(()=>mfa.confirm(user.id,new OTPAuth.TOTP({secret:replaced.secret}).generate({timestamp:now})),/sınırı/);
 fs.unlinkSync(path.join(dir,'mfa-key.bin'));assert.throws(()=>openMfa(store,dir),/anahtarı eksik/);
 assert.notEqual(second.secret,replaced.secret);
});
test('invalid MFA disable attempts persist despite rejecting the requested state change',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-mfa-disable-limit-')),store=openStore(dir),auth=openAuth(store,dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});const user=await auth.createUser({username:'disableuser',password:'MFA-disable-password2026',role:'operator'}),mfa=openMfa(store,dir),setup=mfa.begin(user.id,user.username),codes=mfa.confirm(user.id,new OTPAuth.TOTP({secret:setup.secret}).generate()).recoveryCodes;
 for(let i=0;i<8;i++)assert.throws(()=>mfa.disable(user.id,'invalid'),/geçersiz/);assert.equal(store.db.prepare('SELECT attempts FROM login_limits WHERE identity=?').get('mfa:'+user.id).attempts,8);assert.throws(()=>mfa.disable(user.id,codes[0]),/geçersiz/);assert.equal(mfa.status(user.id).enabled,true);assert.equal(mfa.status(user.id).recoveryRemaining,8);
});
