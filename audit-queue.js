'use strict';
const crypto=require('node:crypto');
// Only fixed, internal namespace names are accepted; never request parameters.
function openAuditQueue(db,key,namespace){
 if(!/^[a-z]{1,20}$/.test(namespace)||!Buffer.isBuffer(key)||key.length!==32)throw Error('Geçersiz denetim kuyruğu yapılandırması.');
 const queue=namespace+'_audit_outbox',head=namespace+'_audit_dispatch';
 const existed=!!db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(head);
 const sign=data=>crypto.createHmac('sha256',key).update(namespace+'-audit-v1\n'+data).digest('hex');
 const stateMac=(queued,delivered)=>sign('state:'+queued+':'+delivered);
 db.exec(`CREATE TABLE IF NOT EXISTS ${queue}(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,signature TEXT NOT NULL);CREATE TABLE IF NOT EXISTS ${head}(id INTEGER PRIMARY KEY CHECK(id=1),queued INTEGER NOT NULL,delivered INTEGER NOT NULL,signature TEXT NOT NULL)`);
 if(!existed){if(db.prepare(`SELECT count(*) n FROM ${queue}`).get().n)throw Error('Denetim kuyruğunun kontrollü göçü gerekiyor.');db.prepare(`INSERT INTO ${head} VALUES(1,0,0,?)`).run(stateMac(0,0));}
 function state(){const row=db.prepare(`SELECT * FROM ${head} WHERE id=1`).get();if(!row||!Number.isSafeInteger(row.queued)||!Number.isSafeInteger(row.delivered)||row.delivered<0||row.queued<row.delivered||row.signature!==stateMac(row.queued,row.delivered))throw Error('Güvenlik denetimi kuyruk sonu doğrulanamadı.');return row;}
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 state();
 return {
  run(event,fn){if(typeof fn!=='function'||fn.constructor.name==='AsyncFunction')throw Error('Denetimli işlem eşzamanlı olmalı.');return transaction(()=>{const previous=state(),result=fn();if(result&&typeof result.then==='function')throw Error('Denetimli işlem eşzamanlı olmalı.');const value=typeof event==='function'?event(result):event;if(!value||typeof value.id!=='string'||typeof value.summary!=='string')throw Error('Geçersiz güvenlik denetim olayı.');const data=JSON.stringify(value),insert=db.prepare(`INSERT INTO ${queue}(id,data,signature) VALUES(?,?,?)`).run(value.id,data,sign('event:'+data)),seq=Number(insert.lastInsertRowid);if(seq!==previous.queued+1)throw Error('Güvenlik denetim sırası değişmiş.');db.prepare(`UPDATE ${head} SET queued=?,signature=? WHERE id=1`).run(seq,stateMac(seq,previous.delivered));return result;});},
  flush(recordOnce){const previous=state(),rows=db.prepare(`SELECT * FROM ${queue} ORDER BY seq`).all();if(rows.length!==previous.queued-previous.delivered||rows.some((row,index)=>row.seq!==previous.delivered+index+1))throw Error('Bekleyen güvenlik denetim kaydı silinmiş.');for(const row of rows){const expected=sign('event:'+row.data);if(!/^[a-f0-9]{64}$/.test(row.signature)||!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(row.signature,'hex')))throw Error('Bekleyen güvenlik denetim kaydı değiştirilmiş.');recordOnce(JSON.parse(row.data));transaction(()=>{db.prepare(`DELETE FROM ${queue} WHERE seq=?`).run(row.seq);db.prepare(`UPDATE ${head} SET delivered=?,signature=? WHERE id=1`).run(row.seq,stateMac(previous.queued,row.seq));});}},
  pending(){return db.prepare(`SELECT count(*) n FROM ${queue}`).get().n;}
 };
}
module.exports={openAuditQueue};
