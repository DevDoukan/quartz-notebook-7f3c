'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const fs=require('node:fs');
const path=require('node:path');
const scrypt=promisify(crypto.scrypt);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const SESSION_MS=8*60*60*1000,IDLE_MS=30*60*1000;
function same(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&crypto.timingSafeEqual(left,right);}
function userInput(input){
  if(typeof input.username!=='string'||!/^[a-zA-Z0-9._-]{3,64}$/.test(input.username))throw Error('Kullanıcı adı 3–64 harf, rakam, nokta, alt çizgi veya tire içermeli.');
  if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)throw Error('Parola 12–128 karakter olmalı.');
  if(!['admin','operator','auditor'].includes(input.role))throw Error('Geçersiz kullanıcı rolü.');
  return {...input,username:input.username.toLowerCase()};
}
async function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')){
  const value=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return {salt,hash:value.toString('hex')};
}
function openAuth(store,dir,{now=Date.now,secureCookies=false,cookieName='kalkan_session',verifySecondFactor=()=>true}={}){
  if(!/^[a-zA-Z0-9_]{1,64}$/.test(cookieName))throw Error('Geçersiz oturum çerezi adı.');
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, created INTEGER NOT NULL, touched INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits (identity TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
  const setupFile=path.join(dir,'setup-key.txt');
  const configured=()=>db.prepare('SELECT COUNT(*) AS n FROM users').get().n>0;
  if(!configured()&&!fs.existsSync(setupFile))fs.writeFileSync(setupFile,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
  const publicUser=row=>({id:row.id,username:row.username,role:row.role,enabled:!!row.enabled,createdAt:row.created_at});
  const users=()=>db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser);
  const securityEvent=(actor,summary,details)=>({id:crypto.randomUUID(),time:new Date(now()).toISOString(),kind:'auth',actor,summary,details});
  async function createUser(input,{actor='system',summary='Kullanıcı oluşturuldu'}={}){
    const value=userInput(input);
    if(db.prepare('SELECT id FROM users WHERE username=?').get(value.username))throw Error('Bu kullanıcı adı zaten var.');
    const derived=await passwordHash(value.password),id=crypto.randomUUID();
    return store.atomicSecurity(securityEvent(actor,summary,{targetUser:value.username,role:value.role}),()=>{db.prepare('INSERT INTO users VALUES (?,?,?,?,?,1,?)').run(id,value.username,value.role,derived.salt,derived.hash,new Date(now()).toISOString());return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));});
  }
  function session(user,res){
    const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex'),at=now();
    db.prepare('DELETE FROM sessions WHERE expires<? OR touched<?').run(at,at-IDLE_MS);
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)').run(hash(token),user.id,csrf,at,at,at+SESSION_MS);
    res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS/1000}${secureCookies?'; Secure':''}`);
    return {user:publicUser(user),token:csrf};
  }
  function authenticate(req){
    const value=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(!value||!/^[a-f0-9]{64}$/.test(value))return null;
    const row=db.prepare('SELECT s.*, u.username,u.role,u.enabled,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash(value));
    if(!row||!row.enabled||row.expires<=now()||row.touched<=now()-IDLE_MS)return null;
    db.prepare('UPDATE sessions SET touched=? WHERE token_hash=?').run(now(),row.token_hash);
    return {id:row.user_id,username:row.username,role:row.role,csrf:row.csrf,sessionHash:row.token_hash};
  }
  function checkLimit(identity){
    const value=db.prepare('SELECT * FROM login_limits WHERE identity=?').get(identity);
    if(value&&value.reset_at>now()&&value.attempts>=8){const e=Error('Çok fazla başarısız giriş. 15 dakika sonra tekrar deneyin.');e.status=429;throw e;}
  }
  function failure(identity){const value=db.prepare('SELECT * FROM login_limits WHERE identity=?').get(identity);db.prepare('INSERT OR REPLACE INTO login_limits VALUES (?,?,?)').run(identity,value&&value.reset_at>now()?value.attempts+1:1,value&&value.reset_at>now()?value.reset_at:now()+15*60*1000);}
  let setupBusy=false,loginBusy=0;
  async function setup(input,res){
    checkLimit('setup');
    if(configured()||setupBusy)throw Error('İlk yönetici kurulumu zaten tamamlandı veya sürüyor.');
    if(!same(input.setupKey,fs.readFileSync(setupFile,'utf8').trim())){failure('setup');throw Error('Kurulum anahtarı geçersiz. Başlat dosyasını veya yerel setup-key.txt dosyasını kullanın.');}
    setupBusy=true;
    try{const user=await createUser({...input,role:'admin'},{actor:input.username.toLowerCase(),summary:'İlk yönetici oluşturuldu'});fs.unlinkSync(setupFile);return session(db.prepare('SELECT * FROM users WHERE id=?').get(user.id),res);}finally{setupBusy=false;}
  }
  async function login(input,res){
    checkLimit('login');
    if(loginBusy>=2){const e=Error('Giriş servisi meşgul. Biraz sonra tekrar deneyin.');e.status=429;throw e;}
    loginBusy++;
    try {
    const username=typeof input.username==='string'?input.username.toLowerCase():'';
    const row=db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const password=typeof input.password==='string'&&input.password.length<=128?input.password:'';
    const derived=await passwordHash(password,row?.salt||'00000000000000000000000000000000');
    if(!row||!row.enabled||!same(row.password_hash,derived.hash)||!verifySecondFactor(row.id,input.otp)){failure('login');store.record({id:crypto.randomUUID(),time:new Date(now()).toISOString(),kind:'auth',summary:'Başarısız giriş',actor:'anonymous'});const e=Error('Kullanıcı adı, parola veya doğrulama kodu geçersiz.');e.status=401;throw e;}
    db.prepare('DELETE FROM login_limits WHERE identity=?').run('login');
    store.record({id:crypto.randomUUID(),time:new Date(now()).toISOString(),kind:'auth',summary:'Kullanıcı giriş yaptı',actor:row.username});return session(row,res);
    }finally{loginBusy--;}
  }
  function logout(user,res){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.sessionHash);res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies?'; Secure':''}`);}
  function updateUser(id,input,current){
    const row=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!row)throw Error('Kullanıcı bulunamadı.');
    if(!['admin','operator','auditor'].includes(input.role)||typeof input.enabled!=='boolean')throw Error('Geçersiz kullanıcı ayarı.');
    if(id===current.id&&(!input.enabled||input.role!=='admin'))throw Error('Kendi yönetici erişiminizi kaldıramazsınız.');
    if(row.role==='admin'&&row.enabled&&(!input.enabled||input.role!=='admin')&&db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND enabled=1").get().n<=1)throw Error('Son etkin yönetici kaldırılamaz.');
    return store.atomicSecurity(securityEvent(current.username||current.id,'Kullanıcı erişimi güncellendi',{targetUser:row.username,role:input.role,enabled:input.enabled}),()=>{db.prepare('UPDATE users SET role=?,enabled=? WHERE id=?').run(input.role,Number(input.enabled),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));});
  }
  async function changePassword(user,input){
    const row=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if(typeof input.currentPassword!=='string'||input.currentPassword.length>128)throw Error('Mevcut parola geçersiz.');
    const old=await passwordHash(input.currentPassword,row.salt);if(!same(old.hash,row.password_hash))throw Error('Mevcut parola geçersiz.');
    userInput({username:row.username,password:input.newPassword,role:row.role});const next=await passwordHash(input.newPassword);
    store.atomicSecurity(securityEvent(user.username||user.id,'Kullanıcı parolası değiştirildi',{}),()=>{const result=db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=? AND password_hash=? AND enabled=1').run(next.salt,next.hash,user.id,row.password_hash);if(!result.changes)throw Error('Hesap işlem sırasında değişti. Yeniden giriş yapın.');db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);});
  }
  async function reauthenticate(user,password){const identity='reauth:'+user.id;checkLimit(identity);if(loginBusy>=2)throw Error('Kimlik doğrulama meşgul.');loginBusy++;try{const row=db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(user.id);const derived=await passwordHash(typeof password==='string'&&password.length<=128?password:'',row?.salt||'00000000000000000000000000000000');if(!row||!same(row.password_hash,derived.hash)){failure(identity);throw Error('Mevcut parola geçersiz.');}db.prepare('DELETE FROM login_limits WHERE identity=?').run(identity);return true;}finally{loginBusy--;}}
  function revokeSessions(id){db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);}
  return {configured,setup,login,authenticate,logout,users,createUser,updateUser,changePassword,reauthenticate,revokeSessions,same};
}
module.exports={openAuth,passwordHash,userInput,same,SESSION_MS,IDLE_MS};
