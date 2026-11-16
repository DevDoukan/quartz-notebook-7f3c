'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {openStore}=require('../store'),{openCentral}=require('../central-store');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-central-audit-'));let store,central;const handles=[];function open(){store=openStore(dir);central=openCentral(dir,{auditKey:fs.readFileSync(path.join(dir,'audit-key.bin'))});}open();t.after(()=>{for(const handle of handles)handle.close();central.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {dir,track(handle){handles.push(handle);return handle;},get store(){return store;},get central(){return central;},restart(){central.close();store.close();open();}};}
const event=()=>({id:crypto.randomUUID(),time:new Date().toISOString(),kind:'central',actor:'test-admin',summary:'Company change'});
test('central business mutation and signed audit intent commit or roll back together',t=>{
 const f=fixture(t),raw=f.track(new DatabaseSync(path.join(f.dir,'central.sqlite')));
 raw.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_outbox BEGIN SELECT RAISE(ABORT,'test audit storage unavailable'); END");
 assert.throws(()=>f.central.audited(event(),()=>f.central.createTenant('owner','Must roll back')),/unavailable/);assert.equal(f.central.tenants('owner').length,0);assert.equal(f.central.pendingAudit(),0);
 raw.exec('DROP TRIGGER reject_audit');assert.throws(()=>f.central.audited(()=>{throw Error('test interruption');},()=>f.central.createTenant('owner','Also rolls back')),/interruption/);assert.equal(f.central.tenants('owner').length,0);
 const tenant=f.central.audited(event(),()=>f.central.createTenant('owner','Committed'));assert.equal(f.central.tenants('owner').length,1);assert.equal(f.central.pendingAudit(),1);
 assert.throws(()=>f.central.audited(event(),async()=>{}),/eşzamanlı/);assert.equal(f.central.pendingAudit(),1);
 f.central.flushAudit(f.store.recordOnce);assert.equal(f.central.pendingAudit(),0);assert.equal(f.store.events().length,1);
 f.central.audited(event(),()=>f.central.setPolicy('owner',tenant.id,{mode:'block',enabled:['card']}));f.central.flushAudit(f.store.recordOnce);assert.equal(f.store.events().length,2);
});
test('restart recovers committed intent and deduplicates a crash after ledger write before acknowledgement',t=>{
 const f=fixture(t),intent=event();f.central.audited(intent,()=>f.central.createTenant('owner','Recovery'));
 assert.throws(()=>f.central.flushAudit(value=>{f.store.recordOnce(value);throw Error('simulated crash before ack');}),/simulated/);assert.equal(f.store.events().length,1);assert.equal(f.central.pendingAudit(),1);
 f.restart();f.central.flushAudit(f.store.recordOnce);assert.equal(f.central.pendingAudit(),0);assert.equal(f.store.events().length,1);assert.equal(f.store.verifyAudit().valid,true);assert.equal(f.central.tenants('owner').length,1);
 assert.throws(()=>f.store.recordOnce({...intent,summary:'Forged duplicate'}),/farklı içerik/);
});
test('tampering or deleting queued audit data is detected before delivery',t=>{
 const f=fixture(t),raw=f.track(new DatabaseSync(path.join(f.dir,'central.sqlite')));f.central.audited(event(),()=>f.central.createTenant('owner','Tamper test'));
 const original=raw.prepare('SELECT * FROM audit_outbox').get();raw.prepare('UPDATE audit_outbox SET data=? WHERE seq=?').run(JSON.stringify({...JSON.parse(original.data),actor:'forged'}),original.seq);assert.throws(()=>f.central.flushAudit(f.store.recordOnce),/değiştirilmiş/);assert.equal(f.store.events().length,0);
 raw.prepare('UPDATE audit_outbox SET data=? WHERE seq=?').run(original.data,original.seq);raw.exec('DELETE FROM audit_outbox');assert.throws(()=>f.central.flushAudit(f.store.recordOnce),/silinmiş/);assert.equal(f.store.events().length,0);
});
test('committed central audit intent survives abrupt termination of a real child process',t=>{
 const f=fixture(t),script=`const fs=require('node:fs'),path=require('node:path'),{openCentral}=require('./central-store');const dir=process.argv[1],central=openCentral(dir,{auditKey:fs.readFileSync(path.join(dir,'audit-key.bin'))});central.audited({id:'crash-event',time:new Date().toISOString(),kind:'central',actor:'owner',summary:'Committed before process termination'},()=>central.createTenant('owner','Crash persisted'));fs.writeFileSync(path.join(dir,'committed.marker'),'yes');process.kill(process.pid,'SIGKILL');`;
 const result=require('node:child_process').spawnSync(process.execPath,['-e',script,f.dir],{cwd:path.join(__dirname,'..'),windowsHide:true,encoding:'utf8',timeout:10000});assert.notEqual(result.status,0);assert.equal(fs.readFileSync(path.join(f.dir,'committed.marker'),'utf8'),'yes');
 f.restart();assert.equal(f.central.tenants('owner')[0].name,'Crash persisted');assert.equal(f.central.pendingAudit(),1);f.central.flushAudit(f.store.recordOnce);assert.equal(f.store.events().length,1);assert.equal(f.store.events()[0].id,'crash-event');
});
