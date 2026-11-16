const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{pdf}=require('./helpers');
(async()=>{
 const dir=path.join(__dirname,'..','.test-artifacts','installer-smoke','Data'),base='http://127.0.0.1:4317';
 const initial=await(await fetch(base+'/api/state')).json();assert.equal(initial.code,'AUTH_REQUIRED');
 const configured=(await(await fetch(base+'/api/auth/status')).json()).configured;
 const response=await fetch(base+(configured?'/api/auth/login':'/api/auth/setup'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setupKey:configured?undefined:await fs.readFile(path.join(dir,'setup-key.txt'),'utf8'),username:'installeradmin',password:'Installed-test-password-2026'})});assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie').split(';')[0],auth=await response.json();
 const check=await fetch(base+'/api/inspect',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-DLP-Token':auth.token},body:JSON.stringify({channel:'web',text:'clean',files:[{name:'test.pdf',data:pdf('Card: 4242424242424242').toString('base64')}]})});
 const result=await check.json();assert.equal(check.status,200);assert.ok(result.findings.some(f=>f.type==='card'));assert.equal(result.decision,'warn');
 const state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.version,require('../package.json').version);assert.equal(state.license.state,'trial');assert.equal(state.user.role,'admin');
 const manifest=JSON.parse((await fs.readFile(path.join(__dirname,'..','.test-artifacts','installer-smoke','App','versions',state.version,'RELEASE-MANIFEST.json'),'utf8')).replace(/^\uFEFF/,''));
 const crypto=require('node:crypto'),root=path.join(__dirname,'..','.test-artifacts','installer-smoke','App','versions',state.version);
 for(const file of manifest.files){const bytes=await fs.readFile(path.join(root,file.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 assert.ok(!manifest.files.some(f=>/vendor-private|setup-key|control-token|^data\//.test(f.path)));
 console.log('PASS: installed bundled runtime, first-run auth, PDF parser, trial and '+manifest.files.length+' file checksums');
})().catch(e=>{console.error(e);process.exitCode=1;});
