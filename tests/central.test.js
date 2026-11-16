'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openCentral}=require('../central-store');
test('central tenant isolation, least privilege, enrollment replay and device revocation',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-central-'));let clock=1000;const central=openCentral(dir,{now:()=>clock});t.after(()=>{central.close();fs.rmSync(dir,{recursive:true,force:true});});
 const a=central.createTenant('reseller','Company A'),b=central.createTenant('other','Company B');
 central.grant('reseller',a.id,'reader','auditor');
 assert.equal(central.tenants('reseller').length,1);
 for(const operation of [()=>central.devices('reseller',b.id),()=>central.events('reader',b.id),()=>central.grant('reseller',b.id,'reseller','admin'),()=>central.issueEnrollment('reader',a.id),()=>central.setPolicy('reader',a.id,{mode:'block',enabled:[]})])assert.throws(operation,/yetkiniz/);
 const ticket=central.issueEnrollment('reseller',a.id),agent=central.enroll(ticket.token,'PC-01');
 assert.throws(()=>central.enroll(ticket.token,'replay'),/kullanılmış/);
 const expired=central.issueEnrollment('reseller',a.id);clock=expired.expires;assert.throws(()=>central.enroll(expired.token,'expired'),/süresi/);
 assert.equal(central.setPolicy('reseller',a.id,{mode:'block',enabled:['iban']}),1);
 assert.equal(central.setPolicy('other',b.id,{mode:'audit',enabled:[]}),1);
 assert.equal(central.heartbeat(agent.credential).policy.mode,'block');
 const event={id:'evt-1',kind:'usb',decision:'block',count:2,rawContent:'MUST NOT STORE',tenant:b.id};
 assert.equal(central.ingest(agent.credential,event).accepted,true);assert.equal(central.ingest(agent.credential,event).accepted,false);
 assert.equal(central.events('other',b.id).length,0);assert.equal(central.events('reader',a.id).length,1);assert.equal(JSON.stringify(central.events('reader',a.id)).includes('MUST NOT STORE'),false);
 assert.equal(JSON.stringify(central.devices('reseller',a.id)).includes(agent.credential),false);
 assert.throws(()=>central.revoke('other',b.id,agent.id),/bulunamadı/);central.revoke('reseller',a.id,agent.id);
 assert.throws(()=>central.heartbeat(agent.credential),/kimliği/);assert.throws(()=>central.ingest(agent.credential,event),/kimliği/);
});
test('central policies and hashed credentials persist across restart',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-central-persist-'));let central=openCentral(dir);t.after(()=>{central.close();fs.rmSync(dir,{recursive:true,force:true});});
 const tenant=central.createTenant('owner','Persistent company');const ticket=central.issueEnrollment('owner',tenant.id);const agent=central.enroll(ticket.token,'Persistent PC');
 central.setPolicy('owner',tenant.id,{mode:'audit',enabled:['iban']});central.close();central=openCentral(dir);
 assert.equal(central.heartbeat(agent.credential).policy.revision,1);assert.equal(central.setPolicy('owner',tenant.id,{mode:'block',enabled:['iban']}),2);
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(dir,'central.sqlite'));try{assert.notEqual(db.prepare('SELECT credential FROM devices').get().credential,agent.credential);assert.equal(db.prepare('SELECT count(*) AS n FROM enrollments').get().n,0);}finally{db.close();}
});
test('registration retries bind token, request, credential and name to one active device',t=>{
 const crypto=require('node:crypto'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-retry-'));let clock=1000;const central=openCentral(dir,{now:()=>clock});t.after(()=>{central.close();fs.rmSync(dir,{recursive:true,force:true});});const tenant=central.createTenant('owner','Retry company'),ticket=central.issueEnrollment('owner',tenant.id),retry={requestId:crypto.randomBytes(32).toString('hex'),credential:crypto.randomBytes(32).toString('hex')};
 const first=central.enroll(ticket.token,'Retry PC',retry),second=central.enroll(ticket.token,'Retry PC',retry);assert.equal(first.id,second.id);assert.equal(second.replayed,true);assert.equal(second.credential,retry.credential);assert.equal(central.devices('owner',tenant.id).length,1);
 assert.throws(()=>central.enroll(ticket.token,'Retry PC'),/kullanılmış/);for(const value of [{...retry,requestId:'0'.repeat(64)},{...retry,credential:'0'.repeat(64)}])assert.throws(()=>central.enroll(ticket.token,'Retry PC',value),/uyuşmuyor/);assert.throws(()=>central.enroll(ticket.token,'Other PC',retry),/uyuşmuyor/);
 central.revoke('owner',tenant.id,first.id);assert.throws(()=>central.enroll(ticket.token,'Retry PC',retry),/iptal/);
 const next=central.issueEnrollment('owner',tenant.id),other={requestId:crypto.randomBytes(32).toString('hex'),credential:crypto.randomBytes(32).toString('hex')};central.enroll(next.token,'Expired retry',other);clock=next.expires;assert.throws(()=>central.enroll(next.token,'Expired retry',other),/süresi/);
});
