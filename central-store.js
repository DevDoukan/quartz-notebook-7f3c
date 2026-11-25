'use strict';
// Central management storage. Actor IDs must come from an authenticated session,
// never from a request body. Endpoint credentials are independent of user roles.
const {DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function openCentral(dir,{now=Date.now,auditKey,serverLicense}={}){
  fs.mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(path.join(dir,'central.sqlite'));
  const hadDispatch=!!db.prepare("SELECT name FROM sqlite_master WHERE name='audit_dispatch'").get();
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships(actor TEXT NOT NULL,tenant TEXT NOT NULL REFERENCES tenants(id),role TEXT NOT NULL CHECK(role IN ('admin','auditor')),PRIMARY KEY(actor,tenant));
    CREATE TABLE IF NOT EXISTS enrollments(hash TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,credential TEXT NOT NULL UNIQUE,revoked INTEGER NOT NULL DEFAULT 0,last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS policies(tenant TEXT PRIMARY KEY REFERENCES tenants(id),revision INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outlook_credentials(hash TEXT PRIMARY KEY,device TEXT NOT NULL UNIQUE REFERENCES devices(id),expires INTEGER NOT NULL,renew_until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS enrollment_receipts(token_hash TEXT PRIMARY KEY,request_hash TEXT NOT NULL,device TEXT NOT NULL REFERENCES devices(id),credential_hash TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_events(device TEXT NOT NULL REFERENCES devices(id),event_id TEXT NOT NULL,received INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(device,event_id));
    CREATE INDEX IF NOT EXISTS devices_tenant ON devices(tenant);
    CREATE INDEX IF NOT EXISTS device_events_received ON device_events(received,device);
    CREATE INDEX IF NOT EXISTS device_events_device_received ON device_events(device,received DESC);
    CREATE TABLE IF NOT EXISTS event_storage(tenant TEXT PRIMARY KEY REFERENCES tenants(id),retention_days INTEGER NOT NULL,max_events INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_status(device TEXT PRIMARY KEY REFERENCES devices(id),reported INTEGER NOT NULL,version TEXT NOT NULL,revision INTEGER NOT NULL,policy_hash TEXT,queued INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_entitlements(device TEXT PRIMARY KEY REFERENCES devices(id),sequence INTEGER NOT NULL,document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,signature TEXT NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(outlook_credentials)').all().some(column=>column.name==='renew_until')){
    db.exec('ALTER TABLE outlook_credentials ADD COLUMN renew_until INTEGER NOT NULL DEFAULT 0');
  }
  // Reconcile once at startup, including databases restored from older releases.
  // Triggers then keep quota counters in the same transaction as event changes.
  try{db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS event_counts(tenant TEXT PRIMARY KEY REFERENCES tenants(id),events INTEGER NOT NULL CHECK(events>=0));
    CREATE TABLE IF NOT EXISTS event_total(id INTEGER PRIMARY KEY CHECK(id=1),events INTEGER NOT NULL CHECK(events>=0));
    DELETE FROM event_counts;
    INSERT INTO event_counts SELECT d.tenant,count(*) FROM device_events e JOIN devices d ON d.id=e.device GROUP BY d.tenant;
    INSERT OR REPLACE INTO event_total VALUES(1,(SELECT coalesce(sum(events),0) FROM event_counts));
    CREATE TRIGGER IF NOT EXISTS event_count_insert AFTER INSERT ON device_events BEGIN
      INSERT INTO event_counts VALUES((SELECT tenant FROM devices WHERE id=NEW.device),1) ON CONFLICT(tenant) DO UPDATE SET events=events+1;
      UPDATE event_total SET events=events+1 WHERE id=1;
    END;
    CREATE TRIGGER IF NOT EXISTS event_count_delete AFTER DELETE ON device_events BEGIN
      UPDATE event_counts SET events=events-1 WHERE tenant=(SELECT tenant FROM devices WHERE id=OLD.device);
      UPDATE event_total SET events=events-1 WHERE id=1;
    END;
    CREATE TRIGGER IF NOT EXISTS event_count_move AFTER UPDATE OF device ON device_events WHEN OLD.device<>NEW.device BEGIN
      UPDATE event_counts SET events=events-1 WHERE tenant=(SELECT tenant FROM devices WHERE id=OLD.device);
      INSERT INTO event_counts VALUES((SELECT tenant FROM devices WHERE id=NEW.device),1) ON CONFLICT(tenant) DO UPDATE SET events=events+1;
    END;
    CREATE TRIGGER IF NOT EXISTS device_tenant_immutable BEFORE UPDATE OF tenant ON devices WHEN OLD.tenant<>NEW.tenant BEGIN
      SELECT RAISE(ABORT,'Device tenant is immutable; enroll a new device');
    END;
    COMMIT;`);}catch(error){try{db.exec('ROLLBACK');}finally{db.close();}throw error;}
  if(!db.prepare('PRAGMA table_info(audit_outbox)').all().some(column=>column.name==='signature'))db.exec("ALTER TABLE audit_outbox ADD COLUMN signature TEXT NOT NULL DEFAULT ''");
  function sign(data){if(!Buffer.isBuffer(auditKey)||auditKey.length!==32)throw Error('Merkezi denetim anahtarı gerekiyor.');return crypto.createHmac('sha256',auditKey).update('central-outbox-v1\n'+data).digest('hex');}
  const stateSignature=(queued,delivered)=>sign('dispatch:'+queued+':'+delivered);
  function dispatch(){const row=db.prepare('SELECT * FROM audit_dispatch WHERE id=1').get();if(!row||!Number.isSafeInteger(row.queued)||!Number.isSafeInteger(row.delivered)||row.queued<row.delivered||row.delivered<0||row.signature!==stateSignature(row.queued,row.delivered))throw Error('Merkezi denetim kuyruk sonu doğrulanamadı.');return row;}
  try{if(auditKey){db.exec('CREATE TABLE IF NOT EXISTS audit_dispatch(id INTEGER PRIMARY KEY CHECK(id=1),queued INTEGER NOT NULL,delivered INTEGER NOT NULL,signature TEXT NOT NULL)');if(!hadDispatch){if(db.prepare('SELECT count(*) n FROM audit_outbox').get().n)throw Error('Eski bekleyen merkezi denetim kuyruğu için kontrollü göç gerekir.');db.prepare('INSERT INTO audit_dispatch VALUES(1,0,0,?)').run(stateSignature(0,0));}dispatch();}}catch(error){db.close();throw error;}
  let inTransaction=false;
  function transaction(fn){if(inTransaction)return fn();db.exec('BEGIN IMMEDIATE');inTransaction=true;try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}finally{inTransaction=false;}}
  function text(value,max=120){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw Error('Geçersiz metin.');return value.trim();}
  function allowed(actor,tenant,write=false){const row=db.prepare('SELECT role FROM memberships WHERE actor=? AND tenant=?').get(actor,tenant);if(!row||(write&&row.role!=='admin')){const error=Error('Bu şirkete erişim yetkiniz yok.');error.status=403;throw error;}}
  function device(token,outlook=false){
    let row;
    if(outlook&&typeof token==='string'&&/^o1_[a-f0-9]{64}$/.test(token)){
      row=db.prepare('SELECT d.* FROM devices d JOIN outlook_credentials o ON o.device=d.id WHERE o.hash=? AND o.expires>? AND d.revoked=0').get(digest(token),now());
    }else{
      if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Geçersiz ajan kimliği.');
      row=db.prepare('SELECT * FROM devices WHERE credential=? AND revoked=0').get(digest(token));
    }
    if(!row)throw Error('Geçersiz ajan kimliği.');
    return row;
  }
  function invalidateRegistrations(tenant){db.prepare('DELETE FROM enrollments WHERE tenant=?').run(tenant);db.prepare('DELETE FROM enrollment_receipts WHERE device IN (SELECT id FROM devices WHERE tenant=?)').run(tenant);}
  function storage(tenant){const config=db.prepare('SELECT retention_days AS retentionDays,max_events AS maxEvents FROM event_storage WHERE tenant=?').get(tenant)||{retentionDays:0,maxEvents:100000};return {...config,events:db.prepare('SELECT events FROM event_counts WHERE tenant=?').get(tenant)?.events||0};}
  return {
    issueOutlookCredential(token){
      const row=device(token),credential='o1_'+crypto.randomBytes(32).toString('hex'),expires=now()+15*60*1000;
      transaction(()=>{
        db.prepare('DELETE FROM outlook_credentials WHERE expires<=? OR device=?').run(now(),row.id);
        db.prepare('INSERT INTO outlook_credentials(hash,device,expires,renew_until) VALUES(?,?,?,?)').run(digest(credential),row.id,expires,now()+8*60*60*1000);
      });
      return {credential,expires};
    },
    renewOutlookCredential(token){
      if(typeof token!=='string'||!/^o1_[a-f0-9]{64}$/.test(token))throw Error('Geçersiz Outlook kimliği.');
      return transaction(()=>{
        const row=device(token,true);
        const session=db.prepare('SELECT renew_until FROM outlook_credentials WHERE hash=?').get(digest(token));
        if(!session||session.renew_until<=now())throw Error('Outlook bağlantısı yeniden kurulmalı.');
        const credential='o1_'+crypto.randomBytes(32).toString('hex');
        const expires=Math.min(now()+15*60*1000,session.renew_until);
        db.prepare('UPDATE outlook_credentials SET hash=?,expires=? WHERE device=?').run(digest(credential),expires,row.id);
        return {credential,expires};
      });
    },
    audited(event,fn){if(typeof fn!=='function'||fn.constructor.name==='AsyncFunction')throw Error('Denetimli işlem eşzamanlı olmalı.');return transaction(()=>{const state=dispatch(),result=fn();if(result&&typeof result.then==='function')throw Error('Denetimli işlem eşzamanlı olmalı.');const eventData=typeof event==='function'?event(result):event;if(!eventData||typeof eventData.id!=='string'||typeof eventData.summary!=='string')throw Error('Geçersiz denetim olayı.');const data=JSON.stringify(eventData),insert=db.prepare('INSERT INTO audit_outbox(id,data,signature) VALUES (?,?,?)').run(eventData.id,data,sign(data)),queued=Number(insert.lastInsertRowid);if(queued!==state.queued+1)throw Error('Merkezi denetim sıra numarası değişmiş.');db.prepare('UPDATE audit_dispatch SET queued=?,signature=? WHERE id=1').run(queued,stateSignature(queued,state.delivered));return result;});},
    flushAudit(recordOnce){const state=dispatch(),rows=db.prepare('SELECT seq,data,signature FROM audit_outbox ORDER BY seq').all();if(rows.length!==state.queued-state.delivered||rows.some((row,index)=>row.seq!==state.delivered+index+1))throw Error('Bekleyen merkezi denetim kaydı silinmiş veya sırası değişmiş.');for(const row of rows){const expected=sign(row.data);if(!/^[a-f0-9]{64}$/.test(row.signature)||!crypto.timingSafeEqual(Buffer.from(row.signature,'hex'),Buffer.from(expected,'hex')))throw Error('Bekleyen merkezi denetim kaydı değiştirilmiş.');recordOnce(JSON.parse(row.data));transaction(()=>{db.prepare('DELETE FROM audit_outbox WHERE seq=?').run(row.seq);db.prepare('UPDATE audit_dispatch SET delivered=?,signature=? WHERE id=1').run(row.seq,stateSignature(state.queued,row.seq));});}},
    pendingAudit(){return db.prepare('SELECT count(*) n FROM audit_outbox').get().n;},
    entitlement(token,signing){const row=device(token);if(!serverLicense?.document)return null;return transaction(()=>{
      const license=serverLicense.status(),vendorLease=serverLicense.document(),at=now();if(!vendorLease||!license.allowed||!Number.isFinite(Date.parse(license.expiresAt))||Date.parse(license.expiresAt)<=at)return null;
      const seat=db.prepare('SELECT count(*) n FROM devices WHERE revoked=0 AND rowid<=(SELECT rowid FROM devices WHERE id=?)').get(row.id).n;if(seat>license.deviceLimit)return null;
      const previous=db.prepare('SELECT sequence,document FROM device_entitlements WHERE device=?').get(row.id);if(previous){const document=JSON.parse(previous.document),value=JSON.parse(document.payload);if(Date.parse(value.issuedAt)>at+60000)throw Error('Client yetki saati geri alınmış.');if(JSON.stringify(value.vendorLease)===JSON.stringify(vendorLease)&&Date.parse(value.expiresAt)>at+300000)return document;}
      const sequence=(previous?.sequence||0)+1;if(!Number.isSafeInteger(sequence))throw Error('Client yetki sırası sınırı aşıldı.');const value={schema:1,product:'kalkan-dlp-client-entitlement',deviceId:row.id,serverId:license.serverId,sequence,issuedAt:new Date(at).toISOString(),expiresAt:new Date(Math.min(at+3600000,Date.parse(license.expiresAt))).toISOString(),vendorLease},document=signing.sign(value);
      db.prepare('INSERT INTO device_entitlements VALUES(?,?,?) ON CONFLICT(device) DO UPDATE SET sequence=excluded.sequence,document=excluded.document').run(row.id,sequence,JSON.stringify(document));return document;
    });},
    storage(actor,tenant){allowed(actor,tenant);return storage(tenant);},
    setStorage(actor,tenant,input){allowed(actor,tenant,true);if(!Number.isSafeInteger(input?.retentionDays)||input.retentionDays<0||input.retentionDays>3650||!Number.isSafeInteger(input.maxEvents)||input.maxEvents<100||input.maxEvents>100000)throw Error('Geçersiz olay saklama ayarı.');const previous=storage(tenant);if(input.retentionDays>0&&(previous.retentionDays===0||input.retentionDays<previous.retentionDays)&&input.acknowledgeDeletion!==true)throw Error('Süre dolan olayların silinmesi açıkça onaylanmalı.');db.prepare('INSERT INTO event_storage VALUES(?,?,?) ON CONFLICT(tenant) DO UPDATE SET retention_days=excluded.retention_days,max_events=excluded.max_events').run(tenant,input.retentionDays,input.maxEvents);return storage(tenant);},
    retentionTenants(){return db.prepare('SELECT s.tenant FROM event_storage s WHERE s.retention_days>0 AND EXISTS(SELECT 1 FROM device_events e JOIN devices d ON d.id=e.device WHERE d.tenant=s.tenant AND e.received<?-s.retention_days*86400000) ORDER BY s.tenant').all(now()).map(row=>row.tenant);},
    pruneEvents(tenant){return transaction(()=>{const config=db.prepare('SELECT retention_days FROM event_storage WHERE tenant=?').get(tenant);if(!config?.retention_days)return {deleted:0,cutoff:null};const cutoff=now()-config.retention_days*86400000;const result=db.prepare('DELETE FROM device_events WHERE rowid IN (SELECT e.rowid FROM device_events e JOIN devices d ON d.id=e.device WHERE d.tenant=? AND e.received<? ORDER BY e.received,e.rowid LIMIT 1000)').run(tenant,cutoff);return {deleted:Number(result.changes),cutoff};});},
    assertAdministration(activeActors){const active=new Set(activeActors);const tenants=db.prepare('SELECT id FROM tenants').all();for(const tenant of tenants){const admins=db.prepare("SELECT actor FROM memberships WHERE tenant=? AND role='admin'").all(tenant.id);if(!admins.some(member=>active.has(member.actor)))throw Error('Bir şirketin son etkin yöneticisi devre dışı bırakılamaz. Önce başka yönetici atayın.');}},
    invalidateEnrollmentForActor(target){return transaction(()=>{for(const row of db.prepare('SELECT tenant FROM memberships WHERE actor=?').all(target))invalidateRegistrations(row.tenant);});},
    members(actor,tenant){allowed(actor,tenant,true);return db.prepare('SELECT actor,role FROM memberships WHERE tenant=? ORDER BY actor').all(tenant);},
    removeMember(actor,tenant,target){allowed(actor,tenant,true);if(actor===target)throw Error('Kendi şirket erişiminizi kaldıramazsınız.');return transaction(()=>{const result=db.prepare('DELETE FROM memberships WHERE actor=? AND tenant=?').run(target,tenant);if(!result.changes)throw Error('Şirket üyeliği bulunamadı.');invalidateRegistrations(tenant);});},
    // Bootstrap/internal provisioning only: do not expose as an unguarded route.
    createTenant(actor,name){text(actor,100);const id=crypto.randomUUID();transaction(()=>{db.prepare('INSERT INTO tenants VALUES (?,?)').run(id,text(name));db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(actor,id,'admin');});return {id,name};},
    tenants(actor){return db.prepare('SELECT t.id,t.name,m.role FROM tenants t JOIN memberships m ON m.tenant=t.id WHERE m.actor=? ORDER BY t.name').all(actor);},
    grant(actor,tenant,target,role){allowed(actor,tenant,true);text(target,100);if(!['admin','auditor'].includes(role))throw Error('Geçersiz rol.');if(actor===target&&role!=='admin')throw Error('Kendi yönetici erişiminizi kaldıramazsınız.');return transaction(()=>{const previous=db.prepare('SELECT role FROM memberships WHERE actor=? AND tenant=?').get(target,tenant);db.prepare('INSERT INTO memberships VALUES (?,?,?) ON CONFLICT(actor,tenant) DO UPDATE SET role=excluded.role').run(target,tenant,role);if(previous&&previous.role!==role)invalidateRegistrations(tenant);});},
    issueEnrollment(actor,tenant){allowed(actor,tenant,true);const token=crypto.randomBytes(32).toString('hex'),expires=now()+15*60*1000;db.prepare('DELETE FROM enrollments WHERE expires<=?').run(now());db.prepare('DELETE FROM enrollment_receipts WHERE expires<=?').run(now());db.prepare('INSERT INTO enrollments VALUES (?,?,?)').run(digest(token),tenant,expires);return {token,expires};},
    enroll(token,name,retry){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Geçersiz kayıt anahtarı.');const label=text(name);if(retry&&(typeof retry.requestId!=='string'||typeof retry.credential!=='string'||!/^[a-f0-9]{64}$/.test(retry.requestId)||!/^[a-f0-9]{64}$/.test(retry.credential)))throw Error('Geçersiz kayıt tekrar kimliği.');return transaction(()=>{
      const tokenHash=digest(token);db.prepare('DELETE FROM enrollment_receipts WHERE expires<=?').run(now());
      if(retry){const receipt=db.prepare('SELECT r.*,d.tenant,d.name,d.revoked,d.credential AS current_credential FROM enrollment_receipts r JOIN devices d ON d.id=r.device WHERE token_hash=?').get(tokenHash);if(receipt){if(receipt.request_hash!==digest(retry.requestId)||receipt.credential_hash!==digest(retry.credential)||receipt.name!==label||receipt.revoked||receipt.current_credential!==receipt.credential_hash)throw Error('Kayıt tekrar kimliği uyuşmuyor veya cihaz iptal edilmiş.');return {id:receipt.device,tenant:receipt.tenant,credential:retry.credential,replayed:true};}}
      const row=db.prepare('SELECT * FROM enrollments WHERE hash=? AND expires>?').get(tokenHash,now());if(!row)throw Error('Kayıt anahtarı geçersiz, kullanılmış veya süresi dolmuş.');
      if(serverLicense){const license=serverLicense.status(),count=db.prepare('SELECT count(*) n FROM devices WHERE revoked=0').get().n;if(!license.allowed||!Number.isSafeInteger(license.deviceLimit)||license.deviceLimit<=count){const error=Error('Üretici sunucu lisansı etkin değil veya cihaz kotası dolu.');error.status=402;throw error;}}
      const id=crypto.randomUUID(),credential=retry?retry.credential:crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO devices VALUES (?,?,?,?,0,?)').run(id,row.tenant,label,digest(credential),now());db.prepare('DELETE FROM enrollments WHERE hash=?').run(row.hash);if(retry)db.prepare('INSERT INTO enrollment_receipts VALUES(?,?,?,?,?)').run(tokenHash,digest(retry.requestId),id,digest(credential),row.expires);return {id,tenant:row.tenant,credential,...(retry?{replayed:false}:{})};});},
    devices(actor,tenant){allowed(actor,tenant);const policy=db.prepare('SELECT revision,data FROM policies WHERE tenant=?').get(tenant),expectedHash=policy?digest(JSON.stringify({revision:policy.revision,...JSON.parse(policy.data)})):null;return db.prepare('SELECT d.id,d.name,d.revoked,d.last_seen AS lastSeen,s.reported,s.version,s.revision,s.policy_hash,s.queued FROM devices d LEFT JOIN device_status s ON s.device=d.id WHERE d.tenant=? ORDER BY d.name').all(tenant).map(row=>({id:row.id,name:row.name,revoked:row.revoked,lastSeen:row.lastSeen,policyStatus:row.reported===null?null:{reportedAt:row.reported,agentVersion:row.version,policyRevision:row.revision,queuedEvents:row.queued,state:!policy?(row.revision===0?'unassigned':'ahead'):row.revision===0?'awaiting':row.revision<policy.revision?'outdated':row.revision>policy.revision?'ahead':row.policy_hash===expectedHash?'current':'mismatch'}}));},
    policy(actor,tenant){allowed(actor,tenant);const row=db.prepare('SELECT revision,data FROM policies WHERE tenant=?').get(tenant);return row?{revision:row.revision,...JSON.parse(row.data)}:null;},
    revoke(actor,tenant,id){allowed(actor,tenant,true);return transaction(()=>{const result=db.prepare('UPDATE devices SET revoked=1 WHERE id=? AND tenant=?').run(id,tenant);if(!result.changes)throw Error('Ajan bulunamadı.');db.prepare('DELETE FROM outlook_credentials WHERE device=?').run(id);});},
    setPolicy(actor,tenant,input){allowed(actor,tenant,true);if(!input||!['audit','block'].includes(input.mode)||!Array.isArray(input.enabled)||input.enabled.length>100||input.enabled.some(x=>typeof x!=='string'||x.length>80)||(input.usbWriteProtection!==undefined&&input.usbWriteProtection!==null&&typeof input.usbWriteProtection!=='boolean'))throw Error('Geçersiz politika.');const previous=db.prepare('SELECT data FROM policies WHERE tenant=?').get(tenant);const previousPolicy=previous?JSON.parse(previous.data):{};const domains=input.internalDomains===undefined?previousPolicy.internalDomains:require('./policy-domains').normalizeInternalDomains(input.internalDomains);const outlookExternalRecipients=input.outlookExternalRecipients===undefined?previousPolicy.outlookExternalRecipients:input.outlookExternalRecipients;if(outlookExternalRecipients!==undefined&&typeof outlookExternalRecipients!=='boolean')throw Error('Geçersiz Outlook dış alıcı politikası.');if(outlookExternalRecipients&&!domains?.length)throw Error('Outlook dış alıcı politikası için en az bir iç alan adı gerekir.');const data=JSON.stringify({mode:input.mode,enabled:[...new Set(input.enabled)],usbWriteProtection:input.usbWriteProtection??null,...(domains===undefined?{}:{internalDomains:domains}),...(outlookExternalRecipients===undefined?{}:{outlookExternalRecipients})});return transaction(()=>{const revision=(db.prepare('SELECT revision FROM policies WHERE tenant=?').get(tenant)?.revision||0)+1;db.prepare('INSERT INTO policies VALUES (?,?,?) ON CONFLICT(tenant) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(tenant,revision,data);return revision;});},
    heartbeat(token,input,outlook=false){const row=device(token,outlook);return transaction(()=>{if(input?.status!==undefined){const status=input.status;if(!status||status.protocol!==1||typeof status.agentVersion!=='string'||status.agentVersion.length>60||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(status.agentVersion)||!Number.isSafeInteger(status.policyRevision)||status.policyRevision<0||!Number.isSafeInteger(status.queuedEvents)||status.queuedEvents<0||status.queuedEvents>10000||(status.policyRevision===0?status.policyHash!==null:typeof status.policyHash!=='string'||!/^[a-f0-9]{64}$/.test(status.policyHash)))throw Error('Geçersiz ajan durum raporu.');db.prepare('INSERT INTO device_status VALUES(?,?,?,?,?,?) ON CONFLICT(device) DO UPDATE SET reported=excluded.reported,version=excluded.version,revision=excluded.revision,policy_hash=excluded.policy_hash,queued=excluded.queued').run(row.id,now(),status.agentVersion,status.policyRevision,status.policyHash,status.queuedEvents);}db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(now(),row.id);const policy=db.prepare('SELECT revision,data FROM policies WHERE tenant=?').get(row.tenant);return {deviceId:row.id,tenant:row.tenant,policy:policy?{revision:policy.revision,...JSON.parse(policy.data)}:null};});},
    ingest(token,input,outlook=false){const row=device(token,outlook);if(!input||!['allow','warn','block'].includes(input.decision)||!Number.isSafeInteger(input.count)||input.count<0||input.count>1000000)throw Error('Geçersiz olay.');const id=text(input.id,80);const data=JSON.stringify({kind:text(input.kind,40),decision:input.decision,count:input.count});return transaction(()=>{const existing=db.prepare('SELECT data FROM device_events WHERE device=? AND event_id=?').get(row.id,id);if(existing){if(existing.data!==data)throw Error('Aynı olay kimliği farklı içerikle kullanılamaz.');return {accepted:false};}const state=storage(row.tenant);if(state.events>=state.maxEvents||db.prepare('SELECT events FROM event_total WHERE id=1').get().events>=1000000){const error=Error('Merkez olay kapasitesi dolu. Olay ajan kuyruğunda tutulmalı.');error.status=507;throw error;}db.prepare('INSERT INTO device_events VALUES (?,?,?,?)').run(row.id,id,now(),data);return {accepted:true};});},
    events(actor,tenant){allowed(actor,tenant);return db.prepare('SELECT e.device,e.event_id AS id,e.received,e.data FROM device_events e JOIN devices d ON d.id=e.device WHERE d.tenant=? ORDER BY e.received DESC LIMIT 300').all(tenant).map(row=>({...row,data:JSON.parse(row.data)}));},
    close(){db.close();}
  };
}
module.exports={openCentral};
