'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const {fingerprint}=require('./source-fingerprint.cjs'),{verifyPackage}=require('./verify-package.cjs');
const root=path.join(__dirname,'..'),gates=[];
function check(name,fn){try{const result=fn();gates.push({name,passed:!!result.passed,...result});}catch(e){gates.push({name,passed:false,reason:e.message});}}
const current=fingerprint(root);
check('outlook-desktop-acceptance',()=>({
 passed:false,
 reason:'Klasik ve Yeni Outlook için gerçek gönderim, kesin engelleme, kurumsal dağıtım ve müşteri olay kaydı kanıtı gerekiyor.'
}));
check('linux-saas-acceptance',()=>({
 passed:false,
 reason:'Gerçek Linux systemd kurulumu, kurumsal HTTPS, lisans yenileme, çok cihazlı politika ve geri yükleme kanıtı gerekiyor.'
}));
check('driver-build-integrity',()=>{
 const report=JSON.parse(fs.readFileSync(path.join(root,'.test-artifacts','kalkan-driver-build.json'),'utf8').replace(/^\uFEFF/,''));
 return require('./verify-driver-build.cjs').verifyDriverBuild(report,path.join(root,'.build','kalkan-driver'),current.sha256);
});
check('host-reboot-observation',()=>{
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,'.test-artifacts',name),'utf8').replace(/^\uFEFF/,''));
 return require('./reboot-evidence.cjs').assessReboot(read('host-before-reboot.json'),read('host-after-reboot.json'),require('../package.json').version);
});
check('current-source-tests',()=>{const tests=JSON.parse(fs.readFileSync(path.join(root,'.test-artifacts','release-tests.json'),'utf8'));return {passed:tests.passed&&require('./release-checks.cjs').complete(tests.steps)&&tests.sourceFingerprint===current.sha256,reason:tests.sourceFingerprint===current.sha256?'Test raporu mevcut kaynağa ait.':'Kaynak testten sonra değişmiş.'};});
check('package-integrity',()=>{const build=JSON.parse(fs.readFileSync(path.join(root,'.build','latest-machine-build.json'),'utf8').replace(/^\uFEFF/,'')),result=verifyPackage(build.stage);return {passed:result.valid&&result.sourceFingerprint===current.sha256&&build.version===require('../package.json').version,details:result};});
check('installer-lifecycle',()=>{const report=JSON.parse(fs.readFileSync(path.join(root,'.test-artifacts','installer-lifecycle.json'),'utf8'));return {passed:report.passed&&report.sourceFingerprint===current.sha256,details:report};});
check('authenticode-release',()=>{
 const build=JSON.parse(fs.readFileSync(path.join(root,'.build','latest-machine-build.json'),'utf8').replace(/^\uFEFF/,'')),file=build.installer.replace(/'/g,"''");
 const psEnv={...process.env};delete psEnv.PSModulePath;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath '${file}'; @{status=[string]$s.Status;subject=$s.SignerCertificate.Subject;issuer=$s.SignerCertificate.Issuer} | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,env:psEnv});
 if(result.status!==0)throw Error('İmza denetimi çalıştırılamadı: '+result.stderr);
 const value=JSON.parse(result.stdout);return {passed:value.status==='Valid'&&value.subject&&value.subject!==value.issuer&&value.subject===require('../product-config.json').signing.validatedSubject,details:value,installerSha256:crypto.createHash('sha256').update(fs.readFileSync(build.installer)).digest('hex')};
});
check('server-authenticode-release',()=>{
 const build=JSON.parse(fs.readFileSync(path.join(root,'.build','latest-server-build.json'),'utf8').replace(/^\uFEFF/,'')),file=build.installer.replace(/'/g,"''");
 const psEnv={...process.env};delete psEnv.PSModulePath;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath '${file}'; @{status=[string]$s.Status;subject=$s.SignerCertificate.Subject;issuer=$s.SignerCertificate.Issuer} | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,env:psEnv});
 if(result.status!==0)throw Error('İmza denetimi çalıştırılamadı: '+result.stderr);
 const value=JSON.parse(result.stdout);return {passed:value.status==='Valid'&&value.subject&&value.subject!==value.issuer&&value.subject===require('../product-config.json').signing.validatedSubject,details:value,installerSha256:crypto.createHash('sha256').update(fs.readFileSync(build.installer)).digest('hex')};
});
check('server-installer-integrity',()=>{const build=JSON.parse(fs.readFileSync(path.join(root,'.build','latest-server-build.json'),'utf8').replace(/^\uFEFF/,'')),integrity=verifyPackage(build.stage),hash=crypto.createHash('sha256').update(fs.readFileSync(build.installer)).digest('hex');return {passed:build.version===require('../package.json').version&&build.sourceFingerprint===current.sha256&&integrity.valid&&integrity.sourceFingerprint===current.sha256,details:{version:build.version,stageValid:integrity.valid,installerSha256:hash,signed:build.signed}};});
check('central-preview-distribution',()=>{const build=JSON.parse(fs.readFileSync(path.join(root,'.build','latest-central-build.json'),'utf8').replace(/^\uFEFF/,'')),smoke=JSON.parse(fs.readFileSync(path.join(root,'.test-artifacts','central-package.json'),'utf8')),integrity=verifyPackage(build.stage),sha=crypto.createHash('sha256').update(fs.readFileSync(build.archive)).digest('hex');return {passed:integrity.valid&&integrity.sourceFingerprint===current.sha256&&build.sourceFingerprint===current.sha256&&smoke.passed&&smoke.sourceFingerprint===current.sha256&&smoke.archiveSha256===sha&&build.archiveSha256===sha,details:{version:build.version,files:integrity.files,archiveSha256:sha}};});
check('publisher-configuration',()=>{const product=require('../product-config.json');return {passed:typeof product.publisher==='string'&&product.publisher.length>10&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(product.supportEmail),reason:'Ürün sahibinin sağladığı yayıncı/destek yapılandırması; posta teslimi veya CA doğrulaması değildir.'};});
for(const [name,reason]of [['support-and-commercial-terms','Destek adresi yapılandırıldı; posta teslimi, müşteri koşulları ve ticari destek kabulü ayrıca doğrulanmalı.'],['machine-service-acceptance','Gerçek SCM hesabı, yeniden başlatma ve standart kullanıcı kabul testleri gerekiyor.'],['central-deployment-acceptance','Merkez dağıtım/lisanslama ve kuruma ait TLS ile çok cihazlı kabul testi henüz tamamlanmadı.'],['clean-windows-and-hardware','Temiz hedef Windows makinesi, fiziksel USB ve gerçek SMTP sağlayıcısı kabul kanıtı gerekiyor.'],['independent-security-review','Bağımsız inceleme ve kritik bulguların kapanış kanıtı gerekiyor.'],['installer-commercial-license','Mevcut Inno Setup derleyicisi ticari kullanım için lisans doğrulaması gerektiriyor.'],['endpoint-coverage','Sistem genelinde dosya/USB engellemesi ve desteklenen tarayıcı/e-posta akışlarının ürün kapsamına göre tamamlanması gerekiyor.']])gates.push({name,passed:false,reason});
const report={version:require('../package.json').version,checkedAt:new Date().toISOString(),readyForSale:gates.every(g=>g.passed),gates};fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'.test-artifacts','commercial-readiness.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.readyForSale)process.exitCode=1;
