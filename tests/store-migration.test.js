'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openStore}=require('../store'),{openAuth}=require('../auth');
test('schema 2 data migrates to 3 with users and audit intact; future schema fails closed',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-schema-'));let store=openStore(dir);t.after(()=>{store?.close();fs.rmSync(dir,{recursive:true,force:true});});const auth=openAuth(store,dir),user=await auth.createUser({username:'migrationuser',password:'Migration-password-2026',role:'operator'});store.set('schemaVersion',2);const before=store.events().length;store.db.exec('DROP TABLE security_audit_outbox; DROP TABLE security_audit_dispatch');store.close();store=openStore(dir);assert.equal(store.get('schemaVersion'),3);assert.equal(store.db.prepare('SELECT username FROM users WHERE id=?').get(user.id).username,'migrationuser');assert.equal(store.events().length,before);assert.equal(store.verifyAudit().valid,true);
 store.set('schemaVersion',4);store.close();store=null;assert.throws(()=>openStore(dir),/daha yeni/);
});
