const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {openStore}=require('../store'),{openLicense,verifyLicense}=require('../license');
function sign(claims,key){const raw=Buffer.from(JSON.stringify(claims));return {payload:raw.toString('base64url'),signature:crypto.sign(null,raw,key).toString('base64url')};}
test('offline license enforces signature, installation binding and expiration',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-license-'));const store=openStore(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  const keys=crypto.generateKeyPairSync('ed25519');let clock=Date.now();const service=openLicense(store,{publicKey:keys.publicKey,now:()=>clock}),initial=service.status();assert.equal(initial.state,'trial');assert.equal(initial.daysRemaining,14);
  const claims={schema:1,product:'kalkan-dlp',installationId:initial.installationId,customer:'Test company',licenseId:crypto.randomUUID(),plan:'Business',issuedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+365*86400000).toISOString()};
  const license=sign(claims,keys.privateKey);assert.equal(service.activate(license).state,'active');
  assert.throws(()=>verifyLicense({...license,payload:Buffer.from(JSON.stringify({...claims,customer:'modified'})).toString('base64url')},keys.publicKey,initial.installationId),/imzası/);
  assert.throws(()=>verifyLicense(license,keys.publicKey,'another-installation'),/kurulum/);
  const different=crypto.generateKeyPairSync('ed25519');assert.throws(()=>verifyLicense(sign(claims,different.privateKey),keys.publicKey,initial.installationId),/imzası/);
  clock+=366*86400000;assert.equal(service.status().state,'expired');assert.throws(()=>service.requireActive(),/süresi sona/);
});
test('trial is stable across restarts and a backward system clock does not extend it',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-trial-'));let store=openStore(dir),clock=Date.now();t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});const keys=crypto.generateKeyPairSync('ed25519');let service=openLicense(store,{publicKey:keys.publicKey,now:()=>clock});const id=service.status().installationId;store.close();
  clock+=15*86400000;store=openStore(dir);service=openLicense(store,{publicKey:keys.publicKey,now:()=>clock});assert.equal(service.status().installationId,id);assert.equal(service.status().state,'expired');clock-=2*86400000;assert.equal(service.status().state,'clock-error');
});
