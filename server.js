'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {inspect,rules}=require('./detector');
const {scanDirectory,inspectFile,extract,MAX_FILE}=require('./scanner');
const {openStore}=require('./store');
const {openAuth}=require('./auth');
const {openLicense}=require('./license');
const {createBackup}=require('./backup');
const {acquireLock}=require('./runtime-lock');
const {openAccess}=require('./agent-access');
const windows=require('./windows');
const product=require('./product-config.json');
const emailPattern=/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;
function json(res,status,data){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,limit=16*1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('İstek boyutu sınırı aşıldı.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
function createApp({dataDir=process.env.DLP_DATA_DIR||path.join(__dirname,'data'),deviceProvider=windows.devices,mailer,env=process.env,now=Date.now,licensePublicKey,agentBrokerPath,testVendorPublicKey,driverReceiverPath}={}){
  // Explicit development wiring until signed driver installation is accepted.
  // Never select a receiver executable from a remote request or ambient env.
  if(driverReceiverPath&&(!path.isAbsolute(driverReceiverPath)||path.extname(driverReceiverPath).toLowerCase()!=='.exe'))throw Error('A trusted absolute driver receiver executable is required.');
  const releaseLock=acquireLock(dataDir);let store,auth,license;
  try{store=openStore(dataDir);auth=openAuth(store,dataDir,{now});license=openLicense(store,{now,publicKey:licensePublicKey||require('node:fs').readFileSync(path.join(__dirname,'license-public.pem'),'utf8')});}catch(error){store?.close();releaseLock();throw error;}
  const controlFile=path.join(dataDir,'control-token.txt');
  if(!require('node:fs').existsSync(controlFile))require('node:fs').writeFileSync(controlFile,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
  const controlToken=require('node:fs').readFileSync(controlFile,'utf8').trim();
  const extensionKey=store.get('extensionKey',crypto.randomBytes(32).toString('hex'));store.set('extensionKey',extensionKey);
  const access=openAccess(store,{mode:env.DLP_AGENT_MODE==='service',dataDir,brokerPath:agentBrokerPath,protectedRoots:env.DLP_AGENT_MODE==='service'&&env.DLP_AGENT_CONSOLE_TEST!=='1'?[path.dirname(dataDir)]:[]});
  let activeScan=null,closing=false,postRequests=0;const jobs=new Map();
  let centralLink=null,enrolling=false;const enrollmentFile=path.join(dataDir,'agent-central.json');
  const applyCentralUsbPolicy=async enabled=>{if(!access.mode)throw Error('Merkez USB yazma politikası yalnızca makine Agent kurulumunda uygulanabilir.');await windows.setWriteProtection(enabled,{serviceMode:true});const event={id:crypto.randomUUID(),time:new Date(now()).toISOString(),kind:'usb',summary:`Merkez politikası Windows USB yazma korumasını ${enabled?'açtı':'kapattı'}`,decision:'policy'};store.record(event);try{centralLink?.enqueue(event);}catch{}};
  try{const configFile=env.DLP_CENTRAL_CONFIG||(!access.mode&&require('node:fs').existsSync(enrollmentFile)?enrollmentFile:null);if(configFile){const config=JSON.parse(require('node:fs').readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));centralLink=require('./central-client').openCentralLink(store,config,{onUsbWriteProtection:applyCentralUsbPolicy,...(testVendorPublicKey?{testLoopback:true,testVendorPublicKey}:{})});centralLink.start();}else if(store.get('centralIdentity',null)||(store.get('centralEnrollmentPending',false)&&!require('node:fs').existsSync(enrollmentFile+'.pending.json')))throw Error('Merkez kimliği mevcut ancak korunan bağlantı dosyası eksik. Yerel politikaya geçilmedi; yönetici kurtarması gerekiyor.');}catch(error){store.close();releaseLock();throw error;}
  const policy=()=>{if(enrolling)throw Error('Merkeze kayıt sürüyor. İşlem tamamlanana kadar bekleyin.');if(!centralLink){if(store.get('centralEnrollmentPending',false)||require('node:fs').existsSync(enrollmentFile)||require('node:fs').existsSync(enrollmentFile+'.pending.json'))throw Error('Merkez kaydı tamamlanmadı. Aynı kayıt isteğini sürdürün veya yönetici kurtarması yapın.');return store.policy();}const value=centralLink.policy();if(!value)throw Error('Merkez politikası henüz alınmadı. Bağlantıyı kontrol edin.');return value;};
  const effectiveLicense=()=>{if(!centralLink)return license.status();const status=centralLink.entitlementStatus()||{allowed:false,state:'pending'};return {...status,installationId:status.installationId||centralLink.status().serverId||'Merkez lisans kimliği bekleniyor',source:'central',message:status.allowed?'':`Merkez lisansı ${status.state||'bekleniyor'}; şirket sunucusuna bağlanın.`};};
  const requireProductLicense=()=>{if(centralLink){const status=effectiveLicense();if(!status.allowed)throw Error('İstemci yetkisi etkin değil. Şirket sunucusunun bağlantısını veya lisans durumunu kontrol edin.');return status;}return license.requireActive();};
  const enrollmentPending=()=>!centralLink&&(store.get('centralEnrollmentPending',false)||require('node:fs').existsSync(enrollmentFile)||require('node:fs').existsSync(enrollmentFile+'.pending.json'));
  const displayPolicy=()=>centralLink?(centralLink.policy()||{mode:'pending',enabled:[]}):enrollmentPending()?{mode:'pending',enabled:[]}:store.policy();
  let driverReceiver=null;
  const driverState={receiverState:'disabled',protectionActive:false};
  if(driverReceiverPath){
    driverReceiver=require('./agent/driver-transport.cjs').startDriverReceiver({receiverPath:driverReceiverPath,central:{scanPolicy:()=>centralLink?.scanPolicy()||null}});
    driverState.receiverState='running';
    driverReceiver.done.then(result=>{driverState.receiverState='stopped';driverState.exitCode=result.code;driverState.error=result.error;});
  }
  const appendEvent=(kind,summary,details={})=>{const event={id:crypto.randomUUID(),time:new Date(now()).toISOString(),kind,summary,...details};store.record(event);centralLink?.enqueue(event);};
  const decide=(findings,p)=>findings.length?(p.mode==='block'?'block':'warn'):'allow';
  async function attachments(input,p){
    if(!input)return [];if(!Array.isArray(input)||input.length>5)throw Error('En fazla 5 dosya eki seçin.');
    let total=0;const output=[];
    for(const file of input){
      if(typeof file.name!=='string'||typeof file.data!=='string'||file.data.length>14*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))throw Error('Geçersiz dosya eki.');
      const buffer=Buffer.from(file.data,'base64');total+=buffer.length;if(buffer.length>MAX_FILE||total>MAX_FILE)throw Error('Dosya ekleri toplamı en fazla 10 MB olabilir.');
      const text=await extract(buffer,path.extname(file.name).toLowerCase());
      if(!text.trim()&&path.extname(file.name).toLowerCase()==='.pdf')throw Error('PDF içinde metin bulunamadı. OCR gerekir.');
      output.push({filename:path.basename(file.name),buffer,findings:inspect(text,p.enabled)});
    }return output;
  }
  const server=http.createServer(async(req,res)=>{
    let releasePost=()=>{};
    if(req.method==='POST'){
      if(postRequests>=8){json(res,503,{error:'Sunucu meşgul. Biraz sonra tekrar deneyin.'});req.resume();return;}
      postRequests++;let released=false;
      releasePost=()=>{if(!released){released=true;postRequests--;}};
    }
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const record=(kind,summary,details={})=>appendEvent(kind,summary,{...details,actor:req.auth?.username||'extension'});
      const port=server.address()?.port,origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return json(res,403,{error:'Geçersiz sunucu adresi.'});
      const url=new URL(req.url,'http://localhost'),origin=req.headers.origin;
      const extRoute=url.pathname.startsWith('/api/extension/'),extOrigin=origin&&/^chrome-extension:\/\/[a-p]{32}$/.test(origin);
      if(extRoute&&extOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-DLP-Key');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}}
      else if(origin&&!origins.includes(origin))return json(res,403,{error:'İstek kaynağı reddedildi.'});
      if(extRoute){
        if(req.headers['x-dlp-key']!==extensionKey)return json(res,403,{error:'Uzantı eşleştirme anahtarı geçersiz.'});
        if(req.method==='GET'&&url.pathname==='/api/extension/policy')return json(res,200,{policy:policy()});
        if(req.method==='POST'&&url.pathname==='/api/extension/check'){
          requireProductLicense();
          const input=await body(req),p=policy();if(typeof input.text!=='string'||input.text.length>1024*1024)throw Error('İçerik en fazla 1 MB olabilir.');
          const files=await attachments(input.files,p),findings=[...inspect(input.text,p.enabled),...files.flatMap(f=>f.findings.map(m=>({...m,file:f.filename})))];
          const decision=decide(findings,p);record('web',`Tarayıcı kontrolü: ${findings.length} bulgu`,{decision,count:findings.length});return json(res,200,{decision,findings});
        }return json(res,404,{error:'Uzantı işlemi bulunamadı.'});
      }
      if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'İstek kaynağı reddedildi.'});
      if(url.pathname.startsWith('/api/')){
        if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{application:'Kalkan DLP',version:require('./package.json').version,processId:process.pid,deployment:access.mode?'service':'desktop',driver:{...driverState}});
        if(url.pathname==='/api/control/shutdown'&&req.method==='POST'){
          if(!auth.same(req.headers['x-dlp-control'],controlToken))return json(res,403,{error:'Yerel kontrol anahtarı geçersiz.'});
          json(res,200,{stopped:true});setImmediate(()=>close());return;
        }
        req.auth=auth.authenticate(req);
        if(url.pathname==='/api/auth/status'&&req.method==='GET')return json(res,200,{configured:auth.configured(),authenticated:!!req.auth,user:req.auth?{id:req.auth.id,username:req.auth.username,role:req.auth.role}:null,token:req.auth?.csrf});
        if(req.method==='POST'&&['/api/auth/setup','/api/auth/login'].includes(url.pathname)){
          if(Number(req.headers['content-length']||0)>4096)throw Error('Giriş isteği çok büyük.');
          const input=await body(req,4096);const result=url.pathname.endsWith('/setup')?await auth.setup(input,res):await auth.login(input,res);return json(res,200,result);
        }
        if(!req.auth)return json(res,401,{error:'Bu işlem için giriş yapın.',code:'AUTH_REQUIRED'});
        const token=req.auth.csrf;
        if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{application:'Kalkan DLP',version:require('./package.json').version,token,user:{id:req.auth.id,username:req.auth.username,role:req.auth.role},product,central:centralLink?centralLink.status():{configured:false,enrollmentPending:enrollmentPending()},license:effectiveLicense(),agent:{mode:access.mode?'service':'desktop',testMode:env.DLP_AGENT_CONSOLE_TEST==='1',roots:req.auth.role==='admin'?access.roots():undefined},policy:displayPolicy(),rules:rules.map(({id,label,severity})=>({id,label,severity})),events:store.events(),scans:store.scanSummaries(),activeScan:activeScan?{id:activeScan.id,progress:activeScan.progress}:null,extensionKey:req.auth.role==='admin'?extensionKey:undefined,smtpConfigured:!!(env.DLP_SMTP_HOST&&env.DLP_SMTP_FROM),defaultPath:access.mode?(access.roots()[0]||''):(env.USERPROFILE?path.join(env.USERPROFILE,'Documents'):__dirname)});
        if(!auth.same(req.headers['x-dlp-token'],token))return json(res,403,{error:'İstek doğrulanamadı. Sayfayı yenileyin.'});
        if((centralLink||enrolling||enrollmentPending())&&url.pathname==='/api/policy'&&req.method==='POST')return json(res,409,{error:'Bu cihazın politikası merkezden yönetiliyor.'});
        const adminRoutes=['/api/policy','/api/usb/protection','/api/users','/api/users/update','/api/shutdown','/api/license','/api/diagnostics','/api/backup','/api/agent/roots','/api/central/enroll','/api/central/resume','/api/central/sync','/api/outlook/session'];
        if(adminRoutes.includes(url.pathname)&&req.auth.role!=='admin')return json(res,403,{error:'Bu işlem yönetici yetkisi gerektirir.'});
        if(req.method==='POST'&&req.auth.role==='auditor'&&!['/api/auth/logout','/api/auth/password'].includes(url.pathname))return json(res,403,{error:'Denetçi hesabı salt okunur erişime sahiptir.'});
        if(req.method==='GET'&&url.pathname==='/api/users')return json(res,200,{users:auth.users()});
        if(req.method==='GET'&&url.pathname==='/api/audit/verify')return json(res,200,store.verifyAudit());
        if(req.method==='GET'&&url.pathname==='/api/diagnostics')return json(res,200,{application:'Kalkan DLP',version:require('./package.json').version,node:process.version,platform:process.platform,architecture:process.arch,time:new Date(now()).toISOString(),audit:store.verifyAudit(),license:{state:effectiveLicense().state,expiresAt:effectiveLicense().expiresAt},database:{users:auth.users().length,scans:store.scanSummaries().length},smtpConfigured:!!(env.DLP_SMTP_HOST&&env.DLP_SMTP_FROM)});
        if(req.method==='GET'&&url.pathname==='/api/report'){
          const scan=store.getScan(url.searchParams.get('id'));if(!scan)return json(res,404,{error:'Tarama bulunamadı.'});res.setHeader('Content-Disposition',`attachment; filename="dlp-report-${scan.id}.json"`);return json(res,200,scan);
        }
        if(req.method==='GET'&&url.pathname.startsWith('/api/jobs/')){const job=jobs.get(url.pathname.slice(10));if(!job)return json(res,404,{error:'Tarama işi bulunamadı.'});return json(res,200,{id:job.id,status:job.status,progress:job.progress,result:job.result,error:job.error});}
        if(req.method!=='POST')return json(res,405,{error:'Desteklenmeyen yöntem.'});
        const input=await body(req);
        if(['/api/central/enroll','/api/central/resume'].includes(url.pathname)){
          if(access.mode)return json(res,409,{error:'Windows hizmeti kaydı, korunan makine yapılandırması üzerinden Windows yöneticisi tarafından yapılmalı.'});
          if(centralLink||enrolling||activeScan||postRequests>1||require('node:fs').existsSync(enrollmentFile))return json(res,409,{error:'Kayıt zaten var veya başka işlem sürüyor. Mevcut kimlik değiştirilmedi.'});
          enrolling=true;try{let request=input;if(url.pathname.endsWith('/resume')){const pendingFile=enrollmentFile+'.pending.json',stat=require('node:fs').lstatSync(pendingFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>131072)throw Error('Bekleyen kayıt dosyası geçersiz.');request=JSON.parse(require('node:fs').readFileSync(pendingFile,'utf8'));}const config=await require('./agent-enrollment').enrollAgent(request,enrollmentFile,{onPrepared:()=>store.set('centralEnrollmentPending',true),vendorPublicKeyOverride:testVendorPublicKey});centralLink=require('./central-client').openCentralLink(store,config,{...(testVendorPublicKey?{testLoopback:true,testVendorPublicKey}:{})});let synced=true;try{await centralLink.sync();synced=!!centralLink.policy();}catch{synced=false;}centralLink.start();store.set('centralEnrollmentPending',false);record('system','Cihaz merkeze kaydedildi',{deviceId:config.id});return json(res,200,{registered:true,synced,status:centralLink.status()});}finally{enrolling=false;}
        }
        if(url.pathname==='/api/central/sync'){if(!centralLink)return json(res,409,{error:'Bu cihaz merkeze bağlı değil.'});let synced=true;try{await centralLink.sync();synced=!!centralLink.policy();}catch{synced=false;}return json(res,200,{synced,status:centralLink.status()});}
        if(url.pathname==='/api/outlook/session'){requireProductLicense();if(!centralLink)return json(res,409,{error:'Bu cihaz şirket Server kaydına bağlı değil.'});return json(res,200,await centralLink.outlookSession());}if(url.pathname==='/api/agent/roots'){const roots=await access.setRoots(input.roots);record('system','Güvenilen tarama klasörleri güncellendi',{rootCount:roots.length});return json(res,200,{roots});}
        if(url.pathname==='/api/backup'){record('system','Şifreli yedek oluşturma istendi');const document=await createBackup(store,dataDir,input.password,{includeEnrollment:!access.mode&&!env.DLP_CENTRAL_CONFIG});return json(res,200,document);}
        if(['/api/scan','/api/inspect','/api/email/send','/api/usb/copy'].includes(url.pathname))requireProductLicense();
        if(url.pathname==='/api/license'){const value=license.activate(input);record('license','Lisans etkinleştirildi',{licenseId:value.licenseId});return json(res,200,{license:value});}
        if(url.pathname==='/api/auth/logout'){auth.logout(req.auth,res);record('auth','Kullanıcı çıkış yaptı');return json(res,200,{loggedOut:true});}
        if(url.pathname==='/api/auth/password'){await auth.changePassword(req.auth,input);return json(res,200,{changed:true});}
        if(url.pathname==='/api/users'){const user=await auth.createUser(input,{actor:req.auth.username});return json(res,201,{user});}
        if(url.pathname==='/api/users/update'){const user=auth.updateUser(input.id,input,req.auth);return json(res,200,{user});}
        if(url.pathname==='/api/shutdown'){if(access.mode)return json(res,409,{error:'Windows hizmetini yalnızca yetkili Windows yöneticisi durdurabilir.'});json(res,200,{stopped:true});setImmediate(()=>close());return;}
        if(url.pathname==='/api/policy'){
          if(!['block','audit'].includes(input.mode)||!Array.isArray(input.enabled)||input.enabled.some(id=>!rules.some(r=>r.id===id)))throw Error('Geçersiz politika.');
          const next={mode:input.mode,enabled:[...new Set(input.enabled)]};store.set('policy',next);record('policy','Politika güncellendi',{mode:next.mode});return json(res,200,{policy:next});
        }
        if(url.pathname==='/api/inspect'||url.pathname==='/api/email/send'){
          if(typeof input.text!=='string'||input.text.length>1024*1024||!['web','email'].includes(input.channel))throw Error('İçerik ve kanal geçersiz.');
          const p=policy(),files=await attachments(input.files,p);
          const findings=[...inspect([input.subject||'',input.text].join('\n'),p.enabled),...files.flatMap(f=>f.findings.map(m=>({...m,file:f.filename})))],decision=decide(findings,p);
          if(url.pathname==='/api/inspect'){record(input.channel,`${input.channel==='email'?'E-posta':'Web'} ön kontrolü: ${findings.length} bulgu`,{count:findings.length,decision});return json(res,200,{findings,decision});}
          if(input.channel!=='email'||!emailPattern.test(input.to)||typeof input.subject!=='string'||/[\r\n]/.test(input.subject))throw Error('Geçerli bir alıcı adresi ve konu girin.');
          if(decision==='block'){record('email','E-posta gönderimi engellendi',{decision,count:findings.length});return json(res,422,{error:'DLP politikası gönderimi engelledi.',decision,findings});}
          if(!mailer&&!(env.DLP_SMTP_HOST&&env.DLP_SMTP_FROM))throw Error('SMTP yapılandırması eksik. Kurulum belgesindeki ortam değişkenlerini ayarlayın.');
          const transport=mailer||require('nodemailer').createTransport({host:env.DLP_SMTP_HOST,port:Number(env.DLP_SMTP_PORT||587),secure:env.DLP_SMTP_PORT==='465',requireTLS:env.DLP_SMTP_PORT!=='465',auth:env.DLP_SMTP_USER?{user:env.DLP_SMTP_USER,pass:env.DLP_SMTP_PASS}:undefined,connectionTimeout:15000,socketTimeout:30000});
          try{await transport.sendMail({from:env.DLP_SMTP_FROM,to:input.to,subject:input.subject,text:input.text,attachments:files.map(f=>({filename:f.filename,content:f.buffer})),disableFileAccess:true,disableUrlAccess:true});}catch{record('email','SMTP gönderimi başarısız',{decision:'error'});throw Error('SMTP gönderimi başarısız. Sunucu, TLS ve kimlik bilgilerini kontrol edin.');}
          record('email','E-posta SMTP sunucusuna iletildi',{decision,count:findings.length});return json(res,200,{sent:true,decision,findings});
        }
        if(url.pathname==='/api/scan'){
          if(activeScan)return json(res,409,{error:'Bir tarama zaten devam ediyor.'});if(typeof input.path!=='string'||!path.isAbsolute(input.path))throw Error('Tam bir klasör yolu girin.');
          const p=structuredClone(policy()),controller=new AbortController(),job={id:crypto.randomUUID(),status:'running',progress:{files:0,skipped:0,errors:0,flagged:0},controller};jobs.set(job.id,job);activeScan=job;
          if(jobs.size>25){for(const [id,item]of jobs)if(item.status!=='running'){jobs.delete(id);break;}}
          job.promise=scanDirectory(path.resolve(input.path),p,{signal:controller.signal,access,onProgress:value=>{job.progress=value;}}).then(result=>{job.result={...result,id:job.id,finishedAt:new Date().toISOString()};job.status=result.cancelled?'cancelled':'complete';store.saveScan(job.result);if(!closing){record('scan',`${result.files} dosya tarandı, ${result.findings.length} dosyada bulgu`,{count:result.findings.length,decision:result.cancelled?'cancelled':result.truncated?'limited':'complete'});}}).catch(error=>{job.status='error';job.error=error.code==='ENOENT'?'Klasör bulunamadı.':error.message;}).finally(()=>{activeScan=null;});return json(res,202,{id:job.id});
        }
        if(url.pathname==='/api/scan/cancel'){activeScan?.controller.abort();return json(res,200,{cancelled:!!activeScan});}
        if(url.pathname==='/api/devices')return json(res,200,await deviceProvider());
        if(url.pathname==='/api/usb/protection'){if(centralLink||enrollmentPending())return json(res,409,{error:'USB yazma politikası merkez kaydından yönetilir.'});if(typeof input.enabled!=='boolean')throw Error('Geçersiz yazma koruması isteği.');await windows.setWriteProtection(input.enabled,{serviceMode:access.mode});record('usb',`Windows USB yazma koruması ${input.enabled?'açıldı':'kapatıldı'}`,{decision:'policy'});return json(res,200,{message:'Windows ayarı güncellendi. Aygıtı yeniden takmanız veya bilgisayarı yeniden başlatmanız gerekebilir.'});}
        if(url.pathname==='/api/usb/copy'){
          if(typeof input.source!=='string'||!path.isAbsolute(input.source)||typeof input.drive!=='string')throw Error('Kaynak dosya ve hedef aygıt seçin.');const available=await deviceProvider();
          if(!available.devices.some(d=>d.DeviceID===input.drive))throw Error('Hedef aygıt bağlı değil veya USB/çıkarılabilir aygıt olarak doğrulanamadı.');if(available.writeProtected)throw Error('Windows USB yazma koruması açık.');
          const source=path.resolve(input.source),p=policy(),{buffer,matches}=await inspectFile(source,p,access),decision=decide(matches,p);
          if(decision==='block'){record('usb','USB kopyalama engellendi',{count:matches.length,decision});return json(res,422,{error:'DLP politikası USB kopyalamayı engelledi.',findings:matches,decision});}
          const target=path.join(input.drive+path.sep,path.basename(source));const again=await deviceProvider();if(!again.devices.some(d=>d.DeviceID===input.drive)||again.writeProtected)throw Error('Hedef aygıtın durumu değişti.');
          await fs.writeFile(target,buffer,{flag:'wx'});record('usb','Dosya USB aygıtına kopyalandı',{count:matches.length,decision});return json(res,200,{copied:true,target,findings:matches,decision});
        }
        return json(res,404,{error:'İşlem bulunamadı.'});
      }
      const assets={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/auth.css':'auth.css'};if(req.method!=='GET'||!assets[url.pathname])return json(res,404,{error:'Sayfa bulunamadı.'});const file=assets[url.pathname],content=await fs.readFile(path.join(__dirname,'public',file));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(content);
    }catch(error){json(res,error.status||400,{error:error.code==='ENOENT'?'Dosya veya klasör bulunamadı.':error.code==='EEXIST'?'Hedefte aynı isimli dosya var. Üzerine yazılmadı.':['EACCES','EPERM'].includes(error.code)?'Bu işlem için dosya veya yönetici izni gerekiyor.':error.message,code:error.code==='LICENSE_INACTIVE'?error.code:undefined});}finally{releasePost();}
  });
  server.maxConnections=64;server.requestTimeout=60000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  let closePromise;
  function close(){if(closePromise)return closePromise;closePromise=(async()=>{closing=true;activeScan?.controller.abort();if(activeScan?.promise)await activeScan.promise;if(server.listening)await new Promise(resolve=>server.close(resolve));await driverReceiver?.close();await centralLink?.close();try{store.close();}finally{releaseLock();}})();return closePromise;}
  return {server,store,close,syncCentral:()=>centralLink?.sync(),driverStatus:()=>({...driverState})};
}
if(require.main===module){const app=createApp();app.server.listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log(`DLP hazır: http://127.0.0.1:${app.server.address().port}`));for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.close().then(()=>process.exit(0)));}
module.exports={createApp};
