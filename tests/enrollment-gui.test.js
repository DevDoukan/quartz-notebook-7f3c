'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
test('native enrollment GUI validates one-use requests and secure file imports without service changes',{skip:process.platform!=='win32'},t=>{
 const root=path.join(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-gui-compile-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const compiler=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),output=path.join(temporary,'EnrollmentGuiTests.exe');
 const sources=['agent/EnrollmentRequest.cs','agent/EnrollmentHost.cs','agent/EnrollmentGui.cs','tests/native/EnrollmentGuiTests.cs'].map(p=>path.join(root,p));
 const build=spawnSync(compiler,['/nologo','/warn:4','/warnaserror+','/codepage:65001','/platform:x64','/target:exe','/main:EnrollmentGuiTests','/out:'+output,'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',...sources],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(build.status,0,build.stdout+build.stderr);
 const run=spawnSync(output,[path.join(__dirname,'fixtures','central-test-cert.pem'),path.join(root,'.build','agent','KalkanDlpEnrollment.exe')],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/PASS native enrollment GUI/);assert.equal((run.stdout+run.stderr).includes('a'.repeat(64)),false);
});
test('per-user native build excludes the elevated machine enrollment helper',{skip:process.platform!=='win32'},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-desktop-native-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const build=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','tools','build-agent.ps1'),'-OutputDirectory',dir,'-WithoutEnrollmentGui'],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(build.status,0,build.stdout+build.stderr);assert.equal(fs.existsSync(path.join(dir,'KalkanDlpEnrollment.exe')),false);assert.equal(fs.existsSync(path.join(dir,'KalkanFileBroker.exe')),true);
});
