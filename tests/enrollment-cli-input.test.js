'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),https=require('node:https'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const cli=path.join(__dirname,'..','tools','enroll-agent.cjs');
function invoke(target,chunks){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[cli,target],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',p=>stdout+=p);child.stderr.on('data',p=>stderr+=p);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));child.stdin.on('error',()=>{});
 (async()=>{for(const chunk of chunks){if(child.stdin.destroyed)break;child.stdin.write(chunk);await new Promise(r=>setTimeout(r,35));}if(!child.stdin.destroyed)child.stdin.end();})().catch(reject);
});}
test('installed enrollment CLI preserves split Turkish UTF-8 and accepts a supported large CA bundle',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-cli-input-')),cert=fs.readFileSync(path.join(__dirname,'fixtures','central-test-cert.pem')),key=fs.readFileSync(path.join(__dirname,'fixtures','central-test-key.pem'));
 const publicKey=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),device=crypto.randomUUID(),tenant=crypto.randomUUID();let seen;
 const server=https.createServer({cert,key},(req,res)=>{let raw='';req.setEncoding('utf8');req.on('data',p=>raw+=p);req.on('end',()=>{seen=JSON.parse(raw);assert.equal(req.url,'/api/agent/enroll');res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({id:device,tenant,credential:seen.credential,policyPublicKey:publicKey}));});});
 t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const target=path.join(root,'connection.json'),caPem=cert.toString().repeat(Math.ceil(20000/cert.length)),token='a'.repeat(64),name='Şirket İŞ-PC';
 assert.ok(Buffer.byteLength(caPem)>16384);assert.ok(Buffer.byteLength(caPem)<65536);
 const payload=Buffer.from(JSON.stringify({origin:`https://127.0.0.1:${server.address().port}`,name,token,caPem})),split=payload.indexOf(Buffer.from('Ş'))+1;
 const result=await invoke(target,[payload.subarray(0,split),payload.subarray(split)]);
 assert.equal(result.code,0,result.stderr);assert.equal(seen.name,name);assert.equal(JSON.parse(fs.readFileSync(target)).id,device);assert.equal(fs.existsSync(target+'.pending.json'),false);
 for(const secret of [token,seen.credential])assert.equal((result.stdout+result.stderr).includes(secret),false);
});
test('installed enrollment CLI rejects oversized requests, malformed UTF-8 and oversized CA files before creating enrollment state',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-cli-reject-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const caFile=path.join(root,'oversized.pem');fs.writeFileSync(caFile,Buffer.alloc(65537,65));
 const cases=[Buffer.alloc(131073,32),Buffer.from([0x7b,0x22,0xc3,0x28,0x22,0x7d]),Buffer.from(JSON.stringify({origin:'https://127.0.0.1:1',name:'PC',token:'b'.repeat(64),caFile}))];
 for(let i=0;i<cases.length;i++){const target=path.join(root,`rejected-${i}.json`),result=await invoke(target,[cases[i]]);assert.notEqual(result.code,0);assert.equal(fs.existsSync(target),false);assert.equal(fs.existsSync(target+'.pending.json'),false);assert.equal(result.stderr.includes('b'.repeat(64)),false);}
});
