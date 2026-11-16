const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {openStore}=require('../store');
test('audit chain detects modified rows and tail deletion and retains records beyond the UI window',async t=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'kalkan-audit-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));const store=openStore(dir);
  for(let i=0;i<305;i++)store.record({id:String(i),time:new Date().toISOString(),summary:'event '+i});
  assert.equal(store.events().length,300);assert.equal(store.verifyAudit().checked,305);assert.equal(store.verifyAudit().valid,true);
  const row=store.db.prepare('SELECT data FROM audit_ledger WHERE seq=1').get();store.db.prepare('UPDATE audit_ledger SET data=? WHERE seq=1').run('{}');assert.equal(store.verifyAudit().valid,false);
  store.db.prepare('UPDATE audit_ledger SET data=? WHERE seq=1').run(row.data);assert.equal(store.verifyAudit().valid,true);
  store.db.exec('DELETE FROM audit_ledger WHERE seq=305');assert.equal(store.verifyAudit().valid,false);store.close();assert.throws(()=>openStore(dir),/bütünlüğü/);
});
test('signed pending transaction recovers from interruption and forged recovery is rejected',async t=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'kalkan-audit-recover-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));let store=openStore(dir);store.record({id:'1',summary:'first'});
  const key=fs.readFileSync(path.join(dir,'audit-key.bin')),hmac=(data,previous)=>crypto.createHmac('sha256',key).update(previous+'\n'+data).digest('hex');
  const previous=store.db.prepare('SELECT seq,hash FROM audit_ledger ORDER BY seq DESC LIMIT 1').get(),data=JSON.stringify({id:'2',summary:'interrupted'}),next={seq:2,hash:hmac(data,previous.hash)},pending={previous,next};
  fs.writeFileSync(path.join(dir,'audit-pending.json'),JSON.stringify({...pending,signature:hmac(JSON.stringify(pending),'pending')}));
  store.db.prepare('INSERT INTO audit_ledger VALUES (?,?,?,?)').run(2,data,previous.hash,next.hash);store.close();
  store=openStore(dir);assert.equal(store.verifyAudit().valid,true);assert.equal(store.verifyAudit().checked,2);store.close();
  fs.writeFileSync(path.join(dir,'audit-pending.json'),JSON.stringify({...pending,signature:'forged'}));assert.throws(()=>openStore(dir),/doğrulanamadı/);
});
