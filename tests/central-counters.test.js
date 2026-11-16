'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {openCentral}=require('../central-store');
test('quota counters migrate old data, follow rollback and deletion, and reconcile after restart',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-counters-')),auditKey=crypto.randomBytes(32);let clock=1000,central=openCentral(dir,{auditKey,now:()=>clock});t.after(()=>{central.close();fs.rmSync(dir,{recursive:true,force:true});});
 const a=central.createTenant('owner','A'),b=central.createTenant('other','B'),agent=central.enroll(central.issueEnrollment('owner',a.id).token,'PC-A');
 const event={id:'first',kind:'usb',decision:'block',count:1};central.ingest(agent.credential,event);central.ingest(agent.credential,event);assert.equal(central.storage('owner',a.id).events,1);assert.equal(central.storage('other',b.id).events,0);
 assert.throws(()=>central.audited({id:crypto.randomUUID(),summary:'rollback'},()=>{central.ingest(agent.credential,{...event,id:'rollback'});throw Error('rollback');}),/rollback/);assert.equal(central.storage('owner',a.id).events,1);
 central.close();let db=new DatabaseSync(path.join(dir,'central.sqlite'));try{db.exec('DROP TRIGGER event_count_insert; DROP TRIGGER event_count_delete; DROP TRIGGER event_count_move; DROP TABLE event_counts; DROP TABLE event_total');}finally{db.close();}
 central=openCentral(dir,{auditKey,now:()=>clock});assert.equal(central.storage('owner',a.id).events,1);central.ingest(agent.credential,{...event,id:'after-migration'});assert.equal(central.storage('owner',a.id).events,2);
 central.close();db=new DatabaseSync(path.join(dir,'central.sqlite'));try{db.exec('UPDATE event_counts SET events=0; UPDATE event_total SET events=0');}finally{db.close();}
 central=openCentral(dir,{auditKey,now:()=>clock});assert.equal(central.storage('owner',a.id).events,2);clock+=2*86400000;central.setStorage('owner',a.id,{retentionDays:1,maxEvents:100,acknowledgeDeletion:true});assert.equal(central.pruneEvents(a.id).deleted,2);assert.equal(central.storage('owner',a.id).events,0);
 db=new DatabaseSync(path.join(dir,'central.sqlite'));try{assert.equal(db.prepare('SELECT events FROM event_total WHERE id=1').get().events,0);assert.throws(()=>db.prepare('UPDATE devices SET tenant=? WHERE id=?').run(b.id,agent.id),/immutable/);}finally{db.close();}
});
