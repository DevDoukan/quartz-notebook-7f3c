'use strict';
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {openCentral}=require('./central-store'),{openStore}=require('./store'),{openAuth}=require('./auth'),{acquireLock}=require('./runtime-lock');
const {rules}=require('./detector');
const {openSigning}=require('./central-signing');
const {openMfa}=require('./mfa');
function createCentralApp({dataDir=path.join(__dirname,'central-data'),publicOrigin,tls,now=Date.now,requireMfa=!!tls,serviceMode=null,serverLicense,licenseFactory}={}){
  if(serviceMode&&(!['console-test','windows-service','systemd'].includes(serviceMode)||!tls||!requireMfa))throw Error('Merkez hizmeti geçerli hizmet kipi, TLS ve zorunlu MFA gerektirir.');
  const origin=publicOrigin?new URL(publicOrigin):null;
  if(origin&&(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!['http:','https:'].includes(origin.protocol)))throw Error('Geçersiz merkez adresi.');
  if(origin&&origin.protocol!==(tls?'https:':'http:'))throw Error('Merkez adresi TLS yapılandırmasıyla eşleşmiyor.');
  if(!tls&&origin&&!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Uzak merkez bağlantısı TLS gerektirir.');
  if(tls&&!origin)throw Error('TLS merkezi için publicOrigin zorunludur.');
  const unlock=acquireLock(dataDir);let store,central,auth,mfa,licenseRuntime;
  try{store=openStore(dataDir);auth=openAuth(store,dataDir,{now,secureCookies:!!tls,cookieName:'kalkan_central_session',verifySecondFactor:(id,token)=>mfa.verify(id,token)});mfa=openMfa(store,dataDir,{now});if(licenseFactory){licenseRuntime=licenseFactory(store,dataDir,{now});serverLicense=licenseRuntime;}central=openCentral(dataDir,{now,auditKey:fs.readFileSync(path.join(dataDir,'audit-key.bin')),serverLicense});central.flushAudit(store.recordOnce);}catch(e){central?.close();store?.close();unlock();throw e;}
  let signing;try{signing=openSigning(dataDir);}catch(e){central.close();store.close();unlock();throw e;}
  let controlToken;
  try{const controlFile=path.join(dataDir,'central-control-token.txt');if(!fs.existsSync(controlFile))fs.writeFileSync(controlFile,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});controlToken=fs.readFileSync(controlFile,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(controlToken))throw Error('Merkez kontrol anahtarı geçersiz.');}catch(e){central.close();store.close();unlock();throw e;}
  let busy=0,closePromise;
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});res.end(JSON.stringify(value));};
  async function body(req,maxBytes=16384){let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>maxBytes){const e=Error('İstek çok büyük.');e.status=413;throw e;}parts.push(part);}let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('Geçersiz JSON.');}if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Geçersiz istek.');return value;}
  function flushAudit(){try{central.flushAudit(store.recordOnce);}catch{const error=Error('Merkezi denetim teslimi tamamlanamadı.');error.status=503;throw error;}}
  function mutation(actor,operation,tenant,fn,details){flushAudit();const result=central.audited(value=>({id:crypto.randomUUID(),time:new Date(now()).toISOString(),kind:'central',actor,summary:operation,...(tenant?{tenant:typeof tenant==='function'?tenant(value):tenant}:{}),...(details?{details:details(value)}:{})}),fn);flushAudit();return result;}
  let maintenanceTimer,serviceStopTimer,lastRetentionTenant='';
  function maintainEvents(){const tenants=central.retentionTenants(),tenant=tenants.find(id=>id>lastRetentionTenant)||tenants[0];if(!tenant)return;mutation('event-retention','Saklama süresi dolan cihaz olayları temizlendi',tenant,()=>central.pruneEvents(tenant),value=>value);lastRetentionTenant=tenant;}
  async function handler(req,res){
    if(busy>=16){req.resume();return send(res,503,{error:'Merkez meşgul.'});}busy++;
    try{
      const expected=origin?.origin||`http://127.0.0.1:${server.address().port}`;
      if(!tls&&!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress))return send(res,403,{error:'TLS gereklidir.'});
      if(req.headers.host!==new URL(expected).host)return send(res,403,{error:'Sunucu adresi reddedildi.'});
      const outlookAsset=/^\/outlook\/(manifest\.xml|runtime\.js|runtime\.html|status\.html|session-ui\.js|icon-(?:64|128)\.png)$/.exec(new URL(req.url,expected).pathname);
      if(req.method==='GET'&&outlookAsset&&tls){
        const files=require('./tools/build-outlook-runtime.cjs').outlookRuntimeFiles(expected);
        const name=outlookAsset[1],extension=path.extname(name);
        const type={'.xml':'application/xml','.js':'text/javascript','.html':'text/html','.png':'image/png'}[extension];
        res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
        return res.end(files[name]);
      }
      if((req.headers.origin&&req.headers.origin!==expected)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'İstek kaynağı reddedildi.'});
      const url=new URL(req.url,expected),route=url.pathname;
      const assets={'/':['index.html','text/html'],'/central.js':['central.js','text/javascript'],'/central.css':['central.css','text/css']};
      if(req.method==='GET'&&assets[route]){const [file,type]=assets[route];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});return res.end(fs.readFileSync(path.join(__dirname,'central-public',file)));}
      if(req.method==='GET'&&route==='/api/health')return send(res,200,{application:'Kalkan DLP Central',version:require('./package.json').version,tls:!!tls,deployment:serviceMode||'portable',processId:process.pid,instanceId:crypto.createHash('sha256').update(controlToken).digest('hex')});
      if(req.method==='POST'&&route==='/api/control/shutdown'){
        if(!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)||!auth.same(req.headers['x-dlp-control'],controlToken))return send(res,403,{error:'Yerel merkez kontrolü reddedildi.'});
        if(serviceMode)return send(res,409,{error:'Merkez hizmet yürütücüsü üzerinden durdurulmalı.'});
        send(res,200,{stopped:true});setImmediate(()=>close());return;
      }
      if(route.startsWith('/api/agent/')){
        // No cookie fallback: a browser session is never an endpoint credential.
        if(req.method!=='POST')return send(res,405,{error:'POST gereklidir.'});
        if(route==='/api/agent/outlook/renew'){
          req.resume();
          if(!tls)return send(res,403,{error:'Outlook yenilemesi için HTTPS gereklidir.'});
          const credential=/^Bearer (o1_[a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
          try{if(!credential)throw Error();central.heartbeat(credential,undefined,true);}
          catch{return send(res,401,{error:'Outlook kimliği doğrulanamadı.'});}
          if(serverLicense&&!serverLicense.status().allowed)return send(res,402,{error:'Üretici sunucu lisansı etkin değil.'});
          try{return send(res,200,central.renewOutlookCredential(credential));}
          catch{return send(res,401,{error:'Outlook bağlantısı yeniden kurulmalı.'});}
        }
        if(route==='/api/agent/outlook/inspect'){
          const credential=/^Bearer ((?:o1_)?[a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
          try{if(!credential)throw Error();central.heartbeat(credential,undefined,true);}
          catch{req.resume();return send(res,401,{error:'Ajan kimliği doğrulanamadı.'});}
          if(serverLicense&&!serverLicense.status().allowed){
            req.resume();return send(res,402,{error:'Üretici sunucu lisansı etkin değil.'});
          }
          const message=await body(req,16*1024*1024);
          const scopedCentral={
            heartbeat:()=>central.heartbeat(credential,undefined,true),
            ingest:(_token,event)=>central.ingest(credential,event,true)
          };
          const result=await require('./outlook-central').inspectRegisteredOutlookMessage(scopedCentral,credential,message);
          if(serverLicense&&!serverLicense.status().allowed)return send(res,402,{error:'Üretici sunucu lisansı etkin değil.'});
          return send(res,200,result);
        }
        const input=await body(req),token=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
        if(route==='/api/agent/enroll'){
          // Invalid keys share a global persisted throttle; no caller IP trust.
          const limit=store.get('enrollmentFailures',{count:0,until:0});
          if(limit.until>now()&&limit.count>=20)return send(res,429,{error:'Kayıt denemesi sınırı aşıldı.'});
          try{const identity=serverLicense?.status?.(),vendorLicensePublicKey=serverLicense?.vendorPublicKey?.toString?.();return send(res,201,{...mutation('agent-enrollment','Ajan kayıt isteği tamamlandı',value=>value.tenant,()=>central.enroll(input.token,input.name,input.requestId!==undefined||input.credential!==undefined?{requestId:input.requestId,credential:input.credential}:undefined)),policyPublicKey:signing.publicKey,...(identity?.serverId&&vendorLicensePublicKey?{serverId:identity.serverId,vendorLicensePublicKey}:{})});}catch(error){if(error.status===402)return send(res,402,{error:'Üretici sunucu lisansı etkin değil veya cihaz kotası dolu.'});if(error.status===503)return send(res,503,{error:'Merkezi denetim teslimi tamamlanamadı. Aynı kayıt isteği güvenli biçimde yeniden denenebilir.'});store.set('enrollmentFailures',{count:limit.until>now()?limit.count+1:1,until:limit.until>now()?limit.until:now()+900000});return send(res,401,{error:'Ajan kaydı doğrulanamadı.'});}
        }
        if(!token)return send(res,401,{error:'Ajan kimliği gereklidir.'});
        // Authentication precedes content validation and never leaks identities.
        try{central.heartbeat(token);}catch{return send(res,401,{error:'Ajan kimliği doğrulanamadı.'});}
        if(route==='/api/agent/outlook/credential'){
          if(!tls)return send(res,403,{error:'Outlook kimliği için HTTPS gereklidir.'});
          if(serverLicense&&!serverLicense.status().allowed)return send(res,402,{error:'Üretici sunucu lisansı etkin değil.'});
          return send(res,200,central.issueOutlookCredential(token));
        }
        if(route==='/api/agent/identity'){const state=central.heartbeat(token);return send(res,200,{id:state.deviceId,tenant:state.tenant,policyPublicKey:signing.publicKey});}
        if(route==='/api/agent/heartbeat'){const state=central.heartbeat(token,input),identity=serverLicense?.status?.(),vendorLicensePublicKey=serverLicense?.vendorPublicKey,entitlement=central.entitlement(token,signing),signedState={...state,...(identity?.serverId&&vendorLicensePublicKey?{serverId:identity.serverId,vendorLicensePublicKey}:{})};return send(res,200,{...state,signed:signing.sign(signedState),...(entitlement?{entitlement}:{})});}
        if(route==='/api/agent/events')return send(res,200,central.ingest(token,input));
        return send(res,404,{error:'İşlem bulunamadı.'});
      }
      const user=auth.authenticate(req);
      if(req.method==='GET'&&route==='/api/auth/status')return send(res,200,{configured:auth.configured(),user:user?{id:user.id,username:user.username,role:user.role}:null,token:user?.csrf,mfaRequired:!!user&&requireMfa&&!mfa.status(user.id).enabled});
      if(req.method==='POST'&&['/api/auth/setup','/api/auth/login'].includes(route)){const input=await body(req);return send(res,200,route.endsWith('setup')?await auth.setup(input,res):await auth.login(input,res));}
      if(!user)return send(res,401,{error:'Giriş yapın.'});
      if(req.method==='POST'&&!auth.same(req.headers['x-dlp-token'],user.csrf))return send(res,403,{error:'İstek doğrulanamadı.'});
      if(req.method==='GET'&&route==='/api/mfa/status')return send(res,200,mfa.status(user.id));
      if(req.method==='POST'&&['/api/mfa/begin','/api/mfa/confirm','/api/mfa/disable'].includes(route)){
        const input=await body(req);let result;
        if(route.endsWith('/begin')){await auth.reauthenticate(user,input.password);result=mfa.begin(user.id,user.username);}
        else if(route.endsWith('/confirm')){result=mfa.confirm(user.id,input.otp);}
        else {await auth.reauthenticate(user,input.password);mfa.disable(user.id,input.otp);result={ok:true};}
        return send(res,200,result);
      }
      if(requireMfa&&!mfa.status(user.id).enabled&&!['/api/auth/logout','/api/auth/password'].includes(route))return send(res,403,{error:'Devam etmek için iki aşamalı doğrulamayı etkinleştirin.',code:'MFA_REQUIRED'});
      if(req.method==='POST'&&route==='/api/auth/logout'){auth.logout(user,res);return send(res,200,{ok:true});}
      if(req.method==='POST'&&route==='/api/auth/password'){await auth.changePassword(user,await body(req));return send(res,200,{ok:true});}
      if(req.method==='GET'&&route==='/api/server-license'){if(user.role!=='admin')return send(res,403,{error:'Merkez yöneticisi gereklidir.'});return send(res,200,serverLicense?serverLicense.status():{state:'test-unmanaged',allowed:false});}
      if(req.method==='GET'&&route==='/api/registration-status')return send(res,200,{allowed:serverLicense?serverLicense.status().allowed:true});
      if(req.method==='GET'&&route==='/api/tenants')return send(res,200,{tenants:central.tenants(user.id)});
      if(req.method==='GET'&&route==='/api/rules')return send(res,200,{rules:rules.map(({id,label})=>({id,label}))});
      if(req.method==='GET'&&route==='/api/users'){if(user.role!=='admin')return send(res,403,{error:'Merkez yöneticisi gereklidir.'});return send(res,200,{users:auth.users()});}
      if(req.method==='POST'&&route==='/api/users/update'){
        if(user.role!=='admin')return send(res,403,{error:'Merkez yöneticisi gereklidir.'});
        const input=await body(req),target=auth.users().find(account=>account.id===input.id);if(!target||typeof input.enabled!=='boolean')throw Error('Geçersiz kullanıcı ayarı.');
        if(!input.enabled){if(target.id===user.id)throw Error('Kendi hesabınızı devre dışı bırakamazsınız.');central.assertAdministration(auth.users().filter(account=>account.enabled&&account.id!==target.id&&account.role!=='auditor').map(account=>account.id));mutation(user.id,'Hesap değişikliği öncesi kayıt anahtarları iptal edildi',null,()=>central.invalidateEnrollmentForActor(target.id),()=>({target:target.id}));}
        const updated=auth.updateUser(target.id,{role:target.role,enabled:input.enabled},user);return send(res,200,updated);
      }
      if(req.method==='POST'&&route==='/api/tenants'){
        if(user.role!=='admin')return send(res,403,{error:'Merkez yöneticisi gereklidir.'});
        const input=await body(req),tenant=mutation(user.id,'Şirket oluşturuldu',value=>value.id,()=>central.createTenant(user.id,input.name));return send(res,201,tenant);
      }
      if(req.method==='POST'&&route==='/api/users'){
        if(user.role!=='admin')return send(res,403,{error:'Merkez yöneticisi gereklidir.'});
        const input=await body(req);if(!['operator','auditor'].includes(input.role))throw Error('Bu uç noktadan merkez yöneticisi oluşturulamaz.');
        const created=await auth.createUser(input,{actor:user.username});return send(res,201,created);
      }
      const match=/^\/api\/tenants\/([a-f0-9-]{36})\/(devices|events|enrollment|policy|grant|revoke|members|remove-member|audit|storage)$/.exec(route);
      if(match){
        const [,tenant,action]=match;
        if(req.method==='GET'&&action==='devices')return send(res,200,{devices:central.devices(user.id,tenant)});
        if(req.method==='GET'&&action==='events')return send(res,200,{events:central.events(user.id,tenant)});
        if(req.method==='GET'&&action==='storage')return send(res,200,central.storage(user.id,tenant));
        if(req.method==='GET'&&action==='policy')return send(res,200,{policy:central.policy(user.id,tenant)});
        if(req.method==='GET'&&action==='audit'){central.policy(user.id,tenant);return send(res,200,{events:store.tenantAudit(tenant)});}
        if(req.method==='GET'&&action==='members'){const members=central.members(user.id,tenant),accounts=new Map(auth.users().map(account=>[account.id,account]));return send(res,200,{members:members.map(member=>({...member,username:accounts.get(member.actor)?.username||'Silinmiş kullanıcı',enabled:!!accounts.get(member.actor)?.enabled}))});}
        if(req.method==='POST'){
          if(user.role==='auditor')return send(res,403,{error:'Denetçi salt okunur erişime sahiptir.'});
          const input=await body(req);const result=mutation(user.id,`Şirket yönetimi: ${action}`,tenant,()=>{let result;
          if(action==='enrollment'){if(serverLicense&&!serverLicense.status().allowed){const error=Error('Üretici sunucu lisansı etkin değil.');error.status=402;throw error;}result={...central.issueEnrollment(user.id,tenant),origin:origin?.protocol==='https:'?origin.origin:null};}
          else if(action==='storage')result=central.setStorage(user.id,tenant,input);
          else if(action==='policy'){if(!Array.isArray(input.enabled)||input.enabled.some(id=>!rules.some(rule=>rule.id===id))||(input.usbWriteProtection!==undefined&&input.usbWriteProtection!==null&&typeof input.usbWriteProtection!=='boolean'))throw Error('Geçersiz tespit kuralı veya USB ayarı.');result={revision:central.setPolicy(user.id,tenant,input)};}
          else if(action==='revoke'){central.revoke(user.id,tenant,input.id);result={ok:true};}
          else if(action==='remove-member'){central.removeMember(user.id,tenant,input.actor);result={ok:true};}
          else if(action==='grant'){
            const target=auth.users().find(value=>value.id===input.actor&&value.enabled);if(!target)throw Error('Kullanıcı bulunamadı.');
            if(target.role==='auditor'&&input.role!=='auditor')throw Error('Denetçiye yazma yetkisi verilemez.');
            central.grant(user.id,tenant,target.id,input.role);result={ok:true};
          }else {const error=Error('İşlem desteklenmiyor.');error.status=405;throw error;}
          return result;},value=>action==='storage'?{retentionDays:value.retentionDays,maxEvents:value.maxEvents}:action==='policy'?{revision:value.revision,mode:input.mode,enabled:input.enabled,usbWriteProtection:input.usbWriteProtection??null}:action==='grant'||action==='remove-member'?{target:input.actor,...(action==='grant'?{role:input.role}:{})}:action==='revoke'?{device:input.id}:{action});return send(res,200,result);
        }
      }
      return send(res,404,{error:'İşlem bulunamadı.'});
    }catch(e){send(res,e.status||400,{error:e.status===429?'İstek sınırı aşıldı. Bir süre bekleyip tekrar deneyin.':e.status===403||e.status===507?e.message:'İşlem tamamlanamadı. İstek bilgilerini kontrol edin.'});}
    finally{busy--;if(!req.readableEnded)req.resume();}
  }
  let server;
  const requestLimits={requestTimeout:15000,headersTimeout:10000,connectionsCheckingInterval:1000};
  try{server=tls?https.createServer({...tls,...requestLimits,minVersion:'TLSv1.2'},handler):http.createServer(requestLimits,handler);}catch(e){central.close();store.close();unlock();throw e;}
  server.maxHeadersCount=40;server.maxConnections=100;
  server.once('listening',()=>{licenseRuntime?.start();maintenanceTimer=setInterval(()=>{try{maintainEvents();}catch{console.error('Olay saklama bakımı tamamlanamadı; denetim ve depolama durumunu kontrol edin.');}},60000);maintenanceTimer.unref();});
  if(serviceMode==='windows-service'||serviceMode==='console-test')server.once('listening',()=>{let warned=false;serviceStopTimer=setInterval(()=>{try{const file=path.join(dataDir,'central-service-stop.request');if(!fs.existsSync(file))return;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==64)return;if(!auth.same(fs.readFileSync(file,'utf8'),controlToken))return;fs.unlinkSync(file);close().catch(()=>console.error('Merkez hizmeti temiz kapatılamadı.'));}catch{if(!warned){console.error('Merkez hizmet durdurma isteği okunamadı.');warned=true;}}},250);serviceStopTimer.unref();});
  function close(){if(closePromise)return closePromise;clearInterval(maintenanceTimer);clearInterval(serviceStopTimer);closePromise=(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));await licenseRuntime?.close();central.close();store.close();unlock();})();return closePromise;}
  return {server,close};
}
if(require.main===module){
  const config=require('./central-config').loadCentralConfig();
  const app=createCentralApp({dataDir:config.dataDir,publicOrigin:config.origin,tls:config.tls,requireMfa:config.requireMfa,serviceMode:config.serviceMode,licenseFactory:require('./server-license-runtime').openServerLicenseRuntime});
  app.server.listen(config.port,config.host,()=>console.log('Kalkan DLP merkezi hazır: '+config.origin));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
module.exports={createCentralApp};
