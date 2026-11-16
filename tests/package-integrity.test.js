'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {verifyPackage}=require('../tools/verify-package.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-package-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'runtime'));fs.writeFileSync(path.join(root,'runtime','app.js'),'trusted code');const bytes=fs.readFileSync(path.join(root,'runtime','app.js')),manifest={version:'test',sourceFingerprint:'test',files:[{path:'runtime/app.js',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]};const save=()=>fs.writeFileSync(path.join(root,'RELEASE-MANIFEST.json'),JSON.stringify(manifest));save();return {root,manifest,save};}
test('package rejects added executable even when all listed hashes still match',t=>{const f=fixture(t);assert.equal(verifyPackage(f.root).valid,true);fs.writeFileSync(path.join(f.root,'runtime','injected.js'),'unlisted code');assert.throws(()=>verifyPackage(f.root),/listelenmeyen/);});
test('package rejects duplicate Windows path aliases and invalid hash metadata',t=>{const f=fixture(t);f.manifest.files.push({...f.manifest.files[0],path:'RUNTIME\\APP.JS'});f.save();assert.throws(()=>verifyPackage(f.root),/yinelenen/);f.manifest.files.pop();f.manifest.files[0].bytes='12';f.save();assert.throws(()=>verifyPackage(f.root),/izin verilmeyen/);});
test('package rejects dot, stream and trailing-dot path aliases',t=>{const f=fixture(t);for(const name of ['runtime/./app.js','runtime/app.js:secret','runtime/app.js.','runtime//app.js']){f.manifest.files[0].path=name;f.save();assert.throws(()=>verifyPackage(f.root),/izin verilmeyen/);}});
test('package rejects nested secret file even when listed with a matching hash',t=>{const f=fixture(t);const name='vendor-activation.json',bytes=Buffer.from('{}');fs.writeFileSync(path.join(f.root,'runtime',name),bytes);f.manifest.files.push({path:'runtime/'+name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});f.save();assert.throws(()=>verifyPackage(f.root),/izin verilmeyen/);});
test('package rejects an unlisted directory junction instead of traversing it',t=>{const f=fixture(t);fs.symlinkSync(path.join(f.root,'runtime'),path.join(f.root,'linked'),process.platform==='win32'?'junction':'dir');assert.throws(()=>verifyPackage(f.root),/bağlantı noktası/);});
test('package rejects a hardcoded device bearer in a public asset even with a valid hash',t=>{
 const f=fixture(t),name='central-public/outlook.js',bytes=Buffer.from('const authorization="Bearer '+'a'.repeat(64)+'";');
 fs.mkdirSync(path.join(f.root,'central-public'));
 fs.writeFileSync(path.join(f.root,name),bytes);
 f.manifest.files.push({path:name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 f.save();
 assert.throws(()=>verifyPackage(f.root),/sabit cihaz kimliği/);
 const scoped=Buffer.from('const authorization="Bearer o1_'+'b'.repeat(64)+'";');
 fs.writeFileSync(path.join(f.root,name),scoped);
 f.manifest.files[1]={path:name,bytes:scoped.length,sha256:crypto.createHash('sha256').update(scoped).digest('hex')};
 f.save();
 assert.throws(()=>verifyPackage(f.root),/sabit cihaz kimliği/);
});
