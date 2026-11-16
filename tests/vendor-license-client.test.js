'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openStore}=require('../store'),{openServerLicense}=require('../server-license'),{openVendorLicenseClient}=require('../vendor-license-client');
test('vendor HTTPS lease renewal pins trust, rejects redirects and forged grants and preserves cached lease on outage',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-vendor-client-')),store=openStore(dir),pair=crypto.generateKeyPairSync('ed25519'),license=openServerLicense(store,{publicKey:pair.publicKey}),credential=crypto.randomBytes(32).toString('hex'),cert=fs.readFileSync(path.join(__dirname,'fixtures','central-test-cert.pem')),key=fs.readFileSync(path.join(__dirname,'fixtures','central-test-key.pem'));let mode='ok',calls=0,received;
 const server=https.createServer({cert,key},async(req,res)=>{calls++;assert.equal(req.url,'/api/v1/server/lease');assert.equal(req.headers.authorization,'Bearer '+credential);let raw='';for await(const part of req)raw+=part;received=JSON.parse(raw);if(mode==='offline'){res.writeHead(503);return res.end('{}');}if(mode==='redirect'){res.writeHead(302,{Location:'https://evil.invalid/'});return res.end();}if(mode==='large')return res.end('x'.repeat(40000));const now=Date.now(),claims={schema:1,product:'kalkan-dlp-server',serverId:received.serverId,licenseId:'test-license',customer:'Company',revision:mode==='forged'?2:1,deviceLimit:20,state:'active',issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString()};if(mode==='ok'&&server.document)return res.end(JSON.stringify(server.document));const bytes=Buffer.from(JSON.stringify(claims));server.document={payload:bytes.toString('base64url'),signature:crypto.sign(null,bytes,mode==='forged'?crypto.generateKeyPairSync('ed25519').privateKey:pair.privateKey).toString('base64url')};res.end(JSON.stringify(server.document));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='https://127.0.0.1:'+server.address().port,client=openVendorLicenseClient(license,{origin,credential,ca:cert});t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const untrusted=openVendorLicenseClient(license,{origin,credential});await assert.rejects(untrusted.sync());await untrusted.close();assert.equal(license.status().allowed,false);
 await Promise.all([client.sync(),client.sync()]);assert.equal(calls,1);assert.equal(license.status().deviceLimit,20);assert.equal(JSON.stringify(received).includes(credential),false);
 for(mode of ['offline','redirect','forged','large']){await assert.rejects(client.sync());assert.equal(license.status().allowed,true);assert.equal(license.status().revision,1);}
 assert.equal(JSON.stringify(client.status()).includes(credential),false);await client.close();await assert.rejects(client.sync(),/kapalı/);
 for(const bad of ['http://example.com','https://user:pass@example.com','https://example.com/path'])assert.throws(()=>openVendorLicenseClient(license,{origin:bad,credential}));
});

test('automatic renewal recovers after a transient outage before the hourly interval', {timeout:5000}, async t=>{
 const cert=fs.readFileSync(path.join(__dirname,'fixtures','central-test-cert.pem'));
 const key=fs.readFileSync(path.join(__dirname,'fixtures','central-test-key.pem'));
 let calls=0;
 const server=https.createServer({cert,key},(req,res)=>{
  req.resume();
  res.writeHead(++calls===1?503:200);
  res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const client=openVendorLicenseClient({status:()=>({serverId:'retry-test'}),accept:document=>document},{
  origin:'https://127.0.0.1:'+server.address().port,credential:'a'.repeat(64),ca:cert
 });
 t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));});
 t.mock.timers.enable({apis:['setTimeout']});
 client.start();
 client.start();
 await assert.rejects(client.sync(),/503/);
 t.mock.timers.tick(14999);
 assert.equal(client.status().pending,false);
 t.mock.timers.tick(1);
 assert.equal(client.status().pending,true);
 await client.sync();
 assert.equal(calls,2);
 assert.equal(client.status().error,null);
 assert.ok(client.status().lastSuccess);
 t.mock.timers.tick(3599999);
 assert.equal(client.status().pending,false);
 await client.close();
 t.mock.timers.tick(3600000);
 assert.equal(calls,2);
});
