'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {rules}=require('./detector');
const {openAuditQueue}=require('./audit-queue');
function openStore(dir) {
  fs.mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(path.join(dir,'dlp.sqlite'));
  const settingsExist=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
  if(settingsExist){const saved=db.prepare("SELECT value FROM settings WHERE id='schemaVersion'").get();if(saved&&Number(JSON.parse(saved.value))>3){db.close();throw Error('Veri klasörü daha yeni bir ürün sürümü gerektiriyor. Sürümü yükseltin veya uyumlu yedeği kullanın.');}}
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, time TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, time TEXT NOT NULL, data TEXT NOT NULL);`);
  const keyFile=path.join(dir,'audit-key.bin'),headFile=path.join(dir,'audit-head.json'),pendingFile=path.join(dir,'audit-pending.json');
  const hadAudit=!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_ledger'").get();
  if(!fs.existsSync(keyFile)){
    if(hadAudit){db.close();throw Error('Denetim anahtarı eksik. Doğrulanmış yedekten kurtarma gerekiyor.');}
    fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600,flag:'wx'});
  }
  const key=fs.readFileSync(keyFile);
  db.exec('CREATE TABLE IF NOT EXISTS audit_ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL)');
  const digest=(data,previous)=>crypto.createHmac('sha256',key).update(previous+'\n'+data).digest('hex');
  function atomic(file,data){fs.writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600,flush:true});fs.renameSync(file+'.tmp',file);}
  function writeHead(head){const value={...head};value.signature=digest(JSON.stringify(head),'head');atomic(headFile,value);}
  function chainState(){
    let previous='GENESIS',seq=0;
    for(const row of db.prepare('SELECT * FROM audit_ledger ORDER BY seq').iterate()){
      if(row.seq!==seq+1||row.prev_hash!==previous||row.hash!==digest(row.data,previous))return {valid:false,reason:'Kayıt zinciri değişmiş.',checked:seq};
      seq=row.seq;previous=row.hash;
    }
    return {valid:true,checked:seq,head:previous};
  }
  function verifyAudit(){
    const chain=chainState();if(!chain.valid)return chain;
    const seq=chain.checked,previous=chain.head;
    if(!fs.existsSync(headFile))return {valid:false,reason:'Kayıt zinciri kontrol dosyası eksik.',checked:seq};
    let saved;try{saved=JSON.parse(fs.readFileSync(headFile,'utf8'));}catch{return {valid:false,reason:'Kontrol dosyası okunamadı.',checked:seq};}
    const unsigned={seq:saved.seq,hash:saved.hash};
    if(saved.signature!==digest(JSON.stringify(unsigned),'head')||saved.seq!==seq||saved.hash!==previous)return {valid:false,reason:'Kayıt zinciri sonu doğrulanamadı.',checked:seq};
    return {valid:true,checked:seq,head:previous};
  }
  function recoverPending(){
    if(!fs.existsSync(pendingFile))return;
    const saved=JSON.parse(fs.readFileSync(pendingFile,'utf8')),payload={previous:saved.previous,next:saved.next};
    if(saved.signature!==digest(JSON.stringify(payload),'pending'))throw Error('Denetim işlem günlüğü doğrulanamadı.');
    const current=chainState();if(!current.valid)throw Error('Denetim zinciri kurtarılamadı.');
    const head={seq:current.checked,hash:current.head};
    if(![saved.previous,saved.next].some(h=>h.seq===head.seq&&h.hash===head.hash))throw Error('Denetim işlemi zincirle eşleşmiyor.');
    writeHead(head);fs.unlinkSync(pendingFile);
  }
  function append(event){
    recoverPending();
    const previous=db.prepare('SELECT seq,hash FROM audit_ledger ORDER BY seq DESC LIMIT 1').get()||{seq:0,hash:'GENESIS'};
    const saved=JSON.parse(fs.readFileSync(headFile,'utf8')),unsigned={seq:saved.seq,hash:saved.hash};
    if(saved.signature!==digest(JSON.stringify(unsigned),'head')||saved.seq!==previous.seq||saved.hash!==previous.hash)throw Error('Denetim zinciri sonu değişmiş. İşlem durduruldu.');
    const data=JSON.stringify(event),hash=digest(data,previous.hash),next={seq:previous.seq+1,hash};
    const pending={previous,next};atomic(pendingFile,{...pending,signature:digest(JSON.stringify(pending),'pending')});
    db.prepare('INSERT INTO audit_ledger(seq,data,prev_hash,hash) VALUES (?,?,?,?)').run(next.seq,data,previous.hash,hash);
    writeHead(next);fs.unlinkSync(pendingFile);
  }
  try {
  if(!hadAudit){
    writeHead({seq:0,hash:'GENESIS'});
    for(const old of db.prepare('SELECT data FROM events ORDER BY time,id').all())append({...JSON.parse(old.data),migrated:true});
  }
  recoverPending();
  const integrity=verifyAudit();
  if(!integrity.valid)throw Error('Denetim kaydı bütünlüğü doğrulanamadı: '+integrity.reason);
  }catch(error){db.close();throw error;}
  const get=(key,fallback)=>{const row=db.prepare('SELECT value FROM settings WHERE id=?').get(key);return row?JSON.parse(row.value):fallback;};
  const set=(key,value)=>db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key,JSON.stringify(value));
  try{db.exec("CREATE INDEX IF NOT EXISTS audit_event_id ON audit_ledger(json_extract(data,'$.id'))");}catch(error){db.close();throw error;}
  set('schemaVersion',3);
  function recordOnce(event){recoverPending();const row=db.prepare("SELECT data FROM audit_ledger WHERE json_extract(data,'$.id')=?").get(event.id);if(row){if(row.data!==JSON.stringify(event))throw Error('Aynı denetim kimliğiyle farklı içerik reddedildi.');return false;}append(event);return true;}
  let securityQueue;try{securityQueue=openAuditQueue(db,key,'security');securityQueue.flush(recordOnce);}catch(error){db.close();throw error;}
  return {db,get,set,
    atomicSecurity(event,fn){securityQueue.flush(recordOnce);const result=securityQueue.run(event,fn);securityQueue.flush(recordOnce);return result;},
    pendingSecurityAudit:()=>securityQueue.pending(),
    policy:()=>get('policy',{mode:'audit',enabled:rules.map(r=>r.id)}),
    events:()=>db.prepare('SELECT data FROM audit_ledger ORDER BY seq DESC LIMIT 300').all().map(r=>JSON.parse(r.data)),
    tenantAudit:tenant=>db.prepare("SELECT data FROM audit_ledger WHERE json_extract(data,'$.kind')='central' AND json_extract(data,'$.tenant')=? ORDER BY seq DESC LIMIT 300").all(tenant).map(row=>JSON.parse(row.data)),
    record:append,
    recordOnce,
    verifyAudit,
    saveScan(scan){db.prepare('INSERT OR REPLACE INTO scans VALUES (?,?,?)').run(scan.id,scan.finishedAt,JSON.stringify(scan));db.exec('DELETE FROM scans WHERE id NOT IN (SELECT id FROM scans ORDER BY time DESC LIMIT 20)');},
    scans:()=>db.prepare('SELECT data FROM scans ORDER BY time DESC LIMIT 20').all().map(r=>JSON.parse(r.data)),
    getScan(id){const row=db.prepare('SELECT data FROM scans WHERE id=?').get(id);return row?JSON.parse(row.data):null;},
    scanSummaries:()=>db.prepare(`SELECT id, time AS finishedAt, json_extract(data,'$.root') AS root, json_extract(data,'$.files') AS files,
      json_array_length(data,'$.findings') AS flagged, json_extract(data,'$.errors') AS errors,
      json_extract(data,'$.cancelled') AS cancelled, json_extract(data,'$.truncated') AS truncated FROM scans ORDER BY time DESC LIMIT 20`).all(),
    close:()=>db.close()
  };
}
module.exports={openStore};
