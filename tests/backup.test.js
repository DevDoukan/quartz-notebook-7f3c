const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {openStore}=require('../store'),{openAuth}=require('../auth'),{createBackup,restoreBackup}=require('../backup');
test('encrypted backup restores policy and audit, excludes sessions and rejects tampering',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-backup-')),dir=path.join(root,'source');let store=openStore(dir);t.after(async()=>{store?.close();await fs.rm(root,{recursive:true,force:true});});
  const auth=openAuth(store,dir);await auth.setup({setupKey:await fs.readFile(path.join(dir,'setup-key.txt'),'utf8'),username:'admin',password:'Test-password-2026'},{setHeader(){}});
  store.set('policy',{mode:'block',enabled:['card']});store.record({id:'backup-test',time:new Date().toISOString(),kind:'policy',summary:'test'});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
  const document=await createBackup(store,dir,'Backup-password-2026');assert.ok(!JSON.stringify(document).includes('admin'));assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
  await assert.rejects(restoreBackup(document,'Wrong-password-2026',path.join(root,'wrong')),/yanlış/);
  const bytes=Buffer.from(document.data,'base64');bytes[10]^=1;await assert.rejects(restoreBackup({...document,data:bytes.toString('base64')},'Backup-password-2026',path.join(root,'tampered')),/değiştirilmiş/);
  const target=path.join(root,'restored');const result=await restoreBackup(document,'Backup-password-2026',target);assert.equal(result.audit.valid,true);
  const restored=openStore(target);try{assert.equal(restored.policy().mode,'block');assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.equal(restored.db.prepare('SELECT username FROM users').get().username,'admin');assert.equal(restored.verifyAudit().valid,true);}finally{restored.close();}
  await assert.rejects(restoreBackup(document,'Backup-password-2026',target),/boş olmalı/);
});
test('desktop backup preserves central identity and pending enrollment without exposing secrets',async t=>{
  const crypto=require('node:crypto'),{openCentralLink}=require('../central-client');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kalkan-backup-identity-')),dir=path.join(root,'source'),store=openStore(dir);
  t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});
  openAuth(store,dir);
  const config={origin:'https://localhost:4443',id:crypto.randomUUID(),tenant:crypto.randomUUID(),credential:crypto.randomBytes(32).toString('hex'),policyPublicKey:crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})};
  openCentralLink(store,config);await fs.writeFile(path.join(dir,'agent-central.json'),JSON.stringify(config));
  const document=await createBackup(store,dir,'Backup-password-2026');assert.ok(!JSON.stringify(document).includes(config.credential));
  const target=path.join(root,'restored');await restoreBackup(document,'Backup-password-2026',target);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'agent-central.json'),'utf8')),config);
  let recovered=openStore(target);try{assert.equal(openCentralLink(recovered,config).status().deviceId,config.id);}finally{recovered.close();}
  const external=await createBackup(store,dir,'Backup-password-2026',{includeEnrollment:false});const externalTarget=path.join(root,'external');await restoreBackup(external,'Backup-password-2026',externalTarget);
  await assert.rejects(fs.access(path.join(externalTarget,'agent-central.json')));recovered=openStore(externalTarget);try{assert.equal(recovered.get('centralIdentity'),store.get('centralIdentity'));}finally{recovered.close();}
  await fs.writeFile(path.join(dir,'agent-central.json'),JSON.stringify({...config,id:crypto.randomUUID()}));await assert.rejects(createBackup(store,dir,'Backup-password-2026'),/uyuşmuyor/);
  await fs.unlink(path.join(dir,'agent-central.json'));store.set('centralIdentity',null);
  const pending={version:1,origin:config.origin,name:'Test device',token:crypto.randomBytes(32).toString('hex'),credential:config.credential,requestId:crypto.randomBytes(32).toString('hex')};
  await fs.writeFile(path.join(dir,'agent-central.json.pending.json'),JSON.stringify(pending));
  const pendingDocument=await createBackup(store,dir,'Backup-password-2026'),pendingTarget=path.join(root,'pending');await restoreBackup(pendingDocument,'Backup-password-2026',pendingTarget);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(pendingTarget,'agent-central.json.pending.json'),'utf8')),pending);
  recovered=openStore(pendingTarget);try{assert.equal(recovered.get('centralEnrollmentPending'),true);}finally{recovered.close();}
  // Authenticated but inconsistent input must not publish a usable partial database.
  const key=crypto.scryptSync('Backup-password-2026',Buffer.from(pendingDocument.salt,'base64'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024}),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(pendingDocument.iv,'base64'));
  decipher.setAAD(Buffer.from('kalkan-backup-v1'));decipher.setAuthTag(Buffer.from(pendingDocument.tag,'base64'));
  const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(pendingDocument.data,'base64')),decipher.final()]));payload.enrollment={'../escape.json':'{}'};
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('kalkan-backup-v1'));const data=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);key.fill(0);
  const invalidTarget=path.join(root,'invalid');await fs.mkdir(invalidTarget);
  await assert.rejects(restoreBackup({...pendingDocument,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')},'Backup-password-2026',invalidTarget),/kimliği geçersiz/);
  assert.deepEqual(await fs.readdir(invalidTarget),[]);assert.equal((await fs.readdir(root)).some(name=>name.startsWith('.kalkan-restore-')),false);
});
